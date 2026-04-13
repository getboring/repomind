import type { VectorizeIndex } from "@cloudflare/workers-types";
import type { CodeChunk, VectorizeMatch } from "../types";

const INDEX_NAME = "repomind-chunks";

export async function upsertChunks(
	vectorize: VectorizeIndex,
	chunks: CodeChunk[],
	embeddings: number[][]
): Promise<void> {
	if (chunks.length !== embeddings.length) {
		throw new Error("Chunk and embedding count mismatch");
	}

	const vectors = chunks.map((chunk, i) => ({
		id: `${chunk.repoId}-${chunk.id}`,
		values: embeddings[i],
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
		await vectorize.upsert(INDEX_NAME, batch);
	}
}

export async function deleteRepoChunks(
	vectorize: VectorizeIndex,
	repoId: string
): Promise<void> {
	// Vectorize doesn't support delete by filter directly in all cases
	// We query all vectors for the repo and delete by ID
	// In production, you'd use metadata filtering if available
	const dummyEmbedding = new Array(384).fill(0);
	const results = await vectorize.query(INDEX_NAME, {
		vector: dummyEmbedding,
		topK: 1000,
		filter: { repoId },
		returnMetadata: false,
		returnVectors: false,
	});

	if (results.matches.length > 0) {
		const ids = results.matches.map((m) => m.id);
		await vectorize.deleteByIds(INDEX_NAME, ids);
	}
}

export async function searchChunks(
	vectorize: VectorizeIndex,
	repoId: string,
	queryEmbedding: number[],
	topK = 5
): Promise<VectorizeMatch[]> {
	const results = await vectorize.query(INDEX_NAME, {
		vector: queryEmbedding,
		topK,
		filter: { repoId },
		returnMetadata: true,
		returnVectors: false,
	});

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
