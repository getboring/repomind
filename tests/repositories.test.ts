import { describe, it, expect, vi, beforeEach } from "vitest";
import { RepoRepository, IndexingJobRepository, QueryRepository } from "../src/db/repositories";

// Helper to create a chainable D1 mock
function createMockDb(firstResults: (null | Record<string, unknown>)[] = []) {
	let firstCallCount = 0;

	const mockFirst = vi.fn().mockImplementation(() => {
		const result = firstResults[firstCallCount] ?? null;
		firstCallCount++;
		return Promise.resolve(result);
	});

	const mockAll = vi.fn().mockResolvedValue({ results: [] });
	const mockRun = vi.fn().mockResolvedValue(undefined);

	// This object is returned by both prepare() and bind() to maintain the chain
	const chainable = {
		bind: vi.fn().mockReturnThis(),
		first: mockFirst,
		all: mockAll,
		run: mockRun,
	};

	const mockPrepare = vi.fn().mockReturnValue(chainable);

	return {
		prepare: mockPrepare,
		first: mockFirst,
		all: mockAll,
		run: mockRun,
		setFirstResults: (results: (null | Record<string, unknown>)[]) => {
			firstCallCount = 0;
			firstResults.length = 0;
			firstResults.push(...results);
		},
	} as unknown as D1Database & {
		first: ReturnType<typeof vi.fn>;
		all: ReturnType<typeof vi.fn>;
		setFirstResults: (results: (null | Record<string, unknown>)[]) => void;
	};
}

describe("RepoRepository", () => {
	let mockDb: ReturnType<typeof createMockDb>;
	let repo: RepoRepository;

	beforeEach(() => {
		mockDb = createMockDb();
		repo = new RepoRepository(mockDb);
	});

	it("should create a repo", async () => {
		const mockRepo = {
			id: "repo-owner-name",
			owner: "owner",
			name: "name",
			indexStatus: "pending",
		};

		mockDb.setFirstResults([mockRepo]);

		const result = await repo.createRepo("owner", "name");
		expect(result.id).toBe("repo-owner-name");
	});

	it("should get repo by id", async () => {
		const mockRepo = { id: "repo-owner-name", owner: "owner", name: "name" };
		mockDb.setFirstResults([mockRepo]);

		const result = await repo.getRepoById("repo-owner-name");
		expect(result).toEqual(mockRepo);
	});

	it("should return null for missing repo", async () => {
		mockDb.setFirstResults([null]);

		const result = await repo.getRepoById("missing");
		expect(result).toBeNull();
	});

	it("should get repo by owner and name", async () => {
		const mockRepo = { id: "repo-owner-name", owner: "owner", name: "name" };
		mockDb.setFirstResults([mockRepo]);

		const result = await repo.getRepoByOwnerAndName("owner", "name");
		expect(result?.id).toBe("repo-owner-name");
	});

	it("should update repo status", async () => {
		await repo.updateRepoStatus("repo-owner-name", "complete", {
			lastCommitSha: "abc123",
			fileCount: 10,
		});

		expect(mockDb.prepare).toHaveBeenCalledWith(
			expect.stringContaining("UPDATE repos SET")
		);
	});

	it("should list repos", async () => {
		const mockRepos = [
			{ id: "repo-1", owner: "a", name: "b" },
			{ id: "repo-2", owner: "c", name: "d" },
		];
		mockDb.all.mockResolvedValueOnce({ results: mockRepos });

		const result = await repo.listRepos();
		expect(result).toEqual(mockRepos);
	});

	it("should delete repo", async () => {
		await repo.deleteRepo("repo-owner-name");
		expect(mockDb.prepare).toHaveBeenCalledWith(
			"DELETE FROM repos WHERE id = ?"
		);
	});
});

describe("IndexingJobRepository", () => {
	let mockDb: ReturnType<typeof createMockDb>;
	let jobRepo: IndexingJobRepository;

	beforeEach(() => {
		mockDb = createMockDb();
		jobRepo = new IndexingJobRepository(mockDb);
	});

	it("should create a job", async () => {
		const mockJob = {
			id: "job-123",
			repoId: "repo-test",
			commitSha: "abc123",
			status: "queued",
		};

		mockDb.setFirstResults([mockJob]);

		const result = await jobRepo.createJob("repo-test", "abc123");
		expect(result.repoId).toBe("repo-test");
	});

	it("should update job status to processing", async () => {
		await jobRepo.updateJobStatus("job-123", "processing", {
			filesProcessed: 5,
		});

		expect(mockDb.prepare).toHaveBeenCalledWith(
			expect.stringContaining("status = ?")
		);
	});

	it("should update job status to complete with completed_at", async () => {
		await jobRepo.updateJobStatus("job-123", "complete", {
			filesProcessed: 10,
			chunksCreated: 50,
		});

		const call = vi.mocked(mockDb.prepare).mock.calls[0];
		expect(call[0]).toContain("completed_at = unixepoch()");
	});

	it("should get jobs for repo", async () => {
		const mockJobs = [{ id: "job-1" }, { id: "job-2" }];
		mockDb.all.mockResolvedValueOnce({ results: mockJobs });

		const result = await jobRepo.getJobsForRepo("repo-test");
		expect(result).toEqual(mockJobs);
	});
});

describe("QueryRepository", () => {
	let mockDb: ReturnType<typeof createMockDb>;
	let queryRepo: QueryRepository;

	beforeEach(() => {
		mockDb = createMockDb();
		queryRepo = new QueryRepository(mockDb);
	});

	it("should create a query", async () => {
		const mockQuery = {
			id: "query-123",
			repoId: "repo-test",
			sessionId: "session-1",
			queryText: "How does auth work?",
		};

		mockDb.setFirstResults([mockQuery]);

		const result = await queryRepo.createQuery("repo-test", "session-1", "How does auth work?");
		expect(result.queryText).toBe("How does auth work?");
	});

	it("should update query response", async () => {
		await queryRepo.updateQueryResponse(
			"query-123",
			"Auth uses JWT",
			"[]",
			100,
			500
		);

		expect(mockDb.prepare).toHaveBeenCalledWith(
			expect.stringContaining("UPDATE queries")
		);
	});

	it("should get queries for session", async () => {
		const mockQueries = [{ id: "q1" }, { id: "q2" }];
		mockDb.all.mockResolvedValueOnce({ results: mockQueries });

		const result = await queryRepo.getQueriesForSession("session-1");
		expect(result).toEqual(mockQueries);
	});
});
