/**
 * T2.2 — CPA-tools endpoints integration (GAME PLAN D).
 *
 * Verifies the live planning surfaces: tax-projection (+1040-ES), mfj-vs-mfs,
 * and year-over-year. Requires the api-server on http://localhost:8080 (+
 * Postgres). Excluded from the no-API battery (NEEDS_API in run-no-api.ts).
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-cpa-tools-integration-tests.ts
 */
const BASE = "http://localhost:8080/api";
const PASS: string[] = [];
const FAIL: string[] = [];
function ok(label: string, cond: boolean, detail = ""): void {
  if (cond) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}${detail ? ` — ${detail}` : ""}`);
}

async function api<T = unknown>(path: string, opts: RequestInit = {}): Promise<{ status: number; body: T }> {
  const res = await fetch(BASE + path, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) } });
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok && res.status >= 500) throw new Error(`${opts.method ?? "GET"} ${path} → ${res.status}: ${text}`);
  return { status: res.status, body: body as T };
}
async function settle(): Promise<void> { await new Promise((r) => setTimeout(r, 100)); }

async function mkClient(filingStatus: string): Promise<number> {
  const { body } = await api<{ id: number }>("/clients", {
    method: "POST",
    body: JSON.stringify({ firstName: "CPA", lastName: "Tools", email: `cpa-${Date.now()}-${Math.random().toString(36).slice(2)}@e.co`, filingStatus, state: "FL", taxYear: 2024 }),
  });
  return body.id;
}
async function addAdj(id: number, adjustmentType: string, amount: number, spouse?: string): Promise<void> {
  await api(`/clients/${id}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType, amount, description: adjustmentType, isApplied: true, ...(spouse ? { spouse } : {}) }) });
}

async function run(): Promise<void> {
  // ── MFJ two-earner client with tips (OBBBA) ──
  const mfj = await mkClient("married_filing_jointly");
  try {
    await addAdj(mfj, "self_employment_income", 120000, "taxpayer");
    await addAdj(mfj, "self_employment_income", 60000, "spouse");
    await settle();

    const proj = await api<Record<string, any>>(`/clients/${mfj}/tax-projection`);
    ok("tax-projection 200", proj.status === 200, String(proj.status));
    ok("tax-projection has baseline + projected years", proj.body?.baseline?.taxYear === 2024 && proj.body?.projected?.taxYear === 2025);
    ok("tax-projection has 4 quarterly vouchers", Array.isArray(proj.body?.estimatedTax?.vouchers) && proj.body.estimatedTax.vouchers.length === 4);
    ok("tax-projection Q1 due 2025-04-15", proj.body?.estimatedTax?.vouchers?.[0]?.dueDate === "2025-04-15");
    ok("tax-projection requiredAnnualPayment > 0 (SE, no W/H)", Number(proj.body?.estimatedTax?.requiredAnnualPayment) > 0);

    const projGrowth = await api(`/clients/${mfj}/tax-projection?incomeGrowth=1.10`);
    ok("tax-projection accepts incomeGrowth", projGrowth.status === 200);
    const projBad = await api(`/clients/${mfj}/tax-projection?incomeGrowth=9`);
    ok("tax-projection rejects out-of-range growth (400)", projBad.status === 400, String(projBad.status));

    const mfsCmp = await api<Record<string, any>>(`/clients/${mfj}/mfj-vs-mfs`);
    ok("mfj-vs-mfs 200", mfsCmp.status === 200);
    ok("mfj-vs-mfs applicable (MFJ baseline)", mfsCmp.body?.applicable === true);
    ok("mfj-vs-mfs has a recommendation", mfsCmp.body?.recommendation === "mfj" || mfsCmp.body?.recommendation === "mfs");
    ok("mfj-vs-mfs has MFJ + MFS summaries", typeof mfsCmp.body?.mfj?.netTaxAfterCredits === "number" && typeof mfsCmp.body?.mfs?.combinedNetTaxAfterCredits === "number");
    ok("mfj-vs-mfs detects spouse tags", mfsCmp.body?.assumptions?.spouseTagsPresent === true);

    const yoy = await api<Record<string, any>>(`/clients/${mfj}/year-over-year`);
    ok("year-over-year 200", yoy.status === 200);
    ok("year-over-year has 14 delta lines", Array.isArray(yoy.body?.deltas) && yoy.body.deltas.length === 14);
    ok("year-over-year has obbbaImpact + crossings arrays", typeof yoy.body?.obbbaImpact?.newBenefit === "number" && Array.isArray(yoy.body?.thresholdCrossings));
    ok("year-over-year reports priorYearHasData flag", typeof yoy.body?.priorYearHasData === "boolean");
  } finally {
    await api(`/clients/${mfj}`, { method: "DELETE" });
  }

  // ── Single client → mfj-vs-mfs not applicable ──
  const single = await mkClient("single");
  try {
    await addAdj(single, "self_employment_income", 90000);
    await settle();
    const r = await api<Record<string, any>>(`/clients/${single}/mfj-vs-mfs`);
    ok("mfj-vs-mfs single → applicable=false", r.status === 200 && r.body?.applicable === false);
  } finally {
    await api(`/clients/${single}`, { method: "DELETE" });
  }

  // ── 404 paths ──
  ok("tax-projection unknown client 404", (await api("/clients/999999999/tax-projection")).status === 404);
  ok("mfj-vs-mfs unknown client 404", (await api("/clients/999999999/mfj-vs-mfs")).status === 404);
  ok("year-over-year unknown client 404", (await api("/clients/999999999/year-over-year")).status === 404);

  console.log(`\nRESULTS: ${PASS.length} passed, ${FAIL.length} failed (CPA-tools endpoints)`);
  for (const p of PASS) console.log(p);
  if (FAIL.length) { for (const f of FAIL) console.error(f); process.exit(1); }
  console.log("ALL CPA-TOOLS INTEGRATION ASSERTIONS PASS");
}
run().catch((err) => { console.error(err); process.exit(1); });
