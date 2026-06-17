# Workstation Migration — TaxFlow Assistant

**Purpose:** stand up this project on a brand-new workstation so you can work
exactly the way you do on the current machine — backend, frontend, database,
the full test/green-bar workflow, Claude Code, and EC2 prod deploys.

**Same Claude account** is assumed (login carries your subscription, but NOT your
local config — those files are hand-carried; see §2).

> ## FOR CLAUDE (read this first if a human just asked you to "set up this project from this file")
>
> You are running on a fresh workstation. Execute the sections **in order** (§0 → §8).
> Rules:
> 1. **Assume macOS on Apple Silicon** unless the human says otherwise. Linux notes are inline; on Windows, use WSL2 and follow the Linux notes.
> 2. **Run one section at a time and verify its checkpoint (✅) before moving on.** If a checkpoint fails, STOP and diagnose — do not barrel ahead.
> 3. **You cannot transfer secrets yourself.** When you reach a 🔑 step, ASK the human to provide the file/value (the EC2 key, the AI key, the `~/.claude` files). Never invent or commit them.
> 4. **Never write any secret into a tracked file.** Secrets live only in `~/.env` and `~/Downloads/taxflow-key.pem` and `~/.claude/`.
> 5. After everything is green, also read `CLAUDE.md` and `.claude/handoff.md` in this repo — they are the project's operating manual and current state.
> 6. The repo path matters: clone to **`~/Documents/taxflow-assistant`** and use the **same macOS username** as the old machine if possible — `.claude/launch.json` and the Claude memory dir are keyed to the absolute path.

---

## 0. What transfers automatically vs. what you hand-carry

| Comes via `git clone` (already in the repo) | You must HAND-CARRY (secret/local — never in git) |
|---|---|
| All source: `artifacts/` (api-server, tax-app), `lib/` (db, api-spec, integrations), `scripts/` | 🔑 **EC2 SSH key** → `~/Downloads/taxflow-key.pem` |
| 25 committed DB migrations (`lib/db/drizzle/0000…0024`) | 🔑 **`AI_API_KEY`** (Google AI Studio / Gemini key) — for local AI extraction |
| `CLAUDE.md` (project), `.claude/handoff.md`, `.claude/launch.json`, `docs/` | 🔑 **`~/.claude/CLAUDE.md`** (your global standing directives) |
| `.env.example` (env template), `pnpm-workspace.yaml`, lockfile, CI workflow | 🔑 **`~/.claude/settings.json`** (effort/workflows/thinking config) |
| The whole MASTER-TODO / docs tree | 🔑 **Claude project memory** dir (see §7) |

There is **no real production data to migrate** — prod (EC2) and local are
synthetic-data demos. The database is reconstructed from committed migrations
(+ optional seed). If you want your *exact* current local rows, see §5.4 (optional `pg_dump`).

---

## 1. Install the toolchain (macOS, Apple Silicon)

```bash
# 1a. Xcode Command Line Tools (git, compilers)
xcode-select --install   # skip if `git --version` already works

# 1b. Homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
# then follow its "Next steps" to add brew to your PATH (eval "$(/opt/homebrew/bin/brew shellenv)")

# 1c. Node 22 LTS  (CI + the EC2 prod box run Node 22; match it)
brew install nvm
mkdir -p ~/.nvm
# add to ~/.zshrc if not present:  export NVM_DIR="$HOME/.nvm"; [ -s "$(brew --prefix nvm)/nvm.sh" ] && . "$(brew --prefix nvm)/nvm.sh"
nvm install 22 && nvm use 22 && nvm alias default 22

# 1d. pnpm 10.33.0 via corepack (pinned by package.json "packageManager")
corepack enable
corepack prepare pnpm@10.33.0 --activate

# 1e. Docker Desktop (for local Postgres) — then LAUNCH it from /Applications
brew install --cask docker

# 1f. Claude Code CLI  (then `claude` once and log in to the SAME account)
#     Install per https://docs.claude.com/claude-code ; login is interactive.

# 1g. Heap headroom for big builds/test runs — add to ~/.zshenv
echo 'export NODE_OPTIONS="--max-old-space-size=8192"' >> ~/.zshenv
```

**Optional (only if you run these):**
- **Differential-oracle harness** (`scripts/src/tax-engine-differential-oracle-harness.ts`): needs `python3` (3.11+) + `pip install tenforty`. It is **not** part of the standard green bar and historically won't build on the stock macOS Python 3.9 — skip unless you specifically need it.
- **PDF reading** of the Brand Bible etc.: `brew install poppler` and/or `pip install pymupdf`.

> **Node note (IMPORTANT):** the repo pins **Node 22** via `.nvmrc`. The Vite 7 **dev server hard-requires Node ≥20.19 or ≥22.12** — on Node 20.11 the build still works but `pnpm --filter @workspace/tax-app run dev` throws `TypeError: crypto.hash is not a function`. If `nvm` already exists with an older default (e.g. 20.x), you MUST run `nvm alias default 22` (just installing 22 isn't enough — nvm only activates the *default* alias in a NEW shell). Verify a fresh terminal: `node -v` → v22.x.

✅ **Checkpoint:** `node -v` → v22.x · `pnpm -v` → 10.33.0 · `docker info` succeeds (Docker Desktop running) · `git --version` works.

---

## 2. Clone + install

```bash
mkdir -p ~/Documents
git clone https://github.com/Malyarc/taxflow-assistant.git ~/Documents/taxflow-assistant
cd ~/Documents/taxflow-assistant
corepack enable          # ensures pnpm@10.33.0 in this repo
pnpm install             # installs all workspace deps (may pause on packages <24h old — see Gotcha G7)
```

✅ **Checkpoint:** `pnpm install` finishes with no errors. (If you later pull a PR that adds a dependency, **re-run `pnpm install`** before typechecking — see Gotcha G1.)

---

## 3. Secrets & environment (no dotenv — vars are shell-exported)

The api-server and `drizzle-kit` read env vars **from the shell** (there is no
dotenv loader). Keep them in `~/.env` (home dir — never inside the repo) and
`source` it before running anything that needs them.

```bash
# Create ~/.env  (copy the keys from .env.example in the repo; fill in real values)
cat > ~/.env <<'EOF'
# Local Postgres (created in §5). Keep these creds — the URL is referenced everywhere.
export DATABASE_URL="postgres://brookhaven:brookhaven@localhost:5432/taxflow_pro"

# 🔑 Google AI Studio / Gemini key — for AI W-2/1099 extraction.
# Get a free key at https://aistudio.google.com/  (1,500 req/day on gemini-2.0-flash).
# If you don't need live AI right now, set a dummy value OR add:  export AI_DISABLED=true
export AI_API_KEY="PASTE_YOUR_GEMINI_KEY_HERE"

# Optional overrides (defaults target the Gemini OpenAI-compat endpoint):
# export AI_INTEGRATIONS_OPENAI_BASE_URL="https://generativelanguage.googleapis.com/v1beta/openai/"
# export AI_MODEL="gemini-2.5-flash"

# ⚠️ Do NOT put PORT here. Both the api-server (default 8080) and Vite (default 3000)
# read $PORT — a global PORT would make the backend bind the wrong port and break the
# frontend's /api proxy. Set PORT inline on the frontend command only (see §6).
EOF
chmod 600 ~/.env
```

Load it into any shell that runs the backend or DB tooling:

```bash
source ~/.env     # because the file uses `export`, this is all you need
```

🔑 **Hand-carry:** the real `AI_API_KEY`. Either copy your value from the old
machine's `~/.env` / shell, or mint a fresh free key (link above). The repo's
`.env.example` documents every supported variable.

✅ **Checkpoint:** `source ~/.env && echo "${DATABASE_URL:+DB ok} ${AI_API_KEY:+AI ok}"` prints `DB ok AI ok`.

---

## 4. (Same Claude account) make Claude Code work the same way

Login carries your account, but these **local** files do not — hand-carry them
from the old machine to the **same paths**:

```bash
# 🔑 From OLD machine → NEW machine (scp/AirDrop/USB), preserving paths:
#   ~/.claude/CLAUDE.md        → your global standing directives (MAX POWER, deploy policy, etc.)
#   ~/.claude/settings.json    → effortLevel xhigh, alwaysThinkingEnabled, enableWorkflows, etc.
#   ~/.claude/keybindings.json → (if you have one)
```

**Claude project memory** (the per-project facts Claude recalls each session)
lives under a path derived from the repo's absolute path with `/` → `-`:

```
~/.claude/projects/-Users-<USERNAME>-Documents-taxflow-assistant/memory/
```

If your new username is also `johntang` and you cloned to
`~/Documents/taxflow-assistant`, the dir is
`-Users-johntang-Documents-taxflow-assistant` and it lines up exactly — just
copy the `memory/` folder (incl. `MEMORY.md`) over. If the username/path
differs, copy the contents into the new machine's correspondingly-named dir.

**MCP servers / connectors** (preview tools, computer-use, QuickBooks, etc.):
reconnect them in the Claude app as needed — the in-app preview tooling drives
the frontend via `.claude/launch.json` (already in the repo).

✅ **Checkpoint:** start `claude` in the repo; it greets you for `taxflow-assistant`, and asking it "what's in my global CLAUDE.md" reflects your standing directives.

---

## 5. Database (Postgres in Docker)

The engine + API use Postgres. On the old machine it lives in a container shared
with the *haven* project; for a clean, self-contained taxflow setup, run a
**dedicated** container whose superuser/db match the documented `DATABASE_URL`
(so zero extra role steps).

### 5.1 Start Postgres

```bash
docker run -d --name taxflow-postgres \
  -e POSTGRES_USER=brookhaven \
  -e POSTGRES_PASSWORD=brookhaven \
  -e POSTGRES_DB=taxflow_pro \
  -p 5432:5432 \
  -v taxflow_pg_data:/var/lib/postgresql/data \
  --restart unless-stopped \
  postgres:16-alpine
```

> If port **5432** is already taken (e.g. you also run the haven Postgres), map a
> different host port, e.g. `-p 5433:5432`, and change `DATABASE_URL` to `…@localhost:5433/…`.

Wait until healthy:

```bash
until docker exec taxflow-postgres pg_isready -U brookhaven >/dev/null 2>&1; do sleep 1; done; echo "postgres ready"
```

### 5.2 Apply the schema (25 committed migrations)

```bash
cd ~/Documents/taxflow-assistant
source ~/.env
pnpm --filter @workspace/db run migrate    # drizzle-kit migrate — applies 0000…0024
```

### 5.3 (Optional) seed demo clients

The seed POSTs through the live API, so start the backend (§6) first, then:

```bash
source ~/.env
pnpm --filter @workspace/scripts exec tsx src/seed-dummy-clients.ts   # ~88 archetype clients
```

### 5.4 (Optional) copy your EXACT current local data instead of re-seeding

On the **old** machine (the container there may be named `haven-postgres`):

```bash
docker exec <old-postgres-container> pg_dump -U brookhaven -Fc taxflow_pro > ~/taxflow_pro.dump
```

Copy `taxflow_pro.dump` to the new machine, then:

```bash
docker exec -i taxflow-postgres pg_restore -U brookhaven -d taxflow_pro --clean --if-exists < ~/taxflow_pro.dump
```

✅ **Checkpoint:** `docker exec taxflow-postgres psql -U brookhaven -d taxflow_pro -c '\dt' | head` lists tables (clients, tax_returns, …).

---

## 6. Run the app locally (the "same way")

Two long-lived processes. Use two terminals (or let Claude Code's preview tooling start the frontend).

**Terminal 1 — backend (Express on :8080):**
```bash
cd ~/Documents/taxflow-assistant
source ~/.env
pnpm --filter @workspace/api-server run dev    # builds (esbuild) then starts dist/index.mjs
# health:
curl -s localhost:8080/api/healthz   # → {"status":"ok"}
```

**Terminal 2 — frontend (Vite, proxies /api → :8080):**
```bash
cd ~/Documents/taxflow-assistant
pnpm --filter @workspace/tax-app run dev              # Vite on :3000
#   to use port 3010 instead, set PORT inline on THIS command only:
# PORT=3010 pnpm --filter @workspace/tax-app run dev   # → http://localhost:3010
```

> **Port rule:** the backend must stay on **8080** (the Vite proxy target). Leave
> `PORT` unset in the backend shell (it defaults to 8080). Only ever set `PORT` for
> the *frontend* command, inline — never via `~/.env` (which the backend sources).

Inside **Claude Code**, the frontend dev server is wired in `.claude/launch.json`
(`tax-app-dev`), so `preview_start` / the preview tools work once the repo path
matches. Use `--webpack` only matters for the *haven* Next.js app; this app's
Vite dev server is light.

### Codegen / schema change workflow (unchanged from the old machine)
- Edit `lib/api-spec/openapi.yaml` → `pnpm --filter @workspace/api-spec run codegen` (regenerates api-zod + api-client-react).
- Edit `lib/db/src/schema/*` → `pnpm --filter @workspace/db run generate` → **review the generated SQL** → commit → it applies on the next `migrate`.

✅ **Checkpoint:** the React app loads at the Vite URL and the client list renders (live data from the API + DB).

---

## 7. Verify the full green bar

```bash
cd ~/Documents/taxflow-assistant
source ~/.env

pnpm run typecheck                                  # libs + api-server + tax-app + scripts
pnpm --filter @workspace/scripts run typecheck:tests
pnpm --filter @workspace/scripts run test:no-api    # expect: 133 suites / 8,108 assertions / 0 failed
```

The **yes-API** integration suites additionally need the backend on :8080 + the
DB up; run them after §6 is live (see the suite table in `CLAUDE.md`).

✅ **Checkpoint:** typechecks clean; `test:no-api` ends with `ALL NO-API SUITES GREEN`.

---

## 8. EC2 production deploy from the new machine

Prod: `http://ec2-18-188-192-154.us-east-2.compute.amazonaws.com` · box path `~/taxflow-pro` · process manager pm2 (app name `taxflow`).

### 8.1 Install the SSH key
🔑 Hand-carry `taxflow-key.pem` to `~/Downloads/taxflow-key.pem`, then:
```bash
chmod 600 ~/Downloads/taxflow-key.pem
ssh -i ~/Downloads/taxflow-key.pem ubuntu@ec2-18-188-192-154.us-east-2.compute.amazonaws.com 'echo SSH_OK && cd ~/taxflow-pro && git rev-parse --short HEAD'
```

> Prod secrets (the Neon `DATABASE_URL`, `AI_API_KEY`) are **baked into the pm2
> process on the box** — you do NOT need them locally. The deploy reads them via
> `pm2 env 0`. So a new workstation needs only the `.pem` key to deploy.

### 8.2 Deploy the backend (pull → install → migrate → build → restart → health)
```bash
ssh -i ~/Downloads/taxflow-key.pem ubuntu@ec2-18-188-192-154.us-east-2.compute.amazonaws.com 'bash -s' <<'REMOTE'
set -e
cd ~/taxflow-pro
git checkout -- pnpm-lock.yaml 2>/dev/null || true   # the box's lockfile conflicts every pull
git pull origin main
pnpm install
export DATABASE_URL=$(pm2 env 0 | awk -F": " '/^DATABASE_URL:/ {print $2; exit}')
export AI_API_KEY=$(pm2 env 0 | awk -F": " '/^AI_API_KEY:/ {print $2; exit}')
pnpm --filter @workspace/db run migrate
pnpm --filter @workspace/api-server run build
pm2 restart taxflow --update-env
sleep 3
curl -s localhost:8080/api/healthz   # → {"status":"ok"}
REMOTE
```

### 8.3 Deploy the frontend (build LOCALLY, then rsync — the box OOMs on Vite)
```bash
cd ~/Documents/taxflow-assistant
pnpm --filter @workspace/tax-app run build
rsync -e "ssh -i ~/Downloads/taxflow-key.pem" -avz --delete \
  artifacts/tax-app/dist/public/ \
  ubuntu@ec2-18-188-192-154.us-east-2.compute.amazonaws.com:~/taxflow-pro/artifacts/tax-app/dist/public/
```

### 8.4 Smoke test prod (from your Mac, against the public URL)
```bash
BASE=http://ec2-18-188-192-154.us-east-2.compute.amazonaws.com
curl -s $BASE/ | grep -oE 'index-[A-Za-z0-9_-]+\.(js|css)'   # new build hash served
curl -s -o /dev/null -w "clients %{http_code}\n" "$BASE/api/clients?limit=1"
```

> Full deploy policy, the destructive-migration rule, and the planning-score
> re-score sweep are in **`CLAUDE.md` → "EC2 deploy" / "Deploy policy"** — read
> them before any schema change. Demo box keeps `API_AUTH_TOKEN` /
> `PII_ENCRYPTION_KEY` unset and `REQUIRE_7216_CONSENT=false`.

✅ **Checkpoint:** prod health is `{"status":"ok"}`, the served frontend hash matches your local build, and `/api/clients` returns 200.

---

## 9. Gotchas (hard-won — carry them over)

- **G1 — after pulling a PR that adds a dependency, run `pnpm install` BEFORE typecheck/build.** A stale `node_modules` fails with e.g. `Cannot find module 'zod'` (+ cascade implicit-`any` on zod `.transform`/`.refine` callbacks). Not a code bug — just install.
- **G2 — no dotenv.** If the API "can't connect to DB" or AI is off, you forgot `source ~/.env` in that shell.
- **G3 — EC2 `git pull` conflicts on `pnpm-lock.yaml` every time** → `git checkout -- pnpm-lock.yaml` first (already in the §8.2 script).
- **G4 — never build the frontend on the EC2 box** (908 MiB RAM → Vite OOM, exit 137). Build locally, rsync (§8.3).
- **G5 — don't `curl` the public DNS from *inside* EC2** (AWS drops the loopback). Use `localhost:8080` on the box; the public URL only from your Mac.
- **G6 — stale composite build:** if api-server typecheck stalls with "Property X does not exist" after a schema change, delete `lib/db/dist/` + `lib/db/tsconfig.tsbuildinfo`, then `pnpm --filter @workspace/db exec tsc -b --force`.
- **G7 — `pnpm-workspace.yaml` sets `minimumReleaseAge: 1440`** (supply-chain defense): installing a package published <24h ago will wait/skip. Leave it on.
- **G8 — Docker must be running** (Docker Desktop launched) before §5/§6, or `docker`/DB commands hang.
- **G9 — keep the repo at `~/Documents/taxflow-assistant` with the same username** so `.claude/launch.json`'s absolute `--dir` and the Claude memory-dir path line up. If you must change it, update `launch.json` and copy memory into the correspondingly-renamed dir.
- **G10 — frontend dev server needs Node ≥20.19/≥22.12.** If `preview_start`/`pnpm … dev` fails with `crypto.hash is not a function`, your active Node is too old. Fix: `nvm alias default 22` (the repo's `.nvmrc` pins 22), then open a NEW shell. `.claude/launch.json` is wired to `source nvm + nvm use 22` at spawn so the in-tool preview always gets 22 regardless of the parent shell's Node. The api-server + the test battery run fine on Node 20, so only the Vite dev server is affected.
- **G11 — Postgres may be the shared `haven-postgres` container** (if you also run the haven project). `taxflow_pro` + the `brookhaven` role live inside it; the DB volume is separate from the repo, so a folder-copy migration does NOT bring the data — bring the Docker volume (or re-migrate + re-seed). `migrate` will error with a column-collision on a local DB because local dev is baselined to migrations 0000+0001 and kept current via `drizzle-kit push`; run **`push`** locally (it reports "No changes detected" when current), not `migrate` (that's prod's path).

---

## 10. One-shot: what to tell Claude on the new machine

After installing the Claude Code CLI and logging in, open a session in (or
pointed at) the cloned repo and say:

> "Read `docs/WORKSTATION-MIGRATION.md` and set up this project on this machine.
> Execute §0–§8 in order, stop at each ✅ checkpoint to verify, and ask me for the
> hand-carry secrets (the EC2 `.pem`, the `AI_API_KEY`, and my `~/.claude` files)
> when you hit a 🔑 step."

Claude will install the toolchain, bring up Postgres, run migrations, start the
backend + frontend, prove the green bar, and wire up EC2 deploys — pausing only
for the secrets it cannot generate.
