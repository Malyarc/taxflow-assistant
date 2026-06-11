# FULL-APP MAXIMUM AUDIT — 2026-06-11 (findings ledger)

**Scope:** the ENTIRE app, at full force — a **13-agent fresh-fleet fan-out** (one per
subsystem, each re-deriving every numeric rule vs the IRS/state PRIMARY SOURCE, each
confirming HIGH/CRITICAL suspicions with a live `computeTaxReturnPure` repro), plus the
**NEW differential-oracle harness** (tenforty/OpenTaxSolver — the long-deferred T0.3
A0/A2 layer, now landed), the property harness (5,636 runs), the full no-API + yes-API
batteries, an in-session `/code-review max`, and live `/verify` against a running API.

**Verbatim per-agent reports (file:line, severity, repro for every finding):**
`docs/accuracy-audit/agent-reports-2026-06-11/*.md` — 13 files. THE deferred-backlog
source of truth; this ledger is the ranked index.

**Green bar at ship:** 4 typechecks · api-server build · no-API **112 suites /
6,754 assertions / 0 failed** · property harness 5,636 · **differential oracle 758
scenarios / 0 divergences** · yes-API suites green (except `ai-overlay` + the
`return-qa` leg of cpa-tools, which need a real `AI_API_KEY` — documented environmental).

---

## SHIPPED (9 fixes, commit `bf43c43` — every value hand-calc'd vs the primary source; 33-assertion regression file `tax-engine-audit-2026-06-11-tests.ts`)

### The QSS (`qualifying_widow`) ≠ "joint return" cluster
The engine grouped a qualifying surviving spouse with MFJ at sites whose statute keys on
**"a joint return"** — which a §2(a) surviving spouse (who files singly) is NOT. QSS
correctly STAYS MFJ for §1 brackets, §63(c)(2) std ded, §1411 NIIT ($250k — the statute
names "surviving spouse"), §24 CTC, §121 $500k, §461(l), AMT exemption, and the IRA
active-participant band (Pub 590-A Table 1-2 groups QSS with joint — verified, left
alone). Fixed to single/HoH treatment:

1. **§3101(b)(2)(C) Additional Medicare threshold $200k** (was $250k) — found by the
   DIFFERENTIAL ORACLE (a flat −$450 on every QSS filer with Medicare wages
   $200k–$250k), independently confirmed by 2 fleet agents. `additionalMedicareThreshold`.
2. **§86(c) SS-taxability base amounts $25k/$34k** (was $32k/$44k) — under-taxed SS
   (repro: $20k SS + $30k wages → taxable SS $4,000 vs correct $9,600).
3. **§21(d)(1) dependent care** — QSS was zeroed by a phantom deceased-spouse
   earned-income floor of $0 (repro: $0 vs correct $660).
4. **§25A(d)(2) education-credit MAGI band $80–90k** (was $160–180k; repro: $2,500 AOC
   granted at $120k MAGI vs correct $0).
5. **§32(b)(2)(B) EITC single/HoH phase-out column** (was the MFJ column → over-credit).
6. **§221(b)(2)(B) student-loan-interest band = single**, all 3 years (was MFJ).
7. **§904(j)(2)(C) simplified FTC limit $300** (was the joint $600) — /code-review found
   this same-class site my fix pass missed.
8. **OBBBA Schedule 1-A**: single caps + phase-out thresholds for QSS
   (tips/overtime/car-loan/senior); the §151(d) senior bonus counts only the LIVING
   taxpayer, never the deceased spouse (was $12,000 for a QSS senior with a stale
   spouseAge field).

### 1099-INT box semantics (a silent income understatement)
9. **Box 8 netted out of Box 1 + Box 3 dropped entirely.** Box 1 (taxable) and Box 8
   (tax-exempt) are DISJOINT on the form — the engine computed
   `max(0, Box1 − Box8)`, understating taxable interest on every brokerage 1099-INT
   carrying muni interest (repro: Box1 $5k + Box8 $3k → $2k vs correct $5k). Box 3
   (US Savings Bond / Treasury interest — federally TAXABLE, Sch B line 1) was
   extracted + persisted + validated but NEVER summed → $0 income. Now: taxable
   interest = Box 1 + Box 3 at BOTH read sites (total + per-payer Schedule B), matching
   `@workspace/validation` and the AI extractor; Box 8 stays a separate sum feeding
   Pub 915 SS provisional income + §32(i) EITC disqualification; **Box 3 is wired to the
   state US-Treasury subtraction** (state-exempt by federal preemption — the
   /code-review caught that first wiring gap; CA repro now exact). ALSO:
   `usTreasuryInterest` + the already-shipped `earlyWithdrawalPenalty` were in the
   openapi RESPONSE schema only — writes were silently zod-stripped (the classic
   Create/UpdateBody gotcha; caught by live /verify) — both added to
   `CreateForm1099DataBody` + `UpdateForm1099DataBody` + codegen.

**5 wrong-expectation tests corrected** (they encoded the old Box-8-subtraction /
QSS-as-MFJ behavior): 16-scenario-battery N3 (muni data remodeled Box-8-only),
deep-audit H13, workpaper-schedule-ab S2 ($1,400→$1,600), deep-integration test 2,
phase15-unit QW-FTC ($600→$300).

### NEW: differential-oracle layer (T0.3 A0 + A2 — CLOSED)
`scripts/src/tax-engine-differential-oracle-harness.ts` + `differential-oracle-runner.py`
(pip `tenforty`): 758 scenarios (5 statuses × TY2024/2025 × wages/interest/dividends/
STCG/LTCG incl. losses + bracket/LTCG/NIIT/AddlMedicare boundary batteries + a CA state
batch) through BOTH engines. **Every divergence triaged against the primary source**
(several proved the ORACLE wrong — OTS is +$64 on the 2024 HoH 35%/37% schedule, omits
STCG from the §1411 NII base, has no QBI, and double-charges SS tax on W-2+SE). Final
state: **0 divergences beyond the documented oracle-method tolerances**, which are
encoded in the harness header. Standalone like the property harness (`-harness` name —
NOT auto-run by run-no-api; skips exit-0 without python3/tenforty, so CI never depends
on it). Run: `pnpm --filter @workspace/scripts exec tsx src/tax-engine-differential-oracle-harness.ts`.

---

## DEFERRED — ranked backlog (confirmed by agents with file:line + repro; NOT fixed in
## this pass; full detail in `agent-reports-2026-06-11/<file>.md`)

**Why deferred:** each needs careful per-item primary-source verification (state-law
currency), a structural change with wide test blast radius, or a product decision.
None is a regression from this session. Severities are the agents'; spot-check before
relying — a handful of their claims I adjudicated DOWN during the session (e.g. the
"QSS IRA band" claim was WRONG — Pub 590-A keeps QSS=joint; the §1(h) "interleaving"
claim re-litigates the settled flat-25/28% adjudication).

### Tier 1 — wrong filed number, broad blast radius (fix next)
- **[state-engine] Kansas SB 1 (2024) never applied** — brackets/std-ded/exemptions all
  3 years + KS still in `STATES_TAXING_SS` (SS is now 100% exempt). Every KS filer.
- **[state-engine] PA Schedule SP applied TWICE + $1,000 steps (real = $250)** —
  `calculateStateTax` forgives inline AND `calculateStateAdditionalCredits` forgives
  again; also leaks into the NR fallback using PA-source wages as eligibility income.
- **[state-engine] CO TY2025 TABOR 4.25%** (engine 4.40%); **WV TY2024 holds the TY2025
  rates** (under-tax ~6%); **NM HB 252** both-directions bracket errors; **HI Act 46**
  2025/2026 phase-ins missing; **MD HB 352 (2025)** new 6.25/6.5% brackets + std-ded +
  2% cap-gains surtax; **ME std ded stale** (tracks federal — add to conforming set);
  **LA HoH std ded $12,500 vs $25,000**; **DC EITC 70% → ≥85% (2025)/100% (2026)**;
  **IL CTC wrong base+rate** (20/40% × IL EITC, child<12); **H3 STATES_TAXING_SS is
  binary** (NM ≤$100k exemption, CO 65+, VT, MN/RI thresholds, UT credit unmodeled);
  **CA AMT exemption constants wrong** ($87,171/... actual vs the phase-THRESHOLD values
  coded); TY2026 statutory cuts (IN/MS/NC/NE/GA/MT/OK). → `state-engine.md`.
- **[fed-credits] FC-01 TY2026 PTC still on the expired ARPA/IRA schedule** — no 400%
  FPL cliff (enhanced subsidies expired 12/31/2025; Rev. Proc. 2025-25). **FC-02
  §25C/§25D still computed for TY2026** — OBBBA terminated both after 2025. **FC-11
  §25D applied BEFORE the CTC** (Sch 8812 CLW includes §25C but NOT §25D) → ACTC
  inflated. **FC-03 EITC §32(a)(2) phase-out subtracted from the phase-in amount instead
  of the max credit** (under-credits wages+unearned filers). **FC-10 Form 8962 Table 5
  columns** (MFS uncapped, HoH given single half-caps). **FC-09 excess-APTC repayment
  excluded from the nonrefundable-credit base.** → `fed-credits.md`.
- **[fed-other-taxes] F-2/F-3 §53 AMT-credit + §38 GBC limits use GROSS income tax**
  (not net of other credits per §53(c)/Form 8801 + §38(c) "net income tax") and **MTC
  generation = 100% of AMT** ignoring §53(d) exclusion-items (SALT/std-ded-driven AMT
  generates $0 credit under law) **+ it's auto-seeded next year** → year-2 under-tax.
  **F-4 OBBBA senior deduction not added back to AMTI** (2025 Form 6251 line 1b).
  **F-5 excess-SS-withholding credit (Sch 3 line 11) not modeled** (Box 4 exists in
  DB; 2-employer refund missing ~$4.4k repro). **F-6 Form 8959 Part IV withholding
  reconciliation unmodeled.** → `fed-other-taxes.md`.
- **[fed-business] §461(l) auto-aggregation doesn't net profitable businesses**
  (Sch C +$400k / K-1 −$700k → addback $395k vs correct $0) + **TY2026 thresholds
  stale** (Rev. Proc. 2025-32: $256k/$512k — LOWER than the held 2025 values).
  **NOL applied below-the-line** (§172 is an AGI deduction → every MAGI-keyed item runs
  on overstated AGI). **QBI auto-default omits the SEHI reduction + §199A(c)(2)
  negative-QBI netting.** OBBBA Sch 1-A **MFS bar** (tips/overtime/senior statutorily
  require joint; engine grants to MFS). §1231(c)-vs-§1250 ordering (Notice 97-59).
  §179 carryover re-cap + cap-disallowed basis MACRS. Above-the-line §179 income limit
  ignores W-2 wages. → `fed-business.md`.
- **[cross-cutting] K-1 partner SE earnings excluded from EITC/ACTC/dep-care EARNED
  income** ($8,825 swing repro — §32(c)(2)(A)(ii)). **K-1 Box 2 QBI double-dip**
  (QBI granted on §469-suspended income). **K-1 dividend 6a/6b double-count** (K-1 path
  adds both raw; 1099-DIV path nets). **PTC §36B MAGI = raw AGI** (missing nontaxable
  SS + tax-exempt interest + FEIE). **FEIE MAGI add-back missing on CTC/§25A/§25B/
  OBBBA-1-A** (present on IRA/SLI/NIIT/adoption). → `cross-cutting.md`.
- **[multistate-local] C1 MCTMT taxes only the excess over $50k** — NY Tax Law §801(b)
  taxes the ENTIRE net SE earnings once over the threshold (cliff; ~$300 flat
  under-tax) + **C2 TY2026 threshold $150k** (FY2026 budget). **H3 locality bases never
  subtract taxable SS** (NYC/MD/IN/OH retiree over-tax). **H4 Reading PA 2.70% vs 3.6%.**
  **H5 Oregon wrongly in NR_AS_IF_RESIDENT_STATES** (OR-40-N is method b). **H6 NYC
  school credit HoH $63 not $125.** Resident credit aggregated across states instead of
  per-state. `wages_only` locality bases use Box 1 not Box 5. Part-year passes full
  SS/retirement exclusions to BOTH periods. → `multistate-local.md`.

### Tier 2 — wrong number, narrower case / wrong recommendation
- **[fed-core] FC-5** Pub 915 provisional income wrongly reduced by the SLI deduction;
  **FC-6** cap-loss carryforward burns $3k even at $0 taxable (Pub 550 worksheet);
  **FC-7** itemize-vs-std flag ignores the §63(f) aged/blind add-on (AMT addback edge);
  **FC-11** QSS std-ded add-on counts the deceased spouse's age/blind boxes (data-gated);
  **FC-13** kiddie unearned income omits 1099-R/rents/SS; **FC-10** educator cap TY2026
  $350 (engine $300); TY2026 OBBBA itemized changes (0.5% charitable floor, 2/37
  limitation, non-itemizer charitable) unmodeled. → `fed-core.md`.
- **[fed-core, CONTESTED — needs a worksheet-level adjudication session]** FC-1 §1(h)
  special-rate "interleaving" (the agent claims the 25%/28% layers must interleave with
  the 0/15/20 stack rather than sit flat under the global min; the repo previously
  adjudicated FLAT per §1(h)(1)(E)/(F) text through 3 independent reviews — one of the
  agent's 4 repro deltas suggests a real sub-case at the 22/24% boundary worth a
  dedicated Schedule-D-Tax-Worksheet line-by-line session; do NOT change without one).
- **[cpa-tools] FS-1/FS-2 filingStatusOptimizer phantom MFS savings** — the forced-
  itemize override is a no-op (engine takes max(itemized, std)) so the tool prices an
  illegal taxpayer-itemized/spouse-standard pair; the household itemized fallback leaks
  into BOTH MFS halves (double-deducted). **TP-1 taxProjection re-deducts consumed
  carryforwards** (projected-year vouchers can satisfy NO §6654 harbor). **YOY-1 IRMAA
  tiers hardcoded 2024.** TP-3 voucher dates skip the §7503 roll. → `cpa-tools.md`.
- **[planning] HIGH: multi-year projection drops K-1/rental/per-lot/4797 income**
  (projectYearForward advances taxYear only on W-2s/1099s; the engine year-filters the
  rest → baseline years show $0 tax for a K-1 client; G1.47 showed $75,284 vs the true
  $22,016 — and labels it "ENGINE-VERIFIED"). G1.34/G1.37 conditional purchases labeled
  engine-verified (the Q2-2026-06-08 class). G1.92 deferral not comp-capped. G1.61 gate
  hardcoded TY2024. Wage-proxy false-fires (G1.96/G1.72/G1.87/G1.57). G1.33 §30D dead
  law post-2025-09-30. → `planning.md`.
- **[ai-extraction] SSA-1099 Box 6 withholding dropped at approve** (refund understated);
  the shipped 1098-Box-4 netting is dead in the real flow (no FieldDef in the review
  modal); double-approve TOCTOU; plaintext SSN/TIN in `tax_documents.extracted_text`
  survives even with PII key set (P0-5 sibling — fold into the T0.1 S3+KMS work);
  W-2 Box 12/13 not extracted (Box 13 drives the IRA phase-out). → `ai-extraction.md`.
- **[forms-exports] NOL false-⚠ on the 1040 workpaper + recon Part 3** (builders omit
  the NOL step the engine applies); **1040-X payments-half line numbers off-by-one**
  (16-20 vs official 17-21); **4868 Lines 4/5 pre-credit** (overstated by nonrefundable
  credits); **irsForm1040Pdf.ts writes wrong 3a/3b/line-7/1a/16/23/25a/33** (the stale
  sibling of the correct workpaper builders); summary-PDF shows std ded for itemizers +
  misses APTC repayment in the "regular tax" netting; WinAnsi ✓/⚠/− glyphs garble in
  pdfkit (U+2212 minus DISAPPEARS — negatives can read positive); recon 1099-MISC row
  double-counts rents+royalties (display); Part 5 lists uncapped credits (false ⚠).
  → `forms-exports.md`.
- **[frontend] FE-A1 ClientForm formReady gate compares email LIVE** (typing in the
  email field swaps the form to skeletons → edits lost); **FE-A2 four raw-fetch dialogs
  never check res.ok** (error → success toast + silent data loss); **FE-A3 W-2/1099
  edit can't clear a box** (undefined dropped vs null); **FE-A4 TYPE_LABELS missing 5
  live enum values** (statutory_employee/church/se_optional/crypto×2 — unselectable);
  **FE-A5 CTC card hardcodes $2,000** (engine $2,200 TY2025+); FE-A6 YoY regex colors
  credits red-on-increase; AssetBalances invalidates the wrong query key; PDF downloads
  don't check content-type. → `frontend.md`.
- **[api-security] H1: AI-extracted SSN/TIN in `extractedText` cleartext + echoed by the
  documents LIST** (same item as ai-extraction; P0-blocking before real PII). M1 trust
  proxy=1 on a no-proxy box (rate-limit spoof). M2 what-if mutations array unbounded
  (CPU DoS). M3 no `no-store` on W-2/1099 JSON GETs. L1-L5 hardening. NO
  CRITICAL/HIGH beyond H1; all gates verified live. → `api-security.md`.

### Tier 3 — robustness / dead code / docs
- `answerReturnQuestion` 500s on a THROWN LLM error instead of the deterministic
  fallback it already has for empty answers (`returnQa.ts:193` — also blocks the
  cpa-tools yes-API suite in keyless environments). [Confirmed by live repro this
  session — small fix, do with the Tier-2 cpa-tools batch.]
- Totality at the pure seam: NaN in count fields (eitcQualifyingChildren etc.) throws or
  emits NaN (the toNum clamp covers Numish money fields only); negative
  `capital_loss_carryforward_*` becomes phantom income; `repaymentCap: Infinity`
  sentinel ships non-finite output. → `cross-cutting.md`.
- No-op adjustment-type list (enum + UI, zero engine effect — a CPA enters them,
  nothing happens): `nua_lump_sum_employer_stock`, `mega_backdoor_roth_after_tax_contribution`,
  `roth_conversion_amount`, `traditional_ira_distribution`, `roth_ira_distribution`,
  `roth_conversion_basis(_within_5yr)`, `nondeductible_ira_contribution`,
  `augusta_rule_rent`, `scorp_reasonable_comp`, `section_1231_lookback_loss` (no
  form4797 table → never populated). Engine-read types NOT in the enum:
  `bonus_depreciation_basis_obbba`, `qbi_w2_wages`, `qbi_ubia`, `qsbs_exclusion_pct`,
  `out_of_state_muni_interest`, `us_treasury_interest`. → `cross-cutting.md`.
- Adjustments have no taxYear (cross-year leakage; known, now load-bearing for
  roll-forward/YoY — schedule a migration).
- Oracle-harness niceties: distinguish "oracle absent" from "oracle errored" in the
  SKIP path; fix the runner docstring's stale status name.
- **(Seam review, 2026-06-11b — conservative, documented):** (1) the FC-09
  nonrefundable-credit base includes the excess-APTC repayment but the §38/§53
  NET-tax limits are derived without it — when a clawback coexists with
  GBC/§53 credits the limits under-state (never under-taxes); align the
  netIncomeTaxFor38/amtCreditApplicable bases with the FC-09 base. (2) The
  Form 8801 §53(d) exclusion-items rerun calls calculateAmt WITHOUT the
  schedDWorksheet lines the real AMT run gets — the two Part-III paths can
  position preferential zones differently on AMT+§1250/28% returns (tiny edge;
  thread the worksheet into the exclusion rerun).

### Adjudicated REFUTED / leave-alone (do NOT "fix")
- QSS stays MFJ for: §1 brackets, §63(c)(2) std-ded amounts, §1411 NIIT, §24 CTC, §121,
  §461(l), AMT exemption, **IRA active-participant band (Pub 590-A Table 1-2)**.
- The §1(h) flat-25/28% treatment stands unless a dedicated worksheet session proves
  the interleaving sub-case (see CONTESTED above).
- Saver's-credit QSS=single column is the PLAN-01 decision (correct, pre-existing).
- The oracle's HoH +$64 and NIIT-STCG omissions are OTS bugs (engine matches the IRS).
