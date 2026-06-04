/**
 * PREP-B1 — state-base modifications: out-of-state muni-bond interest add-back
 * (federally exempt but state-taxable) + US-Treasury interest subtraction
 * (federally taxable but state-exempt by preemption).
 *
 * NC TY2024 is flat 4.5%, so each modification moves the state tax linearly:
 * the deltas isolate the modification (the NC std ded cancels in a delta).
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-state-modifications-tests.ts
 */
import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";

let passed = 0;
let failed = 0;
function check(label: string, actual: number, expected: number, tol = 1.5) {
  if (Math.abs(actual - expected) <= tol) { passed++; console.log(`  ok    ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}: expected ${expected}, got ${actual}`); }
}
const adj = (type: string, amount: number) => ({ adjustmentType: type, amount: String(amount), isApplied: true });

// Single NC TY2024, $200k W-2 + optional taxable interest + optional state mods.
function ncStateTax(opts: { interest?: number; muni?: number; treasury?: number }): number {
  const adjustments: TaxReturnInputs["adjustments"] = [];
  if (opts.muni) adjustments.push(adj("out_of_state_muni_interest", opts.muni));
  if (opts.treasury) adjustments.push(adj("us_treasury_interest", opts.treasury));
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "NC", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 200000, federalTaxWithheldBox2: 0, stateCode: "NC" }],
    form1099s: opts.interest ? [{ taxYear: 2024, formType: "int", interestIncome: opts.interest }] : [],
    adjustments,
    taxYear: 2024,
  };
  return computeTaxReturnPure(inputs).stateTaxLiability;
}

console.log("── state-base modifications (NC flat 4.5%) ──");
// Muni add-back: +$10k out-of-state muni interest (state-taxable, NOT in fed AGI).
const baseMuni = ncStateTax({});
const withMuni = ncStateTax({ muni: 10000 });
check("muni add-back: NC tax +$450 (+$10,000 × 4.5%)", withMuni - baseMuni, 450);

// US-Treasury subtraction: $5k taxable interest IN fed AGI, exempted at the state.
const baseTreasury = ncStateTax({ interest: 5000 });
const withTreasury = ncStateTax({ interest: 5000, treasury: 5000 });
check("US-Treasury subtraction: NC tax −$225 (−$5,000 × 4.5%)", baseTreasury - withTreasury, 225);

// Combined: +$10k muni − $5k treasury = +$5k net → +$225.
const baseCombined = ncStateTax({ interest: 5000 });
const withBoth = ncStateTax({ interest: 5000, muni: 10000, treasury: 5000 });
check("combined net +$225 (+$10k muni − $5k treasury, × 4.5%)", withBoth - baseCombined, 225);

// Rate-independent cross-check: the $10k muni effect is exactly 2× the $5k
// treasury effect (linear in the modification, regardless of the state rate).
check("muni delta = 2× treasury delta (linear)", withMuni - baseMuni, 2 * (baseTreasury - withTreasury), 1);

// Federal tax must be UNCHANGED by state modifications (they touch only the
// state base — muni stays federally exempt, treasury stays federally taxable).
const baseFed = computeTaxReturnPure({
  client: { filingStatus: "single", state: "NC", taxYear: 2024 },
  w2s: [{ taxYear: 2024, wagesBox1: 200000, stateCode: "NC" }],
  form1099s: [{ taxYear: 2024, formType: "int", interestIncome: 5000 }],
  adjustments: [], taxYear: 2024,
}).federalTaxLiability;
const modFed = computeTaxReturnPure({
  client: { filingStatus: "single", state: "NC", taxYear: 2024 },
  w2s: [{ taxYear: 2024, wagesBox1: 200000, stateCode: "NC" }],
  form1099s: [{ taxYear: 2024, formType: "int", interestIncome: 5000 }],
  adjustments: [adj("out_of_state_muni_interest", 10000), adj("us_treasury_interest", 5000)],
  taxYear: 2024,
}).federalTaxLiability;
check("federal tax unchanged by state modifications", modFed, baseFed, 0.5);

console.log(`\nRESULTS: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("ALL PREP-B1 STATE-MODIFICATION CHECKS GREEN");
