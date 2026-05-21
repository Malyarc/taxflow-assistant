import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Lifecycle for an uploaded document:
 *   pending → processing → pending_review → approved | rejected
 *                       ↘ failed
 * Legacy rows (uploaded before the CPA-review gate landed) may still
 * have status="extracted"; the UI treats that as a synonym of "approved".
 */
export const taxDocumentsTable = pgTable("tax_documents", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull(),
  documentType: text("document_type").notNull().default("w2"),
  fileName: text("file_name").notNull(),
  fileContent: text("file_content"),
  status: text("status").notNull().default("pending"),
  extractedText: text("extracted_text"),
  /** PK of the w2_data / form_1099_data row this document was approved into. NULL until approve. */
  linkedRecordId: integer("linked_record_id"),
  /** Which table linkedRecordId points to: "w2" | "form1099". NULL until approve. */
  linkedRecordType: text("linked_record_type"),
  /** Optional CPA-supplied reason captured at reject time. */
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTaxDocumentSchema = createInsertSchema(taxDocumentsTable).omit({ id: true, createdAt: true });
export type InsertTaxDocument = z.infer<typeof insertTaxDocumentSchema>;
export type TaxDocument = typeof taxDocumentsTable.$inferSelect;
