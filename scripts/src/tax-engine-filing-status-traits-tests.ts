/**
 * T1.5 #9 — Filing-status trait table property tests.
 *
 * Pins every cell of filingStatusTraits.ts against the statute, so a future edit
 * can't silently re-introduce the 2026-06-11 QSS cluster. The headline invariant:
 * a qualifying surviving spouse (QSS) is JOINT where the statute keys off spouse
 * status (§1/§63/§1411/§121/§461(l)/§199A/§219) and NOT joint where it keys off
 * filing a "joint return" (§3101(b)(2)/§86/§25A/§32/§221/§904(j)/§21/OBBBA senior).
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-filing-status-traits-tests.ts
 */
import {
  filingStatusTraits,
  usesJointBrackets,
  type FilingStatusName,
} from "../../artifacts/api-server/src/lib/filingStatusTraits";

const PASS: string[] = [];
const FAIL: string[] = [];
function ok(label: string, cond: boolean): void {
  if (cond) PASS.push(`✓ ${label}`); else FAIL.push(`✗ ${label}`);
}

const ALL: FilingStatusName[] = [
  "single", "head_of_household", "married_filing_jointly", "qualifying_widow", "married_filing_separately",
];

// ── Structural invariants ─────────────────────────────────────────────────
ok("exactly one status is MFJ", ALL.filter((s) => filingStatusTraits(s).isMarriedJoint).length === 1);
ok("exactly one status is QSS", ALL.filter((s) => filingStatusTraits(s).isSurvivingSpouse).length === 1);
ok("exactly one status is MFS", ALL.filter((s) => filingStatusTraits(s).isMfs).length === 1);
ok("single + HoH are the isSingleOrHoh group", filingStatusTraits("single").isSingleOrHoh && filingStatusTraits("head_of_household").isSingleOrHoh);
ok("MFJ/QSS/MFS are NOT isSingleOrHoh", !filingStatusTraits("married_filing_jointly").isSingleOrHoh && !filingStatusTraits("qualifying_widow").isSingleOrHoh && !filingStatusTraits("married_filing_separately").isSingleOrHoh);
ok("unknown status → single fallback", filingStatusTraits("bogus").bracketBasis === "single");

// ── bracketBasis per status ───────────────────────────────────────────────
ok("single brackets = single", filingStatusTraits("single").bracketBasis === "single");
ok("HoH brackets = hoh", filingStatusTraits("head_of_household").bracketBasis === "hoh");
ok("MFJ brackets = joint", filingStatusTraits("married_filing_jointly").bracketBasis === "joint");
ok("QSS brackets = joint", filingStatusTraits("qualifying_widow").bracketBasis === "joint");
ok("MFS brackets = mfs", filingStatusTraits("married_filing_separately").bracketBasis === "mfs");
ok("usesJointBrackets: MFJ + QSS only", usesJointBrackets("married_filing_jointly") && usesJointBrackets("qualifying_widow") && !usesJointBrackets("single") && !usesJointBrackets("married_filing_separately"));

// ── THE QSS CLUSTER: joint for spouse-keyed provisions ────────────────────
{
  const q = filingStatusTraits("qualifying_widow");
  ok("QSS JOINT: §1411 NIIT threshold", q.jointForNiit);
  ok("QSS JOINT: §121 home-sale", q.jointForSection121);
  ok("QSS JOINT: §461(l)", q.jointForSection461l);
  ok("QSS JOINT: §199A band", q.jointForSection199a);
  ok("QSS JOINT: §219 IRA phase-out", q.jointForIraPhaseOut);
  // ...NOT joint for "joint return"-keyed provisions (the 8 audit fixes):
  ok("QSS NOT joint: §3101(b)(2) Additional Medicare (was the oracle-found bug)", !q.jointForAddlMedicare);
  ok("QSS NOT joint: §86(c) Social Security base", !q.jointForSsBase);
  ok("QSS NOT joint: §25A education band", !q.jointForEducationBand);
  ok("QSS NOT joint: §32 EITC column", !q.jointForEitcColumn);
  ok("QSS NOT joint: §221 SLI band", !q.jointForSliBand);
  ok("QSS NOT joint: §904(j) FTC simplified limit", !q.jointForFtcSimplified);
  ok("QSS NOT joint: §21 dependent-care spouse-EI floor", !q.dependentCareUsesSpouseEarnedIncome);
  ok("QSS NOT joint: OBBBA senior deduction (taxpayer-only)", !q.obbbaSeniorCountsSpouse);
  ok("QSS not MFS-halved SALT", !q.saltCapHalved);
  ok("QSS eligible: EITC / education / SLI", q.eitcEligibleBase && q.educationCreditEligible && q.sliEligible);
}

// ── MFJ: joint everywhere ─────────────────────────────────────────────────
{
  const m = filingStatusTraits("married_filing_jointly");
  ok("MFJ joint for ALL provisions", m.jointForNiit && m.jointForSection121 && m.jointForSection461l && m.jointForSection199a && m.jointForIraPhaseOut && m.jointForAddlMedicare && m.jointForSsBase && m.jointForEducationBand && m.jointForEitcColumn && m.jointForSliBand && m.jointForFtcSimplified);
  ok("MFJ dependent-care uses spouse EI", m.dependentCareUsesSpouseEarnedIncome);
  ok("MFJ OBBBA senior counts spouse", m.obbbaSeniorCountsSpouse);
}

// ── MFS: halved / barred ──────────────────────────────────────────────────
{
  const s = filingStatusTraits("married_filing_separately");
  ok("MFS SALT cap halved", s.saltCapHalved);
  ok("MFS EITC barred (base)", !s.eitcEligibleBase);
  ok("MFS education credit barred", !s.educationCreditEligible);
  ok("MFS SLI barred", !s.sliEligible);
  ok("MFS joint for NOTHING", !s.jointForNiit && !s.jointForAddlMedicare && !s.jointForSection121 && !s.jointForSection199a);
}

// ── single / HoH: never joint, never MFS-halved, fully eligible ────────────
for (const st of ["single", "head_of_household"] as const) {
  const t = filingStatusTraits(st);
  ok(`${st}: joint for nothing`, !t.jointForNiit && !t.jointForSection121 && !t.jointForSection199a && !t.jointForAddlMedicare && !t.jointForEitcColumn);
  ok(`${st}: not SALT-halved, fully credit-eligible`, !t.saltCapHalved && t.eitcEligibleBase && t.educationCreditEligible && t.sliEligible);
}

console.log(`\nT1.5 #9 — Filing-status trait table (single source of truth; anti-QSS-cluster):`);
console.log(`RESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length) { for (const f of FAIL) console.error(`  ${f}`); process.exit(1); }
for (const p of PASS) console.log(`  ${p}`);
process.exit(0);
