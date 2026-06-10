/**
 * T2.2 — Branded deliverable PDF render smokes (planning report + organizer).
 *
 * Pure (no API). Same convention as the workpaper packet smoke: assert the
 * %PDF magic, a sane size, and that edge inputs (zero hits / empty organizer)
 * still render instead of throwing. Content values are covered by the
 * underlying lib tests (hits/calendar/organizer) — the PDFs only typeset them.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-cpa-deliverables-pdf-tests.ts
 */

import type { OpportunityHit } from "@workspace/planning-strategies";
import { buildPlanningReportPdf } from "../../artifacts/api-server/src/lib/planningReportPdf";
import { buildPlanningCalendar } from "../../artifacts/api-server/src/lib/planningCalendar";
import { buildOrganizerPdf } from "../../artifacts/api-server/src/lib/organizerPdf";
import { buildClientOrganizer } from "../../artifacts/api-server/src/lib/clientOrganizer";

const PASS: string[] = [];
const FAIL: string[] = [];
function checkTrue(label: string, cond: boolean): void {
  if (cond) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}`);
}

function hit(strategyId: string, name: string, estSavings: number, verifiedSavings?: number): OpportunityHit {
  return {
    strategyId, name, category: "retirement", estSavings,
    confidence: 0.85, cpaEffortHours: 2, recurring: true,
    rationale: "Net SE income of $120,000 supports a deductible SEP-IRA contribution.",
    action: "Open a SEP-IRA and contribute before the filing deadline.",
    prerequisiteData: ["Plan adoption date"], citation: "IRC §408(k)", inputs: {},
    assumptions: ["TY2024 §415(c) cap $69,000"],
    ...(verifiedSavings != null ? { verifiedSavings, savingsSource: "engine-verified" as const } : {}),
  };
}

async function main() {
  // ── Planning report: populated ──
  {
    const hits = [
      hit("G1.1", "SEP-IRA contribution", 8200, 8431),
      hit("G1.2", "State PTET election", 5400),
      hit("G1.9", "Tax-loss harvesting", 1200),
    ];
    const pdf = await buildPlanningReportPdf({
      client: { firstName: "Ann", lastName: "Archer", state: "CA", filingStatus: "married_filing_jointly" },
      taxYear: 2025,
      hits,
      calendar: buildPlanningCalendar(hits, 2025),
      multiYearHits: [{ name: "Persistent NIIT exposure", estSavings: 2100, rationale: "NIIT appeared in both of the last two filed years." }],
      preparedDate: "2026-06-10",
      firmName: "Brookhaven Tax",
    });
    checkTrue("report renders (%PDF magic)", pdf.subarray(0, 5).toString("ascii") === "%PDF-");
    checkTrue(`report is non-trivial (${pdf.length} bytes > 2,500)`, pdf.length > 2500);
  }

  // ── Planning report: ZERO hits still renders the well-optimized page ──
  {
    const pdf = await buildPlanningReportPdf({
      client: { firstName: "Bo", lastName: "Blank" },
      taxYear: 2025,
      hits: [],
      calendar: buildPlanningCalendar([], 2025),
      preparedDate: "2026-06-10",
    });
    checkTrue("zero-hit report renders", pdf.subarray(0, 5).toString("ascii") === "%PDF-");
    checkTrue("zero-hit report non-trivial", pdf.length > 1200);
  }

  // ── Planning report: many hits forces pagination ──
  {
    const many = Array.from({ length: 18 }, (_, i) => hit(`G1.${i + 20}`, `Strategy number ${i + 1}`, 1000 + i * 137));
    const pdf = await buildPlanningReportPdf({
      client: { firstName: "Cy", lastName: "Long" },
      taxYear: 2024,
      hits: many,
      calendar: buildPlanningCalendar(many, 2024),
      preparedDate: "2026-06-10",
    });
    checkTrue("18-hit report renders (multi-page)", pdf.subarray(0, 5).toString("ascii") === "%PDF-");
    checkTrue(`18-hit report is bigger (${pdf.length} bytes > 6,000)`, pdf.length > 6000);
  }

  // ── Organizer PDF: populated + empty ──
  {
    const organizer = buildClientOrganizer({
      taxYear: 2026,
      client: { filingStatus: "married_filing_jointly", dependentsForCareCredit: 1, socialSecurityBenefits: 12000 },
      priorYear: {
        w2s: [{ employerName: "Acme Corp" }],
        form1099s: [{ formType: "int", payerName: "Chase" }],
        scheduleK1s: [{ entityName: "Fund LP", entityType: "partnership" }],
        rentalProperties: [{ address: "12 Main St" }],
        assetBalances: [{ accountName: "Vanguard IRA", assetType: "traditional_ira" }],
      },
      currentYear: { w2s: [{ employerName: "ACME corp" }], form1099s: [], scheduleK1s: [], rentalProperties: [], assetBalances: [] },
      priorReturn: { mortgageDeductible: 18000, charitableDeductible: 4000, selfEmploymentTax: 5000 },
    });
    const pdf = await buildOrganizerPdf({
      clientName: "Ann Archer",
      organizer,
      preparedDate: "2026-01-05",
      firmName: "Brookhaven Tax",
    });
    checkTrue("organizer PDF renders", pdf.subarray(0, 5).toString("ascii") === "%PDF-");
    checkTrue(`organizer PDF non-trivial (${pdf.length} bytes > 2,000)`, pdf.length > 2000);

    const emptyOrganizer = buildClientOrganizer({
      taxYear: 2026,
      client: { filingStatus: "single" },
      priorYear: { w2s: [], form1099s: [], scheduleK1s: [], rentalProperties: [], assetBalances: [] },
      currentYear: { w2s: [], form1099s: [], scheduleK1s: [], rentalProperties: [], assetBalances: [] },
    });
    const pdf2 = await buildOrganizerPdf({ clientName: "Bo Blank", organizer: emptyOrganizer, preparedDate: "2026-01-05" });
    checkTrue("questions-only organizer PDF renders", pdf2.subarray(0, 5).toString("ascii") === "%PDF-");
  }

  console.log(`\nRESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
  if (FAIL.length > 0) {
    for (const f of FAIL) console.error(f);
    process.exit(1);
  }
}

void main();
