/**
 * T2.1 — Workpaper builder tests: state summaries NJ-1040 / MA Form 1 / PA-40 /
 * generic (group "state-njmapa-generic"). Pure — no API, no DB.
 *
 * These are SUMMARY workpapers over the engine's state AGGREGATES; the strong
 * structural check is the per-state component tie-out (each builder's
 * checkLine that its tax rows sum to ret.stateTaxLiability) plus a few clean
 * hand-calc'd flat-rate values (PA 3.07%, MA 5.0%). No per-state refund is
 * rendered (the engine settles state-side in aggregate).
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-workpaper-state-njmapa-generic-tests.ts
 */

import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";
import { buildNj1040 } from "../../artifacts/api-server/src/lib/forms/stateNj1040Spec";
import { buildMaForm1 } from "../../artifacts/api-server/src/lib/forms/stateMaForm1Spec";
import { buildPa40 } from "../../artifacts/api-server/src/lib/forms/statePa40Spec";
import { buildStateGeneric } from "../../artifacts/api-server/src/lib/forms/stateGenericSpec";
import type {
  FormBuildContext,
  FormInstance,
  FormLine,
  WorkpaperTaxpayer,
} from "../../artifacts/api-server/src/lib/forms/formSpec";

const PASS: string[] = [];
const FAIL: string[] = [];
function check(label: string, actual: number, expected: number, tol = 0.02): void {
  if (Number.isFinite(actual) && Math.abs(actual - expected) <= tol) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected}, got ${actual}`);
}
function checkTrue(label: string, cond: boolean): void {
  if (cond) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}`);
}

const allLines = (inst: FormInstance): FormLine[] => inst.parts.flatMap((p) => p.lines);
const findByLabel = (inst: FormInstance, frag: string): FormLine | undefined =>
  allLines(inst).find((l) => l.label.includes(frag));
const num = (l: FormLine | undefined): number =>
  l != null && typeof l.value === "number" ? l.value : NaN;

function assertTies(label: string, inst: FormInstance): void {
  const checks = allLines(inst).filter(
    (l) => typeof l.value === "string" && (l.value === "ties" || l.value.startsWith("off by")),
  );
  const offs = checks.filter((l) => l.value !== "ties");
  if (checks.length === 0) FAIL.push(`✗ ${label}: expected a tie-out row, found none`);
  else if (offs.length === 0) PASS.push(`✓ ${label}: all ${checks.length} tie-out rows tie`);
  else FAIL.push(`✗ ${label}: ${offs.length} off — ${offs.map((l) => l.label).join("; ")}`);
}
function assertNoNaN(label: string, inst: FormInstance): void {
  const bad = allLines(inst).filter(
    (l) => l.kind === "money" && l.value != null && (typeof l.value !== "number" || !Number.isFinite(l.value)),
  );
  if (bad.length === 0) PASS.push(`✓ ${label}: no NaN money lines`);
  else FAIL.push(`✗ ${label}: ${bad.length} bad money line(s)`);
}
/** Summary workpapers must NOT render a per-state refund/balance line. */
function assertNoRefundLine(label: string, inst: FormInstance): void {
  const bad = allLines(inst).find((l) => /state refund|state balance due/i.test(l.label) && typeof l.value === "number");
  if (!bad) PASS.push(`✓ ${label}: no per-state refund line (aggregate settlement)`);
  else FAIL.push(`✗ ${label}: rendered a per-state refund line "${bad.label}"`);
}

function residentW2(state: string, wages = 90000): TaxReturnInputs {
  return {
    client: { filingStatus: "single", state, taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: wages, federalTaxWithheldBox2: 10000, stateCode: state, stateTaxWithheldBox17: 4000 }],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  };
}
function ctxFor(inputs: TaxReturnInputs): { ctx: FormBuildContext; ret: ReturnType<typeof computeTaxReturnPure> } {
  const ret = computeTaxReturnPure(inputs);
  const taxpayer: WorkpaperTaxpayer = {
    firstName: "Test", lastName: "Client",
    filingStatus: inputs.client.filingStatus, state: inputs.client.state ?? "FL",
  };
  return { ctx: { taxpayer, ret, inputs }, ret };
}

// ── S1 — NJ resident ($90k W-2) ──
{
  const { ctx, ret } = ctxFor(residentW2("NJ"));
  const f = buildNj1040(ctx);
  checkTrue("S1 NJ-1040 applicable (resident)", f !== null);
  if (f) {
    assertTies("S1 NJ-1040", f);
    assertNoNaN("S1 NJ-1040", f);
    assertNoRefundLine("S1 NJ-1040", f);
    check("S1 NJ line 42 tax == engine resident tax", num(findByLabel(f, "New Jersey gross income tax")), ret.multiState.residentStateTax);
    checkTrue("S1 NJ builders null for non-NJ state", buildNj1040(ctxFor(residentW2("PA")).ctx) === null);
  }
}

// ── S2 — MA resident ($90k W-2): 5.0% flat → $4,500 ──
{
  const { ctx, ret } = ctxFor(residentW2("MA"));
  const f = buildMaForm1(ctx);
  checkTrue("S2 MA Form 1 applicable (resident)", f !== null);
  check("S2 engine MA tax 5.0% × $90,000 = $4,500", ret.multiState.residentStateTax, 4500);
  if (f) {
    assertTies("S2 MA Form 1", f);
    assertNoNaN("S2 MA Form 1", f);
    assertNoRefundLine("S2 MA Form 1", f);
    check("S2 MA line 22 5.0% tax row == $4,500", num(findByLabel(f, "Tax on 5.0% income")), 4500);
  }
}

// ── S3 — PA resident ($90k W-2): 3.07% flat → $2,763 ──
{
  const { ctx, ret } = ctxFor(residentW2("PA"));
  const f = buildPa40(ctx);
  checkTrue("S3 PA-40 applicable (resident)", f !== null);
  check("S3 engine PA tax 3.07% × $90,000 = $2,763", ret.multiState.residentStateTax, 2763);
  if (f) {
    assertTies("S3 PA-40", f);
    assertNoNaN("S3 PA-40", f);
    assertNoRefundLine("S3 PA-40", f);
    check("S3 PA line 12 flat-3.07% row == $2,763", num(findByLabel(f, "PA income tax — flat 3.07%")), 2763);
    checkTrue("S3 PA builder null for non-PA state", buildPa40(ctxFor(residentW2("OH")).ctx) === null);
  }
}

// ── S4 — Generic state (OH resident $90k W-2) ──
{
  const { ctx, ret } = ctxFor(residentW2("OH"));
  const f = buildStateGeneric(ctx);
  checkTrue("S4 generic builder applicable (OH)", f !== null);
  if (f) {
    assertTies("S4 generic (OH)", f);
    assertNoNaN("S4 generic (OH)", f);
    assertNoRefundLine("S4 generic (OH)", f);
    check("S4 OH resident tax row == engine resident tax", num(findByLabel(f, "Resident state (OH) tax")), ret.multiState.residentStateTax);
    checkTrue("S4 generic builder null for a DEDICATED state (PA)", buildStateGeneric(ctxFor(residentW2("PA")).ctx) === null);
  }
}

// ── S4b — WA capital-gains excise labeled row ──
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "WA", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 100000, federalTaxWithheldBox2: 12000, stateCode: "WA" }],
    form1099s: [],
    adjustments: [{ adjustmentType: "long_term_capital_gain", amount: 600000, isApplied: true }],
    taxYear: 2024,
  };
  const { ctx, ret } = ctxFor(inputs);
  const f = buildStateGeneric(ctx);
  checkTrue("S4b WA generic applicable (LTCG excise)", f !== null);
  if (f) {
    assertNoNaN("S4b WA generic", f);
    const exciseRow = allLines(f).find((l) => l.label.includes("excise basis") || l.value === "RCW 82.87");
    checkTrue("S4b WA excise basis row present (RCW 82.87)", exciseRow !== undefined);
    checkTrue("S4b WA has positive state tax (excise)", ret.stateTaxLiability > 0);
  }
}

// ── S5 — Null gates: FL resident, NO state withholding → all builders null ──
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 90000, federalTaxWithheldBox2: 10000 }],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  };
  const { ctx } = ctxFor(inputs);
  checkTrue("S5 NJ-1040 null (FL resident)", buildNj1040(ctx) === null);
  checkTrue("S5 MA Form 1 null (FL resident)", buildMaForm1(ctx) === null);
  checkTrue("S5 PA-40 null (FL resident)", buildPa40(ctx) === null);
  checkTrue("S5 generic null (FL, no income tax, no withholding)", buildStateGeneric(ctx) === null);
}

console.log(`\nT2.1 workpaper — state summaries NJ/MA/PA/generic (state-njmapa-generic):`);
console.log(`RESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length) { for (const f of FAIL) console.error(`  ${f}`); process.exit(1); }
for (const p of PASS) console.log(`  ${p}`);
process.exit(0);
