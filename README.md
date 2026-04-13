# RepoMind

AI-powered codebase intelligence. Ask natural language questions about any GitHub repository and get answers grounded in the actual code using RAG (Retrieval-Augmented Generation).

## What It Does

- **Indexes GitHub repositories** by fetching files, chunking code, and generating embeddings via Workers AI
- **Answers code questions** using Vectorize similarity search + LLM reasoning
- **Streams responses** over WebSocket with source citations (file paths + line numbers)
- **Auto-reindexes** on GitHub push via webhooks

## Architecture

```
GitHub Repo → Indexer Worker → Embeddings (bge-small) → Vectorize
                                    ↓
User Question → RepoMindAgent → Vectorize Search → LLM (Llama 3.3) → Streaming Response
```

## Stack

- **Runtime:** Cloudflare Workers
- **Agent:** `agents` SDK 0.8.0 + `@cloudflare/ai-chat`
- **AI:** Workers AI (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`)
- **Embeddings:** `@cf/baai/bge-small-en-v1.5` (384-dim)
- **Vector DB:** Cloudflare Vectorize
- **Database:** D1 (SQLite)
- **Queue:** Cloudflare Queues (indexing jobs)
- **Frontend:** React Router v7 + Vite + Tailwind CSS
- **Language:** TypeScript (strict mode)
- **Lint/Format:** Biome

## Quick Start

```bash
# Install dependencies
pnpm install

# Run tests (69 tests)
pnpm test

# Start local dev
pnpm dev

# Deploy to Cloudflare
pnpm deploy
```

## Environment Setup

1. **Create D1 database:**
```bash
wrangler d1 create repomind-db
# Update wrangler.jsonc with the database_id
```

2. **Create Vectorize index:**
```bash
wrangler vectorize create repomind-chunks --dimensions=384 --metric=cosine
```

3. **Apply D1 migrations:**
```bash
pnpm db:migrate:remote
```

4. **Set secrets:**
```bash
wrangler secret put GITHUB_TOKEN
wrangler secret put WEBHOOK_SECRET
```

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/api/repos` | GET | List indexed repos |
| `/api/repos` | POST | Register new repo |
| `/api/repos/:owner/:name` | GET | Get repo status |
| `/api/repos/:owner/:name/reindex` | POST | Trigger reindex |
| `/api/repos/:owner/:name` | DELETE | Remove repo |
| `/webhooks/github` | POST | GitHub push webhook |
| `/agents/RepoMindAgent/:session` | WS | Chat with repo |

## Project Structure

```
repomind/
├── src/
│   ├── agents/
│   │   └── RepoMindAgent.ts       # AIChatAgent with RAG
│   ├── api/
│   │   └── routes.ts              # Hono REST API
│   ├── db/
│   │   └── repositories.ts        # D1 data access
│   ├── lib/
│   │   ├── chunker.ts             # AST-based code chunking
│   │   ├── embeddings.ts          # Workers AI embedding client
│   │   ├── github.ts              # GitHub API client
│   │   └── vectorize.ts           # Vectorize operations
│   ├── types/
│   │   └── index.ts               # Shared TypeScript types
│   ├── workers/
│   │   └── indexer.ts             # Queue consumer
│   └── index.ts                   # Worker entry
├── tests/                         # 69 Vitest tests
├── web/                           # React Router v7 SPA
├── migrations/
│   └── 0001_initial.sql           # D1 schema
├── wrangler.jsonc
└── package.json
```

## License

MIT
