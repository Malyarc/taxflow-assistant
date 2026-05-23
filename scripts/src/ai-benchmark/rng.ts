/**
 * Deterministic seeded RNG so the synthetic corpus is reproducible.
 * Mulberry32 — small, decent distribution, no deps.
 */
export class SeededRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Float in [0, 1). */
  next(): number {
    let t = (this.state += 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [lo, hi] inclusive. */
  int(lo: number, hi: number): number {
    return Math.floor(this.next() * (hi - lo + 1)) + lo;
  }

  /** Float in [lo, hi). */
  float(lo: number, hi: number): number {
    return this.next() * (hi - lo) + lo;
  }

  /** Currency value rounded to cents. */
  money(lo: number, hi: number): number {
    return Math.round(this.float(lo, hi) * 100) / 100;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.int(0, arr.length - 1)];
  }
}

// ── Realistic sample data --------------------------------------------------

export const EMPLOYER_NAMES = [
  "Acme Logistics Inc",
  "Riverside Healthcare LLC",
  "Brookhaven Consulting Group",
  "Westpark Technical Services",
  "Coastline Manufacturing Co",
  "Summit Engineering Partners",
  "Pinnacle Retail Holdings",
  "Harbor Financial Services",
  "Northstar Software Inc",
  "Greenfield Construction LLC",
] as const;

export const PAYER_NAMES = [
  "First Federal Bank N.A.",
  "Capital One Financial",
  "Charles Schwab & Co",
  "Vanguard Brokerage Services",
  "Fidelity Investments",
  "Morgan Stanley Wealth Mgmt",
  "JPMorgan Chase Bank",
  "Wells Fargo Advisors",
  "TD Ameritrade",
  "E*TRADE Securities LLC",
  "PayPal Holdings Inc",
  "Stripe Payments Co",
  "Etsy Marketplace",
] as const;

export const STATES = [
  "CA", "NY", "TX", "FL", "IL", "PA", "OH", "GA", "NC", "MI",
  "NJ", "VA", "WA", "AZ", "MA", "TN", "IN", "MO", "MD", "CO",
] as const;

/** Format an EIN as XX-XXXXXXX. */
export function makeEin(rng: SeededRng): string {
  const a = String(rng.int(10, 99));
  const b = String(rng.int(1000000, 9999999));
  return `${a}-${b}`;
}

/** Last-4-only SSN as XXX-XX-1234 (the typical print on tax forms). */
export function makeSSN(rng: SeededRng): string {
  return `XXX-XX-${String(rng.int(1000, 9999))}`;
}

export function makeRecipientTin(rng: SeededRng): string {
  return `XXX-XX-${String(rng.int(1000, 9999))}`;
}
