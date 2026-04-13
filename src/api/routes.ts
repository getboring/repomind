import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Env } from "../types";
import { RepoRepository, IndexingJobRepository } from "../db/repositories";
import { GitHubClient } from "../lib/github";

const app = new Hono<{ Bindings: Env }>();

// Health check
app.get("/health", (c) => {
	return c.json({
		status: "ok",
		app: c.env.APP_NAME,
		version: c.env.APP_VERSION,
	});
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

	// TODO: Delete vectors from Vectorize
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
	// TODO: Verify webhook signature
	const payload = await c.req.json();

	// Handle push events
	if (payload.ref && payload.ref.startsWith("refs/heads/")) {
		const owner = payload.repository?.owner?.login;
		const name = payload.repository?.name;
		const commitSha = payload.after;

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

export default app;
