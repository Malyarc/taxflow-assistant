/**
 * UX 2.0 (T2.3 D1) — semantic-token lint.
 *
 * The Brookhaven design system is built on SEMANTIC tokens (bg-brand,
 * text-brand-ink, text-success, bg-muted, …). Raw Tailwind palette classes
 * (bg-slate-100, text-violet-900, …) bypass the tokens and — critically —
 * BREAK DARK MODE (a hardcoded text-violet-900 is invisible on a dark card).
 *
 * This fails the build if any raw numbered-palette utility appears in the
 * tax-app source. Documented exceptions (per CLAUDE.md):
 *   • amber / yellow  — allowed for genuine *warning* callouts.
 *   • white / black    — overlay tints on the dark sidebar (no shade number;
 *     they don't match the numbered-palette pattern anyway).
 *
 * Run: pnpm --filter @workspace/scripts run lint:tokens
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "../../artifacts/tax-app/src");

// Numbered Tailwind palette families that are NOT semantic tokens.
const BANNED_FAMILIES = [
  "slate", "gray", "zinc", "neutral", "stone",
  "red", "orange", "lime", "green", "emerald", "teal", "cyan", "sky",
  "blue", "indigo", "violet", "purple", "fuchsia", "pink", "rose",
  // amber + yellow intentionally omitted (warning-callout exception).
];
const PREFIXES = [
  "bg", "text", "border", "ring", "ring-offset", "from", "to", "via",
  "fill", "stroke", "divide", "decoration", "outline", "accent", "caret", "placeholder", "shadow",
];

// e.g. (bg|text|...)-(slate|red|...)-(50..950) with optional /opacity, and an
// optional state prefix like hover: / group-[.x]: handled by matching mid-string.
const RE = new RegExp(
  `\\b(?:${PREFIXES.join("|")})-(?:${BANNED_FAMILIES.join("|")})-(?:50|[1-9]00|950)(?:\\/\\d{1,3})?\\b`,
  "g",
);

interface Violation { file: string; line: number; col: number; cls: string }

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (/\.(tsx?|css)$/.test(name)) acc.push(p);
  }
  return acc;
}

function scan(): Violation[] {
  const out: Violation[] = [];
  for (const file of walk(ROOT)) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      let m: RegExpExecArray | null;
      RE.lastIndex = 0;
      while ((m = RE.exec(line)) !== null) {
        out.push({ file: relative(process.cwd(), file), line: i + 1, col: m.index + 1, cls: m[0] });
      }
    });
  }
  return out;
}

const violations = scan();
if (violations.length === 0) {
  console.log("✓ semantic-token lint: no raw Tailwind palette classes in tax-app/src");
  process.exit(0);
}

console.error(`✗ semantic-token lint: ${violations.length} raw palette class(es) found.\n`);
console.error("  Replace with semantic tokens (bg-brand, text-brand-ink, text-success, bg-muted, …).");
console.error("  Amber/yellow are allowed for warning callouts; white/black overlays are fine.\n");
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}:${v.col}  ${v.cls}`);
}
process.exit(1);
