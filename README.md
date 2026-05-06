# TaxFlow Pro

A CPA tax filing efficiency app — upload W-2s, auto-extract data via AI (Google Gemini), calculate federal/state taxes, manage client adjustments.

## Stack

- **Frontend**: React 19 + Vite + Tailwind CSS + shadcn/ui + wouter
- **API**: Node.js 24 + Express 5 + Pino
- **DB**: PostgreSQL + Drizzle ORM
- **AI**: Google Gemini via OpenAI-compatible endpoint (`gemini-2.5-flash`)
- **Build**: pnpm workspaces, TypeScript 5.9

## Prerequisites

- Node.js 22 or 24, pnpm 9+
- PostgreSQL 14+ (local Docker, Amazon RDS, Neon, Supabase — any will do)
- Google AI Studio API key (free): https://aistudio.google.com/

## Local development

```bash
# 1. Copy env example and fill in values
cp .env.example .env
# Edit .env: set DATABASE_URL and AI_API_KEY

# 2. Install dependencies
pnpm install

# 3. Push the DB schema (creates all tables)
pnpm --filter @workspace/db run push

# 4. Run API server (port 8080) and frontend (port 3000) in two terminals
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/tax-app run dev
```

Open http://localhost:3000.

The Vite dev server proxies `/api/*` to the API server, so you don't need CORS config locally.

## Production build

```bash
pnpm install
pnpm --filter @workspace/tax-app run build       # builds React → artifacts/tax-app/dist/public
pnpm --filter @workspace/api-server run build    # builds Express → artifacts/api-server/dist
```

In production, the API server **also serves the React build**, so you run a single Node process. The server auto-detects the static dir at `../tax-app/dist/public` (override with `STATIC_DIR`).

```bash
DATABASE_URL=... AI_API_KEY=... node artifacts/api-server/dist/index.mjs
```

## Deploying to AWS EC2

### Quick path (single t3.small instance)

1. **Launch an EC2 instance** (Amazon Linux 2023 or Ubuntu 22.04, t3.small or larger).
2. **Open port 80** (or 443) in the security group.
3. **SSH in and install Node.js + pnpm**:
   ```bash
   curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -    # Amazon Linux
   sudo yum install -y nodejs git
   sudo npm install -g pnpm pm2
   ```
4. **Set up the database**. Either:
   - Run Postgres on the same instance: `sudo yum install -y postgresql15-server && sudo postgresql-setup --initdb && sudo systemctl enable --now postgresql`
   - Or provision Amazon RDS PostgreSQL and use its connection string.
5. **Clone & build**:
   ```bash
   git clone <your-repo> taxflow-pro && cd taxflow-pro
   cp .env.example .env && nano .env       # set DATABASE_URL and AI_API_KEY
   pnpm install
   pnpm --filter @workspace/db run push
   pnpm --filter @workspace/tax-app run build
   pnpm --filter @workspace/api-server run build
   ```
6. **Run with PM2** (auto-restart on crash, survives reboot):
   ```bash
   cd artifacts/api-server
   sudo PORT=80 $(which pm2) start dist/index.mjs --name taxflow --update-env
   sudo $(which pm2) save && sudo $(which pm2) startup
   ```

Hit the public IP — the React app is now live.

### Add HTTPS (recommended)

Put nginx in front of Express on port 8080, then use Certbot for a Let's Encrypt cert. nginx config example:

```nginx
server {
    listen 80;
    server_name your-domain.com;
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Then `sudo certbot --nginx -d your-domain.com`.

## Repo layout

```
artifacts/
  api-server/       Express API + serves frontend in production
  tax-app/          React frontend (Vite)
lib/
  api-spec/         OpenAPI source of truth (openapi.yaml)
  api-zod/          Generated server-side Zod schemas
  api-client-react/ Generated React Query hooks (Orval)
  db/               Drizzle ORM schema + connection
  integrations-openai-ai-server/   AI client (server)
scripts/            Workspace utility scripts
```

## API codegen

The OpenAPI spec at `lib/api-spec/openapi.yaml` is the source of truth. After editing it, regenerate clients:

```bash
pnpm --filter @workspace/api-spec run codegen
```

This regenerates `lib/api-client-react/src/generated/` and `lib/api-zod/src/generated/`.

## Tax calculations

Tax engine lives in `artifacts/api-server/src/lib/taxCalculator.ts` and `stateTaxData.ts`. Uses **real 2024 brackets** for both federal and state.

**Federal**: IRS Rev. Proc. 2023-34 — all five filing statuses (Single, MFJ, MFS, HoH, QW), 2024 standard deductions.

**State**: 2024 brackets and standard deductions for all 41 income-tax states + DC. Nine no-income-tax states return `$0` (AK, FL, NV, NH, SD, TN, TX, WA, WY). Includes:
- Per-filing-status brackets where the state publishes them (CA and NY both have separate HoH brackets, for example)
- Special surtaxes (MA "millionaire's tax" 4% over $1.05M; CA mental-health 1% over $1M)
- States with 0% lower brackets (ND, OH, SC)
- Flat-tax states (CO, IL, IN, KY, MA, MI, NC, PA, UT, AZ, ID, GA, MS)

**Known approximations** (this is a calculator, not tax software):
- State exemptions and personal-exemption credits are not modeled (PA, IL, IN, MI, MA, CT, NJ, WV, UT use these instead of/alongside std deductions).
- State-specific credits (state EITC, CTC) are not modeled — use the Adjustments tab to record them as credits.
- Local income taxes are not modeled (NYC, Yonkers, MD counties, OH cities, Indiana counties).
- AMT, QBI deduction, NIIT (federal) are not modeled.
- State taxable income = federal AGI − state std deduction. Real state calcs often modify federal AGI (e.g. add back state-tax refunds, subtract state-tax-exempt bond interest).

CPA-authored adjustments support five types:
- `deduction` — above-the-line, reduces AGI
- `credit` — non-refundable credit, reduces tax owed
- `additional_income` — adds to total income
- `withholding_adjustment` — adds to withholding (e.g. estimated payments)
- `other` — treated as above-the-line for now

## Environment reference

See [`.env.example`](.env.example).

| Var | Required | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | yes | — | Postgres connection string |
| `AI_API_KEY` | optional | — | Google AI Studio key. If unset, AI extraction is silently skipped. |
| `AI_MODEL` | optional | `gemini-2.5-flash` | Any OpenAI-compatible vision model |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | optional | Gemini compat URL | Override for OpenAI / Groq / Ollama |
| `PORT` | optional | `8080` | API server port |
| `STATIC_DIR` | optional | `../tax-app/dist/public` | React build location for production serving |
