/**
 * G-3 — Advisory Proposal + ROI packager tests.
 *
 * Hand-calc every expected number against the documented formulas BEFORE
 * asserting (the house rule — the user has been burned by tests passing while
 * the calc was wrong). The packager itself does no tax math; it sums the
 * deterministic headline savings (`verifiedSavings ?? estSavings`), splits
 * recurring vs one-time, derives/accepts a fee, and computes ROI. So every
 * expected value below is plain arithmetic shown in the comment.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-advisory-proposal-tests.ts
 */
import type { OpportunityHit } from "@workspace/planning-strategies";
import {
  buildAdvisoryProposal,
  buildAdvisoryProposalPdf,
  type AdvisoryProposalInput,
} from "../../artifacts/api-server/src/lib/advisoryProposal";

const PASS: string[] = [];
const FAIL: string[] = [];
function check(label: string, actual: number, expected: number, tol = 1.0): void {
  if (Number.isFinite(actual) && Math.abs(actual - expected) <= tol) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected}, got ${actual}`);
}
function checkTrue(label: string, cond: boolean): void {
  cond ? PASS.push(`✓ ${label}`) : FAIL.push(`✗ ${label}`);
}

/**
 * Minimal OpportunityHit factory — only the fields the packager reads matter
 * (strategyId, name, estSavings, verifiedSavings?, savingsSource?,
 * cpaEffortHours, recurring). The rest are filled with inert defaults.
 */
function hit(p: {
  strategyId: string;
  name: string;
  estSavings: number;
  verifiedSavings?: number;
  savingsSource?: "engine-verified" | "estimate";
  cpaEffortHours: number;
  recurring: boolean;
}): OpportunityHit {
  return {
    strategyId: p.strategyId,
    name: p.name,
    category: "retirement",
    estSavings: p.estSavings,
    confidence: 0.9,
    cpaEffortHours: p.cpaEffortHours,
    recurring: p.recurring,
    rationale: "rationale",
    action: "action",
    prerequisiteData: [],
    citation: "IRC §1",
    inputs: {},
    ...(p.verifiedSavings != null ? { verifiedSavings: p.verifiedSavings } : {}),
    ...(p.savingsSource != null ? { savingsSource: p.savingsSource } : {}),
  };
}

const baseInput = (hits: OpportunityHit[], extra: Partial<AdvisoryProposalInput> = {}): AdvisoryProposalInput => ({
  clientFirstName: "Jordan",
  clientLastName: "Rivera",
  taxYear: 2025,
  hits,
  ...extra,
});

// ════════════════════════════════════════════════════════════════════════════
// CASE A — Normal multi-hit, derived fee (default rate 0.2, floor 500).
// Hits:
//   SEP   verified 14,873 recurring  (engine-verified)  effort 2
//   PTET  est       8,200  recurring  (estimate)         effort 3
//   TLH   verified  1,200  one-time   (engine-verified)  effort 1.5
// headlineSavings = verifiedSavings ?? estSavings → 14873, 8200, 1200
// totalSavings    = 14873 + 8200 + 1200 = 24,273
// recurring       = 14873 + 8200       = 23,073
// oneTime         = 24273 − 23073      =  1,200
// fee (derived)   = max(500, round(24273 × 0.2)) = max(500, round(4854.6)=4855) = 4,855
// roiRatio        = round1(24273 / 4855) = round1(4.99958...) = 5.0
// netBenefit      = 24273 − 4855 = 19,418
// totalCpaHours   = ceil(2 + 3 + 1.5) = ceil(6.5) = 7
// ════════════════════════════════════════════════════════════════════════════
{
  const hits = [
    hit({ strategyId: "G1.1", name: "SEP-IRA", estSavings: 12000, verifiedSavings: 14873, savingsSource: "engine-verified", cpaEffortHours: 2, recurring: true }),
    hit({ strategyId: "G1.2", name: "PTET election", estSavings: 8200, savingsSource: "estimate", cpaEffortHours: 3, recurring: true }),
    hit({ strategyId: "G1.9", name: "Tax-loss harvesting", estSavings: 900, verifiedSavings: 1200, savingsSource: "engine-verified", cpaEffortHours: 1.5, recurring: false }),
  ];
  const p = buildAdvisoryProposal(baseInput(hits));
  check("A.totalSavings", p.totalSavings, 24273);
  check("A.recurringSavings", p.recurringSavings, 23073);
  check("A.oneTimeSavings", p.oneTimeSavings, 1200);
  check("A.proposedFee", p.proposedFee, 4855);
  checkTrue("A.feeSource=derived", p.feeSource === "derived");
  check("A.roiRatio", p.roiRatio, 5.0, 0.05);
  check("A.netClientBenefit", p.netClientBenefit, 19418);
  check("A.totalCpaHours", p.totalCpaHours, 7);
  check("A.lineItems.length", p.lineItems.length, 3);
  // sorted desc by savings: SEP(14873) > PTET(8200) > TLH(1200)
  checkTrue("A.sortDesc[0]=SEP", p.lineItems[0].strategyId === "G1.1");
  checkTrue("A.sortDesc[1]=PTET", p.lineItems[1].strategyId === "G1.2");
  checkTrue("A.sortDesc[2]=TLH", p.lineItems[2].strategyId === "G1.9");
  // savingsSource passthrough + default
  checkTrue("A.SEP source=engine-verified", p.lineItems[0].savingsSource === "engine-verified");
  checkTrue("A.PTET source=estimate", p.lineItems[1].savingsSource === "estimate");
  // headline picks verifiedSavings over estSavings for SEP (14873 not 12000)
  check("A.SEP line savings=verified", p.lineItems[0].savings, 14873);
  check("A.TLH line savings=verified", p.lineItems[2].savings, 1200);
  // internal consistency: roiRatio × fee ≈ totalSavings ; net = total − fee
  checkTrue("A.roi×fee≈total", Math.abs(p.roiRatio * p.proposedFee - p.totalSavings) <= 0.05 * p.totalSavings);
  check("A.net=total−fee", p.netClientBenefit, p.totalSavings - p.proposedFee);
  check("A.recurring+oneTime=total", p.recurringSavings + p.oneTimeSavings, p.totalSavings);
  checkTrue("A.assumptions>=3", p.assumptions.length >= 3);
}

// ════════════════════════════════════════════════════════════════════════════
// CASE B — Explicit fee overrides derivation.
// Single hit est 10,000 (no verified) recurring, effort 4.
// proposedFee = 7,500 (explicit).
// totalSavings = 10,000 ; fee = 7,500 ; feeSource = explicit
// roiRatio = round1(10000/7500) = round1(1.3333) = 1.3
// net = 10000 − 7500 = 2,500 ; hours = ceil(4) = 4
// ════════════════════════════════════════════════════════════════════════════
{
  const hits = [hit({ strategyId: "G1.4", name: "Roth conversion", estSavings: 10000, cpaEffortHours: 4, recurring: true })];
  const p = buildAdvisoryProposal(baseInput(hits, { proposedFee: 7500 }));
  check("B.totalSavings", p.totalSavings, 10000);
  check("B.proposedFee", p.proposedFee, 7500);
  checkTrue("B.feeSource=explicit", p.feeSource === "explicit");
  check("B.roiRatio", p.roiRatio, 1.3, 0.05);
  check("B.netClientBenefit", p.netClientBenefit, 2500);
  check("B.totalCpaHours", p.totalCpaHours, 4);
  // default savingsSource when absent on the hit
  checkTrue("B.source defaults to estimate", p.lineItems[0].savingsSource === "estimate");
  checkTrue("B.roi×fee≈total", Math.abs(p.roiRatio * p.proposedFee - p.totalSavings) <= 0.05 * p.totalSavings);
}

// ════════════════════════════════════════════════════════════════════════════
// CASE C — Fee FLOORING: tiny savings → derived fee hits the minFee floor.
// Single hit est 1,500 one-time, effort 1.
// derived raw = round(1500 × 0.2) = round(300) = 300 ; floored to 500.
// totalSavings = 1500 ; fee = 500 ; roiRatio = round1(1500/500) = 3.0
// net = 1500 − 500 = 1,000 ; recurring = 0 ; oneTime = 1,500
// ════════════════════════════════════════════════════════════════════════════
{
  const hits = [hit({ strategyId: "G1.51", name: "AOC vs LLC", estSavings: 1500, cpaEffortHours: 1, recurring: false })];
  const p = buildAdvisoryProposal(baseInput(hits));
  check("C.totalSavings", p.totalSavings, 1500);
  check("C.proposedFee=floor", p.proposedFee, 500);
  checkTrue("C.feeSource=derived", p.feeSource === "derived");
  check("C.roiRatio", p.roiRatio, 3.0, 0.05);
  check("C.netClientBenefit", p.netClientBenefit, 1000);
  check("C.recurringSavings", p.recurringSavings, 0);
  check("C.oneTimeSavings", p.oneTimeSavings, 1500);
}

// ════════════════════════════════════════════════════════════════════════════
// CASE C2 — Fee flooring with custom minFee + feeRate.
// Two hits: 2,000 + 1,000 = 3,000 total, both one-time.
// feeRate 0.3 → raw = round(3000 × 0.3) = 900 ; minFee 1,200 → floored to 1,200.
// roiRatio = round1(3000/1200) = round1(2.5) = 2.5 ; net = 3000 − 1200 = 1,800
// ════════════════════════════════════════════════════════════════════════════
{
  const hits = [
    hit({ strategyId: "G1.a", name: "A", estSavings: 2000, cpaEffortHours: 1, recurring: false }),
    hit({ strategyId: "G1.b", name: "B", estSavings: 1000, cpaEffortHours: 1, recurring: false }),
  ];
  const p = buildAdvisoryProposal(baseInput(hits, { feeRate: 0.3, minFee: 1200 }));
  check("C2.totalSavings", p.totalSavings, 3000);
  check("C2.proposedFee=customFloor", p.proposedFee, 1200);
  check("C2.roiRatio", p.roiRatio, 2.5, 0.05);
  check("C2.netClientBenefit", p.netClientBenefit, 1800);
}

// ════════════════════════════════════════════════════════════════════════════
// CASE C3 — Custom feeRate ABOVE the floor (not floored).
// One hit 50,000 recurring, effort 6. feeRate 0.25 → raw = round(12500) = 12500.
// 12500 > minFee(500) so used as-is. roiRatio = round1(50000/12500) = 4.0
// net = 50000 − 12500 = 37,500 ; hours = ceil(6) = 6
// ════════════════════════════════════════════════════════════════════════════
{
  const hits = [hit({ strategyId: "G1.28", name: "DB plan", estSavings: 50000, cpaEffortHours: 6, recurring: true })];
  const p = buildAdvisoryProposal(baseInput(hits, { feeRate: 0.25 }));
  check("C3.proposedFee", p.proposedFee, 12500);
  checkTrue("C3.feeSource=derived", p.feeSource === "derived");
  check("C3.roiRatio", p.roiRatio, 4.0, 0.05);
  check("C3.netClientBenefit", p.netClientBenefit, 37500);
  check("C3.totalCpaHours", p.totalCpaHours, 6);
}

// ════════════════════════════════════════════════════════════════════════════
// CASE D — ZERO savings (empty hits).
// totalSavings = 0 ; derived fee = max(500, round(0×0.2)=0) = 500
// roiRatio: fee>0 but total=0 → round1(0/500) = 0.0
// net = 0 − 500 = −500 ; hours = ceil(0) = 0 ; lineItems = []
// ════════════════════════════════════════════════════════════════════════════
{
  const p = buildAdvisoryProposal(baseInput([]));
  check("D.totalSavings", p.totalSavings, 0);
  check("D.proposedFee=floor", p.proposedFee, 500);
  check("D.roiRatio", p.roiRatio, 0.0);
  check("D.netClientBenefit", p.netClientBenefit, -500);
  check("D.totalCpaHours", p.totalCpaHours, 0);
  check("D.lineItems.length", p.lineItems.length, 0);
  checkTrue("D.assumptions present", p.assumptions.length >= 3);
}

// ════════════════════════════════════════════════════════════════════════════
// CASE D2 — Explicit fee of 0 (comped proposal) → ROI guard returns 0, not Inf.
// One hit est 5,000. proposedFee = 0 (explicit). roiRatio guard: fee>0 false → 0.
// net = 5000 − 0 = 5,000
// ════════════════════════════════════════════════════════════════════════════
{
  const hits = [hit({ strategyId: "G1.x", name: "Comp", estSavings: 5000, cpaEffortHours: 2, recurring: false })];
  const p = buildAdvisoryProposal(baseInput(hits, { proposedFee: 0 }));
  check("D2.proposedFee", p.proposedFee, 0);
  checkTrue("D2.feeSource=explicit", p.feeSource === "explicit");
  check("D2.roiRatio=0 (no div-by-0)", p.roiRatio, 0.0);
  checkTrue("D2.roiRatio finite", Number.isFinite(p.roiRatio));
  check("D2.netClientBenefit", p.netClientBenefit, 5000);
}

// ════════════════════════════════════════════════════════════════════════════
// CASE E — ROUNDING: fractional cents in savings + fee derivation.
//   hit1 verified 1234.49 → rounds to 1234
//   hit2 est       2345.51 → rounds to 2346
// totalSavings: the engine sums the ROUNDED line items per the doc =
//   round(1234) + round(2346)?  NO — implementation sums rounded line items:
//   lineItems = [1234, 2346] ; total = 1234 + 2346 = 3,580.
// derived fee = max(500, round(3580 × 0.2)) = max(500, round(716)=716) = 716
// roiRatio = round1(3580/716) = round1(5.0) = 5.0 ; net = 3580 − 716 = 2,864
// ════════════════════════════════════════════════════════════════════════════
{
  const hits = [
    hit({ strategyId: "G1.r1", name: "R1", estSavings: 1000, verifiedSavings: 1234.49, savingsSource: "engine-verified", cpaEffortHours: 1, recurring: false }),
    hit({ strategyId: "G1.r2", name: "R2", estSavings: 2345.51, savingsSource: "estimate", cpaEffortHours: 1, recurring: false }),
  ];
  const p = buildAdvisoryProposal(baseInput(hits));
  check("E.line1 rounded", p.lineItems.find((l) => l.strategyId === "G1.r1")!.savings, 1234);
  check("E.line2 rounded", p.lineItems.find((l) => l.strategyId === "G1.r2")!.savings, 2346);
  check("E.totalSavings", p.totalSavings, 3580);
  check("E.proposedFee", p.proposedFee, 716);
  check("E.roiRatio", p.roiRatio, 5.0, 0.05);
  check("E.netClientBenefit", p.netClientBenefit, 2864);
}

// ════════════════════════════════════════════════════════════════════════════
// CASE F — Tie in savings preserves stable input order in the sort.
// Two hits both 5,000; F-first declared before F-second.
// ════════════════════════════════════════════════════════════════════════════
{
  const hits = [
    hit({ strategyId: "G1.first", name: "First", estSavings: 5000, cpaEffortHours: 1, recurring: false }),
    hit({ strategyId: "G1.second", name: "Second", estSavings: 5000, cpaEffortHours: 1, recurring: true }),
  ];
  const p = buildAdvisoryProposal(baseInput(hits));
  checkTrue("F.tie keeps input order [0]", p.lineItems[0].strategyId === "G1.first");
  checkTrue("F.tie keeps input order [1]", p.lineItems[1].strategyId === "G1.second");
  check("F.totalSavings", p.totalSavings, 10000);
  // one recurring (5000) + one one-time (5000)
  check("F.recurringSavings", p.recurringSavings, 5000);
  check("F.oneTimeSavings", p.oneTimeSavings, 5000);
}

// ════════════════════════════════════════════════════════════════════════════
// CASE G — All-recurring: oneTime = 0, recurring = total.
// 3,000 + 7,000 = 10,000, both recurring. derived fee = max(500, 2000) = 2,000.
// ════════════════════════════════════════════════════════════════════════════
{
  const hits = [
    hit({ strategyId: "G1.g1", name: "G1", estSavings: 3000, cpaEffortHours: 2, recurring: true }),
    hit({ strategyId: "G1.g2", name: "G2", estSavings: 7000, cpaEffortHours: 2, recurring: true }),
  ];
  const p = buildAdvisoryProposal(baseInput(hits));
  check("G.totalSavings", p.totalSavings, 10000);
  check("G.recurringSavings=total", p.recurringSavings, 10000);
  check("G.oneTimeSavings=0", p.oneTimeSavings, 0);
  check("G.proposedFee", p.proposedFee, 2000);
  check("G.roiRatio", p.roiRatio, 5.0, 0.05);
}

// ════════════════════════════════════════════════════════════════════════════
// CASE H — PDF render smoke (populated + zero-hit). Asserts a Buffer starting
// with %PDF and a sane byte length; exact text content is not parsed.
// ════════════════════════════════════════════════════════════════════════════
async function pdfSmoke(): Promise<void> {
  const hits = [
    hit({ strategyId: "G1.1", name: "SEP-IRA", estSavings: 12000, verifiedSavings: 14873, savingsSource: "engine-verified", cpaEffortHours: 2, recurring: true }),
    hit({ strategyId: "G1.2", name: "PTET election", estSavings: 8200, savingsSource: "estimate", cpaEffortHours: 3, recurring: true }),
  ];
  const proposal = buildAdvisoryProposal(baseInput(hits));
  const buf = await buildAdvisoryProposalPdf({
    proposal,
    clientFirstName: "Jordan",
    clientLastName: "Rivera",
    taxYear: 2025,
    preparedDate: "June 13, 2026",
    firmName: "Brookhaven CPA",
  });
  checkTrue("H.pdf is Buffer", Buffer.isBuffer(buf));
  checkTrue("H.pdf starts with %PDF", buf.subarray(0, 4).toString("latin1") === "%PDF");
  checkTrue("H.pdf sane length (>1500 bytes)", buf.length > 1500);

  // Zero-hit proposal still renders a valid PDF.
  const emptyProposal = buildAdvisoryProposal(baseInput([]));
  const buf2 = await buildAdvisoryProposalPdf({
    proposal: emptyProposal,
    clientFirstName: "Alex",
    clientLastName: "Doe",
    taxYear: 2025,
    preparedDate: "June 13, 2026",
  });
  checkTrue("H.empty pdf is Buffer", Buffer.isBuffer(buf2));
  checkTrue("H.empty pdf starts with %PDF", buf2.subarray(0, 4).toString("latin1") === "%PDF");
  checkTrue("H.empty pdf sane length", buf2.length > 1500);

  // Large multi-hit proposal (exercises page break + table overflow).
  const manyHits = Array.from({ length: 18 }, (_, i) =>
    hit({ strategyId: `G1.${i}`, name: `Strategy number ${i}`, estSavings: 1000 + i * 250, cpaEffortHours: 1.25, recurring: i % 2 === 0 }),
  );
  const bigProposal = buildAdvisoryProposal(baseInput(manyHits));
  const buf3 = await buildAdvisoryProposalPdf({
    proposal: bigProposal,
    clientFirstName: "Big",
    clientLastName: "Client",
    taxYear: 2025,
    preparedDate: "June 13, 2026",
  });
  checkTrue("H.big pdf starts with %PDF", buf3.subarray(0, 4).toString("latin1") === "%PDF");
  checkTrue("H.big pdf larger than small", buf3.length > buf.length);
}

async function main(): Promise<void> {
  await pdfSmoke();
  console.log(`\nRESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
  if (FAIL.length > 0) {
    for (const f of FAIL) console.error(f);
    process.exit(1);
  }
}

void main();
