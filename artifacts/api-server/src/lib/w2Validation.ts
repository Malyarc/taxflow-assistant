/**
 * Re-export of shared W-2 validation logic from @workspace/validation.
 *
 * Kept as a re-export so existing imports under "../lib/w2Validation" continue
 * to work; new code should import directly from @workspace/validation.
 */
export {
  validateW2,
  type W2Flag,
  type W2FlagSeverity,
  type W2DataLike,
  type ValidationContext,
} from "@workspace/validation";
