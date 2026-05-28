# Handoff Note — 2026-05-28 (Brookhaven UI/UX revamp + UI follow-ups)

Session continuation point for the next Claude (or human) working on
TaxFlow Assistant.

## ⚡ Read this first

The full open TODO is in **`docs/todo.md`** — durable, git-tracked.
Coverage map: **`docs/coverage-matrix.md`**. C3 validation memo:
**`docs/c3-design-partner-validation-2026-05-27.md`**.

This session was **frontend-only** — the tax engine, api-server, schema,
and all calc logic are UNTOUCHED. All 35 no-API test suites still pass
(0 failures, ~3,200 assertions). No DB migration.

## Headline

**Full UI/UX modernization to the Brookhaven brand + the two open UI
follow-ups shipped.** The app was rebranded from the generic shadcn
slate/near-black theme to the Brookhaven palette and given a modern
layout. Plus: the cramped ClientDetail tab bar was redesigned, and the
two pending UI follow-ups (Form 8824/8990 download buttons, SSTB toggle)
are now surfaced.

### What changed

1. **Brookhaven design tokens** (`src/index.css`) — rebuilt the light +
   dark CSS-variable palette to the brand:
   - Trusted Blue `#231F55` → `--primary` (HSL `244 47% 23%`)
   - Brookhaven Blue `#41B9EA` → new `--brand` (`197 80% 59%`) + `--brand-ink`
     (`200 78% 38%`, the darker variant used for text/links on light bg)
   - Yellow `#F0CA17` → new `--gold` (`49 88% 52%`)
   - Powder Blue `#8ED4F0` → new `--powder` (`197 77% 75%`)
   - Added `--success` (green) + kept `--destructive`. **Fixed the
     template's anti-pattern** where `--accent` was bright yellow (it leaked
     into every Radix menu/select hover) — `--accent` is now a subtle cool
     tint (proper shadcn semantics); explicit `--gold`/`--brand` carry the
     brand pops.
   - New utilities: `.bg-brand-gradient` / `.bg-brand-gradient-soft` /
     `.text-gradient-brand` (45° per brand guide), `.brand-pattern` (45°
     woven texture), `.scrollbar-thin`.
   - The `--color-*` tokens are registered in the `@theme inline` block so
     `bg-brand`, `text-brand-ink`, `bg-gold`, `text-success`, `bg-powder`,
     etc. all work.
2. **Global chrome** (`src/App.tsx` + new `src/components/BrandMark.tsx`) —
   Trusted Blue sidebar with the 45° brand-pattern texture, the three-bar
   Brookhaven brand mark (inline SVG, `BrandMark`), lucide nav icons,
   gold-tinted demo banner. New **mobile top bar** (sidebar is `hidden
   lg:flex`; a compact navy top bar shows < lg). Favicon rebranded.
3. **Cramped tab bar redesigned** (`ClientDetail.tsx`) — replaced the
   `grid-cols-11` (tabs literally collided) with a horizontally-scrollable
   pill bar: `flex gap-1 overflow-x-auto scrollbar-thin`, each tab an
   icon + label pill with proper spacing. Active = card pill + brand text.
4. **Dashboard + ClientList modernized** — icon-chip stat cards (the
   "Total Refunds" metric is now `text-success` green, was an invisible
   faint tint after the accent fix), branded planning widget with rank
   chips + chevrons; ClientList got a search icon + branded "New Client".
5. **Hardcoded-color sweep** — 172 hardcoded palette classes (slate/indigo/
   purple/emerald/blue/etc.) mapped to brand/semantic tokens across
   ClientDetail + ClientForm + modals. Only semantic amber warnings kept.
   0 residual off-brand tokens.
6. **Form 8824 / 8990 PDF buttons** (UI follow-up) — added inside the
   §1031 (`Section1031Card`) and §163(j) (`Section163j461lCard`) summary
   cards in the Tax Calculator tab. Wired to
   `GET /clients/:id/form-8824/pdf` and `/form-8990/pdf` via a new
   `downloadFile()` helper. Cards (and buttons) only render when the
   relevant data exists. Verified end-to-end (injected a §1031 scenario:
   recognized $50k / deferred $150k; PDF downloads).
7. **SSTB toggle** (UI follow-up) — dedicated "§199A Qualified Business
   Income" card at the top of the Adjustments tab with an SSTB `Switch`.
   Toggling creates/updates the `qbi_sstb_flag` adjustment the engine
   reads; the raw flag is filtered out of the adjustment list (the toggle
   is the canonical control). Added the label to the adjustment-type
   dropdown too. Verified: POST 201 + list refetch + round-trips.
8. **Print CSS fix** — removed an invalid `:contains()` pseudo-class from
   the print `@media` block (it was also stale after the banner restyle);
   added `print:hidden` to the demo banner instead. Production build is
   now warning-free (aside from pre-existing chunk-size + sourcemap notices).

## Verification (this session)

- `pnpm --filter @workspace/tax-app run typecheck` — clean.
- All 35 no-API tax-engine suites — **0 failures** (engine untouched).
- `pnpm --filter @workspace/tax-app run build` — succeeds (1844 modules,
  ~1.5s), no new warnings.
- Live click-through (preview): Dashboard, ClientList, ClientForm
  create + edit (Radix `formReady` gate confirmed — selects keep their
  values), Documents, Adjustments (+ SSTB toggle POST verified), Tax
  Calculator (+ §1031 card + Form 8824 button + green refund hero),
  Planning (rich, on-brand), Assets, and mobile (375px) — **no console
  errors/warnings anywhere.**

## Deploy steps (for the user)

NO DB migration. NO api-server change (frontend-only). But the api-server
must still be built once on the box if it isn't current; the frontend is
built locally and rsync'd.

```bash
# --- API box (only needed if api-server isn't already current; nothing
#     changed in api-server this session, so this is optional) ---
ssh -i ~/Downloads/taxflow-key.pem ubuntu@ec2-18-188-192-154.us-east-2.compute.amazonaws.com
cd ~/taxflow-pro
git checkout -- pnpm-lock.yaml
git pull origin main
pnpm install
# no db push, no api rebuild required (frontend-only change)
curl http://localhost:8080/api/healthz   # sanity
exit
```

```bash
# --- Local: build frontend + rsync the static bundle (REQUIRED) ---
pnpm --filter @workspace/tax-app run build
rsync -e "ssh -i ~/Downloads/taxflow-key.pem" -avz --delete \
  artifacts/tax-app/dist/public/ \
  ubuntu@ec2-18-188-192-154.us-east-2.compute.amazonaws.com:~/taxflow-pro/artifacts/tax-app/dist/public/
```

The api-server serves the static files directly (no nginx). Verify at
http://ec2-18-188-192-154.us-east-2.compute.amazonaws.com — the sidebar
should be Trusted Blue navy with the three-bar mark, and the client tab
bar should be spaced pills.

## What's left (post-revamp)

Engineering UI work is in good shape. Strategic open items unchanged:
1. **A1 — CPA outreach campaign** (blocked on user availability).
2. **D15 — multi-tenancy auth** (2-3 wks; required before charging).
3. **D18 — Stripe billing** (depends on D15).
- Optional UI polish: dark-mode toggle (tokens exist but there's no toggle
  in the UI), code-split the 1 MB JS bundle, refactor ClientDetail.tsx
  (now ~4,960 lines) into per-tab sub-components (D7).

## How to start the next Claude session

```
Project: TaxFlow Assistant.

Read these first: docs/todo.md, docs/coverage-matrix.md, .claude/handoff.md, CLAUDE.md.

Where we left off (2026-05-28): full Brookhaven UI/UX revamp shipped +
the two open UI follow-ups (Form 8824/8990 download buttons, SSTB toggle).
Frontend-only; engine + all 35 no-API test suites still green. Brand
tokens in src/index.css; brand mark in src/components/BrandMark.tsx.

Top recommendation: A1 CPA outreach (packet complete), then D15
multi-tenancy auth → D18 Stripe for paid rollout.
```
