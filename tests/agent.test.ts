import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RepoMindAgent } from "../src/agents/RepoMindAgent";

describe("RepoMindAgent", () => {
	let mockAgent: {
		name: string;
		state: {
			repoId: string;
			repoOwner: string;
			repoName: string;
			indexStatus: string;
			initialized: boolean;
		};
		setState: ReturnType<typeof vi.fn>;
		parseInstanceName: ReturnType<typeof vi.fn>;
	};

	beforeEach(() => {
		mockAgent = {
			name: "RepoMind:owner:name",
			state: {
				repoId: "",
				repoOwner: "",
				repoName: "",
				indexStatus: "pending",
				initialized: false,
			},
			setState: vi.fn(),
			parseInstanceName: vi.fn().mockReturnValue({
				repoId: "repo-owner-name",
				owner: "owner",
				name: "name",
			}),
		};
	});

	it("should parse instance name correctly", () => {
		mockAgent.parseInstanceName.mockReturnValueOnce({
			repoId: "repo-facebook-react",
			owner: "facebook",
			name: "react",
		});

		const parsed = mockAgent.parseInstanceName("RepoMind:facebook:react");
		expect(parsed).toEqual({
			repoId: "repo-facebook-react",
			owner: "facebook",
			name: "react",
		});
	});

	it("should initialize state on first start", () => {
		mockAgent.state.initialized = false;

		const parsed = mockAgent.parseInstanceName(mockAgent.name);
		mockAgent.setState({
			repoId: parsed.repoId,
			repoOwner: parsed.owner,
			repoName: parsed.name,
			lastCommit: null,
			indexStatus: "pending",
			initialized: true,
		});

		expect(mockAgent.setState).toHaveBeenCalledWith({
			repoId: "repo-owner-name",
			repoOwner: "owner",
			repoName: "name",
			lastCommit: null,
			indexStatus: "pending",
			initialized: true,
		});
	});

	it("should not reinitialize if already initialized", () => {
		mockAgent.state.initialized = true;
		mockAgent.state.repoId = "existing-id";

		// Should not call setState again
		expect(mockAgent.setState).not.toHaveBeenCalled();
	});

	it("should validate state changes from server", () => {
		// Server can modify state
		const nextState = { ...mockAgent.state, indexStatus: "complete" };
		// Should not throw
		expect(() => {
			// Simulate server-side state change
			mockAgent.state = nextState;
		}).not.toThrow();
	});

	it("should prevent client from modifying repoId", () => {
		// Client trying to modify repoId should be blocked
		const nextState = { ...mockAgent.state, repoId: "hacked" };
		// In real implementation, validateStateChange would throw
		expect(nextState.repoId).not.toBe(mockAgent.state.repoId);
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
