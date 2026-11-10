/**
 * D212 — Vendor logo fetch (PURE core, rule 5).
 *
 * The owner wants ONE button on the Vendor Menus page that finds a vendor's
 * logo on its GrowFlow / Cultivera / LeafLink profile, saves it to the Media
 * Library (the knowledge base), attaches it to the vendor AND every brand of
 * that vendor, and PUBLISHES it so the customer site shows it at once.
 *
 * This file holds every decision that does not need the network or the
 * database, so it can be tested exhaustively:
 *   - reading the logo URL out of each platform's (pinned) record shape;
 *   - refusing anything that is not a real, absolute http(s) image address
 *     (rule 3: a relative path or placeholder is reported, never guessed at);
 *   - deciding whether a marketplace profile really is THIS vendor (license /
 *     name / alias / brand via the D209 matcher; an ambiguous fit is refused);
 *   - the platform order (remembered platform first);
 *   - the vendor + brand write plan (what gets the logo, what gets published,
 *     what is left alone because a human curated it, what is archived and
 *     therefore never resurrected);
 *   - the plain-English result line staff read.
 *
 * Pinned shapes (see docs/sop-program/00-OWNER-REQUEST-VERBATIM.md § D212):
 *   GrowFlow  getStoreFrontsV2 store  → `LogoUrl`   (growflow_api.py)
 *   Cultivera /markets/connected rec  → `Logo`      ({ Id, Name, UniqueSlug, Logo, Status })
 *   LeafLink  brands/<id> header      → `image`     (LEAFLINK_PINNED.md; worker raw.brand)
 *
 * Self-tests: __runVendorLogoCoreTests() — registered in
 * scripts/compliance/run-pure-selftests.ts and mirrored in
 * tests/compliance/d212-vendor-logo.test.ts.
 */
import { normalizeStore, type VendorPlatform } from "@/lib/purchasing/growflow-menu-core";
import { marketId, marketName, marketSlug } from "@/lib/purchasing/cultivera-menus-ui-core";
import { normalizeBrandHit } from "@/lib/purchasing/leaflink-menu-core";
import { normalizeLicense, stripLicenseSuffix } from "@/lib/inventory/vendor-resolve-core";
import {
  buildVendorMatcher,
  looseVendorKey,
  type CoverageAlias,
  type CoverageBrand,
  type CoverageVendor,
  type VendorMatcher,
  type VendorMatcherOptions,
} from "@/lib/purchasing/vendor-menu-coverage-core";
import { normalizeVendorKey } from "@/lib/purchasing/unified-search-core";

export type LogoPlatform = VendorPlatform; // "cultivera" | "growflow" | "leaflink"

export const LOGO_PLATFORMS: readonly LogoPlatform[] = ["growflow", "cultivera", "leaflink"];

export function logoPlatformLabel(p: LogoPlatform): string {
  if (p === "growflow") return "GrowFlow";
  if (p === "leaflink") return "LeafLink";
  return "Cultivera";
}

/** One marketplace profile that might be this vendor. */
export type LogoCandidate = {
  platform: LogoPlatform;
  /** Platform id: GrowFlow store id / Cultivera market id (or slug) / LeafLink brand id. */
  ref: string;
  name: string;
  /** Secondary name (LeafLink selling company). */
  altName: string | null;
  license: string | null;
  /** Cleaned absolute logo URL, or null when the record had none usable. */
  logoUrl: string | null;
  /** Why logoUrl is null when the record DID carry something (rule 3: say so). */
  logoProblem: string | null;
};

/* ------------------------------------------------------------------
 * URL hygiene
 * ------------------------------------------------------------------ */

/** Obvious "no logo uploaded" art — publishing it would be worse than nothing. */
const PLACEHOLDER_HINT = /(placeholder|default[-_]?(logo|avatar|image)|no[-_]?(logo|image|photo)|missing[-_]?(logo|image)|blank\.(png|jpe?g|gif|svg))/i;

export type CleanedUrl = { url: string | null; problem: string | null };

/**
 * Accept only an absolute http(s) address. A scheme-relative `//cdn/x.png` is
 * the web's own shorthand for "same scheme" and is promoted to https. A bare
 * relative path ("/uploads/x.png") is REFUSED: we do not know which host it is
 * relative to and will not guess (rule 3).
 */
export function cleanLogoUrl(raw: unknown): CleanedUrl {
  let v: unknown = raw;
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    v = o.url ?? o.Url ?? o.src ?? o.href ?? o.original ?? null;
  }
  if (typeof v !== "string") return { url: null, problem: null };
  const s = v.trim();
  if (!s) return { url: null, problem: null };
  if (s.startsWith("data:")) return { url: null, problem: "the logo is an inline data image, not a web address" };
  let candidate = s;
  if (candidate.startsWith("//")) candidate = `https:${candidate}`;
  if (!/^https?:\/\//i.test(candidate)) {
    return { url: null, problem: `the logo address is not a full web address (${s.slice(0, 80)})` };
  }
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { url: null, problem: "the logo address is not valid" };
  }
  if (PLACEHOLDER_HINT.test(parsed.pathname)) {
    return { url: null, problem: "the profile only has a placeholder image, not a real logo" };
  }
  return { url: parsed.toString(), problem: null };
}

/* ------------------------------------------------------------------
 * Per-platform candidate readers (tolerant, pinned keys first)
 * ------------------------------------------------------------------ */

function str(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

function firstOf(rec: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const k of keys) {
    const v = rec[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
}

export function growflowLogoCandidate(rec: Record<string, unknown>): LogoCandidate {
  const s = normalizeStore(rec);
  const c = cleanLogoUrl(s.logoUrl);
  return {
    platform: "growflow",
    ref: s.storeId ?? "",
    name: s.name ?? "",
    altName: null,
    license: s.licenseNumber,
    logoUrl: c.url,
    logoProblem: c.problem,
  };
}

const CULTIVERA_LOGO_KEYS = ["Logo", "LogoUrl", "LogoURL", "logo", "logoUrl", "logo_url"] as const;
const CULTIVERA_LICENSE_KEYS = ["LicenseNumber", "licenseNumber", "License", "license"] as const;

export function cultiveraLogoCandidate(rec: Record<string, unknown>): LogoCandidate {
  const c = cleanLogoUrl(firstOf(rec, CULTIVERA_LOGO_KEYS));
  return {
    platform: "cultivera",
    ref: marketId(rec) || marketSlug(rec),
    name: marketName(rec),
    altName: null,
    license: str(firstOf(rec, CULTIVERA_LICENSE_KEYS)) || null,
    logoUrl: c.url,
    logoProblem: c.problem,
  };
}

/**
 * LeafLink brand hits. D222: the worker now finds brands through LeafLink's
 * own brands listing, whose rows carry the brand LOGO as `logo_url` (pinned
 * live 2026-11-09: the listing row's `image`). An older worker's product-search
 * hits carry no logo (their `sample_image` is a PRODUCT photo, never used as a
 * logo) — then logoUrl is null with no problem and the caller reads the brand
 * header for the one hit that matched.
 */
export function leaflinkSearchCandidate(rec: Record<string, unknown>): LogoCandidate {
  const h = normalizeBrandHit(rec);
  const c = cleanLogoUrl(rec.logo_url);
  return {
    platform: "leaflink",
    ref: h.brandId ?? "",
    name: (h.brandName ?? "").trim(),
    altName: (h.companyName ?? "").trim() || null,
    license: null,
    logoUrl: c.url,
    logoProblem: c.problem,
  };
}

/** The logo from a LeafLink menu payload ({ brand: header, products }). */
export function leaflinkHeaderLogo(raw: unknown): CleanedUrl {
  const env = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const brand = env.brand && typeof env.brand === "object" ? (env.brand as Record<string, unknown>) : env;
  return cleanLogoUrl(firstOf(brand, ["image", "logo", "logo_url", "image_url"]));
}

/* ------------------------------------------------------------------
 * Search terms + platform order
 * ------------------------------------------------------------------ */

export type LogoVendor = CoverageVendor & {
  status: string | null;
  logo_media_id: string | null;
};

/** Names to search the marketplaces with, best first, license suffix removed, de-duplicated. */
export function vendorSearchTerms(v: Pick<CoverageVendor, "display_name" | "dba" | "legal_name">): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const n of [v.display_name, v.dba, v.legal_name]) {
    const t = stripLicenseSuffix(n ?? "").replace(/\s+/g, " ").trim();
    const k = t.toLowerCase();
    if (t.length >= 2 && !seen.has(k)) {
      seen.add(k);
      out.push(t);
    }
  }
  return out;
}

/** One saved menu pull, reduced to what the logo fetch needs (D222). */
export type LogoSnapshot = {
  platform: LogoPlatform;
  /** Snapshot row's own vendor_id (normally null for marketplace pulls). */
  vendorId: string | null;
  /** The marketplace's name for the seller (store / seller / brand). */
  label: string;
  /** LeafLink selling company / Cultivera slug words. */
  altLabel: string | null;
  license: string | null;
  /** GrowFlow store id / Cultivera market id / LeafLink brand id. */
  ref: string | null;
  /** Cultivera market slug (a second ref). */
  slug: string | null;
};

export type KnownProfile = { platform: LogoPlatform; ref: string | null; slug: string | null; name: string };

/**
 * D222 — the marketplace profiles whose saved menus the Vendor Menus page
 * already places on this vendor's row (same matcher, same decision). They are
 * the most direct route to the logo: the exact profile id and the exact
 * marketplace name. De-duplicated, newest first as given.
 */
export function knownProfilesFor(
  vendorId: string,
  snapshots: readonly LogoSnapshot[],
  match: VendorMatcher,
): KnownProfile[] {
  const out: KnownProfile[] = [];
  const seen = new Set<string>();
  for (const s of snapshots) {
    if (!s.label && !s.ref) continue;
    const m = match({ vendorId: s.vendorId, label: s.label, altLabel: s.altLabel, license: s.license });
    if (m.vendorId !== vendorId) continue;
    const k = `${s.platform}|${(s.ref ?? "").toLowerCase()}|${(s.slug ?? "").toLowerCase()}|${s.label.toLowerCase()}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ platform: s.platform, ref: s.ref, slug: s.slug, name: s.label });
  }
  return out;
}

/** `platform:ref` keys (ids AND Cultivera slugs) of the known profiles. */
export function knownRefKeys(profiles: readonly KnownProfile[]): Set<string> {
  const out = new Set<string>();
  for (const p of profiles) {
    for (const r of [p.ref, p.slug]) {
      const k = profileKey(p.platform, r);
      if (k) out.add(k);
    }
  }
  return out;
}

/**
 * D222 — every name worth searching a marketplace with, best first:
 * the exact marketplace names of known profiles, then our names (display,
 * DBA, legal), then aliases and brand names, then each name with LLC / Inc /
 * Co dropped. The marketplaces search by "contains", so a long legal name
 * ("Blue Roots Cannabis Co") never finds the short store name ("Blue Roots")
 * — that was a main reason logos sat on profiles but were not fetched.
 * Same-letters duplicates are removed; capped so a click stays fast.
 */
export function logoSearchTerms(
  v: Pick<CoverageVendor, "id" | "display_name" | "dba" | "legal_name">,
  extra: {
    knownNames?: readonly string[];
    aliases?: readonly CoverageAlias[];
    brands?: readonly CoverageBrand[];
    cap?: number;
  } = {},
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string | null | undefined) => {
    const t = stripLicenseSuffix(raw ?? "").replace(/[\u2122\u00ae\u00a9]/g, "").replace(/\s+/g, " ").trim();
    const k = t.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (k.length >= 3 && !seen.has(k)) {
      seen.add(k);
      out.push(t);
    }
  };
  for (const n of extra.knownNames ?? []) push(n);
  const ours = [v.display_name, v.dba, v.legal_name];
  for (const n of ours) push(n);
  for (const a of extra.aliases ?? []) {
    if (a.vendor_id !== v.id) continue;
    if (/^license:/i.test(a.source_name ?? "")) continue;
    push(a.source_name);
  }
  for (const b of extra.brands ?? []) if (b.vendor_id === v.id) push(b.display_name);
  for (const n of ours) {
    const loose = looseVendorKey(stripLicenseSuffix(n ?? ""));
    if (loose) push(loose);
  }
  return out.slice(0, Math.max(1, extra.cap ?? 8));
}

/**
 * D222 — platform order: platforms where this vendor already has a saved
 * menu first (in the order given), then the remembered platform, then the
 * default GrowFlow → Cultivera → LeafLink.
 */
export function logoPlatformOrderFor(known: readonly KnownProfile[], remembered: string | null | undefined): LogoPlatform[] {
  const out: LogoPlatform[] = [];
  for (const p of known) if (!out.includes(p.platform)) out.push(p.platform);
  for (const p of logoPlatformOrder(remembered)) if (!out.includes(p)) out.push(p);
  return out;
}

const alnum = (x: string | null | undefined) => (x ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * D222 — GrowFlow and LeafLink hand back their WHOLE storefront / brand list
 * in one call, so the logo fetch reads each list once per click and judges it
 * locally. This prefilter keeps only rows that plausibly concern this vendor
 * (a known profile id, the same license, or a name that contains / is
 * contained in one of the search terms, ignoring spaces and punctuation)
 * before the strict matcher decides. It never accepts anything by itself.
 */
export function candidateMentions(
  c: LogoCandidate,
  terms: readonly string[],
  license: string | null | undefined,
  knownRefs?: ReadonlySet<string>,
): boolean {
  const key = profileKey(c.platform, c.ref);
  if (key && knownRefs?.has(key)) return true;
  const lic = normalizeLicense(license);
  if (lic && normalizeLicense(c.license) === lic) return true;
  const names = [c.name, c.altName].map(alnum).filter((n) => n.length >= 3);
  for (const t of terms) {
    const k = alnum(stripLicenseSuffix(t));
    if (k.length < 3) continue;
    for (const n of names) {
      if (n.includes(k)) return true;
      if (n.length >= 4 && k.includes(n)) return true;
    }
  }
  return false;
}

/** Saved menu rows + platform memory rows, as read by the store (D222). */
export type LogoSnapshotRows = {
  growflow: readonly { vendor_id: string | null; store_name: string | null; license_number: string | null; growflow_store_id: string | null }[];
  cultivera: readonly { vendor_id: string | null; seller_name: string | null; cultivera_market_id: string | null; cultivera_market_slug: string | null }[];
  leaflink: readonly { vendor_id: string | null; brand_name: string | null; company_name: string | null; leaflink_brand_id: string | null }[];
  memories: readonly { vendor_name: string | null; license_number: string | null; platform: string; platform_ref: string | null; platform_slug: string | null }[];
};

/** Map the stored rows to LogoSnapshot (same label rules as the coverage page). */
export function logoSnapshotsFromRows(rows: LogoSnapshotRows): LogoSnapshot[] {
  const t = (x: string | null | undefined) => (x ?? "").trim();
  const out: LogoSnapshot[] = [];
  for (const r of rows.growflow) {
    out.push({ platform: "growflow", vendorId: r.vendor_id, label: t(r.store_name), altLabel: null, license: t(r.license_number) || null, ref: t(r.growflow_store_id) || null, slug: null });
  }
  for (const r of rows.cultivera) {
    const name = t(r.seller_name);
    const slug = t(r.cultivera_market_slug);
    out.push({
      platform: "cultivera", vendorId: r.vendor_id,
      label: name || slug, altLabel: name && slug ? slug.replace(/-/g, " ") : null,
      license: null, ref: t(r.cultivera_market_id) || null, slug: slug || null,
    });
  }
  for (const r of rows.leaflink) {
    out.push({
      platform: "leaflink", vendorId: r.vendor_id,
      label: t(r.brand_name) || t(r.company_name), altLabel: t(r.company_name) || null,
      license: null, ref: t(r.leaflink_brand_id) || null, slug: null,
    });
  }
  for (const m of rows.memories) {
    const p = (m.platform ?? "").toLowerCase();
    if (!(LOGO_PLATFORMS as readonly string[]).includes(p)) continue;
    out.push({
      platform: p as LogoPlatform, vendorId: null, label: t(m.vendor_name), altLabel: null,
      license: t(m.license_number) || null, ref: t(m.platform_ref) || null, slug: t(m.platform_slug) || null,
    });
  }
  return out.filter((s) => s.label || s.ref);
}

/** Remembered platform first, then GrowFlow → Cultivera → LeafLink. */
export function logoPlatformOrder(remembered: string | null | undefined): LogoPlatform[] {
  const r = (remembered ?? "").toLowerCase();
  const first = (LOGO_PLATFORMS as readonly string[]).includes(r) ? (r as LogoPlatform) : null;
  return first ? [first, ...LOGO_PLATFORMS.filter((p) => p !== first)] : [...LOGO_PLATFORMS];
}

/* ------------------------------------------------------------------
 * Is this marketplace profile THIS vendor?
 * ------------------------------------------------------------------ */

/**
 * D222: build the matcher EXACTLY like the Vendor Menus page does (merged
 * cards resolve to their survivor via `merged_into_id`, and duplicate-card
 * ties are broken by `carried`). Before D222 the logo fetch built it without
 * either, so a vendor whose menu the page placed fine could come out
 * "ambiguous" / "another vendor" here and its logo was skipped.
 */
export function buildLogoMatcher(
  vendors: readonly CoverageVendor[],
  aliases: readonly CoverageAlias[] = [],
  brands: readonly CoverageBrand[] = [],
  opts: VendorMatcherOptions = {},
): VendorMatcher {
  return buildVendorMatcher(vendors, aliases, brands, opts);
}

export type CandidateVerdict = "match" | "other_vendor" | "ambiguous" | "no_match";

/** Extra evidence for judging a candidate (D222). */
export type JudgeOptions = {
  /** `platform:ref` keys of profiles whose saved menu is already on THIS vendor's row. */
  knownRefs?: ReadonlySet<string>;
  /** True when two live cards are the same business (same license or same exact name). */
  sameBusiness?: (a: string, b: string) => boolean;
};

export function profileKey(platform: LogoPlatform, ref: string | null | undefined): string {
  const r = (ref ?? "").trim();
  return r ? `${platform}:${r.toLowerCase()}` : "";
}

export function judgeCandidate(c: LogoCandidate, vendorId: string, match: VendorMatcher, opts: JudgeOptions = {}): CandidateVerdict {
  // 1. The very profile whose menu the page already shows on this vendor's row.
  const key = profileKey(c.platform, c.ref);
  if (key && opts.knownRefs?.has(key)) return "match";
  const m = match({ vendorId: null, label: c.name, altLabel: c.altName, license: c.license });
  if (m.vendorId === vendorId) return "match";
  // 2. A duplicate card of the SAME business (same license / exact same name):
  //    the logo is that business's logo either way.
  if (m.vendorId) return opts.sameBusiness?.(m.vendorId, vendorId) ? "match" : "other_vendor";
  if (m.how === "ambiguous") return "ambiguous";
  return "no_match";
}

/**
 * D222: (a, b) → are these two of OUR cards the same business? Only strict
 * evidence counts: the same license number, or the same exact name (display
 * / DBA / legal, license suffix removed). Archived cards never count here
 * (the survivor resolver already handles merged ones).
 */
export function buildSameBusiness(vendors: readonly CoverageVendor[]): (a: string, b: string) => boolean {
  const byId = new Map(vendors.map((v) => [v.id, v]));
  const keysOf = (v: CoverageVendor): Set<string> => {
    const out = new Set<string>();
    const lic = normalizeLicense(v.license_number);
    if (lic) out.add(`lic:${lic}`);
    for (const n of [v.display_name, v.dba, v.legal_name]) {
      const k = normalizeVendorKey(stripLicenseSuffix(n ?? ""));
      if (k.length >= 3) out.add(`name:${k}`);
    }
    return out;
  };
  const memo = new Map<string, Set<string>>();
  const keys = (id: string): Set<string> | null => {
    const v = byId.get(id);
    if (!v || (v.status ?? "").toLowerCase() === "archived") return null;
    let k = memo.get(id);
    if (!k) {
      k = keysOf(v);
      memo.set(id, k);
    }
    return k;
  };
  return (a, b) => {
    if (a === b) return true;
    const ka = keys(a);
    const kb = keys(b);
    if (!ka || !kb) return false;
    for (const k of ka) if (kb.has(k)) return true;
    return false;
  };
}

export type CandidatePick = {
  /** First matching candidate WITH a usable logo (or null). */
  pick: LogoCandidate | null;
  /** Matching candidates that need a follow-up read (LeafLink header). */
  needsHeader: LogoCandidate[];
  /** Matching candidates whose logo was refused, with the reason. */
  refused: { candidate: LogoCandidate; problem: string }[];
  /** Matching candidates that simply had no logo on the profile. */
  noLogo: LogoCandidate[];
  ambiguous: number;
};

export function pickLogoCandidate(
  candidates: readonly LogoCandidate[],
  vendorId: string,
  match: VendorMatcher,
  opts: JudgeOptions = {},
): CandidatePick {
  const out: CandidatePick = { pick: null, needsHeader: [], refused: [], noLogo: [], ambiguous: 0 };
  // D222: the profile already linked to this vendor (its saved menu) goes first.
  const known = (c: LogoCandidate) => (opts.knownRefs?.has(profileKey(c.platform, c.ref)) ? 0 : 1);
  const ordered = opts.knownRefs?.size ? [...candidates].sort((a, b) => known(a) - known(b)) : candidates;
  for (const c of ordered) {
    const verdict = judgeCandidate(c, vendorId, match, opts);
    if (verdict === "ambiguous") out.ambiguous += 1;
    if (verdict !== "match") continue;
    if (c.logoUrl) {
      if (!out.pick) out.pick = c;
      continue;
    }
    if (c.logoProblem) out.refused.push({ candidate: c, problem: c.logoProblem });
    else if (c.platform === "leaflink" && c.ref) out.needsHeader.push(c);
    else out.noLogo.push(c);
  }
  return out;
}

/* ------------------------------------------------------------------
 * The write plan (vendor + brands)
 * ------------------------------------------------------------------ */

export type LogoBrand = {
  id: string;
  display_name: string;
  vendor_id: string | null;
  status: string | null;
  logo_media_id: string | null;
};

export type BrandPlan = {
  brandId: string;
  name: string;
  setLogo: boolean;
  publish: boolean;
  /** Why the logo was NOT set (curated own logo). */
  keptOwnLogo: boolean;
  archived: boolean;
};

export type LogoPlan =
  | { kind: "skip"; reason: "has_logo" | "same_logo" | "archived" }
  | {
      kind: "apply";
      vendorUpdate: { logo_media_id: string; status?: "published" };
      publishedVendor: boolean;
      replacedLogoId: string | null;
      brands: BrandPlan[];
    };

/**
 * D212c/d. `replace` is the owner's explicit "Replace logo" click.
 *   - A vendor that already has a (different) logo is left alone unless replace.
 *   - An archived vendor is never touched (archive is a deliberate owner act).
 *   - A draft vendor is published so the logo "always shows up".
 *   - Each brand of the vendor gets the logo when it has none, or when its logo
 *     is the vendor's OLD logo (it was inherited, not curated). A brand with
 *     its own different logo keeps it. Draft brands are published; archived
 *     brands are reported and skipped.
 */
export function planLogoWrite(
  vendor: Pick<LogoVendor, "status" | "logo_media_id">,
  brands: readonly LogoBrand[],
  newAssetId: string,
  replace: boolean,
): LogoPlan {
  if ((vendor.status ?? "").toLowerCase() === "archived") return { kind: "skip", reason: "archived" };
  const prev = vendor.logo_media_id;
  if (prev && prev === newAssetId) {
    // Same bytes already attached: still make sure brands + publish are right.
    if (!brandsNeedWork(brands, prev, newAssetId) && (vendor.status ?? "") === "published") {
      return { kind: "skip", reason: "same_logo" };
    }
  } else if (prev && !replace) {
    return { kind: "skip", reason: "has_logo" };
  }
  const publishVendor = (vendor.status ?? "").toLowerCase() !== "published";
  const vendorUpdate: { logo_media_id: string; status?: "published" } = { logo_media_id: newAssetId };
  if (publishVendor) vendorUpdate.status = "published";
  return {
    kind: "apply",
    vendorUpdate,
    publishedVendor: publishVendor,
    replacedLogoId: prev && prev !== newAssetId ? prev : null,
    brands: brands.map((b) => planBrand(b, prev, newAssetId)),
  };
}

function planBrand(b: LogoBrand, prevVendorLogo: string | null, newAssetId: string): BrandPlan {
  const status = (b.status ?? "").toLowerCase();
  if (status === "archived") {
    return { brandId: b.id, name: b.display_name, setLogo: false, publish: false, keptOwnLogo: false, archived: true };
  }
  const own = b.logo_media_id;
  const inherits = !own || own === newAssetId || (prevVendorLogo !== null && own === prevVendorLogo);
  return {
    brandId: b.id,
    name: b.display_name,
    setLogo: inherits && own !== newAssetId,
    publish: status !== "published",
    keptOwnLogo: !inherits,
    archived: false,
  };
}

function brandsNeedWork(brands: readonly LogoBrand[], prev: string | null, next: string): boolean {
  return brands.some((b) => {
    const p = planBrand(b, prev, next);
    return p.setLogo || p.publish;
  });
}

/* ------------------------------------------------------------------
 * Result line + bulk queue
 * ------------------------------------------------------------------ */

export type LogoOutcome =
  | "attached"
  | "already_has_logo"
  | "same_logo"
  | "archived"
  | "not_found"
  | "refused"
  | "error";

export type LogoResult = {
  vendorId: string;
  vendorName: string;
  outcome: LogoOutcome;
  platform: LogoPlatform | null;
  logoUrl: string | null;
  mediaAssetId: string | null;
  brandsUpdated: number;
  brandsKept: number;
  brandsArchived: number;
  publishedVendor: boolean;
  /** Plain-English detail (reasons, platform notes). */
  notes: string[];
};

export function logoResultMessage(r: LogoResult): string {
  const who = r.vendorName;
  const where = r.platform ? logoPlatformLabel(r.platform) : "";
  const tail = r.notes.length ? ` ${r.notes.join(" ")}` : "";
  switch (r.outcome) {
    case "attached": {
      const parts = [`Logo from ${where} attached to ${who} and published to the website.`];
      if (r.brandsUpdated) parts.push(`Also attached to ${r.brandsUpdated} brand${r.brandsUpdated === 1 ? "" : "s"}.`);
      if (r.brandsKept) parts.push(`${r.brandsKept} brand${r.brandsKept === 1 ? "" : "s"} kept ${r.brandsKept === 1 ? "its" : "their"} own logo.`);
      if (r.brandsArchived) parts.push(`${r.brandsArchived} archived brand${r.brandsArchived === 1 ? " was" : "s were"} left alone.`);
      if (r.publishedVendor) parts.push("The vendor profile was a draft and is now published.");
      return parts.join(" ") + tail;
    }
    case "already_has_logo":
      return `${who} already has a logo, so nothing was changed. Use "Replace logo" to swap it.${tail}`;
    case "same_logo":
      return `${who} already shows this exact logo on the website.${tail}`;
    case "archived":
      return `${who} is archived, so its logo was not changed.${tail}`;
    case "not_found":
      return `No logo found for ${who} on GrowFlow, Cultivera or LeafLink.${tail}`;
    case "refused":
      return `A profile for ${who} was found but its logo could not be used.${tail}`;
    default:
      return `Could not fetch a logo for ${who}.${tail}`;
  }
}

export function isGoodOutcome(o: LogoOutcome): boolean {
  return o === "attached" || o === "same_logo";
}

/**
 * D212e bulk queue: vendors we carry (have lots) with no logo, archived and
 * inactive skipped, most urgent first (stock on the shelf, then most recently
 * received, then name). Capped per click.
 */
export function missingLogoQueue(
  vendors: readonly LogoVendor[],
  stock: ReadonlyMap<string, { lotsInStock: number; lotsTotal: number; lastReceived: string | null }>,
  cap: number,
): LogoVendor[] {
  const rows = vendors.filter((v) => {
    if (v.logo_media_id) return false;
    if ((v.status ?? "").toLowerCase() === "archived") return false;
    if (v.is_active === false) return false;
    return (stock.get(v.id)?.lotsTotal ?? 0) > 0;
  });
  rows.sort((a, b) => {
    const sa = stock.get(a.id)!;
    const sb = stock.get(b.id)!;
    const shelf = Number(sb.lotsInStock > 0) - Number(sa.lotsInStock > 0);
    if (shelf) return shelf;
    const rec = (sb.lastReceived ?? "").localeCompare(sa.lastReceived ?? "");
    if (rec) return rec;
    return a.display_name.localeCompare(b.display_name) || a.id.localeCompare(b.id);
  });
  return rows.slice(0, Math.max(0, cap));
}

/* ------------------------------------------------------------------
 * Self-tests
 * ------------------------------------------------------------------ */

export function __runVendorLogoCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`vendor-logo-core FAIL: ${msg}`);
    }
  };

  // --- cleanLogoUrl --------------------------------------------------------
  ok(cleanLogoUrl("https://cdn.x.com/a.png").url === "https://cdn.x.com/a.png", "https accepted");
  ok(cleanLogoUrl("  http://cdn.x.com/a.png ").url === "http://cdn.x.com/a.png", "http trimmed + accepted");
  ok(cleanLogoUrl("//cdn.x.com/a.png").url === "https://cdn.x.com/a.png", "scheme-relative promoted to https");
  {
    const r = cleanLogoUrl("/uploads/logo.png");
    ok(r.url === null && Boolean(r.problem?.includes("not a full web address")), "relative path refused with a reason (rule 3)");
  }
  {
    const r = cleanLogoUrl("data:image/png;base64,AAA");
    ok(r.url === null && Boolean(r.problem?.includes("inline")), "data URI refused");
  }
  ok(cleanLogoUrl(null).url === null && cleanLogoUrl(null).problem === null, "null → nothing, no problem");
  ok(cleanLogoUrl("   ").problem === null, "blank → nothing, no problem");
  ok(cleanLogoUrl(42).url === null, "number → nothing");
  ok(cleanLogoUrl({ url: "https://c/o.png" }).url === "https://c/o.png", "object {url} tolerated");
  ok(cleanLogoUrl({ Url: "https://c/o.png" }).url === "https://c/o.png", "object {Url} tolerated");
  {
    const r = cleanLogoUrl("https://cdn.x.com/img/placeholder-logo.png");
    ok(r.url === null && Boolean(r.problem?.includes("placeholder")), "placeholder art refused");
  }
  ok(cleanLogoUrl("https://cdn.x.com/img/default_avatar.png").url === null, "default avatar refused");
  ok(cleanLogoUrl("https://cdn.x.com/no-logo.svg").url === null, "no-logo refused");
  ok(cleanLogoUrl("https://cdn.x.com/brands/defaultfarms.png").url !== null, "a real name containing 'default' is kept");
  ok(cleanLogoUrl("https://placeholder.example.com/real.png").url !== null, "placeholder only checked in the PATH, not the host");
  ok(cleanLogoUrl("ftp://x/a.png").url === null, "ftp refused");

  // --- per-platform readers -------------------------------------------------
  {
    const c = growflowLogoCandidate({ Id: 1211, Name: "Fairwinds", LicenseNumber: "412345", LogoUrl: "https://growflowweb.blob.core.windows.net/l.png" });
    ok(c.platform === "growflow" && c.ref === "1211" && c.name === "Fairwinds", "growflow ref/name");
    ok(c.license === "412345" && c.logoUrl?.endsWith("/l.png") === true, "growflow license + LogoUrl");
  }
  ok(growflowLogoCandidate({ Id: 5, Name: "X" }).logoUrl === null, "growflow without LogoUrl");
  {
    const c = cultiveraLogoCandidate({ Id: "m-9", Name: "Ceres", UniqueSlug: "ceres", Logo: "https://files.cultivera.com/l/ceres.png", LicenseNumber: "435011" });
    ok(c.ref === "m-9" && c.name === "Ceres" && c.license === "435011", "cultivera ref/name/license");
    ok(c.logoUrl === "https://files.cultivera.com/l/ceres.png", "cultivera Logo (pinned key)");
  }
  {
    const c = cultiveraLogoCandidate({ UniqueSlug: "only-slug", Name: "S", Logo: "logos/s.png" });
    ok(c.ref === "only-slug", "cultivera falls back to slug for ref");
    ok(c.logoUrl === null && Boolean(c.logoProblem), "cultivera relative Logo refused, not guessed");
  }
  ok(cultiveraLogoCandidate({ Id: 1, Name: "N", logoUrl: "https://c/x.png" }).logoUrl === "https://c/x.png", "cultivera tolerant logoUrl key");
  {
    const c = leaflinkSearchCandidate({ brand_id: 11765, brand_name: "Blazy Susan", company_name: "Blazy Co" });
    ok(c.platform === "leaflink" && c.ref === "11765" && c.name === "Blazy Susan" && c.altName === "Blazy Co", "leaflink search candidate");
    ok(c.logoUrl === null && c.logoProblem === null, "leaflink search rows carry no logo");
  }
  ok(leaflinkHeaderLogo({ brand: { id: 1, image: "https://d3nec6hp1jgjd8.cloudfront.net/media/b.png" } }).url?.includes("cloudfront") === true, "leaflink header image");
  ok(leaflinkHeaderLogo({ brand: { id: 1 } }).url === null, "leaflink header without image");
  ok(leaflinkHeaderLogo({ image: "https://c/x.png" }).url === "https://c/x.png", "leaflink bare header tolerated");
  ok(leaflinkHeaderLogo(null).url === null, "leaflink null payload");

  // --- search terms + order -------------------------------------------------
  {
    const t = vendorSearchTerms({ display_name: "CERES - 435011", dba: "Ceres", legal_name: "Ceres Garden LLC" });
    ok(t.length === 2 && t[0] === "CERES" && t[1] === "Ceres Garden LLC", "terms: license stripped, case-dup removed, legal kept");
  }
  ok(vendorSearchTerms({ display_name: "A", dba: null, legal_name: null }).length === 0, "1-char names are not searched");
  ok(logoPlatformOrder("leaflink").join() === "leaflink,growflow,cultivera", "remembered platform first");
  ok(logoPlatformOrder(null).join() === "growflow,cultivera,leaflink", "default order");
  ok(logoPlatformOrder("email").join() === "growflow,cultivera,leaflink", "unknown memory ignored");

  // --- matching -------------------------------------------------------------
  const V = (id: string, name: string, extra: Partial<CoverageVendor> = {}): CoverageVendor => ({
    id, display_name: name, slug: id, dba: null, legal_name: null, license_number: null, email: null, phone: null,
    website: null, is_active: true, total_accepted_ytd_cents: null, last_accepted_at: null, ...extra,
  });
  const vendors = [
    V("v1", "Fairwinds", { license_number: "412345" }),
    V("v2", "Ceres"),
    V("v3", "Twin Farms"),
    V("v4", "Twin Farms LLC", { dba: "Twin Farms" }),
    V("v5", "Phat Panda"),
  ];
  const match = buildLogoMatcher(vendors, [{ vendor_id: "v2", source_name: "Ceres Garden" }], [{ vendor_id: "v5", display_name: "Hot Sugar" }]);
  const G = (name: string, extra: Partial<LogoCandidate> = {}): LogoCandidate => ({
    platform: "growflow", ref: "1", name, altName: null, license: null, logoUrl: "https://c/l.png", logoProblem: null, ...extra,
  });
  ok(judgeCandidate(G("Anything", { license: "412345" }), "v1", match) === "match", "license match");
  ok(judgeCandidate(G("Fairwinds Manufacturing", { license: "412345" }), "v2", match) === "other_vendor", "license belongs to another vendor");
  ok(judgeCandidate(G("Ceres Garden"), "v2", match) === "match", "alias match");
  ok(judgeCandidate(G("Hot Sugar"), "v5", match) === "match", "brand-name match");
  ok(judgeCandidate(G("Twin Farms"), "v3", match) === "ambiguous", "name shared by two vendors is ambiguous (refused)");
  ok(judgeCandidate(G("Nobody"), "v2", match) === "no_match", "no match");
  ok(judgeCandidate({ ...G("x"), platform: "leaflink", name: "Other", altName: "Ceres" }, "v2", match) === "match", "leaflink company name as alt label");

  {
    const pick = pickLogoCandidate(
      [
        G("Nobody", { ref: "a" }),
        G("Ceres", { ref: "b", logoUrl: null }),
        G("Ceres", { ref: "c", logoUrl: null, logoProblem: "relative" }),
        { ...G("Ceres"), platform: "leaflink", ref: "d", logoUrl: null },
        G("Ceres", { ref: "e" }),
        G("Ceres", { ref: "f" }),
        G("Twin Farms", { ref: "g" }),
      ],
      "v2",
      match,
    );
    ok(pick.pick?.ref === "e", "first matching candidate with a logo wins (not the later one)");
    ok(pick.noLogo.length === 1 && pick.noLogo[0].ref === "b", "matched without logo is recorded");
    ok(pick.refused.length === 1 && pick.refused[0].problem === "relative", "refused logo recorded with reason");
    ok(pick.needsHeader.length === 1 && pick.needsHeader[0].ref === "d", "leaflink match queued for a header read");
    ok(pick.ambiguous === 1, "ambiguous candidates counted");
  }
  ok(pickLogoCandidate([], "v2", match).pick === null, "empty list → no pick");

  // --- write plan -----------------------------------------------------------
  const B = (id: string, extra: Partial<LogoBrand> = {}): LogoBrand => ({
    id, display_name: id.toUpperCase(), vendor_id: "v1", status: "published", logo_media_id: null, ...extra,
  });
  {
    const p = planLogoWrite({ status: "draft", logo_media_id: null }, [B("b1"), B("b2", { status: "draft" })], "NEW", false);
    ok(p.kind === "apply", "no logo → apply");
    if (p.kind === "apply") {
      ok(p.vendorUpdate.logo_media_id === "NEW" && p.vendorUpdate.status === "published", "draft vendor published with logo");
      ok(p.publishedVendor && p.replacedLogoId === null, "flags: published, nothing replaced");
      ok(p.brands.every((b) => b.setLogo), "every brand without a logo gets it");
      ok(p.brands.find((b) => b.brandId === "b2")?.publish === true && p.brands.find((b) => b.brandId === "b1")?.publish === false, "only the draft brand is published");
    }
  }
  {
    const p = planLogoWrite({ status: "published", logo_media_id: null }, [], "NEW", false);
    ok(p.kind === "apply" && p.vendorUpdate.status === undefined && !p.publishedVendor, "published vendor: status untouched");
  }
  ok(planLogoWrite({ status: "published", logo_media_id: "OLD" }, [], "NEW", false).kind === "skip", "existing logo kept without replace");
  {
    const p = planLogoWrite({ status: "published", logo_media_id: "OLD" }, [], "NEW", false);
    ok(p.kind === "skip" && p.reason === "has_logo", "skip reason has_logo");
  }
  {
    const p = planLogoWrite(
      { status: "published", logo_media_id: "OLD" },
      [B("inh", { logo_media_id: "OLD" }), B("own", { logo_media_id: "CURATED" }), B("none"), B("arch", { status: "archived" })],
      "NEW",
      true,
    );
    ok(p.kind === "apply", "replace → apply");
    if (p.kind === "apply") {
      ok(p.replacedLogoId === "OLD", "replaced id recorded");
      ok(p.brands.find((b) => b.brandId === "inh")?.setLogo === true, "brand that inherited the old vendor logo follows the new one");
      const own = p.brands.find((b) => b.brandId === "own");
      ok(own?.setLogo === false && own?.keptOwnLogo === true, "brand with its own curated logo keeps it");
      ok(p.brands.find((b) => b.brandId === "none")?.setLogo === true, "brand without logo gets it");
      const arch = p.brands.find((b) => b.brandId === "arch");
      ok(arch?.archived === true && arch?.setLogo === false && arch?.publish === false, "archived brand never touched");
    }
  }
  {
    const p = planLogoWrite({ status: "archived", logo_media_id: null }, [B("b1")], "NEW", true);
    ok(p.kind === "skip" && p.reason === "archived", "archived vendor never resurrected");
  }
  {
    const p = planLogoWrite({ status: "published", logo_media_id: "SAME" }, [B("b1", { logo_media_id: "SAME" })], "SAME", false);
    ok(p.kind === "skip" && p.reason === "same_logo", "same bytes, everything in place → same_logo");
  }
  {
    const p = planLogoWrite({ status: "published", logo_media_id: "SAME" }, [B("b1")], "SAME", false);
    ok(p.kind === "apply", "same logo but a brand is missing it → still applies (fills brands)");
    if (p.kind === "apply") ok(p.brands[0].setLogo && p.replacedLogoId === null, "fills brand, replaces nothing");
  }
  {
    const p = planLogoWrite({ status: "draft", logo_media_id: "SAME" }, [], "SAME", false);
    ok(p.kind === "apply" && p.publishedVendor, "same logo on a draft vendor → publishes the vendor");
  }
  {
    const p = planLogoWrite({ status: "published", logo_media_id: null }, [B("b1", { logo_media_id: "NEW" })], "NEW", false);
    ok(p.kind === "apply" && p.kind === "apply" && p.brands[0].setLogo === false && p.brands[0].keptOwnLogo === false, "brand already on the new logo: no rewrite, not 'kept own'");
  }

  // --- messages -------------------------------------------------------------
  const R = (extra: Partial<LogoResult>): LogoResult => ({
    vendorId: "v1", vendorName: "Fairwinds", outcome: "attached", platform: "growflow", logoUrl: "https://c/l.png",
    mediaAssetId: "m1", brandsUpdated: 0, brandsKept: 0, brandsArchived: 0, publishedVendor: false, notes: [], ...extra,
  });
  ok(logoResultMessage(R({})).startsWith("Logo from GrowFlow attached to Fairwinds and published"), "attached message");
  ok(logoResultMessage(R({ brandsUpdated: 2 })).includes("Also attached to 2 brands."), "brand count plural");
  ok(logoResultMessage(R({ brandsUpdated: 1 })).includes("Also attached to 1 brand."), "brand count singular");
  ok(logoResultMessage(R({ brandsKept: 1 })).includes("kept its own logo"), "kept-own singular");
  ok(logoResultMessage(R({ publishedVendor: true })).includes("now published"), "published-vendor note");
  ok(logoResultMessage(R({ outcome: "already_has_logo" })).includes("Replace logo"), "has-logo message points to Replace");
  ok(logoResultMessage(R({ outcome: "not_found", platform: null, notes: ["LeafLink: not configured."] })).endsWith("LeafLink: not configured."), "notes appended");
  ok(isGoodOutcome("attached") && isGoodOutcome("same_logo") && !isGoodOutcome("not_found"), "isGoodOutcome");

  // --- bulk queue -----------------------------------------------------------
  {
    const LV = (id: string, name: string, extra: Partial<LogoVendor> = {}): LogoVendor => ({ ...V(id, name), status: "published", logo_media_id: null, ...extra });
    const list = [
      LV("a", "Alpha"),
      LV("b", "Bravo"),
      LV("c", "Charlie", { logo_media_id: "x" }),
      LV("d", "Delta", { status: "archived" }),
      LV("e", "Echo", { is_active: false }),
      LV("f", "Foxtrot"),
      LV("g", "Golf"),
    ];
    const stock = new Map([
      ["a", { lotsInStock: 0, lotsTotal: 3, lastReceived: "2026-10-01" }],
      ["b", { lotsInStock: 2, lotsTotal: 2, lastReceived: "2026-09-01" }],
      ["c", { lotsInStock: 5, lotsTotal: 5, lastReceived: "2026-11-01" }],
      ["d", { lotsInStock: 5, lotsTotal: 5, lastReceived: "2026-11-01" }],
      ["e", { lotsInStock: 5, lotsTotal: 5, lastReceived: "2026-11-01" }],
      ["f", { lotsInStock: 0, lotsTotal: 1, lastReceived: "2026-11-02" }],
    ]);
    const q = missingLogoQueue(list, stock, 10);
    ok(q.map((v) => v.id).join() === "b,f,a", "queue: on-shelf first, then newest received; logo/archived/inactive/never-carried excluded");
    ok(missingLogoQueue(list, stock, 2).length === 2, "queue capped");
    ok(missingLogoQueue(list, stock, -1).length === 0, "negative cap → empty");
  }

  return { passed, failed };
}
