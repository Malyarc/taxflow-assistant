CREATE TABLE "disclosure_ledger_checkpoint" (
	"id" integer PRIMARY KEY NOT NULL,
	"entry_count" integer NOT NULL,
	"head_hash" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disclosure_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer,
	"action" text NOT NULL,
	"recipient" text NOT NULL,
	"purpose" text NOT NULL,
	"scope" text NOT NULL,
	"actor" text NOT NULL,
	"occurred_at" text NOT NULL,
	"prev_hash" text NOT NULL,
	"entry_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "disclosure_ledger_client_idx" ON "disclosure_ledger" USING btree ("client_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "disclosure_ledger_entry_hash_idx" ON "disclosure_ledger" USING btree ("entry_hash");