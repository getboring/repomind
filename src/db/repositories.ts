import type { D1Database } from "@cloudflare/workers-types";
import type { IndexingJobRecord, QueryRecord, RepoRecord } from "../types";

export class RepoRepository {
	constructor(private db: D1Database) {}

	async createRepo(owner: string, name: string): Promise<RepoRecord> {
		const id = `repo-${owner}-${name}`;

		await this.db
			.prepare(
				`
				INSERT INTO repos (id, owner, name)
				VALUES (?, ?, ?)
				ON CONFLICT (id) DO UPDATE SET
					index_status = 'pending',
					last_indexed_at = NULL
			`
			)
			.bind(id, owner, name)
			.run();

		const repo = await this.getRepoById(id);
		if (!repo) {
			throw new Error(`Failed to create repo ${owner}/${name}`);
		}

		return repo;
	}

	async getRepoById(id: string): Promise<RepoRecord | null> {
		const result = await this.db
			.prepare("SELECT * FROM repos WHERE id = ?")
			.bind(id)
			.first<{
				id: string;
				owner: string;
				name: string;
				default_branch: string;
				last_commit_sha: string | null;
				last_indexed_at: number | null;
				index_status: RepoRecord["indexStatus"];
				file_count: number;
				chunk_count: number;
				error_message: string | null;
				created_at: number;
			}>();

		if (!result) return null;

		return {
			id: result.id,
			owner: result.owner,
			name: result.name,
			defaultBranch: result.default_branch,
			lastCommitSha: result.last_commit_sha,
			lastIndexedAt: result.last_indexed_at,
			indexStatus: result.index_status,
			fileCount: result.file_count,
			chunkCount: result.chunk_count,
			errorMessage: result.error_message,
			createdAt: result.created_at,
		};
	}

	async getRepoByOwnerAndName(owner: string, name: string): Promise<RepoRecord | null> {
		const id = `repo-${owner}-${name}`;
		return this.getRepoById(id);
	}

	async updateRepoStatus(
		id: string,
		status: RepoRecord["indexStatus"],
		updates: Partial<Omit<RepoRecord, "id" | "owner" | "name" | "createdAt">>
	): Promise<void> {
		const fields: string[] = ["index_status = ?"];
		const values: (string | number | null)[] = [status];

		if (updates.lastCommitSha !== undefined) {
			fields.push("last_commit_sha = ?");
			values.push(updates.lastCommitSha);
		}

		if (updates.lastIndexedAt !== undefined) {
			fields.push("last_indexed_at = ?");
			values.push(updates.lastIndexedAt);
		}

		if (updates.fileCount !== undefined) {
			fields.push("file_count = ?");
			values.push(updates.fileCount);
		}

		if (updates.chunkCount !== undefined) {
			fields.push("chunk_count = ?");
			values.push(updates.chunkCount);
		}

		if (updates.errorMessage !== undefined) {
			fields.push("error_message = ?");
			values.push(updates.errorMessage);
		}

		values.push(id);

		await this.db
			.prepare(`UPDATE repos SET ${fields.join(", ")} WHERE id = ?`)
			.bind(...values)
			.run();
	}

	async listRepos(limit = 50, offset = 0): Promise<RepoRecord[]> {
		const { results } = await this.db
			.prepare("SELECT * FROM repos ORDER BY created_at DESC LIMIT ? OFFSET ?")
			.bind(limit, offset)
			.all<{
				id: string;
				owner: string;
				name: string;
				default_branch: string;
				last_commit_sha: string | null;
				last_indexed_at: number | null;
				index_status: RepoRecord["indexStatus"];
				file_count: number;
				chunk_count: number;
				error_message: string | null;
				created_at: number;
			}>();

		return (results ?? []).map((r) => ({
			id: r.id,
			owner: r.owner,
			name: r.name,
			defaultBranch: r.default_branch,
			lastCommitSha: r.last_commit_sha,
			lastIndexedAt: r.last_indexed_at,
			indexStatus: r.index_status,
			fileCount: r.file_count,
			chunkCount: r.chunk_count,
			errorMessage: r.error_message,
			createdAt: r.created_at,
		}));
	}

	async deleteRepo(id: string): Promise<void> {
		await this.db.prepare("DELETE FROM repos WHERE id = ?").bind(id).run();
	}
}

export class IndexingJobRepository {
	constructor(private db: D1Database) {}

	async createJob(repoId: string, commitSha: string): Promise<IndexingJobRecord> {
		const id = `job-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

		await this.db
			.prepare(
				`
				INSERT INTO indexing_jobs (id, repo_id, commit_sha)
				VALUES (?, ?, ?)
			`
			)
			.bind(id, repoId, commitSha)
			.run();

		const job = await this.getJobById(id);
		if (!job) {
			throw new Error("Failed to create indexing job");
		}

		return job;
	}

	async getJobById(id: string): Promise<IndexingJobRecord | null> {
		const result = await this.db
			.prepare("SELECT * FROM indexing_jobs WHERE id = ?")
			.bind(id)
			.first<{
				id: string;
				repo_id: string;
				commit_sha: string;
				status: IndexingJobRecord["status"];
				queued_at: number;
				started_at: number | null;
				completed_at: number | null;
				files_processed: number;
				chunks_created: number;
				error_message: string | null;
			}>();

		if (!result) return null;

		return {
			id: result.id,
			repoId: result.repo_id,
			commitSha: result.commit_sha,
			status: result.status,
			queuedAt: result.queued_at,
			startedAt: result.started_at,
			completedAt: result.completed_at,
			filesProcessed: result.files_processed,
			chunksCreated: result.chunks_created,
			errorMessage: result.error_message,
		};
	}

	async updateJobStatus(
		id: string,
		status: IndexingJobRecord["status"],
		updates: Partial<Pick<IndexingJobRecord, "filesProcessed" | "chunksCreated" | "errorMessage">>
	): Promise<void> {
		const fields: string[] = ["status = ?"];
		const values: (string | number | null)[] = [status];

		if (status === "processing") {
			fields.push("started_at = unixepoch()");
		}

		if (status === "complete" || status === "error") {
			fields.push("completed_at = unixepoch()");
		}

		if (updates.filesProcessed !== undefined) {
			fields.push("files_processed = ?");
			values.push(updates.filesProcessed);
		}

		if (updates.chunksCreated !== undefined) {
			fields.push("chunks_created = ?");
			values.push(updates.chunksCreated);
		}

		if (updates.errorMessage !== undefined) {
			fields.push("error_message = ?");
			values.push(updates.errorMessage);
		}

		values.push(id);

		await this.db
			.prepare(`UPDATE indexing_jobs SET ${fields.join(", ")} WHERE id = ?`)
			.bind(...values)
			.run();
	}

	async getJobsForRepo(repoId: string, limit = 10): Promise<IndexingJobRecord[]> {
		const { results } = await this.db
			.prepare(
				`
				SELECT * FROM indexing_jobs
				WHERE repo_id = ?
				ORDER BY queued_at DESC
				LIMIT ?
			`
			)
			.bind(repoId, limit)
			.all<{
				id: string;
				repo_id: string;
				commit_sha: string;
				status: IndexingJobRecord["status"];
				queued_at: number;
				started_at: number | null;
				completed_at: number | null;
				files_processed: number;
				chunks_created: number;
				error_message: string | null;
			}>();

		return (results ?? []).map((r) => ({
			id: r.id,
			repoId: r.repo_id,
			commitSha: r.commit_sha,
			status: r.status,
			queuedAt: r.queued_at,
			startedAt: r.started_at,
			completedAt: r.completed_at,
			filesProcessed: r.files_processed,
			chunksCreated: r.chunks_created,
			errorMessage: r.error_message,
		}));
	}
}

export class QueryRepository {
	constructor(private db: D1Database) {}

	async createQuery(repoId: string, sessionId: string, queryText: string): Promise<QueryRecord> {
		const id = `query-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

		await this.db
			.prepare(
				`
				INSERT INTO queries (id, repo_id, session_id, query_text)
				VALUES (?, ?, ?, ?)
			`
			)
			.bind(id, repoId, sessionId, queryText)
			.run();

		const query = await this.getQueryById(id);
		if (!query) {
			throw new Error("Failed to create query");
		}

		return query;
	}

	async getQueryById(id: string): Promise<QueryRecord | null> {
		const result = await this.db
			.prepare("SELECT * FROM queries WHERE id = ?")
			.bind(id)
			.first<{
				id: string;
				repo_id: string;
				session_id: string;
				query_text: string;
				response_text: string | null;
				sources: string | null;
				tokens_used: number | null;
				latency_ms: number | null;
				created_at: number;
			}>();

		if (!result) return null;

		return {
			id: result.id,
			repoId: result.repo_id,
			sessionId: result.session_id,
			queryText: result.query_text,
			responseText: result.response_text,
			sources: result.sources,
			tokensUsed: result.tokens_used,
			latencyMs: result.latency_ms,
			createdAt: result.created_at,
		};
	}

	async updateQueryResponse(
		id: string,
		responseText: string,
		sources: string,
		tokensUsed: number,
		latencyMs: number
	): Promise<void> {
		await this.db
			.prepare(
				`
				UPDATE queries
				SET response_text = ?, sources = ?, tokens_used = ?, latency_ms = ?
				WHERE id = ?
			`
			)
			.bind(responseText, sources, tokensUsed, latencyMs, id)
			.run();
	}

	async getQueriesForSession(sessionId: string, limit = 50): Promise<QueryRecord[]> {
		const { results } = await this.db
			.prepare(
				`
				SELECT * FROM queries
				WHERE session_id = ?
				ORDER BY created_at DESC
				LIMIT ?
			`
			)
			.bind(sessionId, limit)
			.all<{
				id: string;
				repo_id: string;
				session_id: string;
				query_text: string;
				response_text: string | null;
				sources: string | null;
				tokens_used: number | null;
				latency_ms: number | null;
				created_at: number;
			}>();

		return (results ?? []).map((r) => ({
			id: r.id,
			repoId: r.repo_id,
			sessionId: r.session_id,
			queryText: r.query_text,
			responseText: r.response_text,
			sources: r.sources,
			tokensUsed: r.tokens_used,
			latencyMs: r.latency_ms,
			createdAt: r.created_at,
		}));
	}
}
