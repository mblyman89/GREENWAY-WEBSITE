/**
 * src/lib/discovery/lead-vendor-thread-core.ts
 *
 * W11 — PURE vendor-identity threading for lead promotion (audit gap G8).
 *
 * When a product lead is promoted into the PO builder, its linked VENDOR lead
 * may already be reconciled against the vendors we actually buy from
 * (reconcile.ts: license equality → "existing", normalized-name equality →
 * "possible", else "unmatched"). Before W11 the promotion only carried the
 * vendor's display NAME, and the builder re-derived the vendor with a fragile
 * raw lowercase name comparison — the reconciliation's verdict was thrown
 * away at the exact moment it mattered.
 *
 * This module decides what identity to thread:
 *   - matched_vendor_id present → thread the ID (the builder pre-selects it
 *     exactly; the human still confirms the vendor before saving — the PO
 *     builder is a suggest-and-confirm surface, same ethos as W5);
 *   - no match → thread the display name only (the old behavior), so the
 *     builder can still offer its name-equality suggestion;
 *   - no vendor lead at all → thread nothing.
 *
 * NEVER GUESS: we never invent an id — only reconciliation's verdict is
 * threaded, and `via` says exactly how confident it is ("existing" came from
 * a license-number match, "possible" from a normalized-name match a human
 * should double-check).
 */
import type { MatchState } from "./reconcile";

/** The slice of a vendor lead this decision needs. */
export type VendorLeadThreadFacts = {
  display_name: string;
  matched_vendor_id: string | null;
  match_state: MatchState;
};

export type LeadVendorThread = {
  /** Real vendors.id to pre-select in the builder, or null. */
  vendorId: string | null;
  /** Display name to show / fall back on, or null. */
  vendorName: string | null;
  /** How the identity was established — honest provenance for logs/UI. */
  via: "reconciled_license" | "reconciled_name" | "name_only" | "none";
};

/** Decide what vendor identity a lead promotion carries. Pure. */
export function resolveLeadVendorThread(
  vendorLead: VendorLeadThreadFacts | null,
): LeadVendorThread {
  if (!vendorLead) return { vendorId: null, vendorName: null, via: "none" };
  const name = vendorLead.display_name.trim() || null;
  if (vendorLead.matched_vendor_id) {
    return {
      vendorId: vendorLead.matched_vendor_id,
      vendorName: name,
      via: vendorLead.match_state === "existing" ? "reconciled_license" : "reconciled_name",
    };
  }
  return { vendorId: null, vendorName: name, via: name ? "name_only" : "none" };
}

// ---------------------------------------------------------------------------
// Embedded self-tests (house pattern)
// ---------------------------------------------------------------------------
export function __runLeadVendorThreadCoreTests(): { passed: number } {
  let passed = 0;
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL lead-vendor-thread-core: " + msg);
    passed += 1;
  };

  // No vendor lead → nothing threaded.
  {
    const t = resolveLeadVendorThread(null);
    assert(t.vendorId === null && t.vendorName === null && t.via === "none", "null lead → none");
  }

  // License-confident reconciliation → id threaded, provenance says license.
  {
    const t = resolveLeadVendorThread({
      display_name: "Fairwinds",
      matched_vendor_id: "v-1",
      match_state: "existing",
    });
    assert(t.vendorId === "v-1", "existing → id threaded");
    assert(t.via === "reconciled_license", "existing → license provenance");
    assert(t.vendorName === "Fairwinds", "name carried alongside id");
  }

  // Name-based reconciliation → id threaded but flagged as name-derived.
  {
    const t = resolveLeadVendorThread({
      display_name: "Phat Panda",
      matched_vendor_id: "v-2",
      match_state: "possible",
    });
    assert(t.vendorId === "v-2", "possible → id threaded (human confirms in builder)");
    assert(t.via === "reconciled_name", "possible → name provenance");
  }

  // Unmatched → name only, never an invented id.
  {
    const t = resolveLeadVendorThread({
      display_name: "Brand New Farm",
      matched_vendor_id: null,
      match_state: "unmatched",
    });
    assert(t.vendorId === null, "unmatched → no id");
    assert(t.vendorName === "Brand New Farm" && t.via === "name_only", "unmatched → name only");
  }

  // Blank display name and no match → none (whitespace never threaded).
  {
    const t = resolveLeadVendorThread({
      display_name: "   ",
      matched_vendor_id: null,
      match_state: "unmatched",
    });
    assert(t.vendorId === null && t.vendorName === null && t.via === "none", "blank name → none");
  }

  return { passed };
}
