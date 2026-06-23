/**
 * G-9 — Firm benchmarking analytics (T5 GROWTH, 2026-06-22).
 *
 * Turns the firm's book into an anonymized "your book vs. opportunity" report:
 * the effective-tax-rate distribution across clients, an AGI-band histogram, and
 * a strategy-adoption table (how many clients qualify for each planning strategy
 * and the dollars on the table). Reuses the §7216 anonymization ethos of the
 * planning-campaigns tool — the output is COUNTS + $100-rounded aggregate
 * dollars only; no individual client's identity or exact figure is recoverable.
 *
 * PURE + Haven-portable: NO Date / Math.random / DB / network / process. The
 * route loads each client's computed return + planning hits and maps them into
 * FirmBenchmarkClient[]; this module does only deterministic aggregation.
 */

export interface FirmBenchmarkOpportunity {
  strategyId: string;
  name: string;
  category?: string;
  /** Headline savings for the hit (verifiedSavings ?? estSavings), dollars. */
  estSavings: number;
}

export interface FirmBenchmarkClient {
  /** Adjusted gross income (Form 1040 line 11). */
  agi: number;
  /** Engine effective tax rate — a FRACTION (total tax ÷ total income, 0–1). */
  effectiveTaxRate: number;
  /** The planning opportunities that fired for this client (may be empty). */
  opportunities: FirmBenchmarkOpportunity[];
}

export interface RateDistribution {
  /** All values are PERCENTAGES (e.g. 18.4 = 18.4%), rounded to 0.1%. */
  min: number;
  p25: number;
  median: number;
  p75: number;
  p90: number;
  max: number;
  mean: number;
}

export interface AgiBand {
  label: string;
  min: number;
  /** null = no upper bound (top band). */
  max: number | null;
  clientCount: number;
}

export interface StrategyAdoption {
  strategyId: string;
  name: string;
  category?: string;
  /** Number of clients in the cohort for whom this strategy fired. */
  clientsWithOpportunity: number;
  /** clientsWithOpportunity ÷ cohort size, as a percentage rounded to 0.1%. */
  reachPct: number;
  /** Sum of headline savings across the cohort, rounded to the nearest $100. */
  totalEstSavings: number;
  /** Median per-client headline savings, rounded to the nearest $100. */
  medianEstSavings: number;
}

export interface FirmOpportunitySummary {
  /** Firm-wide sum of all opportunity savings, rounded to the nearest $100. */
  totalEstSavings: number;
  clientsWithAnyOpportunity: number;
  /** totalEstSavings ÷ clientsWithAnyOpportunity, rounded to the nearest $100. */
  avgSavingsPerOpportunityClient: number;
}

export interface FirmBenchmarkReport {
  clientCount: number;
  effectiveRatePct: RateDistribution;
  agiBands: AgiBand[];
  strategyAdoption: StrategyAdoption[];
  firmOpportunity: FirmOpportunitySummary;
  assumptions: string[];
}

// Round to the nearest $100 (anonymization boundary), clamped non-negative so an
// aggregate can never surface a single client's exact figure or a sign artifact.
function r100(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(Math.min(n, 1e12) / 100) * 100;
}

// One-decimal percentage round.
function round1(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 10) / 10;
}

/** Nearest-rank percentile on an ascending-sorted array. p in [0,1]. */
function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const rank = Math.ceil(p * sortedAsc.length); // 1-based
  const idx = Math.min(Math.max(rank, 1), sortedAsc.length) - 1;
  return sortedAsc[idx];
}

function median(sortedAsc: number[]): number {
  return percentile(sortedAsc, 0.5);
}

const AGI_BANDS: ReadonlyArray<{ label: string; min: number; max: number | null }> = [
  { label: "Under $50k", min: 0, max: 50_000 },
  { label: "$50k–$100k", min: 50_000, max: 100_000 },
  { label: "$100k–$200k", min: 100_000, max: 200_000 },
  { label: "$200k–$500k", min: 200_000, max: 500_000 },
  { label: "$500k+", min: 500_000, max: null },
];

/** First band whose upper bound the AGI is below (top band catches the rest);
 *  negative/zero AGI falls in the first band. */
function bandIndexFor(agi: number): number {
  for (let i = 0; i < AGI_BANDS.length; i++) {
    const b = AGI_BANDS[i];
    if (b.max == null || agi < b.max) return i;
  }
  return AGI_BANDS.length - 1;
}

export function buildFirmBenchmark(clients: readonly FirmBenchmarkClient[]): FirmBenchmarkReport {
  const clientCount = clients.length;

  // ── Effective-rate distribution (percentages) ─────────────────────────────
  const ratesPct = clients
    .map((c) => (Number.isFinite(c.effectiveTaxRate) ? c.effectiveTaxRate * 100 : 0))
    .sort((a, b) => a - b);
  const meanPct = ratesPct.length > 0 ? ratesPct.reduce((s, v) => s + v, 0) / ratesPct.length : 0;
  const effectiveRatePct: RateDistribution = {
    min: round1(ratesPct[0] ?? 0),
    p25: round1(percentile(ratesPct, 0.25)),
    median: round1(median(ratesPct)),
    p75: round1(percentile(ratesPct, 0.75)),
    p90: round1(percentile(ratesPct, 0.9)),
    max: round1(ratesPct[ratesPct.length - 1] ?? 0),
    mean: round1(meanPct),
  };

  // ── AGI-band histogram ────────────────────────────────────────────────────
  const bandCounts = AGI_BANDS.map(() => 0);
  for (const c of clients) bandCounts[bandIndexFor(c.agi)] += 1;
  const agiBands: AgiBand[] = AGI_BANDS.map((b, i) => ({
    label: b.label,
    min: b.min,
    max: b.max,
    clientCount: bandCounts[i],
  }));

  // ── Strategy adoption (the "opportunity gap" table) ───────────────────────
  // Per strategy: # of distinct clients it fired for + the dollars across them.
  const byStrategy = new Map<
    string,
    { name: string; category?: string; clientCount: number; savings: number[] }
  >();
  let firmSavingsRaw = 0;
  let clientsWithAnyOpportunity = 0;

  for (const c of clients) {
    // Collapse a client's hits to one entry per strategy (sum if a strategy
    // somehow appears twice), so clientCount counts distinct clients.
    const perClient = new Map<string, { name: string; category?: string; savings: number }>();
    for (const o of c.opportunities) {
      const add = Number.isFinite(o.estSavings) ? o.estSavings : 0;
      firmSavingsRaw += add;
      const cur = perClient.get(o.strategyId);
      if (cur) cur.savings += add;
      else perClient.set(o.strategyId, { name: o.name, category: o.category, savings: add });
    }
    if (perClient.size > 0) clientsWithAnyOpportunity += 1;
    for (const [sid, v] of perClient) {
      let agg = byStrategy.get(sid);
      if (!agg) {
        agg = { name: v.name, category: v.category, clientCount: 0, savings: [] };
        byStrategy.set(sid, agg);
      }
      agg.clientCount += 1;
      agg.savings.push(v.savings);
    }
  }

  const strategyAdoption: StrategyAdoption[] = Array.from(byStrategy.entries())
    .map(([strategyId, agg]) => {
      const sorted = [...agg.savings].sort((a, b) => a - b);
      const sumRaw = sorted.reduce((s, v) => s + v, 0);
      const entry: StrategyAdoption = {
        strategyId,
        name: agg.name,
        category: agg.category,
        clientsWithOpportunity: agg.clientCount,
        reachPct: clientCount > 0 ? round1((agg.clientCount / clientCount) * 100) : 0,
        totalEstSavings: r100(sumRaw),
        medianEstSavings: r100(median(sorted)),
      };
      return { entry, sumRaw };
    })
    // Most-reaching first; ties broken by raw dollars then strategyId (stable).
    .sort(
      (a, b) =>
        b.entry.clientsWithOpportunity - a.entry.clientsWithOpportunity ||
        b.sumRaw - a.sumRaw ||
        a.entry.strategyId.localeCompare(b.entry.strategyId),
    )
    .map((x) => x.entry);

  const firmOpportunity: FirmOpportunitySummary = {
    totalEstSavings: r100(firmSavingsRaw),
    clientsWithAnyOpportunity,
    avgSavingsPerOpportunityClient:
      clientsWithAnyOpportunity > 0 ? r100(firmSavingsRaw / clientsWithAnyOpportunity) : 0,
  };

  return {
    clientCount,
    effectiveRatePct,
    agiBands,
    strategyAdoption,
    firmOpportunity,
    assumptions: [
      "Effective tax rate = total tax ÷ total income (engine convention), shown as a percentage.",
      "Percentiles use the nearest-rank method over the client cohort.",
      "Dollar aggregates are rounded to the nearest $100 so no single client's exact figure is recoverable.",
      "Counts reflect the supplied cohort (the firm's top planning-opportunity clients).",
    ],
  };
}
