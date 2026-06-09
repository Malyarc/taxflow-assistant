ALTER TABLE "tax_returns" ADD COLUMN "state_individual_mandate_penalty" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "tax_returns" ADD COLUMN "unrecaptured_section_1250_gain" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "tax_returns" ADD COLUMN "collectibles_28_rate_gain" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "tax_returns" ADD COLUMN "household_employment_tax" numeric(14, 2) DEFAULT '0' NOT NULL;