/**
 * src/lib/inventory/manifest-table-core.ts  (H15c)
 *
 * PURE helpers for the "Incoming (email)" hero table on the receiving page:
 *
 *  - extractInvoiceNumber: the owner wants an Invoice # column showing "order #
 *    or invoice #, whichever is available" (locked decision). All three verified
 *    vendor systems emit the WCIA Transfer Schema whose `external_id` carries
 *    exactly that (Cultivera: invoice # "0000020830"; GrowFlow: order # "29127").
 *    We already STORE both numbers — transfer_id lands in manifest_number and
 *    the full JSON (incl. external_id) is retained in raw_payload — so this
 *    reads the invoice/order # back out of the stored payload with NO new
 *    migration. For the OpenTHC combined invoice-manifest PDF the invoice #
 *    IS the manifest # (same document), so the column falls back to it.
 *
 *  - movingBadge: the status badge that "changes as it moves"
 *    (🟡 In transit → 🔵 Received → 🟢 Accepted, 🟠 partial, ⚪ rejected,
 *    red ETA-overdue emphasis while in transit).
 *
 * No I/O, no server-only imports — unit-testable with vitest.
 */

import { normalizeStage, classifyEta, type ManifestStage } from "@/lib/inventory/manifest-pipeline-core";

// ── Invoice / order number ──────────────────────────────────────────────────

function asTrimmedString(v: unknown): string | null {
  if (typeof v === "string") {
    const t = v.trim();
    return t.length > 0 ? t : null;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/**
 * Pull the vendor's order/invoice number out of a stored manifest payload.
 * Case-insensitive over the WCIA `external_id` plus tolerant aliases some
 * systems use. Returns null when the payload has none (e.g. CCRS CSV, LCB PDF
 * text) — the caller decides the fallback.
 */
export function extractInvoiceNumber(rawPayload: unknown): string | null {
  if (rawPayload == null) return null;
  // Stored payloads are JSON objects for WCIA imports; strings for CSV/PDF.
  let root: unknown = rawPayload;
  if (typeof root === "string") {
    // A stored JSON string still counts (older rows kept the raw text).
    const t = root.trim();
    if (!t.startsWith("{")) return null;
    try {
      root = JSON.parse(t);
    } catch {
      return null;
    }
  }
  if (typeof root !== "object" || root === null || Array.isArray(root)) return null;
  const obj = root as Record<string, unknown>;
  const lower = new Map<string, unknown>();
  for (const k of Object.keys(obj)) lower.set(k.toLowerCase(), obj[k]);
  for (const key of ["external_id", "invoice_number", "order_number", "order_id"]) {
    const v = asTrimmedString(lower.get(key));
    if (v) return v;
  }
  return null;
}

/**
 * The Invoice # cell: order/invoice # from the payload when present; for the
 * OpenTHC combined invoice-manifest PDF the manifest number IS the invoice #
 * (one document serves as both), so it doubles up; otherwise null (render "—").
 */
export function invoiceNumberForRow(row: {
  raw_payload: unknown;
  source_format: string;
  manifest_number: string | null;
}): string | null {
  const fromPayload = extractInvoiceNumber(row.raw_payload);
  if (fromPayload) return fromPayload;
  if (row.source_format === "pdf-manifest" && row.manifest_number) {
    // Only the OpenTHC layout puts the invoice # in manifest_number; the LCB
    // Internal Shipping Document's manifest id is NOT an invoice #. The two are
    // distinguishable: LCB ids are 16-18 digit numerics, OpenTHC uses ULIDs.
    if (!/^\d{16,18}$/.test(row.manifest_number)) return row.manifest_number;
  }
  return null;
}

// ── Moving status badge ─────────────────────────────────────────────────────

export type MovingBadge = {
  /** Visual dot/emoji the owner asked for. */
  emoji: string;
  label: string;
  /** Matches the admin Badge tones. */
  tone: "gold" | "orange" | "green" | "danger" | "neutral";
  /** True only while in transit past its ETA — row needs chasing. */
  overdue: boolean;
};

/**
 * The badge that moves with the manifest:
 *   🟡 Pending → 🚚 In transit (→ 🔴 overdue) → 🔵 Received → 🟢 Accepted,
 *   🟠 Partially accepted, ⚪ Rejected.
 */
export function movingBadge(
  status: string | null | undefined,
  etaDate: string | null | undefined,
  now: Date = new Date(),
): MovingBadge {
  const stage: ManifestStage = normalizeStage(status);
  switch (stage) {
    case "in_transit": {
      const overdue = classifyEta(etaDate, now) === "overdue";
      return overdue
        ? { emoji: "🔴", label: "In transit — overdue", tone: "danger", overdue: true }
        : { emoji: "🟡", label: "In transit", tone: "orange", overdue: false };
    }
    case "received":
      return { emoji: "🔵", label: "Received", tone: "gold", overdue: false };
    case "accepted":
      return { emoji: "🟢", label: "Accepted", tone: "green", overdue: false };
    case "partially_accepted":
      return { emoji: "🟠", label: "Partially accepted", tone: "gold", overdue: false };
    case "rejected":
      return { emoji: "⚪", label: "Rejected", tone: "neutral", overdue: false };
    case "pending":
    default:
      return { emoji: "🟡", label: "Pending", tone: "gold", overdue: false };
  }
}

// ── "Pulled in" timestamp ───────────────────────────────────────────────────

/** "Jul 8, 2:14 PM"-style short stamp for the Pulled-in column. PURE. */
export function fmtPulledIn(createdAt: string | null | undefined): string {
  if (!createdAt) return "—";
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return "—";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  let hh = d.getHours();
  const mer = hh >= 12 ? "PM" : "AM";
  hh = hh % 12 || 12;
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${months[d.getMonth()]} ${d.getDate()}, ${hh}:${mm} ${mer}`;
}
