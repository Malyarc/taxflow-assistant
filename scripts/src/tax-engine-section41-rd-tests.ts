/**
 * §41 R&D Credit (Form 6765, ASC method) — hand-calc'd tests (P2-15d).
 *
 * Pure engine; no API required. The engine now models the §41 research credit via
 * the Alternative Simplified Credit (ASC) with the §280C(c)(3) reduced-credit
 * election and the §38(c) general-business-credit liability limit (the GBC can't
 * reduce regular tax below the tentative minimum tax; excess carries §39 forward).
 * Detector G1.36 is promoted to engine-verified when QRE is supplied.
 *
 * Hand-calc (ASC, §41(c)(5)):
 *   has 3-yr base : 14% × max(0, currentQRE − 50% × prior-3-yr-avg-QRE)
 *   startup       : 6% × currentQRE
 *   §280C(c)(3)   : reduced credit = gross × (1 − 21%)
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-section41-rd-tests.ts
 */
import { calculateRdCredit } from "../../artifacts/api-server/src/lib/taxCalculator";
import {
  computeTaxReturnPure,
  type TaxReturnInputs,
  type AdjustmentFact,
  type ClientFacts,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";
import {
  evaluatePlanningOpportunities,
  annotateVerifiedSavings,
} from "../../artifacts/api-server/src/lib/planningEngine";

const PASS: string[] = [];
const FAIL: string[] = [];
function check(label: string, actual: number, expected: number, tol = 1): void {
  if (Math.abs(actual - expected) <= tol) PASS.push(`OK ${label}`);
  else FAIL.push(`X ${label}: expected ${expected}±${tol}, got ${actual}`);
}
function checkEq<T>(label: string, actual: T, expected: T): void {
  if (actual === expected) PASS.push(`OK ${label}`);
  else FAIL.push(`X ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function checkBool(label: string, actual: boolean, expected: boolean): void {
  if (actual === expected) PASS.push(`OK ${label}`);
  else FAIL.push(`X ${label}: expected ${expected}, got ${actual}`);
}
function header(t: string) { console.log(`\n-- ${t} --`); }
const A = (t: string, amt: number): AdjustmentFact => ({ adjustmentType: t, amount: amt, isApplied: true });

// ── RD-U: calculateRdCredit unit (ASC / startup / §280C toggle / below-base) ──
header("RD-U: calculateRdCredit unit math");
{
  const asc = calculateRdCredit({ qualifiedResearchExpenses: 100000, priorThreeYearAvgQre: 40000 });
  checkEq("RD-U ASC method", asc.method, "asc");
  check("RD-U ASC base = 50% × $40k", asc.ascBase, 20000);
  check("RD-U ASC gross = 14% × ($100k − $20k)", asc.grossCredit, 11200);
  check("RD-U ASC §280C reduced = gross × 0.79", asc.credit, 8848);

  const full = calculateRdCredit({ qualifiedResearchExpenses: 100000, priorThreeYearAvgQre: 40000, useReducedCredit: false });
  check("RD-U §280C full election = gross (no reduction)", full.credit, 11200);

  const startup = calculateRdCredit({ qualifiedResearchExpenses: 100000, priorThreeYearAvgQre: 0 });
  checkEq("RD-U startup method", startup.method, "startup");
  check("RD-U startup gross = 6% × $100k", startup.grossCredit, 6000);
  check("RD-U startup §280C reduced = $4,740", startup.credit, 4740);

  const belowBase = calculateRdCredit({ qualifiedResearchExpenses: 30000, priorThreeYearAvgQre: 100000 });
  check("RD-U QRE below ASC base → $0 credit", belowBase.credit, 0);

  const none = calculateRdCredit({ qualifiedResearchExpenses: 0, priorThreeYearAvgQre: 40000 });
  checkEq("RD-U no QRE → method none", none.method, "none");
  check("RD-U no QRE → $0", none.credit, 0);
}

// SE filer base: net SE $300k (income tax high enough that the §38 limit doesn't
// bind for a modest credit). State FL (no state tax).
function mk(extra: AdjustmentFact[]): TaxReturnInputs {
  return {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [], form1099s: [],
    adjustments: [A("self_employment_income", 300000), ...extra],
    taxYear: 2024,
  } as unknown as TaxReturnInputs;
}

// ── RD-1: ASC e2e — credit flows to the refund, not §38-limited ──
header("RD-1: ASC §41 credit e2e ($8,848)");
{
  const noRd = computeTaxReturnPure(mk([]));
  const r = computeTaxReturnPure(mk([A("qualified_research_expenses", 100000), A("qualified_research_expenses_prior_avg", 40000)]));
  checkEq("RD-1 method asc", r.rdCredit.method, "asc");
  check("RD-1 grossCredit $11,200", r.rdCredit.grossCredit, 11200);
  check("RD-1 credit (§280C) $8,848", r.rdCredit.credit, 8848);
  check("RD-1 applied $8,848 (not §38-limited)", r.rdCreditApplied, 8848);
  check("RD-1 carryforward 0", r.rdCreditCarryforwardRemaining, 0);
  check("RD-1 refund delta = credit applied", r.federalRefundOrOwed - noRd.federalRefundOrOwed, 8848);
}

// ── RD-2: startup e2e (6%) ──
header("RD-2: startup §41 credit e2e ($4,740)");
{
  const noRd = computeTaxReturnPure(mk([]));
  const r = computeTaxReturnPure(mk([A("qualified_research_expenses", 100000)]));
  checkEq("RD-2 method startup", r.rdCredit.method, "startup");
  check("RD-2 grossCredit $6,000 (6%)", r.rdCredit.grossCredit, 6000);
  check("RD-2 credit (§280C) $4,740", r.rdCredit.credit, 4740);
  check("RD-2 applied $4,740", r.rdCreditApplied, 4740);
  check("RD-2 refund delta = $4,740", r.federalRefundOrOwed - noRd.federalRefundOrOwed, 4740);
}

// ── RD-3: §38(c) liability limit binds (TMT floor) — conservation + bound ──
// $1M QRE startup → credit = 6% × $1M × 0.79 = $47,400, far above the §38 limit
// (regular tax over the tentative minimum tax). The excess carries §39 forward.
header("RD-3: §38(c) GBC limit binds → carryforward");
{
  const noRd = computeTaxReturnPure(mk([]));
  const r = computeTaxReturnPure(mk([A("qualified_research_expenses", 1000000)]));
  check("RD-3 full credit = $47,400", r.rdCredit.credit, 47400);
  checkBool("RD-3 §38 limit bound (applied < credit)", r.rdCreditApplied < r.rdCredit.credit, true);
  checkBool("RD-3 applied > 0", r.rdCreditApplied > 0, true);
  check("RD-3 conservation: applied + carryforward = credit",
    r.rdCreditApplied + r.rdCreditCarryforwardRemaining, r.rdCredit.credit, 1);
  // Only the applied portion reduces this year's tax.
  check("RD-3 refund delta = applied (not full credit)",
    r.federalRefundOrOwed - noRd.federalRefundOrOwed, Math.round(r.rdCreditApplied), 1);
}

// ── RD-4: detector G1.36 engine-verified + heuristic preserved ──
header("RD-4: G1.36 engine-verified (QRE) + heuristic fallback");
{
  const baselineInputs = mk([A("qualified_research_expenses", 100000), A("qualified_research_expenses_prior_avg", 40000)]);
  const computed = computeTaxReturnPure(baselineInputs);
  const client = { filingStatus: "single" } as unknown as ClientFacts;
  const hit = evaluatePlanningOpportunities({ client, computed, adjustments: baselineInputs.adjustments }).find((h) => h.strategyId === "G1.36") ?? null;
  checkBool("RD-4 G1.36 fires (engine-verified)", hit != null, true);
  if (hit) {
    checkEq("RD-4 savingsSource engine-verified", hit.savingsSource, "engine-verified");
    check("RD-4 verifiedSavings = full credit $8,848", hit.verifiedSavings ?? -1, 8848);
    check("RD-4 estSavings $8,848 (not $3k heuristic)", hit.estSavings, 8848);
    check("RD-4 inputs.appliedThisYear $8,848", Number(hit.inputs?.appliedThisYear ?? 0), 8848);
    annotateVerifiedSavings([hit]);
    checkEq("RD-4 engine-verified preserved post-annotate", hit.savingsSource, "engine-verified");
  }

  // Heuristic fallback: SE income, NO QRE marker → $3,000 ($50k × 6%) estimate.
  const heurComputed = computeTaxReturnPure(mk([]));
  const heurHit = evaluatePlanningOpportunities({ client, computed: heurComputed, adjustments: [A("self_employment_income", 300000)] }).find((h) => h.strategyId === "G1.36") ?? null;
  checkBool("RD-4 heuristic fires (SE, no QRE)", heurHit != null, true);
  if (heurHit) {
    check("RD-4 heuristic estSavings $3,000", heurHit.estSavings, 3000, 5);
    annotateVerifiedSavings([heurHit]);
    checkEq("RD-4 heuristic savingsSource estimate", heurHit.savingsSource, "estimate");
  }
}

// ── RD-5 — §39 R&D credit carryforward (auto-seeded prior §38-disallowed) ──
header("RD-5: §39 R&D credit carryforward applies against tax");
{
  const noRd = computeTaxReturnPure(mk([]));
  // Prior-year §39 carryforward $5,000, no current QRE → applies (under the §38 limit).
  const cf = computeTaxReturnPure(mk([A("rd_credit_carryforward", 5000)]));
  check("RD-5 carryforward applied $5,000", cf.rdCreditApplied, 5000);
  check("RD-5 refund delta = $5,000", cf.federalRefundOrOwed - noRd.federalRefundOrOwed, 5000);
  // Current ASC $8,848 + $5,000 carryforward = $13,848 available; conservation holds
  // (applied + carryforward-out = available) regardless of where the §38 limit lands.
  const both = computeTaxReturnPure(mk([A("qualified_research_expenses", 100000), A("qualified_research_expenses_prior_avg", 40000), A("rd_credit_carryforward", 5000)]));
  check("RD-5 current + CF conservation: applied + cf-out = $13,848",
    both.rdCreditApplied + both.rdCreditCarryforwardRemaining, 13848, 1);
  checkBool("RD-5 carryforward augments the current credit", both.rdCreditApplied > 8848, true);
}

// ── Summary ──
console.log(`\n== §41 R&D credit ==  PASS: ${PASS.length}  FAIL: ${FAIL.length}`);
if (FAIL.length > 0) {
  for (const f of FAIL) console.log(f);
  process.exit(1);
}
console.log("ALL §41 R&D ASSERTIONS PASS");
