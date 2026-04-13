CREATE TABLE IF NOT EXISTS repos (
	id TEXT PRIMARY KEY,
	owner TEXT NOT NULL,
	name TEXT NOT NULL,
	default_branch TEXT DEFAULT 'main',
	last_commit_sha TEXT,
	last_indexed_at INTEGER,
	index_status TEXT CHECK (index_status IN ('pending', 'indexing', 'complete', 'error')) DEFAULT 'pending',
	file_count INTEGER DEFAULT 0,
	chunk_count INTEGER DEFAULT 0,
	error_message TEXT,
	created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS indexing_jobs (
	id TEXT PRIMARY KEY,
	repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
	commit_sha TEXT NOT NULL,
	status TEXT CHECK (status IN ('queued', 'processing', 'complete', 'error')) DEFAULT 'queued',
	queued_at INTEGER DEFAULT (unixepoch()),
	started_at INTEGER,
	completed_at INTEGER,
	files_processed INTEGER DEFAULT 0,
	chunks_created INTEGER DEFAULT 0,
	error_message TEXT
);

CREATE TABLE IF NOT EXISTS queries (
	id TEXT PRIMARY KEY,
	repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
	session_id TEXT NOT NULL,
	query_text TEXT NOT NULL,
	response_text TEXT,
	sources TEXT,
	tokens_used INTEGER,
	latency_ms INTEGER,
	created_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_repos_status ON repos(index_status);
CREATE INDEX IF NOT EXISTS idx_repos_owner_name ON repos(owner, name);
CREATE INDEX IF NOT EXISTS idx_jobs_repo ON indexing_jobs(repo_id);
CREATE INDEX IF NOT EXISTS idx_queries_repo ON queries(repo_id);
CREATE INDEX IF NOT EXISTS idx_queries_session ON queries(session_id);
