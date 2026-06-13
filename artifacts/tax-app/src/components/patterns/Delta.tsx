/**
 * UX 2.0 (T2.3 D5) — the one delta visual. Wraps lib/delta semantics so every
 * "this changed" figure (YoY, 1040-X, what-if, roll-forward) reads identically:
 * favorable change = success/green, unfavorable = destructive/red, no change =
 * muted, with a consistent direction arrow.
 */
import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { signedMoney } from "@/lib/format";
import { deltaTone, toneTextClass, toneSoftClass, type FavorableDirection } from "@/lib/delta";

interface DeltaProps {
  /** The signed change (new − old). */
  value: number;
  /** Does an INCREASE help the taxpayer? Derive via amend/yoy classifiers. */
  direction: FavorableDirection;
  /** Formatter for the magnitude (default: explicit-sign whole dollars). */
  format?: (n: number) => string;
  /** Show the up/down arrow (default true). */
  showIcon?: boolean;
  className?: string;
}

/** Inline colored delta, e.g. "▲ +$1,240". */
export function Delta({ value, direction, format = (n) => signedMoney(n), showIcon = true, className }: DeltaProps) {
  const tone = deltaTone(value, direction);
  const zero = !Number.isFinite(value) || value === 0;
  const Icon = value > 0 ? ArrowUp : ArrowDown;
  return (
    <span className={cn("inline-flex items-center gap-1 t-num font-medium", toneTextClass(tone), className)}>
      {showIcon && !zero && <Icon className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />}
      {format(value)}
    </span>
  );
}

/** Pill form of a delta, for chips on cards / table cells. */
export function DeltaBadge({ value, direction, format = (n) => signedMoney(n), showIcon = true, className }: DeltaProps) {
  const tone = deltaTone(value, direction);
  const zero = !Number.isFinite(value) || value === 0;
  const Icon = value > 0 ? ArrowUp : ArrowDown;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium t-num", toneSoftClass(tone), className)}>
      {showIcon && !zero && <Icon className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />}
      {format(value)}
    </span>
  );
}
