import { beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/api/routes";
import type { Env } from "../src/types";

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

describe("API Routes", () => {
	let mockDb: ReturnType<typeof createMockDb>;
	let mockEnv: Env;

	beforeEach(() => {
		mockDb = createMockDb();
		mockEnv = {
			AI: {
				run: vi.fn().mockResolvedValue({ data: [[0.1, 0.2, 0.3]] }),
			} as unknown as Ai,
			VECTORIZE: {
				query: vi.fn().mockResolvedValue({ matches: [] }),
				deleteByIds: vi.fn().mockResolvedValue(undefined),
			} as unknown as VectorizeIndex,
			DB: mockDb,
			INDEX_QUEUE: {
				send: vi.fn().mockResolvedValue(undefined),
			} as unknown as Queue,
			RepoMindAgent: {} as DurableObjectNamespace,
			APP_NAME: "RepoMind",
			APP_VERSION: "0.1.0",
			GITHUB_API_URL: "https://api.github.com",
			MAX_FILE_SIZE: "1048576",
			CHUNK_BATCH_SIZE: "10",
			AI_GATEWAY_ID: "repomind",
		};
	});

	it("GET /health should return status", async () => {
		const req = new Request("http://localhost/health");
		const res = await app.fetch(req, mockEnv);
		const data = (await res.json()) as { status: string; app: string };

		expect(res.status).toBe(200);
		expect(data.status).toBe("ok");
		expect(data.app).toBe("RepoMind");
	});

	it("GET /api/repos should list repos", async () => {
		const mockRepos = [
			{
				id: "repo-1",
				owner: "a",
				name: "b",
				defaultBranch: "main",
				lastCommitSha: null,
				lastIndexedAt: null,
				indexStatus: "pending",
				fileCount: 0,
				chunkCount: 0,
			},
		];

		mockDb.all.mockResolvedValueOnce({ results: mockRepos });

		const req = new Request("http://localhost/api/repos");
		const res = await app.fetch(req, mockEnv);
		const data = (await res.json()) as { repos: unknown[] };

		expect(res.status).toBe(200);
		expect(data.repos).toHaveLength(1);
	});

	it("GET /api/repos/:owner/:name should return repo", async () => {
		const mockRepo = {
			id: "repo-owner-name",
			owner: "owner",
			name: "name",
			defaultBranch: "main",
			lastCommitSha: "abc123",
			lastIndexedAt: 1234567890,
			indexStatus: "complete",
			fileCount: 10,
			chunkCount: 50,
		};

		mockDb.setFirstResults([mockRepo]);

		const req = new Request("http://localhost/api/repos/owner/name");
		const res = await app.fetch(req, mockEnv);
		const data = (await res.json()) as { id: string };

		expect(res.status).toBe(200);
		expect(data.id).toBe("repo-owner-name");
	});

	it("GET /api/repos/:owner/:name should 404 for missing repo", async () => {
		mockDb.setFirstResults([null]);

		const req = new Request("http://localhost/api/repos/missing/repo");
		const res = await app.fetch(req, mockEnv);

		expect(res.status).toBe(404);
	});

	it("POST /api/repos should create repo and queue indexing", async () => {
		(globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ default_branch: "main" }), { status: 200 })
			)
			.mockResolvedValueOnce(new Response(JSON.stringify({ sha: "abc123" }), { status: 200 }));

		const mockRepo = {
			id: "repo-owner-name",
			owner: "owner",
			name: "name",
			indexStatus: "pending",
		};

		mockDb.setFirstResults([mockRepo, { id: "job-123" }]);

		const req = new Request("http://localhost/api/repos", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ owner: "owner", name: "name" }),
		});

		const res = await app.fetch(req, mockEnv);
		const data = (await res.json()) as { id: string };

		expect(res.status).toBe(201);
		expect(data.id).toBe("repo-owner-name");
		expect(mockEnv.INDEX_QUEUE.send).toHaveBeenCalled();
	});

	it("POST /api/repos should validate input", async () => {
		const req = new Request("http://localhost/api/repos", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ owner: "", name: "" }),
		});

		const res = await app.fetch(req, mockEnv);
		expect(res.status).toBe(400);
	});

	it("POST /api/repos/:owner/:name/reindex should queue reindex", async () => {
		(globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ default_branch: "main" }), { status: 200 })
			)
			.mockResolvedValueOnce(new Response(JSON.stringify({ sha: "abc123" }), { status: 200 }));

		const mockRepo = {
			id: "repo-owner-name",
			owner: "owner",
			name: "name",
			indexStatus: "complete",
		};

		const req = new Request("http://localhost/api/repos/owner/name/reindex", {
			method: "POST",
		});

		mockDb.setFirstResults([mockRepo, { id: "job-123" }]);

		const res = await app.fetch(req, mockEnv);
		const data = (await res.json()) as { message: string };

		expect(res.status).toBe(200);
		expect(data.message).toBe("Reindexing queued");
	});

	it("DELETE /api/repos/:owner/:name should delete repo and vectors", async () => {
		const mockRepo = {
			id: "repo-owner-name",
			owner: "owner",
			name: "name",
		};

		mockDb.setFirstResults([mockRepo]);

		const req = new Request("http://localhost/api/repos/owner/name", {
			method: "DELETE",
		});

		const res = await app.fetch(req, mockEnv);
		const data = (await res.json()) as { message: string };

		expect(res.status).toBe(200);
		expect(data.message).toBe("Repository deleted");
		expect(mockEnv.VECTORIZE.query).toHaveBeenCalled();
	});

	it("POST /webhooks/github should handle push events", async () => {
		const mockRepo = {
			id: "repo-owner-name",
			owner: "owner",
			name: "name",
		};

		mockDb.setFirstResults([mockRepo, null, { id: "job-123" }]);

		const req = new Request("http://localhost/webhooks/github", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				ref: "refs/heads/main",
				repository: {
					owner: { login: "owner" },
					name: "name",
				},
				after: "abc123",
			}),
		});

		mockDb.setFirstResults([mockRepo, { id: "job-123" }]);

		const res = await app.fetch(req, mockEnv);
		const data = (await res.json()) as { message: string };

		expect(res.status).toBe(200);
		expect(data.message).toBe("Reindexing triggered");
	});

	it("POST /webhooks/github should ignore non-push events", async () => {
		const req = new Request("http://localhost/webhooks/github", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action: "created" }),
		});

		const res = await app.fetch(req, mockEnv);
		const data = (await res.json()) as { message: string };

		expect(res.status).toBe(200);
		expect(data.message).toBe("Event ignored");
	});

	it("POST /webhooks/github should verify signature when secret is set", async () => {
		mockEnv.WEBHOOK_SECRET = "test-secret";

		// Request without signature should fail
		const req = new Request("http://localhost/webhooks/github", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ ref: "refs/heads/main" }),
		});

		const res = await app.fetch(req, mockEnv);
		expect(res.status).toBe(401);
	});

	it("should handle CORS preflight", async () => {
		const req = new Request("http://localhost/api/repos", {
			method: "OPTIONS",
			headers: { Origin: "http://localhost:5173" },
		});

		const res = await app.fetch(req, mockEnv);
		expect(res.status).toBe(204);
		expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
	});
});
