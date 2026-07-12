/**
 * Disposition reason lists — PURE module (no server-only imports).
 *
 * Extracted from the server-only disposition store so that client components
 * and server actions can share the canonical reason vocabularies without
 * pulling in Supabase code. The server store re-exports these for backwards
 * compatibility.
 *
 * Grounded in docs/RETURNS_DESTRUCTION_COMPLIANCE.md:
 * - Vendor returns ("Returned to seller") map to CCRS adjustment reason
 *   "Other" (CCRS Upload User Guide Table 3) and always require detail.
 * - Destruction reasons map to CCRS "Destruction"; recall destructions are
 *   PROHIBITED before LCB coordination (WAC 314-55-225).
 */

export const VENDOR_RETURN_REASONS = [
  "defective",
  "recall",
  "overstock",
  "mislabeled",
  "expired",
  "other",
] as const;

export type VendorReturnReason = (typeof VENDOR_RETURN_REASONS)[number];

export const VENDOR_RETURN_REASON_LABELS: Record<VendorReturnReason, string> = {
  defective: "Defective product",
  recall: "Recall (coordinate with LCB first)",
  overstock: "Overstock",
  mislabeled: "Mislabeled",
  expired: "Expired",
  other: "Other (describe in detail)",
};

export const DESTRUCTION_REASONS = [
  "expired",
  "failed_qa",
  "recall",
  "damaged",
  "contaminated",
  "other",
] as const;

export type DestructionReason = (typeof DESTRUCTION_REASONS)[number];

export const DESTRUCTION_REASON_LABELS: Record<DestructionReason, string> = {
  expired: "Expired",
  failed_qa: "Failed quality assurance",
  recall: "Recall (LCB coordination required)",
  damaged: "Damaged",
  contaminated: "Contaminated",
  other: "Other (describe in detail)",
};
