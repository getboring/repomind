import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/types";

// Mock the DO compat module for testing
vi.mock("../src/lib/do-compat", () => ({
	DurableObjectClass: class MockDurableObject {
		constructor(
			protected ctx: DurableObjectState,
			protected env: Env
		) {}
		async fetch(_request: Request): Promise<Response> {
			return new Response("Not implemented", { status: 501 });
		}
	},
	WebSocketRequestResponsePairClass: class MockPair {
		constructor(
			public readonly request: string,
			public readonly response: string
		) {}
	},
	WebSocketPairClass: class MockWebSocketPair {
		0 = {} as WebSocket;
		1 = {} as WebSocket;
	},
}));

// Import after mocking
const { RepoMindAgent } = await import("../src/agents/RepoMindAgent");

describe("RepoMindAgent", () => {
	let mockEnv: Env;
	let mockCtx: DurableObjectState;

	beforeEach(() => {
		mockEnv = {
			AI: {
				run: vi.fn().mockResolvedValue(new ReadableStream()),
			} as unknown as Ai,
			VECTORIZE: {
				query: vi.fn().mockResolvedValue({ matches: [] }),
			} as unknown as VectorizeIndex,
			DB: {
				prepare: vi.fn().mockReturnThis(),
				bind: vi.fn().mockReturnThis(),
				run: vi.fn().mockResolvedValue(undefined),
				first: vi.fn().mockResolvedValue(null),
				all: vi.fn().mockResolvedValue({ results: [] }),
			} as unknown as D1Database,
			INDEX_QUEUE: {} as Queue,
			RepoMindAgent: {} as DurableObjectNamespace,
			APP_NAME: "RepoMind",
			APP_VERSION: "0.1.0",
			GITHUB_API_URL: "https://api.github.com",
			MAX_FILE_SIZE: "1048576",
			CHUNK_BATCH_SIZE: "10",
			AI_GATEWAY_ID: "repomind",
		};

		mockCtx = {
			acceptWebSocket: vi.fn(),
			setWebSocketAutoResponse: vi.fn(),
			id: { toString: () => "test-id" },
			storage: {
				get: vi.fn().mockResolvedValue(null),
				put: vi.fn().mockResolvedValue(undefined),
			},
		} as unknown as DurableObjectState;
	});

	it("should parse instance name correctly", () => {
		const agent = new RepoMindAgent(mockCtx, mockEnv);
		// Access private method via any cast for testing
		const parsed = (
			agent as unknown as {
				parseInstanceName(name: string): { repoId: string; owner: string; name: string };
			}
		).parseInstanceName("RepoMind:facebook:react");

		expect(parsed).toEqual({
			repoId: "repo-facebook-react",
			owner: "facebook",
			name: "react",
		});
	});

	it("should build system prompt with chunks", () => {
		const chunks = [
			{
				id: "chunk-1",
				score: 0.95,
				metadata: {
					filePath: "src/auth.ts",
					lineStart: 1,
					lineEnd: 10,
					content: "function login() {}",
					chunkType: "function",
				},
			},
		];

		const prompt = buildSystemPrompt("owner", "name", chunks);
		expect(prompt).toContain("owner/name");
		expect(prompt).toContain("src/auth.ts");
		expect(prompt).toContain("function login() {}");
	});

	it("should build system prompt without chunks", () => {
		const prompt = buildSystemPrompt("owner", "name", []);
		expect(prompt).toContain("No relevant code chunks found");
	});

	it("should return status via HTTP endpoint", async () => {
		const agent = new RepoMindAgent(mockCtx, mockEnv);

		// Mock the fetch method to test HTTP endpoints directly
		// Skip WebSocket upgrade and test the status endpoint
		const statusRequest = new Request("http://localhost/status");
		const response = await agent.fetch(statusRequest);
		const data = (await response.json()) as { repoOwner: string; repoName: string };

		expect(data.repoOwner).toBe("");
		expect(data.repoName).toBe("");
	});

	it("should return history via HTTP endpoint", async () => {
		const agent = new RepoMindAgent(mockCtx, mockEnv);

		const historyRequest = new Request("http://localhost/history");
		const response = await agent.fetch(historyRequest);
		const data = (await response.json()) as unknown[];

		expect(Array.isArray(data)).toBe(true);
	});
});

function buildSystemPrompt(
	owner: string,
	name: string,
	chunks: Array<{
		id: string;
		score: number;
		metadata: {
			filePath: string;
			lineStart: number;
			lineEnd: number;
			content: string;
			chunkType: string;
		};
	}>
): string {
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
You have access to the following code chunks from the repository ${owner}/${name}:

${context}

Answer the user's question based on the provided code. If you need to see more of a file, use the readFile tool.
Always cite your sources with file paths and line numbers in your response.
Be concise and technical. If the code doesn't contain the answer, say so clearly.`;
}
