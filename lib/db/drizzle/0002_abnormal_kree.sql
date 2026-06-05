ALTER TABLE "tax_returns" ADD COLUMN "planning_score" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "tax_returns" ADD COLUMN "planning_marginal_rate" numeric(5, 4);--> statement-breakpoint
CREATE INDEX "tax_returns_planning_score_idx" ON "tax_returns" USING btree ("planning_score");