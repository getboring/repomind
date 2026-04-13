import type { Ai } from "@cloudflare/workers-types";
import { withRetry } from "./logging";

export async function embedText(ai: Ai, text: string): Promise<number[]> {
	const result = (await withRetry(
		() =>
			ai.run("@cf/baai/bge-small-en-v1.5", {
				text: [text],
			}),
		{ context: { operation: "embedText" } }
	)) as { data?: number[][] };

	if (!Array.isArray(result.data) || result.data.length === 0) {
		throw new Error("Embedding returned empty data");
	}

	return result.data[0];
}

export async function embedTexts(ai: Ai, texts: string[]): Promise<number[][]> {
	if (texts.length === 0) return [];

	const result = (await withRetry(
		() =>
			ai.run("@cf/baai/bge-small-en-v1.5", {
				text: texts,
			}),
		{ context: { operation: "embedTexts", count: texts.length } }
	)) as { data?: number[][] };

	if (!Array.isArray(result.data)) {
		throw new Error("Embedding returned invalid data");
	}

	return result.data;
}
