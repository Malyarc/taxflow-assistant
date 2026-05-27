import rawCatalog from "./strategies-v1.json" with { type: "json" };
import { validateCatalog } from "./validateCatalog";

export type { PlanningStrategy, PlanningStrategyCatalog, OpportunityHit, StrategyCategory, WhatIfDelta } from "./types";
export { validateCatalog } from "./validateCatalog";

/**
 * The validated, in-memory strategy catalog (v1). Validation runs at module
 * load — a malformed catalog throws here, which fail-fasts the api-server
 * before it accepts traffic.
 */
export const CATALOG_V1 = validateCatalog(rawCatalog);
