CREATE TABLE "clients" (
	"id" serial PRIMARY KEY NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"filing_status" text DEFAULT 'single' NOT NULL,
	"state" text NOT NULL,
	"tax_year" integer NOT NULL,
	"dependents_under_17" integer DEFAULT 0 NOT NULL,
	"other_dependents" integer DEFAULT 0 NOT NULL,
	"dependents_for_care_credit" integer DEFAULT 0 NOT NULL,
	"taxpayer_age" integer,
	"spouse_age" integer,
	"spouse_earned_income" numeric(12, 2),
	"hsa_is_family_coverage" boolean DEFAULT false NOT NULL,
	"ira_covered_by_workplace_plan" boolean DEFAULT false NOT NULL,
	"eligible_educator_count" integer DEFAULT 0 NOT NULL,
	"aca_annual_premium" numeric(12, 2),
	"aca_annual_slcsp" numeric(12, 2),
	"aca_advance_aptc" numeric(12, 2),
	"aca_household_size" integer,
	"rental_active_participant" boolean DEFAULT true NOT NULL,
	"rental_real_estate_professional" boolean DEFAULT false NOT NULL,
	"locality_code" text,
	"social_security_benefits" numeric(12, 2),
	"mfs_lived_apart_all_year" boolean DEFAULT false NOT NULL,
	"is_kiddie_tax_filer" boolean DEFAULT false NOT NULL,
	"parents_top_marginal_rate" numeric(5, 4),
	"prior_year_itemized" boolean,
	"residency_changed_in_year" boolean DEFAULT false NOT NULL,
	"former_state" text,
	"residency_change_date" text,
	"risk_tolerance" text,
	"target_retirement_age" integer,
	"estate_plan_stage" text,
	"planning_goals" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"document_type" text DEFAULT 'w2' NOT NULL,
	"file_name" text NOT NULL,
	"file_content" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"extracted_text" text,
	"linked_record_id" integer,
	"linked_record_type" text,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "w2_data" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"document_id" integer,
	"tax_year" integer NOT NULL,
	"employer_name" text,
	"employer_ein" text,
	"employee_ssn" text,
	"wages_box1" numeric(12, 2),
	"federal_tax_withheld_box2" numeric(12, 2),
	"social_security_wages_box3" numeric(12, 2),
	"social_security_tax_box4" numeric(12, 2),
	"medicare_wages_box5" numeric(12, 2),
	"medicare_tax_box6" numeric(12, 2),
	"state_tax_withheld_box17" numeric(12, 2),
	"state_wages_box16" numeric(12, 2),
	"state_code" text,
	"spouse" text DEFAULT 'taxpayer' NOT NULL,
	"field_boxes" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_1099_data" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"document_id" integer,
	"tax_year" integer NOT NULL,
	"form_type" text NOT NULL,
	"payer_name" text,
	"payer_tin" text,
	"recipient_tin" text,
	"federal_tax_withheld" numeric(12, 2),
	"state_tax_withheld" numeric(12, 2),
	"state_code" text,
	"nonemployee_compensation" numeric(12, 2),
	"rents" numeric(12, 2),
	"royalties" numeric(12, 2),
	"other_income" numeric(12, 2),
	"fishing_boat_proceeds" numeric(12, 2),
	"medical_and_healthcare" numeric(12, 2),
	"interest_income" numeric(12, 2),
	"early_withdrawal_penalty" numeric(12, 2),
	"us_treasury_interest" numeric(12, 2),
	"tax_exempt_interest" numeric(12, 2),
	"ordinary_dividends" numeric(12, 2),
	"qualified_dividends" numeric(12, 2),
	"total_capital_gain_distribution" numeric(12, 2),
	"nondividend_distributions" numeric(12, 2),
	"proceeds" numeric(12, 2),
	"cost_basis" numeric(12, 2),
	"short_term_gain_loss" numeric(12, 2),
	"long_term_gain_loss" numeric(12, 2),
	"gross_distribution" numeric(12, 2),
	"taxable_amount" numeric(12, 2),
	"distribution_code" text,
	"ira_sep_simple" text,
	"unemployment_compensation" numeric(12, 2),
	"state_local_refund" numeric(12, 2),
	"gross_payment_amount" numeric(12, 2),
	"field_boxes" jsonb,
	"spouse" text DEFAULT 'taxpayer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_returns" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"tax_year" integer NOT NULL,
	"filing_status" text,
	"total_income" numeric(12, 2),
	"adjusted_gross_income" numeric(12, 2),
	"standard_deduction" numeric(12, 2),
	"itemized_deductions" numeric(12, 2),
	"taxable_income" numeric(12, 2),
	"federal_tax_liability" numeric(12, 2),
	"federal_tax_withheld" numeric(12, 2),
	"federal_refund_or_owed" numeric(12, 2),
	"state_tax_liability" numeric(12, 2),
	"state_tax_withheld" numeric(12, 2),
	"state_refund_or_owed" numeric(12, 2),
	"effective_tax_rate" numeric(6, 4),
	"self_employment_tax" numeric(12, 2),
	"qbi_deduction" numeric(12, 2),
	"amt_tax" numeric(12, 2),
	"niit_tax" numeric(12, 2),
	"additional_medicare_tax" numeric(12, 2),
	"additional_child_tax_credit" numeric(12, 2),
	"capital_gains_tax" numeric(12, 2),
	"preferential_income" numeric(12, 2),
	"medical_deductible" numeric(12, 2),
	"salt_deductible" numeric(12, 2),
	"mortgage_deductible" numeric(12, 2),
	"charitable_deductible" numeric(12, 2),
	"hsa_deduction" numeric(12, 2),
	"ira_deduction" numeric(12, 2),
	"sehi_deduction" numeric(12, 2),
	"home_sale_gross_gain" numeric(14, 2),
	"home_sale_section_121_exclusion" numeric(14, 2),
	"home_sale_taxable_gain" numeric(14, 2),
	"social_security_benefits" numeric(12, 2),
	"social_security_taxable" numeric(12, 2),
	"feie_total_exclusion" numeric(12, 2),
	"nol_deduction" numeric(14, 2),
	"nol_carryforward_remaining" numeric(14, 2),
	"amt_credit_carryforward_remaining" numeric(14, 2),
	"amt_credit_applied" numeric(14, 2),
	"amt_credit_generated" numeric(14, 2),
	"charitable_carryforward_cash_remaining" numeric(14, 2),
	"qsbs_gross_gain" numeric(14, 2),
	"qsbs_section_1202_exclusion" numeric(14, 2),
	"qsbs_taxable_gain" numeric(14, 2),
	"eitc" numeric(12, 2),
	"aoc_credit" numeric(12, 2),
	"aoc_refundable_portion" numeric(12, 2),
	"llc_credit" numeric(12, 2),
	"savers_credit" numeric(12, 2),
	"dependent_care_credit" numeric(12, 2),
	"schedule_c_expenses" numeric(12, 2),
	"educator_expenses_deduction" numeric(12, 2),
	"student_loan_interest_deduction" numeric(12, 2),
	"foreign_tax_credit" numeric(12, 2),
	"residential_energy_credits" numeric(12, 2),
	"premium_tax_credit" numeric(12, 2),
	"capital_loss_deducted" numeric(12, 2),
	"capital_loss_carryforward_short" numeric(12, 2),
	"capital_loss_carryforward_long" numeric(12, 2),
	"net_capital_gain_loss" numeric(12, 2),
	"state_retirement_exemption" numeric(12, 2),
	"schedule_e_rental_gross_net" numeric(12, 2),
	"schedule_e_rental_applied_to_agi" numeric(12, 2),
	"schedule_e_pal_allowance" numeric(12, 2),
	"schedule_e_passive_loss_suspended" numeric(12, 2),
	"k1_passive_loss_suspended" numeric(12, 2),
	"local_tax_liability" numeric(12, 2),
	"local_tax_jurisdiction" text,
	"wash_sales_detected" integer DEFAULT 0 NOT NULL,
	"wash_sale_loss_disallowed" numeric(14, 2) DEFAULT '0' NOT NULL,
	"former_state_tax" numeric(14, 2) DEFAULT '0' NOT NULL,
	"former_state_code" text,
	"days_former_state_resident" integer DEFAULT 0 NOT NULL,
	"days_current_state_resident" integer DEFAULT 0 NOT NULL,
	"section_1031_realized_gain" numeric(14, 2) DEFAULT '0' NOT NULL,
	"section_1031_boot_received" numeric(14, 2) DEFAULT '0' NOT NULL,
	"section_1031_recognized_gain" numeric(14, 2) DEFAULT '0' NOT NULL,
	"section_1031_deferred_gain" numeric(14, 2) DEFAULT '0' NOT NULL,
	"iso_disqualifying_disposition_ordinary" numeric(14, 2) DEFAULT '0' NOT NULL,
	"espp_disqualifying_disposition_ordinary" numeric(14, 2) DEFAULT '0' NOT NULL,
	"section_163j_business_interest_expense" numeric(14, 2) DEFAULT '0' NOT NULL,
	"section_163j_allowed_deduction" numeric(14, 2) DEFAULT '0' NOT NULL,
	"section_163j_disallowed_carryforward" numeric(14, 2) DEFAULT '0' NOT NULL,
	"section_461l_excess_loss_addback" numeric(14, 2) DEFAULT '0' NOT NULL,
	"original_snapshot" jsonb,
	"amendment_explanation" text,
	"amendment_locked_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_returns_client_year_unique" UNIQUE("client_id","tax_year")
);
--> statement-breakpoint
CREATE TABLE "adjustments" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"adjustment_type" text DEFAULT 'deduction' NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"description" text NOT NULL,
	"category" text,
	"is_applied" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer,
	"actor_user_id" integer,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer NOT NULL,
	"before_json" jsonb,
	"after_json" jsonb,
	"source" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rental_properties" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"tax_year" integer NOT NULL,
	"address" text NOT NULL,
	"property_type" text DEFAULT 'residential' NOT NULL,
	"basis" numeric(14, 2),
	"placed_in_service_year" integer,
	"placed_in_service_month" integer,
	"fair_rental_days" integer,
	"personal_use_days" integer,
	"is_active_participant" boolean DEFAULT true NOT NULL,
	"rental_income" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total_expenses" numeric(14, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capital_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"tax_year" integer NOT NULL,
	"description" text NOT NULL,
	"date_acquired" text,
	"date_sold" text,
	"proceeds" numeric(14, 2) DEFAULT '0' NOT NULL,
	"cost_basis" numeric(14, 2) DEFAULT '0' NOT NULL,
	"adjustment_code" text,
	"adjustment_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"wash_sale_disallowed" numeric(14, 2) DEFAULT '0' NOT NULL,
	"wash_sale_auto_detected" boolean DEFAULT false NOT NULL,
	"form_box" text DEFAULT 'A' NOT NULL,
	"is_covered" boolean DEFAULT true NOT NULL,
	"received_1099b" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_k1_data" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"tax_year" integer NOT NULL,
	"entity_name" text NOT NULL,
	"entity_ein" text,
	"entity_type" text DEFAULT 'partnership' NOT NULL,
	"activity_type" text DEFAULT 'active' NOT NULL,
	"box1_ordinary_income" numeric(14, 2) DEFAULT '0' NOT NULL,
	"box2_rental_real_estate" numeric(14, 2) DEFAULT '0' NOT NULL,
	"box3_other_rental_income" numeric(14, 2) DEFAULT '0' NOT NULL,
	"interest_income" numeric(14, 2) DEFAULT '0' NOT NULL,
	"ordinary_dividends" numeric(14, 2) DEFAULT '0' NOT NULL,
	"qualified_dividends" numeric(14, 2) DEFAULT '0' NOT NULL,
	"royalties" numeric(14, 2) DEFAULT '0' NOT NULL,
	"net_short_term_capital_gain" numeric(14, 2) DEFAULT '0' NOT NULL,
	"net_long_term_capital_gain" numeric(14, 2) DEFAULT '0' NOT NULL,
	"self_employment_earnings" numeric(14, 2) DEFAULT '0' NOT NULL,
	"section_199a_qbi" numeric(14, 2) DEFAULT '0' NOT NULL,
	"section_199a_w2_wages" numeric(14, 2) DEFAULT '0' NOT NULL,
	"section_199a_ubia" numeric(14, 2) DEFAULT '0' NOT NULL,
	"basis_at_year_start" numeric(14, 2),
	"basis_at_year_end" numeric(14, 2),
	"at_risk_amount" numeric(14, 2),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_asset_balances" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"tax_year" integer NOT NULL,
	"asset_type" text NOT NULL,
	"account_name" text NOT NULL,
	"balance" numeric(16, 2) DEFAULT '0' NOT NULL,
	"cost_basis" numeric(16, 2),
	"after_tax_basis" numeric(16, 2),
	"nua_eligible" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tax_documents" ADD CONSTRAINT "tax_documents_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "w2_data" ADD CONSTRAINT "w2_data_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "w2_data" ADD CONSTRAINT "w2_data_document_id_tax_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."tax_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_1099_data" ADD CONSTRAINT "form_1099_data_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_1099_data" ADD CONSTRAINT "form_1099_data_document_id_tax_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."tax_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_returns" ADD CONSTRAINT "tax_returns_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustments" ADD CONSTRAINT "adjustments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_properties" ADD CONSTRAINT "rental_properties_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capital_transactions" ADD CONSTRAINT "capital_transactions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_k1_data" ADD CONSTRAINT "schedule_k1_data_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_asset_balances" ADD CONSTRAINT "client_asset_balances_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tax_documents_client_id_idx" ON "tax_documents" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "tax_documents_client_status_idx" ON "tax_documents" USING btree ("client_id","status");--> statement-breakpoint
CREATE INDEX "w2_data_client_year_idx" ON "w2_data" USING btree ("client_id","tax_year");--> statement-breakpoint
CREATE INDEX "w2_data_document_id_idx" ON "w2_data" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "form_1099_data_client_year_idx" ON "form_1099_data" USING btree ("client_id","tax_year");--> statement-breakpoint
CREATE INDEX "form_1099_data_document_id_idx" ON "form_1099_data" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "tax_returns_client_year_idx" ON "tax_returns" USING btree ("client_id","tax_year");--> statement-breakpoint
CREATE INDEX "adjustments_client_id_idx" ON "adjustments" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "audit_log_client_created_idx" ON "audit_log" USING btree ("client_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "rental_properties_client_year_idx" ON "rental_properties" USING btree ("client_id","tax_year");--> statement-breakpoint
CREATE INDEX "capital_transactions_client_year_idx" ON "capital_transactions" USING btree ("client_id","tax_year");--> statement-breakpoint
CREATE INDEX "schedule_k1_data_client_year_idx" ON "schedule_k1_data" USING btree ("client_id","tax_year");--> statement-breakpoint
CREATE INDEX "client_asset_balances_client_year_idx" ON "client_asset_balances" USING btree ("client_id","tax_year");