/**
 * src/lib/catalog/draft-deep-link-core.ts  (S02 — deep-link every "go fix it"
 * message to the exact product)
 *
 * PURE. One place that knows how to address a product on Product Onboarding
 * (`/admin/inventory/drafts`) by id or by delivery, so every "go fix it" link
 * lands ON the product instead of on a list of everything:
 *
 *   ?draft=<uuid>     pin exactly one draft. The page reads that one row with
 *                     NO status filter and shows the tab the row is really in,
 *                     so the link cannot dead-end (F-060: a fact-review hold
 *                     fires AFTER approval, but the page defaulted to "Needs
 *                     review", so the held product was never on screen). The
 *                     URL also carries `#draft-<uuid>`, the row's element id,
 *                     so the browser scrolls to it natively (no client JS).
 *   ?manifest=<uuid>  show only the products from that one delivery (F-080:
 *                     the finalize / accept banners linked to the whole
 *                     queue).
 *   ?status=…         the tab, exactly as before.
 *
 * Both ids are validated as UUIDs before they reach a query: a malformed id in
 * a hand-edited URL would make Postgres reject the uuid cast and the page
 * would render an empty list for a reason nobody could see. A bad id is
 * simply ignored (never guessed at).
 *
 * Also owns the Enrich-now target (F-008): the product's own enrichment page
 * when its POS key is a card on the PUBLISHED menu (that page 404s otherwise,
 * because it looks the key up in the published version), else the
 * enrichment list searched by name — today's behaviour, kept as the honest
 * fallback.
 *
 * No fs, no network, no Supabase. Embedded self-tests run in the pure runner.
 */

export const DRAFTS_PATH = "/admin/inventory/drafts";
export const ENRICH_LIST_PATH = "/admin/products";

export const DRAFT_VIEWS = ["draft", "approved", "dismissed"] as const;
export type DraftView = (typeof DRAFT_VIEWS)[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True only for a canonical 8-4-4-4-12 hex UUID (any version, any case). */
export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v.trim());
}

function uuidOrNull(v: unknown): string | null {
  if (Array.isArray(v)) return null; // ?draft=a&draft=b is ambiguous: ignore
  return isUuid(v) ? v.trim().toLowerCase() : null;
}

/** The tab a status string belongs to; anything unknown is the review queue. */
export function normalizeDraftView(status: unknown): DraftView {
  return status === "approved" || status === "dismissed" ? status : "draft";
}

/** The element id of a draft's table row (the scroll + highlight target). */
export function draftRowAnchorId(draftId: string): string {
  return `draft-${draftId}`;
}

export type DraftFocus = {
  /** The tab requested by the URL (the page may override it from a pinned row). */
  view: DraftView;
  /** Validated delivery filter, or null. */
  manifestId: string | null;
  /** Validated pinned draft, or null. */
  draftId: string | null;
};

/** Parse the onboarding page's search params. Invalid ids are dropped. */
export function parseDraftFocus(sp: {
  status?: unknown;
  manifest?: unknown;
  draft?: unknown;
}): DraftFocus {
  return {
    view: normalizeDraftView(sp.status),
    manifestId: uuidOrNull(sp.manifest),
    draftId: uuidOrNull(sp.draft),
  };
}

/**
 * The tab to render. A pinned draft that was found decides the tab from its
 * REAL status, whatever the URL said; otherwise the URL's tab stands.
 */
export function effectiveDraftView(
  focus: DraftFocus,
  pinnedRow: { status: string } | null | undefined,
): DraftView {
  if (focus.draftId && pinnedRow) return normalizeDraftView(pinnedRow.status);
  return focus.view;
}

/**
 * Build an onboarding URL. `status` is omitted for the default tab so the
 * canonical list URL stays exactly `/admin/inventory/drafts`. A pinned draft
 * adds the `#draft-<id>` anchor. `extra` carries result flags such as
 * `approved=1` (appended after the filters, never overriding them).
 */
export function draftsHref(opts: {
  status?: DraftView | null;
  manifestId?: string | null;
  draftId?: string | null;
  extra?: Record<string, string>;
} = {}): string {
  const qs = new URLSearchParams();
  if (opts.status && opts.status !== "draft") qs.set("status", opts.status);
  const manifestId = uuidOrNull(opts.manifestId);
  const draftId = uuidOrNull(opts.draftId);
  if (manifestId) qs.set("manifest", manifestId);
  if (draftId) qs.set("draft", draftId);
  for (const [k, v] of Object.entries(opts.extra ?? {})) {
    if (k && !qs.has(k)) qs.set(k, v);
  }
  const q = qs.toString();
  return `${DRAFTS_PATH}${q ? `?${q}` : ""}${draftId ? `#${draftRowAnchorId(draftId)}` : ""}`;
}

/** "Open this delivery's products" — the finalize/accept banner target. */
export function draftsForManifestHref(manifestId: string | null | undefined): string {
  return draftsHref({ manifestId: manifestId ?? null });
}

/**
 * Where "✨ Enrich now" goes. The enrichment page resolves its key against
 * the PUBLISHED menu and 404s when the key is not a card there, so the
 * per-product link is only used when the caller KNOWS the key is live.
 */
export function enrichHrefForDraft(d: {
  posProductKey: string | null | undefined;
  isOnLiveMenu: boolean;
  name: string | null | undefined;
}): string {
  const key = typeof d.posProductKey === "string" ? d.posProductKey.trim() : "";
  if (key && d.isOnLiveMenu) return `${ENRICH_LIST_PATH}/${encodeURIComponent(key)}`;
  return `${ENRICH_LIST_PATH}?q=${encodeURIComponent((d.name ?? "").trim())}`;
}

/** "(approved from <Vendor> manifest <number>)" — degrades, never invents. */
export function approvedFromPhrase(vendor: unknown, manifestNumber: unknown): string {
  const v = typeof vendor === "string" ? vendor.trim() : "";
  const n = typeof manifestNumber === "string" ? manifestNumber.trim() : "";
  if (v && n) return ` (approved from ${v} manifest ${n})`;
  if (v) return ` (approved from ${v})`;
  if (n) return ` (approved from manifest ${n})`;
  return "";
}

// ---------------------------------------------------------------------------
// Embedded self-tests (house pattern — registered in run-pure-selftests.ts)
// ---------------------------------------------------------------------------
export function __runDraftDeepLinkCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL draft-deep-link-core: " + msg);
    }
  };
  const A = "0b6f3c1e-2d4a-4f5b-9c8d-1a2b3c4d5e6f";
  const M = "9f8e7d6c-5b4a-4321-8fed-cba987654321";

  // isUuid
  ok(isUuid(A), "canonical uuid accepted");
  ok(isUuid(A.toUpperCase()), "upper-case uuid accepted");
  ok(!isUuid("not-a-uuid"), "junk rejected");
  ok(!isUuid(`${A}x`), "trailing junk rejected");
  ok(!isUuid(""), "empty rejected");
  ok(!isUuid(null) && !isUuid(42), "non-strings rejected");
  ok(!isUuid("0b6f3c1e2d4a4f5b9c8d1a2b3c4d5e6f"), "undashed rejected");

  // normalizeDraftView
  ok(normalizeDraftView("approved") === "approved", "approved view");
  ok(normalizeDraftView("dismissed") === "dismissed", "dismissed view");
  ok(normalizeDraftView("draft") === "draft", "draft view");
  ok(normalizeDraftView(undefined) === "draft", "missing → review queue");
  ok(normalizeDraftView("APPROVED") === "draft", "case-sensitive (matches DB)");

  // parseDraftFocus
  const f = parseDraftFocus({ status: "approved", manifest: M, draft: A.toUpperCase() });
  ok(f.view === "approved" && f.manifestId === M && f.draftId === A, "valid params parsed + lower-cased");
  const bad = parseDraftFocus({ manifest: "x'; drop", draft: "123" });
  ok(bad.manifestId === null && bad.draftId === null && bad.view === "draft", "invalid ids dropped");
  ok(parseDraftFocus({ draft: [A, A] }).draftId === null, "repeated param ignored");

  // effectiveDraftView
  ok(effectiveDraftView({ view: "draft", manifestId: null, draftId: A }, { status: "approved" }) === "approved",
    "pinned row's real status wins over the URL tab (F-060)");
  ok(effectiveDraftView({ view: "approved", manifestId: null, draftId: A }, null) === "approved",
    "pinned row not found → URL tab stands");
  ok(effectiveDraftView({ view: "dismissed", manifestId: null, draftId: null }, { status: "approved" }) === "dismissed",
    "no pin → URL tab stands");

  // draftsHref
  ok(draftsHref() === DRAFTS_PATH, "bare list URL unchanged");
  ok(draftsHref({ status: "draft" }) === DRAFTS_PATH, "default tab omitted");
  ok(draftsHref({ status: "approved", draftId: A }) === `${DRAFTS_PATH}?status=approved&draft=${A}#draft-${A}`,
    "pinned approved draft with anchor");
  ok(draftsHref({ manifestId: M }) === `${DRAFTS_PATH}?manifest=${M}`, "manifest filter");
  ok(draftsHref({ draftId: "bogus" }) === DRAFTS_PATH, "invalid draft id → list URL, no anchor");
  ok(draftsHref({ manifestId: M, extra: { approved: "1" } }) === `${DRAFTS_PATH}?manifest=${M}&approved=1`,
    "result flag appended after the filter");
  ok(draftsHref({ manifestId: M, extra: { manifest: "evil" } }).includes(`manifest=${M}`) &&
    !draftsHref({ manifestId: M, extra: { manifest: "evil" } }).includes("evil"),
    "extra can never override a validated filter");
  ok(draftsForManifestHref(M) === `${DRAFTS_PATH}?manifest=${M}`, "manifest banner link");
  ok(draftsForManifestHref(null) === DRAFTS_PATH, "no manifest → list URL");

  // enrichHrefForDraft
  ok(enrichHrefForDraft({ posProductKey: "LOT 1/2", isOnLiveMenu: true, name: "X" }) === "/admin/products/LOT%201%2F2",
    "live key → per-product page, key encoded");
  ok(enrichHrefForDraft({ posProductKey: "K1", isOnLiveMenu: false, name: "Blue Dream 3.5g" }) ===
    "/admin/products?q=Blue%20Dream%203.5g", "not live → search fallback (no 404)");
  ok(enrichHrefForDraft({ posProductKey: null, isOnLiveMenu: true, name: "" }) === "/admin/products?q=",
    "no key → search fallback even if flagged live");
  ok(enrichHrefForDraft({ posProductKey: "  ", isOnLiveMenu: true, name: "N" }) === "/admin/products?q=N",
    "blank key → search fallback");

  // approvedFromPhrase
  ok(approvedFromPhrase("Acme Farms", "0042") === " (approved from Acme Farms manifest 0042)", "full provenance");
  ok(approvedFromPhrase("Acme Farms", null) === " (approved from Acme Farms)", "vendor only");
  ok(approvedFromPhrase("", "0042") === " (approved from manifest 0042)", "number only");
  ok(approvedFromPhrase(null, " ") === "", "nothing known → nothing said");

  ok(draftRowAnchorId(A) === `draft-${A}`, "row anchor id");

  return { passed, failed };
}
