import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
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

router.get("/clients", async (req, res): Promise<void> => {
  const clients = await db
    .select()
    .from(clientsTable)
    .orderBy(desc(clientsTable.updatedAt));
  res.json(clients);
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
  // Application-level cascade: schema has no FK constraints, so we delete
  // dependent rows manually before removing the client.
  // NOTE: audit_log has a real FK with ON DELETE CASCADE, so client delete
  // also clears the audit history. For compliance hardening, future work
  // should preserve audit_log on client delete (soft-delete clients instead).
  const id = params.data.id;
  const [beforeClient] = await db.select().from(clientsTable).where(eq(clientsTable.id, id));
  if (beforeClient) {
    // Write the audit BEFORE the cascade (it'll be cascade-deleted as a side
    // effect; we keep this here for the in-memory transcript at least).
    await writeAudit({ clientId: id, action: "delete", entityType: "client", entityId: id, before: beforeClient });
  }
  await db.delete(taxReturnsTable).where(eq(taxReturnsTable.clientId, id));
  await db.delete(adjustmentsTable).where(eq(adjustmentsTable.clientId, id));
  await db.delete(w2DataTable).where(eq(w2DataTable.clientId, id));
  await db.delete(form1099DataTable).where(eq(form1099DataTable.clientId, id));
  await db.delete(taxDocumentsTable).where(eq(taxDocumentsTable.clientId, id));

  const [client] = await db
    .delete(clientsTable)
    .where(eq(clientsTable.id, id))
    .returning();
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
