import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { IndexingJobRepository, RepoRepository } from "../db/repositories";
import { GitHubClient } from "../lib/github";
import { generateRequestId, logInfo } from "../lib/logging";
import { deleteRepoChunks } from "../lib/vectorize";
import type { Env } from "../types";

const app = new Hono<{ Bindings: Env; Variables: { requestId: string } }>();

// Request ID middleware
app.use("*", async (c, next) => {
	const requestId = c.req.header("X-Request-ID") || generateRequestId();
	c.set("requestId", requestId);
	c.header("X-Request-ID", requestId);
	return next();
});

// Logging middleware
app.use("*", async (c, next) => {
	const start = Date.now();
	await next();
	const duration = Date.now() - start;
	logInfo("Request completed", {
		requestId: c.get("requestId"),
		method: c.req.method,
		path: c.req.path,
		status: c.res.status,
		duration,
	});
});

// CORS middleware
app.use("*", async (c, next) => {
	const origin = c.req.header("Origin");
	const allowedOrigins = [
		"http://localhost:5173",
		"https://repomind-web.pages.dev",
		"https://repomind.pages.dev",
	];

	if (origin && allowedOrigins.includes(origin)) {
		c.header("Access-Control-Allow-Origin", origin);
		c.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
		c.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
		c.header("Access-Control-Allow-Credentials", "true");
	}

	if (c.req.method === "OPTIONS") {
		return c.body(null, 204);
	}

	return next();
});

// Simple rate limiting map (in production, use Durable Object or KV)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

app.use("/api/*", async (c, next) => {
	const ip = c.req.header("CF-Connecting-IP") || "unknown";
	const now = Date.now();
	const windowMs = 60 * 1000; // 1 minute
	const maxRequests = 60;

	const entry = rateLimitMap.get(ip);
	if (entry) {
		if (now > entry.resetAt) {
			rateLimitMap.set(ip, { count: 1, resetAt: now + windowMs });
		} else if (entry.count >= maxRequests) {
			return c.json({ error: "Rate limit exceeded" }, 429);
		} else {
			entry.count++;
		}
	} else {
		rateLimitMap.set(ip, { count: 1, resetAt: now + windowMs });
	}

	return next();
});

// Health check with dependency verification
app.get("/health", async (c) => {
	const checks = {
		d1: false,
		vectorize: false,
		ai: false,
	};

	// Check D1
	try {
		const repoRepo = new RepoRepository(c.env.DB);
		await repoRepo.listRepos(1, 0);
		checks.d1 = true;
	} catch (e) {
		console.error("D1 health check failed:", e);
	}

	// Check Vectorize
	try {
		await c.env.VECTORIZE.query(new Array(384).fill(0), {
			topK: 1,
			returnMetadata: false,
			returnVectors: false,
		} as VectorizeQueryOptions);
		checks.vectorize = true;
	} catch (e) {
		console.error("Vectorize health check failed:", e);
	}

	// Check AI
	try {
		await c.env.AI.run("@cf/baai/bge-small-en-v1.5", {
			text: ["test"],
		});
		checks.ai = true;
	} catch (e) {
		console.error("AI health check failed:", e);
	}

	const allHealthy = checks.d1 && checks.vectorize && checks.ai;

	return c.json(
		{
			status: allHealthy ? "ok" : "degraded",
			app: c.env.APP_NAME,
			version: c.env.APP_VERSION,
			checks,
		},
		allHealthy ? 200 : 503
	);
});

// List repos
app.get("/api/repos", async (c) => {
	const repoRepo = new RepoRepository(c.env.DB);
	const repos = await repoRepo.listRepos(50, 0);

	return c.json({
		repos: repos.map((r) => ({
			id: r.id,
			owner: r.owner,
			name: r.name,
			defaultBranch: r.defaultBranch,
			lastCommitSha: r.lastCommitSha,
			lastIndexedAt: r.lastIndexedAt,
			indexStatus: r.indexStatus,
			fileCount: r.fileCount,
			chunkCount: r.chunkCount,
		})),
	});
});

// Get repo by owner/name
app.get("/api/repos/:owner/:name", async (c) => {
	const owner = c.req.param("owner");
	const name = c.req.param("name");

	const repoRepo = new RepoRepository(c.env.DB);
	const repo = await repoRepo.getRepoByOwnerAndName(owner, name);

	if (!repo) {
		return c.json({ error: "Repository not found" }, 404);
	}

	return c.json({
		id: repo.id,
		owner: repo.owner,
		name: repo.name,
		defaultBranch: repo.defaultBranch,
		lastCommitSha: repo.lastCommitSha,
		lastIndexedAt: repo.lastIndexedAt,
		indexStatus: repo.indexStatus,
		fileCount: repo.fileCount,
		chunkCount: repo.chunkCount,
	});
});

// Register new repo
app.post(
	"/api/repos",
	zValidator(
		"json",
		z.object({
			owner: z.string().min(1),
			name: z.string().min(1),
		})
	),
	async (c) => {
		const { owner, name } = c.req.valid("json");

		const github = new GitHubClient(c.env.GITHUB_TOKEN);
		const repoRepo = new RepoRepository(c.env.DB);
		const jobRepo = new IndexingJobRepository(c.env.DB);

		try {
			// Verify repo exists on GitHub
			const defaultBranch = await github.getDefaultBranch(owner, name);
			const commitSha = await github.getLatestCommit(owner, name, defaultBranch);

			// Create repo record
			const repo = await repoRepo.createRepo(owner, name);

			// Create indexing job
			const job = await jobRepo.createJob(repo.id, commitSha);

			// Queue for indexing
			await c.env.INDEX_QUEUE.send({
				repoId: repo.id,
				owner,
				name,
				commitSha,
				jobId: job.id,
			});

			return c.json(
				{
					id: repo.id,
					owner: repo.owner,
					name: repo.name,
					indexStatus: repo.indexStatus,
					jobId: job.id,
				},
				201
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: message }, 400);
		}
	}
);

// Reindex repo
app.post("/api/repos/:owner/:name/reindex", async (c) => {
	const owner = c.req.param("owner");
	const name = c.req.param("name");

	const github = new GitHubClient(c.env.GITHUB_TOKEN);
	const repoRepo = new RepoRepository(c.env.DB);
	const jobRepo = new IndexingJobRepository(c.env.DB);

	const repo = await repoRepo.getRepoByOwnerAndName(owner, name);
	if (!repo) {
		return c.json({ error: "Repository not found" }, 404);
	}

	try {
		const defaultBranch = await github.getDefaultBranch(owner, name);
		const commitSha = await github.getLatestCommit(owner, name, defaultBranch);

		await repoRepo.updateRepoStatus(repo.id, "pending", {});

		const job = await jobRepo.createJob(repo.id, commitSha);

		await c.env.INDEX_QUEUE.send({
			repoId: repo.id,
			owner,
			name,
			commitSha,
			jobId: job.id,
		});

		return c.json({
			message: "Reindexing queued",
			jobId: job.id,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return c.json({ error: message }, 500);
	}
});

// Delete repo
app.delete("/api/repos/:owner/:name", async (c) => {
	const owner = c.req.param("owner");
	const name = c.req.param("name");

	const repoRepo = new RepoRepository(c.env.DB);
	const repo = await repoRepo.getRepoByOwnerAndName(owner, name);

	if (!repo) {
		return c.json({ error: "Repository not found" }, 404);
	}

	// Delete vectors from Vectorize
	await deleteRepoChunks(c.env.VECTORIZE, repo.id);

	await repoRepo.deleteRepo(repo.id);

	return c.json({ message: "Repository deleted" });
});

// Get indexing jobs for repo
app.get("/api/repos/:owner/:name/jobs", async (c) => {
	const owner = c.req.param("owner");
	const name = c.req.param("name");

	const repoRepo = new RepoRepository(c.env.DB);
	const jobRepo = new IndexingJobRepository(c.env.DB);

	const repo = await repoRepo.getRepoByOwnerAndName(owner, name);
	if (!repo) {
		return c.json({ error: "Repository not found" }, 404);
	}

	const jobs = await jobRepo.getJobsForRepo(repo.id, 10);

	return c.json({
		jobs: jobs.map((j) => ({
			id: j.id,
			commitSha: j.commitSha,
			status: j.status,
			queuedAt: j.queuedAt,
			startedAt: j.startedAt,
			completedAt: j.completedAt,
			filesProcessed: j.filesProcessed,
			chunksCreated: j.chunksCreated,
		})),
	});
});

// GitHub webhook
app.post("/webhooks/github", async (c) => {
	const signature = c.req.header("X-Hub-Signature-256");
	const body = await c.req.text();

	// Verify webhook signature if secret is configured
	if (c.env.WEBHOOK_SECRET) {
		if (!signature) {
			return c.json({ error: "Missing signature" }, 401);
		}

		const isValid = await verifyGitHubWebhook(body, signature, c.env.WEBHOOK_SECRET);
		if (!isValid) {
			return c.json({ error: "Invalid signature" }, 401);
		}
	}

	let payload: Record<string, unknown>;
	try {
		payload = JSON.parse(body);
	} catch {
		return c.json({ error: "Invalid JSON" }, 400);
	}

	// Handle push events
	const ref = payload.ref as string | undefined;
	if (ref?.startsWith("refs/heads/")) {
		const repository = payload.repository as Record<string, unknown> | undefined;
		const owner = (repository?.owner as Record<string, string>)?.login;
		const name = repository?.name as string | undefined;
		const commitSha = payload.after as string | undefined;

		if (!owner || !name || !commitSha) {
			return c.json({ error: "Invalid payload" }, 400);
		}

		const repoRepo = new RepoRepository(c.env.DB);
		const jobRepo = new IndexingJobRepository(c.env.DB);

		const repo = await repoRepo.getRepoByOwnerAndName(owner, name);
		if (!repo) {
			return c.json({ error: "Repository not registered" }, 404);
		}

		await repoRepo.updateRepoStatus(repo.id, "pending", {});

		const job = await jobRepo.createJob(repo.id, commitSha);

		await c.env.INDEX_QUEUE.send({
			repoId: repo.id,
			owner,
			name,
			commitSha,
			jobId: job.id,
		});

		return c.json({ message: "Reindexing triggered", jobId: job.id });
	}

	return c.json({ message: "Event ignored" });
});

async function verifyGitHubWebhook(
	payload: string,
	signature: string,
	secret: string
): Promise<boolean> {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"]
	);
	const sig = signature.replace("sha256=", "");
	const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
	const signedHex = Array.from(new Uint8Array(signed))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
	return signedHex === sig;
}

export default app;
