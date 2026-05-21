/**
 * AI-overlay review-flow integration tests.
 *
 * Validates the upload → extract → CPA review → approve|reject loop that gates
 * AI-extracted values before they hit w2_data / form_1099_data. Without an AI
 * key the server still moves docs to `pending_review` with empty data, which
 * is enough to exercise the gate, approve, and reject paths.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-ai-overlay-tests.ts
 *
 * Requires the api-server on http://localhost:8080.
 */

const BASE = "http://localhost:8080/api";
const PASS: string[] = [];
const FAIL: string[] = [];

function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${e}, got ${a}`);
}
function checkTruthy(label: string, value: unknown) {
  if (value) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: value was ${JSON.stringify(value)}`);
}
function checkContains(label: string, haystack: string | null | undefined, needle: string) {
  if (typeof haystack === "string" && haystack.includes(needle)) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: "${needle}" not in ${JSON.stringify(haystack)}`);
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

/** Same as api() but returns the raw response (status + body) so we can assert error cases. */
async function apiRaw(
  path: string,
  opts: RequestInit = {},
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* keep as text */
  }
  return { status: res.status, body };
}

async function withTempClient<T>(fn: (clientId: number) => Promise<T>): Promise<T> {
  const c = await api<{ id: number }>("/clients", {
    method: "POST",
    body: JSON.stringify({
      firstName: "AIOverlay",
      lastName: "Test",
      email: `ai-overlay-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      filingStatus: "single",
      state: "FL",
      taxYear: 2024,
    }),
  });
  try {
    return await fn(c.id);
  } finally {
    await api(`/clients/${c.id}`, { method: "DELETE" }).catch(() => {});
  }
}

async function uploadAndWait(
  clientId: number,
  documentType: "w2" | "form_1099",
): Promise<{ id: number; status: string }> {
  // Tiny dummy content — AI is disabled locally so the bytes don't matter.
  const dummyBase64 = Buffer.from("dummy content for test").toString("base64");
  const doc = await api<{ id: number; status: string }>(`/clients/${clientId}/documents`, {
    method: "POST",
    body: JSON.stringify({ documentType, fileName: `${documentType}-test.txt`, fileContent: dummyBase64 }),
  });
  // Poll up to 5s for status to flip out of processing.
  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 200));
    const docs = await api<any[]>(`/clients/${clientId}/documents`);
    const found = docs.find((d) => d.id === doc.id);
    if (found && found.status !== "processing" && found.status !== "pending") {
      return { id: doc.id, status: found.status };
    }
  }
  throw new Error(`Document ${doc.id} never left processing state`);
}

async function run() {
  console.log("── Upload gates auto-write: pending_review, no income row ──");
  await withTempClient(async (cid) => {
    const doc = await uploadAndWait(cid, "w2");
    check("Status flips to pending_review after extraction", doc.status, "pending_review");

    const w2s = await api<any[]>(`/clients/${cid}/w2data`);
    check("No w2_data row was auto-created", w2s.length, 0);

    // Tax return wasn't recalculated either — there's no income to recalc on.
    // (Avoid asserting taxReturn shape; just confirm the doc's linkedRecordId is still null.)
    const docs = await api<any[]>(`/clients/${cid}/documents`);
    const d = docs.find((x) => x.id === doc.id);
    check("linkedRecordId still null before approve", d?.linkedRecordId, null);
  });

  console.log("\n── Approve W-2 as-is creates record + audits with AI-extraction source ──");
  await withTempClient(async (cid) => {
    const doc = await uploadAndWait(cid, "w2");

    const approveBody = {
      recordType: "w2",
      taxYear: 2024,
      employerName: "Acme Co",
      employerEin: "12-3456789",
      wagesBox1: 75000,
      federalTaxWithheldBox2: 8500,
      stateCode: "FL",
    };
    await api(`/clients/${cid}/documents/${doc.id}/approve`, {
      method: "POST",
      body: JSON.stringify(approveBody),
    });

    const w2s = await api<any[]>(`/clients/${cid}/w2data`);
    check("Exactly one w2_data row exists", w2s.length, 1);
    check("Wages match approved value", w2s[0].wagesBox1, 75000);
    check("Federal tax withheld matches", w2s[0].federalTaxWithheldBox2, 8500);
    check("Employer name matches", w2s[0].employerName, "Acme Co");
    check("Document linked to created w2 row", w2s[0].documentId, doc.id);

    const docs = await api<any[]>(`/clients/${cid}/documents`);
    const d = docs.find((x) => x.id === doc.id);
    check("Document status flipped to approved", d?.status, "approved");
    check("Document linkedRecordType set to w2", d?.linkedRecordType, "w2");
    check("Document linkedRecordId points to w2 row", d?.linkedRecordId, w2s[0].id);

    const audit = await api<any[]>(`/clients/${cid}/audit-log`);
    const createW2 = audit.find(
      (a) => a.entityType === "w2" && a.action === "create" && a.entityId === w2s[0].id,
    );
    checkTruthy("Audit log has w2 create entry", createW2);
    checkContains(
      "Audit source identifies AI extraction",
      createW2?.source,
      "AI extraction from",
    );

    // Recalc fired — tax return should reflect the wages.
    const ret = await api<any>(`/clients/${cid}/tax-return`);
    check("Tax return totalIncome reflects approved wages", Number(ret.totalIncome), 75000);
  });

  console.log("\n── Approve with edited wages uses CPA value, not extraction ──");
  await withTempClient(async (cid) => {
    const doc = await uploadAndWait(cid, "w2");
    // Simulate the CPA overriding what (a hypothetical) AI extracted.
    await api(`/clients/${cid}/documents/${doc.id}/approve`, {
      method: "POST",
      body: JSON.stringify({
        recordType: "w2",
        taxYear: 2024,
        wagesBox1: 99999,
        stateCode: "FL",
      }),
    });
    const w2s = await api<any[]>(`/clients/${cid}/w2data`);
    check("Edited wages stored", w2s[0].wagesBox1, 99999);
  });

  console.log("\n── Reject leaves no income row + writes audit entry ──");
  await withTempClient(async (cid) => {
    const doc = await uploadAndWait(cid, "w2");
    await api(`/clients/${cid}/documents/${doc.id}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason: "Wrong year" }),
    });

    const w2s = await api<any[]>(`/clients/${cid}/w2data`);
    check("No w2_data row after reject", w2s.length, 0);

    const docs = await api<any[]>(`/clients/${cid}/documents`);
    const d = docs.find((x) => x.id === doc.id);
    check("Document status flipped to rejected", d?.status, "rejected");
    check("Rejection reason stored", d?.rejectionReason, "Wrong year");

    const audit = await api<any[]>(`/clients/${cid}/audit-log`);
    const rejectEntry = audit.find(
      (a) => a.entityType === "tax_document" && a.action === "update" && a.entityId === doc.id,
    );
    checkTruthy("Audit log has tax_document update for rejection", rejectEntry);
    checkContains("Audit source describes CPA rejection", rejectEntry?.source, "CPA rejection");
  });

  console.log("\n── Approve a 1099-INT creates form_1099 row + audits ──");
  await withTempClient(async (cid) => {
    const doc = await uploadAndWait(cid, "form_1099");
    await api(`/clients/${cid}/documents/${doc.id}/approve`, {
      method: "POST",
      body: JSON.stringify({
        recordType: "form1099",
        taxYear: 2024,
        formType: "INT",
        payerName: "Big Bank",
        interestIncome: 525,
        usTreasuryInterest: 100,
        stateCode: "FL",
      }),
    });
    const list = await api<any[]>(`/clients/${cid}/form1099data`);
    check("Exactly one form_1099 row", list.length, 1);
    check("formType stored", list[0].formType, "INT");
    check("interestIncome stored", Number(list[0].interestIncome), 525);
    check("usTreasuryInterest stored", Number(list[0].usTreasuryInterest), 100);
    check("Document linked to 1099 row", list[0].documentId, doc.id);

    const docs = await api<any[]>(`/clients/${cid}/documents`);
    const d = docs.find((x) => x.id === doc.id);
    check("Document linkedRecordType=form1099", d?.linkedRecordType, "form1099");

    const audit = await api<any[]>(`/clients/${cid}/audit-log`);
    const create1099 = audit.find(
      (a) => a.entityType === "form1099" && a.action === "create" && a.entityId === list[0].id,
    );
    checkContains(
      "1099 audit source identifies AI extraction",
      create1099?.source,
      "AI extraction from",
    );
  });

  console.log("\n── Cannot re-approve an already-approved document ──");
  await withTempClient(async (cid) => {
    const doc = await uploadAndWait(cid, "w2");
    await api(`/clients/${cid}/documents/${doc.id}/approve`, {
      method: "POST",
      body: JSON.stringify({ recordType: "w2", taxYear: 2024, wagesBox1: 1000, stateCode: "FL" }),
    });
    const retry = await apiRaw(`/clients/${cid}/documents/${doc.id}/approve`, {
      method: "POST",
      body: JSON.stringify({ recordType: "w2", taxYear: 2024, wagesBox1: 2000, stateCode: "FL" }),
    });
    check("Second approve returns 400", retry.status, 400);
  });

  console.log("\n── Cannot reject a non-pending_review document ──");
  await withTempClient(async (cid) => {
    const doc = await uploadAndWait(cid, "w2");
    await api(`/clients/${cid}/documents/${doc.id}/approve`, {
      method: "POST",
      body: JSON.stringify({ recordType: "w2", taxYear: 2024, wagesBox1: 1000, stateCode: "FL" }),
    });
    const retry = await apiRaw(`/clients/${cid}/documents/${doc.id}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason: "n/a" }),
    });
    check("Reject after approve returns 400", retry.status, 400);
  });

  console.log("\n── Approve missing formType for 1099 returns 400 ──");
  await withTempClient(async (cid) => {
    const doc = await uploadAndWait(cid, "form_1099");
    const r = await apiRaw(`/clients/${cid}/documents/${doc.id}/approve`, {
      method: "POST",
      // No formType — server should reject.
      body: JSON.stringify({ recordType: "form1099", taxYear: 2024, interestIncome: 100 }),
    });
    check("Approve without formType returns 400", r.status, 400);
  });

  // ── Summary ──
  console.log(`\n${PASS.length} passed`);
  if (FAIL.length) {
    console.error(`${FAIL.length} failed:`);
    for (const f of FAIL) console.error(`  ${f}`);
    process.exit(1);
  }
}

run().catch((e) => {
  console.error("Runner error:", e);
  process.exit(1);
});
