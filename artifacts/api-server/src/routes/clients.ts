import { Router, type IRouter } from "express";
import { eq, desc, and, or, ilike, sql, type SQL } from "drizzle-orm";
import { db, clientsTable, taxReturnsTable, w2DataTable, form1099DataTable, adjustmentsTable, taxDocumentsTable } from "@workspace/db";
import {
  CreateClientBody,
  UpdateClientBody,
  GetClientParams,
  UpdateClientParams,
  DeleteClientParams,
} from "@workspace/api-zod";
import { recalculateAfterMutation } from "../lib/taxReturnPipeline";
import { writeAudit } from "../lib/auditLog";

const router: IRouter = Router();

const VALID_STATES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM",
  "NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA",
  "WV","WI","WY",
]);

function normalizeState(raw: string | undefined | null): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim().toUpperCase();
  if (trimmed.length === 0) return null;
  if (!VALID_STATES.has(trimmed)) return "INVALID";
  return trimmed;
}

const CLIENTS_DEFAULT_LIMIT = 50;
const CLIENTS_MAX_LIMIT = 200;

// Keyset cursor over (updatedAt, id). We carry updatedAt as a UTC *microsecond*
// ISO string (NOT a JS Date), because node-postgres truncates a timestamptz to
// MILLISECOND precision when it builds the JS Date. A millisecond cursor would
// then SKIP rows that share the cursor's millisecond but have a smaller
// microsecond — a real keyset bug (e.g. several clients batch-inserted in the
// same microsecond, truncated to the same millisecond). The string is compared
// against the column via `$cursor::timestamp at time zone 'UTC'`, which stays
// index-usable on clients_updated_at_idx. Base64url-encoded so it's opaque.
const UPDATED_AT_CURSOR_SQL = sql<string>`to_char(${clientsTable.updatedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')`;
const CURSOR_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?$/;

function encodeClientsCursor(tsUtc: string, id: number): string {
  return Buffer.from(`${tsUtc}|${id}`).toString("base64url");
}
function decodeClientsCursor(raw: string): { tsUtc: string; id: number } | null {
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    const sep = decoded.lastIndexOf("|");
    if (sep < 0) return null;
    const tsUtc = decoded.slice(0, sep);
    const id = Number(decoded.slice(sep + 1));
    // Shape-validate the timestamp (the value is parameterized, but reject
    // malformed cursors with a clean 400 rather than a SQL cast error).
    if (!Number.isInteger(id) || !CURSOR_TS_RE.test(tsUtc)) return null;
    return { tsUtc, id };
  } catch {
    return null;
  }
}

// Keyset-paginated, column-projected, server-filtered. Replaces a `SELECT *` over
// the whole table (no LIMIT) that the frontend then filtered client-side. Orders
// by updatedAt DESC (most-recently-touched first) using the clients_updated_at_idx
// index; ?q searches name/email, ?filingStatus filters, ?cursor pages.
router.get("/clients", async (req, res): Promise<void> => {
  const limitRaw = Number(req.query.limit);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0
    ? Math.min(Math.floor(limitRaw), CLIENTS_MAX_LIMIT)
    : CLIENTS_DEFAULT_LIMIT;

  const conditions: SQL[] = [];

  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (q) {
    const pattern = `%${q}%`;
    const search = or(
      ilike(clientsTable.firstName, pattern),
      ilike(clientsTable.lastName, pattern),
      ilike(clientsTable.email, pattern),
    );
    if (search) conditions.push(search);
  }

  const filingStatus = typeof req.query.filingStatus === "string" ? req.query.filingStatus.trim() : "";
  if (filingStatus) conditions.push(eq(clientsTable.filingStatus, filingStatus));

  if (typeof req.query.cursor === "string" && req.query.cursor.length > 0) {
    const cur = decodeClientsCursor(req.query.cursor);
    if (!cur) {
      res.status(400).json({ error: "Invalid cursor" });
      return;
    }
    // Rows strictly after the cursor in (updatedAt DESC, id DESC) order. The
    // cursor timestamp is microsecond-precise, so the equality branch correctly
    // matches the rest of a same-microsecond group (id tiebreaker).
    const cursorTs = sql`${cur.tsUtc}::timestamp at time zone 'UTC'`;
    conditions.push(
      sql`(${clientsTable.updatedAt} < ${cursorTs} or (${clientsTable.updatedAt} = ${cursorTs} and ${clientsTable.id} < ${cur.id}))`,
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  // Project only the columns the list view needs (avoids shipping the 60+-column
  // row — including PII/jsonb-heavy fields — for every client). cursorTs is the
  // microsecond UTC timestamp used to build nextCursor; it's stripped from the
  // response items below.
  const rows = await db
    .select({
      id: clientsTable.id,
      firstName: clientsTable.firstName,
      lastName: clientsTable.lastName,
      email: clientsTable.email,
      state: clientsTable.state,
      filingStatus: clientsTable.filingStatus,
      taxYear: clientsTable.taxYear,
      updatedAt: clientsTable.updatedAt,
      cursorTs: UPDATED_AT_CURSOR_SQL,
    })
    .from(clientsTable)
    .where(where)
    .orderBy(desc(clientsTable.updatedAt), desc(clientsTable.id))
    .limit(limit);

  // A full page implies there may be more; a partial page is the last one.
  const last = rows.length === limit ? rows[rows.length - 1] : null;
  const nextCursor = last ? encodeClientsCursor(last.cursorTs, last.id) : null;
  const items = rows.map(({ cursorTs: _cursorTs, ...rest }) => rest);
  res.json({ items, nextCursor });
});

router.post("/clients", async (req, res): Promise<void> => {
  const parsed = CreateClientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const normalizedState = normalizeState(parsed.data.state);
  if (normalizedState === "INVALID") {
    res.status(400).json({ error: `Invalid US state code: "${parsed.data.state}". Use a 2-letter code like "CA" or "NY".` });
    return;
  }
  // Drizzle's numeric() columns are typed as string for inserts. Convert
  // OpenAPI-typed `number | null` fields to that shape.
  const { spouseEarnedIncome, acaAnnualPremium, acaAnnualSlcsp, acaAdvanceAptc,
          socialSecurityBenefits, parentsTopMarginalRate, ...rest } = parsed.data;
  const [client] = await db
    .insert(clientsTable)
    .values({
      ...rest,
      state: normalizedState ?? parsed.data.state,
      ...(spouseEarnedIncome != null ? { spouseEarnedIncome: String(spouseEarnedIncome) } : {}),
      ...(acaAnnualPremium != null ? { acaAnnualPremium: String(acaAnnualPremium) } : {}),
      ...(acaAnnualSlcsp != null ? { acaAnnualSlcsp: String(acaAnnualSlcsp) } : {}),
      ...(acaAdvanceAptc != null ? { acaAdvanceAptc: String(acaAdvanceAptc) } : {}),
      ...(socialSecurityBenefits != null ? { socialSecurityBenefits: String(socialSecurityBenefits) } : {}),
      ...(parentsTopMarginalRate != null ? { parentsTopMarginalRate: String(parentsTopMarginalRate) } : {}),
    })
    .returning();
  await writeAudit({ clientId: client.id, action: "create", entityType: "client", entityId: client.id, after: client });
  res.status(201).json(client);
});

router.get("/clients/:id", async (req, res): Promise<void> => {
  const params = GetClientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [client] = await db
    .select()
    .from(clientsTable)
    .where(eq(clientsTable.id, params.data.id));
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  res.json(client);
});

router.patch("/clients/:id", async (req, res): Promise<void> => {
  const params = UpdateClientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateClientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updateData: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() };
  // Drizzle numeric() columns require string values — same shape as the
  // POST handler. Coerce numbers → strings; leave nulls as-is to clear.
  for (const k of ["spouseEarnedIncome", "acaAnnualPremium", "acaAnnualSlcsp", "acaAdvanceAptc", "socialSecurityBenefits", "parentsTopMarginalRate"] as const) {
    const v = (parsed.data as Record<string, unknown>)[k];
    if (typeof v === "number") updateData[k] = String(v);
  }
  if (parsed.data.state !== undefined) {
    const normalized = normalizeState(parsed.data.state);
    if (normalized === "INVALID") {
      res.status(400).json({ error: `Invalid US state code: "${parsed.data.state}". Use a 2-letter code like "CA" or "NY".` });
      return;
    }
    updateData.state = normalized ?? "";
  }
  const [before] = await db.select().from(clientsTable).where(eq(clientsTable.id, params.data.id));
  const [client] = await db
    .update(clientsTable)
    .set(updateData)
    .where(eq(clientsTable.id, params.data.id))
    .returning();
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  await writeAudit({ clientId: client.id, action: "update", entityType: "client", entityId: client.id, before, after: client });
  // Filing status, state, or tax year changes affect the calculation — refresh.
  await recalculateAfterMutation(client.id);
  res.json(client);
});

router.delete("/clients/:id", async (req, res): Promise<void> => {
  const params = DeleteClientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const id = params.data.id;
  const [beforeClient] = await db.select().from(clientsTable).where(eq(clientsTable.id, id));
  if (beforeClient) {
    // Audit the delete before it happens. audit_log.clientId is ON DELETE SET
    // NULL, so the log row survives the cascade (with a null clientId).
    await writeAudit({ clientId: id, action: "delete", entityType: "client", entityId: id, before: beforeClient });
  }
  // Child tables carry FK clientId → clients ON DELETE CASCADE, so removing the
  // client row also removes its dependents (including rental_properties /
  // capital_transactions / schedule_k1_data / client_asset_balances, which are
  // not deleted explicitly below). The explicit deletes are kept for ordering
  // clarity; the whole sequence runs in ONE transaction so a mid-sequence
  // failure can no longer leave orphaned rows or a half-deleted client.
  const [client] = await db.transaction(async (tx) => {
    await tx.delete(taxReturnsTable).where(eq(taxReturnsTable.clientId, id));
    await tx.delete(adjustmentsTable).where(eq(adjustmentsTable.clientId, id));
    await tx.delete(w2DataTable).where(eq(w2DataTable.clientId, id));
    await tx.delete(form1099DataTable).where(eq(form1099DataTable.clientId, id));
    await tx.delete(taxDocumentsTable).where(eq(taxDocumentsTable.clientId, id));
    return tx.delete(clientsTable).where(eq(clientsTable.id, id)).returning();
  });
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
