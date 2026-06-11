#!/usr/bin/env python3
"""Differential-oracle runner — evaluates a batch of scenarios through
tenforty (the OpenTaxSolver wrapper) and emits JSON results.

Part of the T0.3 A0/A2 differential-oracle layer. The TS harness
(tax-engine-differential-oracle-harness.ts) generates the shared scenario
space, runs computeTaxReturnPure on each, invokes this runner once for the
oracle side, and compares with documented tolerances.

Input  (argv[1]): JSON file — [{id, year, filingStatus, state?, w2, interest,
                  ordinaryDividends, qualifiedDividends, stcg, ltcg, se}]
Output (stdout):  JSON — [{id, ok, error?, agi, taxable, incomeTax, amt,
                  seTax, niit, addlMedicare, totalTax, stateTaxable, stateTax}]

Filing-status mapping (ours -> OTS):
  single -> Single · married_filing_jointly -> Married/Joint
  married_filing_separately -> Married/Sep · head_of_household -> Head_of_House
  qualifying_surviving_spouse -> Widow(er)
"""

import json
import sys

import tenforty

STATUS_MAP = {
    "single": "Single",
    "married_filing_jointly": "Married/Joint",
    "married_filing_separately": "Married/Sep",
    "head_of_household": "Head_of_House",
    "qualifying_widow": "Widow(er)",
}


def main() -> None:
    with open(sys.argv[1]) as f:
        scenarios = json.load(f)
    out = []
    for s in scenarios:
        try:
            r = tenforty.evaluate_return(
                year=s["year"],
                state=s.get("state"),
                filing_status=STATUS_MAP[s["filingStatus"]],
                w2_income=s.get("w2", 0),
                taxable_interest=s.get("interest", 0),
                ordinary_dividends=s.get("ordinaryDividends", 0),
                qualified_dividends=s.get("qualifiedDividends", 0),
                short_term_capital_gains=s.get("stcg", 0),
                long_term_capital_gains=s.get("ltcg", 0),
                self_employment_income=s.get("se", 0),
            )
            out.append(
                {
                    "id": s["id"],
                    "ok": True,
                    "agi": r.federal_adjusted_gross_income,
                    "taxable": r.federal_taxable_income,
                    "incomeTax": r.federal_income_tax,
                    "amt": r.federal_amt,
                    "seTax": r.federal_se_tax,
                    "niit": r.federal_niit,
                    "addlMedicare": r.federal_additional_medicare_tax,
                    "totalTax": r.federal_total_tax,
                    "stateTaxable": r.state_taxable_income,
                    "stateTax": r.state_total_tax,
                }
            )
        except Exception as e:  # noqa: BLE001 — per-scenario isolation
            out.append({"id": s["id"], "ok": False, "error": str(e)})
    json.dump(out, sys.stdout)


if __name__ == "__main__":
    main()
