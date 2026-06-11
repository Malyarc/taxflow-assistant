/**
 * T2.2 D2 — Client organizer / document-request-list tests.
 *
 * Pure (no API). Fixture-driven verification of the matching rules: per-
 * employer W-2s, per-(formType,payer) 1099s, per-entity K-1s, per-address
 * rentals, per-account statements; prior-return-driven deduction reminders;
 * profile items; the life-events questionnaire; status counts.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-client-organizer-tests.ts
 */

import {
  buildClientOrganizer,
  type BuildOrganizerArgs,
  type YearDataRows,
} from "../../artifacts/api-server/src/lib/clientOrganizer";

const PASS: string[] = [];
const FAIL: string[] = [];
function check(label: string, actual: number, expected: number): void {
  if (actual === expected) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected}, got ${actual}`);
}
function checkStr(label: string, actual: string | undefined, expected: string): void {
  if (actual === expected) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected "${expected}", got "${actual}"`);
}
function checkTrue(label: string, cond: boolean): void {
  if (cond) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}`);
}

const empty = (): YearDataRows => ({
  w2s: [], form1099s: [], scheduleK1s: [], rentalProperties: [], assetBalances: [],
});

const baseArgs = (over: Partial<BuildOrganizerArgs>): BuildOrganizerArgs => ({
  taxYear: 2026,
  client: { filingStatus: "single" },
  priorYear: empty(),
  currentYear: empty(),
  priorReturn: null,
  ...over,
});

// ════════════════════════════════════════════════════════════════════════════
// O1 — W-2 employer matching: case/space-insensitive; received flips status.
// ════════════════════════════════════════════════════════════════════════════
{
  const r = buildClientOrganizer(baseArgs({
    priorYear: { ...empty(), w2s: [{ employerName: "Acme Corp" }, { employerName: "Beta LLC" }] },
    currentYear: { ...empty(), w2s: [{ employerName: "  ACME CORP " }] },
  }));
  const acme = r.items.find((i) => i.id === "w2:acme corp");
  const beta = r.items.find((i) => i.id === "w2:beta llc");
  checkTrue("O1 Acme item exists", acme != null);
  checkStr("O1 Acme received (case/space-insensitive)", acme?.status, "received");
  checkStr("O1 Beta still missing", beta?.status, "missing");
  checkStr("O1 source = prior_year", acme?.source ?? "", "prior_year");
  check("O1 years", r.priorYear, 2025);
}

// ════════════════════════════════════════════════════════════════════════════
// O2 — duplicate prior employers collapse to ONE request; unnamed matches any.
// ════════════════════════════════════════════════════════════════════════════
{
  const r = buildClientOrganizer(baseArgs({
    priorYear: { ...empty(), w2s: [{ employerName: "Acme" }, { employerName: "acme" }, { employerName: null }] },
  }));
  check("O2 two W-2 items (Acme deduped + unnamed)", r.items.filter((i) => i.id.startsWith("w2:")).length, 2);
  const unnamed = r.items.find((i) => i.id === "w2:unnamed");
  checkStr("O2 unnamed missing with no current W-2s", unnamed?.status, "missing");

  const r2 = buildClientOrganizer(baseArgs({
    priorYear: { ...empty(), w2s: [{ employerName: null }] },
    currentYear: { ...empty(), w2s: [{ employerName: "Whoever Inc" }] },
  }));
  checkStr("O2 unnamed prior W-2 matches ANY current W-2",
    r2.items.find((i) => i.id === "w2:unnamed")?.status, "received");
}

// ════════════════════════════════════════════════════════════════════════════
// O3 — 1099 matching is per (formType, payer); same payer different type ≠ match.
// ════════════════════════════════════════════════════════════════════════════
{
  const r = buildClientOrganizer(baseArgs({
    priorYear: { ...empty(), form1099s: [
      { formType: "int", payerName: "Chase" },
      { formType: "div", payerName: "Chase" },
      { formType: "nec", payerName: "ClientCo" },
    ] },
    currentYear: { ...empty(), form1099s: [{ formType: "int", payerName: "chase" }] },
  }));
  checkStr("O3 1099-INT Chase received", r.items.find((i) => i.id === "1099:int:chase")?.status, "received");
  checkStr("O3 1099-DIV Chase still missing (type-scoped)", r.items.find((i) => i.id === "1099:div:chase")?.status, "missing");
  checkStr("O3 1099-NEC ClientCo missing", r.items.find((i) => i.id === "1099:nec:clientco")?.status, "missing");
  checkTrue("O3 NEC title labels the form", r.items.find((i) => i.id === "1099:nec:clientco")!.title.includes("1099-NEC"));
}

// ════════════════════════════════════════════════════════════════════════════
// O4 — K-1 / rental / account matching + the SE books & 1040-ES items.
// ════════════════════════════════════════════════════════════════════════════
{
  const r = buildClientOrganizer(baseArgs({
    priorYear: { ...empty(),
      scheduleK1s: [{ entityName: "Fund LP", entityType: "partnership" }, { entityName: "S Co", entityType: "s_corp" }],
      rentalProperties: [{ address: "12 Main St" }, { address: "99 Oak Ave" }],
      assetBalances: [{ accountName: "Vanguard IRA", assetType: "traditional_ira" }],
      form1099s: [{ formType: "nec", payerName: "ClientCo" }],
    },
    currentYear: { ...empty(),
      scheduleK1s: [{ entityName: "fund lp" }],
      rentalProperties: [{ address: "12 MAIN ST" }],
    },
  }));
  checkStr("O4 Fund LP K-1 received", r.items.find((i) => i.id === "k1:fund lp")?.status, "received");
  checkStr("O4 S Co K-1 missing", r.items.find((i) => i.id === "k1:s co")?.status, "missing");
  checkTrue("O4 S-corp K-1 says Form 1120-S", r.items.find((i) => i.id === "k1:s co")!.title.includes("1120-S"));
  checkTrue("O4 partnership K-1 says Form 1065", r.items.find((i) => i.id === "k1:fund lp")!.title.includes("1065"));
  checkStr("O4 12 Main St received", r.items.find((i) => i.id === "rental:12 main st")?.status, "received");
  checkStr("O4 99 Oak Ave missing", r.items.find((i) => i.id === "rental:99 oak ave")?.status, "missing");
  checkStr("O4 Vanguard IRA statement missing", r.items.find((i) => i.id === "account:vanguard ira")?.status, "missing");
  checkTrue("O4 SE books item present (prior NEC)", r.items.some((i) => i.id === "sched-c:books"));
  checkTrue("O4 1040-ES item present (prior NEC)", r.items.some((i) => i.id === "sched-c:estimates"));
}

// ════════════════════════════════════════════════════════════════════════════
// O5 — deduction reminders keyed off the prior persisted return + profile.
// ════════════════════════════════════════════════════════════════════════════
{
  const r = buildClientOrganizer(baseArgs({
    client: {
      filingStatus: "married_filing_jointly",
      dependentsForCareCredit: 2,
      acaAnnualPremium: 8400,
      socialSecurityBenefits: 24000,
      hsaIsFamilyCoverage: true,
    },
    priorReturn: {
      mortgageDeductible: 18000,
      charitableDeductible: 5000,
      medicalDeductible: 0,
      saltDeductible: 10000,
      aocCredit: 2500,
      llcCredit: 0,
      studentLoanInterestDeduction: 2500,
      hsaDeduction: 4150,
      iraDeduction: 7000,
      selfEmploymentTax: 0,
      sehiDeduction: 0,
    },
  }));
  const ids = new Set(r.items.map((i) => i.id));
  for (const id of ["ded:1098", "ded:charitable", "ded:salt", "ded:1098t", "ded:1098e", "ded:hsa", "ded:ira", "ded:childcare", "ded:1095a", "ssa:benefits"]) {
    checkTrue(`O5 ${id} present`, ids.has(id));
  }
  checkTrue("O5 medical reminder ABSENT (no prior medical)", !ids.has("ded:medical"));
  checkTrue("O5 SEHI reminder ABSENT", !ids.has("ded:sehi"));
  checkTrue("O5 SE books ABSENT (no prior SE)", !ids.has("sched-c:books"));
}

// ════════════════════════════════════════════════════════════════════════════
// O6 — life-events questionnaire always present; counts add up.
// ════════════════════════════════════════════════════════════════════════════
{
  const r = buildClientOrganizer(baseArgs({}));
  const questions = r.items.filter((i) => i.category === "life_events");
  check("O6 7 life-event questions", questions.length, 7);
  checkTrue("O6 all are status=question", questions.every((q) => q.status === "question"));
  checkTrue("O6 digital-asset question present (1040 requirement)", r.items.some((i) => i.id === "q:digital-assets"));
  check("O6 counts.questions", r.counts.questions, 7);
  check("O6 counts.missing for empty profile", r.counts.missing, 0);
  check("O6 counts.received", r.counts.received, 0);

  const r2 = buildClientOrganizer(baseArgs({
    priorYear: { ...empty(), w2s: [{ employerName: "A" }, { employerName: "B" }] },
    currentYear: { ...empty(), w2s: [{ employerName: "A" }] },
  }));
  check("O6 counts: 1 missing", r2.counts.missing, 1);
  check("O6 counts: 1 received", r2.counts.received, 1);
  check("O6 items total = missing + received + questions",
    r2.items.length, r2.counts.missing + r2.counts.received + r2.counts.questions);
}

// ════════════════════════════════════════════════════════════════════════════
// O7 — PROFORMA rows never count as received (REGRESSION, /code-review
//   2026-06-10): roll-forward copies name-identical rows into the target year;
//   without this rule a January roll-forward marked every document "already on
//   file" and defeated the request list. A real (non-proforma) row still counts.
// ════════════════════════════════════════════════════════════════════════════
{
  const r = buildClientOrganizer(baseArgs({
    priorYear: { ...empty(),
      w2s: [{ employerName: "Acme Corp" }],
      form1099s: [{ formType: "nec", payerName: "BigCo" }],
      scheduleK1s: [{ entityName: "Fund LP" }],
      rentalProperties: [{ address: "12 Main St" }],
      assetBalances: [{ accountName: "Vanguard IRA", assetType: "traditional_ira" }],
    },
    currentYear: { ...empty(),
      w2s: [{ employerName: "Acme Corp", proforma: true }],
      form1099s: [{ formType: "nec", payerName: "BigCo", proforma: true }],
      scheduleK1s: [{ entityName: "Fund LP", proforma: true }],
      rentalProperties: [{ address: "12 Main St", proforma: true }],
      assetBalances: [{ accountName: "Vanguard IRA", assetType: "traditional_ira", proforma: true }],
    },
  }));
  checkStr("O7 proforma W-2 stays missing", r.items.find((i) => i.id === "w2:acme corp")?.status, "missing");
  checkStr("O7 proforma 1099 stays missing", r.items.find((i) => i.id === "1099:nec:bigco")?.status, "missing");
  checkStr("O7 proforma K-1 stays missing", r.items.find((i) => i.id === "k1:fund lp")?.status, "missing");
  checkStr("O7 proforma rental stays missing", r.items.find((i) => i.id === "rental:12 main st")?.status, "missing");
  checkStr("O7 proforma account stays missing", r.items.find((i) => i.id === "account:vanguard ira")?.status, "missing");

  // The CPA confirms the W-2 (PATCH clears the flag) → it flips to received.
  const r2 = buildClientOrganizer(baseArgs({
    priorYear: { ...empty(), w2s: [{ employerName: "Acme Corp" }] },
    currentYear: { ...empty(), w2s: [{ employerName: "Acme Corp", proforma: false }] },
  }));
  checkStr("O7 confirmed (non-proforma) W-2 → received", r2.items.find((i) => i.id === "w2:acme corp")?.status, "received");
}

// ════════════════════════════════════════════════════════════════════════════
// O8 — HSA reminder requires an EXPLICIT signal (REGRESSION): the clients
//   column is NOT NULL DEFAULT false, so `!= null` fired for EVERY client.
// ════════════════════════════════════════════════════════════════════════════
{
  const noHsa = buildClientOrganizer(baseArgs({
    client: { filingStatus: "single", hsaIsFamilyCoverage: false },
  }));
  checkTrue("O8 hsaIsFamilyCoverage=false (DB default) → NO HSA reminder",
    !noHsa.items.some((i) => i.id === "ded:hsa"));
  const hsaTrue = buildClientOrganizer(baseArgs({
    client: { filingStatus: "single", hsaIsFamilyCoverage: true },
  }));
  checkTrue("O8 hsaIsFamilyCoverage=true → HSA reminder", hsaTrue.items.some((i) => i.id === "ded:hsa"));
  const hsaDed = buildClientOrganizer(baseArgs({
    client: { filingStatus: "single", hsaIsFamilyCoverage: false },
    priorReturn: { hsaDeduction: 4150 },
  }));
  checkTrue("O8 prior-year HSA deduction → HSA reminder", hsaDed.items.some((i) => i.id === "ded:hsa"));
}

console.log(`\nRESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length > 0) {
  for (const f of FAIL) console.error(f);
  process.exit(1);
}
