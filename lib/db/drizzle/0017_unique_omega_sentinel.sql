ALTER TABLE "schedule_c_assets" ADD COLUMN "is_passenger_auto" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "schedule_c_assets" ADD COLUMN "business_use_pct" numeric(5, 4);--> statement-breakpoint
ALTER TABLE "schedule_c_assets" ADD COLUMN "gvwr_over_6000" boolean DEFAULT false NOT NULL;