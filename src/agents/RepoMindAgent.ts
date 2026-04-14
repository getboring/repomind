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

const STATE_KEY = "state";
const MESSAGES_KEY = "messages";

export class RepoMindAgent extends DurableObjectClass {
	// Explicitly declare ctx and env for TypeScript in both Workers and test environments
	protected declare ctx: DurableObjectState;
	protected declare env: Env;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePairClass("ping", "pong"));
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		// WebSocket upgrade
		if (request.headers.get("Upgrade") === "websocket") {
			const pair = new WebSocketPairClass();
			const [client, server] = Object.values(pair);

			// Parse instance name from URL path
			// URL can be /chat/owner/name or /owner/name (when forwarded from Worker)
			const pathParts = url.pathname.split("/").filter(Boolean);
			let startIndex = 0;
			if (pathParts[0] === "chat") {
				startIndex = 1;
			}
			const instanceName =
				pathParts.length >= startIndex + 2
					? `RepoMind:${pathParts[startIndex]}:${pathParts[startIndex + 1]}`
					: url.searchParams.get("name") || "RepoMind:unknown:unknown";

			await this.initialize(instanceName);
			this.ctx.acceptWebSocket(server as WebSocket);

			return new Response(null, { status: 101, webSocket: client as WebSocket });
		}

		// HTTP API endpoints for the DO
		if (url.pathname.endsWith("/status")) {
			return await this.getRepoStatusResponse();
		}

		if (url.pathname.endsWith("/history")) {
			return await this.getHistoryResponse();
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

	private async getState(): Promise<RepoMindState> {
		const stored = await this.ctx.storage.get<RepoMindState>(STATE_KEY);
		return (
			stored ?? {
				repoId: "",
				repoOwner: "",
				repoName: "",
				lastCommit: null,
				indexStatus: "pending",
				initialized: false,
			}
		);
	}

	private async setState(state: RepoMindState): Promise<void> {
		await this.ctx.storage.put(STATE_KEY, state);
	}

	private async getMessages(): Promise<ChatMessage[]> {
		const stored = await this.ctx.storage.get<ChatMessage[]>(MESSAGES_KEY);
		return stored ?? [];
	}

	private async addMessage(message: ChatMessage): Promise<void> {
		const messages = await this.getMessages();
		messages.push(message);
		await this.ctx.storage.put(MESSAGES_KEY, messages);
	}

	private async initialize(instanceName: string) {
		const state = await this.getState();
		const parsed = this.parseInstanceName(instanceName);
		if (!state.initialized || !state.repoId || state.repoId !== parsed.repoId) {
			await this.setState({
				repoId: parsed.repoId,
				repoOwner: parsed.owner,
				repoName: parsed.name,
				lastCommit: null,
				indexStatus: "pending",
				initialized: true,
			});
		}
	}

	private async handleChatMessage(ws: WebSocket, content: string) {
		try {
			await this.addMessage({ role: "user", content });

			const state = await this.getState();
			const messages = await this.getMessages();

			// Check current index status from database
			const repoRepo = new RepoRepository(this.env.DB);
			const repo = await repoRepo.getRepoByOwnerAndName(state.repoOwner, state.repoName);
			const currentStatus = repo?.indexStatus ?? state.indexStatus;

			console.log(`Chat for ${state.repoOwner}/${state.repoName}: status=${currentStatus}, repoId=${state.repoId}`);

			if (currentStatus !== "complete") {
				const response = `The repository ${state.repoOwner}/${state.repoName} is still being indexed (status: ${currentStatus}). Please try again shortly.`;
				await this.addMessage({ role: "assistant", content: response });
				ws.send(JSON.stringify({ type: "text", content: response }));
				ws.send(JSON.stringify({ type: "done" }));
				return;
			}

			const queryRepo = new QueryRepository(this.env.DB);
			const queryRecord = await queryRepo.createQuery(
				state.repoId,
				`${state.repoOwner}:${state.repoName}`,
				content
			);

			const startTime = Date.now();

			// 1. Embed query
			const queryEmbedding = await embedText(this.env.AI, content);

			// 2. Search Vectorize
			const relevantChunks = await searchChunks(
				this.env.VECTORIZE,
				state.repoId,
				queryEmbedding,
				5
			);

			console.log(`Found ${relevantChunks.length} relevant chunks`);

			// 3. Stream response with RAG context
			const systemPrompt = this.buildSystemPrompt(relevantChunks, state);
			const messagesForAi = [
				{ role: "system", content: systemPrompt },
				...messages.map((m) => ({ role: m.role, content: m.content })),
			];

			console.log("Calling AI with messages:", JSON.stringify(messagesForAi));

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
				console.log("AI stream chunk:", chunk);
				const lines = chunk.split("\n");

				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed || trimmed === "data: [DONE]") continue;
					if (!trimmed.startsWith("data: ")) continue;

					const jsonStr = trimmed.slice("data: ".length).trim();
					if (!jsonStr) continue;

					try {
						const parsed = JSON.parse(jsonStr);
						console.log("AI parsed:", parsed);
						if (parsed.response) {
							fullResponse += parsed.response;
							ws.send(JSON.stringify({ type: "text", content: parsed.response }));
						}
					} catch (e) {
						console.log("AI parse error:", e, "for line:", trimmed);
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

			await this.addMessage({ role: "assistant", content: fullResponse, sources });
			ws.send(JSON.stringify({ type: "done", sources }));
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			console.error("Chat error:", error);
			ws.send(JSON.stringify({ type: "error", error: errorMessage }));
		}
	}

	private async getRepoStatus(): Promise<{
		repoId: string;
		repoOwner: string;
		repoName: string;
		indexStatus: string;
	}> {
		const state = await this.getState();
		return {
			repoId: state.repoId,
			repoOwner: state.repoOwner,
			repoName: state.repoName,
			indexStatus: state.indexStatus,
		};
	}

	private async getRepoStatusResponse(): Promise<Response> {
		const status = await this.getRepoStatus();
		return new Response(JSON.stringify(status), {
			headers: { "Content-Type": "application/json" },
		});
	}

	private async getHistory(limit?: number): Promise<Array<{ role: string; content: string }>> {
		const messages = await this.getMessages();
		return messages.slice(-(limit ?? 50)).map((m) => ({
			role: m.role,
			content: m.content,
		}));
	}

	private async getHistoryResponse(): Promise<Response> {
		const history = await this.getHistory();
		return new Response(JSON.stringify(history), {
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

	private buildSystemPrompt(chunks: VectorizeMatch[], state: RepoMindState): string {
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
You have access to the following code chunks from the repository ${state.repoOwner}/${state.repoName}:

${context}

Answer the user's question based on the provided code. If you need to see more of a file, use the readFile tool.
Always cite your sources with file paths and line numbers in your response.
Be concise and technical. If the code doesn't contain the answer, say so clearly.`;
	}
}
