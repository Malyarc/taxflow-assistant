/**
 * Export formula-injection neutralization (T0.2 C4, 2026-06-22 audit).
 *
 * OWASP CSV/formula injection (CWE-1236): a client name/email beginning with
 * `= + - @` (or a leading tab / CR) executes as a FORMULA when a CPA opens or
 * imports the export into Excel / Google Sheets / LibreOffice. The CSV builder
 * already neutralized this; the TXT (.gen) and JSON builders did NOT. This pins
 * the now-shared `neutralizeFormula()` guard across ALL THREE export formats.
 *
 * Pure: imports the export builders + the pure engine; no API/DB required.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-export-sanitization-tests.ts
 */
import {
  buildTaxReturnCsvExport,
  buildTaxReturnJsonExport,
  buildTaxReturnSummaryText,
  neutralizeFormula,
} from "../../artifacts/api-server/src/lib/taxReturnExports";
import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";

const PASS: string[] = [];
const FAIL: string[] = [];

function eq(label: string, actual: unknown, expected: unknown): void {
  if (actual === expected) PASS.push(`OK ${label}`);
  else FAIL.push(`FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function truthy(label: string, cond: boolean): void {
  if (cond) PASS.push(`OK ${label}`);
  else FAIL.push(`FAIL ${label}: expected true`);
}

// ── neutralizeFormula() unit cases ──────────────────────────────────────────
// A leading formula char on NON-numeric text is prefixed with a single quote;
// genuine (incl. negative/decimal) numbers are left untouched so the value
// column stays numeric.
eq("neutralize =cmd", neutralizeFormula("=cmd()"), "'=cmd()");
eq("neutralize +SUM", neutralizeFormula("+SUM(A1)"), "'+SUM(A1)");
eq("neutralize @import", neutralizeFormula("@SUM(A1)"), "'@SUM(A1)");
eq("neutralize -1+2 (formula, not a number)", neutralizeFormula("-1+2"), "'-1+2");
eq("neutralize leading TAB", neutralizeFormula("\t=evil"), "'\t=evil");
eq("neutralize leading CR", neutralizeFormula("\r=evil"), "'\r=evil");
eq("plain text untouched", neutralizeFormula("Smith"), "Smith");
eq("positive number untouched", neutralizeFormula("123.45"), "123.45");
eq("negative number untouched", neutralizeFormula("-1"), "-1");
eq("negative decimal untouched", neutralizeFormula("-1234.50"), "-1234.50");
eq("numeric input (number type) untouched", neutralizeFormula(-5), "-5");
eq("empty string untouched", neutralizeFormula(""), "");

// ── End-to-end across all three export formats ──────────────────────────────
// A real engine result + a client whose every free-text field is a formula.
const inputs: TaxReturnInputs = {
  client: { filingStatus: "single", state: "FL", taxYear: 2024 },
  w2s: [{ taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 5000, stateCode: "FL" }],
  form1099s: [],
  adjustments: [],
  taxYear: 2024,
};
const ret = computeTaxReturnPure(inputs);

const evilClient = {
  firstName: "=cmd()",
  lastName: "+SUM(A1)",
  email: "@evil.com",
  filingStatus: "single",
  state: "FL",
  taxYear: 2024,
  dependentsUnder17: 0,
  otherDependents: 0,
};

// CSV — the builder concatenates first+last into one "# Client:" cell, so the
// CELL is neutralized at its leading char (the only position Excel evaluates as
// a formula). The mid-cell "+SUM(A1)" is inert. Email is its own cell.
const csv = buildTaxReturnCsvExport(evilClient, ret);
truthy("CSV neutralizes the client-name cell at its start", csv.includes("# Client: '=cmd() +SUM(A1)"));
truthy("CSV neutralizes the email cell", csv.includes("# Email: '@evil.com"));
truthy("CSV has no raw un-neutralized email cell", !csv.includes("# Email: @evil.com"));

// TXT (.gen key=value) — value side must be neutralized.
const txt = buildTaxReturnSummaryText(evilClient, ret);
truthy("TXT neutralizes first name", txt.includes("CLIENT_FIRST_NAME='=cmd()"));
truthy("TXT neutralizes last name", txt.includes("CLIENT_LAST_NAME='+SUM(A1)"));
truthy("TXT neutralizes email", txt.includes("CLIENT_EMAIL='@evil.com"));
truthy("TXT has no raw 'CLIENT_FIRST_NAME==cmd'", !txt.includes("CLIENT_FIRST_NAME==cmd"));

// JSON — parse and assert the stored client display strings are neutralized,
// and the document remains valid JSON.
const json = buildTaxReturnJsonExport(evilClient, ret);
const parsed = JSON.parse(json) as { client: { firstName: string; lastName: string; email: string } };
eq("JSON neutralizes first name", parsed.client.firstName, "'=cmd()");
eq("JSON neutralizes last name", parsed.client.lastName, "'+SUM(A1)");
eq("JSON neutralizes email", parsed.client.email, "'@evil.com");

// A benign client is byte-for-byte unchanged in the display fields (no
// over-escaping / regression).
const goodClient = {
  firstName: "Jane",
  lastName: "Smith",
  email: "jane@example.com",
  filingStatus: "single",
  state: "FL",
  taxYear: 2024,
  dependentsUnder17: 0,
  otherDependents: 0,
};
const goodJson = JSON.parse(buildTaxReturnJsonExport(goodClient, ret)) as {
  client: { firstName: string; lastName: string; email: string };
};
eq("benign first name unchanged", goodJson.client.firstName, "Jane");
eq("benign email unchanged", goodJson.client.email, "jane@example.com");
truthy("benign TXT unchanged", buildTaxReturnSummaryText(goodClient, ret).includes("CLIENT_FIRST_NAME=Jane"));

// R3-SEC (security-review) — record forgery via embedded newline in the
// line-oriented .gen/TXT export (CWE-93). A client free-text value containing a
// CR/LF must NOT split into forged KEY=VALUE records; it collapses to one line.
const injClient = { ...goodClient, firstName: "Bob\n1040-L34=9999999.00\nFEDERAL_REFUND_OR_OWED=9999999" };
const injTxt = buildTaxReturnSummaryText(injClient, ret);
truthy("TXT: newline-injected name does NOT forge a standalone 1040-L34 record",
  !injTxt.split("\n").some((ln) => ln.trim() === "1040-L34=9999999.00"));
truthy("TXT: newline-injected name does NOT forge a FEDERAL_REFUND_OR_OWED record",
  !injTxt.split("\n").some((ln) => ln.trim() === "FEDERAL_REFUND_OR_OWED=9999999"));
truthy("TXT: the injected content collapses onto the CLIENT_FIRST_NAME line",
  injTxt.split("\n").some((ln) => ln.startsWith("CLIENT_FIRST_NAME=Bob ")));
// CRLF + leading-formula combo on last name → still one line, only one real STATE= record.
const injClient2 = { ...goodClient, lastName: "=cmd\r\nSTATE=ZZ" };
const injTxt2 = buildTaxReturnSummaryText(injClient2, ret);
truthy("TXT: CRLF-injected last name does NOT forge a second STATE= record",
  injTxt2.split("\n").filter((ln) => ln.startsWith("STATE=")).length === 1);
// Benign hyphen + space preserved (the control-char strip must not eat ' ' or '-').
truthy("TXT: benign hyphen/space name preserved (no over-strip)",
  buildTaxReturnSummaryText({ ...goodClient, firstName: "Mary-Jane Smith" }, ret).includes("CLIENT_FIRST_NAME=Mary-Jane Smith"));

console.log(`\nExport sanitization tests:`);
console.log(`  Passed: ${PASS.length}`);
console.log(`  Failed: ${FAIL.length}`);
if (FAIL.length > 0) {
  FAIL.forEach((f) => console.log(`    ${f}`));
}
console.log(`RESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
process.exit(FAIL.length > 0 ? 1 : 0);
