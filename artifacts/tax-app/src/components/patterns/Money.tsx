/**
 * UX 2.0 (T2.3 D1/D4) — a dollar figure with consistent tabular-nums rendering
 * and optional provenance. Pass a `chain` to make it click-to-explain.
 */
import { cn } from "@/lib/utils";
import { money as fmtMoney, moneyCents, signedMoney } from "@/lib/format";
import { Provenance, type ProvenanceChain } from "./Provenance";

type Numish = number | string | null | undefined;

interface MoneyProps {
  value: Numish;
  /** "whole" (default) | "cents" | "signed". */
  variant?: "whole" | "cents" | "signed";
  /** Semantic tone for positive framing (refunds green, owed red). */
  tone?: "default" | "success" | "destructive" | "muted";
  /** Attach a provenance chain → click-to-explain. */
  chain?: ProvenanceChain;
  className?: string;
}

const toneClass: Record<NonNullable<MoneyProps["tone"]>, string> = {
  default: "",
  success: "text-success",
  destructive: "text-destructive",
  muted: "text-muted-foreground",
};

export function Money({ value, variant = "whole", tone = "default", chain, className }: MoneyProps) {
  const text =
    variant === "cents" ? moneyCents(value)
    : variant === "signed" ? signedMoney(value)
    : fmtMoney(value);
  const body = <span className={cn("t-num tabular-nums", toneClass[tone], className)}>{text}</span>;
  if (!chain) return body;
  return <Provenance chain={chain}>{body}</Provenance>;
}
