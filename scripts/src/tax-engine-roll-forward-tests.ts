/**
 * T2.2 D2 — Prior-year roll-forward mapper tests.
 *
 * Pure (no API). Verifies each table's proforma mapping: taxYear advanced,
 * id/timestamps dropped, document links + field boxes detached, K-1 basis
 * rolled start←ending, per-year K-1 facts reset, disposed rentals skipped +
 * the disposal flag reset, and schema-drift passthrough (a column the mapper
 * doesn't know about still rolls).
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-roll-forward-tests.ts
 */

import type { W2Data, Form1099Data, ScheduleK1Data, RentalProperty, AssetBalance } from "@workspace/db";
import {
  rollForwardW2,
  rollForward1099,
  rollForwardK1,
  rollForwardRental,
  rollForwardAssetBalance,
  shouldRollRentalProperty,
} from "../../artifacts/api-server/src/lib/rollForward";

const PASS: string[] = [];
const FAIL: string[] = [];
function checkEq(label: string, actual: unknown, expected: unknown): void {
  if (actual === expected) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function checkTrue(label: string, cond: boolean): void {
  if (cond) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}`);
}

const NOW = new Date("2026-01-15T00:00:00Z");

// ════════════════════════════════════════════════════════════════════════════
// W-2
// ════════════════════════════════════════════════════════════════════════════
{
  const row = {
    id: 7, clientId: 3, documentId: 99, taxYear: 2025,
    employerName: "Acme Corp", employerEin: "12-3456789", employeeSSN: "enc:v1:abc",
    wagesBox1: "120000.00", federalTaxWithheldBox2: "18000.00",
    socialSecurityWagesBox3: "120000.00", socialSecurityTaxBox4: "7440.00",
    medicareWagesBox5: "120000.00", medicareTaxBox6: "1740.00",
    stateTaxWithheldBox17: "6000.00", stateWagesBox16: "120000.00", stateCode: "CA",
    spouse: "spouse", fieldBoxes: { wagesBox1: [1, 2, 3, 4] },
    createdAt: NOW, updatedAt: NOW,
  } as unknown as W2Data;
  const out = rollForwardW2(row, 2026);
  checkEq("W2 taxYear advanced", out.taxYear, 2026);
  checkEq("W2 documentId detached", out.documentId, null);
  checkEq("W2 fieldBoxes detached", out.fieldBoxes, null);
  checkEq("W2 employer kept", out.employerName, "Acme Corp");
  checkEq("W2 encrypted SSN ciphertext copies as-is", out.employeeSSN, "enc:v1:abc");
  checkEq("W2 wages copied as estimate", out.wagesBox1, "120000.00");
  checkEq("W2 spouse tag kept", out.spouse, "spouse");
  checkEq("W2 clientId kept", out.clientId, 3);
  checkTrue("W2 id dropped", !("id" in out));
  checkTrue("W2 createdAt dropped", !("createdAt" in out));
  checkTrue("W2 updatedAt dropped", !("updatedAt" in out));
}

// ════════════════════════════════════════════════════════════════════════════
// 1099 + schema-drift passthrough
// ════════════════════════════════════════════════════════════════════════════
{
  const row = {
    id: 1, clientId: 3, documentId: 5, taxYear: 2025, formType: "nec",
    payerName: "ClientCo", payerTin: "enc:v1:tin", recipientTin: null,
    nonemployeeCompensation: "80000.00", federalTaxWithheld: null,
    stateTaxWithheld: null, stateCode: "CA", spouse: "taxpayer",
    fieldBoxes: null, createdAt: NOW, updatedAt: NOW,
    someFutureColumn: "rolls through",
  } as unknown as Form1099Data;
  const out = rollForward1099(row, 2026) as Record<string, unknown>;
  checkEq("1099 taxYear advanced", out.taxYear, 2026);
  checkEq("1099 documentId detached", out.documentId, null);
  checkEq("1099 payer kept", out.payerName, "ClientCo");
  checkEq("1099 amount copied", out.nonemployeeCompensation, "80000.00");
  checkEq("1099 schema-drift column rolls through", out.someFutureColumn, "rolls through");
  checkTrue("1099 id dropped", !("id" in out));
}

// ════════════════════════════════════════════════════════════════════════════
// K-1: basis start ← prior ending; per-year facts reset.
// ════════════════════════════════════════════════════════════════════════════
{
  const row = {
    id: 2, clientId: 3, taxYear: 2025, entityName: "Fund LP", entityEin: null,
    entityType: "partnership", activityType: "passive",
    box1OrdinaryIncome: "25000.00", box2RentalRealEstate: "0", box3OtherRentalIncome: "0",
    box4GuaranteedPayments: "0", interestIncome: "100.00", ordinaryDividends: "0",
    qualifiedDividends: "0", royalties: "0", netShortTermCapitalGain: "0",
    netLongTermCapitalGain: "0", selfEmploymentEarnings: "0", isSstb: false,
    section199aQbi: "25000.00", section199aW2Wages: "0", section199aUbia: "0",
    basisAtYearStart: "40000.00", basisAtYearEnd: "52000.00", atRiskAmount: "40000.00",
    distributions: "5000.00", separatelyStatedDeductions: "1000.00",
    notes: "n", createdAt: NOW, updatedAt: NOW,
  } as unknown as ScheduleK1Data;
  const out = rollForwardK1(row, 2026);
  checkEq("K1 taxYear advanced", out.taxYear, 2026);
  checkEq("K1 opening basis = prior ENDING basis", out.basisAtYearStart, "52000.00");
  checkEq("K1 ending basis reset", out.basisAtYearEnd, null);
  checkEq("K1 distributions reset", out.distributions, null);
  checkEq("K1 separately-stated deductions reset", out.separatelyStatedDeductions, null);
  checkEq("K1 entity kept", out.entityName, "Fund LP");
  checkEq("K1 Box 1 copied as estimate", out.box1OrdinaryIncome, "25000.00");
  checkEq("K1 activityType kept", out.activityType, "passive");

  // No ending basis recorded → keep the prior opening basis.
  const out2 = rollForwardK1({ ...row, basisAtYearEnd: null } as unknown as ScheduleK1Data, 2026);
  checkEq("K1 missing ending basis → opening basis carried", out2.basisAtYearStart, "40000.00");
}

// ════════════════════════════════════════════════════════════════════════════
// Rental: disposed skipped; flag reset; P&L copied as estimate.
// ════════════════════════════════════════════════════════════════════════════
{
  const row = {
    id: 4, clientId: 3, taxYear: 2025, address: "12 Main St", propertyType: "residential",
    basis: "300000.00", placedInServiceYear: 2020, placedInServiceMonth: 6,
    fairRentalDays: 365, personalUseDays: 0, isActiveParticipant: true,
    rentalIncome: "30000.00", totalExpenses: "12000.00",
    fullyDisposedThisYear: false, suspendedLossCarryforward: "8000.00",
    notes: null, createdAt: NOW, updatedAt: NOW,
  } as unknown as RentalProperty;
  checkTrue("rental kept (not disposed)", shouldRollRentalProperty(row));
  checkTrue("rental disposed → skipped", !shouldRollRentalProperty({ ...row, fullyDisposedThisYear: true }));
  const out = rollForwardRental(row, 2026);
  checkEq("rental taxYear advanced", out.taxYear, 2026);
  checkEq("rental disposal flag reset", out.fullyDisposedThisYear, false);
  checkEq("rental income copied as estimate", out.rentalIncome, "30000.00");
  checkEq("rental suspended-loss column carried (CPA-maintained)", out.suspendedLossCarryforward, "8000.00");
  checkEq("rental MACRS inputs kept", out.placedInServiceYear, 2020);
}

// ════════════════════════════════════════════════════════════════════════════
// Asset balance
// ════════════════════════════════════════════════════════════════════════════
{
  const row = {
    id: 9, clientId: 3, taxYear: 2025, assetType: "traditional_ira",
    accountName: "Vanguard IRA", balance: "500000.00", costBasis: null,
    afterTaxBasis: "20000.00", nuaEligible: false, notes: null,
    createdAt: NOW, updatedAt: NOW,
  } as unknown as AssetBalance;
  const out = rollForwardAssetBalance(row, 2026);
  checkEq("asset taxYear advanced", out.taxYear, 2026);
  checkEq("asset balance carried as opening baseline", out.balance, "500000.00");
  checkEq("asset after-tax basis carried (Form 8606 continuity)", out.afterTaxBasis, "20000.00");
  checkTrue("asset id dropped", !("id" in out));
}

console.log(`\nRESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length > 0) {
  for (const f of FAIL) console.error(f);
  process.exit(1);
}
