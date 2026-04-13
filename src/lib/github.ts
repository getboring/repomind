import type { Env, GitHubFile } from "../types";

const GITHUB_API_URL = "https://api.github.com";

export class GitHubClient {
	private token: string | undefined;

	constructor(token: string | undefined) {
		this.token = token;
	}

	private async fetch(path: string): Promise<Response> {
		const headers: Record<string, string> = {
			Accept: "application/vnd.github+json",
			"X-GitHub-Api-Version": "2022-11-28",
			"User-Agent": "RepoMind/0.1.0",
		};

		if (this.token) {
			headers.Authorization = `Bearer ${this.token}`;
		}

		return fetch(`${GITHUB_API_URL}${path}`, { headers });
	}

	async getDefaultBranch(owner: string, name: string): Promise<string> {
		const response = await this.fetch(`/repos/${owner}/${name}`);

		if (!response.ok) {
			const body = await response.text();
			console.error(`GitHub API error: ${response.status} ${response.statusText}`, body);
			throw new Error(
				`GitHub API error: ${response.status} ${response.statusText}`
			);
		}

		const data = (await response.json()) as { default_branch: string };
		return data.default_branch;
	}

	async getLatestCommit(owner: string, name: string, branch: string): Promise<string> {
		const response = await this.fetch(
			`/repos/${owner}/${name}/commits/${branch}`
		);

		if (!response.ok) {
			throw new Error(
				`GitHub API error: ${response.status} ${response.statusText}`
			);
		}

		const data = (await response.json()) as { sha: string };
		return data.sha;
	}

	async getFileTree(
		owner: string,
		name: string,
		commitSha: string
	): Promise<GitHubFile[]> {
		const files: GitHubFile[] = [];
		const queue: string[] = [""];

		while (queue.length > 0) {
			const path = queue.shift() ?? "";
			const response = await this.fetch(
				`/repos/${owner}/${name}/contents/${path}?ref=${commitSha}`
			);

			if (!response.ok) {
				console.warn(`Skipping path ${path}: ${response.status}`);
				continue;
			}

			const items = (await response.json()) as Array<{
				path: string;
				type: "file" | "dir";
				size: number;
				download_url: string | null;
			}>;

			for (const item of items) {
				if (item.type === "dir") {
					if (shouldSkipDirectory(item.path)) {
						continue;
					}
					queue.push(item.path);
				} else if (item.type === "file") {
					if (shouldSkipFile(item.path)) {
						continue;
					}
					files.push({
						path: item.path,
						downloadUrl: item.download_url ?? "",
						size: item.size,
						type: "file",
					});
				}
			}
		}

		return files;
	}

	async getFileContent(downloadUrl: string): Promise<string> {
		const response = await fetch(downloadUrl);

		if (!response.ok) {
			throw new Error(`Failed to fetch file: ${response.status}`);
		}

		return response.text();
	}
}

function shouldSkipDirectory(path: string): boolean {
	const skipDirs = [
		"node_modules",
		".git",
		"dist",
		"build",
		".wrangler",
		".expo",
		"coverage",
		".next",
		".turbo",
		".vercel",
	];

	const parts = path.split("/");
	return skipDirs.some((dir) => parts.includes(dir));
}

function shouldSkipFile(path: string): boolean {
	// Skip binary and generated files
	const skipExtensions = [
		".png",
		".jpg",
		".jpeg",
		".gif",
		".svg",
		".ico",
		".woff",
		".woff2",
		".ttf",
		".eot",
		".mp3",
		".mp4",
		".webm",
		".pdf",
		".zip",
		".tar",
		".gz",
		".lock",
	];

	const skipFiles = [".DS_Store", "yarn.lock", "package-lock.json", "pnpm-lock.yaml"];

	if (skipFiles.some((f) => path.endsWith(f))) {
		return true;
	}

	return skipExtensions.some((ext) => path.toLowerCase().endsWith(ext));
}
