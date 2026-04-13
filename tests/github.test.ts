import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubClient } from "../src/lib/github";

describe("GitHubClient", () => {
	let client: GitHubClient;

	beforeEach(() => {
		client = new GitHubClient("test-token");
		(globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = vi.fn();
	});

	it("should fetch default branch", async () => {
		vi.mocked(fetch).mockResolvedValueOnce(
			new Response(JSON.stringify({ default_branch: "main" }), { status: 200 })
		);

		const branch = await client.getDefaultBranch("facebook", "react");
		expect(branch).toBe("main");
		expect(fetch).toHaveBeenCalledWith(
			"https://api.github.com/repos/facebook/react",
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: "Bearer test-token",
				}),
			})
		);
	});

	it("should throw on API error for default branch", async () => {
		vi.mocked(fetch).mockResolvedValueOnce(new Response("Not Found", { status: 404 }));

		await expect(client.getDefaultBranch("facebook", "nonexistent")).rejects.toThrow(
			"GitHub API error: 404"
		);
	});

	it("should fetch latest commit", async () => {
		vi.mocked(fetch).mockResolvedValueOnce(
			new Response(JSON.stringify({ sha: "abc123" }), { status: 200 })
		);

		const sha = await client.getLatestCommit("facebook", "react", "main");
		expect(sha).toBe("abc123");
	});

	it("should fetch file tree", async () => {
		vi.mocked(fetch)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify([
						{ path: "src", type: "dir", size: 0, download_url: null },
						{
							path: "README.md",
							type: "file",
							size: 100,
							download_url: "https://raw.githubusercontent.com/...",
						},
					]),
					{ status: 200 }
				)
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify([
						{
							path: "src/index.ts",
							type: "file",
							size: 200,
							download_url: "https://raw.githubusercontent.com/...",
						},
					]),
					{ status: 200 }
				)
			);

		const files = await client.getFileTree("facebook", "react", "abc123");
		expect(files.length).toBe(2);
		expect(files[0].path).toBe("README.md");
		expect(files[1].path).toBe("src/index.ts");
	});

	it("should skip node_modules directories", async () => {
		vi.mocked(fetch)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify([
						{ path: "src", type: "dir", size: 0, download_url: null },
						{
							path: "node_modules",
							type: "dir",
							size: 0,
							download_url: null,
						},
					]),
					{ status: 200 }
				)
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify([
						{
							path: "src/index.ts",
							type: "file",
							size: 200,
							download_url: "https://raw.githubusercontent.com/...",
						},
					]),
					{ status: 200 }
				)
			);

		const files = await client.getFileTree("facebook", "react", "abc123");
		expect(files.some((f) => f.path.includes("node_modules"))).toBe(false);
	});

	it("should skip binary files", async () => {
		vi.mocked(fetch).mockResolvedValueOnce(
			new Response(
				JSON.stringify([
					{
						path: "logo.png",
						type: "file",
						size: 1000,
						download_url: "https://raw.githubusercontent.com/...",
					},
					{
						path: "README.md",
						type: "file",
						size: 100,
						download_url: "https://raw.githubusercontent.com/...",
					},
				]),
				{ status: 200 }
			)
		);

		const files = await client.getFileTree("facebook", "react", "abc123");
		expect(files.some((f) => f.path.endsWith(".png"))).toBe(false);
		expect(files.some((f) => f.path === "README.md")).toBe(true);
	});

	it("should fetch file content", async () => {
		vi.mocked(fetch).mockResolvedValueOnce(new Response("console.log('hello');", { status: 200 }));

		const content = await client.getFileContent("https://raw.githubusercontent.com/...");
		expect(content).toBe("console.log('hello');");
	});

	it("should throw on file fetch error", async () => {
		vi.mocked(fetch).mockResolvedValueOnce(new Response("Not Found", { status: 404 }));

		await expect(client.getFileContent("https://raw.githubusercontent.com/...")).rejects.toThrow(
			"Failed to fetch file: 404"
		);
	});

	it("should work without token", async () => {
		const publicClient = new GitHubClient(undefined);
		vi.mocked(fetch).mockResolvedValueOnce(
			new Response(JSON.stringify({ default_branch: "main" }), { status: 200 })
		);

		const branch = await publicClient.getDefaultBranch("facebook", "react");
		expect(branch).toBe("main");
		const call = vi.mocked(fetch).mock.calls[0];
		const headers = (call[1] as RequestInit)?.headers as Record<string, string>;
		expect(headers.Authorization).toBeUndefined();
	});
});
