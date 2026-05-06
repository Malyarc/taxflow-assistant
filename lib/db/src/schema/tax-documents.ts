import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const taxDocumentsTable = pgTable("tax_documents", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull(),
  documentType: text("document_type").notNull().default("w2"),
  fileName: text("file_name").notNull(),
  fileContent: text("file_content"),
  status: text("status").notNull().default("pending"),
  extractedText: text("extracted_text"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTaxDocumentSchema = createInsertSchema(taxDocumentsTable).omit({ id: true, createdAt: true });
export type InsertTaxDocument = z.infer<typeof insertTaxDocumentSchema>;
export type TaxDocument = typeof taxDocumentsTable.$inferSelect;
