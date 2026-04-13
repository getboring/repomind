import { AIChatAgent } from "@cloudflare/ai-chat";
import { callable } from "agents";
import { createWorkersAI } from "workers-ai-provider";
import { streamText, convertToModelMessages, tool } from "ai";
import { z } from "zod";
import type { Env, RepoRecord, VectorizeMatch, RagSource } from "../types";
import { RepoRepository, QueryRepository } from "../db/repositories";
import { searchChunks } from "../lib/vectorize";
import { embedText } from "../lib/embeddings";

interface RepoMindState {
	repoId: string;
	repoOwner: string;
	repoName: string;
	lastCommit: string | null;
	indexStatus: RepoRecord["indexStatus"];
	initialized: boolean;
}

export class RepoMindAgent extends AIChatAgent<Env, RepoMindState> {
	initialState: RepoMindState = {
		repoId: "",
		repoOwner: "",
		repoName: "",
		lastCommit: null,
		indexStatus: "pending",
		initialized: false,
	};

	maxPersistedMessages = 200;

	validateStateChange(
		nextState: RepoMindState,
		source: import("agents").Connection | "server"
	) {
		if (source !== "server") {
			if (nextState.repoId !== this.state.repoId) {
				throw new Error("Cannot modify repoId");
			}
			if (nextState.repoOwner !== this.state.repoOwner) {
				throw new Error("Cannot modify repoOwner");
			}
			if (nextState.repoName !== this.state.repoName) {
				throw new Error("Cannot modify repoName");
			}
		}
	}

	async onStart() {
		const parsed = this.parseInstanceName(this.name);

		if (!this.state.initialized) {
			this.setState({
				repoId: parsed.repoId,
				repoOwner: parsed.owner,
				repoName: parsed.name,
				lastCommit: null,
				indexStatus: "pending",
				initialized: true,
			});
		}
	}

	async onChatMessage(onFinish) {
		// Check current index status from database
		const repoRepo = new RepoRepository(this.env.DB);
		const repo = await repoRepo.getRepoByOwnerAndName(
			this.state.repoOwner,
			this.state.repoName
		);
		const currentStatus = repo?.indexStatus ?? this.state.indexStatus;

		if (currentStatus !== "complete") {
			const model = createWorkersAI({ binding: this.env.AI })(
				"@cf/meta/llama-3.3-70b-instruct-fp8-fast"
			);

			const result = streamText({
				model,
				system:
					`You are RepoMind, a codebase intelligence assistant. The repository ${this.state.repoOwner}/${this.state.repoName} is still being indexed (status: ${currentStatus}). Explain that you need a few moments and suggest the user try again shortly.`,
				messages: await convertToModelMessages(this.messages),
				onFinish,
			});

			return result.toUIMessageStreamResponse();
		}

		const lastMessage = this.messages[this.messages.length - 1];
		if (lastMessage?.role !== "user") {
			throw new Error("Expected user message");
		}

		const queryRepo = new QueryRepository(this.env.DB);
		const queryRecord = await queryRepo.createQuery(
			this.state.repoId,
			this.name,
			lastMessage.content
		);

		const startTime = Date.now();

		// 1. Embed query
		const queryEmbedding = await embedText(this.env.AI, lastMessage.content);

		// 2. Search Vectorize
		const relevantChunks = await searchChunks(
			this.env.VECTORIZE,
			this.state.repoId,
			queryEmbedding,
			5
		);

		// 3. Stream response with RAG context
		const model = createWorkersAI({
			binding: this.env.AI,
			gateway: { id: this.env.AI_GATEWAY.id },
		})("@cf/meta/llama-3.3-70b-instruct-fp8-fast");

		const systemPrompt = this.buildSystemPrompt(relevantChunks);

		const result = streamText({
			model,
			system: systemPrompt,
			messages: await convertToModelMessages(this.messages),
			tools: {
				readFile: tool({
					description: "Read the full content of a file from the repository",
					inputSchema: z.object({
						path: z.string().describe("File path relative to repo root"),
					}),
					execute: async ({ path }) => this.fetchFileContent(path),
				}),
			},
			onFinish: async (event) => {
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
					event.response,
					JSON.stringify(sources),
					event.usage?.totalTokens ?? 0,
					latencyMs
				);

				if (onFinish) {
					await onFinish(event);
				}
			},
		});

		return result.toUIMessageStreamResponse();
	}

	@callable({ description: "Get repository indexing status" })
	async getRepoStatus(): Promise<{
		repoId: string;
		repoOwner: string;
		repoName: string;
		indexStatus: string;
	}> {
		return {
			repoId: this.state.repoId,
			repoOwner: this.state.repoOwner,
			repoName: this.state.repoName,
			indexStatus: this.state.indexStatus,
		};
	}

	@callable({ description: "Get chat history for this session" })
	async getHistory(limit?: number): Promise<
		Array<{ role: string; content: string }>
	> {
		return this.messages.slice(-(limit ?? 50)).map((m) => ({
			role: m.role,
			content:
				typeof m.content === "string"
					? m.content
					: JSON.stringify(m.content),
		}));
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

	private async fetchFileContent(path: string): Promise<string | null> {
		// In a real implementation, this would fetch from GitHub API
		// For now, return a placeholder
		return `File content for ${path} not available in this demo.`;
	}
}
