import * as React from "react";
import { Input } from "@/components/ui/input";

/**
 * CurrencyInput — wraps Input with comma formatting for display.
 *
 * Stores numbers as plain strings (digits + optional decimal) in state,
 * but renders with commas: "12,345.00". The user can type freely; commas
 * are only added on blur. On focus, commas are stripped to make editing easy.
 *
 * Pass `value` and `onChange(rawString)` like a regular Input. The raw string
 * is the digits-only / decimal form (e.g. "12345.50") — easy to Number() later.
 */
type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  value: string | number;
  onChange: (rawValue: string) => void;
  placeholder?: string;
};

function formatWithCommas(s: string): string {
  if (s === "" || s == null) return "";
  // Parse as number to clean up; preserve up to 2 decimals
  const n = Number(s);
  if (!Number.isFinite(n)) return String(s);
  const [whole, frac] = String(s).split(".");
  const wholeNum = Number(whole.replace(/,/g, ""));
  if (!Number.isFinite(wholeNum)) return String(s);
  const wholeFormatted = wholeNum.toLocaleString("en-US");
  return frac != null ? `${wholeFormatted}.${frac}` : wholeFormatted;
}

function stripFormatting(s: string): string {
  return s.replace(/,/g, "").replace(/[^\d.\-]/g, "");
}

export const CurrencyInput = React.forwardRef<HTMLInputElement, Props>(
  ({ value, onChange, placeholder = "0.00", ...rest }, ref) => {
    const [focused, setFocused] = React.useState(false);
    const stringValue = value === "" || value == null ? "" : String(value);
    const display = focused ? stringValue : formatWithCommas(stringValue);

    return (
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">$</span>
        <Input
          ref={ref}
          inputMode="decimal"
          value={display}
          placeholder={placeholder}
          className="pl-7 font-mono"
          onFocus={(e) => { setFocused(true); rest.onFocus?.(e); }}
          onBlur={(e) => { setFocused(false); rest.onBlur?.(e); }}
          onChange={(e) => {
            const cleaned = stripFormatting(e.target.value);
            onChange(cleaned);
          }}
          {...rest}
        />
      </div>
    );
  },
);
CurrencyInput.displayName = "CurrencyInput";
