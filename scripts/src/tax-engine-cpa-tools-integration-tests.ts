/**
 * T2.2 — CPA-tools endpoints integration (GAME PLAN D).
 *
 * Verifies the live planning surfaces: tax-projection (+1040-ES), mfj-vs-mfs,
 * year-over-year, entity-choice, roll-forward (proforma), organizer (+PDF),
 * engagement tracking, planning-report PDF, return-qa, and planning-campaigns.
 * Requires the api-server on http://localhost:8080 (+ Postgres). Excluded
 * from the no-API battery (NEEDS_API in run-no-api.ts).
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

  // ── T2.2 completion batch: entity-choice / roll-forward / organizer /
  //    engagement / planning-report / return-qa / campaigns ──
  const sp = await mkClient("single");
  try {
    // $200k 1099-NEC sole prop (mirrors the hand-calc'd no-API E1 case).
    await api(`/clients/${sp}/form1099data`, {
      method: "POST",
      body: JSON.stringify({ taxYear: 2024, formType: "nec", payerName: "BigCo", nonemployeeCompensation: 200000 }),
    });
    await settle();

    // Entity choice at an explicit $80k comp: the no-API suite pins the exact
    // hand-calc ($9,503.38 savings); here we verify the live seam agrees.
    const ec = await api<Record<string, any>>(`/clients/${sp}/entity-choice?reasonableComp=80000`);
    ok("entity-choice 200", ec.status === 200, String(ec.status));
    ok("entity-choice applicable", ec.body?.applicable === true);
    ok("entity-choice profit $200,000", Number(ec.body?.businessProfit) === 200000);
    ok("entity-choice savings ≈ $9,503 (hand-calc)", Math.abs(Number(ec.body?.options?.[0]?.savingsVsSoleProp) - 9503.38) < 1);
    const ecSweep = await api<Record<string, any>>(`/clients/${sp}/entity-choice`);
    ok("entity-choice default sweep = 3 options", Array.isArray(ecSweep.body?.options) && ecSweep.body.options.length === 3);
    const ecBad = await api(`/clients/${sp}/entity-choice?reasonableComp=-5`);
    ok("entity-choice rejects negative comp (400)", ecBad.status === 400, String(ecBad.status));

    // Organizer: prior-year (2024) docs drive the TY2025 request list.
    const org = await api<Record<string, any>>(`/clients/${sp}/organizer?taxYear=2025`);
    ok("organizer 200", org.status === 200);
    ok("organizer lists the BigCo 1099-NEC as missing",
      org.body?.items?.some((i: any) => i.id === "1099:nec:bigco" && i.status === "missing") === true);
    ok("organizer includes the SE books item", org.body?.items?.some((i: any) => i.id === "sched-c:books") === true);
    ok("organizer counts reconcile", org.body?.counts?.missing + org.body?.counts?.received + org.body?.counts?.questions === org.body?.items?.length);
    const orgPdf = await fetch(`${BASE}/clients/${sp}/organizer/pdf?taxYear=2025`);
    ok("organizer PDF 200 + %PDF", orgPdf.status === 200 && (await orgPdf.arrayBuffer()).byteLength > 1500 && (orgPdf.headers.get("content-type") ?? "").includes("pdf"));

    // Roll-forward 2024 → 2025: copies the 1099, advances client.taxYear.
    const rf = await api<Record<string, any>>(`/clients/${sp}/roll-forward`, { method: "POST", body: JSON.stringify({ toYear: 2025 }) });
    ok("roll-forward 200", rf.status === 200, JSON.stringify(rf.body));
    ok("roll-forward copied the 1099", rf.body?.copied?.form1099s === 1);
    ok("roll-forward reports years", rf.body?.fromYear === 2024 && rf.body?.toYear === 2025);
    const rfAgain = await api(`/clients/${sp}/roll-forward`, { method: "POST", body: JSON.stringify({ toYear: 2025 }) });
    ok("re-roll same year → 409", rfAgain.status === 409, String(rfAgain.status));
    const f99s = await api<any[]>(`/clients/${sp}/form1099data`);
    ok("rolled 1099 exists in TY2025", Array.isArray(f99s.body) && f99s.body.some((r) => r.taxYear === 2025 && r.payerName === "BigCo"));
    const clientAfter = await api<Record<string, any>>(`/clients/${sp}`);
    ok("client.taxYear advanced to 2025", clientAfter.body?.taxYear === 2025);
    // After the roll the organizer shows the SAME payer as received.
    const org2 = await api<Record<string, any>>(`/clients/${sp}/organizer?taxYear=2025`);
    ok("organizer flips the rolled 1099 to received",
      org2.body?.items?.some((i: any) => i.id === "1099:nec:bigco" && i.status === "received") === true);

    // Engagement: PATCH status + extension; firm list includes the client.
    const eng = await api<Record<string, any>>(`/clients/${sp}/tax-return/engagement`, {
      method: "PATCH",
      body: JSON.stringify({ engagementStatus: "in_review", extensionFiled: true }),
    });
    ok("engagement PATCH 200", eng.status === 200, JSON.stringify(eng.body));
    ok("engagement row updated", eng.body?.engagementStatus === "in_review" && eng.body?.extensionFiled === true);
    const engBad = await api(`/clients/${sp}/tax-return/engagement`, { method: "PATCH", body: JSON.stringify({ engagementStatus: "bogus" }) });
    ok("engagement rejects bad status (400)", engBad.status === 400, String(engBad.status));
    const engList = await api<Record<string, any>>(`/engagements`);
    ok("engagements list 200", engList.status === 200);
    const mine = engList.body?.entries?.find((e: any) => e.clientId === sp);
    ok("engagements lists the client with the extended deadline", mine?.extensionFiled === true && mine?.effectiveDeadline === "2026-10-15");
    ok("engagements statusCounts counts in_review", Number(engList.body?.statusCounts?.in_review) >= 1);
    const engFiltered = await api<Record<string, any>>(`/engagements?status=in_review`);
    ok("engagements status filter works", engFiltered.body?.entries?.every((e: any) => e.engagementStatus === "in_review") === true);

    // Planning report PDF (pro-tier path; deterministic content).
    const rep = await fetch(`${BASE}/clients/${sp}/planning-report/pdf`);
    ok("planning-report PDF 200 + %PDF", rep.status === 200 && (await rep.arrayBuffer()).byteLength > 1500 && (rep.headers.get("content-type") ?? "").includes("pdf"));

    // Return Q&A — without consent/AI it must fall back deterministically.
    const qa = await api<Record<string, any>>(`/clients/${sp}/return-qa`, {
      method: "POST",
      body: JSON.stringify({ question: "What is my refund this year?" }),
    });
    ok("return-qa 200", qa.status === 200, JSON.stringify(qa.body));
    ok("return-qa answers with text + aiUsed flag", typeof qa.body?.answer === "string" && qa.body.answer.length > 20 && typeof qa.body?.aiUsed === "boolean");
    const qaBad = await api(`/clients/${sp}/return-qa`, { method: "POST", body: JSON.stringify({ question: "   " }) });
    ok("return-qa rejects empty question (400)", qaBad.status === 400, String(qaBad.status));

    // Campaigns: list + email draft (deterministic template path).
    const camps = await api<Record<string, any>>(`/planning-campaigns?limit=50`);
    ok("planning-campaigns 200", camps.status === 200);
    ok("planning-campaigns returns campaigns array", Array.isArray(camps.body?.campaigns));
    const firstCamp = camps.body?.campaigns?.[0];
    if (firstCamp) {
      ok("campaign has cohort + totals", Array.isArray(firstCamp.clients) && Number(firstCamp.totalEstSavings) > 0);
      const draft = await api<Record<string, any>>(`/planning-campaigns/email-draft`, {
        method: "POST",
        body: JSON.stringify({ strategyId: firstCamp.strategyId }),
      });
      ok("email-draft 200", draft.status === 200, JSON.stringify(draft.body).slice(0, 200));
      ok("email-draft template has merge fields", typeof draft.body?.template === "string" && draft.body.template.includes("{{firstName}}") && draft.body.template.includes("{{estSavings}}"));
    } else {
      ok("campaign cohort skipped (no firm-wide hits in this DB)", true);
      ok("email-draft skipped (no campaigns)", true);
    }
    const draftBad = await api(`/planning-campaigns/email-draft`, { method: "POST", body: JSON.stringify({ strategyId: "NOPE.1" }) });
    ok("email-draft unknown strategy → 400", draftBad.status === 400, String(draftBad.status));
  } finally {
    await api(`/clients/${sp}`, { method: "DELETE" });
  }

  // ── 404 paths ──
  ok("tax-projection unknown client 404", (await api("/clients/999999999/tax-projection")).status === 404);
  ok("mfj-vs-mfs unknown client 404", (await api("/clients/999999999/mfj-vs-mfs")).status === 404);
  ok("year-over-year unknown client 404", (await api("/clients/999999999/year-over-year")).status === 404);
  ok("entity-choice unknown client 404", (await api("/clients/999999999/entity-choice")).status === 404);
  ok("organizer unknown client 404", (await api("/clients/999999999/organizer")).status === 404);
  ok("roll-forward unknown client 404", (await api("/clients/999999999/roll-forward", { method: "POST", body: "{}" })).status === 404);

  console.log(`\nRESULTS: ${PASS.length} passed, ${FAIL.length} failed (CPA-tools endpoints)`);
  for (const p of PASS) console.log(p);
  if (FAIL.length) { for (const f of FAIL) console.error(f); process.exit(1); }
  console.log("ALL CPA-TOOLS INTEGRATION ASSERTIONS PASS");
}
run().catch((err) => { console.error(err); process.exit(1); });
