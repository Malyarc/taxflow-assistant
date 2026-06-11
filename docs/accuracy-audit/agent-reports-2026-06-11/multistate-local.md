# Audit — Multi-state sourcing + local taxes (2026-06-11)

Auditor: fresh independent pass. READ-ONLY. Scope: `calculateMultiStateTax` + locality code in
`/home/user/taxflow-assistant/artifacts/api-server/src/lib/taxCalculator.ts`, `paEitRates.ts`,
`ohSchoolDistricts.ts`, and routing in `taxReturnEngine.ts`. All HIGH/CRITICAL findings were
live-confirmed with `/tmp/ms-audit.ts` (run via `npx tsx` from `scripts/`); external facts verified by
web search against primary/secondary sources where reachable (tax.ny.gov, pa.gov and oregon.gov PDFs
403'd; used search-result extracts of those documents — noted per finding).

Line numbers refer to `artifacts/api-server/src/lib/taxCalculator.ts` unless stated.

---

## CRITICAL

### C1. MCTMT self-employment tax computed on the EXCESS over $50k; statute taxes the ENTIRE net earnings (cliff)
- Code: `calculateNycLocalTax`, lines 2194–2199: `if (netSe > 50000) nycMctmt = (netSe - 50000) * 0.0060`.
- Law: NY Tax Law §801(b) — "0.60% **of the net earnings** from self-employment … **if such earnings
  exceed $50,000**". The $50,000 is a cliff threshold, not an exclusion: once exceeded, the rate applies
  to the **entire** MCTD-allocated net earnings (confirmed via web search of tax.ny.gov MCTMT
  individual-definitions page and IT-201 line 54a guidance: "lines 54a/54b show the MCTMT net earnings
  base… Only enter an amount … if your net earnings … exceed $50,000" — the base entered is the full
  earnings, multiplied by the rate).
- Live repro: SE $150,000 NYC → engine $600.00; statutory 0.60% × $150,000 = **$900.00** (under-tax $300).
  SE $52,000 → engine $12.00; statutory $312.00 (under-tax $300, i.e. 96% of the tax).
- Every NYC self-employed filer with > $50k SE earnings is under-taxed by a flat ~0.6% × $50k = $300
  (2024/2025). Common filer class for a CPA tool → CRITICAL per rubric (bounded ~$300 magnitude).

### C2. MCTMT TY2026: threshold rises $50,000 → $150,000 (engine holds $50k for all years)
- NY FY2025-26 budget (A3009, signed 2025-05-09): for tax years beginning on/after 1/1/2026 the SE
  exclusion threshold is **$150,000** per zone (rate stays 0.60% Zone 1 / 0.34% Zone 2 for SE — the
  0.895%/0.635% increases were employer-side). Confirmed via web search (tax.ny.gov 2025 PIT changes
  summary; Grassi/vensure alerts).
- Engine: hardcoded `netSe > 50000` + flat `0.0060`, no year indexing → TY2026 NYC SE filer at $100k:
  engine charges $300 (correct: **$0**); at $200k engine charges $900 (correct, after C1 fix: $1,200).
- TY2026 is a SUPPORTED_TAX_YEARS year used for projections. Severity folded with C1 (same code line);
  on its own HIGH.

---

## HIGH

### H1. PA Schedule SP Tax Forgiveness phase-out uses $1,000 steps; the real PA-40 SP table uses $250 steps
- Code: `calculatePaScheduleSpForgivenessPct` (lines 2508–2536): `stepSize = 1000`, so forgiveness
  reaches 0% at ~$15,500 single / ~$22,000 married (0 deps).
- Law: PA-40 SP Eligibility Income Table 1 (unmarried, 0 deps): $6,500→100%, $6,750→90%, $7,000→80%,
  $7,250→70%, $7,500→60%, $7,750→50%, $8,000→40%, $8,250→30%, $8,500→20%, **$8,750→10%, above → 0%** —
  $250 increments (web-confirmed against pa.gov Tax Forgiveness page extract listing exactly those
  thresholds). Married table: $13,000→100% … $15,250→10%. The +$9,500/dependent allowance in the code is
  correct.
- Live repro: PA single, eligibility income $10,000 → engine tax $122.80 (60% forgiveness) vs correct
  $307.00 (0% — $10,000 > $8,750). At $7,000 → engine $21.49 (90%) vs correct $42.98 (80%).
- Under-taxes every PA filer with eligibility income between ~$6,750 and ~$15,500 single / ~$13,250 and
  ~$22,000 married (plus shifted bands per dependent). Technically `calculateStateTax` (state level), but
  it directly drives this subsystem via H2 below.

### H2. PA Schedule SP forgiveness leaks into the NON-RESIDENT fallback using PA-source income as "eligibility income"
- Code: NR fallback (line 1547) calls `calculateStateTax(nrSource, "PA", …)`; inside, SP forgiveness
  keys off `eligibilityIncome = federalAgi` = **the PA-source wages only**. PA SP eligibility income is
  total income from everywhere (including non-PA income) for both residents and nonresidents.
- Live repro: NY resident (no PA reciprocity), $290k NY + $10k PA wages → engine PA NR tax **$122.80**
  vs statutory **$307.00** (3.07% flat, no forgiveness at $300k eligibility income).
- Affects any non-reciprocal-state resident (NY, CT, DE, …) with < ~$15.5k PA-source wages. Fix shape:
  pass full-year AGI as eligibility income (the `fullYearFederalAgiForCliff` plumbing already exists for
  IL) or suppress SP on the NR path.

### H3. Locality tax bases omit the Social Security exclusion (NYC PIT, MD counties, IN counties, OH SDIT-traditional)
- NYC: base built inline (lines 1752–1766) as `federalAgi − NY std ded − NY retirement exemption` —
  **`options.taxableSocialSecurity` is not subtracted**, even though the NY-state side excludes it (NY
  exempts SS; NYC PIT base = NYS taxable income line 47/38, which excludes SS).
  Live repro: NY/NYC single, AGI $90k incl. $30k taxable SS → NYS tax $2,695 (correctly on $52k) but NYC
  base $82,000 → NYC tax $3,053.49 vs $1,890.69 on the correct $52,000 base = **$1,162.80 over-tax**.
- MD/IN flat-rate (`state_taxable` branch, lines 1190–1198) and OH-traditional (lines 1174–1189): base =
  `federalAgi − state std ded` only. MD, IN, OH all exempt SS; their county/SDIT bases piggyback the
  state taxable income.
  Live repro: MD Montgomery single, AGI $80k incl. $30k taxable SS → county base $77,300, county tax
  $2,473.60 → ~**$960 over-tax** (3.2% × $30k).
- Common retiree filer class in MD counties / NYC / IN counties / OH traditional SDs → HIGH (over-tax —
  conservative direction, but wrong).

### H4. Reading, PA EIT rate wrong: 2.70% in both `LOCAL_TAX_DATA` ("PA-READING") and `PA_EIT_REGISTRY`; actual resident rate is 3.6%
- Web-confirmed (readingpa.gov "2025 City of Reading Taxes & Tax Rates"): Reading resident EIT total
  **3.6%** (the 0.3% distressed commuter tax was eliminated July 2022; the resident rate remained 3.6%).
- Engine charges 2.70% → under-tax 0.9pp (~$450/yr at $50k wages) for Reading residents.
- Spot-checks of the other big PA entries came back clean: Philadelphia 3.75/3.44 (TY2024 ✓), Pittsburgh
  3.0% ✓ (note: comment says "2% city + 1% SD"; actual split is 1% city + 2% SD — cosmetic), Scranton
  3.4% ✓, Allentown 1.975% ✓, Bethlehem 1.0% ✓. The ~160 "Act 32 default 1%" rows are population-center
  suburbs whose true rates vary (e.g., several Allegheny boroughs are >1%) — flagged by the in-code
  CPA-must-verify caveat, not re-verified here.

### H5. Oregon wrongly in `NR_AS_IF_RESIDENT_STATES` — OR-40-N is method (b), not method (a)
- Code: lines 1344–1350 include "OR" (comment claims "OR-40-N, tax-on-all × Oregon %").
- OR-40-N instructions (web-confirmed via search extracts of oregon.gov instructions + rate-chart doc):
  deductions/modifications are multiplied by the Oregon percentage, producing **Oregon taxable income**,
  and the **rate chart is applied directly to that Oregon taxable income** ("To compute tax on Form
  OR-40-N, line 45, use the tax rate charts"). I.e., brackets on source income with prorated deductions —
  method (b). (The *part-year* OR-40-P does prorate the tax — the comment likely conflated the two.)
- Effect: method (a) applies the average rate of TOTAL income to the OR share → **over-taxes** OR
  non-residents whose OR-source share is small relative to a large AGI (OR is steeply graduated,
  4.75%→9.9% with the 9.9% bracket at $125k). Example: $300k AGI with $50k OR wages → roughly $4.6k
  (engine) vs ~$4.0k (form method). Confidence: medium-high (primary PDF 403'd; two independent
  instruction extracts agree). Recommend removing OR from the set (the conservative fallback is closer)
  or implementing prorated-deduction method (b).
- The other 24 memberships check out against my knowledge of the forms (NY IT-203, CA 540NR, CT-1040NR/PY,
  NJ-1040NR, M1NR, GA 500 Sch 3 [flat], NC D-400 [flat], OH IT NRC, AR, DE, ME, MO, MT, NE, NM, OK, RI,
  VT, WI 1NPR, CO, IA [IA 126 credit method], KS, ND = method (a) / equivalent). LA: the "flat" grouping
  is wrong for TY2024 (LA was graduated 1.85/3.5/4.25 until the 2025 flat 3%), so method choice is
  material in 2024 — IT-540B's NPR worksheet flow not verified; flag for verification (LOW-MED).

### H6. NYC school tax credit: HoH gets $125; IT-201 line 69 gives HoH $63
- Code: line 2136 builds `isMfj = MFJ || QSS || HoH` (correct for the household-credit Table 5), then
  line 2184 reuses it: `nycSchoolTaxCredit = isMfj ? 125 : 63`.
- IT-201: $125 only for MFJ/QSS; **single, MFS, and HoH get $63** (web-confirmed: "credit … $63 for
  Single or Head of Household filers with income of $250,000 or less, $125 for MFJ/QSS").
- Live repro: HoH → 125 (engine), single → 63, MFJ → 125. Over-states a refundable credit by $62 for
  every NYC HoH filer (flows to `stateRefundOrOwed` via `nycSchoolTaxCreditRefundable`). Small dollars,
  very common class → graded HIGH-borderline-MEDIUM.
- Related boundary (LOW): eligibility coded `fagi < 250000`; IT-201 says "$250,000 **or less**" — a filer
  at exactly $250,000 is wrongly denied (repro 5b → $0). Also no `claimedAsDependent` gate (NYC-210
  excludes dependents-of-others) — LOW.

---

## MEDIUM

### M1. Resident credit for taxes paid to other states is aggregated across all NR states (over-credit vs per-state limitation)
- Code: lines 1621–1631 — single pooled cap `min(ΣNRtax, (ΣNRsource/AGI) × residentTaxFull)`.
  Virtually all states (e.g. CA Sch S, CO DR 0104CR, NY IT-112-R) compute the limitation **per state**:
  Σ min(NRtax_i, residentTax × source_i/AGI).
- Live repro: CO resident, CA $100k + AZ $100k wages → aggregate credit $7,879.50 vs per-state $6,074.75
  → **$1,804.75 over-credit** (CA's excess absorbs AZ's unused cap headroom). Only bites with ≥2
  non-reciprocal NR states with asymmetric rates — narrower than CRITICAL.
- The lesser-of structure itself is correct (✓), reciprocity wages correctly excluded from both the NR
  tax and the cap base (✓), no-income-tax resident states get 0 credit (✓).

### M2. `wages_only` locality bases use W-2 Box 1; OH municipal "qualifying wages" is Box 5 (Medicare wages), and PA/Philly/KY compensation includes 401(k) deferrals
- `taxReturnEngine.ts` line 1486: `totalWages = Σ wagesBox1`; that is what reaches every `wages_only`
  locality (OH cities, OH SDIT earned-income, PA EIT, Philly, KY occupational). ORC 718.01 defines the
  municipal base as qualifying wages = Medicare wages (Box 5); PA-taxable compensation (and thus Act 32
  EIT and Philly wage tax) includes elective 401(k) deferrals; KY occupational taxes gross wages.
- A $100k earner deferring $20k to a 401(k): engine taxes $80k → Columbus under-tax $500/yr.
  `medicareWagesBox5` is already collected (line 1496) but unused here. Under-tax, common class → MEDIUM
  (borderline HIGH for OH cities).

### M3. Locality rate tables are a TY2024 snapshot applied to 2024/2025/2026 (no year dimension) — confirmed real drift
- `LOCAL_TAX_DATA`, `PA_EIT_REGISTRY`, `OH_SCHOOL_DISTRICT_REGISTRY` have no year key. Confirmed drift:
  - **MD Dorchester 3.20% → 3.30% for TY2025** (retroactive; 2025 session raised the county cap
    3.20%→3.30%); **TY2026: Allegany 3.03%→3.20%, Kent 3.20%→3.30%** (web-confirmed, MD Comptroller
    alert + secondary sources).
  - **IN Monroe 2.035% → 2.14% for 2025**; 6 IN counties changed 1/1/2025 and 6 more 1/1/2026 (DN #1).
  - **Philadelphia July 1 2025: resident 3.75%→3.74%, NR 3.44%→3.43%** (CY2025 blended 3.745%), further
    cuts scheduled to 3.70%/3.39% by 2030 (phila.gov, web-confirmed).
  - OH SDIT rates/bases change every Jan 1 (tax.ohio.gov updated lists).
- The in-code caveat says CPAs must verify rates, but the engine *supports* TY2025/2026 natively, and the
  freshness-hardening pattern used elsewhere (`Record<TaxYear>`) was not applied to localities. MEDIUM.

### M4. Part-year: option amounts (taxable SS, retirement income, muni add-back) applied in FULL to BOTH periods
- `computePartYearAllocation` (lines 1957–1971) passes the same `options` to both periods' state-tax
  calls. Each state subtracts the **full** `taxableSocialSecurity`/retirement exclusion from a
  day-prorated AGI → the exclusion is taken ~twice across the two states (the inline comment claims it is
  "pro-rated implicitly … slightly conservative" — it is the opposite: under-tax). `muniBondAddBack` is
  conversely added twice (over-tax).
- Live repro: MO→NC mover, AGI $100k, taxable SS $40k → combined two-state tax drops $3,640.80 vs no-SS,
  ≈ 2× the one-time exclusion value (~$1,800 at NC's 4.5%). Retiree movers — MEDIUM.

### M5. AZ reciprocity missing (CA/IN/OR/VA residents working in AZ)
- `STATE_RECIPROCITY` (stateTaxData.ts lines 144–161) has no CA/OR keys and IN/VA lists lack "AZ".
  AZ Form WEC exempts residents of CA, IN, OR, VA from AZ tax on AZ wages (web-confirmed, azdor.gov).
  Engine assesses AZ NR tax and then (partially) credits it at the resident state — wrong AZ liability
  and wrong state allocation (and for CA the real-world arrangement is the reverse-credit regime, also
  unmodeled). Rest of the table verified correct vs published agreements (DC/IL/IN/IA/KY/MD/MI/MN/MT/
  NJ/ND/OH/PA/VA/WV/WI ✓). MEDIUM-LOW (net cash effect partially offset by the resident credit).

### M6. Local tax excluded from `totalTaxBurden`/`effectiveTaxRate`/`stateRefundOrOwed`, but NYC-linked refundable credits REDUCE them (asymmetry)
- `taxReturnEngine.ts` line 4082: `totalTaxBurden = federal + state − stateEitc − stateCtc −
  nycSchoolTaxCreditRefundable − …` — `localTaxLiabilityWithUbt` (NYC PIT + MCTMT + county/EIT/SDIT +
  UBT) is **never added**, yet the NYC school tax credit ($63/$125) and NYC EIC refundable excess are
  subtracted/added to the refund. A NYC filer's headline burden/effective rate omits ~3.9% of taxable
  income while pocketing the NYC credits in the same aggregate. "Local is its own line" is a documented
  design choice (line 3574 comment), but the credit asymmetry is internally inconsistent. Also no W-2
  Box 19 local-withholding netting anywhere. Display/aggregate only → MEDIUM-LOW.

### M7. C11 part-year "full source allocation" sources K-1 intangibles to the entity's state, contradicting its own docstring
- `taxReturnEngine.ts` lines 3370–3388: `k1NetIncome` includes interest, dividends, royalties, STCG, LTCG
  and routes them to `sourceState`; the block comment (3338–3341) and the C11-deeper test description say
  intangibles "still pro-rate to the resident state by days". Residence-period sourcing is the correct
  treatment for a part-year individual's portfolio income (NY IT-203-I). Opt-in marker only → MEDIUM-LOW.
- Contrast: the full-year NR path (lines 3443–3451) correctly sources only Box 1/2/3 — consistent with
  4 U.S.C. §114 treatment (✓), and `propertyStateSitus` routes only positive real-property gains (✓).

### M8. Non-resident locality taxes not modelable (Philly NR 3.44%, OH workplace cities, IN county-of-work, MD 505 2.25% special NR tax)
- Locality dispatch requires `client.state === locality.state` — by design (stale-code protection), but it
  means: NJ resident working in Philadelphia (extremely common; reciprocity does NOT cover the city wage
  tax) cannot be charged the 3.43-3.44% NR wage tax; `PA_EIT_REGISTRY.nonResidentRate` is dead data; KY
  has a separate `KY-LOUISVILLE-NONRES` code but PA has no Philly-NR analog; MD's 2.25% special NR tax is
  the documented reason MD is excluded from method-(a) (✓ comment) but is simply absent. Reciprocal-state
  commuters into IN also legally owe the IN county tax (reciprocity covers state tax only) — engine zeroes
  everything. Documented-adjacent gap → MEDIUM.

### M9. OH cross-city resident credit exists for only 3 cities and the documented escape hatch doesn't work mechanically
- Only Columbus/Cleveland/Cincinnati have `creditRate`/`creditLimitRate`. For the other 7 modeled cities
  (Akron, Dayton, Toledo, …— most grant 50-100% credits), `oh_work_city_tax_paid` is silently ignored
  (repro 13c: Akron resident with $2,000 work-city tax supplied still pays the full $2,500). The code
  comment says "CPA enters it directly when their city grants one" — there is no input that does that.
  Over-tax for cross-city commuters → MEDIUM (over-tax direction, documented-ish).

---

## LOW

- **L1. Yonkers unselectable in UI**: engine supports `localityCode "YONKERS"` (16.75% surcharge ✓
  verified on net NY tax after resident credit), but `localityCodesForState("NY")` returns only NYC and
  the frontend `LOCALITY_OPTIONS.NY` lists only NYC — shipped feature unreachable except via raw API.
- **L2. MD/IN/OH-traditional bases omit personal exemptions** (MD $3,200/person, IN $1,000/filer+dep —
  modeled at state level via `personalExemption` but the locality `state_taxable` branch subtracts only
  `standardDeduction`); MD low-income 15%-of-AGI minimum std ded not modeled. Documented sub-gaps in the
  header comment; over-tax of roughly rate × exemptions (~$40–$200).
- **L3. NYC base omits NY dependent exemptions** ($1,000/dep, IT-201 line 36 — also missing on the NY
  state side, so at least consistent). ~$39/dependent over-tax.
- **L4. OH SDIT "traditional" approximation**: base = federal AGI (OH std ded 0), missing OH exemption
  ($1,900-$2,400/person) and the inline top-15 list marks several traditional districts as `wages_only`
  (Liberty-Union, Indian Lake, Riverside) → non-wage income escapes. Documented sub-gap; CPA can override
  via `oh_sdit_traditional_base`.
- **L5. Philadelphia year drift** (also under M3): TY2025 blended 3.745%, TY2026 3.74% vs engine 3.75%;
  NPT income-based (Schedule SP) reductions not modeled (documented in code).
- **L6. NYC household credit Table 4 (single)**: engine pays $15 ≤$10k / $10 ≤$12.5k; IT-201 Table 4 is a
  single $15 band for FAGI ≤ $12,500 (≤$5/filer effect; not primary-source-verified — medium confidence).
  Table 5/6 amounts and the HoH-in-Table-5 mapping look right.
- **L7. NYC EIC staircase** (`nycEitcRateForAgi`): plateaus 30/25/20/15/10% with linear 2pp-per-$1,000
  transitions at 5k/7.5k/15k/17.5k/20k/22.5k/40k/42.5k. The 10-30% range and NYAGI-driven sliding scale
  are confirmed (tax.ny.gov); the exact band edges/formula could not be pulled from IT-215-I (403) — engine
  values are consistent with the post-2022 redesign. Uses federal AGI as NYAGI proxy (documented).
- **L8. Part-year skips**: locality tax (incl. NYC/Yonkers) and the resident credit are skipped entirely
  for part-year filers; WA excise/state-AMT also skipped — all documented sub-gaps, conservative in mixed
  directions. Third-state wages under `useW2SourceAllocation` drop out of both resident-period bases
  (taxed only as NR source) — opt-in, small.
- **L9. `localityCodesForState`/`LOCALITY_OPTIONS` divergence risk**: two hand-maintained lists (engine vs
  frontend `localityLabels.ts`) — already divergent for Yonkers (L1).
- **L10. LA method-(a) note**: LA was graduated in TY2024 (1.85/3.5/4.25), so the "flat → method a == b"
  rationale doesn't hold for 2024; IT-540B's actual NR worksheet flow unverified.

---

## Verified CLEAN (live-confirmed and/or primary-source-checked)

1. **Method-(a) identity + clamping**: NR tax = tax-as-if-resident(total AGI) × clamp01(source/AGI);
   repro 1: NY $5,344.84 exactly = $8,551.75 × 0.625; ratio clamps at 1 when source > AGI (repro 2) and
   the `Math.max(0, …)` floor handles negatives; AGI ≤ 0 falls to the brackets-on-source fallback.
2. **Part-year former-state double-count guard**: NY→FL mover pays $5,160.27 vs full-year NY $10,951.75 —
   former-state W-2s excluded from NR aggregation (`addNrSource` skips `partYearFormerState`); day count
   correct (182/366 leap-year, inclusive convention); std-ded proration factors sum to 1.
3. **§114 discipline on the NR path**: only K-1 Box 1/2/3 + rental net + `propertyStateSitus` real-property
   gains are NR-sourced; interest/dividends/royalties/intangible gains and retirement never auto-sourced;
   situs routes positive gains only; resident-state and former-state sources skipped.
4. **NYC PIT brackets**: 3.078/3.762/3.819/3.876% at 12k/25k/50k (single = MFS), 21.6k/45k/90k (MFJ/QSS,
   the 1.8× — not 2× — structure), 14.4k/30k/60k (HoH) — matches IT-201; marginal application verified
   (`applyBrackets` is a correct marginal engine).
5. **MCTMT scope**: correctly an SE-only tax (employees never pay it — the graduated 0.11/0.23/0.60%
   schedule is the employer payroll-expense rate); Zone-1 0.60% rate correct for TY2024/2025; gated to
   localityCode NYC (Zone 2 not modeled, documented). (Base/threshold bugs are C1/C2.)
6. **Yonkers**: 16.75% of the NET NY State resident tax (post-resident-credit), matching the IT-201
   Yonkers worksheet; doesn't disturb the NY state tax itself.
7. **NYC EIC containment (the L1b class of bug)**: flat-rate localities return `nycEitc: 0`; the engine's
   outer NYC-EIC block is gated on `localityCode === "NYC"`; `nycSchoolTaxCredit` is 0 for all flat-rate
   and Yonkers paths — no cross-locality credit leak found. No double application either: the pipeline
   does not pass `federalEitcApplied` into `calculateMultiStateTax`, so the inner EIC stays 0 and only the
   outer block applies it (refundable excess routed to the state refund).
8. **MD Anne Arundel + Frederick graduated brackets**: single 2.70/2.81/3.20 @ $50k/$400k and Frederick
   2.25/2.75/2.96/3.20 @ $25k/$50k/$150k (joint $75k/$480k and $25k/$100k/$250k) — **match the MD
   Comptroller 2024 table exactly** (web-verified); hand-calcs reproduce to the cent ($2,679.13 /
   $3,055.68); status mapping (single column = single/MFS/dependent; joint = MFJ/HoH/QSS) correct.
9. **KY occupational**: Kenton 0.6997% capped at the year's OASDI base — web-verified against the 2024
   Kenton schedule (rate changed 0.9097%→0.6997% in 2024, cap $168,600, max tax $1,179.69 — engine
   reproduces $1,179.69 exactly) and the cap tracks $176,100 (2025) / $184,500 (2026); Boone 0.8% capped
   $75,223 ✓; Louisville resident 2.2% / non-resident 1.45% (separate code) ✓ web-verified; Lexington
   2.25% ✓ web-verified.
10. **Stale-locality protection**: state-mismatch (e.g. OH client with KY-KENTON) returns null everywhere,
    including the PA-/OH-SD- registry fallbacks; frontend clears localityCode on state change.
11. **PA EIT / OH SDIT earned-income base mechanics**: SE net profit added (STL-02), **SE losses floored
    independently** (cannot offset wages — repro 14), no loss offset; PSD-code and kebab-name lookups both
    work; registry counts (175 PA / 226 OH-SD) as advertised.
12. **OH cross-city credit math** (where wired): min(creditRate × work-city tax, creditLimitRate × base),
    floored at 0 — Columbus 100%/2.5% repro gives $500 net; Columbus/Cleveland/Cincinnati rates and credit
    parameters match the cities' published rules (Cincinnati 1.8% post-2020 ✓, Youngstown 2.75% ✓,
    Lakewood 1.5% ✓ etc.).
13. **NYC UBT**: 4% with the 20%-capped-$10k services allowance, $5k exemption, and the $3,400/$5,400
    sliding business-tax credit — matches NYC-202 (repros: $0 at $100k net; $7,400 at $200k); applied
    independent of residency via CPA-supplied allocation (correct — UBT hits non-residents too).
14. **Reciprocity table** (except AZ, M5): all 16 keyed states' lists match published agreements;
    reciprocal wages bypass NR tax AND are excluded from the resident-credit cap base.
15. **NYC household credit / dependents plumbing**: `localDependentCount = 1 + spouse + dependents`
    composed in the engine; MFS table approximates combined-FAGI with own FAGI (documented).
16. **WA LTCG excise placement** (adjacent): resident-WA-only, $270k/2024 + $278k/2025 deduction, 2.9%
    surcharge on taxable gains > $1M from 2025 — consistent with RCW 82.87 as amended (not re-verified
    against DOR this pass).

## Repro artifacts
- `/tmp/ms-audit.ts` — 18 numbered live repros (all output reproduced in the findings above).

## Suggested fix priority
1. C1/C2 MCTMT base + TY2026 threshold (one function, year-index it).
2. H1/H2 PA SP $250 steps + full-income eligibility on the NR path.
3. H3 thread `taxableSocialSecurity` into the NYC base and the `state_taxable`/`oh_traditional` branches.
4. H6 NYC school credit HoH → $63 (+ `<=` boundary).
5. H4 Reading 3.6%; M3 year-index the locality tables (Dorchester/Kent/Allegany/Monroe/Philly).
6. H5 drop OR from `NR_AS_IF_RESIDENT_STATES` (or implement method (b)).
7. M1 per-state resident-credit limitation; M2 Box-5/qualifying-wages base; M4 prorate part-year options.
