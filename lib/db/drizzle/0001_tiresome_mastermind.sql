CREATE TABLE "disclosure_consents" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"scope" text NOT NULL,
	"document_version" text NOT NULL,
	"signer_name" text,
	"signature_ref" text,
	"signed_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "taxpayer_blind" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "spouse_blind" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tax_returns" ADD COLUMN "total_non_refundable_applied" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "capital_transactions" ADD COLUMN "quantity" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "capital_transactions" ADD COLUMN "account" text;--> statement-breakpoint
ALTER TABLE "schedule_k1_data" ADD COLUMN "box4_guaranteed_payments" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "schedule_k1_data" ADD COLUMN "is_sstb" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "disclosure_consents" ADD CONSTRAINT "disclosure_consents_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "disclosure_consents_lookup_idx" ON "disclosure_consents" USING btree ("client_id","scope");--> statement-breakpoint
CREATE INDEX "clients_updated_at_idx" ON "clients" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "clients_email_idx" ON "clients" USING btree ("email");--> statement-breakpoint
CREATE INDEX "tax_returns_agi_idx" ON "tax_returns" USING btree ("adjusted_gross_income");