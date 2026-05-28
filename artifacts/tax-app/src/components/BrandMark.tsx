/**
 * Brookhaven brand mark — three ascending bars with 45° tails, conveying the
 * three integrated services and the brand's motion/depth. Inherits `currentColor`
 * so callers control the fill via text color.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 52" className={className} fill="currentColor" aria-hidden="true">
      <polygon points="5,20 5,39 14,48 14,20" />
      <polygon points="19,12 19,39 28,48 28,12" />
      <polygon points="33,4 33,39 42,48 42,4" />
    </svg>
  );
}
