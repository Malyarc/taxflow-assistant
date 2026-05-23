/**
 * Deterministic corpus generator. Given a seed and per-kind counts, produces
 * an array of CorpusEntry { id, kind, truth } with realistic synthetic data.
 *
 * The default distribution targets ~100 entries weighted toward the form
 * types a CPA actually sees most often.
 */

import {
  SeededRng, EMPLOYER_NAMES, PAYER_NAMES, STATES,
  makeEin, makeSSN, makeRecipientTin,
} from "./rng.js";
import type {
  CorpusEntry, FormKind,
  W2Fields, F1099NEC, F1099MISC, F1099INT, F1099DIV,
  F1099B, F1099R, F1099G, F1099K,
} from "./types.js";

export interface CorpusCounts {
  w2: number;
  nec: number;
  int: number;
  div: number;
  b: number;
  misc: number;
  r: number;
  g: number;
  k: number;
}

export const DEFAULT_COUNTS: CorpusCounts = {
  w2: 25,
  nec: 15,
  int: 15,
  div: 15,
  b: 10,
  misc: 10,
  r: 5,
  g: 3,
  k: 2,
};

// ── Truth generators ────────────────────────────────────────────────────────

function makeW2(rng: SeededRng): W2Fields {
  const wages = rng.money(28000, 220000);
  const stateCode = rng.pick(STATES);
  return {
    employerName: rng.pick(EMPLOYER_NAMES),
    employerEin: makeEin(rng),
    employeeSSN: makeSSN(rng),
    wagesBox1: wages,
    federalTaxWithheldBox2: Math.round(wages * rng.float(0.10, 0.20) * 100) / 100,
    // SS wages capped at $168,600 (2024 SS wage base)
    socialSecurityWagesBox3: Math.min(wages, 168600),
    socialSecurityTaxBox4: Math.round(Math.min(wages, 168600) * 0.062 * 100) / 100,
    medicareWagesBox5: wages,
    medicareTaxBox6: Math.round(wages * 0.0145 * 100) / 100,
    stateWagesBox16: wages,
    stateTaxWithheldBox17: Math.round(wages * rng.float(0.03, 0.07) * 100) / 100,
    stateCode,
  };
}

function makeCommon(rng: SeededRng): {
  payerName: string; payerTin: string; recipientTin: string;
  federalTaxWithheld: number; stateTaxWithheld: number; stateCode: string;
} {
  return {
    payerName: rng.pick(PAYER_NAMES),
    payerTin: makeEin(rng),
    recipientTin: makeRecipientTin(rng),
    federalTaxWithheld: rng.next() < 0.6 ? 0 : rng.money(50, 1200),
    stateTaxWithheld: rng.next() < 0.7 ? 0 : rng.money(20, 600),
    stateCode: rng.pick(STATES),
  };
}

function makeNEC(rng: SeededRng): F1099NEC {
  return {
    formType: "nec",
    ...makeCommon(rng),
    nonemployeeCompensation: rng.money(800, 75000),
  };
}

function makeMISC(rng: SeededRng): F1099MISC {
  // Most 1099-MISCs have exactly one nonzero box (rents, royalties, or other).
  const c = makeCommon(rng);
  const box = rng.int(0, 2);
  return {
    formType: "misc",
    ...c,
    rents: box === 0 ? rng.money(3600, 36000) : undefined,
    royalties: box === 1 ? rng.money(100, 8000) : undefined,
    otherIncome: box === 2 ? rng.money(300, 12000) : undefined,
    fishingBoatProceeds: undefined,
    medicalAndHealthcare: undefined,
  };
}

function makeINT(rng: SeededRng): F1099INT {
  return {
    formType: "int",
    ...makeCommon(rng),
    interestIncome: rng.money(5, 5000),
    earlyWithdrawalPenalty: rng.next() < 0.1 ? rng.money(10, 200) : undefined,
    usTreasuryInterest: rng.next() < 0.2 ? rng.money(10, 2000) : undefined,
    taxExemptInterest: rng.next() < 0.15 ? rng.money(10, 4000) : undefined,
  };
}

function makeDIV(rng: SeededRng): F1099DIV {
  const ord = rng.money(50, 8000);
  return {
    formType: "div",
    ...makeCommon(rng),
    ordinaryDividends: ord,
    qualifiedDividends: Math.round(ord * rng.float(0.65, 0.95) * 100) / 100,
    totalCapitalGainDistribution: rng.next() < 0.4 ? rng.money(20, 2500) : undefined,
    nondividendDistributions: rng.next() < 0.1 ? rng.money(10, 500) : undefined,
  };
}

function makeB(rng: SeededRng): F1099B {
  const proceeds = rng.money(2000, 250000);
  const costBasis = Math.round(proceeds * rng.float(0.5, 1.4) * 100) / 100;
  const isLT = rng.next() < 0.55;
  const gain = Math.round((proceeds - costBasis) * 100) / 100;
  return {
    formType: "b",
    ...makeCommon(rng),
    proceeds,
    costBasis,
    shortTermGainLoss: isLT ? undefined : gain,
    longTermGainLoss: isLT ? gain : undefined,
  };
}

function makeR(rng: SeededRng): F1099R {
  const gross = rng.money(2500, 120000);
  const taxable = Math.round(gross * rng.float(0.6, 1.0) * 100) / 100;
  return {
    formType: "r",
    ...makeCommon(rng),
    grossDistribution: gross,
    taxableAmount: taxable,
    distributionCode: rng.pick(["1", "2", "4", "7", "G", "B"] as const),
    iraSepSimple: rng.next() < 0.3 ? "X" : undefined,
  };
}

function makeG(rng: SeededRng): F1099G {
  const isUnemployment = rng.next() < 0.6;
  return {
    formType: "g",
    ...makeCommon(rng),
    unemploymentCompensation: isUnemployment ? rng.money(800, 25000) : undefined,
    stateLocalRefund: isUnemployment ? undefined : rng.money(50, 4000),
  };
}

function makeK(rng: SeededRng): F1099K {
  return {
    formType: "k",
    ...makeCommon(rng),
    grossPaymentAmount: rng.money(2500, 180000),
  };
}

// ── Orchestrator ────────────────────────────────────────────────────────────

const KIND_GENERATORS: Record<FormKind, (r: SeededRng) => W2Fields | object> = {
  "w2":       makeW2,
  "1099-nec": makeNEC,
  "1099-misc":makeMISC,
  "1099-int": makeINT,
  "1099-div": makeDIV,
  "1099-b":   makeB,
  "1099-r":   makeR,
  "1099-g":   makeG,
  "1099-k":   makeK,
};

const COUNT_TO_KIND: Array<[keyof CorpusCounts, FormKind]> = [
  ["w2", "w2"], ["nec", "1099-nec"], ["int", "1099-int"], ["div", "1099-div"],
  ["b", "1099-b"], ["misc", "1099-misc"], ["r", "1099-r"], ["g", "1099-g"], ["k", "1099-k"],
];

export function generateCorpus(seed: number, counts: CorpusCounts = DEFAULT_COUNTS): CorpusEntry[] {
  const rng = new SeededRng(seed);
  const out: CorpusEntry[] = [];
  for (const [countKey, kind] of COUNT_TO_KIND) {
    const n = counts[countKey];
    for (let i = 1; i <= n; i++) {
      const gen = KIND_GENERATORS[kind];
      const id = `${kind}-${String(i).padStart(3, "0")}`;
      out.push({ id, kind, truth: gen(rng) as Record<string, unknown> });
    }
  }
  return out;
}

export function corpusTotal(counts: CorpusCounts = DEFAULT_COUNTS): number {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}
