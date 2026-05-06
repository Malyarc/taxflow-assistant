import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, w2DataTable } from "@workspace/db";
import {
  ListW2DataParams,
  CreateW2DataParams,
  CreateW2DataBody,
  UpdateW2DataParams,
  UpdateW2DataBody,
  DeleteW2DataParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/clients/:clientId/w2data", async (req, res): Promise<void> => {
  const params = ListW2DataParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const records = await db
    .select()
    .from(w2DataTable)
    .where(eq(w2DataTable.clientId, params.data.clientId));

  // Convert numeric strings to numbers for response
  const mapped = records.map((r) => ({
    ...r,
    wagesBox1: r.wagesBox1 != null ? Number(r.wagesBox1) : null,
    federalTaxWithheldBox2: r.federalTaxWithheldBox2 != null ? Number(r.federalTaxWithheldBox2) : null,
    socialSecurityWagesBox3: r.socialSecurityWagesBox3 != null ? Number(r.socialSecurityWagesBox3) : null,
    socialSecurityTaxBox4: r.socialSecurityTaxBox4 != null ? Number(r.socialSecurityTaxBox4) : null,
    medicareWagesBox5: r.medicareWagesBox5 != null ? Number(r.medicareWagesBox5) : null,
    medicareTaxBox6: r.medicareTaxBox6 != null ? Number(r.medicareTaxBox6) : null,
    stateTaxWithheldBox17: r.stateTaxWithheldBox17 != null ? Number(r.stateTaxWithheldBox17) : null,
    stateWagesBox16: r.stateWagesBox16 != null ? Number(r.stateWagesBox16) : null,
  }));
  res.json(mapped);
});

router.post("/clients/:clientId/w2data", async (req, res): Promise<void> => {
  const params = CreateW2DataParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = CreateW2DataBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const insertData: Record<string, unknown> = { ...parsed.data, clientId: params.data.clientId };
  const numericFields = ["wagesBox1","federalTaxWithheldBox2","socialSecurityWagesBox3","socialSecurityTaxBox4","medicareWagesBox5","medicareTaxBox6","stateTaxWithheldBox17","stateWagesBox16"];
  for (const field of numericFields) {
    if (insertData[field] != null) insertData[field] = String(insertData[field]);
  }
  const [record] = await db.insert(w2DataTable).values(insertData as Parameters<typeof db.insert>[0] extends infer T ? T : never).returning();
  const r = record;
  res.status(201).json({
    ...r,
    wagesBox1: r.wagesBox1 != null ? Number(r.wagesBox1) : null,
    federalTaxWithheldBox2: r.federalTaxWithheldBox2 != null ? Number(r.federalTaxWithheldBox2) : null,
    socialSecurityWagesBox3: r.socialSecurityWagesBox3 != null ? Number(r.socialSecurityWagesBox3) : null,
    socialSecurityTaxBox4: r.socialSecurityTaxBox4 != null ? Number(r.socialSecurityTaxBox4) : null,
    medicareWagesBox5: r.medicareWagesBox5 != null ? Number(r.medicareWagesBox5) : null,
    medicareTaxBox6: r.medicareTaxBox6 != null ? Number(r.medicareTaxBox6) : null,
    stateTaxWithheldBox17: r.stateTaxWithheldBox17 != null ? Number(r.stateTaxWithheldBox17) : null,
    stateWagesBox16: r.stateWagesBox16 != null ? Number(r.stateWagesBox16) : null,
  });
});

router.patch("/clients/:clientId/w2data/:w2Id", async (req, res): Promise<void> => {
  const params = UpdateW2DataParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateW2DataBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updateData: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() };
  const numericFields = ["wagesBox1","federalTaxWithheldBox2","socialSecurityWagesBox3","socialSecurityTaxBox4","medicareWagesBox5","medicareTaxBox6","stateTaxWithheldBox17","stateWagesBox16"];
  for (const field of numericFields) {
    if (updateData[field] != null) updateData[field] = String(updateData[field]);
  }
  const [record] = await db
    .update(w2DataTable)
    .set(updateData)
    .where(and(eq(w2DataTable.id, params.data.w2Id), eq(w2DataTable.clientId, params.data.clientId)))
    .returning();
  if (!record) {
    res.status(404).json({ error: "W-2 record not found" });
    return;
  }
  const r = record;
  res.json({
    ...r,
    wagesBox1: r.wagesBox1 != null ? Number(r.wagesBox1) : null,
    federalTaxWithheldBox2: r.federalTaxWithheldBox2 != null ? Number(r.federalTaxWithheldBox2) : null,
    socialSecurityWagesBox3: r.socialSecurityWagesBox3 != null ? Number(r.socialSecurityWagesBox3) : null,
    socialSecurityTaxBox4: r.socialSecurityTaxBox4 != null ? Number(r.socialSecurityTaxBox4) : null,
    medicareWagesBox5: r.medicareWagesBox5 != null ? Number(r.medicareWagesBox5) : null,
    medicareTaxBox6: r.medicareTaxBox6 != null ? Number(r.medicareTaxBox6) : null,
    stateTaxWithheldBox17: r.stateTaxWithheldBox17 != null ? Number(r.stateTaxWithheldBox17) : null,
    stateWagesBox16: r.stateWagesBox16 != null ? Number(r.stateWagesBox16) : null,
  });
});

router.delete("/clients/:clientId/w2data/:w2Id", async (req, res): Promise<void> => {
  const params = DeleteW2DataParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [record] = await db
    .delete(w2DataTable)
    .where(and(eq(w2DataTable.id, params.data.w2Id), eq(w2DataTable.clientId, params.data.clientId)))
    .returning();
  if (!record) {
    res.status(404).json({ error: "W-2 record not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
