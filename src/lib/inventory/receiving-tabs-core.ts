/**
 * src/lib/inventory/receiving-tabs-core.ts
 *
 * Slice H15d — pure tab-resolution logic for the Receiving page's two tabs:
 *
 *   - "email"  → "Incoming (email)" — the hero view staff live on: the
 *                email-intake table (H15c), the pipeline queues, and the
 *                inbound-email trail. This is the DEFAULT.
 *   - "manual" → "Manual tools" — the "just in case" drawer holding all four
 *                manual import forms (Transfer Data Link, batch links, paste
 *                JSON, CCRS CSV, PDF upload) plus the KB backfill panel.
 *
 * Why auto-selection exists: every manual-form server action redirects its
 * failures to `/admin/inventory/intake?error=<code>` WITHOUT a tab param
 * (verified by grepping every `redirect(` in intake/actions.ts). If we
 * defaulted to the email tab in that case, the error banner — and the form
 * the user was just filling in — would be hidden behind the other tab. So a
 * recognized manual-form error code (or a KB-backfill result banner param)
 * auto-opens the Manual tools tab. An EXPLICIT `?tab=` always wins.
 *
 * Pure module: no React, no next/*, no I/O — unit-testable under vitest.
 */

export type ReceivingTab = "email" | "manual";

/**
 * Every `?error=` code the manual import forms / KB backfill can redirect
 * back with. Kept in exact sync with the redirect calls in
 * src/app/admin/inventory/intake/actions.ts and the errorMsg mapping in
 * page.tsx — if a new code is added there, add it here so the Manual tab
 * auto-opens and the banner is visible.
 */
export const MANUAL_ERROR_CODES: ReadonlySet<string> = new Set([
  "empty", // paste-JSON form: blank textarea
  "emptyurl", // Transfer Data Link form: blank URL
  "fetch", // Transfer Data Link form: fetch failed
  "parse", // paste-JSON form: invalid JSON
  "nolines", // no line items found in the payload
  "emptycsv", // CCRS CSV form: blank textarea
  "csvparse", // CCRS CSV form: no item header row
  "emptypdf", // PDF form: no file chosen
  "notpdf", // PDF form: not a PDF
  "pdfscanned", // PDF form: image-only scan, no text layer
  "pdfparse", // PDF form: no LCB shipping document found
  "save", // any form: staging the manifest failed
  "kbbackfill", // KB backfill: run failed
  "reprocess", // SLICE 67: the re-run-intelligence pass failed
]);

export type ReceivingTabParams = {
  tab?: string;
  error?: string;
  kbdone?: string;
  /** SLICE 67: re-run-intelligence result banner (lives on Manual tools). */
  repdone?: string;
};

/**
 * Resolve which tab to render.
 *
 * Priority:
 *   1. Explicit `?tab=email|manual` — the user clicked a tab; honor it.
 *   2. A recognized manual-form `?error=` code — auto-open Manual tools so
 *      the failure banner sits next to the form that produced it.
 *   3. A `?kbdone=` result banner — the KB backfill lives on Manual tools.
 *   4. Default: the "Incoming (email)" hero view.
 *
 * Unknown `?tab=` or `?error=` values fall through to the default rather
 * than guessing — an unrecognized error code renders no banner on either
 * tab, so there is nothing to surface on Manual tools.
 */
export function resolveReceivingTab(params: ReceivingTabParams): ReceivingTab {
  if (params.tab === "manual") return "manual";
  if (params.tab === "email") return "email";
  if (params.error && MANUAL_ERROR_CODES.has(params.error)) return "manual";
  if (params.kbdone) return "manual";
  if (params.repdone) return "manual";
  return "email";
}

export type ReceivingTabMeta = {
  key: ReceivingTab;
  label: string;
  icon: string;
  /** Query-string href for the tab link (same route, one param). */
  href: string;
  blurb: string;
};

/** The two tabs, in display order. Email is the hero and comes first. */
export const RECEIVING_TABS: readonly ReceivingTabMeta[] = [
  {
    key: "email",
    label: "Incoming (email)",
    icon: "📬",
    href: "/admin/inventory/intake?tab=email",
    blurb: "Manifests pulled in from vendor_intake@ — one calm row per real manifest.",
  },
  {
    key: "manual",
    label: "Manual tools",
    icon: "🧰",
    href: "/admin/inventory/intake?tab=manual",
    blurb: "Paste a link/JSON/CSV, upload a PDF, or run the KB backfill — for when email didn't cover it.",
  },
] as const;
