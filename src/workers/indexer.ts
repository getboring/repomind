import { IndexingJobRepository, RepoRepository } from "../db/repositories";
import { chunkCode } from "../lib/chunker";
import { embedTexts } from "../lib/embeddings";
import { GitHubClient } from "../lib/github";
import { upsertChunks } from "../lib/vectorize";
import type { Env, IndexingJob } from "../types";

const MAX_FILE_SIZE = 1_048_576; // 1MB
const CHUNK_BATCH_SIZE = 10;

export default {
	async queue(batch: MessageBatch<IndexingJob>, env: Env): Promise<void> {
		const github = new GitHubClient(env.GITHUB_TOKEN);
		const repoRepo = new RepoRepository(env.DB);
		const jobRepo = new IndexingJobRepository(env.DB);

		for (const message of batch.messages) {
			const { repoId, owner, name, commitSha, jobId } = message.body;

			try {
				await jobRepo.updateJobStatus(jobId, "processing", {});
				await repoRepo.updateRepoStatus(repoId, "indexing", {});

				// Fetch file tree
				const files = await github.getFileTree(owner, name, commitSha);
				const codeFiles = files.filter((f) => f.size <= MAX_FILE_SIZE && f.downloadUrl);

				let totalChunks = 0;

				// Process files in batches
				for (let i = 0; i < codeFiles.length; i += CHUNK_BATCH_SIZE) {
					const batchFiles = codeFiles.slice(i, i + CHUNK_BATCH_SIZE);

					await Promise.all(
						batchFiles.map(async (file) => {
							try {
								const content = await github.getFileContent(file.downloadUrl);
								const chunks = chunkCode(content, file.path);

								if (chunks.length === 0) return;

								// Set repoId on chunks
								for (const chunk of chunks) {
									chunk.repoId = repoId;
								}

								// Embed in batches
								const texts = chunks.map((c) => c.content);
								const embeddings = await embedTexts(env.AI, texts);

								await upsertChunks(env.VECTORIZE, chunks, embeddings);

								totalChunks += chunks.length;
							} catch (error) {
								console.error(`Failed to process ${file.path}:`, error);
							}
						})
					);

					await jobRepo.updateJobStatus(jobId, "processing", {
						filesProcessed: Math.min(i + CHUNK_BATCH_SIZE, codeFiles.length),
						chunksCreated: totalChunks,
					});
				}

				// Mark complete
				await repoRepo.updateRepoStatus(repoId, "complete", {
					lastCommitSha: commitSha,
					lastIndexedAt: Math.floor(Date.now() / 1000),
					fileCount: codeFiles.length,
					chunkCount: totalChunks,
					errorMessage: null,
				});

				await jobRepo.updateJobStatus(jobId, "complete", {
					filesProcessed: codeFiles.length,
					chunksCreated: totalChunks,
				});

				message.ack();
			} catch (error) {
				console.error(`Indexing failed for ${repoId}:`, error);

				const errorMessage = error instanceof Error ? error.message : String(error);

				await repoRepo.updateRepoStatus(repoId, "error", {
					errorMessage,
				});

				await jobRepo.updateJobStatus(jobId, "error", {
					errorMessage,
				});

				message.retry();
			}
		}
	},
};
