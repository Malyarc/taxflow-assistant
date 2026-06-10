/**
 * T2.1 — Form 4952: Investment Interest Expense Deduction (§163(d)).
 *
 * Substitute-form workpaper (Pub 1167 conventions). The engine caps investment
 * interest at net investment income (interest + non-qualified dividends + net
 * STCG + royalties), with the §163(d)(4)(B) election to treat QDIV/LTCG as
 * ordinary investment income (raising the cap at the cost of preferential
 * rates), and carries the disallowed excess forward indefinitely.
 *
 * Exposed engine fields:
 *   investmentInterestDeduction      — allowed this year (Form 4952 line 8)
 *   investmentInterestDisallowed     — carryforward to next year (line 7)
 *   investmentInterestElectionAmount — §163(d)(4)(B) elected QDIV/LTCG (line 4g)
 *
 * Applicable when any of the three is nonzero.
 */

import {
  checkLine,
  moneyLine,
  nz,
  type FormBuildContext,
  type FormInstance,
  type FormLine,
} from "./formSpec";

export function buildForm4952(ctx: FormBuildContext): FormInstance | null {
  const { ret } = ctx;
  const allowed = ret.investmentInterestDeduction;
  const disallowed = ret.investmentInterestDisallowed;
  const election = ret.investmentInterestElectionAmount;
  if (!nz(allowed) && !nz(disallowed) && !nz(election)) return null;

  const totalInterest = allowed + disallowed;
  // When the cap binds (disallowed > 0), allowed == NII + election, so NII is
  // exactly recoverable. Otherwise NII >= total interest and is not separately
  // exposed by the engine.
  const capBinds = disallowed > 0.005;
  const nii = capBinds ? allowed - election : null;

  const lines: FormLine[] = [];
  // Part I — total investment interest expense.
  lines.push(
    moneyLine("1", "Investment interest expense paid/accrued this year", totalInterest, {
      note: "Allowed this year + disallowed carryforward.",
    }),
  );
  lines.push(moneyLine("3", "Total investment interest expense", totalInterest));

  // Part II — net investment income.
  if (nii != null) {
    lines.push(
      moneyLine("4a", "Net investment income (interest + non-qual div + net STCG + royalties)", nii, {
        note: "Recovered exactly because the cap binds (allowed = NII + elected amount).",
      }),
    );
  } else {
    lines.push(
      moneyLine("4a", "Net investment income", null, {
        note: "Not separately exposed: the cap does not bind, so NII ≥ the full investment interest (the whole amount is allowed).",
      }),
    );
  }
  if (nz(election)) {
    lines.push(
      moneyLine("4g", "Qualified dividends + net LTCG elected as ordinary (§163(d)(4)(B))", election, {
        note: "Elected into investment income to raise the cap — these amounts FORFEIT the 0/15/20% preferential rate.",
      }),
    );
  }

  // Part III — deduction + carryforward.
  lines.push(
    moneyLine("7", "Disallowed investment interest — carryforward to next year", disallowed, {
      note: "Carries forward indefinitely (§163(d)(2)).",
    }),
  );
  lines.push(
    moneyLine("8", "Investment interest expense deduction (to Schedule A line 9)", allowed, { emphasis: true }),
  );
  lines.push(
    checkLine("Allowed + disallowed = total investment interest", allowed + disallowed, totalInterest),
  );

  return {
    formId: "form-4952",
    formNumber: "Form 4952",
    title: "Investment Interest Expense Deduction",
    subtitle: "§163(d) — capped at net investment income; excess carries forward.",
    taxYear: ret.taxYear,
    parts: [{ lines }],
    footnotes: [
      "The allowed deduction flows to Schedule A line 9 (itemized). A standard-deduction filer gets no current benefit, but the disallowed amount still carries forward.",
      "The §163(d)(4)(B) election (line 4g) trades the 0/15/20% preferential rate on the elected QDIV/LTCG for a higher investment-interest cap — the engine has already re-bucketed the elected amount to ordinary rates.",
      "Line 4a net investment income is shown only when the cap binds (it is then exactly recoverable); otherwise the full interest is allowed and NII is not separately needed.",
    ],
  };
}
