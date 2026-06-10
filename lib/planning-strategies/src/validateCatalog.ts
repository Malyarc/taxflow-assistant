import type { PlanningStrategy, PlanningStrategyCatalog, StrategyCategory } from "./types";

const KNOWN_CATEGORIES: ReadonlySet<StrategyCategory> = new Set<StrategyCategory>([
  "retirement",
  "state",
  "charitable",
  "timing",
  "business",
  "investment",
  "credits",
  "estate",
]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const STRATEGY_ID = /^G\d+\.\d+$/;

function assertString(obj: unknown, field: string, ctx: string): asserts obj is string {
  if (typeof obj !== "string" || obj.length === 0) {
    throw new Error(`planning-strategies: ${ctx}.${field} must be a non-empty string`);
  }
}

function assertNumber(obj: unknown, field: string, ctx: string): asserts obj is number {
  if (typeof obj !== "number" || !Number.isFinite(obj)) {
    throw new Error(`planning-strategies: ${ctx}.${field} must be a finite number`);
  }
}

function assertBoolean(obj: unknown, field: string, ctx: string): asserts obj is boolean {
  if (typeof obj !== "boolean") {
    throw new Error(`planning-strategies: ${ctx}.${field} must be a boolean`);
  }
}

function assertStringArray(obj: unknown, field: string, ctx: string): asserts obj is string[] {
  if (!Array.isArray(obj)) {
    throw new Error(`planning-strategies: ${ctx}.${field} must be an array`);
  }
  for (let i = 0; i < obj.length; i++) {
    const v = obj[i];
    if (typeof v !== "string" || v.length === 0) {
      throw new Error(`planning-strategies: ${ctx}.${field}[${i}] must be a non-empty string`);
    }
  }
}

function validateStrategy(s: unknown, idx: number): PlanningStrategy {
  if (typeof s !== "object" || s === null) {
    throw new Error(`planning-strategies: strategies[${idx}] is not an object`);
  }
  const raw = s as Record<string, unknown>;
  const ctx = `strategies[${idx}]`;
  assertString(raw.id, "id", ctx);
  if (!STRATEGY_ID.test(raw.id)) {
    throw new Error(`planning-strategies: ${ctx}.id must match /^G\\d+\\.\\d+$/ (got "${raw.id}")`);
  }
  assertString(raw.name, "name", ctx);
  assertString(raw.category, "category", ctx);
  if (!KNOWN_CATEGORIES.has(raw.category as StrategyCategory)) {
    throw new Error(
      `planning-strategies: ${ctx}.category "${raw.category}" not in ${[...KNOWN_CATEGORIES].join(", ")}`,
    );
  }
  assertString(raw.ircSection, "ircSection", ctx);
  assertString(raw.irsPub, "irsPub", ctx);
  assertString(raw.trigger, "trigger", ctx);
  assertString(raw.formula, "formula", ctx);
  assertNumber(raw.confidence, "confidence", ctx);
  if (raw.confidence < 0 || raw.confidence > 1) {
    throw new Error(`planning-strategies: ${ctx}.confidence must be in [0, 1] (got ${raw.confidence})`);
  }
  assertNumber(raw.cpaEffortHours, "cpaEffortHours", ctx);
  if (raw.cpaEffortHours <= 0) {
    throw new Error(`planning-strategies: ${ctx}.cpaEffortHours must be > 0`);
  }
  assertBoolean(raw.recurring, "recurring", ctx);
  assertString(raw.validUntil, "validUntil", ctx);
  if (!ISO_DATE.test(raw.validUntil)) {
    throw new Error(`planning-strategies: ${ctx}.validUntil must be YYYY-MM-DD (got "${raw.validUntil}")`);
  }
  assertStringArray(raw.prerequisiteData, "prerequisiteData", ctx);
  assertString(raw.action, "action", ctx);
  assertNumber(raw.formulaRev, "formulaRev", ctx);
  if (!Number.isInteger(raw.formulaRev) || raw.formulaRev < 1) {
    throw new Error(`planning-strategies: ${ctx}.formulaRev must be a positive integer`);
  }
  return raw as unknown as PlanningStrategy;
}

/**
 * Validate the raw JSON catalog at startup. Throws with a precise message
 * naming the offending field so a malformed catalog never silently
 * propagates to the detection engine.
 */
export function validateCatalog(raw: unknown): PlanningStrategyCatalog {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("planning-strategies: catalog root is not an object");
  }
  const obj = raw as Record<string, unknown>;
  assertString(obj.version, "version", "catalog");
  assertString(obj.reviewedAt, "reviewedAt", "catalog");
  if (!ISO_DATE.test(obj.reviewedAt)) {
    throw new Error(`planning-strategies: catalog.reviewedAt must be YYYY-MM-DD`);
  }
  if (!Array.isArray(obj.strategies)) {
    throw new Error("planning-strategies: catalog.strategies must be an array");
  }
  const strategies = obj.strategies.map(validateStrategy);
  const ids = new Set<string>();
  for (const s of strategies) {
    if (ids.has(s.id)) {
      throw new Error(`planning-strategies: duplicate strategy id "${s.id}"`);
    }
    ids.add(s.id);
  }
  return { version: obj.version, reviewedAt: obj.reviewedAt, strategies };
}
