import { beforeEach, describe, expect, it, vi } from "vitest";
import { embedText, embedTexts } from "../src/lib/embeddings";

describe("embeddings", () => {
	let mockAi: {
		run: ReturnType<typeof vi.fn>;
	};

	beforeEach(() => {
		mockAi = {
			run: vi.fn(),
		};
	});

	it("should embed single text", async () => {
		mockAi.run.mockResolvedValueOnce({
			data: [[0.1, 0.2, 0.3]],
		});

		const embedding = await embedText(mockAi as unknown as Ai, "hello world");

		expect(embedding).toEqual([0.1, 0.2, 0.3]);
		expect(mockAi.run).toHaveBeenCalledWith("@cf/baai/bge-small-en-v1.5", {
			text: ["hello world"],
		});
	});

	it("should embed multiple texts", async () => {
		mockAi.run.mockResolvedValueOnce({
			data: [
				[0.1, 0.2],
				[0.3, 0.4],
			],
		});

		const embeddings = await embedTexts(mockAi as unknown as Ai, ["a", "b"]);

		expect(embeddings).toEqual([
			[0.1, 0.2],
			[0.3, 0.4],
		]);
	});

	it("should return empty array for empty texts", async () => {
		const embeddings = await embedTexts(mockAi as unknown as Ai, []);
		expect(embeddings).toEqual([]);
		expect(mockAi.run).not.toHaveBeenCalled();
	});

	it("should throw on empty embedding data", async () => {
		mockAi.run.mockResolvedValueOnce({ data: [] });

		await expect(embedText(mockAi as unknown as Ai, "hello")).rejects.toThrow(
			"Embedding returned empty data"
		);
	});

	it("should throw on invalid embedding data", async () => {
		mockAi.run.mockResolvedValueOnce({ data: "invalid" });

		await expect(embedTexts(mockAi as unknown as Ai, ["hello"])).rejects.toThrow(
			"Embedding returned invalid data"
		);
	});
});
