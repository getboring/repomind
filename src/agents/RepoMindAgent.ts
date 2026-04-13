import { QueryRepository, RepoRepository } from "../db/repositories";
import {
	DurableObjectClass,
	WebSocketPairClass,
	WebSocketRequestResponsePairClass,
} from "../lib/do-compat";
import { embedText } from "../lib/embeddings";
import { searchChunks } from "../lib/vectorize";
import type { ChatMessage, Env, RagSource, RepoRecord, VectorizeMatch } from "../types";

interface RepoMindState {
	repoId: string;
	repoOwner: string;
	repoName: string;
	lastCommit: string | null;
	indexStatus: RepoRecord["indexStatus"];
	initialized: boolean;
}

interface WebSocketMessage {
	type: "chat" | "ping" | "status" | "history";
	content?: string;
	limit?: number;
}

export class RepoMindAgent extends DurableObjectClass {
	// Explicitly declare ctx and env for TypeScript in both Workers and test environments
	protected declare ctx: DurableObjectState;
	protected declare env: Env;
	private state: RepoMindState;
	private messages: ChatMessage[] = [];

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);

		this.state = {
			repoId: "",
			repoOwner: "",
			repoName: "",
			lastCommit: null,
			indexStatus: "pending",
			initialized: false,
		};

		this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePairClass("ping", "pong"));
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		// WebSocket upgrade
		if (request.headers.get("Upgrade") === "websocket") {
			const pair = new WebSocketPairClass();
			const [client, server] = Object.values(pair);

			// Parse instance name from URL path
			const pathParts = url.pathname.split("/").filter(Boolean);
			const instanceName =
				pathParts.length >= 2
					? `RepoMind:${pathParts[0]}:${pathParts[1]}`
					: url.searchParams.get("name") || "RepoMind:unknown:unknown";

			await this.initialize(instanceName);
			this.ctx.acceptWebSocket(server as WebSocket);

			return new Response(null, { status: 101, webSocket: client as WebSocket });
		}

		// HTTP API endpoints for the DO
		if (url.pathname.endsWith("/status")) {
			return this.getRepoStatusResponse();
		}

		if (url.pathname.endsWith("/history")) {
			return this.getHistoryResponse();
		}

		return new Response("Not found", { status: 404 });
	}

	async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
		try {
			const text = typeof message === "string" ? message : new TextDecoder().decode(message);
			const data = JSON.parse(text) as WebSocketMessage;

			switch (data.type) {
				case "ping":
					ws.send(JSON.stringify({ type: "pong" }));
					break;
				case "chat":
					if (data.content) {
						await this.handleChatMessage(ws, data.content);
					}
					break;
				case "status":
					ws.send(JSON.stringify({ type: "status", data: this.getRepoStatus() }));
					break;
				case "history":
					ws.send(JSON.stringify({ type: "history", data: this.getHistory(data.limit) }));
					break;
				default:
					ws.send(JSON.stringify({ type: "error", error: "Unknown message type" }));
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			ws.send(JSON.stringify({ type: "error", error: errorMessage }));
		}
	}

	async webSocketClose(ws: WebSocket, code: number, reason: string, _wasClean: boolean) {
		// Clean up if needed
		ws.close(code, reason);
	}

	private async initialize(instanceName: string) {
		if (!this.state.initialized) {
			const parsed = this.parseInstanceName(instanceName);
			this.state = {
				repoId: parsed.repoId,
				repoOwner: parsed.owner,
				repoName: parsed.name,
				lastCommit: null,
				indexStatus: "pending",
				initialized: true,
			};
		}
	}

	private async handleChatMessage(ws: WebSocket, content: string) {
		this.messages.push({ role: "user", content });

		// Check current index status from database
		const repoRepo = new RepoRepository(this.env.DB);
		const repo = await repoRepo.getRepoByOwnerAndName(this.state.repoOwner, this.state.repoName);
		const currentStatus = repo?.indexStatus ?? this.state.indexStatus;

		if (currentStatus !== "complete") {
			const response = `The repository ${this.state.repoOwner}/${this.state.repoName} is still being indexed (status: ${currentStatus}). Please try again shortly.`;
			this.messages.push({ role: "assistant", content: response });
			ws.send(JSON.stringify({ type: "text", content: response }));
			ws.send(JSON.stringify({ type: "done" }));
			return;
		}

		const queryRepo = new QueryRepository(this.env.DB);
		const queryRecord = await queryRepo.createQuery(
			this.state.repoId,
			`${this.state.repoOwner}:${this.state.repoName}`,
			content
		);

		const startTime = Date.now();

		try {
			// 1. Embed query
			const queryEmbedding = await embedText(this.env.AI, content);

			// 2. Search Vectorize
			const relevantChunks = await searchChunks(
				this.env.VECTORIZE,
				this.state.repoId,
				queryEmbedding,
				5
			);

			// 3. Stream response with RAG context
			const systemPrompt = this.buildSystemPrompt(relevantChunks);
			const messagesForAi = [
				{ role: "system", content: systemPrompt },
				...this.messages.map((m) => ({ role: m.role, content: m.content })),
			];

			const result = (await this.env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
				messages: messagesForAi,
				stream: true,
				gateway: {
					id: this.env.AI_GATEWAY_ID,
					skipCache: false,
					cacheTtl: 3600,
				},
			})) as unknown as ReadableStream;

			let fullResponse = "";

			// Stream the response
			const reader = result.getReader();
			const decoder = new TextDecoder();

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				const chunk = decoder.decode(value, { stream: true });
				const lines = chunk.split("\n");

				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed) continue;

					try {
						const parsed = JSON.parse(trimmed);
						if (parsed.response) {
							fullResponse += parsed.response;
							ws.send(JSON.stringify({ type: "text", content: parsed.response }));
						}
					} catch {
						// Ignore parse errors for partial chunks
					}
				}
			}

			const latencyMs = Date.now() - startTime;
			const sources: RagSource[] = relevantChunks.map((c) => ({
				filePath: c.metadata.filePath,
				lineStart: c.metadata.lineStart,
				lineEnd: c.metadata.lineEnd,
				content: c.metadata.content,
				score: c.score,
			}));

			await queryRepo.updateQueryResponse(
				queryRecord.id,
				fullResponse,
				JSON.stringify(sources),
				0, // Native API doesn't return token counts directly
				latencyMs
			);

			this.messages.push({ role: "assistant", content: fullResponse, sources });
			ws.send(JSON.stringify({ type: "done", sources }));
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			console.error("Chat error:", error);
			ws.send(JSON.stringify({ type: "error", error: errorMessage }));
		}
	}

	private getRepoStatus(): {
		repoId: string;
		repoOwner: string;
		repoName: string;
		indexStatus: string;
	} {
		return {
			repoId: this.state.repoId,
			repoOwner: this.state.repoOwner,
			repoName: this.state.repoName,
			indexStatus: this.state.indexStatus,
		};
	}

	private getRepoStatusResponse(): Response {
		return new Response(JSON.stringify(this.getRepoStatus()), {
			headers: { "Content-Type": "application/json" },
		});
	}

	private getHistory(limit?: number): Array<{ role: string; content: string }> {
		return this.messages.slice(-(limit ?? 50)).map((m) => ({
			role: m.role,
			content: m.content,
		}));
	}

	private getHistoryResponse(): Response {
		return new Response(JSON.stringify(this.getHistory()), {
			headers: { "Content-Type": "application/json" },
		});
	}

	private parseInstanceName(name: string): {
		repoId: string;
		owner: string;
		name: string;
	} {
		const parts = name.split(":");
		if (parts.length < 3) {
			throw new Error(`Invalid instance name: ${name}`);
		}

		const owner = parts[1];
		const repoName = parts[2];

		return {
			repoId: `repo-${owner}-${repoName}`,
			owner,
			name: repoName,
		};
	}

	private buildSystemPrompt(chunks: VectorizeMatch[]): string {
		const context =
			chunks.length > 0
				? chunks
						.map(
							(c) => `
File: ${c.metadata.filePath} (lines ${c.metadata.lineStart}-${c.metadata.lineEnd})
\`\`\`${c.metadata.chunkType}
${c.metadata.content}
\`\`\`
`
						)
						.join("\n\n")
				: "No relevant code chunks found.";

		return `You are RepoMind, an AI assistant that helps developers understand codebases.
You have access to the following code chunks from the repository ${this.state.repoOwner}/${this.state.repoName}:

${context}

Answer the user's question based on the provided code. If you need to see more of a file, use the readFile tool.
Always cite your sources with file paths and line numbers in your response.
Be concise and technical. If the code doesn't contain the answer, say so clearly.`;
	}
}
