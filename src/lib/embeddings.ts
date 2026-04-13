import type { Ai } from "@cloudflare/workers-types";

export async function embedText(ai: Ai, text: string): Promise<number[]> {
	const result = await ai.run("@cf/baai/bge-small-en-v1.5", {
		text: [text],
	});

	if (!Array.isArray(result.data) || result.data.length === 0) {
		throw new Error("Embedding returned empty data");
	}

	return result.data[0] as number[];
}

export async function embedTexts(ai: Ai, texts: string[]): Promise<number[][]> {
	if (texts.length === 0) return [];

	const result = await ai.run("@cf/baai/bge-small-en-v1.5", {
		text: texts,
	});

	if (!Array.isArray(result.data)) {
		throw new Error("Embedding returned invalid data");
	}

	return result.data as number[][];
}
