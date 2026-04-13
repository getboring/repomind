import type { Ai, D1Database, Queue, VectorizeIndex } from "@cloudflare/workers-types";

export interface Env {
	// Cloudflare bindings
	AI: Ai;
	VECTORIZE: VectorizeIndex;
	DB: D1Database;
	INDEX_QUEUE: Queue<IndexingJob>;

	// Durable Objects
	// biome-ignore lint/suspicious/noExplicitAny: Circular type reference requires any
	RepoMindAgent: DurableObjectNamespace<any>;

	// Secrets
	GITHUB_TOKEN?: string;
	WEBHOOK_SECRET?: string;

	// Config vars
	APP_NAME: string;
	APP_VERSION: string;
	GITHUB_API_URL: string;
	MAX_FILE_SIZE: string;
	CHUNK_BATCH_SIZE: string;
	AI_GATEWAY_ID: string;
}

export interface IndexingJob {
	repoId: string;
	owner: string;
	name: string;
	commitSha: string;
	jobId: string;
}

export interface RepoRecord {
	id: string;
	owner: string;
	name: string;
	defaultBranch: string;
	lastCommitSha: string | null;
	lastIndexedAt: number | null;
	indexStatus: "pending" | "indexing" | "complete" | "error";
	fileCount: number;
	chunkCount: number;
	errorMessage: string | null;
	createdAt: number;
}

export interface IndexingJobRecord {
	id: string;
	repoId: string;
	commitSha: string;
	status: "queued" | "processing" | "complete" | "error";
	queuedAt: number;
	startedAt: number | null;
	completedAt: number | null;
	filesProcessed: number;
	chunksCreated: number;
	errorMessage: string | null;
}

export interface QueryRecord {
	id: string;
	repoId: string;
	sessionId: string;
	queryText: string;
	responseText: string | null;
	sources: string | null;
	tokensUsed: number | null;
	latencyMs: number | null;
	createdAt: number;
}

export interface CodeChunk {
	id: string;
	repoId: string;
	filePath: string;
	lineStart: number;
	lineEnd: number;
	content: string;
	chunkType:
		| "function"
		| "class"
		| "interface"
		| "type"
		| "import"
		| "export"
		| "comment"
		| "other";
}

export interface VectorizeMatch {
	id: string;
	score: number;
	metadata: {
		repoId: string;
		filePath: string;
		lineStart: number;
		lineEnd: number;
		content: string;
		chunkType: string;
	};
}

export interface GitHubFile {
	path: string;
	downloadUrl: string;
	size: number;
	type: "file" | "dir";
}

export interface RagSource {
	filePath: string;
	lineStart: number;
	lineEnd: number;
	content: string;
	score: number;
}

export interface RepoRegistrationRequest {
	owner: string;
	name: string;
}

export interface RepoResponse {
	id: string;
	owner: string;
	name: string;
	defaultBranch: string;
	lastCommitSha: string | null;
	lastIndexedAt: number | null;
	indexStatus: RepoRecord["indexStatus"];
	fileCount: number;
	chunkCount: number;
}

export interface ChatMessage {
	role: "user" | "assistant";
	content: string;
	sources?: RagSource[];
}

export interface ChatStreamEvent {
	type: "text" | "error" | "done";
	content?: string;
	error?: string;
	sources?: RagSource[];
}
