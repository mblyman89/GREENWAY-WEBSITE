/**
 * src/lib/enrichment/enrichment-manifest-core.ts  (S22 - Enrichment list:
 * filter by manifest/invoice, sort by newest from receiving)
 *
 * PURE. Everything the Product Enrichment list needs to answer "show me the
 * products from the invoice I just processed" (owner request R-ENRICH-FILTER;
 * findings F-081, F-079, F-008):
 *
 *   parseEnrichmentManifestParams  ?manifest= ?since= ?vendor= -> validated
 *   attributeCards                 which deliveries each live card came from,
 *                                  its LAST delivery and when it was received
 *   applyManifestFilters           the three new filters, as a pure function
 *   manifestPickerOptions          "From invoice/manifest:" choices (S14 label)
 *   receivedFromLabel              the table's "From delivery" cell
 *   enrichDeliveryHref             the "Enrich this delivery" link target
 *
 * GROUNDING (read in code, never guessed):
 *   - product_enrichments.last_manifest_id / last_received_at /
 *     first_manifest_id exist since 0234 but NOTHING writes them (grep finds
 *     them only in identity-columns-core.ts and enrichment/types.ts). The
 *     bible's primary source "populated in S05/S12" is therefore empty today,
 *     so this slice uses the bible's FALLBACK join, which is fully populated:
 *       menu_items.source_item_id  = the card's own lot key
 *       menu_variants.source_variant_id `<lotKey>-onboarded` = restock lots
 *       (vendor-identity-core.ts cardLotKeys - the S19 rule, reused as is)
 *       inventory_lots.pos_product_key -> inventory_lots.manifest_id
 *       -> inbound_manifests (manifest_number, vendor_label, received_at...)
 *   - The Cultivera migration hangs every lot it creates off ONE synthetic
 *     manifest numbered `POS-IMPORT-<8>` (import-service.ts), which SLICE 58
 *     made look like a native delivery in every other respect. The number is
 *     the only durable discriminator (classification-worklist-store.ts says
 *     the same). Those lots are shown under the 'Cultivera import'
 *     pseudo-manifest (bible S22.8), never as a delivery of their own.
 *   - When a lot was received:
 *       real delivery  inbound_manifests.received_at, else accepted_at (both
 *                      stamped by the lifecycle, 0032), else the lot's own
 *                      received_on (0214), else the lot row's created_at
 *                      (written when the delivery was staged).
 *       Cultivera lot  ONLY inventory_lots.received_on (the Cultivera
 *                      Received date, 0214). Its manifest's accepted_at is
 *                      the day the import ran, and a blank Received date
 *                      made created_at the import instant too, so neither is
 *                      a receipt date. Unknown stays unknown (null).
 *   - A card with no lot at all is not a receiving card (Rule 11: receiving
 *     and the one-time import are the only two doors, and every receiving
 *     card's key IS its lot's pos_product_key), so it sits under the
 *     'Cultivera import' pseudo-manifest too, with no received date.
 *
 * NEVER GUESS: when the server could not read the lots or manifests
 * completely, the caller passes `null` attributions and the filters are OFF
 * (every product shown, with a note) instead of showing a short list.
 *
 * No fs, no network, no Supabase. Embedded self-tests run in the pure runner
 * (scripts/compliance/run-pure-selftests.ts) and are pinned in vitest.
 */
import { cardLotKeys } from "@/lib/inventory/vendor-identity-core";
import { isUuid } from "@/lib/catalog/draft-deep-link-core";
import { manifestPickerLabel, shortDeliveryDate, type PickerManifestRow } from "@/lib/catalog/onboarding-list-core";

// --- 1. Constants ------------------------------------------------------------

/** The `?manifest=` value of the pseudo-manifest (bible S22.8). */
export const CULTIVERA_PSEUDO_MANIFEST = "cultivera";
/** Its display name, used as the "vendor" of the pseudo-manifest. */
export const CULTIVERA_PSEUDO_LABEL = "Cultivera import";
/** import-service.ts: `POS-IMPORT-${importId.slice(0, 8)}`. */
export const IMPORT_MANIFEST_PREFIX = "POS-IMPORT-";
/** "Received in the last N days" choices. */
export const SINCE_DAY_CHOICES = [1, 7, 30, 90] as const;
export type SinceDays = (typeof SINCE_DAY_CHOICES)[number];
/** Picker cap (same as S14's PICKER_MAX_MANIFESTS). */
export const ENRICH_PICKER_MAX = 100;
/** The bible's filter label (S22.4), word for word. */
export const MANIFEST_FILTER_LABEL = "From invoice/manifest:";
export const ENRICH_LIST_PATH = "/admin/products";
/** Shown when the lot/manifest read failed: filters off, never a short list. */
export const ATTRIBUTION_UNAVAILABLE_NOTE =
  "We couldn't read the receiving history just now, so the invoice/manifest, received and vendor filters are off and every product is shown. Reload to try again.";

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

// --- 2. URL params -------------------------------------------------------------

export type ManifestFilter = { kind: "manifest"; id: string } | { kind: "cultivera" } | null;

export type EnrichmentManifestParams = {
  manifest: ManifestFilter;
  sinceDays: SinceDays | null;
  vendorId: string | null;
};

function single(v: unknown): string | null {
  // ?manifest=a&manifest=b arrives as an array: ambiguous, so not a string -> ignored.
  return typeof v === "string" ? v.trim() : null;
}

/** Validate the three new params. Anything malformed is ignored, never guessed at. */
export function parseEnrichmentManifestParams(sp: {
  manifest?: unknown;
  since?: unknown;
  vendor?: unknown;
}): EnrichmentManifestParams {
  const m = single(sp.manifest);
  let manifest: ManifestFilter = null;
  if (m && m.toLowerCase() === CULTIVERA_PSEUDO_MANIFEST) manifest = { kind: "cultivera" };
  else if (m && isUuid(m)) manifest = { kind: "manifest", id: m.toLowerCase() };
  const s = single(sp.since);
  const n = s && /^\d+$/.test(s) ? Number(s) : NaN;
  const sinceDays = (SINCE_DAY_CHOICES as readonly number[]).includes(n) ? (n as SinceDays) : null;
  const v = single(sp.vendor);
  const vendorId = v && isUuid(v) ? v.toLowerCase() : null;
  return { manifest, sinceDays, vendorId };
}

/** True when any of the three new filters is set. */
export function hasManifestFilters(p: EnrichmentManifestParams): boolean {
  return p.manifest !== null || p.sinceDays !== null || p.vendorId !== null;
}

/** The `?manifest=` value for a parsed filter ("" when none). */
export function manifestParamValue(f: ManifestFilter): string {
  if (!f) return "";
  return f.kind === "cultivera" ? CULTIVERA_PSEUDO_MANIFEST : f.id;
}

// --- 3. Attribution ------------------------------------------------------------

/** inventory_lots named columns this slice reads. */
export type AttributionLot = {
  pos_product_key: string | null;
  manifest_id: string | null;
  vendor_id: string | null;
  created_at: string | null;
  received_on: string | null;
};

export type AttributionCard = { source_item_id: string; variants: { source_variant_id: string }[] };

/** GapFlags.lastManifest (bible S22.2): {id, number, vendor, receivedOn}. */
export type LastManifest = {
  /** A delivery's uuid, or CULTIVERA_PSEUDO_MANIFEST. */
  id: string;
  number: string | null;
  vendor: string | null;
  /** When it was received (ISO instant or YYYY-MM-DD), null when unknown. */
  receivedOn: string | null;
};

export type CardAttribution = {
  source: "delivery" | "cultivera";
  lastManifest: LastManifest;
  /** Newest known receipt of any of the card's lots (ISO), null when unknown. */
  lastReceivedAt: string | null;
  /** Every delivery (uuid, lower-case) any of the card's lots came from. */
  manifestIds: string[];
  /** Every vendor id on the card's lots or their deliveries. */
  vendorIds: string[];
};

export function isImportManifest(m: Pick<PickerManifestRow, "manifest_number"> | null | undefined): boolean {
  const n = typeof m?.manifest_number === "string" ? m.manifest_number.trim() : "";
  return n.toUpperCase().startsWith(IMPORT_MANIFEST_PREFIX);
}

function validInstant(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const t = v.trim();
  if (DATE_ONLY_RE.test(t)) return Number.isNaN(Date.parse(`${t}T00:00:00Z`)) ? null : `${t}T12:00:00.000Z`;
  const ms = Date.parse(t);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function lowerId(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim().toLowerCase() : null;
}

/**
 * When one lot was received, per the grounding above. A calendar date is
 * pinned to noon UTC so it sorts on the right day in any US zone.
 */
export function lotReceivedAt(lot: AttributionLot, manifest: PickerManifestRow | null | undefined): string | null {
  if (!manifest || isImportManifest(manifest)) return validInstant(lot.received_on);
  return (
    validInstant(manifest.received_at) ??
    validInstant(manifest.accepted_at) ??
    validInstant(lot.received_on) ??
    validInstant(lot.created_at)
  );
}

function newer(a: string | null, b: string | null): boolean {
  if (a === null) return false;
  if (b === null) return true;
  return Date.parse(a) > Date.parse(b);
}

/**
 * Attribute every card to the deliveries its lots came from. Keyed by the
 * card's source_item_id (= GapFlags.posKey).
 */
export function attributeCards(
  cards: readonly AttributionCard[],
  lots: readonly AttributionLot[],
  manifests: readonly PickerManifestRow[],
): Map<string, CardAttribution> {
  const manifestById = new Map<string, PickerManifestRow>();
  for (const m of manifests) {
    const id = lowerId(m.id);
    if (id) manifestById.set(id, m);
  }
  const lotsByKey = new Map<string, AttributionLot[]>();
  for (const l of lots) {
    const k = typeof l.pos_product_key === "string" ? l.pos_product_key.trim() : "";
    if (!k) continue;
    const arr = lotsByKey.get(k) ?? [];
    arr.push(l);
    lotsByKey.set(k, arr);
  }

  const out = new Map<string, CardAttribution>();
  for (const card of cards) {
    const manifestIds: string[] = [];
    const vendorIds: string[] = [];
    const addTo = (arr: string[], v: string | null) => {
      if (v && !arr.includes(v)) arr.push(v);
    };
    let best: { m: PickerManifestRow; at: string | null } | null = null;
    let lastReceivedAt: string | null = null;
    let importReceived: string | null = null;
    for (const key of cardLotKeys(card)) {
      for (const lot of lotsByKey.get(key) ?? []) {
        const mid = lowerId(lot.manifest_id);
        const m = mid ? manifestById.get(mid) ?? null : null;
        const at = lotReceivedAt(lot, m);
        addTo(vendorIds, lowerId(lot.vendor_id));
        if (newer(at, lastReceivedAt)) lastReceivedAt = at;
        if (!m || isImportManifest(m)) {
          if (newer(at, importReceived)) importReceived = at;
          continue;
        }
        addTo(manifestIds, mid);
        addTo(vendorIds, lowerId(m.vendor_id));
        // Newest receipt wins; equal/unknown times keep the lower id (stable).
        if (
          best === null ||
          newer(at, best.at) ||
          (!newer(best.at, at) && (at === null) === (best.at === null) && lowerId(m.id)! < lowerId(best.m.id)!)
        ) {
          best = { m, at };
        }
      }
    }
    const lastManifest: LastManifest = best
      ? {
          id: lowerId(best.m.id)!,
          number: clean(best.m.manifest_number) || null,
          vendor: clean(best.m.vendor_label) || null,
          receivedOn: best.at,
        }
      : { id: CULTIVERA_PSEUDO_MANIFEST, number: null, vendor: CULTIVERA_PSEUDO_LABEL, receivedOn: importReceived };
    out.set(card.source_item_id, {
      source: best ? "delivery" : "cultivera",
      lastManifest,
      lastReceivedAt,
      manifestIds,
      vendorIds,
    });
  }
  return out;
}

function clean(s: unknown): string {
  return typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "";
}

// --- 4. Filters ------------------------------------------------------------------

/** ISO start of the "received in the last N days" window. */
export function sinceCutoffIso(days: SinceDays, now: Date): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

export type ManifestFilterResult<T> = {
  rows: T[];
  /** False when a filter was asked for but attribution is unavailable. */
  applied: boolean;
};

/**
 * Apply ?manifest= ?since= ?vendor=. `attrs === null` (read failed) turns
 * the filters OFF - every row is returned and `applied` says so - because a
 * silently short list is exactly the thing the owner cannot see.
 */
export function applyManifestFilters<T extends { posKey: string }>(
  rows: readonly T[],
  p: EnrichmentManifestParams,
  attrs: ReadonlyMap<string, CardAttribution> | null,
  now: Date,
): ManifestFilterResult<T> {
  if (!hasManifestFilters(p)) return { rows: [...rows], applied: true };
  if (attrs === null) return { rows: [...rows], applied: false };
  const cutoff = p.sinceDays !== null ? Date.parse(sinceCutoffIso(p.sinceDays, now)) : null;
  const kept = rows.filter((r) => {
    const a = attrs.get(r.posKey);
    if (!a) return false;
    if (p.manifest?.kind === "cultivera" && a.source !== "cultivera") return false;
    if (p.manifest?.kind === "manifest" && !a.manifestIds.includes(p.manifest.id)) return false;
    if (cutoff !== null && (a.lastReceivedAt === null || Date.parse(a.lastReceivedAt) < cutoff)) return false;
    if (p.vendorId !== null && !a.vendorIds.includes(p.vendorId)) return false;
    return true;
  });
  return { rows: kept, applied: true };
}

// --- 5. Picker ----------------------------------------------------------------------

export type ManifestPickerOption = { value: string; label: string };

function manifestTime(m: PickerManifestRow): number {
  const t = validInstant(m.received_at) ?? validInstant(m.accepted_at) ?? validInstant(m.transfer_date);
  return t ? Date.parse(t) : Number.NEGATIVE_INFINITY;
}

/**
 * "From invoice/manifest:" choices: every real delivery that has at least
 * one card on the live menu, newest first (S14's label plus the live-card
 * count), then the 'Cultivera import' pseudo-manifest when it has cards. A
 * focused delivery beyond the cap is still offered so the select can show it.
 */
export function manifestPickerOptions(
  manifests: readonly PickerManifestRow[],
  attrs: ReadonlyMap<string, CardAttribution>,
  now: Date,
  focus: ManifestFilter = null,
): ManifestPickerOption[] {
  const perManifest = new Map<string, number>();
  let cultivera = 0;
  for (const a of attrs.values()) {
    if (a.source === "cultivera") cultivera += 1;
    for (const id of a.manifestIds) perManifest.set(id, (perManifest.get(id) ?? 0) + 1);
  }
  const live = manifests
    .filter((m) => !isImportManifest(m) && perManifest.has(lowerId(m.id) ?? ""))
    .sort((a, b) => manifestTime(b) - manifestTime(a) || (lowerId(a.id)! < lowerId(b.id)! ? -1 : 1));
  const focusId = focus?.kind === "manifest" ? focus.id : null;
  const shown = live.slice(0, ENRICH_PICKER_MAX);
  if (focusId && !shown.some((m) => lowerId(m.id) === focusId)) {
    const f = live.find((m) => lowerId(m.id) === focusId);
    if (f) shown.push(f);
  }
  const opts = shown.map((m) => {
    const n = perManifest.get(lowerId(m.id)!) ?? 0;
    return { value: lowerId(m.id)!, label: `${manifestPickerLabel(m, null, now)} \u00b7 ${n} live product${n === 1 ? "" : "s"}` };
  });
  if (cultivera > 0) {
    opts.push({ value: CULTIVERA_PSEUDO_MANIFEST, label: `${CULTIVERA_PSEUDO_LABEL} \u00b7 ${cultivera} live product${cultivera === 1 ? "" : "s"}` });
  }
  return opts;
}

/**
 * Vendor choices for ?vendor=: the vendor of every delivery offered in the
 * picker (so every choice can match at least one card), deduped by id, A-Z.
 * Read from rows already in hand - no extra query.
 */
export function deliveryVendorChoices(
  manifests: readonly PickerManifestRow[],
  options: readonly ManifestPickerOption[],
): { id: string; label: string }[] {
  const offered = new Set(options.map((o) => o.value));
  const byId = new Map<string, string>();
  for (const m of manifests) {
    const id = lowerId(m.id);
    const vid = lowerId(m.vendor_id);
    const label = clean(m.vendor_label);
    if (!id || !vid || !label || !offered.has(id) || byId.has(vid)) continue;
    byId.set(vid, label);
  }
  return Array.from(byId.entries())
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "en", { sensitivity: "base" }) || (a.id < b.id ? -1 : 1));
}

/** "Received in the last 7 days" etc. */
export function sinceLabel(days: SinceDays): string {
  return days === 1 ? "Received in the last day" : `Received in the last ${days} days`;
}

// --- 6. Display -------------------------------------------------------------------

/** The table's "From delivery" cell: "0421 · Phat Panda · Mar 12", "Cultivera import · Jan 3", or "—". */
export function receivedFromLabel(a: CardAttribution | null | undefined, now: Date): string {
  if (!a) return "\u2014";
  const lm = a.lastManifest;
  const parts: string[] = [];
  if (a.source === "cultivera") parts.push(CULTIVERA_PSEUDO_LABEL);
  else {
    parts.push(lm.number ?? "No manifest #");
    if (lm.vendor) parts.push(lm.vendor);
  }
  const day = shortDeliveryDate(lm.receivedOn, now);
  if (day) parts.push(day);
  return parts.join(" \u00b7 ");
}

/** The heading of the "only one delivery" banner. */
export function manifestFocusSentence(f: ManifestFilter, options: readonly ManifestPickerOption[]): string | null {
  if (!f) return null;
  const v = manifestParamValue(f);
  const opt = options.find((o) => o.value === v);
  if (f.kind === "cultivera") return `Showing only products from the ${CULTIVERA_PSEUDO_LABEL} (no receiving delivery yet).`;
  return opt ? `Showing only products from ${opt.label.replace(/ \u00b7 \d+ live products?$/, "")}.` : "Showing only products from one delivery.";
}

/**
 * Where "Enrich this delivery's products" goes: the enrichment list filtered
 * to that delivery, newest first, scrolled to the worklist. A bad id falls
 * back to the plain list (never a filter nobody can see).
 */
export function enrichDeliveryHref(manifestId: unknown): string {
  if (!isUuid(manifestId)) return ENRICH_LIST_PATH;
  return `${ENRICH_LIST_PATH}?manifest=${manifestId.trim().toLowerCase()}&sort=newest#worklist`;
}

// --- 7. Self-tests ---------------------------------------------------------------

export function __runEnrichmentManifestCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`  FAIL enrichment-manifest-core: ${label}`);
    }
  };
  const M1 = "11111111-1111-4111-8111-111111111111";
  const M2 = "22222222-2222-4222-8222-222222222222";
  const MI = "99999999-9999-4999-8999-999999999999";
  const V1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const V2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const now = new Date("2025-03-20T18:00:00Z");
  const man = (o: Partial<PickerManifestRow> & { id: string }): PickerManifestRow => ({
    manifest_number: null, vendor_id: null, vendor_label: null, transfer_date: null,
    received_at: null, accepted_at: null, status: "accepted", ...o,
  });
  const lot = (o: Partial<AttributionLot>): AttributionLot => ({
    pos_product_key: null, manifest_id: null, vendor_id: null, created_at: null, received_on: null, ...o,
  });

  // params
  const p = parseEnrichmentManifestParams({ manifest: M1.toUpperCase(), since: "7", vendor: ` ${V1} ` });
  ok(p.manifest?.kind === "manifest" && p.manifest.id === M1 && p.sinceDays === 7 && p.vendorId === V1, "valid params parsed + lower-cased");
  const hex = parseEnrichmentManifestParams({ manifest: V2.toUpperCase() }).manifest;
  ok(hex?.kind === "manifest" && hex.id === V2, "hex-letter manifest id lower-cased");
  ok(parseEnrichmentManifestParams({ manifest: "Cultivera" }).manifest?.kind === "cultivera", "pseudo-manifest parsed case-insensitively");
  const bad = parseEnrichmentManifestParams({ manifest: "x'; drop", since: "5", vendor: "nope" });
  ok(bad.manifest === null && bad.sinceDays === null && bad.vendorId === null, "junk ignored");
  ok(parseEnrichmentManifestParams({ manifest: [M1, M2], since: ["7"] }).manifest === null, "repeated params ignored");
  ok(parseEnrichmentManifestParams({ since: "7.0" }).sinceDays === null && parseEnrichmentManifestParams({ since: " 90 " }).sinceDays === 90, "since: whole choices only, trimmed");
  ok(!hasManifestFilters(parseEnrichmentManifestParams({})), "no params -> no filter");
  ok(hasManifestFilters({ manifest: null, sinceDays: 1, vendorId: null }) && hasManifestFilters({ manifest: null, sinceDays: null, vendorId: V1 }), "since or vendor alone counts");
  ok(manifestParamValue({ kind: "cultivera" }) === "cultivera" && manifestParamValue(null) === "" && manifestParamValue({ kind: "manifest", id: M1 }) === M1, "param round-trip");

  // lotReceivedAt
  const real = man({ id: M1, received_at: "2025-03-18T20:00:00Z", accepted_at: "2025-03-19T20:00:00Z" });
  ok(lotReceivedAt(lot({ created_at: "2025-03-01T00:00:00Z" }), real) === "2025-03-18T20:00:00.000Z", "real delivery: received_at first");
  ok(lotReceivedAt(lot({}), man({ id: M1, accepted_at: "2025-03-19T20:00:00Z" })) === "2025-03-19T20:00:00.000Z", "then accepted_at");
  ok(lotReceivedAt(lot({ received_on: "2025-03-10", created_at: "2025-03-11T00:00:00Z" }), man({ id: M1 })) === "2025-03-10T12:00:00.000Z", "then lot received_on at noon");
  ok(lotReceivedAt(lot({ created_at: "2025-03-11T01:02:03Z" }), man({ id: M1 })) === "2025-03-11T01:02:03.000Z", "then created_at");
  const imp = man({ id: MI, manifest_number: " pos-import-abcd1234", accepted_at: "2025-02-01T00:00:00Z" });
  ok(lotReceivedAt(lot({ created_at: "2025-02-01T00:00:00Z" }), imp) === null, "import lot: accepted_at/created_at are NOT receipts");
  ok(lotReceivedAt(lot({ received_on: "2024-11-05" }), imp) === "2024-11-05T12:00:00.000Z", "import lot: received_on only");
  ok(lotReceivedAt(lot({ received_on: "junk", created_at: "2025-01-01T00:00:00Z" }), null) === null, "no manifest: bad date -> unknown");
  ok(isImportManifest({ manifest_number: "POS-IMPORT-1" }) && !isImportManifest({ manifest_number: "0421" }) && !isImportManifest(null), "import discriminator");

  // attributeCards
  const m2 = man({ id: M2, manifest_number: "0500", vendor_id: V2, vendor_label: "Phat  Panda", received_at: "2025-03-19T17:00:00Z" });
  const m1 = man({ id: M1, manifest_number: "0421", vendor_id: V1, vendor_label: "Acme", received_at: "2025-03-12T20:00:00Z" });
  const cards: AttributionCard[] = [
    { source_item_id: "LOT-A", variants: [{ source_variant_id: "LOT-A-onboarded" }, { source_variant_id: "LOT-B-onboarded" }] },
    { source_item_id: "pos-cult", variants: [{ source_variant_id: "pos-cult-x1" }] },
    { source_item_id: "pos-restocked", variants: [{ source_variant_id: "LOT-C-onboarded" }] },
    { source_item_id: "NOLOTS", variants: [] },
  ];
  const lots: AttributionLot[] = [
    lot({ pos_product_key: "LOT-A", manifest_id: M1.toUpperCase(), vendor_id: V1 }),
    lot({ pos_product_key: " LOT-B ", manifest_id: M2 }),
    lot({ pos_product_key: "pos-cult", manifest_id: MI, vendor_id: V1, received_on: "2024-06-01" }),
    lot({ pos_product_key: "pos-cult", manifest_id: MI, received_on: "2024-09-01" }),
    lot({ pos_product_key: "pos-restocked", manifest_id: MI, received_on: "2024-01-01" }),
    lot({ pos_product_key: "LOT-C", manifest_id: M1 }),
    lot({ pos_product_key: "", manifest_id: M2 }),
  ];
  const attrs = attributeCards(cards, lots, [m1, m2, imp]);
  const a = attrs.get("LOT-A")!;
  ok(a.source === "delivery" && a.lastManifest.id === M2 && a.lastManifest.number === "0500" && a.lastManifest.vendor === "Phat Panda", "restock variant's newer delivery is the LAST manifest");
  ok(a.lastReceivedAt === "2025-03-19T17:00:00.000Z" && a.lastManifest.receivedOn === a.lastReceivedAt, "lastReceivedAt = newest lot receipt");
  ok(a.manifestIds.length === 2 && a.manifestIds.includes(M1) && a.manifestIds.includes(M2), "every delivery listed (ids lower-cased)");
  ok(a.vendorIds.includes(V1) && a.vendorIds.includes(V2) && a.vendorIds.length === 2, "lot + delivery vendor ids, deduped");
  const c = attrs.get("pos-cult")!;
  ok(c.source === "cultivera" && c.lastManifest.id === "cultivera" && c.lastManifest.vendor === "Cultivera import" && c.lastManifest.number === null, "import-only card -> pseudo-manifest");
  ok(c.lastReceivedAt === "2024-09-01T12:00:00.000Z" && c.lastManifest.receivedOn === "2024-09-01T12:00:00.000Z", "pseudo carries the newest Cultivera Received date");
  ok(c.manifestIds.length === 0 && c.vendorIds.length === 1, "import manifest never listed as a delivery; its lot vendor kept");
  const r = attrs.get("pos-restocked")!;
  ok(r.source === "delivery" && r.lastManifest.id === M1 && r.manifestIds.join() === M1, "Cultivera card restocked by receiving -> that delivery");
  ok(r.lastReceivedAt === "2025-03-12T20:00:00.000Z", "restock newer than the import date");
  const n = attrs.get("NOLOTS")!;
  ok(n.source === "cultivera" && n.lastReceivedAt === null && n.lastManifest.receivedOn === null, "no lots -> pseudo-manifest, unknown date");
  ok(attrs.size === 4, "one attribution per card");
  const unknownMan = attributeCards([{ source_item_id: "K", variants: [] }], [lot({ pos_product_key: "K", manifest_id: M2, created_at: "2025-01-01T00:00:00Z" })], []);
  ok(unknownMan.get("K")!.source === "cultivera" && unknownMan.get("K")!.lastReceivedAt === null, "lot whose delivery wasn't read -> not claimed as a delivery");
  // tie-break: equal times -> lower id, order independent
  const tieM1 = man({ id: M1, manifest_number: "A", received_at: "2025-03-01T00:00:00Z" });
  const tieM2 = man({ id: M2, manifest_number: "B", received_at: "2025-03-01T00:00:00Z" });
  const tieLots = [lot({ pos_product_key: "T", manifest_id: M2 }), lot({ pos_product_key: "T", manifest_id: M1 })];
  ok(attributeCards([{ source_item_id: "T", variants: [] }], tieLots, [tieM1, tieM2]).get("T")!.lastManifest.number === "A", "equal receipt -> lower id wins");
  ok(attributeCards([{ source_item_id: "T", variants: [] }], [...tieLots].reverse(), [tieM2, tieM1]).get("T")!.lastManifest.number === "A", "tie-break is order independent");
  const known = man({ id: M2, manifest_number: "K", received_at: "2025-03-01T00:00:00Z" });
  const blank = man({ id: M1, manifest_number: "U" });
  ok(attributeCards([{ source_item_id: "T", variants: [] }], tieLots, [known, blank]).get("T")!.lastManifest.number === "K", "known time beats unknown even with a higher id");
  ok(attributeCards([{ source_item_id: "T", variants: [] }], [...tieLots].reverse(), [known, blank]).get("T")!.lastManifest.number === "K", "known beats unknown, either order");
  const noNum = attributeCards([{ source_item_id: "Z", variants: [] }], [lot({ pos_product_key: "Z", manifest_id: M1 })], [man({ id: M1, manifest_number: "  ", vendor_label: " " })]);
  ok(noNum.get("Z")!.lastManifest.number === null && noNum.get("Z")!.lastManifest.vendor === null, "blank number/vendor -> null, never invented");

  // filters
  type Row = { posKey: string; name: string };
  const rows: Row[] = ["LOT-A", "pos-cult", "pos-restocked", "NOLOTS", "GONE"].map((k) => ({ posKey: k, name: k }));
  const none = parseEnrichmentManifestParams({});
  ok(applyManifestFilters(rows, none, null, now).rows.length === 5 && applyManifestFilters(rows, none, null, now).applied, "no filter -> all rows, applied");
  const byM1 = applyManifestFilters(rows, parseEnrichmentManifestParams({ manifest: M1 }), attrs, now);
  ok(byM1.applied && byM1.rows.map((x) => x.posKey).join() === "LOT-A,pos-restocked", "?manifest=M1 -> only that delivery's cards (any lot)");
  ok(applyManifestFilters(rows, parseEnrichmentManifestParams({ manifest: M2 }), attrs, now).rows.map((x) => x.posKey).join() === "LOT-A", "?manifest=M2 -> restock variant's card");
  ok(applyManifestFilters(rows, parseEnrichmentManifestParams({ manifest: "cultivera" }), attrs, now).rows.map((x) => x.posKey).join() === "pos-cult,NOLOTS", "pseudo-manifest -> import-only + lotless cards");
  ok(applyManifestFilters(rows, parseEnrichmentManifestParams({ since: "7" }), attrs, now).rows.map((x) => x.posKey).join() === "LOT-A", "since=7 -> received in the last week only");
  ok(applyManifestFilters(rows, parseEnrichmentManifestParams({ since: "30" }), attrs, now).rows.map((x) => x.posKey).join() === "LOT-A,pos-restocked", "since=30 -> unknown dates excluded");
  ok(applyManifestFilters(rows, parseEnrichmentManifestParams({ vendor: V2 }), attrs, now).rows.map((x) => x.posKey).join() === "LOT-A", "vendor via delivery vendor");
  ok(applyManifestFilters(rows, parseEnrichmentManifestParams({ vendor: V1 }), attrs, now).rows.map((x) => x.posKey).join() === "LOT-A,pos-cult,pos-restocked", "vendor via lot vendor (Cultivera included) + restock delivery vendor");
  ok(applyManifestFilters(rows, parseEnrichmentManifestParams({ manifest: M1, vendor: V2 }), attrs, now).rows.length === 1, "filters AND together");
  ok(applyManifestFilters(rows, parseEnrichmentManifestParams({ manifest: M1, since: "7" }), attrs, now).rows.map((x) => x.posKey).join() === "LOT-A", "manifest AND since");
  const off = applyManifestFilters(rows, parseEnrichmentManifestParams({ manifest: M1 }), null, now);
  ok(!off.applied && off.rows.length === 5, "read failed -> filters OFF, every row, flagged");
  ok(!applyManifestFilters(rows, parseEnrichmentManifestParams({ manifest: M1 }), attrs, now).rows.some((x) => x.posKey === "GONE"), "card without attribution never matches");
  const edge = new Map([["E", { ...attrs.get("LOT-A")!, lastReceivedAt: sinceCutoffIso(7, now) }]]);
  ok(applyManifestFilters([{ posKey: "E" }], parseEnrichmentManifestParams({ since: "7" }), edge, now).rows.length === 1, "since window is inclusive at the cutoff");
  ok(sinceCutoffIso(1, now) === "2025-03-19T18:00:00.000Z", "cutoff arithmetic");

  // picker
  const opts = manifestPickerOptions([m1, m2, imp, man({ id: "33333333-3333-4333-8333-333333333333", manifest_number: "EMPTY" })], attrs, now);
  ok(opts.length === 3, "only deliveries with live cards + the pseudo");
  ok(opts[0]!.value === M2 && opts[1]!.value === M1 && opts[2]!.value === "cultivera", "newest delivery first, pseudo last");
  ok(opts[0]!.label === "0500 \u00b7 Phat Panda \u00b7 Mar 19 \u00b7 1 live product", "S14 label + singular count");
  ok(opts[1]!.label.endsWith("\u00b7 2 live products") && opts[2]!.label === "Cultivera import \u00b7 2 live products", "plural counts");
  ok(!opts.some((o) => o.label.includes("POS-IMPORT")), "synthetic manifest never offered by number");
  const many = Array.from({ length: ENRICH_PICKER_MAX + 2 }, (_, i) => man({ id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, received_at: new Date(Date.UTC(2025, 0, 1) + i * DAY_MS).toISOString() }));
  const manyAttrs = new Map(many.map((m, i) => [`k${i}`, { source: "delivery" as const, lastManifest: { id: m.id, number: null, vendor: null, receivedOn: null }, lastReceivedAt: null, manifestIds: [m.id], vendorIds: [] }]));
  const capped = manifestPickerOptions(many, manyAttrs, now);
  ok(capped.length === ENRICH_PICKER_MAX && !capped.some((o) => o.value === many[0]!.id), "capped, oldest dropped");
  const withFocus = manifestPickerOptions(many, manyAttrs, now, { kind: "manifest", id: many[0]!.id });
  ok(withFocus.length === ENRICH_PICKER_MAX + 1 && withFocus[withFocus.length - 1]!.value === many[0]!.id, "focused old delivery still offered");
  ok(manifestPickerOptions(many, manyAttrs, now, { kind: "manifest", id: M1 }).length === ENRICH_PICKER_MAX, "unknown focus adds nothing");
  ok(manifestPickerOptions([], new Map(), now).length === 0, "empty -> no options");

  // vendor choices
  const vc = deliveryVendorChoices([m1, m2, imp, man({ id: "33333333-3333-4333-8333-333333333333", vendor_id: V1, vendor_label: "Zed" })], opts);
  ok(vc.length === 2 && vc[0]!.label === "Acme" && vc[1]!.label === "Phat Panda" && vc[1]!.id === V2, "vendors of offered deliveries, A-Z, whitespace collapsed");
  ok(!vc.some((v) => v.label === "Zed"), "vendor of a delivery with no live card not offered");
  const dupVendor = deliveryVendorChoices([m1, man({ id: M2, vendor_id: V1.toUpperCase(), vendor_label: "Acme Two" })], [{ value: M1, label: "" }, { value: M2, label: "" }]);
  ok(dupVendor.length === 1 && dupVendor[0]!.label === "Acme", "same vendor id once (first label kept)");
  ok(deliveryVendorChoices([man({ id: M1, vendor_id: null, vendor_label: "X" }), man({ id: M2, vendor_id: V2, vendor_label: " " })], [{ value: M1, label: "" }, { value: M2, label: "" }]).length === 0, "no id or no label -> not offered");

  // labels + links
  ok(receivedFromLabel(a, now) === "0500 \u00b7 Phat Panda \u00b7 Mar 19", "From delivery cell");
  ok(receivedFromLabel(c, now) === "Cultivera import \u00b7 Sep 1, 2024", "pseudo cell with its date");
  ok(receivedFromLabel(n, now) === "Cultivera import", "pseudo cell, unknown date");
  ok(receivedFromLabel(noNum.get("Z")!, now) === "No manifest #", "no number -> honest placeholder");
  ok(receivedFromLabel(null, now) === "\u2014", "no attribution -> dash");
  ok(sinceLabel(1) === "Received in the last day" && sinceLabel(30) === "Received in the last 30 days", "since labels");
  ok(manifestFocusSentence(null, opts) === null, "no focus -> no banner");
  ok(manifestFocusSentence({ kind: "manifest", id: M2 }, opts) === "Showing only products from 0500 \u00b7 Phat Panda \u00b7 Mar 19.", "banner names the delivery without the count");
  ok(manifestFocusSentence({ kind: "manifest", id: M1 }, opts) === "Showing only products from 0421 \u00b7 Acme \u00b7 Mar 12.", "banner strips the plural count");
  ok(manifestFocusSentence({ kind: "manifest", id: "44444444-4444-4444-8444-444444444444" }, opts) === "Showing only products from one delivery.", "unknown delivery -> generic");
  ok(manifestFocusSentence({ kind: "cultivera" }, opts)!.includes("Cultivera import"), "pseudo banner");
  ok(enrichDeliveryHref(M1.toUpperCase()) === `/admin/products?manifest=${M1}&sort=newest#worklist`, "delivery link: filtered, newest, worklist");
  ok(enrichDeliveryHref("bogus") === "/admin/products" && enrichDeliveryHref(null) === "/admin/products", "bad id -> plain list");
  ok(MANIFEST_FILTER_LABEL === "From invoice/manifest:", "bible S22.4 label verbatim");

  if (failed > 0) throw new Error(`enrichment-manifest-core: ${failed} failure(s)`);
  return { passed, failed };
}
