/**
 * T2.1 — Workpaper packet endpoint integration (GAME PLAN B).
 *
 * Verifies the live one-click packet path: client + facts → GET
 * /clients/:id/tax-return/workpapers/pdf → a real multi-form PDF (cover +
 * reconciliation worksheet + applicable forms), with the taxYear override and
 * the 404 path.
 *
 * Requires the api-server on http://localhost:8080 (+ Postgres). Excluded from
 * the no-API battery (NEEDS_API in run-no-api.ts).
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-workpapers-integration-tests.ts
 */
const BASE = "http://localhost:8080/api";
const PASS: string[] = [];
const FAIL: string[] = [];
function checkTrue(label: string, cond: boolean, detail = ""): void {
  if (cond) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}${detail ? ` — ${detail}` : ""}`);
}

async function api<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
  });
  if (!res.ok && res.status !== 204) throw new Error(`${opts.method ?? "GET"} ${path} → ${res.status}: ${await res.text()}`);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
async function settle(): Promise<void> { await new Promise((r) => setTimeout(r, 80)); }

async function fetchPdf(path: string): Promise<{ status: number; contentType: string; disposition: string; bytes: Buffer }> {
  const res = await fetch(BASE + path);
  const buf = Buffer.from(await res.arrayBuffer());
  return {
    status: res.status,
    contentType: res.headers.get("content-type") ?? "",
    disposition: res.headers.get("content-disposition") ?? "",
    bytes: buf,
  };
}

async function run(): Promise<void> {
  // CA SE filer with capital gains + dependent care → many forms applicable:
  // recon + 1040 + Sch 1/2/3 + Sch C + Sch SE + Sch D + 2441 + 8995 + CA 540.
  const c = await api<{ id: number }>("/clients", {
    method: "POST",
    body: JSON.stringify({
      firstName: "Workpaper", lastName: "Packet",
      email: `wp-${Date.now()}-${Math.random().toString(36).slice(2)}@e.co`,
      filingStatus: "single", state: "CA", taxYear: 2024,
      dependentsUnder17: 1,
    }),
  });
  try {
    await api(`/clients/${c.id}/adjustments`, {
      method: "POST",
      body: JSON.stringify({ adjustmentType: "self_employment_income", amount: 120000, description: "SE income", isApplied: true }),
    });
    await api(`/clients/${c.id}/adjustments`, {
      method: "POST",
      body: JSON.stringify({ adjustmentType: "long_term_capital_gain", amount: 25000, description: "LTCG", isApplied: true }),
    });
    await api(`/clients/${c.id}/adjustments`, {
      method: "POST",
      body: JSON.stringify({ adjustmentType: "dependent_care_expenses", amount: 3000, description: "Daycare", isApplied: true }),
    });
    await settle();

    const pdf = await fetchPdf(`/clients/${c.id}/tax-return/workpapers/pdf`);
    checkTrue("workpapers endpoint returns 200", pdf.status === 200, `got ${pdf.status}`);
    checkTrue("content-type is application/pdf", pdf.contentType.includes("application/pdf"), pdf.contentType);
    checkTrue("content-disposition is an attachment with the packet filename",
      pdf.disposition.includes("attachment") && pdf.disposition.includes("workpapers-"), pdf.disposition);
    checkTrue("PDF magic bytes present", pdf.bytes.subarray(0, 5).toString() === "%PDF-");
    checkTrue("packet is a real multi-form document (> 20 KB)", pdf.bytes.length > 20_000, `${pdf.bytes.length} bytes`);

    const pdfYear = await fetchPdf(`/clients/${c.id}/tax-return/workpapers/pdf?taxYear=2024`);
    checkTrue("taxYear override returns 200 + PDF", pdfYear.status === 200 && pdfYear.bytes.subarray(0, 5).toString() === "%PDF-");

    const missing = await fetchPdf(`/clients/999999999/tax-return/workpapers/pdf`);
    checkTrue("unknown client returns 404", missing.status === 404, `got ${missing.status}`);
  } finally {
    await api(`/clients/${c.id}`, { method: "DELETE" }).catch(() => {});
  }

  console.log(`\nRESULTS: ${PASS.length} passed, ${FAIL.length} failed (workpaper packet endpoint)`);
  for (const p of PASS) console.log(p);
  if (FAIL.length) { for (const f of FAIL) console.error(f); process.exit(1); }
  console.log("ALL WORKPAPER-PACKET INTEGRATION ASSERTIONS PASS");
}
run().catch((err) => { console.error(err); process.exit(1); });
