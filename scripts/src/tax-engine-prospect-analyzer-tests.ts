/**
 * G-2 — Second-Look Prospect Analyzer tests (PURE, no API).
 *
 * Verifies:
 *   1. mapProspectToInputs maps each 1040 line onto the right engine field, and
 *      analyzeProspect's reported ourAgi/ourTotalTax reproduce an INDEPENDENT
 *      computeTaxReturnPure of the same mapped inputs (the mapping fidelity proof).
 *   2. The teaser sums hit savings correctly + headline is the deterministic
 *      template.
 *   3. The recompute difference = reported − ours, framed as preliminary.
 *   4. The no-opportunities case yields an honest teaser (still has disclosures).
 *   5. A PDF render smoke (%PDF).
 *
 * Hand-calc: every expected dollar figure is derived from an independent engine
 * run (the engine is the oracle here — the module is a thin mapper + reuse of
 * the planning detector), so the assertions pin the MAPPING and ASSEMBLY, not a
 * re-derivation of IRS tax math the engine already owns.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-prospect-analyzer-tests.ts
 */

import {
  mapProspectToInputs,
  analyzeProspect,
  buildProspectTeaserPdf,
  type ProspectReturnInput,
} from "../../artifacts/api-server/src/lib/prospectAnalyzer";
import { computeTaxReturnPure } from "../../artifacts/api-server/src/lib/taxReturnEngine";
import { evaluatePlanningOpportunities } from "../../artifacts/api-server/src/lib/planningEngine";

const PASS: string[] = [];
const FAIL: string[] = [];
function check(label: string, actual: number, expected: number, tol = 1.0): void {
  if (Number.isFinite(actual) && Math.abs(actual - expected) <= tol) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected}, got ${actual}`);
}
function checkTrue(label: string, cond: boolean): void {
  cond ? PASS.push(`✓ ${label}`) : FAIL.push(`✗ ${label}`);
}

/** Headline savings convention shared with the module. */
function headline(h: { verifiedSavings?: number; estSavings: number }): number {
  return h.verifiedSavings ?? h.estSavings;
}

async function main() {
  // ─────────────────────────────────────────────────────────────────────────
  // SCENARIO A — high-SE single prospect (fires SEP / planning) with reported
  // total tax. Mapping fidelity + recompute difference + teaser sums.
  // ─────────────────────────────────────────────────────────────────────────
  const A: ProspectReturnInput = {
    filingStatus: "single",
    state: "FL",
    taxYear: 2024,
    wages: 0,
    interestIncome: 2_000,
    ordinaryDividends: 3_000,
    qualifiedDividends: 2_500,
    capitalGains: 10_000,
    scheduleCNet: 150_000,
    reportedAgi: 0, // not used by the engine; reported* are display/compare only
    reportedTotalTax: 45_000,
  };

  // Independent engine run of the SAME mapped inputs (the oracle).
  const inputsA = mapProspectToInputs(A);
  const engineA = computeTaxReturnPure(inputsA);
  const analysisA = analyzeProspect(A);

  // 1) Mapping fidelity: analysis AGI/total-tax === independent engine.
  check("A: ourAgi reproduces engine AGI", analysisA.ourAgi, engineA.adjustedGrossIncome, 0.01);
  check("A: ourTotalTax reproduces engine federal liability", analysisA.ourTotalTax, engineA.federalTaxLiability, 0.01);
  checkTrue("A: ourAgi is finite and positive", Number.isFinite(analysisA.ourAgi) && analysisA.ourAgi > 0);
  checkTrue("A: ourTotalTax is finite and positive", Number.isFinite(analysisA.ourTotalTax) && analysisA.ourTotalTax > 0);

  // 2) Mapping shape assertions.
  checkTrue("A: SE income mapped to self_employment_income adjustment", inputsA.adjustments.some((a) => a.adjustmentType === "self_employment_income" && Number(a.amount) === 150_000));
  checkTrue("A: capital gains mapped to long_term_capital_gain adjustment", inputsA.adjustments.some((a) => a.adjustmentType === "long_term_capital_gain" && Number(a.amount) === 10_000));
  checkTrue("A: interest mapped to a 1099-INT", inputsA.form1099s.some((f) => f.formType === "int" && Number(f.interestIncome) === 2_000));
  checkTrue("A: dividends mapped to a 1099-DIV", inputsA.form1099s.some((f) => f.formType === "div" && Number(f.ordinaryDividends) === 3_000 && Number(f.qualifiedDividends) === 2_500));
  checkTrue("A: no W-2 created when wages are 0", inputsA.w2s.length === 0);
  checkTrue("A: client.socialSecurityBenefits defaults to 0 when absent", Number(inputsA.client.socialSecurityBenefits) === 0);
  check("A: mapped taxYear preserved", inputsA.taxYear, 2024, 0);
  checkTrue("A: client.state mapped", inputsA.client.state === "FL");

  // 3) Recompute difference = reported − ours.
  check("A: reportedTotalTax surfaced", analysisA.reportedTotalTax ?? -1, 45_000, 0.01);
  check("A: recomputeDifference = reported − ours", analysisA.recomputeDifference ?? NaN, 45_000 - engineA.federalTaxLiability, 0.01);

  // 4) Opportunities + teaser-sum fidelity: analysis must equal an independent
  //    detector run over the same engine output, summed by headlineSavings.
  const hitsA = evaluatePlanningOpportunities({
    client: inputsA.client,
    computed: engineA,
    adjustments: inputsA.adjustments,
    baselineInputs: inputsA,
  });
  const expectedTotalA = hitsA.reduce((s, h) => s + headline(h), 0);
  check("A: totalPotentialSavings equals sum of detector headline savings", analysisA.totalPotentialSavings, expectedTotalA, 0.01);
  check("A: opportunities count matches detector hits", analysisA.opportunities.length, hitsA.length, 0);
  checkTrue("A: high-SE single prospect surfaces at least one opportunity", analysisA.opportunities.length >= 1);
  checkTrue("A: totalPotentialSavings is the sum of the listed opportunities", Math.abs(analysisA.totalPotentialSavings - analysisA.opportunities.reduce((s, o) => s + o.estSavings, 0)) <= 0.01);
  checkTrue("A: opportunities sorted descending by estSavings", analysisA.opportunities.every((o, i, arr) => i === 0 || arr[i - 1].estSavings >= o.estSavings));
  checkTrue("A: each opportunity carries strategyId + name + rationale", analysisA.opportunities.every((o) => o.strategyId.length > 0 && o.name.length > 0 && o.rationale.length > 0));

  // 5) Headline template (deterministic).
  const expectedHeadlineA = `We identified $${Math.round(expectedTotalA).toLocaleString("en-US")} in potential tax-saving opportunities for TY2024.`;
  checkTrue("A: headline is the deterministic savings template", analysisA.headline === expectedHeadlineA);

  // 6) Disclosures present + carry the recompute-framing line when reported tax given.
  checkTrue("A: disclosures present (>=3)", analysisA.disclosures.length >= 3);
  checkTrue("A: disclosures state preliminary / no-engagement", analysisA.disclosures.some((d) => /preliminary/i.test(d) && /no-engagement/i.test(d)));
  checkTrue("A: disclosures include the recompute-difference framing", analysisA.disclosures.some((d) => /recompute difference/i.test(d) && /NOT a finding that you overpaid/i.test(d)));

  // 7) Determinism — same input → identical analysis.
  const analysisA2 = analyzeProspect(A);
  checkTrue("A: analyzeProspect is deterministic (headline)", analysisA2.headline === analysisA.headline);
  check("A: analyzeProspect is deterministic (total)", analysisA2.totalPotentialSavings, analysisA.totalPotentialSavings, 0.0001);

  // ─────────────────────────────────────────────────────────────────────────
  // SCENARIO B — W-2 + itemized + IRA + Social Security (MFJ). Exercises W-2,
  // 1099-R, itemized fallback, SS, and the under-reported (diff < 0) framing.
  // ─────────────────────────────────────────────────────────────────────────
  const B: ProspectReturnInput = {
    filingStatus: "married_filing_jointly",
    state: "CA",
    taxYear: 2024,
    wages: 180_000,
    iraDistributions: 25_000,
    socialSecurityBenefits: 20_000,
    itemizedDeductions: 32_000,
    reportedTotalTax: 1_000, // deliberately tiny → ours should be much higher → diff < 0
  };
  const inputsB = mapProspectToInputs(B);
  const engineB = computeTaxReturnPure(inputsB);
  const analysisB = analyzeProspect(B);

  checkTrue("B: W-2 created with Box 1=3=5 = wages", inputsB.w2s.length === 1 && Number(inputsB.w2s[0].wagesBox1) === 180_000 && Number(inputsB.w2s[0].socialSecurityWagesBox3) === 180_000 && Number(inputsB.w2s[0].medicareWagesBox5) === 180_000);
  checkTrue("B: IRA distribution mapped to 1099-R (gross=taxable)", inputsB.form1099s.some((f) => f.formType === "r" && Number(f.grossDistribution) === 25_000 && Number(f.taxableAmount) === 25_000));
  checkTrue("B: SS benefits mapped to client", Number(inputsB.client.socialSecurityBenefits) === 20_000);
  checkTrue("B: itemized mapped to existingItemizedFallback", Number(inputsB.existingItemizedFallback) === 32_000);
  checkTrue("B: no SE / no cap-gain adjustment when fields absent", inputsB.adjustments.length === 0);
  check("B: ourAgi reproduces engine AGI", analysisB.ourAgi, engineB.adjustedGrossIncome, 0.01);
  check("B: ourTotalTax reproduces engine liability", analysisB.ourTotalTax, engineB.federalTaxLiability, 0.01);
  check("B: recomputeDifference = reported − ours (negative)", analysisB.recomputeDifference ?? NaN, 1_000 - engineB.federalTaxLiability, 0.01);
  checkTrue("B: recomputeDifference is negative (we computed MORE tax)", (analysisB.recomputeDifference ?? 0) < 0);
  // Itemized fallback should win over the MFJ standard deduction (32k > 29.2k 2024 MFJ std).
  checkTrue("B: engine picked itemized (32k > MFJ std ded)", engineB.itemizedDeductions != null && engineB.itemizedDeductions >= 32_000);

  // ─────────────────────────────────────────────────────────────────────────
  // SCENARIO C — no reported total tax → recomputeDifference is null, no
  // recompute disclosure line.
  // ─────────────────────────────────────────────────────────────────────────
  const C: ProspectReturnInput = {
    filingStatus: "single",
    state: "TX",
    taxYear: 2025,
    wages: 95_000,
    // no reportedTotalTax
  };
  const analysisC = analyzeProspect(C);
  checkTrue("C: reportedTotalTax is null when absent", analysisC.reportedTotalTax === null);
  checkTrue("C: recomputeDifference is null when no reported tax", analysisC.recomputeDifference === null);
  checkTrue("C: no recompute-difference disclosure line when reported tax absent", !analysisC.disclosures.some((d) => /recompute difference/i.test(d)));
  checkTrue("C: still has the standing preliminary disclosures", analysisC.disclosures.length >= 3 && analysisC.disclosures.some((d) => /preliminary/i.test(d)));
  check("C: taxYear preserved on analysis", analysisC.taxYear, 2025, 0);

  // ─────────────────────────────────────────────────────────────────────────
  // SCENARIO D — honest no-opportunities teaser. A low-income W-2 single filer
  // ($8k wages → $0 federal tax) with nothing for the detectors to bite on:
  // below the standard deduction, no SE income, no investment income, no
  // retirement assets — so SEP / Roth / student-loan / transit detectors all
  // stay silent. (The catalog bites most middle-income filers; this is the
  // genuine zero-hit state the teaser must handle honestly.)
  // ─────────────────────────────────────────────────────────────────────────
  const D: ProspectReturnInput = {
    filingStatus: "single",
    state: "TX",
    taxYear: 2024,
    wages: 8_000,
  };
  const inputsD = mapProspectToInputs(D);
  const engineD = computeTaxReturnPure(inputsD);
  const hitsD = evaluatePlanningOpportunities({
    client: inputsD.client,
    computed: engineD,
    adjustments: inputsD.adjustments,
    baselineInputs: inputsD,
  });
  const analysisD = analyzeProspect(D);
  // This filer is chosen to produce zero hits; if the catalog grows to bite a
  // bare $30k W-2, the assertion below flags it (re-pick the fixture then).
  checkTrue("D: detector produced zero hits for the bare W-2 fixture", hitsD.length === 0);
  check("D: totalPotentialSavings is 0", analysisD.totalPotentialSavings, 0, 0.0001);
  check("D: opportunities is empty", analysisD.opportunities.length, 0, 0);
  checkTrue("D: honest no-opportunities headline", analysisD.headline === `Your TY2024 return looks well-optimized — let's confirm with a full review.`);
  checkTrue("D: no-opportunities teaser still carries disclosures", analysisD.disclosures.length >= 3);

  // ─────────────────────────────────────────────────────────────────────────
  // SCENARIO E — defensive mapping edges.
  // ─────────────────────────────────────────────────────────────────────────
  // E1: a capital LOSS maps as a negative long_term_capital_gain adjustment.
  const E1 = mapProspectToInputs({ filingStatus: "single", taxYear: 2024, wages: 60_000, capitalGains: -5_000 });
  checkTrue("E1: capital loss mapped as negative long_term_capital_gain", E1.adjustments.some((a) => a.adjustmentType === "long_term_capital_gain" && Number(a.amount) === -5_000));
  // E2: qualified > ordinary dividends is clamped to ordinary (can't over-claim preferential).
  const E2 = mapProspectToInputs({ filingStatus: "single", taxYear: 2024, ordinaryDividends: 1_000, qualifiedDividends: 5_000 });
  checkTrue("E2: qualified dividends clamped to ordinary", E2.form1099s.some((f) => f.formType === "div" && Number(f.qualifiedDividends) === 1_000));
  // E3: zero/absent everything → minimal inputs, engine still runs (no throw, finite AGI).
  const E3input: ProspectReturnInput = { filingStatus: "single", taxYear: 2024 };
  const E3 = mapProspectToInputs(E3input);
  checkTrue("E3: empty prospect → no w2s/1099s/adjustments", E3.w2s.length === 0 && E3.form1099s.length === 0 && E3.adjustments.length === 0);
  const analysisE3 = analyzeProspect(E3input);
  checkTrue("E3: empty prospect analysis has finite AGI/tax", Number.isFinite(analysisE3.ourAgi) && Number.isFinite(analysisE3.ourTotalTax));
  check("E3: empty prospect AGI is ~0", analysisE3.ourAgi, 0, 1.0);
  // E4: no itemized → existingItemizedFallback omitted (engine auto-picks std ded).
  checkTrue("E4: existingItemizedFallback omitted when no itemized supplied", E3.existingItemizedFallback === undefined);

  // ─────────────────────────────────────────────────────────────────────────
  // SCENARIO F — PDF render smokes (%PDF).
  // ─────────────────────────────────────────────────────────────────────────
  const pdfA = await buildProspectTeaserPdf({ analysis: analysisA, prospectName: "Pat Prospect", preparedDate: "June 13, 2026", firmName: "Brookhaven CPA" });
  checkTrue("F: teaser PDF (with opportunities) renders %PDF", pdfA.subarray(0, 4).toString("latin1") === "%PDF");
  checkTrue("F: teaser PDF (with opportunities) has sane size", pdfA.length > 1200);

  const pdfD = await buildProspectTeaserPdf({ analysis: analysisD, prospectName: "Zero Hits", preparedDate: "June 13, 2026" });
  checkTrue("F: no-opportunities teaser PDF renders %PDF", pdfD.subarray(0, 4).toString("latin1") === "%PDF");

  const pdfNoFirm = await buildProspectTeaserPdf({ analysis: analysisB, prospectName: "No Firm Name", preparedDate: "June 13, 2026" });
  checkTrue("F: teaser PDF with default firmName renders %PDF", pdfNoFirm.subarray(0, 4).toString("latin1") === "%PDF");

  console.log(`\nRESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
  if (FAIL.length > 0) {
    for (const f of FAIL) console.error(f);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
