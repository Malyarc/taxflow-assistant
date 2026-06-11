/**
 * Schedule E rental property CRUD routes.
 *
 * Per-property tracking complements the legacy aggregate-adjustment path
 * (schedule_e_rental_income / _expenses / _macrs_depreciation): when rental
 * property rows exist for a client's tax year, the engine uses them; else
 * the adjustments still flow through.
 */
import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, rentalPropertiesTable } from "@workspace/db";
import {
  ListRentalPropertiesParams,
  CreateRentalPropertyParams,
  CreateRentalPropertyBody,
  UpdateRentalPropertyParams,
  UpdateRentalPropertyBody,
  DeleteRentalPropertyParams,
} from "@workspace/api-zod";
import { recalculateAfterMutation } from "../lib/taxReturnPipeline";
import { writeAudit } from "../lib/auditLog";

const router: IRouter = Router();

/** Convert numeric DB strings to JS numbers for response. */
function mapProperty(r: typeof rentalPropertiesTable.$inferSelect) {
  return {
    ...r,
    basis: r.basis != null ? Number(r.basis) : null,
    rentalIncome: r.rentalIncome != null ? Number(r.rentalIncome) : 0,
    totalExpenses: r.totalExpenses != null ? Number(r.totalExpenses) : 0,
  };
}

router.get("/clients/:clientId/rental-properties", async (req, res): Promise<void> => {
  const params = ListRentalPropertiesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const records = await db
    .select()
    .from(rentalPropertiesTable)
    .where(eq(rentalPropertiesTable.clientId, params.data.clientId));
  res.json(records.map(mapProperty));
});

router.post("/clients/:clientId/rental-properties", async (req, res): Promise<void> => {
  const params = CreateRentalPropertyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = CreateRentalPropertyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  // Numeric DB columns are stored as strings (incl. the T1.2 §469(g) carryforward).
  const insertData: Record<string, unknown> = { ...parsed.data, clientId: params.data.clientId };
  for (const f of ["basis", "rentalIncome", "totalExpenses", "suspendedLossCarryforward"]) {
    if (insertData[f] != null) insertData[f] = String(insertData[f]);
  }
  const [record] = await db
    .insert(rentalPropertiesTable)
    .values(insertData as typeof rentalPropertiesTable.$inferInsert)
    .returning();
  await writeAudit({
    clientId: params.data.clientId,
    action: "create",
    entityType: "rental_property",
    entityId: record.id,
    after: record,
    source: "rental property created",
  });
  await recalculateAfterMutation(params.data.clientId);
  res.status(201).json(mapProperty(record));
});

router.patch("/clients/:clientId/rental-properties/:propertyId", async (req, res): Promise<void> => {
  const params = UpdateRentalPropertyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateRentalPropertyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
    // T2.2 — a CPA edit makes a roll-forward proforma row REAL (the organizer
  // then counts it as received).
  const updateData: Record<string, unknown> = { ...parsed.data, proforma: false, updatedAt: new Date() };
  for (const f of ["basis", "rentalIncome", "totalExpenses", "suspendedLossCarryforward"]) {
    if (updateData[f] != null) updateData[f] = String(updateData[f]);
  }
  const [before] = await db
    .select()
    .from(rentalPropertiesTable)
    .where(
      and(
        eq(rentalPropertiesTable.id, params.data.propertyId),
        eq(rentalPropertiesTable.clientId, params.data.clientId),
      ),
    );
  const [record] = await db
    .update(rentalPropertiesTable)
    .set(updateData)
    .where(
      and(
        eq(rentalPropertiesTable.id, params.data.propertyId),
        eq(rentalPropertiesTable.clientId, params.data.clientId),
      ),
    )
    .returning();
  if (!record) {
    res.status(404).json({ error: "Rental property not found" });
    return;
  }
  await writeAudit({
    clientId: params.data.clientId,
    action: "update",
    entityType: "rental_property",
    entityId: record.id,
    before,
    after: record,
  });
  await recalculateAfterMutation(params.data.clientId);
  res.json(mapProperty(record));
});

router.delete("/clients/:clientId/rental-properties/:propertyId", async (req, res): Promise<void> => {
  const params = DeleteRentalPropertyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [record] = await db
    .delete(rentalPropertiesTable)
    .where(
      and(
        eq(rentalPropertiesTable.id, params.data.propertyId),
        eq(rentalPropertiesTable.clientId, params.data.clientId),
      ),
    )
    .returning();
  if (!record) {
    res.status(404).json({ error: "Rental property not found" });
    return;
  }
  await writeAudit({
    clientId: params.data.clientId,
    action: "delete",
    entityType: "rental_property",
    entityId: record.id,
    before: record,
  });
  await recalculateAfterMutation(params.data.clientId);
  res.sendStatus(204);
});

export default router;
