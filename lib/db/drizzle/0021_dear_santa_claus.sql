ALTER TABLE "w2_data" ADD COLUMN "dependent_care_benefits_box10" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "w2_data" ADD COLUMN "box12_codes" jsonb;--> statement-breakpoint
ALTER TABLE "w2_data" ADD COLUMN "retirement_plan_box13" boolean;--> statement-breakpoint
ALTER TABLE "w2_data" ADD COLUMN "local_wages_box18" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "w2_data" ADD COLUMN "local_tax_box19" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "w2_data" ADD COLUMN "locality_name_box20" text;--> statement-breakpoint
ALTER TABLE "adjustments" ADD COLUMN "tax_year" integer;