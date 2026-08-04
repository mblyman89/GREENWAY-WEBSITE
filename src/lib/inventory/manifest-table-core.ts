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
 *    migration. SLICE 100 (owner rule): TEXT payloads (flattened PDF text)
 *    get a key-term scan — "Invoice #", "Order #", "Invoice No", "PO #" and
 *    friends "in its many forms" — and when NO invoice/order # exists in any
 *    form the column ALWAYS falls back to the manifest number.
 *
 *  - movingBadge: the status badge that "changes as it moves"
 *    (🟡 In transit → 🔵 Received → 🟢 Accepted, 🟠 partial, ⚪ rejected,
 *    red ETA-overdue emphasis while in transit).
 *
 * No I/O, no server-only imports — unit-testable with vitest.
 */

import { normalizeStage, classifyEta, type ManifestStage } from "@/lib/inventory/manifest-pipeline-core";
import { pacificParts } from "@/lib/reports/timezone";

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
 * SLICE 100 + PR-C — key-term scan over FLATTENED DOCUMENT TEXT (PDF payloads,
 * email bodies). The owner's rule: "look for any and all things that could be
 * an invoice # variant, then fall back to the manifest number". Every pattern
 * is grounded in a REAL document the owner's vendors actually send (never
 * invented; verified against /workspace/pdf_recon extracted text):
 *
 *   1. OpenTHC combined invoice-manifest: "Invoice #01KQ 7GS6 EXA3 DV5M" — a
 *      grouped ULID after "Invoice #" (same shape pdf-openthc-manifest-core
 *      reads); collapse the spacing to the canonical 16-char id.
 *   2. PR-C — a TRUE "Invoice #/No/Number" value WINS over Order/PO. Firetree
 *      (GrowFlow) prints BOTH "Order #: 15121" AND "Invoice #: INV-15121"; the
 *      invoice number is the one that marries to the vendor's invoice, so it is
 *      preferred. Value AFTER the label, id-guarded, dot-aware.
 *   3. General Order / PO / Purchase-Order value AFTER label, dot-aware. VMI /
 *      Grow Op Farms prints "Order #: WA.SO8EQH0C" — a dotted alphanumeric id
 *      (the previous [A-Z0-9-] class dropped the dot and lost it). Scanned over
 *      every occurrence so a valueless label ("Order #: Order Date:") falls
 *      through (Cultivera / PNW).
 *   4. Cultivera invoice as unpdf flattens it: "... July 14, 2026 24706Order #:"
 *      — the order number GLUES onto the FRONT of its own label with no space
 *      (verified on the real SPR invoice, pdf-cultivera-invoice-core fixture).
 *   5. PR-C — value IMMEDIATELY BEFORE the label, space/newline separated. PNW
 *      Consulting's two-column invoice, once unpdf flattens it, prints the
 *      number ABOVE its label: "... July 14, 2026 22014 Order #: Order Date:".
 *      Read the id token sitting right before "Order #"/"Invoice #", guarded
 *      hard against dates / money / address fragments.
 *
 * An id "looks valid" when it contains a digit (22014, INV-15121, 990011) OR is
 * an uppercase dotted-alphanumeric license-style id (VMI "WA.SO8EQH0C"). This
 * keeps the old digit-guard intent (valueless labels never match) while now
 * admitting the real dotted ids the owner's vendors send.
 *
 * "Manifest #:" is deliberately NOT a key term — a manifest id is only used
 * as the FALLBACK (invoiceNumberForRow), never presented as a found invoice #.
 */

/**
 * True when a captured token plausibly IS an invoice/order id (not a label
 * word). It must contain a digit — /\d/.test(v) keeps the original digit guard
 * so valueless labels ("Order #: Order Date:") never match — OR be an uppercase
 * dotted-alphanumeric license-style id (VMI "WA.SO8EQH0C").
 */
function looksLikeInvoiceId(v: string): boolean {
  return /\d/.test(v) || /^[A-Z]{2,}\.[A-Z0-9]{3,}$/.test(v);
}

export function extractInvoiceNumberFromText(text: string): string | null {
  if (!text) return null;
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length === 0) return null;

  // The id value is dot-aware: starts/ends alnum, may hold - and . internally
  // (so VMI's "WA.SO8EQH0C" survives whole). Inline in each pattern below.

  // 1) OpenTHC grouped ULID right after "Invoice #" (3-5 groups of 4).
  const ulid = flat.match(
    /Invoice\s*#\s*([0-9A-HJKMNP-TV-Z]{4}(?:\s+[0-9A-HJKMNP-TV-Z]{4}){2,4})\b/i,
  );
  if (ulid) return ulid[1].replace(/\s+/g, "").toUpperCase();

  // 2) PREFER a true "Invoice #/No/Number" value (id-guarded, dot-aware) so a
  //    document with BOTH order # and invoice # yields the invoice # (Firetree
  //    prints "Order #: 15121" AND "Invoice #: INV-15121" → INV-15121 wins).
  const invoiceLabel =
    /\bInvoice\s*(?:#|No\.?|Number)\s*:?\s*([A-Z0-9](?:[A-Z0-9.-]{1,18}[A-Z0-9])?)/gi;
  for (const m of flat.matchAll(invoiceLabel)) {
    const v = m[1].trim();
    if (looksLikeInvoiceId(v)) return v;
  }

  // 3) General Order / PO / Purchase-Order value AFTER label (dot-aware). Scan
  //    every occurrence so a valueless label ("Order #: Order Date:") falls
  //    through to a later one. VMI: "Order #: WA.SO8EQH0C".
  const afterLabel =
    /\b(?:Order|P\.?\s?O\.?|Purchase\s+Order)\s*(?:#|No\.?|Number)\s*:?\s*([A-Z0-9](?:[A-Z0-9.-]{1,18}[A-Z0-9])?)/gi;
  for (const m of flat.matchAll(afterLabel)) {
    const v = m[1].trim();
    if (looksLikeInvoiceId(v)) return v;
  }

  // 4) Cultivera glue: digits welded directly onto the FRONT of "Order #".
  const glued = flat.match(/(\d{3,12})Order\s*#/i);
  if (glued) return glued[1];

  // 5) PR-C — value IMMEDIATELY BEFORE the label (PNW two-column flatten prints
  //    "... July 14, 2026 22014 Order #: Order Date: ..."). Guard against a bare
  //    year so a date preceding the label is never captured.
  const beforeLabel = flat.match(
    /([A-Z0-9](?:[A-Z0-9.-]{1,18}[A-Z0-9])?)\s+(?:Invoice|Order)\s*#/i,
  );
  if (beforeLabel) {
    const v = beforeLabel[1].trim();
    if (looksLikeInvoiceId(v) && !/^(?:19|20)\d{2}$/.test(v)) return v;
  }

  return null;
}

/**
 * Pull the vendor's order/invoice number out of a stored manifest payload.
 * JSON payloads (WCIA imports): case-insensitive over `external_id` plus
 * tolerant aliases. TEXT payloads (PDF flattened text, CSV): the SLICE 100
 * key-term scan above. Returns null when the payload truly has none (e.g.
 * CCRS CSV, LCB Internal Shipping Document) — the caller decides the fallback.
 */
export function extractInvoiceNumber(rawPayload: unknown): string | null {
  if (rawPayload == null) return null;
  // Stored payloads are JSON objects for WCIA imports; strings for CSV/PDF.
  let root: unknown = rawPayload;
  if (typeof root === "string") {
    // A stored JSON string still counts (older rows kept the raw text).
    const t = root.trim();
    if (!t.startsWith("{")) {
      // SLICE 100: not JSON — this is flattened PDF text or CSV. Key-term scan.
      return extractInvoiceNumberFromText(t);
    }
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
 * The Invoice # cell: order/invoice # from the payload when present (JSON
 * keys OR the SLICE 100 key-term text scan); otherwise ALWAYS fall back to
 * the manifest number — the owner's explicit rule: "if there is no invoice
 * number in any of its many forms, please fallback to using the manifest
 * number". Null only when the row has neither (render "—").
 */
export function invoiceNumberForRow(row: {
  raw_payload: unknown;
  source_format: string;
  manifest_number: string | null;
  /**
   * Migration 0151: owner-entered correction. When present and non-blank it
   * WINS over the derived value (payload scan / manifest-number fallback).
   */
  invoice_number_override?: string | null;
}): string | null {
  // Owner override always wins when set to a non-blank value.
  const override = (row.invoice_number_override ?? "").trim();
  if (override) return override;

  const fromPayload = extractInvoiceNumber(row.raw_payload);
  if (fromPayload) return fromPayload;
  return row.manifest_number ?? null;
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

// ── SLICE 101: table view filter ──────────────────────────────────────────

/**
 * The owner's filter for the Incoming (email) table: hide manifests that are
 * already fully processed (accepted OR partially accepted) so the rows that
 * still need attention are what staff see first. Rejected rows stay visible
 * ("I want all other manifests to be visible in the table first").
 */
export type IntakeTableView = "action" | "all";

export function resolveIntakeView(v: string | null | undefined): IntakeTableView {
  return v === "all" ? "all" : "action";
}

/** True when the manifest is done processing (accepted or partially accepted). */
export function isProcessedManifest(status: string | null | undefined): boolean {
  const stage = normalizeStage(status);
  return stage === "accepted" || stage === "partially_accepted";
}

/**
 * Apply the view to the rows (PURE, order-preserving):
 *  - "action" (default): processed rows (accepted + partially accepted) hidden;
 *  - "all": every row, but the still-open ones FIRST (each group keeps its
 *    newest-first order) — the owner's "all other manifests visible first".
 */
export function applyIntakeView<T extends { status: string | null }>(
  rows: readonly T[],
  view: IntakeTableView,
): T[] {
  if (view === "action") return rows.filter((r) => !isProcessedManifest(r.status));
  const open = rows.filter((r) => !isProcessedManifest(r.status));
  const processed = rows.filter((r) => isProcessedManifest(r.status));
  return [...open, ...processed];
}

/** How many rows the "action" view is hiding (for the toggle label). */
export function countProcessedRows(rows: readonly { status: string | null }[]): number {
  return rows.reduce((n, r) => n + (isProcessedManifest(r.status) ? 1 : 0), 0);
}

// ── "Pulled in" timestamp ───────────────────────────────────────────────────

/**
 * "Jul 8, 2:14 PM"-style short stamp for the Pulled-in column. PURE.
 *
 * SLICE 41 TIMEZONE FIX: this previously used `Date#getHours()` etc., which
 * render in the SERVER's timezone. EmailIntakeTable is a server component and
 * Vercel runs in UTC, so a manifest pulled in at 5:44 PM Pacific on Jul 25
 * displayed as "Jul 26, 12:44 AM" — tomorrow's date. Store time is Pacific
 * (America/Los_Angeles) everywhere else in the app (src/lib/reports/timezone),
 * so this now formats the instant's PACIFIC wall-clock parts regardless of
 * where the render happens.
 */
export function fmtPulledIn(createdAt: string | null | undefined): string {
  if (!createdAt) return "—";
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return "—";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const p = pacificParts(d);
  let hh = p.hour;
  const mer = hh >= 12 ? "PM" : "AM";
  hh = hh % 12 || 12;
  const mm = String(p.minute).padStart(2, "0");
  return `${months[p.month - 1]} ${p.day}, ${hh}:${mm} ${mer}`;
}

/**
 * "7/25/2026, 5:44:38 PM"-style full stamp in PACIFIC wall-clock time. PURE.
 *
 * SLICE 41: replaces bare `new Date(x).toLocaleString()` in server components
 * (the intake transport panel's "last updated" and the manifest timeline),
 * which rendered in the server's timezone (UTC on Vercel) — the same
 * "tomorrow's date" bug as fmtPulledIn. Deterministic manual formatting (no
 * locale dependence) so the output is stable across environments.
 */
export function fmtPacificDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = pacificParts(d);
  let hh = p.hour;
  const mer = hh >= 12 ? "PM" : "AM";
  hh = hh % 12 || 12;
  const mm = String(p.minute).padStart(2, "0");
  const ss = String(p.second).padStart(2, "0");
  return `${p.month}/${p.day}/${p.year}, ${hh}:${mm}:${ss} ${mer}`;
}
