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
 * SLICE 100 — key-term scan over FLATTENED DOCUMENT TEXT (PDF payloads, email
 * bodies). The owner's rule: "look for key terms in the invoice — invoice
 * number, order number, etc. in its many forms". Every pattern is grounded in
 * a REAL document the owner's vendors actually send (never invented):
 *
 *   1. OpenTHC combined invoice-manifest: "Invoice #01KQ 7GS6 EXA3 DV5M" — a
 *      grouped ULID after "Invoice #" (same shape pdf-openthc-manifest-core
 *      reads); collapse the spacing to the canonical 16-char id.
 *   2. Plain labelled forms: "Invoice #: 123", "Invoice No. 123",
 *      "Invoice Number: 123", and the GrowFlow invoice header
 *      "Invoice Order #: 29127 Bill To: ..." — value AFTER the label. The
 *      capture must contain a digit so label-words that follow a valueless
 *      label are never mistaken for the number (Cultivera prints
 *      "Order #: Order Date:" — "Order"/"Date" must not match).
 *   3. Cultivera invoice as unpdf flattens it: "... July 14, 2026 24706Order #:"
 *      — the order number GLUES onto the FRONT of its own label with no space
 *      (verified on the real SPR invoice, pdf-cultivera-invoice-core fixture).
 *   4. Purchase-order labels ("PO #", "P.O. #", "Purchase Order #") — same
 *      digit-guarded value-after-label rule.
 *
 * "Manifest #:" is deliberately NOT a key term — a manifest id is only used
 * as the FALLBACK (invoiceNumberForRow), never presented as a found invoice #.
 */
export function extractInvoiceNumberFromText(text: string): string | null {
  if (!text) return null;
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length === 0) return null;

  // 1) OpenTHC grouped ULID right after "Invoice #" (3-5 groups of 4).
  const ulid = flat.match(
    /Invoice\s*#\s*([0-9A-HJKMNP-TV-Z]{4}(?:\s+[0-9A-HJKMNP-TV-Z]{4}){2,4})/i,
  );
  if (ulid) return ulid[1].replace(/\s+/g, "").toUpperCase();

  // 2) Value AFTER a label, digit-guarded. Scan every occurrence so a
  //    valueless label ("Order #: Order Date:") falls through to a later one.
  const afterLabel =
    /\b(?:Invoice|Order|P\.?\s?O\.?|Purchase\s+Order)\s*(?:#|No\.?|Number)\s*:?\s*([A-Z0-9][A-Z0-9-]{2,19})/gi;
  for (const m of flat.matchAll(afterLabel)) {
    const v = m[1].trim();
    if (/\d/.test(v)) return v;
  }

  // 3) Cultivera glue: digits welded directly onto the FRONT of "Order #".
  const glued = flat.match(/(\d{3,12})Order\s*#/i);
  if (glued) return glued[1];

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
}): string | null {
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
