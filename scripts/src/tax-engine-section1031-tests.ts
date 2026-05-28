/**
 * C5 — §1031 Like-Kind Exchange (post-TCJA: real property only) —
 * hand-calc'd tests against the engine's `computeTaxReturnPure`.
 *
 * Pure engine; no API required.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-section1031-tests.ts
 *
 * Reference: IRC §1031, Form 8824 instructions.
 *
 * Engine model (MVP):
 *   - CPA enters two adjustment types per year (aggregated across all
 *     1031 exchanges):
 *       section_1031_realized_gain   — gross gain (FMV given up − basis)
 *       section_1031_boot_received   — cash + non-like-kind property
 *                                       received (and net mortgage relief)
 *   - Engine: recognized = min(realized, boot); deferred = realized − recognized.
 *     Recognized flows to LTCG (long-term character per §1031 holding intent).
 *   - Eligibility (like-kind classification, 45-day ID, 180-day completion,
 *     qualified intermediary): CPA's responsibility — engine assumes valid.
 */
import { computeTaxReturnPure } from "../../artifacts/api-server/src/lib/taxReturnEngine";
import type { TaxReturnInputs } from "../../artifacts/api-server/src/lib/taxReturnEngine";

const PASS: string[] = [];
const FAIL: string[] = [];

function check(label: string, actual: number, expected: number, tol = 1): void {
  if (Math.abs(actual - expected) <= tol) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected}, got ${actual}`);
}

/** Minimal-viable TaxReturnInputs (single, FL, no kids, $80k W-2). */
function baseInputs(extra: Partial<TaxReturnInputs> = {}): TaxReturnInputs {
  const client = {
    id: 1, firstName: "Test", lastName: "Section1031",
    email: "test@example.com", phone: null,
    filingStatus: "single", state: "FL", taxYear: 2024,
    dependentsUnder17: 0, otherDependents: 0, dependentsForCareCredit: 0,
    taxpayerAge: 45, spouseAge: null, spouseEarnedIncome: null,
    hsaIsFamilyCoverage: false, iraCoveredByWorkplacePlan: false,
    eligibleEducatorCount: 0, acaAnnualPremium: null, acaAnnualSlcsp: null,
    acaAdvanceAptc: null, acaHouseholdSize: null,
    rentalActiveParticipant: true, rentalRealEstateProfessional: false,
    localityCode: null, socialSecurityBenefits: null,
    mfsLivedApartAllYear: false, isKiddieTaxFiler: false,
    parentsTopMarginalRate: null, priorYearItemized: null,
    residencyChangedInYear: false, formerState: null, residencyChangeDate: null,
    notes: null, createdAt: new Date(), updatedAt: new Date(),
  };
  const w2 = {
    id: 1, clientId: 1, taxYear: 2024, documentId: null,
    employerName: "Test Employer", employerEin: null,
    wagesBox1: "80000", federalWithholdingBox2: "10000",
    socialSecurityWagesBox3: "80000", socialSecurityTaxBox4: "4960",
    medicareWagesBox5: "80000", medicareTaxBox6: "1160",
    socialSecurityTipsBox7: "0", allocatedTipsBox8: "0",
    dependentCareBenefitsBox10: "0", nonqualifiedPlansBox11: "0",
    box12aCode: null, box12aAmount: "0", box12bCode: null, box12bAmount: "0",
    box12cCode: null, box12cAmount: "0", box12dCode: null, box12dAmount: "0",
    statutoryEmployeeBox13: false, retirementPlanBox13: false, thirdPartySickPayBox13: false,
    box14Description: null, box14Amount: "0",
    stateBox15: "FL", stateWagesBox16: "80000", stateTaxBox17: "0",
    localWagesBox18: "0", localTaxBox19: "0", localityNameBox20: null,
    spouse: null, createdAt: new Date(), updatedAt: new Date(),
  };
  return {
    client: client as TaxReturnInputs["client"],
    w2s: [w2 as unknown as TaxReturnInputs["w2s"][number]],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
    ...extra,
  };
}

function adj(type: string, amount: number, id = Math.floor(Math.random() * 1e9)): TaxReturnInputs["adjustments"][number] {
  return {
    id, clientId: 1, adjustmentType: type, amount: String(amount),
    description: `test ${type}`, category: null, isApplied: true,
    createdAt: new Date(), updatedAt: new Date(),
  } as unknown as TaxReturnInputs["adjustments"][number];
}

// ── Case 1: No §1031 — all zeros ─────────────────────────────────────────
{
  const r = computeTaxReturnPure(baseInputs());
  check("Case 1 no exchange — realized", r.section1031RealizedGain, 0);
  check("Case 1 no exchange — boot", r.section1031BootReceived, 0);
  check("Case 1 no exchange — recognized", r.section1031RecognizedGain, 0);
  check("Case 1 no exchange — deferred", r.section1031DeferredGain, 0);
}

// ── Case 2: Realized > Boot — partial recognition ────────────────────────
// Realized gain $200,000; boot $30,000.
//   recognized = min(200k, 30k) = $30,000 (added to LTCG)
//   deferred = 200k - 30k = $170,000 (carries to replacement basis)
{
  const r = computeTaxReturnPure(baseInputs({
    adjustments: [
      adj("section_1031_realized_gain", 200000, 1001),
      adj("section_1031_boot_received", 30000, 1002),
    ],
  }));
  check("Case 2 realized", r.section1031RealizedGain, 200000);
  check("Case 2 boot", r.section1031BootReceived, 30000);
  check("Case 2 recognized = min(200k, 30k)", r.section1031RecognizedGain, 30000);
  check("Case 2 deferred = 200k - 30k", r.section1031DeferredGain, 170000);
  // Hand-calc: recognized $30k flows to LTCG (only LTCG source here).
  // preferentialIncome = LTCG + QDIV; with no QDIV, this should = $30k.
  check("Case 2 preferentialIncome includes recognized gain", r.preferentialIncome, 30000);
}

// ── Case 3: Realized = Boot — full recognition (no deferral) ─────────────
// Functionally a regular sale wrapped in 1031 form (sometimes happens
// when CPA doesn't structure the exchange optimally).
{
  const r = computeTaxReturnPure(baseInputs({
    adjustments: [
      adj("section_1031_realized_gain", 50000, 1003),
      adj("section_1031_boot_received", 50000, 1004),
    ],
  }));
  check("Case 3 recognized = $50k", r.section1031RecognizedGain, 50000);
  check("Case 3 deferred = $0", r.section1031DeferredGain, 0);
}

// ── Case 4: Realized < Boot — recognition cap at realized ────────────────
// You can never recognize more gain than you realized. Boot in excess of
// gain doesn't create phantom income.
{
  const r = computeTaxReturnPure(baseInputs({
    adjustments: [
      adj("section_1031_realized_gain", 30000, 1005),
      adj("section_1031_boot_received", 50000, 1006),
    ],
  }));
  check("Case 4 recognized capped at realized", r.section1031RecognizedGain, 30000);
  check("Case 4 deferred = $0", r.section1031DeferredGain, 0);
}

// ── Case 5: Zero boot — classic full-deferral 1031 ───────────────────────
{
  const r = computeTaxReturnPure(baseInputs({
    adjustments: [
      adj("section_1031_realized_gain", 200000, 1007),
      // No boot adjustment at all (sum = 0).
    ],
  }));
  check("Case 5 recognized = $0 (no boot)", r.section1031RecognizedGain, 0);
  check("Case 5 deferred = $200k (full deferral)", r.section1031DeferredGain, 200000);
  // Preferential income should be 0 — full deferral means no current tax.
  check("Case 5 preferentialIncome stays 0", r.preferentialIncome, 0);
}

// ── Case 6: Negative inputs (malformed) — defensive floor at 0 ───────────
{
  const r = computeTaxReturnPure(baseInputs({
    adjustments: [
      adj("section_1031_realized_gain", -5000, 1008),
      adj("section_1031_boot_received", -10000, 1009),
    ],
  }));
  check("Case 6 negative realized floors", r.section1031RealizedGain, 0);
  check("Case 6 negative boot floors", r.section1031BootReceived, 0);
  check("Case 6 recognized = 0", r.section1031RecognizedGain, 0);
  check("Case 6 deferred = 0", r.section1031DeferredGain, 0);
}

// ── Case 7: Multiple exchanges in one year (adjustments aggregate) ───────
// Exchange 1: realized $100k, boot $20k. Exchange 2: realized $50k, boot $10k.
// Engine aggregates by type: realized = $150k, boot = $30k.
//   recognized = min(150, 30) = $30k
//   deferred = 150 - 30 = $120k
{
  const r = computeTaxReturnPure(baseInputs({
    adjustments: [
      adj("section_1031_realized_gain", 100000, 1010),
      adj("section_1031_boot_received", 20000, 1011),
      adj("section_1031_realized_gain", 50000, 1012),
      adj("section_1031_boot_received", 10000, 1013),
    ],
  }));
  check("Case 7 aggregated realized", r.section1031RealizedGain, 150000);
  check("Case 7 aggregated boot", r.section1031BootReceived, 30000);
  check("Case 7 recognized = min(150k, 30k)", r.section1031RecognizedGain, 30000);
  check("Case 7 deferred = 120k", r.section1031DeferredGain, 120000);
}

// ── Case 8: §1031 stacks with regular LTCG ───────────────────────────────
// Regular LTCG $20k + §1031 recognized $30k → netLTCG = $50k.
// Inputs: 1099-DIV with longTermCapitalGains $20k + 1031 adjustments.
{
  const inputs = baseInputs({
    form1099s: [{
      id: 99, clientId: 1, taxYear: 2024, documentId: null,
      formType: "div",
      payerName: "Broker", payerTin: null, recipientTin: null,
      totalCapitalGainDistribution: "20000",
    }] as unknown as TaxReturnInputs["form1099s"],
    adjustments: [
      adj("section_1031_realized_gain", 200000, 1014),
      adj("section_1031_boot_received", 30000, 1015),
    ],
  });
  const r = computeTaxReturnPure(inputs);
  // recognized §1031 gain $30k + regular LTCG $20k = $50k preferential.
  check("Case 8 §1031 + regular LTCG total preferential", r.preferentialIncome, 50000);
  // recognized §1031 gain alone:
  check("Case 8 §1031 recognized", r.section1031RecognizedGain, 30000);
  // Deferred should be unaffected by other LTCG.
  check("Case 8 §1031 deferred = $170k", r.section1031DeferredGain, 170000);
}

// ── Case 9: §1031 recognized gain flows into BOTH AGI and the NIIT base ───
// The recognized gain (boot) on an investment-property exchange is net
// investment income under §1411(c)(1)(A)(iii). It flows to netLTCG → AGI
// (CLAUDE invariant #1) AND into the §1411 NII base. Fixed 2026-05-28 deep
// audit (finding M-1): the NII base is now built from the engine's component
// buckets — incl. post-netting gains (§121 remainder, §1031 recognized, QSBS,
// K-1 Box 8/9a) — not just form1099Summary.totalInvestmentIncome.
// Hand-calc: $300k W-2 + $50k recognized §1031 LTCG → AGI $350,000.
//   NII = $50,000; NIIT = 3.8% × min($50,000, $350,000 − $200,000 single) = $1,900.
{
  const inputs = baseInputs({
    w2s: [{
      ...baseInputs().w2s[0],
      wagesBox1: "300000",
      federalWithholdingBox2: "60000",
      socialSecurityWagesBox3: "168600",
      socialSecurityTaxBox4: "10453.20",
      medicareWagesBox5: "300000",
      medicareTaxBox6: "4350",
      stateWagesBox16: "300000",
    } as unknown as TaxReturnInputs["w2s"][number]],
    adjustments: [
      adj("section_1031_realized_gain", 80000, 1016),
      adj("section_1031_boot_received", 50000, 1017),
    ],
  });
  const r = computeTaxReturnPure(inputs);
  check("Case 9 §1031 recognized = $50k", r.section1031RecognizedGain, 50000);
  check("Case 9 §1031 recognized gain is NII → NIIT = $1,900", r.niitTax, 1900);
}

// ── Case 10: §1031 recognized increases AGI (CLAUDE invariant #1) ────────
// Per CLAUDE.md invariant: AGI includes LTCG → recognized §1031 gain must
// flow into adjustedGrossIncome.
//
// $80k W-2 + $30k recognized gain → expected AGI ≈ $110k.
{
  const r = computeTaxReturnPure(baseInputs({
    adjustments: [
      adj("section_1031_realized_gain", 200000, 1018),
      adj("section_1031_boot_received", 30000, 1019),
    ],
  }));
  // Engine total income calculation includes recognized 1031 gain in LTCG,
  // which is in ordinaryAdditionalIncome per the invariant (taxed at
  // preferential rate downstream, but in AGI here).
  check("Case 10 AGI includes recognized §1031 gain", r.adjustedGrossIncome, 110000);
}

console.log(`\n§1031 (C5) like-kind exchange tests:`);
console.log(`  ✓ Passed: ${PASS.length}`);
console.log(`  ✗ Failed: ${FAIL.length}`);
if (FAIL.length > 0) FAIL.forEach((f) => console.log(`    ${f}`));
process.exit(FAIL.length > 0 ? 1 : 0);
