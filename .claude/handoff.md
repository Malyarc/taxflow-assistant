# Handoff Note — 2026-05-26 (Phase G5 Pro-tier gating shipped — Phase G complete)

Session continuation point for the next Claude (or human) working on
TaxFlow Assistant.

## Headline

**Phase G5 — Pro-tier feature flag landed end-to-end.** With G5, Phase
G is now COMPLETE (G1+G2+G3+G4+G5). All planning surfaces are gated
behind a single `PRO_TIER_ENABLED` env var on the api-server; default
`true` preserves existing behavior, toggling to `false` flips the UI
into upsell mode and locks the planning endpoints with HTTP 402.

Engine still at zero documented gaps. Engine math is unchanged
(740+ pure assertions across 6 suites still green). 21 new dual-state
gating assertions verify both Pro-on and Pro-off branches.

## What landed (session commits)

| Commit | Title |
|---|---|
| 1 | G5 backend — config + /settings endpoint + planning 402 middleware + OpenAPI + codegen + UpgradeProCard + frontend gating + 21 dual-state integration assertions + docs |

(Shipping as a single tight commit; everything is interdependent and
small. Server-only changes wouldn't be testable without the frontend;
frontend gating wouldn't be observable without the server flag.)

## Test state

- **193/193 tax-engine-tests** (regression sweep)
- **37/37 tax-engine-deep-tests**
- **210/210 deep-audit assertions** (unchanged)
- **97/97 accuracy-audit assertions** (unchanged)
- **133/133 G1 planning unit tests** (unchanged)
- **70/70 G4 multi-year unit tests** (unchanged)
- **29/29 planning integration tests** (unchanged, Pro-on)
- **5/5 pro-tier integration (Pro-on branch) — NEW**
- **16/16 pro-tier integration (Pro-off branch) — NEW**
- Workspace typecheck clean across all 12 workspaces.
- **Engine net: ZERO documented gaps** (preserved).

## Architecture (Phase G5 specifics)

### Server config (`artifacts/api-server/src/lib/config.ts`)

Single-source-of-truth for env-driven flags. `parseBoolEnv()` accepts
`true/1/yes/false/0/no` (case-insensitive). Default value passed by
caller. Exports `config` object frozen at module load:

```ts
export const config = {
  proTierEnabled: parseBoolEnv(process.env.PRO_TIER_ENABLED, true),
};
```

### `/api/settings` endpoint (`routes/settings.ts`)

Returns `{ proTierEnabled: boolean }`. The frontend reads this via the
auto-generated `useGetSettings` React Query hook. Add new public flags
to this surface only when the client needs them; never expose secrets.

### Planning router middleware (`routes/planning.ts`)

A single `router.use((_req, res, next) => ...)` at the top of the
planning router returns HTTP 402 + JSON body when the flag is off:

```json
{
  "error": "Pro tier required",
  "code": "PRO_TIER_REQUIRED",
  "message": "Tax-planning features ... are available on the Pro tier..."
}
```

Stable `code` field for frontend logic to key off. All six planning
endpoints are gated by virtue of being inside the planning router.

### Frontend gating

`useGetSettings` is wired in **Dashboard** and **ClientDetail**:

- **Dashboard**: When `settings?.proTierEnabled === false`, renders
  `<UpgradeProCard variant="widget" />` in place of `<PlanningHitListWidget />`.
- **ClientDetail**: When `settings?.proTierEnabled === false`, the
  "Planning" `<TabsTrigger>` is hidden, the `<TabsContent>` is not
  rendered, and the grid drops from `grid-cols-10` to `grid-cols-9`.
- Both surfaces gate **only on explicit `=== false`**, not on missing/
  loading data, so existing Pro firms don't see a flash of "no Planning"
  during the brief settings fetch.

### `<UpgradeProCard>` (`components/UpgradeProCard.tsx`)

The visual paywall. Indigo + emerald gradient, dashed border,
"Pro" badge, feature list of what's gated (10 G1 + 5 G4 + AI memo +
hit list), and a disabled "Upgrade to Pro" button. Two variants
(`widget` for dashboard, `tab` for ClientDetail — only `widget` is
used in this rollout since the Planning tab is hidden entirely when
off, but the variant is available for future "show as locked tab" UX).

## Production verification (post-deploy)

After EC2 deploy with `PRO_TIER_ENABLED=true`:

```bash
# Confirm settings endpoint exposes the flag
curl http://ec2-18-188-192-154.us-east-2.compute.amazonaws.com/api/settings
# → {"proTierEnabled":true}

# Confirm planning endpoint still works (Pro on)
curl http://ec2-18-188-192-154.us-east-2.compute.amazonaws.com/api/clients/<ID>/planning-opportunities
# → 200 with hits

# Re-run gate tests (locally) against EC2 by tunneling, OR ssh + run pro-tier tests
ssh ec2:~/taxflow-pro && pnpm --filter @workspace/scripts exec tsx src/tax-engine-pro-tier-tests.ts
```

To flip to off-state on EC2 (e.g., during pricing rollout):
1. `pm2 set taxflow:PRO_TIER_ENABLED false`
2. `pm2 restart taxflow --update-env`
3. Verify `/api/settings` → `false`, planning endpoints → 402.

## Visual verification (this session)

Verified end-to-end in the local browser preview:

**Pro=ON (default):**
- Dashboard shows the "Top 10 planning targets" widget
- ClientDetail shows 10 tabs incl. "Planning"; `grid-cols-10`
- Planning tab content renders G1 hits + G4 "Multi-year trends" section
  with catalog v1.1.0

**Pro=OFF (with `PRO_TIER_ENABLED=false` env override):**
- Dashboard shows the `UpgradeProCard` in place of Top-10 widget
- ClientDetail shows 9 tabs (no "Planning"); `grid-cols-9`
- All planning endpoints respond 402 (confirmed via 16 integration
  assertions covering all six paths + body shape)

## Open items (next session priorities)

**Option A (RECOMMENDED): CPA design-partner outreach (C11). No code.**
Strongest pitch position to date — Phase G fully complete + zero
documented engine gaps + Pro-tier gating ready for pricing rollout.
Pair `docs/outreach/cold-email.md` with a screen record of the
Planning tab on `edge-big-ltcg` (G4.1 with $93k headline savings).

**Option B — Phase D15 CPA-firm multi-tenancy auth (~2-3 weeks).**
Required before charging real money. Wires `actorUserId` into
audit_log. Per-firm tables, RBAC, per-client visibility. Hold until
a paid partner is committed; this is the gate to billing.

**Option C — Phase D18 Stripe billing (1-2 weeks, requires D15 first).**
G5 already wires the gate; D18 migrates the env-var flag to a per-firm
column (added in D15) plugged into a Stripe subscription state.

**Option D — Phase E reactive items as customers ask.** Charitable
carryforward, AMT credit carryforward, §179, 1099-R penalty,
part-year residency, other local taxes. Don't build speculatively.

## Sub-gaps + known limits (Phase G5)

- **G5 is server-wide, not per-firm.** Single env var on the api-server
  applies to ALL clients/firms. Per-firm gating waits for D15
  multi-tenancy (which adds a firms table and the place to put a
  per-row `proTierEnabled`). Migration path documented in roadmap.
- **CTA button is a non-functional placeholder.** The "Upgrade to Pro"
  button on the paywall card is intentionally disabled. Real billing
  is D18 (Stripe).
- **No flash-of-paywall during settings load.** Both surfaces default
  to Pro-on while settings is loading. If settings ever fails to load,
  we fall through to showing Planning (failing open). For a paid
  product this would need to fail closed; that's a D18 hardening.
- **Tab restore behavior.** Tabs use `defaultValue="documents"`, so
  if a user previously had Planning open and then Pro turns off,
  they land on Documents (the default). Acceptable for the
  no-stateful-URL design.

## EC2 deploy

Schema unchanged. Only api-server build + pm2 restart + frontend rsync
+ optional pm2 env update for the new flag (default `true` keeps
existing behavior).

```bash
ssh -i ~/Downloads/taxflow-key.pem ubuntu@ec2-18-188-192-154.us-east-2.compute.amazonaws.com
cd ~/taxflow-pro
git checkout -- pnpm-lock.yaml
git pull origin main
pnpm install
export DATABASE_URL=$(pm2 env 0 | awk -F": " '/^DATABASE_URL:/ {print $2; exit}')
export AI_API_KEY=$(pm2 env 0 | awk -F": " '/^AI_API_KEY:/ {print $2; exit}')
# (Optional) export PRO_TIER_ENABLED=false  # if you want to flip the gate
pnpm --filter @workspace/api-server run build
pm2 restart taxflow
curl http://localhost:8080/api/healthz
curl http://localhost:8080/api/settings

# Frontend — UpgradeProCard + settings hook are new. Build locally + rsync:
# LOCAL:
pnpm --filter @workspace/tax-app run build
rsync -e "ssh -i ~/Downloads/taxflow-key.pem" -avz --delete \
  artifacts/tax-app/dist/public/ \
  ubuntu@ec2-18-188-192-154.us-east-2.compute.amazonaws.com:~/taxflow-pro/artifacts/tax-app/dist/public/
```

## How to start the next Claude session

```
Project: TaxFlow Assistant.

Read these files first, in order:
  1. .claude/handoff.md           — Phase G5 shipped + Phase G complete (this session)
  2. .claude/roadmap.md           — Phase D / Phase 5 / reactive E items
  3. CLAUDE.md                    — invariants, closure log, planning architecture
  4. docs/outreach/cold-email.md  — if doing C11 outreach

Where we left off (2026-05-26): Phase G is now fully complete.
G1 (10 single-year detectors), G2 (firm-wide hit list), G3 (AI
synthesis), G4 (5 multi-year detectors), G5 (Pro-tier env-var gate).
Engine still at zero documented gaps. 1,790+ test assertions across
28 suites. Pro-tier gating verified end-to-end in both states.

This session, pick ONE:

  Option A — RECOMMENDED. CPA design-partner outreach (C11). No code.
  Strongest pitch position ever — Phase G complete + zero documented
  engine gaps. Pair docs/outreach/cold-email.md with a screen record
  of the Planning tab on edge-big-ltcg (G4.1 $93k headline).

  Option B — Phase D15 CPA-firm multi-tenancy auth (~2-3 weeks).
  Required before charging real money. Hold until paid partner.

  Option C — Phase D18 Stripe billing (1-2 weeks, requires D15 first).

  Option D — Phase E reactive items only when a customer asks.

Quality bar (same as prior sessions):
- Each chunk ships as its own commit
- All existing tests must stay at 0 real failures
- Update roadmap.md / CLAUDE.md / handoff.md at session end
- Deploy to EC2 at the end
```
