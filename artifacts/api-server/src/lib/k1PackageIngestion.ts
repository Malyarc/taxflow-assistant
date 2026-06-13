/**
 * G-6 — K-1 PACKAGE INGESTION (pure, Haven-portable)
 * ============================================================================
 *
 * HNW returns carry multi-page Schedule K-1 packages: the federal K-1 (1065 or
 * 1120-S) boxes, a wad of footnotes (§199A statement, §163(j) info, state
 * detail), and one or more per-state K-1 schedules. The LIVE product OCRs the
 * PDF and an LLM extracts the boxes/footnotes/state-schedules into a structured
 * shape. THIS module does NOT do any of that — it maps an ALREADY-EXTRACTED
 * structured package (`RawK1Package`) into the engine's `ScheduleK1Fact` shape
 * (plus per-state facts), which `computeTaxReturnPure` already consumes.
 *
 * ── OCR / LLM SEAM ──────────────────────────────────────────────────────────
 * The OCR + extraction step is a ROUTE/ADAPTER concern, not part of this pure
 * module. The expected wiring:
 *
 *   route handler                         this module (pure)
 *   ─────────────────────────────────     ──────────────────────────────────
 *   POST /clients/:clientId/k1-package
 *     PDF bytes ──► OCR (Textract/…) ──►   RawK1Package  ──► ingestK1Package ──►
 *     ──► LLM box/footnote extraction          (structured)        IngestedK1
 *                                                                  { fact, stateFacts, warnings }
 *                                          ──► persist K-1 row(s) + adjustments
 *
 * Keeping the boundary here means the math/mapping is unit-testable with NO OCR,
 * NO LLM, NO network, NO DB — and ports 1:1 into Haven. This file therefore has
 * NO `Date`, NO `Math.random`, NO fs/network/DB, and NO OCR/LLM.
 *
 * ── BOX → ScheduleK1Fact FIELD MAPPING ──────────────────────────────────────
 * `boxes` is keyed by the K-1's printed box label (string), so the same map
 * covers both the 1065 and 1120-S layouts where their box numbers diverge.
 *
 *   entityKind "1065"  → entityType "partnership"
 *   entityKind "1120S" → entityType "s_corp"
 *   activity           → activityType ("active" default; "passive" honored)
 *
 *   ORDINARY / RENTAL
 *     "1"               → box1OrdinaryIncome         (ordinary business income)
 *     "2"               → box2RentalRealEstate       (net rental real estate)
 *     "3"               → box3OtherRentalIncome      (other rental income)
 *     "4" / "4A"        → box4GuaranteedPayments     (1065 §707(c) ONLY; ignored
 *                                                      with a warning for 1120-S
 *                                                      — S-corps have no GP)
 *   PORTFOLIO
 *     1065  "5"  / 1120S "4"   → interestIncome
 *     1065  "6a" / 1120S "5a"  → ordinaryDividends
 *     1065  "6b" / 1120S "5b"  → qualifiedDividends  (subset of ordinary — the
 *                                                      engine nets 6a−6b itself,
 *                                                      so we pass both raw)
 *     1065  "7"  / 1120S "6"   → royalties
 *     1065  "8"  / 1120S "7"   → netShortTermCapitalGain
 *     1065  "9a" / 1120S "8a"  → netLongTermCapitalGain
 *   SE (1065 only)
 *     "14A"             → selfEmploymentEarnings      (Box 14 code A; engine takes
 *                                                      max(14A, Box 4) for SE base)
 *   §199A (Box 20 code Z on 1065 / Box 17 code V on 1120-S — usually a STATEMENT,
 *          so we also read it from footnotes)
 *     "20Z_qbi"  / "17V_qbi"   → section199aQbi
 *     "20Z_w2"   / "17V_w2"    → section199aW2Wages
 *     "20Z_ubia" / "17V_ubia"  → section199aUbia
 *     "20Z_sstb" / "17V_sstb"  → isSstb (any truthy/≠0 value flags SSTB)
 *   BASIS / AT-RISK (from the partner's/shareholder's basis worksheet)
 *     "basis_begin"     → basisAtYearStart
 *     "basis_end"       → basisAtYearEnd
 *     "at_risk"         → atRiskAmount
 *     1065 "19" / 1120S "16D"  → distributions
 *     "sep_ded"         → separatelyStatedDeductions
 *
 * Footnotes (`RawK1Footnote[]`) supplement the boxes for §199A + SSTB when the
 * §199A figures are reported as a statement rather than inline (the common HNW
 * case). A footnote NEVER overrides a non-zero box value — boxes win; footnotes
 * fill the gaps. Recognized footnote codes (case-insensitive):
 *   "199A_QBI" / "QBI"          → section199aQbi
 *   "199A_W2"  / "W2_WAGES"     → section199aW2Wages
 *   "199A_UBIA"/ "UBIA"         → section199aUbia
 *   "SSTB"                      → isSstb = true (presence flags it; amount≥0 ok)
 * Unrecognized footnotes are preserved as warnings so the CPA can review them.
 *
 * ── MULTI-STATE / PER-STATE K-1 SOURCING ────────────────────────────────────
 * Each `RawK1StateSchedule` becomes a `stateFacts` entry. The engine's REAL
 * sourcing mechanism (confirmed in taxReturnEngine.ts): the K-1's `sourceState`
 * field + the `nonresident_source_allocation` adjustment marker (for a FULL-YEAR
 * resident) source the K-1's Box 1 ordinary + Box 2/3 rental real estate to that
 * state (4 U.S.C. §114 — intangibles are never sourced). The fact emitted here
 * carries `sourceState` set to the FIRST (primary) state schedule's state, so a
 * single mapped K-1 feeds that mechanism directly. When a package spans MULTIPLE
 * states, the additional `stateFacts` entries are returned for the route to fan
 * out (e.g. persist a per-state allocation / one K-1 row per state) — this pure
 * mapper does not split one K-1 into many facts, it surfaces the data + a
 * warning. The route is expected to add the `nonresident_source_allocation`
 * adjustment when it persists a non-resident-sourced K-1.
 *
 * ── CONSERVATISM ────────────────────────────────────────────────────────────
 * Never invent numbers. A box not present in `boxes` maps to `undefined` (the
 * engine treats it as 0 / not-tracked). §199A W-2 wages absent while QBI present
 * → a warning (the wage/UBIA limit cannot be applied). isSstb is only set true
 * on an explicit signal; otherwise left null (engine default = non-SSTB).
 */

import type { ScheduleK1Fact } from "./taxReturnEngine";

// ── Raw (already-extracted) package shapes ───────────────────────────────────

/** One per-state K-1 schedule line as extracted from the package. */
export interface RawK1StateSchedule {
  /** 2-letter state code (e.g. "NY", "CA"). */
  state: string;
  /** State-sourced ordinary business income (the state's Box 1 analogue). */
  ordinaryIncome?: number;
  /** State-sourced net rental real-estate income. */
  rentalIncome?: number;
  /** Apportionment percentage for the state (0–100), if the schedule reports one. */
  apportionmentPct?: number;
  /** Free-text note from the state schedule (preserved for the CPA). */
  note?: string;
}

/** A K-1 footnote / supplemental statement line. */
export interface RawK1Footnote {
  /** Footnote code, e.g. "199A_QBI", "199A_W2", "SSTB", "163J". */
  code: string;
  description: string;
  /** Dollar amount, when the footnote carries one. */
  amount?: number;
}

/** One ALREADY-EXTRACTED Schedule K-1 (1065 or 1120-S). */
export interface RawK1Package {
  taxYear: number;
  entityName: string;
  entityKind: "1065" | "1120S";
  /** Holder-level activity classification. Defaults to "active" when omitted. */
  activity?: "active" | "passive";
  /** MFJ per-spouse attribution tag (engine `spouse` field equivalent). */
  spouse?: "taxpayer" | "spouse";
  /**
   * Extracted boxes keyed by printed label, e.g.
   *   { "1": 50000, "14A": 50000, "6a": 1200, "6b": 1000, "20Z_qbi": 50000 }
   * Unknown keys are ignored (a warning is emitted).
   */
  boxes: Record<string, number>;
  footnotes?: RawK1Footnote[];
  stateSchedules?: RawK1StateSchedule[];
}

/** Result of mapping ONE raw package. */
export interface IngestedK1 {
  fact: ScheduleK1Fact;
  stateFacts: Array<{
    state: string;
    ordinaryIncome: number;
    rentalIncome: number;
    apportionmentPct: number | null;
  }>;
  warnings: string[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const isFiniteNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/**
 * Read the first box label present in `boxes` from a candidate list (so the
 * 1065 / 1120-S divergent labels share one call site). Returns `undefined` when
 * none of the candidates are present (engine reads that as "not supplied").
 */
function box(
  boxes: Record<string, number>,
  ...keys: string[]
): number | undefined {
  for (const k of keys) {
    const v = boxes[k];
    if (isFiniteNum(v)) return v;
  }
  return undefined;
}

/** Case-insensitive footnote lookup by any of the given codes. */
function footnote(
  footnotes: RawK1Footnote[] | undefined,
  ...codes: string[]
): RawK1Footnote | undefined {
  if (!footnotes) return undefined;
  const want = codes.map((c) => c.toUpperCase());
  return footnotes.find((f) => want.includes((f.code ?? "").trim().toUpperCase()));
}

const KNOWN_FOOTNOTE_CODES = new Set([
  "199A_QBI",
  "QBI",
  "199A_W2",
  "W2_WAGES",
  "199A_UBIA",
  "UBIA",
  "SSTB",
]);

// ── Core mapping ──────────────────────────────────────────────────────────────

/**
 * Map ONE already-extracted `RawK1Package` into a `ScheduleK1Fact` (+ per-state
 * facts + warnings). Pure; never invents numbers.
 */
export function ingestK1Package(pkg: RawK1Package): IngestedK1 {
  const warnings: string[] = [];
  const boxes = pkg.boxes ?? {};
  const isPartnership = pkg.entityKind === "1065";
  const entityType: ScheduleK1Fact["entityType"] = isPartnership ? "partnership" : "s_corp";
  const activityType: ScheduleK1Fact["activityType"] = pkg.activity ?? "active";

  if (!Number.isInteger(pkg.taxYear) || pkg.taxYear < 2000) {
    warnings.push(`Implausible taxYear ${String(pkg.taxYear)} — verify the extracted year.`);
  }

  // ── Ordinary / rental ──────────────────────────────────────────────────────
  const box1OrdinaryIncome = box(boxes, "1");
  const box2RentalRealEstate = box(boxes, "2");
  const box3OtherRentalIncome = box(boxes, "3");

  // Box 4 guaranteed payments — 1065 ONLY (§707(c)). S-corps have no GP.
  let box4GuaranteedPayments = box(boxes, "4", "4A");
  if (!isPartnership && box4GuaranteedPayments != null && box4GuaranteedPayments !== 0) {
    warnings.push(
      "Box 4 guaranteed payments present on an 1120-S K-1 — S corporations have no guaranteed payments; value dropped (verify the extraction).",
    );
    box4GuaranteedPayments = undefined;
  }

  // ── Portfolio (divergent labels: 1065 5/6a/6b/7/8/9a vs 1120-S 4/5a/5b/6/7/8a) ─
  const interestIncome = isPartnership ? box(boxes, "5") : box(boxes, "4");
  const ordinaryDividends = isPartnership ? box(boxes, "6a") : box(boxes, "5a");
  const qualifiedDividends = isPartnership ? box(boxes, "6b") : box(boxes, "5b");
  const royalties = isPartnership ? box(boxes, "7") : box(boxes, "6");
  const netShortTermCapitalGain = isPartnership ? box(boxes, "8") : box(boxes, "7");
  const netLongTermCapitalGain = isPartnership ? box(boxes, "9a") : box(boxes, "8a");

  // §6b/5b qualified is a SUBSET of §6a/5a ordinary (engine nets 6a−6b itself).
  if (
    isFiniteNum(qualifiedDividends) &&
    isFiniteNum(ordinaryDividends) &&
    qualifiedDividends > ordinaryDividends
  ) {
    warnings.push(
      "Qualified dividends exceed ordinary dividends — qualified is a subset of ordinary; verify the extraction.",
    );
  }

  // ── SE earnings (1065 Box 14 code A only) ───────────────────────────────────
  let selfEmploymentEarnings = box(boxes, "14A");
  if (!isPartnership && selfEmploymentEarnings != null && selfEmploymentEarnings !== 0) {
    warnings.push(
      "Box 14A self-employment earnings present on an 1120-S K-1 — S-corp shareholder distributive share is not SE income; value dropped.",
    );
    selfEmploymentEarnings = undefined;
  }

  // ── §199A (Box 20 Z / 17 V — inline box OR footnote statement) ──────────────
  const qbiKey = isPartnership ? "20Z_qbi" : "17V_qbi";
  const w2Key = isPartnership ? "20Z_w2" : "17V_w2";
  const ubiaKey = isPartnership ? "20Z_ubia" : "17V_ubia";
  const sstbKey = isPartnership ? "20Z_sstb" : "17V_sstb";

  // Box wins; footnote fills the gap.
  const qbiBox = box(boxes, qbiKey);
  const qbiFoot = footnote(pkg.footnotes, "199A_QBI", "QBI");
  const section199aQbi = qbiBox != null ? qbiBox : qbiFoot?.amount;

  const w2Box = box(boxes, w2Key);
  const w2Foot = footnote(pkg.footnotes, "199A_W2", "W2_WAGES");
  const section199aW2Wages = w2Box != null ? w2Box : w2Foot?.amount;

  const ubiaBox = box(boxes, ubiaKey);
  const ubiaFoot = footnote(pkg.footnotes, "199A_UBIA", "UBIA");
  const section199aUbia = ubiaBox != null ? ubiaBox : ubiaFoot?.amount;

  // SSTB — explicit signal only (box flag value ≠ 0, OR an SSTB footnote present).
  const sstbBox = box(boxes, sstbKey);
  const sstbFoot = footnote(pkg.footnotes, "SSTB");
  let isSstb: boolean | null = null;
  if (sstbBox != null) isSstb = sstbBox !== 0;
  else if (sstbFoot != null) isSstb = true;

  // §199A completeness warnings (never block — be conservative).
  const hasQbi = isFiniteNum(section199aQbi) && section199aQbi > 0;
  if (hasQbi && !isFiniteNum(section199aW2Wages)) {
    warnings.push(
      "Box 20 code Z / 17 code V §199A QBI present but no §199A W-2 wages — the wage/UBIA limit cannot be applied (engine treats wages as $0).",
    );
  }
  if (isSstb === null && hasQbi) {
    warnings.push(
      "§199A QBI present but no SSTB flag found — defaulting to non-SSTB; confirm whether this is a specified service trade or business.",
    );
  }

  // ── Basis / at-risk / distributions ─────────────────────────────────────────
  const basisAtYearStart = box(boxes, "basis_begin");
  const basisAtYearEnd = box(boxes, "basis_end");
  const atRiskAmount = box(boxes, "at_risk");
  const distributions = isPartnership ? box(boxes, "19", "distributions") : box(boxes, "16D", "distributions");
  const separatelyStatedDeductions = box(boxes, "sep_ded");

  // ── Per-state schedules ─────────────────────────────────────────────────────
  const stateFacts = (pkg.stateSchedules ?? []).map((s) => {
    const code = (s.state ?? "").trim().toUpperCase();
    if (!code) {
      warnings.push("State schedule with a blank state code was skipped.");
    }
    if (s.apportionmentPct != null && (s.apportionmentPct < 0 || s.apportionmentPct > 100)) {
      warnings.push(
        `State ${code || "?"} apportionment ${s.apportionmentPct}% is outside 0–100 — verify the extraction.`,
      );
    }
    if (s.note && s.note.trim().length > 0) {
      warnings.push(`State ${code || "?"} schedule note: ${s.note.trim()}`);
    }
    return {
      state: code,
      ordinaryIncome: isFiniteNum(s.ordinaryIncome) ? s.ordinaryIncome : 0,
      rentalIncome: isFiniteNum(s.rentalIncome) ? s.rentalIncome : 0,
      apportionmentPct: isFiniteNum(s.apportionmentPct) ? s.apportionmentPct : null,
    };
  });
  const validStateFacts = stateFacts.filter((s) => s.state.length > 0);

  // The K-1's sourceState feeds the engine's `nonresident_source_allocation`
  // mechanism (a full-year resident's out-of-state Box 1 + Box 2/3 are sourced
  // to this state). Use the FIRST state schedule as the primary source state;
  // surface a warning when the package spans multiple states so the route can
  // fan them out (one K-1 row / allocation per state).
  let sourceState: string | null = null;
  if (validStateFacts.length > 0) {
    sourceState = validStateFacts[0].state;
    if (validStateFacts.length > 1) {
      warnings.push(
        `K-1 package spans ${validStateFacts.length} states (${validStateFacts
          .map((s) => s.state)
          .join(", ")}); the mapped fact carries the primary source state "${sourceState}". The route should fan out the remaining state facts (one allocation per state) and add a nonresident_source_allocation adjustment.`,
      );
    }
  }

  // ── Unknown footnotes → review warnings ─────────────────────────────────────
  for (const f of pkg.footnotes ?? []) {
    const code = (f.code ?? "").trim().toUpperCase();
    if (!KNOWN_FOOTNOTE_CODES.has(code)) {
      warnings.push(
        `Unmapped footnote "${f.code}"${f.amount != null ? ` ($${f.amount})` : ""}: ${f.description} — review (e.g. §163(j), §179, foreign-tax detail are CPA-entered separately).`,
      );
    }
  }

  // ── Assemble the fact (omit undefined boxes — engine reads them as 0) ────────
  const fact: ScheduleK1Fact = {
    taxYear: pkg.taxYear,
    entityName: pkg.entityName ?? null,
    entityType,
    activityType,
    box1OrdinaryIncome,
    box2RentalRealEstate,
    box3OtherRentalIncome,
    box4GuaranteedPayments,
    interestIncome,
    ordinaryDividends,
    qualifiedDividends,
    royalties,
    netShortTermCapitalGain,
    netLongTermCapitalGain,
    selfEmploymentEarnings,
    section199aQbi,
    section199aW2Wages,
    section199aUbia,
    isSstb,
    basisAtYearStart,
    basisAtYearEnd,
    atRiskAmount,
    distributions,
    separatelyStatedDeductions,
    sourceState,
  };

  return { fact, stateFacts: validStateFacts, warnings };
}

/**
 * Batch helper — map many packages at once. Returns the flat `facts` array
 * (ready to drop into `TaxReturnInputs.scheduleK1`), the per-package `ingested`
 * detail, and a flattened `warnings` list (each prefixed with the entity name).
 */
export function ingestK1Packages(pkgs: RawK1Package[]): {
  facts: ScheduleK1Fact[];
  ingested: IngestedK1[];
  warnings: string[];
} {
  const ingested = (pkgs ?? []).map((p) => ingestK1Package(p));
  const facts = ingested.map((i) => i.fact);
  const warnings = ingested.flatMap((i, idx) =>
    i.warnings.map((w) => `[${pkgs[idx]?.entityName ?? `K-1 #${idx + 1}`}] ${w}`),
  );
  return { facts, ingested, warnings };
}
