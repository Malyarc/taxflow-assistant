CREATE TABLE "schedule_c_assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"tax_year" integer NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"recovery_years" integer DEFAULT 5 NOT NULL,
	"placed_in_service_year" integer NOT NULL,
	"placed_in_service_quarter" integer,
	"section_179" boolean DEFAULT false NOT NULL,
	"bonus" boolean DEFAULT false NOT NULL,
	"bonus_full_obbba" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "schedule_c_assets" ADD CONSTRAINT "schedule_c_assets_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "schedule_c_assets_client_year_idx" ON "schedule_c_assets" USING btree ("client_id","tax_year");