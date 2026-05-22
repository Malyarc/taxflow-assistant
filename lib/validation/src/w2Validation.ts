/**
 * W-2 sanity checks. Generates "flags" — warnings the CPA should review.
 *
 * These are NOT extraction errors per se (Gemini doesn't return confidence
 * scores in OpenAI-compat mode). Instead, we detect inconsistencies a human
 * would catch: SSN mismatch with client's other records, year mismatch,
 * implausible dollar amounts, mismatched wage boxes, etc.
 *
 * Shared between server (route /clients/:id/w2data/flags) and frontend
 * (ReviewExtractionModal — live flags as the CPA edits values).
 */

export type W2FlagSeverity = "error" | "warning" | "info";

export interface W2Flag {
  /** Field the flag applies to, or null for record-level. */
  field: string | null;
  severity: W2FlagSeverity;
  message: string;
}

export interface W2DataLike {
  taxYear?: number | null;
  employerName?: string | null;
  employerEin?: string | null;
  employeeSSN?: string | null;
  wagesBox1?: number | string | null;
  federalTaxWithheldBox2?: number | string | null;
  socialSecurityWagesBox3?: number | string | null;
  socialSecurityTaxBox4?: number | string | null;
  medicareWagesBox5?: number | string | null;
  medicareTaxBox6?: number | string | null;
  stateTaxWithheldBox17?: number | string | null;
  stateWagesBox16?: number | string | null;
  stateCode?: string | null;
}

export interface ValidationContext {
  /** Client's expected tax year (from client.taxYear) */
  clientTaxYear?: number;
  /** Client's expected state of residence */
  clientState?: string;
  /** SSNs from previously-extracted W-2s (we expect them all to match) */
  knownSsns?: Array<string | null | undefined>;
}

// Per-year Social Security wage base, used to detect over-cap Box 3.
const SS_WAGE_BASE_BY_YEAR: Record<number, number> = {
  2023: 160200,
  2024: 168600,
  2025: 176100,
};
const SS_TAX_RATE = 0.062;
const MEDICARE_TAX_RATE = 0.0145;
/** Additional Medicare tax kicks in on wages above this threshold (per W-2 — actual liability is at filing). */
const ADDITIONAL_MEDICARE_THRESHOLD = 200000;
const ADDITIONAL_MEDICARE_RATE = 0.009;

function num(v: number | string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function digits(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "");
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

export function validateW2(rec: W2DataLike, ctx: ValidationContext = {}): W2Flag[] {
  const flags: W2Flag[] = [];

  // ── Year mismatch ────────────────────────────────────────────
  if (ctx.clientTaxYear != null && rec.taxYear != null && rec.taxYear !== ctx.clientTaxYear) {
    flags.push({
      field: "taxYear",
      severity: "warning",
      message: `W-2 tax year (${rec.taxYear}) doesn't match client's tax year (${ctx.clientTaxYear}). The calculator only sums W-2s for the client's current year.`,
    });
  }

  // ── State mismatch ───────────────────────────────────────────
  if (
    ctx.clientState &&
    rec.stateCode &&
    ctx.clientState.toUpperCase() !== rec.stateCode.toUpperCase()
  ) {
    flags.push({
      field: "stateCode",
      severity: "info",
      message: `W-2 state (${rec.stateCode}) differs from client's state (${ctx.clientState}). This can be normal for cross-border employment, but check whether this client owes non-resident state tax.`,
    });
  }

  // ── SSN mismatch with other W-2s for this client ─────────────
  if (ctx.knownSsns && rec.employeeSSN) {
    const thisDigits = digits(rec.employeeSSN);
    if (thisDigits.length >= 4) {
      const thisLast4 = thisDigits.slice(-4);
      for (const other of ctx.knownSsns) {
        const otherDigits = digits(other);
        if (otherDigits.length >= 4 && otherDigits.slice(-4) !== thisLast4) {
          flags.push({
            field: "employeeSSN",
            severity: "error",
            message: `SSN doesn't match another W-2 for this client (last 4: ${thisLast4} vs ${otherDigits.slice(-4)}). Possible mis-attached W-2 — verify.`,
          });
          break;
        }
      }
    }
  }

  // ── EIN format ──────────────────────────────────────────────
  if (rec.employerEin) {
    const einDigits = digits(rec.employerEin);
    if (einDigits.length !== 9) {
      flags.push({
        field: "employerEin",
        severity: "warning",
        message: `EIN should be 9 digits (got ${einDigits.length}). Format: XX-XXXXXXX.`,
      });
    }
  }

  // ── Wage box consistency ────────────────────────────────────
  const box1 = num(rec.wagesBox1);
  const box3 = num(rec.socialSecurityWagesBox3);
  const box5 = num(rec.medicareWagesBox5);

  // Box 5 (Medicare wages) is typically >= Box 1 (Box 5 has no cap, Box 1 reduced by 401(k))
  if (box1 != null && box5 != null && box5 < box1 - 1) {
    flags.push({
      field: "medicareWagesBox5",
      severity: "warning",
      message: `Box 5 (${fmt(box5)}) is less than Box 1 (${fmt(box1)}). Usually Box 5 ≥ Box 1 because Box 1 is reduced by 401(k) and other pre-tax deductions, while Box 5 is not.`,
    });
  }

  // Box 3 = Box 5 when wages are under SS cap; Box 3 capped above cap.
  if (box3 != null && rec.taxYear != null && SS_WAGE_BASE_BY_YEAR[rec.taxYear] != null) {
    const cap = SS_WAGE_BASE_BY_YEAR[rec.taxYear];
    // Box 3 over the legal cap is always an ERROR — IRS caps it at the SS wage base.
    if (box3 > cap + 1) {
      flags.push({
        field: "socialSecurityWagesBox3",
        severity: "error",
        message: `Box 3 (${fmt(box3)}) exceeds the ${rec.taxYear} Social Security wage base (${fmt(cap)}). It should be capped at ${fmt(cap)}.`,
      });
    } else if (box5 != null) {
      // Within the legal range — but Box 3 should still match Box 5 (below cap) or hit the
      // cap exactly (above cap). These are softer "looks wrong" warnings.
      if (box5 <= cap) {
        if (Math.abs(box3 - box5) > 1) {
          flags.push({
            field: "socialSecurityWagesBox3",
            severity: "warning",
            message: `Below the SS wage base (${fmt(cap)}), Box 3 (${fmt(box3)}) should equal Box 5 (${fmt(box5)}).`,
          });
        }
      } else if (Math.abs(box3 - cap) > 1) {
        flags.push({
          field: "socialSecurityWagesBox3",
          severity: "warning",
          message: `Box 5 (${fmt(box5)}) exceeds the ${rec.taxYear} SS wage base (${fmt(cap)}), so Box 3 should be exactly ${fmt(cap)}. Got ${fmt(box3)}.`,
        });
      }
    }
  }

  // ── Withholding consistency ─────────────────────────────────
  // SS tax (Box 4) should be ~6.2% of Box 3
  const box4 = num(rec.socialSecurityTaxBox4);
  if (box3 != null && box4 != null && box3 > 0) {
    const expected = box3 * SS_TAX_RATE;
    const ratio = box4 / box3;
    if (Math.abs(ratio - SS_TAX_RATE) > 0.005) {
      flags.push({
        field: "socialSecurityTaxBox4",
        severity: "warning",
        message: `Box 4 (${fmt(box4)}) should be ~6.2% of Box 3 (${fmt(box3)}). Expected ~${fmt(expected)}; got ${fmt(box4)} (${(ratio * 100).toFixed(2)}%).`,
      });
    }
  }

  // Medicare tax (Box 6) should be ~1.45% of Box 5 (or 2.35% on excess over $200k)
  const box6 = num(rec.medicareTaxBox6);
  if (box5 != null && box6 != null && box5 > 0) {
    const baseExpected = Math.min(box5, ADDITIONAL_MEDICARE_THRESHOLD) * MEDICARE_TAX_RATE;
    const additionalExpected =
      Math.max(0, box5 - ADDITIONAL_MEDICARE_THRESHOLD) * (MEDICARE_TAX_RATE + ADDITIONAL_MEDICARE_RATE);
    const expected = baseExpected + additionalExpected;
    if (Math.abs(box6 - expected) > Math.max(5, expected * 0.05)) {
      flags.push({
        field: "medicareTaxBox6",
        severity: "warning",
        message: `Box 6 (${fmt(box6)}) doesn't match expected Medicare tax (${fmt(expected)}). Standard rate is 1.45%, plus 0.9% additional Medicare tax above ${fmt(ADDITIONAL_MEDICARE_THRESHOLD)}.`,
      });
    }
  }

  // ── State wage check: Box 16 typically equals Box 1 for single-state employees ──
  const box16 = num(rec.stateWagesBox16);
  if (
    box1 != null &&
    box16 != null &&
    box1 > 0 &&
    rec.stateCode &&
    Math.abs(box16 - box1) > Math.max(50, box1 * 0.01)
  ) {
    flags.push({
      field: "stateWagesBox16",
      severity: "info",
      message: `Box 16 (${fmt(box16)}) differs from Box 1 (${fmt(box1)}). This is normal for multi-state employees or states with different conformity (PA, NJ etc.), but verify the split is intentional.`,
    });
  }

  // ── State withholding plausibility ─────────────────────────
  const box17 = num(rec.stateTaxWithheldBox17);
  if (box16 != null && box17 != null && box16 > 0) {
    const ratio = box17 / box16;
    if (ratio > 0.15) {
      flags.push({
        field: "stateTaxWithheldBox17",
        severity: "warning",
        message: `State withholding is ${(ratio * 100).toFixed(1)}% of Box 16 — unusually high for any US state. Verify Box 17 is correct.`,
      });
    }
  }

  // ── Federal withholding plausibility ───────────────────────
  const box2 = num(rec.federalTaxWithheldBox2);
  if (box1 != null && box2 != null && box1 > 0) {
    const ratio = box2 / box1;
    if (ratio > 0.5) {
      flags.push({
        field: "federalTaxWithheldBox2",
        severity: "warning",
        message: `Federal withholding is ${(ratio * 100).toFixed(1)}% of wages — unusually high. Verify Box 2 is correct.`,
      });
    } else if (ratio < 0.02 && box1 > 30000) {
      flags.push({
        field: "federalTaxWithheldBox2",
        severity: "info",
        message: `Federal withholding is only ${(ratio * 100).toFixed(1)}% of wages on a ${fmt(box1)} W-2 — unusually low. Client may owe at filing.`,
      });
    }
  }

  return flags;
}
