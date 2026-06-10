/**
 * Runs every standalone (no-API) tax-engine test suite in scripts/src and
 * prints an aggregate pass/fail summary. Suites that require a live API at
 * localhost:8080 are excluded (see NEEDS_API). Exit code is non-zero if any
 * suite fails or errors — suitable for CI.
 *
 * Pass/fail is determined by each suite's PROCESS EXIT CODE (the one reliable
 * signal — suites use several different summary-line formats). Assertion
 * counts are best-effort parsed for reporting only.
 *
 * Usage: pnpm --filter @workspace/scripts run test:no-api
 */
import { readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const srcDir = dirname(fileURLToPath(import.meta.url));
const scriptsDir = join(srcDir, "..");

// Suites that require a live API at localhost:8080 (+ Postgres) — excluded.
const NEEDS_API = new Set<string>([
  "tax-engine-integration-tests.ts",
  "tax-engine-deep-integration-tests.ts",
  "tax-engine-new-features-tests.ts",
  "tax-engine-phase1-integration-tests.ts",
  "tax-engine-phase15-integration-tests.ts",
  "tax-engine-exports-tests.ts",
  "tax-engine-ai-overlay-tests.ts",
  "tax-engine-rental-properties-tests.ts",
  "tax-engine-capital-transactions-tests.ts",
  "tax-engine-k1-integration-tests.ts",
  "tax-engine-planning-integration-tests.ts",
  "tax-engine-pro-tier-tests.ts",
  "tax-engine-schedule-c-assets-integration-tests.ts",
  "tax-engine-sch1-surface-integration-tests.ts",
  "tax-engine-workpapers-integration-tests.ts",
]);

const suites = readdirSync(srcDir)
  .filter((f) => (/^tax-engine-.*tests\.ts$/.test(f) || /^security-.*tests\.ts$/.test(f)) && !NEEDS_API.has(f))
  .sort();

/** Best-effort assertion-count parse across the suites' varied summary formats. */
function parseCounts(out: string): { passed: number; failed: number } | null {
  let m = out.match(/RESULTS:\s*(\d+)\s*passed,\s*(\d+)\s*failed/i);
  if (m) return { passed: Number(m[1]), failed: Number(m[2]) };
  m = out.match(/\bPASS(?:ED)?:\s*(\d+)/i);
  if (m) {
    const f = out.match(/\bFAIL(?:ED)?:\s*(\d+)/i);
    return { passed: Number(m[1]), failed: f ? Number(f[1]) : 0 };
  }
  return null;
}

let totalPass = 0;
let totalFail = 0;
let countedSuites = 0;
const failedSuites: string[] = [];

for (const f of suites) {
  let out = "";
  let errored = false;
  try {
    out = execFileSync("pnpm", ["exec", "tsx", join("src", f)], {
      cwd: scriptsDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    errored = true;
    const err = e as { stdout?: string; stderr?: string };
    out = (err.stdout ?? "") + (err.stderr ?? "");
  }
  const counts = parseCounts(out);
  if (counts) {
    totalPass += counts.passed;
    totalFail += counts.failed;
    countedSuites++;
  }
  // Exit code is authoritative; a parsed failure count is a secondary guard.
  const bad = errored || (counts != null && counts.failed > 0);
  if (bad) failedSuites.push(f);
  const countStr = counts ? `${counts.passed} passed, ${counts.failed} failed` : "exit 0, count n/a";
  console.log(`${bad ? "FAIL" : "ok  "}  ${f}  (${countStr})`);
}

console.log("\n========================================");
console.log(
  `SUITES: ${suites.length} (${countedSuites} reported counts)  |  parsed assertions: ${totalPass} passed, ${totalFail} failed`,
);
if (failedSuites.length) {
  console.log(`FAILED (${failedSuites.length}): ${failedSuites.join(", ")}`);
  process.exit(1);
}
console.log("ALL NO-API SUITES GREEN");
