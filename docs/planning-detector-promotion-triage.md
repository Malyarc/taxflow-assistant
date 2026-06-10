# Planning-detector engine-verification triage (T1.3)

**Re-assessed 2026-06-09** (this session) — independent re-confirmation of the
2026-06-06i triage, now backed by a per-detector scan of the 107-strategy catalog.

## The question

MASTER-TODO T1.3 lists "promote the ~44 qualitative heuristic detectors to
engine-verified what-ifs (model each mechanic, like the §1244/§453/§41 work)."
This doc records which detectors **can** be cleanly engine-verified, which
**cannot**, and why — so future sessions don't re-litigate it or force-wire a
detector and ship a wrong number.

## What "engine-verified" requires (the bar)

A detector earns an `OpportunityWhatIf` (`savingsSource: "engine-verified"`,
`verifiedSavings`) only when ALL of these hold:

1. **Current-year, income-tax-complete effect.** The strategy's entire value is a
   change to *this* return's federal/state income tax — not a future-year benefit,
   not a FICA/payroll effect the income-tax engine can't see, not estate/gift tax.
2. **Determinable amount.** The mutation amount comes from a statutory cap or
   client-supplied data — never a guess. (Guessing the input and running it
   through the engine just launders a guess as "verified" — the exact trap to
   avoid.)
3. **Maps to an existing engine lever** (an `adjustment_type` or `ClientFacts`
   field) so `runDetectorWhatIf` can apply it.
4. **Fits the `scenario − baseline` shape** — a single forward mutation whose
   delta IS the headline number (no inverted "counterfactual" mutation that would
   confuse the CPA reading `whatIf.mutations`).

## Already engine-verified (the clean ones — DONE)

The detectors whose mechanic meets the bar are already wired (~24 `runDetectorWhatIf`
call sites): **G1.1** SEP · **G1.4** Roth (cost) · **G1.5** AMT-ISO · **G1.6** NIIT ·
**G1.9** TLH · **G1.10** FTC · **G1.11** QCD · **G1.13** Augusta · **G1.14** HSA ·
**G1.28** DB plan · **G1.31** Saver's (reads the engine credit; Q1) · **G1.34** §25D ·
**G1.36** §41 R&D · **G1.37** §25C · **G1.40** §1244 · **G1.42** SEHI · **G1.46**
spousal IRA · **G1.49** family employment · **G1.51** AOC/LLC · **G1.61** §221 student
loan · **G1.65** §23 adoption (engine credit) · **G1.30** §36B PTC (engine Form 8962) ·
**G1.47** §453 · **G1.92** Solo-401(k) · **G1.93** §163(d) · **G1.96** §132(f) transit.

These cover every detector with a clean current-year, determinable, income-tax-complete
mutation. The §1244/§453/§41/§163(d) work the TODO references **is this set.**

## Deliberately heuristic (cannot be cleanly engine-verified) — and why

Grouped by the bar it fails. Force-wiring any of these would ship an incomplete or
falsely-precise "verified" number.

### A. Multi-year / future-growth value (fails bar #1 — no current-year delta)
The benefit is tax-free compounding or a future-year bracket, which a single-year
engine run cannot value:
- **G1.16** mega-backdoor Roth, **G1.22** pre-RMD Roth ladder, **G1.26** backdoor Roth
  (the conversion itself is wired via G1.4; the *value* is future), **G1.29** §529→Roth,
  **G1.55** custodial Roth, **G1.59** Coverdell, **G1.57** NQDC §409A, **G1.50** §72(t)
  SEPP, **G1.27** inherited-IRA 10-yr, **G1.63** lot-rotation withdrawal order.
- **G1.3** bunching, **G1.8** DAF — already carry an `OpportunityMultiYear` (H3), which
  is the correct multi-year representation; a single-year whatIf would understate them.
- **Deferral** strategies whose point is shifting tax across years: **G1.21** §1031,
  **G1.24** QOZ, **G1.79** §453 opt-out, **G1.64** §168(k) bonus opt-out, **G1.69**
  year-end timing (the bracket-fill optimizer, shipped T1.3 core, already models this).

### B. Engine-invisible component (fails bar #1 — effect is partly outside income tax)
- **G1.32** DCFSA vs §21 — the headline benefit includes the **7.65% FICA** saved on
  the pre-tax salary reduction, which the income-tax engine does not compute. An
  engine whatIf would capture only the income-tax + §21 sides and **understate** it.
- **G1.2** PTET — already valued by the rate-aware `STATE_PTET_REGIMES` model (the
  SALT-cap interaction is real, but the entity-level mechanics sit outside the 1040).

### C. Qualitative / structural (fails bar #2 — no determinable amount; needs a pro)
Trusts, entity elections, and status determinations the engine can't size:
- **G1.17** S-corp reasonable comp, **G1.18** REPS, **G1.19** CRT, **G1.20**/**G1.76**
  conservation easement, **G1.58** state residency, **G1.77** self-rental grouping,
  **G1.78** multi-state sourcing, **G1.82** §1374 BIG, **G1.83** §338(h)(10), **G1.84**
  §351, **G1.85** §163(h)(3) debt tracing, **G1.86** CLT, **G1.87** §401(a)(17),
  **G1.88** SSTB navigation, **G1.89** §199A aggregation, **G1.90** PIF, **G1.95**
  §1377(a)(2), **G1.7** §199A wage/UBIA limit planning, **G1.54** §183 hobby,
  **G1.53** kiddie-tax structuring, **G1.71** ISO lot timing, **G1.72** RSU sell-to-cover.

### D. Requires a guessed input (fails bar #2 — would launder a guess as "verified")
The amount is an assumption, not data — running it through the engine adds false
precision:
- **G1.12** appreciated-stock (appreciation not supplied), **G1.15** NUA spread,
  **G1.23** cost-seg study, **G1.39**/**G1.41** §1202/§1045 QSBS gain, **G1.45** §121
  (a *future* sale — even the exact rate is hypothetical), **G1.70** bargain sale,
  **G1.80** §47 historic rehab, **G1.81** §44 disabled access, **G1.91** §139 disaster,
  **G1.62** §263A inventory, **G1.56** specific-lot HIFO, **G1.43** wash-sale coaching,
  **G1.48** §83(b), **G1.94** §85 UI (no remaining exclusion), **G1.74** §45S, **G1.75**
  §51 WOTC, **G1.60** §41(h) payroll (employee data not on the 1040), **G1.68** §174A,
  **G1.73** NUA in-service, **G1.66** rollover-IRA pro-rata fix.

### E. Estate / gift (out of the income-tax engine entirely — new this session)
- **G1.101–G1.106** (annual gifting, 529 superfund, SLAT, ILIT, GRAT, §1014 step-up) are
  intentionally informational flags (low confidence 0.40–0.50) — the engine has no
  estate-tax model. See the catalog entries + `planningEngine.ts` detectors.

## Conclusion

The genuinely-modelable detectors are already engine-verified. The remaining ~50 are
deliberately heuristic for the documented reasons above; **promoting them would inject
incomplete or falsely-precise "verified" numbers**, which is worse than an honest
heuristic with a disclosed assumption. This is a deliberate engineering decision, not a
backlog gap.

If a future law change or new client-supplied input makes one of these determinable +
income-tax-complete (e.g. an explicit "embedded gain" field would make G1.45 §121
verifiable for an *actual* sale), promote it then — model the mechanic first.
