/**
 * Recompute-planning-scores SWEEP (operational maintenance script).
 *
 * The firm-wide planning hit-list + dashboard Top-10 rank clients by the
 * precomputed `tax_returns.planning_score` (+ `planning_marginal_rate`) columns,
 * written once per return at recalc time (taxReturnPipeline). Those columns go
 * STALE whenever the planning catalog or the scoring/engine logic changes without
 * the return itself being re-saved — e.g. a catalog `validUntil` refresh, a new
 * detector, an OBBBA constant fix. This sweep re-derives the two ranking columns
 * for EVERY persisted return using the exact live scoring path, so the ranking
 * reflects current law immediately.
 *
 * SAFE BY DESIGN: it updates ONLY `planning_score` + `planning_marginal_rate`
 * (a derived ranking metric, never return data). A recompute failure on one row
 * is logged and skipped; the row's financial columns are never touched.
 *
 * Usage:
 *   DATABASE_URL=… pnpm --filter @workspace/scripts exec tsx src/recompute-planning-scores.ts            # apply
 *   DATABASE_URL=… pnpm --filter @workspace/scripts exec tsx src/recompute-planning-scores.ts --dry-run  # preview only
 *
 * Run it after any planning-catalog change (validUntil refresh, new strategy) or
 * any change to planningScore / the detectors / year-indexed engine constants.
 */

import { eq } from "drizzle-orm";
import { db, taxReturnsTable } from "@workspace/db";
import { computeTaxReturn } from "../../artifacts/api-server/src/lib/taxReturnPipeline";
import {
  evaluatePlanningOpportunities,
  planningScore,
  federalMarginalRate,
} from "../../artifacts/api-server/src/lib/planningEngine";

const DRY_RUN = process.argv.includes("--dry-run");

async function main(): Promise<void> {
  const rows = await db
    .select({
      id: taxReturnsTable.id,
      clientId: taxReturnsTable.clientId,
      taxYear: taxReturnsTable.taxYear,
      planningScore: taxReturnsTable.planningScore,
      planningMarginalRate: taxReturnsTable.planningMarginalRate,
    })
    .from(taxReturnsTable);

  console.log(`${DRY_RUN ? "[DRY-RUN] " : ""}Recomputing planning scores for ${rows.length} return(s)…\n`);

  let changed = 0;
  let unchanged = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const computed = await computeTaxReturn(row.clientId, { taxYear: row.taxYear });
      if (!computed) {
        failed++;
        console.warn(`  ! return ${row.id} (client ${row.clientId}, TY${row.taxYear}): client not found — skipped`);
        continue;
      }
      const { client, result, inputs } = computed;
      const hits = evaluatePlanningOpportunities({
        client,
        computed: result,
        adjustments: inputs.adjustments,
      });
      const fedRate = federalMarginalRate(result);
      const newScoreNum = Math.round(planningScore({ hits, federalMarginalRate: fedRate }));
      const newRateNum = fedRate;

      // Compare NUMERICALLY, not by string — the DB stores numeric(_,2)/(_,4) so
      // "12472.00"/"0.1200" must not be treated as different from 12472/0.12. Only
      // a genuine value change is written, so re-running the sweep is a no-op.
      const oldScoreNum = row.planningScore == null ? null : Math.round(Number(row.planningScore));
      const oldRateNum = row.planningMarginalRate == null ? null : Number(row.planningMarginalRate);
      const scoreChanged = oldScoreNum !== newScoreNum;
      const rateChanged = oldRateNum == null || Math.abs(oldRateNum - newRateNum) > 1e-9;

      if (!scoreChanged && !rateChanged) {
        unchanged++;
        continue;
      }

      console.log(
        `  ~ return ${row.id} (client ${row.clientId}, TY${row.taxYear}): ` +
          (scoreChanged ? `score ${oldScoreNum ?? "∅"} → ${newScoreNum}` : `score ${newScoreNum} (unchanged)`) +
          (rateChanged ? `, rate ${oldRateNum ?? "∅"} → ${newRateNum}` : ""),
      );

      if (!DRY_RUN) {
        await db
          .update(taxReturnsTable)
          .set({ planningScore: String(newScoreNum), planningMarginalRate: String(newRateNum) })
          .where(eq(taxReturnsTable.id, row.id));
      }
      changed++;
    } catch (err) {
      failed++;
      console.warn(`  ! return ${row.id} (client ${row.clientId}, TY${row.taxYear}): recompute failed — ${(err as Error).message}`);
    }
  }

  console.log(
    `\n${DRY_RUN ? "[DRY-RUN] " : ""}Done. ${changed} ${DRY_RUN ? "would change" : "updated"}, ${unchanged} unchanged, ${failed} failed.`,
  );
  process.exit(failed > 0 && changed === 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("recompute-planning-scores: fatal", err);
  process.exit(1);
});
