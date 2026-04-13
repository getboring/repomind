import type { D1Database } from "@cloudflare/workers-types";
import type { RepoRecord, IndexingJobRecord, QueryRecord } from "../types";

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
			.first<RepoRecord>();

		return result ?? null;
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
			.all<RepoRecord>();

		return results ?? [];
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
			.first<IndexingJobRecord>();

		return result ?? null;
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
			.all<IndexingJobRecord>();

		return results ?? [];
	}
}

export class QueryRepository {
	constructor(private db: D1Database) {}

	async createQuery(
		repoId: string,
		sessionId: string,
		queryText: string
	): Promise<QueryRecord> {
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
			.first<QueryRecord>();

		return result ?? null;
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
			.all<QueryRecord>();

		return results ?? [];
	}
}
