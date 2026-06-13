# UX/UI 2.0 — design system (T2.3)

**Status: shipped 2026-06-12.** D1–D8 complete and browser-verified (light +
dark, desktop + mobile). This is the canonical reference for the modernized
front-end design layer.

Scope discipline (founder-sanctioned 2026-06-11): build the **portable layer**
(tokens, component patterns, IA, a11y) that transfers 1:1 to Haven's portals;
treat page-level rebuilds as **demos of the system**, not an SPA rewrite. The
Brookhaven palette stays; this modernizes structure, density, and trust cues.

---

## D8 — concept round → the pick

Three directions were considered for a CPA precision terminal:

| Exploration | Feel | Verdict |
|---|---|---|
| **A — Modern-dense ("Linear-like")** | Tight rows, keyboard-first, monochrome with one accent, fast | Great for the *review surface*; too cold/flat for a client-facing firm brand |
| **B — Classic-professional** | Generous spacing, serif accents, conservative | Trustworthy but slow at firm scale; wastes vertical space CPAs need |
| **C — Hybrid (PICKED)** | Dense data ergonomics *inside* a warm, branded shell; tabular numerics, provenance + tie-out trust cues | Best fit: prep-software density where the work happens, Brookhaven trust everywhere else |

**Decision: C (hybrid).** Keep the Brookhaven palette and the branded chrome
(dark sidebar, gradient marks), but adopt Linear-grade density + keyboard
ergonomics in the work surfaces (the return workspace, the engagement board),
and lead with the one thing no competitor shows: **provenance** ("why this
number") and **tie-outs** (✓/⚠) as first-class visual citizens.

---

## D1 — tokens v2

Source of truth: `artifacts/tax-app/src/index.css` (CSS variables) + thin TS
mirrors in `artifacts/tax-app/src/design/tokens.ts`.

- **Type scale** — a 1.20 modular scale exposed as Tailwind `--text-*` tokens
  AND as composite utility classes (`.t-eyebrow`, `.t-display`, `.t-metric`,
  `.t-num`). Type roles carry size/weight/rhythm only; **color is applied
  separately** so one role works on any surface. `.t-num` puts every dollar /
  percent on tabular-nums for column alignment.
- **Spacing** — Tailwind's 4px base scale (`--spacing`); documented in tokens.ts.
- **Elevation** — semantic, intent-named: `--elevation-card / -raised /
  -overlay / -popover` (mapped onto the existing shadow ramp) + matching
  `.elevation-*` utilities. Surfaces pick an *intent*, not a raw shadow.
- **Motion** — `--duration-fast/base/slow` + `--ease-standard/emphasized/exit`;
  collapsed to instant under `prefers-reduced-motion`.
- **Dark mode** — the Brookhaven `.dark` token set (already in index.css) is now
  switchable at runtime (see D7). All new surfaces are dark-safe by construction
  (semantic tokens only).
- **Enforcement** — `scripts/src/lint-semantic-tokens.ts`
  (`pnpm --filter @workspace/scripts run lint:tokens`) fails the build on any raw
  numbered Tailwind palette class (`bg-slate-100`, `text-violet-900`, …). The
  repo was driven to **zero** violations (amber/yellow allowed for warning
  callouts; white/black overlays on the dark sidebar are fine). This both
  enforces the system and fixes latent dark-mode bugs (a hardcoded
  `text-violet-900` is invisible on a dark card).

## D2 — IA + navigation

Four workspace destinations (`App.tsx`):

- **Today** (`/`) — the daily landing: firm KPIs, soonest deadlines, planning peek.
- **Clients** (`/clients`) — the roster.
- **Planning** (`/planning`) — firm-wide opportunities + campaign cohorts.
- **Firm** (`/firm`) — the busy-season engagement board.

**⌘K command palette** (`components/patterns/CommandPalette.tsx`): global
`⌘K`/`Ctrl-K` (and a sidebar trigger) → server-side client search, jump-to
(Today/Clients/Planning/Firm), quick actions, and theme switch. cmdk's built-in
filter is **off** (`shouldFilter={false}`) so the server's results are the truth;
the dialog is labelled (sr-only `DialogTitle`) for screen readers.

## D3 — return workspace

`pages/ReturnReview.tsx` at `/clients/:id/review` (entry: the "Review workspace"
button on ClientDetail) — a 3-pane review surface, a demo of the system, NOT a
rewrite (the source-entry tabs still live on ClientDetail):

- **Left rail** — the form tree (1040 + schedules) with per-form tie-out ✓/⚠.
- **Center** — the dense line-item grid; **keyboard-first**: ↑/↓ move (roving
  focus, ref-tracked so rapid presses never stall), Home/End jump, Enter opens
  provenance.
- **Right rail** — pre-filing diagnostics + the document-request tracker.

The grid + tie-outs are driven by `lib/returnModel.ts` (pure, Haven-portable):
it maps the computed `TaxReturn` to form lines, each carrying the engine
identity that produced it, with a residual line so every chain ties out by
construction (the same `checkLine` device the workpaper builders use).

## D4 — provenance ("why this number")

`components/patterns/Provenance.tsx` + `Money.tsx`. Any figure can be made
click-to-explain: it shows the **form line ← engine identity ← signed input
components**, with a ✓ when they tie out to a cent and a ⚠ when they don't.
Wired into the return workspace (every modeled line) and the existing Tax
Calculator (AGI, Taxable income). This is the trust differentiator — a CPA
cross-checking against their prep software sees the derivation, not a black box.

## D5 — one diff grammar

`lib/delta.ts` + `components/patterns/Delta.tsx`. A single model — *does an
increase help the taxpayer?* → tone → classes — for YoY, 1040-X amendments,
what-if, and roll-forward. The line/label classification sets (refund/credit
lines are higher-is-better; income/tax lines are higher-is-worse) moved here
verbatim from ClientDetail; the old `amendDeltaClass` / `yoyDeltaClass` are now
behavior-preserving shims over `deltaTone`, and ClientDetail imports them.

## D6 — workflow surfaces

- **Engagement board** (`pages/Firm.tsx`) — deadline-sorted, inline status
  editing (persists via `updateEngagement`), status-count tiles, urgency pills
  (overdue/soon/upcoming), refund-owed coloring, rows expand to the per-client
  doc-request tracker.
- **Doc-request tracker** (`components/patterns/DocRequestTracker.tsx`) — the
  organizer as a checklist with one status vocabulary (`StatusPill`) shared with
  the board; received/missing/question + a progress bar.
- **Today** — KPI tiles + upcoming deadlines + planning peek (the firm-wide
  planning widgets moved to `/planning`).

## D7 — accessibility + output polish

- **Dark mode** — `design/theme.tsx`: light / dark / **system**, persisted to
  localStorage, live-following the OS in system mode, with a pre-paint script in
  `index.html` to avoid a flash. Toggle in the sidebar + the palette.
- **Focus** — one keyboard-only `:focus-visible` ring app-wide (base layer).
- **Skip link** — "Skip to content" → `#main-content`.
- **Reduced motion** — all animation collapses under `prefers-reduced-motion`.
- **Labelled dialogs** — the command palette has an sr-only title/description.
- **Print** — the existing print styles (hide chrome, expand tab panels) are
  retained.

---

## The pattern library (`components/patterns/`)

The reusable, Haven-portable layer. Build new surfaces from these, not raw divs:

| Pattern | Purpose |
|---|---|
| `PageHeader` | eyebrow + display title + subtitle + actions |
| `StatTile` | KPI tile (icon chip + label + metric + footnote) |
| `SectionCard` | Card with the standard iconed header + actions |
| `Money` | tabular-nums dollar figure, optionally provenance-aware |
| `Delta` / `DeltaBadge` | the D5 diff value (inline + pill) |
| `Provenance` / `ProvenanceList` | the D4 "why this number" surface |
| `StatusPill` | engagement / organizer / severity status vocabulary |
| `DocRequestTracker` | the organizer checklist (D6) |
| `CommandPalette` | the ⌘K surface (D2) |

Supporting libs: `lib/format.ts` (the single source of money/pct/num
formatting — replaces ~10 duplicated `fmt`/`pct`), `lib/delta.ts` (D5
semantics), `lib/returnModel.ts` (the form-line + provenance model),
`design/theme.tsx` (dark mode), `design/tokens.ts` (TS token mirror).

## Verification (2026-06-12)

Browser-verified end-to-end: workspace nav + ⌘K (server search, global
shortcut), dark mode (toggle + persistence across reload), the engagement board
(inline status update persisted to the DB), the 3-pane workspace (keyboard nav +
provenance tie-outs), light + dark, desktop + mobile (3-pane → stacked).
Green bar: tax-app typecheck + scripts typecheck + `lint:tokens` (0 violations) +
production build, all clean.

## What's intentionally NOT here

- No SPA/router rewrite, no code-splitting (Haven's portals replace the SPA; the
  single-bundle chunk-size warning is expected and out of scope).
- The ClientDetail source-entry tabs are unchanged — the return workspace is an
  additive review surface over the same data, not a replacement.
