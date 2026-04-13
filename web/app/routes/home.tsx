import { useState, useEffect } from "react";
import { Link } from "react-router";
import type { RepoResponse } from "../lib/api";

export default function Home() {
	const [repos, setRepos] = useState<RepoResponse[]>([]);
	const [owner, setOwner] = useState("");
	const [name, setName] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		fetchRepos();
	}, []);

	async function fetchRepos() {
		try {
			const res = await fetch("/api/repos");
			const data = await res.json();
			setRepos(data.repos);
		} catch (err) {
			console.error("Failed to fetch repos:", err);
		}
	}

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setLoading(true);
		setError(null);

		try {
			const res = await fetch("/api/repos", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ owner, name }),
			});

			if (!res.ok) {
				const data = await res.json();
				throw new Error(data.error || "Failed to register repo");
			}

			setOwner("");
			setName("");
			fetchRepos();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}

	return (
		<div className="min-h-screen bg-gray-50">
			<header className="bg-white shadow">
				<div className="max-w-7xl mx-auto py-6 px-4">
					<h1 className="text-3xl font-bold text-gray-900">RepoMind</h1>
					<p className="mt-2 text-gray-600">AI-powered codebase intelligence</p>
				</div>
			</header>

			<main className="max-w-7xl mx-auto py-6 px-4">
				<section className="bg-white rounded-lg shadow p-6 mb-6">
					<h2 className="text-lg font-semibold mb-4">Add Repository</h2>
					<form onSubmit={handleSubmit} className="flex gap-4">
						<input
							type="text"
							placeholder="Owner (e.g., facebook)"
							value={owner}
							onChange={(e) => setOwner(e.target.value)}
							className="flex-1 px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
							required
						/>
						<input
							type="text"
							placeholder="Repo (e.g., react)"
							value={name}
							onChange={(e) => setName(e.target.value)}
							className="flex-1 px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
							required
						/>
						<button
							type="submit"
							disabled={loading}
							className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
						>
							{loading ? "Adding..." : "Add"}
						</button>
					</form>
					{error && (
						<p className="mt-2 text-red-600">{error}</p>
					)}
				</section>

				<section>
					<h2 className="text-lg font-semibold mb-4">Your Repositories</h2>
					{repos.length === 0 ? (
						<p className="text-gray-500">No repositories indexed yet.</p>
					) : (
						<div className="grid gap-4">
							{repos.map((repo) => (
								<Link
									key={repo.id}
									to={`/chat/${repo.owner}/${repo.name}`}
									className="bg-white rounded-lg shadow p-4 hover:shadow-md transition-shadow"
								>
									<div className="flex items-center justify-between">
										<div>
											<h3 className="font-medium">
												{repo.owner}/{repo.name}
											</h3>
											<p className="text-sm text-gray-500">
												{repo.fileCount} files · {repo.chunkCount} chunks
											</p>
										</div>
										<span
											className={`px-2 py-1 text-xs rounded ${
												repo.indexStatus === "complete"
													? "bg-green-100 text-green-800"
													: repo.indexStatus === "error"
														? "bg-red-100 text-red-800"
														: "bg-yellow-100 text-yellow-800"
											}`}
										>
											{repo.indexStatus}
										</span>
									</div>
								</Link>
							))}
						</div>
					)}
				</section>
			</main>
		</div>
	);
}
