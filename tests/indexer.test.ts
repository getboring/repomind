import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env, IndexingJob } from "../src/types";

// We need to test the indexer queue handler
// Since it's a default export, we'll import it dynamically
describe("Indexer Worker", () => {
	let mockEnv: Env;
	let mockBatch: MessageBatch<IndexingJob>;

	beforeEach(() => {
		mockEnv = {
			AI: {
				run: vi.fn().mockResolvedValue({ data: [[0.1, 0.2, 0.3]] }),
			} as unknown as Ai,
			VECTORIZE: {
				upsert: vi.fn().mockResolvedValue(undefined),
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
			GITHUB_TOKEN: "test-token",
		};

		mockBatch = {
			messages: [
				{
					body: {
						repoId: "repo-owner-name",
						owner: "owner",
						name: "name",
						commitSha: "abc123",
						jobId: "job-123",
					},
					ack: vi.fn(),
					retry: vi.fn(),
				} as unknown as Message<IndexingJob>,
			],
		} as unknown as MessageBatch<IndexingJob>;

		(globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = vi.fn();
	});

	it("should process indexing job successfully", async () => {
		// Mock GitHub tree API
		vi.mocked(fetch)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify([
						{
							path: "src/index.ts",
							type: "file",
							size: 100,
							download_url: "https://raw.githubusercontent.com/...",
						},
					]),
					{ status: 200 }
				)
			)
			// Mock file content
			.mockResolvedValueOnce(new Response("function hello() { return 'world'; }", { status: 200 }));

		const { default: indexer } = await import("../src/index");
		await indexer.queue(mockBatch, mockEnv);

		expect(mockEnv.DB.prepare).toHaveBeenCalledWith(
			expect.stringContaining("UPDATE indexing_jobs SET")
		);
		expect(mockBatch.messages[0].ack).toHaveBeenCalled();
	});

	it("should handle GitHub API errors gracefully", async () => {
		vi.mocked(fetch).mockResolvedValueOnce(new Response("Not Found", { status: 404 }));

		const { default: indexer } = await import("../src/index");
		await indexer.queue(mockBatch, mockEnv);

		// getFileTree handles 404 by logging and continuing with empty files
		// The job completes successfully with 0 files
		expect(mockBatch.messages[0].ack).toHaveBeenCalled();
	});

	it("should skip files exceeding max size", async () => {
		vi.mocked(fetch)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify([
						{
							path: "huge-file.ts",
							type: "file",
							size: 2_000_000,
							download_url: "https://raw.githubusercontent.com/...",
						},
						{
							path: "small-file.ts",
							type: "file",
							size: 100,
							download_url: "https://raw.githubusercontent.com/...",
						},
					]),
					{ status: 200 }
				)
			)
			.mockResolvedValueOnce(new Response("const x = 1;", { status: 200 }));

		const { default: indexer } = await import("../src/index");
		await indexer.queue(mockBatch, mockEnv);

		// Should only process small-file.ts
		expect(fetch).toHaveBeenCalledTimes(2);
		const calls = vi.mocked(fetch).mock.calls;
		expect(calls[1][0]).not.toContain("huge-file.ts");
	});

	it("should handle file processing errors gracefully", async () => {
		vi.mocked(fetch)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify([
						{
							path: "bad-file.ts",
							type: "file",
							size: 100,
							download_url: "https://raw.githubusercontent.com/...",
						},
						{
							path: "good-file.ts",
							type: "file",
							size: 100,
							download_url: "https://raw.githubusercontent.com/...",
						},
					]),
					{ status: 200 }
				)
			)
			.mockRejectedValueOnce(new Error("Network error"))
			.mockResolvedValueOnce(new Response("const x = 1;", { status: 200 }));

		const { default: indexer } = await import("../src/index");
		await indexer.queue(mockBatch, mockEnv);

		// Should still complete despite one file failing
		expect(mockBatch.messages[0].ack).toHaveBeenCalled();
	});
});
