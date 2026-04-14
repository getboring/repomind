import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteRepoChunks, searchChunks, upsertChunks } from "../src/lib/vectorize";
import type { CodeChunk } from "../types";

describe("vectorize", () => {
	let mockVectorize: {
		upsert: ReturnType<typeof vi.fn>;
		query: ReturnType<typeof vi.fn>;
		deleteByIds: ReturnType<typeof vi.fn>;
	};

	beforeEach(() => {
		mockVectorize = {
			upsert: vi.fn().mockResolvedValue(undefined),
			query: vi.fn().mockResolvedValue({ matches: [] }),
			deleteByIds: vi.fn().mockResolvedValue(undefined),
		};
	});

	it("should upsert chunks with embeddings and namespace", async () => {
		const chunks: CodeChunk[] = [
			{
				id: "test.ts-0",
				repoId: "repo-test",
				filePath: "test.ts",
				lineStart: 1,
				lineEnd: 5,
				content: "function test() {}",
				chunkType: "function",
			},
		];
		const embeddings = [[0.1, 0.2, 0.3]];

		await upsertChunks(mockVectorize as unknown as VectorizeIndex, chunks, embeddings);

		expect(mockVectorize.upsert).toHaveBeenCalledWith(
			expect.arrayContaining([
				expect.objectContaining({
					id: "repo-test-test.ts-0",
					namespace: "repo-test",
					values: [0.1, 0.2, 0.3],
					metadata: expect.objectContaining({
						repoId: "repo-test",
						filePath: "test.ts",
					}),
				}),
			])
		);
	});

	it("should throw on chunk/embedding mismatch", async () => {
		const chunks: CodeChunk[] = [{ repoId: "test" } as CodeChunk];
		const embeddings: number[][] = [];

		await expect(
			upsertChunks(mockVectorize as unknown as VectorizeIndex, chunks, embeddings)
		).rejects.toThrow("Chunk and embedding count mismatch");
	});

	it("should batch large upserts", async () => {
		const chunks: CodeChunk[] = Array.from({ length: 250 }, (_, i) => ({
			id: `test-${i}`,
			repoId: "repo-test",
			filePath: "test.ts",
			lineStart: i,
			lineEnd: i + 1,
			content: `function test${i}() {}`,
			chunkType: "function",
		}));
		const embeddings = Array.from({ length: 250 }, () => [0.1, 0.2, 0.3]);

		await upsertChunks(mockVectorize as unknown as VectorizeIndex, chunks, embeddings);

		expect(mockVectorize.upsert).toHaveBeenCalledTimes(3);
	});

	it("should search chunks in namespace", async () => {
		mockVectorize.query.mockResolvedValueOnce({
			matches: [
				{
					id: "repo-test-test.ts-0",
					score: 0.95,
					metadata: {
						repoId: "repo-test",
						filePath: "test.ts",
						lineStart: 1,
						lineEnd: 5,
						content: "function test() {}",
						chunkType: "function",
					},
				},
			],
		});

		const results = await searchChunks(
			mockVectorize as unknown as VectorizeIndex,
			"repo-test",
			[0.1, 0.2, 0.3],
			5
		);

		expect(results.length).toBe(1);
		expect(results[0].score).toBe(0.95);
		expect(results[0].metadata.filePath).toBe("test.ts");
		expect(mockVectorize.query).toHaveBeenCalledWith(
			[0.1, 0.2, 0.3],
			expect.objectContaining({
				topK: 5,
				namespace: "repo-test",
				returnMetadata: true,
				returnValues: false,
			})
		);
	});

	it("should delete repo chunks by querying and deleting IDs in namespace", async () => {
		mockVectorize.query.mockResolvedValueOnce({
			matches: [{ id: "chunk-1" }, { id: "chunk-2" }],
		});

		await deleteRepoChunks(mockVectorize as unknown as VectorizeIndex, "repo-test");

		expect(mockVectorize.query).toHaveBeenCalledWith(
			expect.any(Array),
			expect.objectContaining({
				topK: 1000,
				namespace: "repo-test",
				returnMetadata: false,
				returnValues: false,
			})
		);
		expect(mockVectorize.deleteByIds).toHaveBeenCalledWith(["chunk-1", "chunk-2"]);
	});

	it("should not delete if no matches found", async () => {
		mockVectorize.query.mockResolvedValueOnce({ matches: [] });

		await deleteRepoChunks(mockVectorize as unknown as VectorizeIndex, "repo-test");

		expect(mockVectorize.deleteByIds).not.toHaveBeenCalled();
	});
});
