import { pgTable, text, serial, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { clientsTable } from "./clients";

/**
 * Lifecycle for an uploaded document:
 *   pending → processing → pending_review → approved | rejected
 *                       ↘ failed
 * Legacy rows (uploaded before the CPA-review gate landed) may still
 * have status="extracted"; the UI treats that as a synonym of "approved".
 *
 * Storage note (deep-audit DB finding): fileContent currently stores the
 * full base64-encoded document inline. At scale this is a major bloat
 * (~13GB at 10k docs × 1MB). The future migration is to S3 + signed URL,
 * leaving only metadata in this row. Not done in this audit — flagged
 * as a follow-up (D17 / file storage hardening).
 */
export const taxDocumentsTable = pgTable("tax_documents", {
  id: serial("id").primaryKey(),
  // Deep-audit DB finding: FK + cascade so deleting a client cleans up docs.
  clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
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
}, (table) => ({
  // Deep-audit DB finding: clients tab loads the document list filtered by
  // clientId. Without this index, list queries scan the table.
  clientIdx: index("tax_documents_client_id_idx").on(table.clientId),
  // status-filtered queries (e.g., "list pending_review docs") are
  // route-level cost — composite (clientId, status) covers it.
  clientStatusIdx: index("tax_documents_client_status_idx").on(table.clientId, table.status),
}));

export const insertTaxDocumentSchema = createInsertSchema(taxDocumentsTable).omit({ id: true, createdAt: true });
export type InsertTaxDocument = z.infer<typeof insertTaxDocumentSchema>;
export type TaxDocument = typeof taxDocumentsTable.$inferSelect;
