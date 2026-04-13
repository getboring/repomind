# RepoMind

## What is this?
AI-powered codebase intelligence for GitHub repositories. Ask natural language questions about any repo and get answers grounded in the actual code using RAG.

## Stack
- **Runtime:** Cloudflare Workers (Durable Objects with SQLite)
- **Agent:** `agents` SDK 0.8.0, `@cloudflare/ai-chat`
- **AI:** Workers AI (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`)
- **Embeddings:** `@cf/baai/bge-small-en-v1.5` (384-dim)
- **Vector DB:** Cloudflare Vectorize
- **Database:** D1 (SQLite)
- **Queue:** Cloudflare Queues
- **Frontend:** React Router v7 + Vite + Tailwind CSS
- **Build:** Vite, Wrangler
- **Test:** Vitest (69 tests)

## Development
```bash
pnpm install
pnpm test              # Run all tests
pnpm dev               # Local dev (Worker + web)
pnpm deploy            # Deploy to Cloudflare
```

## Architecture
- `src/index.ts` — Worker entry, routes agent requests + REST API
- `src/agents/RepoMindAgent.ts` — AIChatAgent with RAG pipeline
- `src/api/routes.ts` — Hono REST API (repos, jobs, webhooks)
- `src/workers/indexer.ts` — Queue consumer for repo indexing
- `src/lib/chunker.ts` — Code chunking by function/class/interface
- `src/lib/github.ts` — GitHub API client
- `src/lib/vectorize.ts` — Vectorize upsert/search/delete
- `src/db/repositories.ts` — D1 repository pattern
- `web/app/` — React Router v7 SPA

## Key Files
| File | Purpose |
|------|---------|
| `src/agents/RepoMindAgent.ts` | AIChatAgent, embed query, Vectorize search, stream response |
| `src/workers/indexer.ts` | Fetches GitHub files, chunks code, generates embeddings, upserts to Vectorize |
| `src/lib/chunker.ts` | Parses TS/JS and chunks by constructs (function, class, interface, type) |
| `src/api/routes.ts` | Hono router with zValidator, GitHub webhook handler |
| `src/db/repositories.ts` | RepoRepository, IndexingJobRepository, QueryRepository |
| `wrangler.jsonc` | All CF bindings: AI, Vectorize, D1, Queues, DO |

## Commands
```bash
pnpm dev              # Start local dev
pnpm deploy           # Deploy production
pnpm test             # Vitest (69 tests)
pnpm lint             # Biome check
pnpm lint:fix         # Biome check --write
pnpm db:migrate       # Local D1 migration
pnpm db:migrate:remote # Remote D1 migration
pnpm vectorize:create # Create Vectorize index
pnpm cf-typegen       # Generate worker types
```

## Conventions
- Integer cents for money (never floating point)
- All AI-generated content must be labeled
- No secrets in code
- Tab indent, 100 char width (Biome)
- Strict TypeScript, no `any`
- Zod validation on all API inputs

## Testing
69 Vitest tests covering:
- Chunker (14 tests)
- GitHub client (9 tests)
- Vectorize operations (6 tests)
- D1 repositories (14 tests)
- API routes (10 tests)
- Indexer worker (4 tests)
- Agent logic (7 tests)
- Embeddings (5 tests)
