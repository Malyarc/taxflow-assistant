/**
 * Tax return export tests — verify PDF/CSV/JSON/UltraTax-GEN endpoints
 * produce correct output for a real client via the live API.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-exports-tests.ts
 */

const BASE = "http://localhost:8080/api";
const PASS: string[] = [];
const FAIL: string[] = [];

function check(label: string, cond: boolean, detail = "") {
  if (cond) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}${detail ? `: ${detail}` : ""}`);
}

async function api<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
  });
  if (!res.ok && res.status !== 204) {
    const txt = await res.text();
    throw new Error(`${opts.method ?? "GET"} ${path} → ${res.status}: ${txt}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

async function rawText(path: string): Promise<{ status: number; contentType: string; body: string; size: number }> {
  const res = await fetch(BASE + path);
  const body = await res.text();
  return {
    status: res.status,
    contentType: res.headers.get("content-type") ?? "",
    body,
    size: body.length,
  };
}
async function rawBytes(path: string): Promise<{ status: number; contentType: string; size: number; head: string }> {
  const res = await fetch(BASE + path);
  const buf = new Uint8Array(await res.arrayBuffer());
  return {
    status: res.status,
    contentType: res.headers.get("content-type") ?? "",
    size: buf.length,
    head: new TextDecoder().decode(buf.slice(0, 8)),
  };
}

async function makeClient(extras: Record<string, unknown> = {}): Promise<number> {
  const c = await api<{ id: number }>("/clients", {
    method: "POST",
    body: JSON.stringify({
      firstName: "Export",
      lastName: `T${Date.now()}${Math.floor(Math.random() * 1000)}`,
      email: `export-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      filingStatus: "single",
      state: "FL",
      taxYear: 2024,
      ...extras,
    }),
  });
  return c.id;
}

async function delClient(id: number): Promise<void> {
  await api(`/clients/${id}`, { method: "DELETE" });
}

async function settle(): Promise<void> {
  // Routes now await recalc synchronously; this is a small backstop.
  await new Promise((r) => setTimeout(r, 50));
}

async function main() {
  console.log("\n══════════ Export endpoints — CSV / JSON / UltraTax / PDF ══════════\n");

  // Create a client with W-2 + adjustments → produces a non-trivial return
  const cid = await makeClient({ firstName: "ExportTester", eligibleEducatorCount: 1 });
  try {
    await api(`/clients/${cid}/w2data`, {
      method: "POST",
      body: JSON.stringify({ taxYear: 2024, wagesBox1: 75000, federalTaxWithheldBox2: 9500, stateCode: "FL" }),
    });
    await api(`/clients/${cid}/adjustments`, {
      method: "POST",
      body: JSON.stringify({ adjustmentType: "educator_expenses", amount: 200, description: "Supplies", isApplied: true }),
    });
    await settle();

    // ── CSV ──
    const csv = await rawText(`/clients/${cid}/tax-return/csv`);
    check("CSV: 200 OK", csv.status === 200);
    check("CSV: content-type is text/csv", csv.contentType.includes("text/csv"));
    check("CSV: contains 'TaxFlow Assistant'", csv.body.includes("TaxFlow Assistant"));
    check("CSV: has IRS Line column header", csv.body.includes("IRS Line,Field Name"));
    check("CSV: has Total Income row", /1040 Line 9,totalIncome,Total Income,1040-L9/.test(csv.body));
    check("CSV: includes educator deduction line", csv.body.includes("Sched 1 Line 11"));

    // ── JSON ──
    const json = await rawText(`/clients/${cid}/tax-return/json`);
    check("JSON: 200 OK", json.status === 200);
    check("JSON: content-type is application/json", json.contentType.includes("application/json"));
    const parsed = JSON.parse(json.body);
    check("JSON: has metadata", parsed.metadata != null);
    check("JSON: metadata.taxYear = 2024", parsed.metadata?.taxYear === 2024);
    check("JSON: has client object", parsed.client != null);
    check("JSON: has formData array", Array.isArray(parsed.formData));
    check("JSON: formData has rows", (parsed.formData?.length ?? 0) > 5);
    check("JSON: has fullResult object", parsed.fullResult != null);
    check("JSON: fullResult.totalIncome = 75000", parsed.fullResult?.totalIncome === 75000);

    // ── UltraTax .GEN ──
    const gen = await rawText(`/clients/${cid}/tax-return/ultratax`);
    check("UltraTax: 200 OK", gen.status === 200);
    check("UltraTax: content-type is text/plain", gen.contentType.includes("text/plain"));
    check("UltraTax: has [META] section", gen.body.includes("[META]"));
    check("UltraTax: has [1040] section", gen.body.includes("[1040]"));
    check("UltraTax: TAX_YEAR=2024", gen.body.includes("TAX_YEAR=2024"));
    check("UltraTax: 1040-L9=75000.00", gen.body.includes("1040-L9=75000.00"));

    // ── PDF — custom summary (pdfkit) ──
    const pdf = await rawBytes(`/clients/${cid}/tax-return/pdf`);
    check("PDF: 200 OK", pdf.status === 200);
    check("PDF: content-type is application/pdf", pdf.contentType.includes("application/pdf"));
    check("PDF: starts with %PDF magic bytes", pdf.head.startsWith("%PDF"));
    check("PDF: size > 1KB (real content)", pdf.size > 1000);

    // ── PDF — IRS Form 1040 overlay (pdf-lib + bundled IRS template) ──
    const f1040 = await rawBytes(`/clients/${cid}/tax-return/form-1040`);
    check("IRS 1040: 200 OK", f1040.status === 200);
    check("IRS 1040: content-type is application/pdf", f1040.contentType.includes("application/pdf"));
    check("IRS 1040: starts with %PDF magic bytes", f1040.head.startsWith("%PDF"));
    // Template is ~163KB; with overlay text it should be in the ~150-300KB range.
    check("IRS 1040: size in expected range (140K-300K)", f1040.size > 140000 && f1040.size < 300000);
  } finally {
    await delClient(cid);
  }

  console.log("\n══════════════════════ Export Test Summary ══════════════════════");
  console.log(`PASS: ${PASS.length}`);
  console.log(`FAIL: ${FAIL.length}`);
  if (FAIL.length > 0) {
    for (const f of FAIL) console.log("  " + f);
    process.exit(1);
  } else {
    console.log("\n✓ All export endpoint tests pass");
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
