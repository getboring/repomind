import type { VectorizeIndex, VectorizeQueryOptions } from "@cloudflare/workers-types";
import type { CodeChunk, VectorizeMatch } from "../types";
import { withRetry } from "./logging";

export async function upsertChunks(
	vectorize: VectorizeIndex,
	chunks: CodeChunk[],
	embeddings: number[][]
): Promise<void> {
	if (chunks.length !== embeddings.length) {
		throw new Error("Chunk and embedding count mismatch");
	}

	// Group chunks by repoId for namespace isolation
	const chunksByRepo = new Map<string, { chunk: CodeChunk; embedding: number[] }[]>();
	for (let i = 0; i < chunks.length; i++) {
		const repoId = chunks[i].repoId;
		if (!chunksByRepo.has(repoId)) {
			chunksByRepo.set(repoId, []);
		}
		chunksByRepo.get(repoId)!.push({ chunk: chunks[i], embedding: embeddings[i] });
	}

	// Upsert each repo's chunks into its own namespace
	for (const [repoId, repoChunks] of chunksByRepo) {
		const vectors = repoChunks.map(({ chunk, embedding }) => ({
			id: `${chunk.repoId}-${chunk.id}`,
			namespace: repoId,
			values: embedding,
			metadata: {
				repoId: chunk.repoId,
				filePath: chunk.filePath,
				lineStart: chunk.lineStart,
				lineEnd: chunk.lineEnd,
				content: chunk.content.slice(0, 1000),
				chunkType: chunk.chunkType,
			},
		}));

		// Vectorize has a batch limit, process in chunks
		const batchSize = 100;
		for (let i = 0; i < vectors.length; i += batchSize) {
			const batch = vectors.slice(i, i + batchSize);
			await withRetry(() => vectorize.upsert(batch), {
				context: { operation: "vectorize.upsert", batchSize: batch.length, namespace: repoId },
			});
		}
	}
}

export async function deleteRepoChunks(vectorize: VectorizeIndex, repoId: string): Promise<void> {
	// Delete all vectors in the repo's namespace by querying and deleting
	const dummyEmbedding = new Array(384).fill(0);
	const results = await withRetry(
		() =>
			vectorize.query(dummyEmbedding, {
				topK: 1000,
				namespace: repoId,
				returnMetadata: false,
				returnValues: false,
			} as VectorizeQueryOptions),
		{ context: { operation: "vectorize.query", repoId, namespace: repoId } }
	);

	if (results.matches.length > 0) {
		const ids = results.matches.map((m) => m.id);
		await withRetry(() => vectorize.deleteByIds(ids), {
			context: { operation: "vectorize.deleteByIds", count: ids.length, namespace: repoId },
		});
	}
}

export async function searchChunks(
	vectorize: VectorizeIndex,
	repoId: string,
	queryEmbedding: number[],
	topK = 5
): Promise<VectorizeMatch[]> {
	const results = await withRetry(
		() =>
			vectorize.query(queryEmbedding, {
				topK,
				namespace: repoId,
				returnMetadata: true,
				returnValues: false,
			} as VectorizeQueryOptions),
		{ context: { operation: "vectorize.searchChunks", repoId, topK, namespace: repoId } }
	);

	return results.matches.map((m) => ({
		id: m.id,
		score: m.score,
		metadata: {
			repoId: m.metadata?.repoId as string,
			filePath: m.metadata?.filePath as string,
			lineStart: m.metadata?.lineStart as number,
			lineEnd: m.metadata?.lineEnd as number,
			content: m.metadata?.content as string,
			chunkType: m.metadata?.chunkType as string,
		},
	}));
}
