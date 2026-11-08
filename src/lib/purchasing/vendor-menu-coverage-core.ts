/**
 * src/lib/purchasing/vendor-menu-coverage-core.ts
 *
 * D209 — PURE logic behind the Vendor Menus coverage view
 * (/admin/purchasing/menus). Owner (verbatim, docs/sop-program/
 * 00-OWNER-REQUEST-VERBATIM.md D209): "I want to add as much details to that
 * table as possible ... I also want to add a table of all vendors we have
 * products from that have not yet been searched, so it's much easier for me
 * to see who I still need menus from."
 *
 * Two tables are built here from plain rows (the store reads them):
 *
 *   1. SEARCHED — ONE row per vendor (not per snapshot), rolling up every
 *      saved menu from Cultivera, GrowFlow, LeafLink and email: which of OUR
 *      vendors it is and HOW we know (D209b), per-source age, freshness, the
 *      latest menu's item count and change vs the previous pull, wholesale
 *      price spread (MINOR UNITS, rule 8), THC, top categories, photo / COA /
 *      in-stock coverage, our own lots, and the full pull history.
 *
 *   2. NEEDED — every vendor with at least one inventory lot (receiving is the
 *      real pipeline, rule 11) and NO usable menu, grouped by urgency
 *      (on the shelf now / received in the last 90 Pacific days / older).
 *
 * Matching never guesses (rule 3): the snapshot's own vendor link, then a WA
 * license number, then the receiving `normalizeVendorKey` name identity over
 * display name / DBA / legal name / aliases / brands. A name that fits more
 * than one vendor matches NONE and is reported as ambiguous.
 *
 * Pure: no I/O, no Date.now() (callers pass `nowMs`). Self-tested below
 * (registered in scripts/compliance/run-pure-selftests.ts) and mirrored in
 * tests/compliance/d209-vendor-menu-coverage.test.ts.
 */

import {
  normalizeVendorKey,
  normalizeLicense,
  stripLicenseSuffix,
  extractLicenseFromLabel,
} from "@/lib/inventory/vendor-resolve-core";
import { pacificDayKey } from "@/lib/reports/timezone";
import { vendorMailtoHref } from "@/lib/vendors/vendor-relations-core";

/* ------------------------------------------------------------------
 * Input shapes (structural; the store maps DB rows into these)
 * ------------------------------------------------------------------ */

export type MenuSource = "cultivera" | "growflow" | "leaflink" | "email";

export const MENU_SOURCES: readonly MenuSource[] = ["cultivera", "growflow", "leaflink", "email"];

export type CoverageVendor = {
  id: string;
  display_name: string;
  slug: string | null;
  dba: string | null;
  legal_name: string | null;
  license_number: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  is_active: boolean | null;
  total_accepted_ytd_cents: number | null;
  last_accepted_at: string | null;
  /** D212 — read so the page can show / fetch the vendor's logo. */
  status?: string | null;
  logo_media_id?: string | null;
  /** D213 — survivor id parsed from an archived card's "Merged into … (<uuid>)" note (mergedIntoFromNotes). */
  merged_into_id?: string | null;
};

export type CoverageAlias = { vendor_id: string; source_name: string; source_system?: string | null };
export type CoverageBrand = { vendor_id: string | null; display_name: string };

export type CoverageLot = {
  vendor_id: string;
  on_hand_qty: number | null;
  status: string | null;
  received_on: string | null;
  created_at: string | null;
  category: string | null;
};

/** One saved menu pull from any source, already mapped to common fields. */
export type CoverageSnapshot = {
  source: MenuSource;
  id: string;
  /** vendors.id the snapshot row itself carries (only email sets it today). */
  vendorId: string | null;
  /** Primary name the source gave (seller / store / brand / sender). */
  label: string;
  /** Secondary name to try for matching (LeafLink company). */
  altLabel: string | null;
  license: string | null;
  status: string;
  itemCount: number;
  fetchedAt: string;
  errorMessage: string | null;
};

/** The few per-item facts the rollup needs (newest snapshot per source only). */
export type CoverageItem = {
  snapshotId: string;
  priceMinor: number | null;
  thcPct: number | null;
  category: string | null;
  hasImage: boolean;
  hasCoa: boolean;
  availableQty: number | null;
};

export type CoverageMemory = {
  vendor_key: string;
  vendor_name: string | null;
  license_number: string | null;
  platform: string;
  last_seen_at: string;
};

/* ------------------------------------------------------------------
 * Small helpers
 * ------------------------------------------------------------------ */

const DAY_MS = 86_400_000;

export const FRESH_DAYS = 7;
export const STALE_DAYS = 30;
export const RECENT_RECEIVED_DAYS = 90;

export function sourceLabel(s: MenuSource): string {
  if (s === "growflow") return "GrowFlow";
  if (s === "leaflink") return "LeafLink";
  if (s === "email") return "Emailed";
  return "Cultivera";
}

export function sourceTone(s: MenuSource): "green" | "gold" | "orange" | "neutral" {
  if (s === "growflow") return "gold";
  if (s === "leaflink") return "orange";
  if (s === "email") return "neutral";
  return "green";
}

/** Where a saved snapshot opens. */
export function snapshotHref(s: MenuSource, id: string): string {
  if (s === "growflow") return `/admin/purchasing/menus/growflow/${id}`;
  if (s === "leaflink") return `/admin/purchasing/menus/leaflink/${id}`;
  if (s === "email") return `/admin/purchasing/menus/email/${id}`;
  return `/admin/purchasing/menus/${id}`;
}

function ts(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

/** A pull we can actually buy from: a good status AND at least one item. */
export function isUsableSnapshot(s: { status: string; itemCount: number }): boolean {
  const st = (s.status ?? "").trim().toLowerCase();
  return (st === "fetched" || st === "parsed" || st === "partial") && s.itemCount > 0;
}

export type Freshness = "fresh" | "aging" | "stale" | "unknown";

/** fresh ≤ 7 days, aging ≤ 30 days, stale after that (D209a). */
export function menuFreshness(fetchedAt: string | null | undefined, nowMs: number): Freshness {
  const t = ts(fetchedAt);
  if (!t) return "unknown";
  const days = (nowMs - t) / DAY_MS;
  if (days <= FRESH_DAYS) return "fresh";
  if (days <= STALE_DAYS) return "aging";
  return "stale";
}

export function freshnessTone(f: Freshness): "green" | "gold" | "danger" | "neutral" {
  if (f === "fresh") return "green";
  if (f === "aging") return "gold";
  if (f === "stale") return "danger";
  return "neutral";
}

/** "just now" / "5m ago" / "3h ago" / "12d ago" / "" for a bad date. */
export function ageLabel(iso: string | null | undefined, nowMs: number): string {
  const t = ts(iso);
  if (!t) return "";
  const mins = Math.floor(Math.max(0, nowMs - t) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Whole Pacific calendar days from `fromIso` to now (rule 9). null for a bad date. */
export function pacificDaysSince(fromIso: string | null | undefined, nowMs: number): number | null {
  if (!fromIso) return null;
  // A bare YYYY-MM-DD (received_on) IS a Pacific business day already.
  const fromKey = /^\d{4}-\d{2}-\d{2}$/.test(fromIso) ? fromIso : ts(fromIso) ? pacificDayKey(new Date(ts(fromIso))) : "";
  if (!fromKey) return null;
  const toKey = pacificDayKey(new Date(nowMs));
  const toUtc = (k: string) => Date.UTC(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, Number(k.slice(8, 10)));
  return Math.max(0, Math.round((toUtc(toKey) - toUtc(fromKey)) / DAY_MS));
}

/** Median of integers (lower-middle for even counts, so cents stay whole). */
export function medianInt(values: readonly number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).slice().sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 === 1 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
}

/** $#,###.## from MINOR UNITS — conversion at the display boundary only (rule 8). */
export function money(minor: number | null | undefined): string {
  if (minor === null || minor === undefined || !Number.isFinite(minor)) return "—";
  const n = Math.trunc(minor);
  const abs = Math.abs(n);
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  return `${n < 0 ? "-" : ""}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

export function pct(part: number, whole: number): number | null {
  if (!whole) return null;
  return Math.round((part / whole) * 100);
}

/* ------------------------------------------------------------------
 * Vendor matching (D209b, rebuilt in D213) — shown, never hidden
 *
 * D213 (owner, verbatim in 00-OWNER-REQUEST-VERBATIM.md): several vendors sat
 * in BOTH tables and many menus said "not linked to a vendor". Live data
 * showed three causes, each handled here:
 *
 *   A. Duplicate cards. One business often has 2–3 vendor cards (a license
 *      per card from the statewide import, or a hand-made card next to an
 *      imported one). A license or name that hit two cards used to match
 *      NONE. Now the tie is broken in a fixed, explained order: a live card
 *      beats an archived one; the card we actually receive from (has lots)
 *      beats one we don't; a published card beats a draft. Only a tie that
 *      survives all three is still "fits more than one vendor".
 *   B. Merged (archived) cards. `merge_vendors()` archives a duplicate and
 *      writes "Merged into "X" (<uuid>)" on it. Those cards stayed in the
 *      lookup maps and created false ties. Now every archived merged card
 *      resolves to its surviving card (chains followed, loops refused), and
 *      the `license:<n>` aliases the merge writes count as license numbers.
 *   C. Menus name the seller differently. Cultivera menus carry NO license at
 *      all, and seller names add legal suffixes, marketing tails, brand lists
 *      and trademark signs. The menu name is now also tried cleaned (see
 *      `menuNameVariants`), suffix-insensitive, space-insensitive, by the web
 *      address slug, and part by part — each step reported.
 *
 * A menu the owner links by hand ("Link to vendor", a `source_system='menu'`
 * alias) wins over everything except a vendor id stamped on the menu itself.
 * ------------------------------------------------------------------ */

export type MatchHow = "linked" | "license" | "name" | "alias" | "brand" | "ambiguous" | "none";

export type VendorMatch = {
  vendorId: string | null;
  how: MatchHow;
  candidates: number;
  /** D213 — plain-English reason when the match needed more than an exact hit (rule 3: show reasons). */
  detail?: string | null;
  /** D213 — other live cards that look like the same business (merge candidates). */
  duplicateIds?: string[];
};

export function matchHowLabel(how: MatchHow): string {
  switch (how) {
    case "linked":
      return "linked on the menu";
    case "license":
      return "matched by license #";
    case "name":
      return "matched by name";
    case "alias":
      return "matched by a known alias";
    case "brand":
      return "matched by brand";
    case "ambiguous":
      return "name fits more than one vendor";
    default:
      return "not linked to a vendor";
  }
}

export type VendorMatcher = (s: Pick<CoverageSnapshot, "vendorId" | "label" | "altLabel" | "license">) => VendorMatch;

/** Alias rows written by "Link to vendor" on the menus page (D213). */
export const MENU_LINK_ALIAS_SYSTEM = "menu";

/** Where "Link to vendor" stamps vendor_id: the snapshot table and the column the menu's seller name came from. */
export function menuLinkSnapshotTable(source: MenuSource): { table: string; nameColumn: string } {
  if (source === "growflow") return { table: "growflow_menu_snapshots", nameColumn: "store_name" };
  if (source === "leaflink") return { table: "leaflink_menu_snapshots", nameColumn: "brand_name" };
  if (source === "email") return { table: "emailed_menu_snapshots", nameColumn: "from_name" };
  return { table: "cultivera_menu_snapshots", nameColumn: "seller_name" };
}

/** One live vendor card in the "Link to vendor" picker. */
export type VendorPickOption = { id: string; label: string };

/** One (source, seller name) a row's "Link to vendor" will remember — deduped, at most 6. */
export type MenuLinkTarget = { source: MenuSource; label: string };

export function menuLinkTargets(history: readonly { source: MenuSource; label: string }[]): MenuLinkTarget[] {
  const out: MenuLinkTarget[] = [];
  const seen = new Set<string>();
  for (const h of history) {
    const label = (h.label ?? "").trim();
    if (!label) continue;
    const k = `${h.source}|${label}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ source: h.source, label });
    if (out.length >= 6) break;
  }
  return out;
}

/** Parse the picker's hidden `targets` field; anything malformed is dropped (never trusted). */
export function parseMenuLinkTargets(raw: string): MenuLinkTarget[] {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(v)) return [];
  const out: MenuLinkTarget[] = [];
  for (const t of v.slice(0, 6)) {
    if (!t || typeof t !== "object") continue;
    const src = (t as { source?: unknown }).source;
    const label = (t as { label?: unknown }).label;
    if (typeof src !== "string" || !(MENU_SOURCES as readonly string[]).includes(src)) continue;
    if (typeof label !== "string" || !label.trim() || label.length > 300) continue;
    out.push({ source: src as MenuSource, label: label.trim() });
  }
  return menuLinkTargets(out);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The surviving card id from an archived card's Internal notes, as written by
 * merge_vendors() (migration 0104): `Merged into "X" (<uuid>) on YYYY-MM-DD.`
 * The LAST such note wins (a card merged, restored and merged again).
 */
export function mergedIntoFromNotes(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const re = /Merged into "[^"]*" \(([0-9a-f-]{36})\)/gi;
  let last: string | null = null;
  for (let m = re.exec(notes); m; m = re.exec(notes)) last = m[1].toLowerCase();
  return last && UUID_RE.test(last) ? last : null;
}

function isArchived(v: Pick<CoverageVendor, "status">): boolean {
  return (v.status ?? "").trim().toLowerCase() === "archived";
}

/**
 * id → the card that should stand for it: an archived merged card resolves to
 * its survivor (following chains A→B→C); anything else resolves to itself. A
 * survivor id we don't have, or a loop, leaves the card as itself.
 */
export function buildSurvivorResolver(vendors: readonly CoverageVendor[]): (id: string) => string {
  const byId = new Map(vendors.map((v) => [v.id, v]));
  const memo = new Map<string, string>();
  return (id: string) => {
    const hit = memo.get(id);
    if (hit) return hit;
    let cur = id;
    const seen = new Set<string>([cur]);
    for (let i = 0; i < 10; i += 1) {
      const v = byId.get(cur);
      if (!v || !isArchived(v) || !v.merged_into_id) break;
      const next = v.merged_into_id;
      if (!byId.has(next) || seen.has(next)) break;
      seen.add(next);
      cur = next;
    }
    memo.set(id, cur);
    return cur;
  };
}

/** Legal / filler words that never tell two sellers apart ("NCMX, LLC" = "NCMX"). */
const LEGAL_WORDS = new Set([
  "llc", "l l c", "inc", "incorporated", "co", "company", "corp", "corporation", "ltd", "limited", "lp", "llp", "pllc",
  "spc", "proc", "processing", "processor", "the", "dba",
]);

/** Exact key with legal words dropped; falls back to the exact key when that would empty it. */
export function looseVendorKey(raw: string | null | undefined): string {
  const exact = normalizeVendorKey(raw);
  if (!exact) return "";
  const kept = exact.split(" ").filter((w) => !LEGAL_WORDS.has(w));
  return kept.length ? kept.join(" ") : exact;
}

/** Industry words that many unrelated sellers share — dropped only by `familyVendorKey`. */
const INDUSTRY_WORDS = new Set(["cannabis", "marijuana", "farms", "farm", "gardens", "garden", "brands", "brand", "group", "holdings", "enterprises"]);

/**
 * The "same business family" key: loose key minus industry words, spaces
 * removed ("Blue Roots Cannabis Co." = "Blue Roots", "FIREBROS" = "Fire
 * Bros."). Used for duplicate-card detection and as the LAST name tier. Under
 * 5 letters it is too generic to trust and returns "".
 */
export function familyVendorKey(raw: string | null | undefined): string {
  const loose = looseVendorKey(raw);
  if (!loose) return "";
  const kept = loose.split(" ").filter((w) => !INDUSTRY_WORDS.has(w));
  const k = (kept.length ? kept : loose.split(" ")).join("");
  return k.length >= 5 ? k : "";
}

/** Loose key with the spaces removed ("botanicaSEATTLE" = "Botanica Seattle"). */
export function compactVendorKey(raw: string | null | undefined): string {
  const k = looseVendorKey(raw).replace(/ /g, "");
  return k.length >= 4 ? k : "";
}

/**
 * The cleaned whole-name forms of a menu's seller name (no splitting):
 * trailing license digits, trademark signs, "(…)" asides, a " - marketing
 * tail", and wrapping quotes/underscores removed. Order = most literal first.
 */
export function menuNameVariants(raw: string | null | undefined): string[] {
  const out: string[] = [];
  const push = (s: string) => {
    const t = s.replace(/[\u2122\u00ae\u00a9]/g, "").replace(/^[\s'"_`.\-]+|[\s'"_`.\-]+$/g, "").trim();
    if (t && !out.includes(t)) out.push(t);
  };
  const base = stripLicenseSuffix(raw ?? "");
  push(base);
  const noParens = base.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ");
  push(noParens);
  // "Evergreen Herbal - NEW! THC Only ..." → "Evergreen Herbal"; "Artizen - Distro" → "Artizen"
  const dash = noParens.split(/\s+[-\u2013\u2014|:]\s+/)[0];
  push(dash);
  return out;
}

/**
 * Parts of a seller name that may each be a business or brand: "TILTED by
 * Bellevue Cannabis Co", "Agro Couture / Slab Mechanix", "Seattle Marijuana
 * Company, Mountain Hi, Hard Hat Extracts, and CANDY", "Viking & Absolute
 * Fire". Only tried when no whole-name form matched; parts that point at two
 * different vendors are reported as ambiguous, never picked.
 */
export function menuNameParts(raw: string | null | undefined): string[] {
  const variants = menuNameVariants(raw);
  const src = variants[variants.length - 1] ?? "";
  const out: string[] = [];
  for (const piece of src.split(/\s+by\s+|\s*\/\s*|\s*,\s*(?:and\s+)?|\s+&\s+|\s+and\s+/i)) {
    const t = piece.trim();
    if (t && normalizeVendorKey(t).length >= 3 && !LEGAL_WORDS.has(normalizeVendorKey(t)) && !out.includes(t)) out.push(t);
  }
  return out.length > 1 ? out : [];
}

export type VendorMatcherOptions = {
  /** Vendor ids we receive from (have lots) — used to break duplicate-card ties (D213). */
  carried?: ReadonlySet<string>;
};

/**
 * Build the matcher once per page render. Keys map to SETS of (survivor)
 * vendor ids so a tie is detected, then broken only by the explained rules
 * above — never by whichever row came first.
 */
export function buildVendorMatcher(
  vendors: readonly CoverageVendor[],
  aliases: readonly CoverageAlias[] = [],
  brands: readonly CoverageBrand[] = [],
  opts: VendorMatcherOptions = {},
): VendorMatcher {
  const byId = new Map(vendors.map((v) => [v.id, v]));
  const resolve = buildSurvivorResolver(vendors);
  const carried = opts.carried ?? new Set<string>();
  type Index = Map<string, Set<string>>;
  const mk = (): Index => new Map();
  const byLicense = mk();
  const byMenuLink = mk();
  const exact = { name: mk(), alias: mk(), brand: mk() };
  const loose = { name: mk(), alias: mk(), brand: mk() };
  const compact = { name: mk(), alias: mk(), brand: mk() };
  const family = { name: mk(), alias: mk(), brand: mk() };
  const add = (m: Index, key: string, id: string) => {
    if (!key) return;
    if (!m.has(key)) m.set(key, new Set());
    m.get(key)!.add(id);
  };
  const addName = (kind: "name" | "alias" | "brand", raw: string | null | undefined, id: string) => {
    const n = stripLicenseSuffix(raw ?? "");
    add(exact[kind], normalizeVendorKey(n), id);
    add(loose[kind], looseVendorKey(n), id);
    add(compact[kind], compactVendorKey(n), id);
    add(family[kind], familyVendorKey(n), id);
  };
  for (const v of vendors) {
    const id = resolve(v.id);
    const lic = normalizeLicense(v.license_number);
    if (lic) add(byLicense, lic, id);
    for (const n of [v.display_name, v.dba, v.legal_name]) addName("name", n, id);
  }
  for (const a of aliases) {
    if (!byId.has(a.vendor_id)) continue;
    const id = resolve(a.vendor_id);
    const src = (a.source_name ?? "").trim();
    const licAlias = src.match(/^license:\s*(.+)$/i);
    if (licAlias) {
      // merge_vendors() keeps every merged card's license as `license:<n>`.
      const lic = normalizeLicense(licAlias[1]);
      if (lic) add(byLicense, lic, id);
      continue;
    }
    if ((a.source_system ?? "") === MENU_LINK_ALIAS_SYSTEM) add(byMenuLink, normalizeVendorKey(src), id);
    addName("alias", src, id);
  }
  for (const b of brands) {
    if (b.vendor_id && byId.has(b.vendor_id)) addName("brand", b.display_name, resolve(b.vendor_id));
  }

  /** Other live cards sharing the license or exact name — what "merge suggested" lists. */
  const dupLicense = mk();
  const dupName = mk();
  for (const v of vendors) {
    if (isArchived(v)) continue;
    const lic = normalizeLicense(v.license_number);
    if (lic) add(dupLicense, lic, v.id);
    add(dupName, familyVendorKey(stripLicenseSuffix(v.display_name)), v.id);
  }
  const duplicatesOf = (id: string): string[] => {
    const v = byId.get(id);
    if (!v) return [];
    const out = new Set<string>();
    const lic = normalizeLicense(v.license_number);
    for (const set of [lic ? dupLicense.get(lic) : undefined, dupName.get(familyVendorKey(stripLicenseSuffix(v.display_name)))]) {
      // A key shared by more than 4 live cards is a generic word, not one business.
      if (set && set.size <= 4) for (const x of set) if (x !== id) out.add(x);
    }
    return [...out].sort();
  };

  /** Tie-break (D213): live > archived, carried > not, published > draft. */
  const pickOne = (hit: Set<string>): { id: string | null; why: string | null; size: number } => {
    const ids = [...hit];
    if (ids.length === 1) return { id: ids[0], why: null, size: 1 };
    const steps: [string, (id: string) => boolean][] = [
      ["the others are archived", (id) => { const v = byId.get(id); return Boolean(v && !isArchived(v)); }],
      ["it is the one we receive from", (id) => carried.has(id)],
      ["it is the published card", (id) => (byId.get(id)?.status ?? "").toLowerCase() === "published"],
    ];
    let pool = ids;
    for (const [why, keep] of steps) {
      const kept = pool.filter(keep);
      if (kept.length === 1) return { id: kept[0], why: `${ids.length} cards fit — picked this one because ${why}`, size: ids.length };
      if (kept.length > 1) pool = kept;
    }
    return { id: null, why: null, size: ids.length };
  };

  /**
   * A menu that landed on a card we don't receive from, when exactly ONE live
   * card with the same exact name IS carried, counts for that carried card
   * (Fire Bros. 436479 menu → Fire Bros. 425450 we buy from).
   */
  const preferCarriedTwin = (id: string): { id: string; why: string | null } => {
    if (carried.size === 0 || carried.has(id)) return { id, why: null };
    const v = byId.get(id);
    if (!v) return { id, why: null };
    // Exact same name first (Fire Bros. = Fire Bros.), then the wider family
    // (same license / FIREBROS); only a SINGLE carried twin is ever chosen.
    const dups = duplicatesOf(id).filter((d) => carried.has(d));
    const sameName = new Set([v.display_name, v.dba, v.legal_name].map((n) => normalizeVendorKey(stripLicenseSuffix(n ?? ""))).filter(Boolean));
    const exactTwins = dups.filter((d) => {
      const t = byId.get(d)!;
      return [t.display_name, t.dba, t.legal_name].some((n) => sameName.has(normalizeVendorKey(stripLicenseSuffix(n ?? ""))));
    });
    const twin = exactTwins.length === 1 ? exactTwins[0] : dups.length === 1 ? dups[0] : null;
    if (!twin) return { id, why: null };
    return { id: twin, why: `the menu fits "${v.display_name}", a duplicate card of this vendor we receive from` };
  };

  const done = (id: string, how: MatchHow, size: number, why: string | null): VendorMatch => {
    const twin = preferCarriedTwin(id);
    const detail = [why, twin.why].filter(Boolean).join("; ") || null;
    return { vendorId: twin.id, how, candidates: size, detail, duplicateIds: duplicatesOf(twin.id) };
  };

  return (s) => {
    if (s.vendorId && byId.has(s.vendorId)) {
      const id = resolve(s.vendorId);
      return { vendorId: id, how: "linked", candidates: 1, detail: id !== s.vendorId ? "the linked card was merged into this one" : null, duplicateIds: duplicatesOf(id) };
    }
    let ambiguous = 0;
    // 1. The owner's own "Link to vendor" choice for this menu name.
    for (const label of [s.label, s.altLabel]) {
      const hit = byMenuLink.get(normalizeVendorKey(label ?? ""));
      if (hit) {
        const p = pickOne(hit);
        if (p.id) return done(p.id, "alias", p.size, "you linked this menu to this vendor");
      }
    }
    // 2. License number (GrowFlow / LeafLink / a "NAME - 412345" label).
    const fieldLic = normalizeLicense(s.license);
    const labelLic = fieldLic ? null : normalizeLicense(extractLicenseFromLabel(s.label));
    let licenseHit: VendorMatch | null = null;
    const lic = fieldLic ?? labelLic;
    if (lic) {
      const hit = byLicense.get(lic);
      if (hit) {
        const p = pickOne(hit);
        if (p.id) licenseHit = done(p.id, "license", p.size, p.why);
        else ambiguous = Math.max(ambiguous, p.size);
      }
    }
    // A license from the source's own license field is trusted outright.
    if (licenseHit && fieldLic) return licenseHit;

    // 3. Names — seller-name evidence (our names + aliases) from the label,
    //    then from the web-address slug, before any brand evidence; whole
    //    forms before parts. Strictest key first.
    const tiers: [Record<"name" | "alias" | "brand", Index>, (x: string) => string, string | null][] = [
      [exact, normalizeVendorKey, null],
      [loose, looseVendorKey, "ignoring LLC / Inc / Co"],
      [compact, compactVendorKey, "ignoring spaces and LLC / Inc / Co"],
      [family, familyVendorKey, "ignoring words like Cannabis / Farms / Brands"],
    ];
    type Kind = "name" | "alias" | "brand";
    const tryWhole = (label: string | null, kinds: readonly Kind[], from: string | null): VendorMatch | null => {
      for (const variant of menuNameVariants(label)) {
        const cleaned = variant !== stripLicenseSuffix(label ?? "").trim() ? `cleaned to "${variant}"` : null;
        for (const [idx, keyOf, tierWhy] of tiers) {
          const key = keyOf(variant);
          if (!key) continue;
          for (const how of kinds) {
            // Brand names are short and shared; the loosest tier never applies to them.
            if (how === "brand" && idx === family) continue;
            const hit = idx[how].get(key);
            if (!hit) continue;
            const p = pickOne(hit);
            if (p.id) return done(p.id, how, p.size, [from, cleaned, tierWhy, p.why].filter(Boolean).join(", ") || null);
            ambiguous = Math.max(ambiguous, p.size);
          }
        }
      }
      return null;
    };
    const SLUG = "from the menu's web address";
    // The seller name the menu SHOWS (names, aliases, then brands) beats its web-address slug.
    const byName =
      tryWhole(s.label, ["name", "alias"], null) ??
      (licenseHit ? null : tryWhole(s.label, ["brand"], null)) ??
      (s.altLabel ? tryWhole(s.altLabel, ["name", "alias"], SLUG) : null);

    // A license read out of the label text ("TWO HEADS CO LLC - 412851") that
    // points at a DIFFERENT vendor than the name does is a conflict: shown,
    // never guessed (rule 3). Same vendor → the license match stands.
    if (licenseHit) {
      if (byName && byName.vendorId !== licenseHit.vendorId) {
        const a = byId.get(licenseHit.vendorId ?? "")?.display_name ?? "one vendor";
        const b = byId.get(byName.vendorId ?? "")?.display_name ?? "another";
        return {
          vendorId: null,
          how: "ambiguous",
          candidates: 2,
          detail: `the license # in the menu name belongs to "${a}" but the name fits "${b}" — use Link to vendor`,
          duplicateIds: [],
        };
      }
      return licenseHit;
    }
    if (byName) return byName;
    const byBrand = s.altLabel ? tryWhole(s.altLabel, ["brand"], SLUG) : null;
    if (byBrand) return byBrand;
    for (const label of [s.label, s.altLabel]) {
      const found = new Map<string, MatchHow>();
      const parts = menuNameParts(label);
      for (const part of parts) {
        for (const [idx, keyOf] of tiers) {
          const key = keyOf(part);
          if (!key) continue;
          let got = false;
          for (const how of ["name", "alias", "brand"] as const) {
            if (how === "brand" && idx === family) continue;
            const hit = idx[how].get(key);
            if (!hit) continue;
            const p = pickOne(hit);
            if (p.id) {
              if (!found.has(p.id)) found.set(p.id, how);
              got = true;
              break;
            }
            ambiguous = Math.max(ambiguous, p.size);
          }
          if (got) break;
        }
      }
      if (found.size === 1) {
        const [[id, how]] = [...found.entries()];
        return done(id, how, 1, `one part of the menu name ("${label}") fits this vendor`);
      }
      if (found.size > 1) ambiguous = Math.max(ambiguous, found.size);
    }
    if (ambiguous > 1) return { vendorId: null, how: "ambiguous", candidates: ambiguous, detail: null, duplicateIds: [] };
    return { vendorId: null, how: "none", candidates: 0, detail: null, duplicateIds: [] };
  };
}

/* ------------------------------------------------------------------
 * Our own lots, per vendor (receiving is the real pipeline — rule 11)
 * ------------------------------------------------------------------ */

export type LotRollup = {
  lotsTotal: number;
  lotsInStock: number;
  unitsOnHand: number;
  firstReceived: string | null;
  lastReceived: string | null;
  categories: string[];
};

const GONE_STATUSES = new Set(["destroyed"]);

/** The day a lot arrived: received_on (Pacific date) when set, else its row's Pacific day. */
export function lotReceivedDay(l: Pick<CoverageLot, "received_on" | "created_at">): string | null {
  if (l.received_on && /^\d{4}-\d{2}-\d{2}/.test(l.received_on)) return l.received_on.slice(0, 10);
  const t = ts(l.created_at);
  return t ? pacificDayKey(new Date(t)) : null;
}

/**
 * Lots per vendor. D213: pass `resolve` (buildSurvivorResolver) so lots still
 * sitting on an archived, merged card count for the card it was merged into —
 * live data had 10 archived cards still holding lots.
 */
export function rollupLots(lots: readonly CoverageLot[], resolve: (id: string) => string = (id) => id): Map<string, LotRollup> {
  const out = new Map<string, LotRollup>();
  const cats = new Map<string, Map<string, number>>();
  for (const l of lots) {
    if (!l.vendor_id) continue;
    const vid = resolve(l.vendor_id);
    let r = out.get(vid);
    if (!r) {
      r = { lotsTotal: 0, lotsInStock: 0, unitsOnHand: 0, firstReceived: null, lastReceived: null, categories: [] };
      out.set(vid, r);
      cats.set(vid, new Map());
    }
    r.lotsTotal += 1;
    const qty = Number(l.on_hand_qty ?? 0);
    const gone = GONE_STATUSES.has((l.status ?? "").toLowerCase());
    if (!gone && Number.isFinite(qty) && qty > 0) {
      r.lotsInStock += 1;
      r.unitsOnHand += qty;
    }
    const day = lotReceivedDay(l);
    if (day) {
      if (!r.firstReceived || day < r.firstReceived) r.firstReceived = day;
      if (!r.lastReceived || day > r.lastReceived) r.lastReceived = day;
    }
    const c = (l.category ?? "").trim();
    if (c) {
      const m = cats.get(vid)!;
      m.set(c, (m.get(c) ?? 0) + 1);
    }
  }
  for (const [id, r] of out) r.categories = topKeys(cats.get(id)!, 3);
  return out;
}

function topKeys(m: Map<string, number>, n: number): string[] {
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([k]) => k);
}

/* ------------------------------------------------------------------
 * Item facts for one menu
 * ------------------------------------------------------------------ */

export type ItemSummary = {
  items: number;
  priced: number;
  priceMin: number | null;
  priceMedian: number | null;
  priceMax: number | null;
  thcAvg: number | null;
  thcMax: number | null;
  topCategories: string[];
  photoPct: number | null;
  coaPct: number | null;
  inStockItems: number;
  /** Items whose quantity the source reported at all (so "0 in stock" is honest). */
  qtyReported: number;
};

export function summarizeItems(items: readonly CoverageItem[]): ItemSummary {
  const prices = items.map((i) => i.priceMinor).filter((p): p is number => typeof p === "number" && Number.isFinite(p) && p > 0);
  const thc = items.map((i) => i.thcPct).filter((t): t is number => typeof t === "number" && Number.isFinite(t) && t > 0 && t <= 100);
  const cats = new Map<string, number>();
  let photos = 0;
  let coas = 0;
  let inStock = 0;
  let qtyReported = 0;
  for (const i of items) {
    const c = (i.category ?? "").trim();
    if (c) cats.set(c, (cats.get(c) ?? 0) + 1);
    if (i.hasImage) photos += 1;
    if (i.hasCoa) coas += 1;
    if (typeof i.availableQty === "number" && Number.isFinite(i.availableQty)) {
      qtyReported += 1;
      if (i.availableQty > 0) inStock += 1;
    }
  }
  return {
    items: items.length,
    priced: prices.length,
    priceMin: prices.length ? Math.min(...prices) : null,
    priceMedian: medianInt(prices),
    priceMax: prices.length ? Math.max(...prices) : null,
    thcAvg: thc.length ? Math.round((thc.reduce((a, b) => a + b, 0) / thc.length) * 10) / 10 : null,
    thcMax: thc.length ? Math.max(...thc) : null,
    topCategories: topKeys(cats, 3),
    photoPct: pct(photos, items.length),
    coaPct: pct(coas, items.length),
    inStockItems: inStock,
    qtyReported,
  };
}

/* ------------------------------------------------------------------
 * SEARCHED table — one row per vendor
 * ------------------------------------------------------------------ */

export type HistoryEntry = {
  source: MenuSource;
  id: string;
  href: string;
  status: string;
  itemCount: number;
  fetchedAt: string;
  usable: boolean;
  label: string;
  errorMessage: string | null;
};

export type SourceSummary = {
  source: MenuSource;
  latestId: string;
  latestHref: string;
  latestAt: string;
  latestStatus: string;
  latestItems: number;
  /** Item change vs the previous usable pull from the SAME source; null = no previous. */
  deltaItems: number | null;
  pulls: number;
};

export type SearchedRow = {
  key: string;
  vendorId: string | null;
  vendor: CoverageVendor | null;
  name: string;
  /** Names the menus used, when they differ from our vendor name. */
  menuNames: string[];
  match: MatchHow;
  ambiguousCandidates: number;
  /** D213 — why this vendor was chosen when it took more than an exact hit (shown on the row). */
  matchDetail: string | null;
  /** D213 — other live cards for the same business (same license or same name): merge suggested. */
  duplicateIds: string[];
  /** D213 — the seller names "Link to vendor" remembers for this row. */
  linkTargets: MenuLinkTarget[];
  sources: SourceSummary[];
  latest: HistoryEntry;
  latestUsable: HistoryEntry | null;
  freshness: Freshness;
  hasUsable: boolean;
  pulls: number;
  failedPulls: number;
  facts: ItemSummary | null;
  lots: LotRollup | null;
  rememberedPlatform: string | null;
  history: HistoryEntry[];
};

/** Group key: our vendor id when matched, else the menu's normalized name. */
function groupKey(m: VendorMatch, s: CoverageSnapshot): string {
  if (m.vendorId) return `v:${m.vendorId}`;
  const k = normalizeVendorKey(stripLicenseSuffix(s.label)) || normalizeVendorKey(s.altLabel) || `${s.source}:${s.id}`;
  return `n:${k}`;
}

/** Newest usable snapshot per (group, source) — the ONLY snapshots whose items are read (D209e). */
export function latestUsableSnapshotIds(
  snapshots: readonly CoverageSnapshot[],
  match: VendorMatcher,
): Record<MenuSource, string[]> {
  const best = new Map<string, CoverageSnapshot>();
  for (const s of snapshots) {
    if (!isUsableSnapshot(s)) continue;
    const k = `${groupKey(match(s), s)}|${s.source}`;
    const cur = best.get(k);
    if (!cur || ts(s.fetchedAt) > ts(cur.fetchedAt)) best.set(k, s);
  }
  const out: Record<MenuSource, string[]> = { cultivera: [], growflow: [], leaflink: [], email: [] };
  for (const s of best.values()) out[s.source].push(s.id);
  return out;
}

export function buildSearchedRows(input: {
  snapshots: readonly CoverageSnapshot[];
  vendors: readonly CoverageVendor[];
  match: VendorMatcher;
  itemsBySnapshot: ReadonlyMap<string, readonly CoverageItem[]>;
  lotsByVendor: ReadonlyMap<string, LotRollup>;
  memories?: readonly CoverageMemory[];
  nowMs: number;
}): SearchedRow[] {
  const vendorById = new Map(input.vendors.map((v) => [v.id, v]));
  const groups = new Map<string, { m: VendorMatch; snaps: CoverageSnapshot[] }>();
  for (const s of input.snapshots) {
    const m = input.match(s);
    const k = groupKey(m, s);
    const g = groups.get(k);
    if (g) g.snaps.push(s);
    else groups.set(k, { m, snaps: [s] });
  }
  const memoryFor = buildMemoryLookup(input.memories ?? []);

  const rows: SearchedRow[] = [];
  for (const [key, g] of groups) {
    const snaps = g.snaps.slice().sort((a, b) => ts(b.fetchedAt) - ts(a.fetchedAt));
    const history: HistoryEntry[] = snaps.map((s) => ({
      source: s.source,
      id: s.id,
      href: snapshotHref(s.source, s.id),
      status: s.status,
      itemCount: s.itemCount,
      fetchedAt: s.fetchedAt,
      usable: isUsableSnapshot(s),
      label: s.label,
      errorMessage: s.errorMessage,
    }));
    const sources: SourceSummary[] = [];
    for (const src of MENU_SOURCES) {
      const mine = history.filter((h) => h.source === src);
      if (mine.length === 0) continue;
      const head = mine.find((h) => h.usable) ?? mine[0];
      const prev = mine.filter((h) => h.usable && h.id !== head.id && ts(h.fetchedAt) <= ts(head.fetchedAt))[0];
      sources.push({
        source: src,
        latestId: head.id,
        latestHref: head.href,
        latestAt: head.fetchedAt,
        latestStatus: head.status,
        latestItems: head.itemCount,
        deltaItems: head.usable && prev ? head.itemCount - prev.itemCount : null,
        pulls: mine.length,
      });
    }
    sources.sort((a, b) => ts(b.latestAt) - ts(a.latestAt));
    const latestUsable = history.find((h) => h.usable) ?? null;
    // Facts: the newest usable menu per source, combined (the vendor's whole current offer).
    const factItems: CoverageItem[] = [];
    for (const src of sources) {
      const head = history.find((h) => h.source === src.source && h.usable);
      if (head) factItems.push(...(input.itemsBySnapshot.get(head.id) ?? []));
    }
    const vendor = g.m.vendorId ? vendorById.get(g.m.vendorId) ?? null : null;
    const labels = [...new Set(snaps.map((s) => s.label.trim()).filter(Boolean))];
    const name = vendor?.display_name || labels[0] || "Unknown vendor";
    rows.push({
      key,
      vendorId: g.m.vendorId,
      vendor,
      name,
      menuNames: labels.filter((l) => normalizeVendorKey(l) !== normalizeVendorKey(name)).slice(0, 3),
      match: g.m.how,
      ambiguousCandidates: g.m.candidates,
      matchDetail: g.m.detail ?? null,
      duplicateIds: g.m.duplicateIds ?? [],
      linkTargets: menuLinkTargets(history),
      sources,
      latest: history[0],
      latestUsable,
      freshness: latestUsable ? menuFreshness(latestUsable.fetchedAt, input.nowMs) : "unknown",
      hasUsable: Boolean(latestUsable),
      pulls: history.length,
      failedPulls: history.filter((h) => !h.usable).length,
      facts: factItems.length ? summarizeItems(factItems) : null,
      lots: g.m.vendorId ? input.lotsByVendor.get(g.m.vendorId) ?? null : null,
      rememberedPlatform: vendor ? memoryFor(vendor) : memoryForName(input.memories ?? [], name),
      history,
    });
  }
  return rows;
}

/* ------------------------------------------------------------------
 * Platform memory lookup (vendor_platform_map)
 * ------------------------------------------------------------------ */

function newestPlatform(rows: readonly CoverageMemory[]): string | null {
  const known = rows.filter((r) => r.platform === "cultivera" || r.platform === "growflow" || r.platform === "leaflink");
  if (!known.length) return null;
  return known.slice().sort((a, b) => ts(b.last_seen_at) - ts(a.last_seen_at))[0].platform;
}

function memoryForName(memories: readonly CoverageMemory[], name: string): string | null {
  const key = normalizeVendorKey(name);
  if (!key) return null;
  return newestPlatform(memories.filter((m) => normalizeVendorKey(m.vendor_name ?? m.vendor_key) === key));
}

function buildMemoryLookup(memories: readonly CoverageMemory[]): (v: CoverageVendor) => string | null {
  const byKey = new Map<string, CoverageMemory[]>();
  const byLic = new Map<string, CoverageMemory[]>();
  for (const m of memories) {
    const k = normalizeVendorKey(m.vendor_name ?? m.vendor_key);
    if (k) byKey.set(k, [...(byKey.get(k) ?? []), m]);
    const l = normalizeLicense(m.license_number);
    if (l) byLic.set(l, [...(byLic.get(l) ?? []), m]);
  }
  return (v) => {
    const hits: CoverageMemory[] = [];
    const l = normalizeLicense(v.license_number);
    if (l) hits.push(...(byLic.get(l) ?? []));
    for (const n of [v.display_name, v.dba, v.legal_name]) {
      const k = normalizeVendorKey(stripLicenseSuffix(n ?? ""));
      if (k) hits.push(...(byKey.get(k) ?? []));
    }
    return newestPlatform(hits);
  };
}

/** Platform label for a remembered-platform string (tolerates unknowns). */
export function rememberedLabel(p: string | null): string {
  if (p === "cultivera") return "Cultivera";
  if (p === "growflow") return "GrowFlow";
  if (p === "leaflink") return "LeafLink";
  return "";
}

/** Badge tone for a remembered-platform string (unknown → neutral). */
export function rememberedTone(p: string | null): "green" | "gold" | "orange" | "neutral" {
  if (p === "cultivera" || p === "growflow" || p === "leaflink") return sourceTone(p);
  return "neutral";
}

/* ------------------------------------------------------------------
 * NEEDED table — vendors we carry with no usable menu
 * ------------------------------------------------------------------ */

export type NeedGroup = "on_shelf" | "recent" | "older";

export function needGroupLabel(g: NeedGroup): string {
  if (g === "on_shelf") return "On the shelf now";
  if (g === "recent") return `Received in the last ${RECENT_RECEIVED_DAYS} days`;
  return "Older vendors";
}

export type NeededRow = {
  vendor: CoverageVendor;
  lots: LotRollup;
  group: NeedGroup;
  daysSinceReceived: number | null;
  rememberedPlatform: string | null;
  /** Pulls that matched this vendor but came back empty or failed. */
  attempts: HistoryEntry[];
  mailto: string;
};

/** Archived cards never stand on their own in either table (D213): merged ones roll up to the survivor. */
export function isListableVendor(v: Pick<CoverageVendor, "status">): boolean {
  return !isArchived(v);
}

export const MENU_REQUEST_SUBJECT = "Menu request — Greenway Marijuana";

export function buildNeededRows(input: {
  vendors: readonly CoverageVendor[];
  lotsByVendor: ReadonlyMap<string, LotRollup>;
  searched: readonly SearchedRow[];
  memories?: readonly CoverageMemory[];
  nowMs: number;
}): NeededRow[] {
  // D213 — a usable menu covers its vendor AND that vendor's duplicate cards
  // (same license / same name), so one business never sits in both tables.
  const covered = new Set<string>();
  const attemptsBy = new Map<string, HistoryEntry[]>();
  for (const r of input.searched) {
    if (!r.vendorId) continue;
    if (r.hasUsable) {
      covered.add(r.vendorId);
      for (const d of r.duplicateIds) covered.add(d);
    } else attemptsBy.set(r.vendorId, r.history);
  }
  const memoryFor = buildMemoryLookup(input.memories ?? []);
  const out: NeededRow[] = [];
  for (const v of input.vendors) {
    const lots = input.lotsByVendor.get(v.id);
    if (!lots || lots.lotsTotal === 0 || covered.has(v.id) || !isListableVendor(v)) continue;
    const days = pacificDaysSince(lots.lastReceived, input.nowMs);
    const group: NeedGroup =
      lots.lotsInStock > 0 ? "on_shelf" : days !== null && days <= RECENT_RECEIVED_DAYS ? "recent" : "older";
    out.push({
      vendor: v,
      lots,
      group,
      daysSinceReceived: days,
      rememberedPlatform: memoryFor(v),
      attempts: attemptsBy.get(v.id) ?? [],
      // Owner rule (vendor-relations-core): subject only, BLANK body.
      mailto: v.email ? vendorMailtoHref(v.email, MENU_REQUEST_SUBJECT) : "",
    });
  }
  return out;
}

/* ------------------------------------------------------------------
 * KPIs (D209d)
 * ------------------------------------------------------------------ */

export type CoverageKpis = {
  carried: number;
  covered: number;
  coveredPct: number | null;
  neededOnShelf: number;
  needed: number;
  stale: number;
  unlinked: number;
  menusOnFile: number;
  itemsOnFile: number;
};

export function coverageKpis(
  searched: readonly SearchedRow[],
  needed: readonly NeededRow[],
  lotsByVendor: ReadonlyMap<string, LotRollup>,
  vendors?: readonly CoverageVendor[],
): CoverageKpis {
  // D213 — archived cards are never "carried" on their own (merged ones already rolled up).
  const hidden = new Set((vendors ?? []).filter((v) => !isListableVendor(v)).map((v) => v.id));
  const carried = [...lotsByVendor.entries()].filter(([id, l]) => l.lotsTotal > 0 && !hidden.has(id)).length;
  // carried − needed, so the two tables and the KPI always add up (D213).
  const covered = Math.max(0, carried - needed.length);
  return {
    carried,
    covered,
    coveredPct: pct(covered, carried),
    neededOnShelf: needed.filter((n) => n.group === "on_shelf").length,
    needed: needed.length,
    stale: searched.filter((r) => r.hasUsable && r.freshness === "stale").length,
    unlinked: searched.filter((r) => !r.vendorId).length,
    menusOnFile: searched.filter((r) => r.hasUsable).length,
    itemsOnFile: searched.reduce((s, r) => s + (r.latestUsable?.itemCount ?? 0), 0),
  };
}

/* ------------------------------------------------------------------
 * URL-driven filters + sorts (bookmarkable)
 * ------------------------------------------------------------------ */

export type SearchedSort = "newest" | "oldest" | "name" | "items" | "stock" | "price";
export type NeededSort = "stock" | "recent" | "name" | "ytd" | "lots";

export type CoverageParams = {
  sq: string;
  ssrc: MenuSource | "";
  sfresh: Freshness | "failed" | "";
  slink: "linked" | "unlinked" | "carried" | "";
  ssort: SearchedSort;
  nq: string;
  ngrp: NeedGroup | "tried" | "";
  nsort: NeededSort;
  find: string;
};

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v ?? "").trim().slice(0, 120);
}

function pick<T extends string>(v: string, allowed: readonly T[], dflt: T): T {
  return (allowed as readonly string[]).includes(v) ? (v as T) : dflt;
}

export function parseCoverageParams(sp: Record<string, string | string[] | undefined>): CoverageParams {
  return {
    sq: one(sp.sq),
    ssrc: pick(one(sp.ssrc), ["", ...MENU_SOURCES] as const, ""),
    sfresh: pick(one(sp.sfresh), ["", "fresh", "aging", "stale", "failed"] as const, ""),
    slink: pick(one(sp.slink), ["", "linked", "unlinked", "carried"] as const, ""),
    ssort: pick(one(sp.ssort), ["newest", "oldest", "name", "items", "stock", "price"] as const, "newest"),
    nq: one(sp.nq),
    ngrp: pick(one(sp.ngrp), ["", "on_shelf", "recent", "older", "tried"] as const, ""),
    nsort: pick(one(sp.nsort), ["stock", "recent", "name", "ytd", "lots"] as const, "stock"),
    find: one(sp.find),
  };
}

/** Query string for a link that changes some params and keeps the rest. */
export function coverageHref(base: string, p: CoverageParams, patch: Partial<CoverageParams> = {}, hash = ""): string {
  const merged = { ...p, ...patch };
  const dflt: Record<string, string> = { ssort: "newest", nsort: "stock" };
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) {
    if (v && v !== dflt[k]) qs.set(k, v);
  }
  const s = qs.toString();
  return `${base}${s ? `?${s}` : ""}${hash}`;
}

function textHit(needle: string, ...hay: (string | null | undefined)[]): boolean {
  const n = needle.toLowerCase();
  return hay.some((h) => (h ?? "").toLowerCase().includes(n));
}

export function filterSortSearched(rows: readonly SearchedRow[], p: CoverageParams): SearchedRow[] {
  let out = rows.slice();
  if (p.sq) {
    out = out.filter((r) =>
      textHit(p.sq, r.name, r.vendor?.dba, r.vendor?.license_number, ...r.menuNames, ...(r.facts?.topCategories ?? [])),
    );
  }
  if (p.ssrc) out = out.filter((r) => r.sources.some((s) => s.source === p.ssrc));
  if (p.sfresh === "failed") out = out.filter((r) => !r.hasUsable);
  else if (p.sfresh) out = out.filter((r) => r.hasUsable && r.freshness === p.sfresh);
  if (p.slink === "linked") out = out.filter((r) => r.vendorId);
  if (p.slink === "unlinked") out = out.filter((r) => !r.vendorId);
  if (p.slink === "carried") out = out.filter((r) => (r.lots?.lotsTotal ?? 0) > 0);
  const byName = (a: SearchedRow, b: SearchedRow) => a.name.localeCompare(b.name);
  const at = (r: SearchedRow) => ts((r.latestUsable ?? r.latest).fetchedAt);
  const cmp: Record<SearchedSort, (a: SearchedRow, b: SearchedRow) => number> = {
    newest: (a, b) => at(b) - at(a) || byName(a, b),
    oldest: (a, b) => at(a) - at(b) || byName(a, b),
    name: byName,
    items: (a, b) => (b.latestUsable?.itemCount ?? 0) - (a.latestUsable?.itemCount ?? 0) || byName(a, b),
    stock: (a, b) => (b.lots?.lotsInStock ?? 0) - (a.lots?.lotsInStock ?? 0) || byName(a, b),
    price: (a, b) => (a.facts?.priceMedian ?? Number.MAX_SAFE_INTEGER) - (b.facts?.priceMedian ?? Number.MAX_SAFE_INTEGER) || byName(a, b),
  };
  return out.sort(cmp[p.ssort]);
}

export function filterSortNeeded(rows: readonly NeededRow[], p: CoverageParams): NeededRow[] {
  let out = rows.slice();
  if (p.nq) out = out.filter((r) => textHit(p.nq, r.vendor.display_name, r.vendor.dba, r.vendor.license_number, ...r.lots.categories));
  if (p.ngrp === "tried") out = out.filter((r) => r.attempts.length > 0);
  else if (p.ngrp) out = out.filter((r) => r.group === p.ngrp);
  const byName = (a: NeededRow, b: NeededRow) => a.vendor.display_name.localeCompare(b.vendor.display_name);
  const groupRank: Record<NeedGroup, number> = { on_shelf: 0, recent: 1, older: 2 };
  const cmp: Record<NeededSort, (a: NeededRow, b: NeededRow) => number> = {
    stock: (a, b) =>
      groupRank[a.group] - groupRank[b.group] || b.lots.lotsInStock - a.lots.lotsInStock || (b.lots.lastReceived ?? "").localeCompare(a.lots.lastReceived ?? "") || byName(a, b),
    recent: (a, b) => (b.lots.lastReceived ?? "").localeCompare(a.lots.lastReceived ?? "") || byName(a, b),
    name: byName,
    ytd: (a, b) => (b.vendor.total_accepted_ytd_cents ?? 0) - (a.vendor.total_accepted_ytd_cents ?? 0) || byName(a, b),
    lots: (a, b) => b.lots.lotsTotal - a.lots.lotsTotal || byName(a, b),
  };
  return out.sort(cmp[p.nsort]);
}

/* ------------------------------------------------------------------
 * CSV (RFC-4180, money as dollars at the boundary)
 * ------------------------------------------------------------------ */

export function csvCell(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? "" : String(value);
  // A leading = + - @ would run as a formula in a spreadsheet; quote-prefix it.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function dollars(minor: number | null | undefined): string {
  if (minor === null || minor === undefined || !Number.isFinite(minor)) return "";
  return (Math.trunc(minor) / 100).toFixed(2);
}

function csv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function searchedCsv(rows: readonly SearchedRow[], nowMs: number): string {
  const head = [
    "Vendor", "License", "Match", "Menu names", "Sources", "Latest usable menu", "Menu age (days)", "Freshness",
    "Items", "Item change vs previous", "Wholesale low", "Wholesale median", "Wholesale high", "Avg THC %", "Max THC %",
    "Top categories", "Photos %", "COAs %", "Items in stock", "Pulls", "Failed pulls", "Our lots in stock", "Our lots total",
    "Last received", "Remembered platform",
  ];
  const body = rows.map((r) => {
    const lu = r.latestUsable;
    const head0 = r.sources.find((s) => lu && s.latestId === lu.id);
    return [
      r.name, r.vendor?.license_number ?? "", matchHowLabel(r.match), r.menuNames.join(" | "),
      r.sources.map((s) => sourceLabel(s.source)).join(" | "),
      lu ? pacificDayKey(new Date(ts(lu.fetchedAt))) : "",
      lu ? Math.floor((nowMs - ts(lu.fetchedAt)) / DAY_MS) : "",
      r.hasUsable ? r.freshness : "no usable menu",
      lu?.itemCount ?? 0, head0?.deltaItems ?? "",
      dollars(r.facts?.priceMin), dollars(r.facts?.priceMedian), dollars(r.facts?.priceMax),
      r.facts?.thcAvg ?? "", r.facts?.thcMax ?? "", (r.facts?.topCategories ?? []).join(" | "),
      r.facts?.photoPct ?? "", r.facts?.coaPct ?? "", r.facts && r.facts.qtyReported ? r.facts.inStockItems : "",
      r.pulls, r.failedPulls, r.lots?.lotsInStock ?? "", r.lots?.lotsTotal ?? "", r.lots?.lastReceived ?? "",
      rememberedLabel(r.rememberedPlatform),
    ];
  });
  return csv([head, ...body]);
}

export function neededCsv(rows: readonly NeededRow[]): string {
  const head = [
    "Vendor", "DBA", "License", "Priority", "Lots in stock", "Units on hand", "Lots total", "First received",
    "Last received", "Days since received", "Top categories", "YTD accepted", "Remembered platform",
    "Failed attempts", "Email", "Phone", "Website",
  ];
  const body = rows.map((r) => [
    r.vendor.display_name, r.vendor.dba ?? "", r.vendor.license_number ?? "", needGroupLabel(r.group),
    r.lots.lotsInStock, Math.round(r.lots.unitsOnHand * 100) / 100, r.lots.lotsTotal, r.lots.firstReceived ?? "",
    r.lots.lastReceived ?? "", r.daysSinceReceived ?? "", r.lots.categories.join(" | "),
    dollars(r.vendor.total_accepted_ytd_cents), rememberedLabel(r.rememberedPlatform), r.attempts.length,
    r.vendor.email ?? "", r.vendor.phone ?? "", r.vendor.website ?? "",
  ]);
  return csv([head, ...body]);
}

/* ------------------------------------------------------------------
 * Self-tests
 * ------------------------------------------------------------------ */

export function __runVendorMenuCoverageCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`vendor-menu-coverage-core FAIL: ${msg}`);
    }
  };
  const NOW = Date.parse("2026-11-08T03:00:00Z"); // 2026-11-07 19:00 Pacific
  ok(rememberedTone("growflow") === "gold" && rememberedTone("bogus") === "neutral" && rememberedTone(null) === "neutral", "rememberedTone");
  const V = (id: string, name: string, extra: Partial<CoverageVendor> = {}): CoverageVendor => ({
    id, display_name: name, slug: id, dba: null, legal_name: null, license_number: null, email: null, phone: null,
    website: null, is_active: true, total_accepted_ytd_cents: null, last_accepted_at: null, ...extra,
  });
  const S = (id: string, source: MenuSource, label: string, fetchedAt: string, extra: Partial<CoverageSnapshot> = {}): CoverageSnapshot => ({
    source, id, vendorId: null, label, altLabel: null, license: null, status: "fetched", itemCount: 10, fetchedAt,
    errorMessage: null, ...extra,
  });

  // usable / freshness / age / money / median
  ok(isUsableSnapshot({ status: "fetched", itemCount: 1 }), "fetched+items usable");
  ok(isUsableSnapshot({ status: "PARSED", itemCount: 3 }), "parsed usable (case)");
  ok(!isUsableSnapshot({ status: "fetched", itemCount: 0 }), "no items not usable");
  ok(!isUsableSnapshot({ status: "error", itemCount: 5 }), "error not usable");
  ok(!isUsableSnapshot({ status: "empty", itemCount: 0 }), "empty not usable");
  ok(menuFreshness("2026-11-05T00:00:00Z", NOW) === "fresh", "3 days fresh");
  ok(menuFreshness("2026-10-20T00:00:00Z", NOW) === "aging", "19 days aging");
  ok(menuFreshness("2026-09-01T00:00:00Z", NOW) === "stale", "68 days stale");
  ok(menuFreshness("nope", NOW) === "unknown", "bad date unknown");
  ok(ageLabel("2026-11-08T02:30:00Z", NOW) === "30m ago", "age minutes");
  ok(ageLabel("2026-11-01T03:00:00Z", NOW) === "7d ago", "age days");
  ok(ageLabel(null, NOW) === "", "age blank");
  ok(money(123456) === "$1,234.56", "money format");
  ok(money(-5) === "-$0.05", "money negative");
  ok(money(null) === "—", "money null");
  ok(medianInt([300, 100, 200]) === 200, "median odd");
  ok(medianInt([100, 201]) === 151, "median even rounds to whole cents");
  ok(medianInt([]) === null, "median empty");
  // Pacific days: 2026-11-08T03:00Z is still Nov 7 in Pacific (rule 9).
  ok(pacificDaysSince("2026-11-07", NOW) === 0, "pacific today = 0 (UTC is already the 8th)");
  ok(pacificDaysSince("2026-11-06T12:00:00Z", NOW) === 1, "pacific yesterday");
  ok(pacificDaysSince(null, NOW) === null, "pacific null");

  // Matching
  const vendors = [
    V("v1", "Fine Detail Greenway", { license_number: "412345", email: "sales@fd.com" }),
    V("v2", "Seattle's Private Reserve", { dba: "SPR" }),
    V("v3", "Twin Peaks", { license_number: "400001" }),
    V("v4", "Twin  Peaks!", { license_number: "400002" }),
    V("v5", "Carried Only Co", { email: "hi@carried.co", total_accepted_ytd_cents: 250000 }),
    V("v6", "Old Friend Farms"),
    V("v7", "Recent Farms"),
    V("v8", "Brand Parent LLC"),
  ];
  const match = buildVendorMatcher(vendors, [{ vendor_id: "v2", source_name: "SPR Wholesale" }], [{ vendor_id: "v8", display_name: "Blazy Susan" }]);
  ok(match({ vendorId: "v6", label: "whatever", altLabel: null, license: null }).how === "linked", "linked wins");
  ok(match({ vendorId: "ghost", label: "Fine Detail Greenway", altLabel: null, license: null }).how === "name", "unknown link id falls through");
  const lic = match({ vendorId: null, label: "Totally Different", altLabel: null, license: "412-345" });
  ok(lic.how === "license" && lic.vendorId === "v1", "license digits match");
  const licLabel = match({ vendorId: null, label: "FDG - 412345", altLabel: null, license: null });
  ok(licLabel.how === "license" && licLabel.vendorId === "v1", "license from label suffix");
  const nm = match({ vendorId: null, label: "Seattles  private-reserve", altLabel: null, license: null });
  ok(nm.how === "name" && nm.vendorId === "v2", "normalized name");
  ok(match({ vendorId: null, label: "spr", altLabel: null, license: null }).vendorId === "v2", "dba name");
  ok(match({ vendorId: null, label: "SPR Wholesale", altLabel: null, license: null }).how === "alias", "alias");
  const br = match({ vendorId: null, label: "Blazy Susan", altLabel: null, license: null });
  ok(br.how === "brand" && br.vendorId === "v8", "brand → vendor");
  const amb = match({ vendorId: null, label: "Twin Peaks", altLabel: null, license: null });
  ok(amb.how === "ambiguous" && amb.vendorId === null && amb.candidates === 2, "ambiguous name never guessed");
  const alt = match({ vendorId: null, label: "Unknown Brand", altLabel: "Fine Detail Greenway", license: null });
  ok(alt.vendorId === "v1", "alt label (LeafLink company)");
  ok(match({ vendorId: null, label: "Nobody", altLabel: null, license: null }).how === "none", "no match");
  ok(matchHowLabel("ambiguous").includes("more than one"), "ambiguous label");

  // Lots
  const lots: CoverageLot[] = [
    { vendor_id: "v1", on_hand_qty: 5, status: "active", received_on: "2026-10-01", created_at: null, category: "Flower" },
    { vendor_id: "v1", on_hand_qty: 0, status: "sold_out", received_on: "2026-06-01", created_at: null, category: "Flower" },
    { vendor_id: "v5", on_hand_qty: 3, status: "active", received_on: null, created_at: "2026-11-01T20:00:00Z", category: "Edible" },
    { vendor_id: "v5", on_hand_qty: 9, status: "destroyed", received_on: "2026-11-02", created_at: null, category: null },
    { vendor_id: "v6", on_hand_qty: 0, status: "sold_out", received_on: "2025-01-10", created_at: null, category: "Vape" },
    { vendor_id: "v7", on_hand_qty: 0, status: "sold_out", received_on: "2026-10-20", created_at: null, category: "Vape" },
    { vendor_id: "v2", on_hand_qty: 2, status: "active", received_on: "2026-11-03", created_at: null, category: "Preroll" },
  ];
  const lotMap = rollupLots(lots);
  const l1 = lotMap.get("v1")!;
  ok(l1.lotsTotal === 2 && l1.lotsInStock === 1 && l1.unitsOnHand === 5, "lot counts");
  ok(l1.firstReceived === "2026-06-01" && l1.lastReceived === "2026-10-01", "received range");
  ok(l1.categories[0] === "Flower", "top lot category");
  const l5 = lotMap.get("v5")!;
  ok(l5.lotsInStock === 1 && l5.unitsOnHand === 3, "destroyed lot not counted as stock");
  ok(l5.firstReceived === "2026-11-01", "created_at fallback is the Pacific day");
  ok(lotReceivedDay({ received_on: null, created_at: "2026-11-08T03:00:00Z" }) === "2026-11-07", "created_at Pacific (rule 9)");

  // Items
  const sum = summarizeItems([
    { snapshotId: "a", priceMinor: 1000, thcPct: 20, category: "Flower", hasImage: true, hasCoa: true, availableQty: 4 },
    { snapshotId: "a", priceMinor: 3000, thcPct: 30, category: "Flower", hasImage: false, hasCoa: true, availableQty: 0 },
    { snapshotId: "a", priceMinor: 2000, thcPct: 250, category: "Vape", hasImage: true, hasCoa: false, availableQty: null },
    { snapshotId: "a", priceMinor: 0, thcPct: null, category: null, hasImage: false, hasCoa: false, availableQty: 2 },
  ]);
  ok(sum.items === 4 && sum.priced === 3, "priced excludes 0");
  ok(sum.priceMin === 1000 && sum.priceMedian === 2000 && sum.priceMax === 3000, "price spread");
  ok(sum.thcAvg === 25 && sum.thcMax === 30, "THC ignores > 100");
  ok(sum.topCategories[0] === "Flower", "top category");
  ok(sum.photoPct === 50 && sum.coaPct === 50, "photo/coa pct");
  ok(sum.inStockItems === 2 && sum.qtyReported === 3, "in stock counts only reported qty");
  ok(summarizeItems([]).priceMin === null && summarizeItems([]).photoPct === null, "empty summary");

  // Searched rows
  const snaps: CoverageSnapshot[] = [
    S("c-old", "cultivera", "Fine Detail Greenway", "2026-10-01T00:00:00Z", { itemCount: 40 }),
    S("c-new", "cultivera", "Fine Detail Greenway", "2026-11-06T00:00:00Z", { itemCount: 52 }),
    S("c-err", "cultivera", "Fine Detail Greenway", "2026-11-07T00:00:00Z", { status: "error", itemCount: 0, errorMessage: "timeout" }),
    S("g1", "growflow", "FDG", "2026-09-01T00:00:00Z", { license: "412345", itemCount: 7 }),
    S("e1", "email", "Old Friend Farms", "2026-10-30T00:00:00Z", { vendorId: "v6", status: "empty", itemCount: 0 }),
    S("l1", "leaflink", "Mystery Brand", "2026-08-01T00:00:00Z", { itemCount: 3 }),
    S("t1", "growflow", "Twin Peaks", "2026-11-01T00:00:00Z", { itemCount: 4 }),
  ];
  const latestIds = latestUsableSnapshotIds(snaps, match);
  ok(latestIds.cultivera.length === 1 && latestIds.cultivera[0] === "c-new", "only newest usable cultivera read");
  ok(latestIds.growflow.includes("g1") && latestIds.growflow.includes("t1"), "growflow per group");
  ok(latestIds.email.length === 0, "unusable email not read");
  // Order-independent: the newest wins even when it is listed FIRST.
  const reversed = latestUsableSnapshotIds(snaps.slice().reverse(), match);
  ok(reversed.cultivera.length === 1 && reversed.cultivera[0] === "c-new", "newest usable regardless of input order");
  const items = new Map<string, CoverageItem[]>([
    ["c-new", [{ snapshotId: "c-new", priceMinor: 1500, thcPct: 22, category: "Flower", hasImage: true, hasCoa: false, availableQty: 3 }]],
    ["g1", [{ snapshotId: "g1", priceMinor: 900, thcPct: null, category: "Vape", hasImage: false, hasCoa: true, availableQty: null }]],
    ["c-old", [{ snapshotId: "c-old", priceMinor: 99999, thcPct: 1, category: "X", hasImage: false, hasCoa: false, availableQty: 0 }]],
  ]);
  const memories: CoverageMemory[] = [
    { vendor_key: "fine detail greenway", vendor_name: "Fine Detail Greenway", license_number: null, platform: "cultivera", last_seen_at: "2026-11-06T00:00:00Z" },
    { vendor_key: "fdg", vendor_name: "FDG", license_number: "412345", platform: "growflow", last_seen_at: "2026-09-01T00:00:00Z" },
    { vendor_key: "carried only co", vendor_name: "Carried Only Co", license_number: null, platform: "leaflink", last_seen_at: "2026-10-01T00:00:00Z" },
  ];
  const searched = buildSearchedRows({ snapshots: snaps, vendors, match, itemsBySnapshot: items, lotsByVendor: lotMap, memories, nowMs: NOW });
  const fd = searched.find((r) => r.vendorId === "v1")!;
  ok(Boolean(fd), "fd grouped by vendor");
  ok(fd.pulls === 4 && fd.failedPulls === 1, "fd pulls across sources (incl. failed)");
  ok(fd.sources.length === 2, "fd two sources");
  const fdCv = fd.sources.find((s) => s.source === "cultivera")!;
  ok(fdCv.latestId === "c-new" && fdCv.deltaItems === 12 && fdCv.pulls === 3, "cv head is newest USABLE; delta vs previous usable");
  ok(fd.latest.id === "c-err" && fd.latestUsable?.id === "c-new", "latest vs latest usable");
  ok(fd.freshness === "fresh", "fd fresh");
  ok(fd.facts?.items === 2 && fd.facts?.priceMin === 900 && fd.facts?.priceMax === 1500, "facts combine newest per source, ignore old");
  ok(fd.lots?.lotsInStock === 1, "fd our lots");
  ok(fd.rememberedPlatform === "cultivera", "remembered newest platform");
  ok(fd.menuNames.includes("FDG"), "menu alias names listed");
  ok(fd.match === "name" || fd.match === "license", "fd match how recorded");
  const off = searched.find((r) => r.vendorId === "v6")!;
  ok(off.match === "linked" && !off.hasUsable && off.freshness === "unknown", "email linked but unusable");
  const myst = searched.find((r) => r.name === "Mystery Brand")!;
  ok(myst.vendorId === null && myst.match === "none" && myst.freshness === "stale", "unlinked row kept, stale");
  const tw = searched.find((r) => r.name === "Twin Peaks")!;
  ok(tw.match === "ambiguous" && tw.vendorId === null, "ambiguous row unlinked");

  // Needed rows
  const needed = buildNeededRows({ vendors, lotsByVendor: lotMap, searched, memories, nowMs: NOW });
  const ids = needed.map((n) => n.vendor.id).sort();
  ok(JSON.stringify(ids) === JSON.stringify(["v2", "v5", "v6", "v7"]), `needed = carried minus covered (${ids.join(",")})`);
  ok(!ids.includes("v1"), "covered vendor excluded");
  ok(!ids.includes("v3") && !ids.includes("v8"), "vendors with no lots excluded");
  const n5 = needed.find((n) => n.vendor.id === "v5")!;
  ok(n5.group === "on_shelf" && n5.rememberedPlatform === "leaflink", "on shelf + memory");
  ok(n5.mailto.startsWith("mailto:hi@carried.co?subject=") && !n5.mailto.includes("body="), "mailto subject only, blank body");
  ok(needed.find((n) => n.vendor.id === "v7")!.group === "recent", "recent group (18 days)");
  const n6 = needed.find((n) => n.vendor.id === "v6")!;
  ok(n6.group === "older" && n6.attempts.length === 1 && n6.attempts[0].id === "e1", "older + failed attempt shown");
  ok(needed.find((n) => n.vendor.id === "v2")!.mailto === "", "no email → no mailto");

  // KPIs
  const k = coverageKpis(searched, needed, lotMap);
  ok(k.carried === 5, `carried ${k.carried}`);
  ok(k.covered === 1 && k.coveredPct === 20, `covered ${k.covered} ${k.coveredPct}`);
  ok(k.needed === 4 && k.neededOnShelf === 2, "needed kpis");
  ok(k.unlinked === 2, "unlinked kpi (mystery + ambiguous)");
  ok(k.stale === 1, "stale kpi (mystery)");

  // Params + filters + sorts
  const p = parseCoverageParams({ ssrc: "growflow", ssort: "bogus", ngrp: "on_shelf", sq: ["fine", "x"] });
  ok(p.ssrc === "growflow" && p.ssort === "newest" && p.ngrp === "on_shelf" && p.sq === "fine", "params parse + defaults");
  ok(parseCoverageParams({ ssrc: "evil" }).ssrc === "", "unknown source dropped");
  ok(coverageHref("/m", parseCoverageParams({}), { ssort: "name" }) === "/m?ssort=name", "href keeps only non-defaults");
  ok(coverageHref("/m", parseCoverageParams({}), {}, "#x") === "/m#x", "href hash");
  ok(filterSortSearched(searched, p).every((r) => r.sources.some((s) => s.source === "growflow")), "source filter");
  ok(filterSortSearched(searched, parseCoverageParams({ sfresh: "failed" })).every((r) => !r.hasUsable), "failed filter");
  ok(filterSortSearched(searched, parseCoverageParams({ slink: "unlinked" })).length === 2, "unlinked filter");
  ok(filterSortSearched(searched, parseCoverageParams({ slink: "carried" })).every((r) => (r.lots?.lotsTotal ?? 0) > 0), "carried filter");
  ok(filterSortSearched(searched, parseCoverageParams({ sq: "flower" })).some((r) => r.vendorId === "v1"), "text search hits categories");
  const byNewest = filterSortSearched(searched, parseCoverageParams({}));
  ok(byNewest[0].vendorId === "v1", "newest first by latest usable");
  const byOld = filterSortSearched(searched, parseCoverageParams({ ssort: "oldest" }));
  ok(byOld[0].name === "Mystery Brand", "oldest first");
  const nd = filterSortNeeded(needed, parseCoverageParams({}));
  ok(nd[0].group === "on_shelf" && nd[nd.length - 1].group === "older", "needed default: shelf first");
  ok(filterSortNeeded(needed, parseCoverageParams({ nsort: "ytd" }))[0].vendor.id === "v5", "ytd sort");
  ok(filterSortNeeded(needed, parseCoverageParams({ ngrp: "tried" })).length === 1, "tried filter");
  ok(filterSortNeeded(needed, parseCoverageParams({ nq: "vape" })).length === 2, "needed text hits lot categories");

  // CSV
  ok(csvCell('a,"b"') === '"a,""b"""', "csv quote");
  ok(csvCell("=HYPERLINK(1)") === "'=HYPERLINK(1)", "csv formula guard");
  ok(csvCell("-12.50") === "-12.50", "csv negative number untouched");
  const sc = searchedCsv(searched, NOW);
  ok(sc.split("\r\n")[0].startsWith("Vendor,License,Match"), "searched csv header");
  ok(sc.includes("15.00") && sc.includes("9.00"), "csv dollars at boundary");
  const nc = neededCsv(needed);
  ok(nc.split("\r\n").length === needed.length + 2, "needed csv rows + header + trailing");
  ok(nc.includes("2500.00"), "needed csv YTD dollars");

  return { passed, failed };
}
