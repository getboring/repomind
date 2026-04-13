export interface RepoResponse {
	id: string;
	owner: string;
	name: string;
	defaultBranch: string;
	lastCommitSha: string | null;
	lastIndexedAt: number | null;
	indexStatus: "pending" | "indexing" | "complete" | "error";
	fileCount: number;
	chunkCount: number;
}
