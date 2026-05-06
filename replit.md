# TaxFlow Pro

A CPA Tax Filing Efficiency App — lets CPAs upload tax documents, auto-extract W-2 data via AI, calculate federal/state taxes, and manage client adjustments.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — API server (port 8080)
- `pnpm --filter @workspace/tax-app run dev` — React frontend (port 3000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL`, `OPENAI_API_KEY` (via Replit AI integration)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React 19 + Vite + Tailwind CSS + shadcn/ui + wouter routing
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod, drizzle-zod
- API codegen: Orval from OpenAPI spec → React Query hooks
- AI: OpenAI gpt-5.4 via `@workspace/integrations-openai-ai-server`

## Where things live

- `lib/api-spec/openapi.yaml` — OpenAPI source of truth
- `lib/db/src/schema/` — Drizzle schema (clients, tax-documents, w2-data, tax-returns, adjustments)
- `lib/api-client-react/src/generated/` — generated React Query hooks + Zod schemas
- `lib/api-zod/src/index.ts` — generated server-side Zod schemas
- `artifacts/api-server/src/routes/` — Express route handlers
- `artifacts/api-server/src/lib/taxCalculator.ts` — 2024 federal/state tax brackets
- `artifacts/api-server/src/lib/documentExtractor.ts` — OpenAI W-2 extraction
- `artifacts/tax-app/src/pages/` — React pages (Dashboard, ClientList, ClientDetail, ClientForm)

## Architecture decisions

- Contract-first: OpenAPI spec gates codegen, which gates the frontend. Never write API calls by hand.
- Tax returns are upserted (one per client) — recalculate overwrites the existing record.
- W-2 extraction is async: document is inserted with status=processing, extraction runs in background, then updates status + inserts w2_data row.
- Numeric DB columns use Drizzle `numeric` type (stored as strings, converted to numbers in API responses).
- Frontend uses port 3000 (required for Replit workflow port detection — must be in supported ports list).

## Product

- Dashboard: firm-wide stats (total clients, pending returns, total refunds, avg refund)
- Client management: create, edit, delete clients with filing status + state
- Document upload: upload W-2s/1099s, AI auto-extracts all box values
- W-2 Data: view and edit all W-2 boxes per client, supports multiple W-2s
- Tax Calculator: computes federal + state tax liability using 2024 brackets, shows refund/owed
- Adjustments: CPA-authored deductions, credits, additional income, withholding adjustments applied to calculation

## Gotchas

- Tax-app port MUST be 3000 (or another Replit-supported port). Port 22517 (original createArtifact allocation) is not monitored by the workflow system.
- Run `pnpm --filter @workspace/api-spec run codegen` after any OpenAPI change — it regenerates both `lib/api-client-react` and `lib/api-zod`.
- Numeric Drizzle columns serialize as strings — always `String(val)` on insert, `Number(val)` on read.
- W-2 data tab shows records that were auto-inserted by document upload (AI extraction).

## Pointers

- `pnpm-workspace` skill — workspace structure, TypeScript setup, codegen workflow
- `react-vite` skill — frontend patterns and routing conventions
- `ai-integrations-openai` skill — OpenAI integration setup
