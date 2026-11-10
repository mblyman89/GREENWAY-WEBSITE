/**
 * src/lib/purchasing/vendor-logo-store.ts
 *
 * D212 — "Fetch logo" for the Vendor Menus page. The owner's words:
 *   "I want the fetch button to find and automatically attach the photo to the
 *    vendor profile and publish it so it shows up on the customer facing
 *    website … It should attach to both the vendor and brands."
 *
 * One call does the WHOLE pipeline (D212a): find the vendor's profile on
 * GrowFlow / Cultivera / LeafLink → download the logo into the Media Library →
 * publish the asset → set vendors.logo_media_id → set every brand's logo →
 * publish a draft vendor / draft brands → record media usages → remember the
 * platform. The action layer then audits and revalidates the public pages.
 *
 * Every decision (which profile is this vendor, which URL is usable, what to
 * write) lives in the pure vendor-logo-core.ts; this file only reads, calls
 * the marketplace workers, and writes.
 *
 * Rule 15 — every Supabase call reads its `{ error }`; a failed write stops the
 * pipeline and is reported as outcome "error" with the reason.
 * Rule 18 — named columns only; whole-table reads are paged (`pagedAll`).
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pagedAll, ADMIN_PAGED_CONCURRENCY } from "@/lib/supabase/chunked-in";
import { dbErrorForStaff } from "@/lib/db/rpc-fallback-core";
import { importImageFromUrl, HarvestImageError } from "@/lib/media/harvest";
import { recordUsage } from "@/lib/media/store";
import { searchGrowflowStores } from "@/lib/purchasing/growflow-client";
import { searchCultiveraMarkets } from "@/lib/purchasing/cultivera-client";
import { searchLeaflinkBrands, fetchLeaflinkMenu } from "@/lib/purchasing/leaflink-client";
import { rememberPlatform } from "@/lib/purchasing/vendor-platform-store";
import { normalizeVendorKey } from "@/lib/purchasing/unified-search-core";
import {
  buildSurvivorResolver,
  mergedIntoFromNotes,
  rollupLots,
  type CoverageAlias,
  type CoverageBrand,
  type CoverageLot,
  type VendorMatcher,
} from "@/lib/purchasing/vendor-menu-coverage-core";
import {
  buildLogoMatcher,
  buildSameBusiness,
  candidateMentions,
  cultiveraLogoCandidate,
  growflowLogoCandidate,
  judgeCandidate,
  knownProfilesFor,
  knownRefKeys,
  leaflinkHeaderLogo,
  leaflinkSearchCandidate,
  logoPlatformLabel,
  logoPlatformOrderFor,
  logoSearchTerms,
  logoSnapshotsFromRows,
  missingLogoQueue,
  pickLogoCandidate,
  planLogoWrite,
  type LogoBrand,
  type LogoSnapshot,
  type LogoSnapshotRows,
  type LogoCandidate,
  type LogoPlatform,
  type LogoResult,
  type LogoVendor,
} from "@/lib/purchasing/vendor-logo-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
type DbErr = { code?: string | null; message?: string | null } | null;

const VENDOR_COLS =
  "id, display_name, slug, dba, legal_name, license_number, email, phone, website, is_active, total_accepted_ytd_cents, last_accepted_at, status, logo_media_id, internal_notes";
const BRAND_COLS = "id, display_name, vendor_id, status, logo_media_id";

/** Worker search timeout per call — short, so one slow platform can't eat the click. */
const SEARCH_TIMEOUT_MS = 45_000;
/**
 * D222: GrowFlow / LeafLink hand back their WHOLE list in one call (read once
 * per click, then judged locally). The first call of a click may include a
 * fresh marketplace login on the worker (~20 s live), so it gets longer.
 */
const LIST_TIMEOUT_MS = 90_000;
const HEADER_TIMEOUT_MS = 60_000;

/** Bulk: vendors per click, and the wall-clock budget before we stop starting new ones. */
export const BULK_LOGO_CAP = 5;
const BULK_BUDGET_MS = 170_000;
/** One vendor: stop starting new searches after this (the page allows 300 s). */
const SINGLE_BUDGET_MS = 170_000;

/** Platforms whose worker search returns the full list for an empty query (D222). */
const FULL_LIST: ReadonlySet<LogoPlatform> = new Set<LogoPlatform>(["growflow", "leaflink"]);

export type LogoActor = { id: string | null; email: string | null };

class LogoStoreError extends Error {}

async function readAll<Row>(
  what: string,
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: DbErr }>,
): Promise<Row[]> {
  return pagedAll<Row>(
    async (from, to) => {
      const { data, error } = await page(from, to);
      if (error) throw new LogoStoreError(`${what}: ${dbErrorForStaff(error, "the read failed")}`);
      return (data as Row[] | null) ?? [];
    },
    { concurrency: ADMIN_PAGED_CONCURRENCY },
  );
}

type SearchOutcome = { candidates: LogoCandidate[]; note: string | null; failed: boolean };

type MatchContext = {
  vendors: LogoVendor[];
  aliases: CoverageAlias[];
  brands: (CoverageBrand & LogoBrand)[];
  /** D222: built ONCE, exactly like the Vendor Menus page (survivors + carried). */
  match: VendorMatcher;
  sameBusiness: (a: string, b: string) => boolean;
  /** D222: saved menu pulls + platform memory (exact profile ids). */
  snapshots: LogoSnapshot[];
  /** Non-fatal read problems, reported once on the first result. */
  warnings: string[];
  /** Per-click cache of marketplace answers: `platform|term`. */
  searches: Map<string, Promise<SearchOutcome>>;
  /** Survivor-resolved lots per vendor (the bulk queue's priority). */
  stock: ReturnType<typeof rollupLots>;
};

type VendorRow = LogoVendor & { internal_notes: string | null };

async function loadMatchContext(admin: Admin): Promise<MatchContext> {
  const warnings: string[] = [];
  const optional = async <Row>(what: string, read: () => Promise<Row[]>): Promise<Row[]> => {
    try {
      return await read();
    } catch (e) {
      warnings.push(`${e instanceof Error ? e.message : what} — searched by name only.`);
      return [];
    }
  };
  const [vendorRows, aliases, brands, lots, gf, cv, ll, memories] = await Promise.all([
    readAll<VendorRow>("Vendors", (f, t) =>
      admin.from("vendors").select(VENDOR_COLS).order("id", { ascending: true }).range(f, t)),
    readAll<CoverageAlias>("Vendor aliases", (f, t) =>
      admin.from("vendor_aliases").select("id, vendor_id, source_name, source_system").order("id", { ascending: true }).range(f, t)),
    readAll<CoverageBrand & LogoBrand>("Brands", (f, t) =>
      admin.from("brands").select(BRAND_COLS).order("id", { ascending: true }).range(f, t)),
    readAll<CoverageLot>("Inventory lots", (f, t) =>
      admin.from("inventory_lots")
        .select("id, vendor_id, on_hand_qty, status, received_on, created_at, category")
        .not("vendor_id", "is", null).order("id", { ascending: true }).range(f, t)),
    optional<LogoSnapshotRows["growflow"][number]>("GrowFlow menus", () =>
      readAll("GrowFlow menus", (f, t) =>
        admin.from("growflow_menu_snapshots")
          .select("id, vendor_id, store_name, license_number, growflow_store_id")
          .order("fetched_at", { ascending: false }).order("id", { ascending: true }).range(f, t))),
    optional<LogoSnapshotRows["cultivera"][number]>("Cultivera menus", () =>
      readAll("Cultivera menus", (f, t) =>
        admin.from("cultivera_menu_snapshots")
          .select("id, vendor_id, seller_name, cultivera_market_id, cultivera_market_slug")
          .order("fetched_at", { ascending: false }).order("id", { ascending: true }).range(f, t))),
    optional<LogoSnapshotRows["leaflink"][number]>("LeafLink menus", () =>
      readAll("LeafLink menus", (f, t) =>
        admin.from("leaflink_menu_snapshots")
          .select("id, vendor_id, brand_name, company_name, leaflink_brand_id")
          .order("fetched_at", { ascending: false }).order("id", { ascending: true }).range(f, t))),
    optional<LogoSnapshotRows["memories"][number]>("Platform memory", () =>
      readAll("Platform memory", (f, t) =>
        admin.from("vendor_platform_map")
          .select("id, vendor_name, license_number, platform, platform_ref, platform_slug")
          .order("last_seen_at", { ascending: false }).order("id", { ascending: true }).range(f, t))),
  ]);
  // D213/D222 — same as the coverage page: merged (archived) cards resolve to
  // their survivor, and duplicate-card ties go to the card we receive from.
  const vendors: LogoVendor[] = vendorRows.map(({ internal_notes, ...v }) => ({
    ...v,
    merged_into_id: (v.status ?? "").toLowerCase() === "archived" ? mergedIntoFromNotes(internal_notes) : null,
  }));
  const stock = rollupLots(lots, buildSurvivorResolver(vendors));
  const carried = new Set([...stock.entries()].filter(([, l]) => l.lotsTotal > 0).map(([id]) => id));
  return {
    vendors,
    aliases,
    brands,
    match: buildLogoMatcher(vendors, aliases, brands, { carried }),
    sameBusiness: buildSameBusiness(vendors),
    snapshots: logoSnapshotsFromRows({ growflow: gf, cultivera: cv, leaflink: ll, memories }),
    warnings,
    searches: new Map(),
    stock,
  };
}

function emptyResult(v: Pick<LogoVendor, "id" | "display_name">): LogoResult {
  return {
    vendorId: v.id,
    vendorName: v.display_name,
    outcome: "not_found",
    platform: null,
    logoUrl: null,
    mediaAssetId: null,
    brandsUpdated: 0,
    brandsKept: 0,
    brandsArchived: 0,
    publishedVendor: false,
    notes: [],
  };
}

/** Search one platform with one term (cached per click) and read logo candidates. */
function searchPlatform(ctx: MatchContext, platform: LogoPlatform, term: string): Promise<SearchOutcome> {
  const key = `${platform}|${term.toLowerCase()}`;
  const hit = ctx.searches.get(key);
  if (hit) return hit;
  const run = (async (): Promise<SearchOutcome> => {
    const timeout = term ? SEARCH_TIMEOUT_MS : LIST_TIMEOUT_MS;
    const res =
      platform === "growflow"
        ? await searchGrowflowStores(term, timeout)
        : platform === "cultivera"
          ? await searchCultiveraMarkets(term, timeout)
          : await searchLeaflinkBrands(term, timeout);
    if (!res.configured) {
      return { candidates: [], failed: true, note: `${logoPlatformLabel(platform)} isn't connected, so it wasn't searched.` };
    }
    if (!res.ok) {
      return { candidates: [], failed: true, note: `${logoPlatformLabel(platform)} search failed${res.error ? `: ${res.error}` : ""}.` };
    }
    const read =
      platform === "growflow" ? growflowLogoCandidate : platform === "cultivera" ? cultiveraLogoCandidate : leaflinkSearchCandidate;
    return { candidates: res.records.map((r) => read(r)), note: null, failed: false };
  })();
  ctx.searches.set(key, run);
  return run;
}

type Accept = (c: LogoCandidate) => Promise<{ ok: true } | { ok: false; problem: string }>;

/**
 * Find a usable logo for this vendor and hand each matching candidate to
 * `accept` (the download) until one sticks. D222 changes:
 *   - platforms where the vendor already has a saved menu go first, and that
 *     exact profile (by id) is accepted even if its name is spelled
 *     differently from ours;
 *   - GrowFlow / LeafLink are read as ONE full list per click and judged
 *     locally (their search is a plain "contains" filter, so a long legal
 *     name never found a short store name);
 *   - more search terms (known marketplace names, aliases, brands, the name
 *     without LLC / Inc);
 *   - a logo that won't download no longer ends the search — the next
 *     platform is tried.
 */
async function findLogo(
  vendor: LogoVendor,
  ctx: MatchContext,
  deadline: number,
  accept: Accept,
): Promise<{ found: LogoCandidate | null; notes: string[]; sawRefused: boolean }> {
  const known = knownProfilesFor(vendor.id, ctx.snapshots, ctx.match);
  const knownRefs = knownRefKeys(known);
  const order = logoPlatformOrderFor(known, null);
  const terms = logoSearchTerms(vendor, {
    knownNames: known.map((k) => k.name),
    aliases: ctx.aliases,
    brands: ctx.brands,
  });
  const judge = { knownRefs, sameBusiness: ctx.sameBusiness };
  const notes: string[] = [];
  let sawRefused = false;
  let ambiguous = 0;
  let outOfTime = false;

  const tryCandidate = async (c: LogoCandidate): Promise<boolean> => {
    const r = await accept(c);
    if (r.ok) return true;
    sawRefused = true;
    notes.push(`${logoPlatformLabel(c.platform)} logo for "${c.name}": ${r.problem}`);
    return false;
  };

  for (const platform of order) {
    if (outOfTime) break;
    const platformTerms = FULL_LIST.has(platform) ? [""] : terms;
    let matchedHere = false;
    for (const term of platformTerms) {
      if (Date.now() > deadline) {
        outOfTime = true;
        break;
      }
      const res = await searchPlatform(ctx, platform, term);
      if (res.failed) {
        if (res.note && !notes.includes(res.note)) notes.push(res.note);
        break; // not connected / failed: don't retry with every term
      }
      const pool = FULL_LIST.has(platform)
        ? res.candidates.filter((c) => candidateMentions(c, terms, vendor.license_number, knownRefs))
        : res.candidates;
      const pick = pickLogoCandidate(pool, vendor.id, ctx.match, judge);
      ambiguous += pick.ambiguous;
      const withLogo = pool.filter((c) => c.logoUrl && judgeCandidate(c, vendor.id, ctx.match, judge) === "match");
      // known profile first (pickLogoCandidate ordered it), then the others
      const ordered = pick.pick ? [pick.pick, ...withLogo.filter((c) => c !== pick.pick)] : withLogo;
      for (const c of ordered) {
        matchedHere = true;
        if (await tryCandidate(c)) return { found: c, notes, sawRefused };
      }
      for (const c of pick.needsHeader) {
        matchedHere = true;
        const header = await fetchLeaflinkMenu({ brandId: c.ref ?? "" }, HEADER_TIMEOUT_MS);
        if (!header.ok) {
          notes.push(`LeafLink profile "${c.name}" was found but couldn't be opened${header.error ? `: ${header.error}` : ""}.`);
          continue;
        }
        const cleaned = leaflinkHeaderLogo(header.raw);
        if (cleaned.url) {
          const withUrl = { ...c, logoUrl: cleaned.url, logoProblem: null };
          if (await tryCandidate(withUrl)) return { found: withUrl, notes, sawRefused };
        } else if (cleaned.problem) {
          sawRefused = true;
          notes.push(`LeafLink profile "${c.name}": ${cleaned.problem}`);
        } else {
          notes.push(`LeafLink profile "${c.name}" has no logo.`);
        }
      }
      for (const r of pick.refused) {
        matchedHere = true;
        sawRefused = true;
        notes.push(`${logoPlatformLabel(r.candidate.platform)} profile "${r.candidate.name}": ${r.problem}`);
      }
      for (const c of pick.noLogo) {
        matchedHere = true;
        notes.push(`${logoPlatformLabel(c.platform)} profile "${c.name}" has no logo.`);
      }
      // A matching profile was found on this platform: other terms would only find it again.
      if (matchedHere) break;
    }
  }
  if (outOfTime) notes.push("Stopped searching to stay inside the time limit — click again to finish the search.");
  if (ambiguous) {
    notes.push(
      `${ambiguous} marketplace profile${ambiguous === 1 ? "" : "s"} matched more than one of our vendors, so ${ambiguous === 1 ? "it was" : "they were"} skipped rather than guessed. Use "Link to vendor" on the menu row to settle it.`,
    );
  }
  return { found: null, notes, sawRefused };
}

async function checked(what: string, p: PromiseLike<{ error: DbErr }>): Promise<void> {
  const { error } = await p;
  if (error) throw new LogoStoreError(`${what}: ${dbErrorForStaff(error, "the write failed")}`);
}

/**
 * D212a — fetch ONE vendor's logo and attach + publish it everywhere.
 * `replace` is the owner's explicit "Replace logo" click (D212d).
 */
export async function fetchVendorLogo(input: {
  vendorId: string;
  replace: boolean;
  actor: LogoActor;
  ctx?: MatchContext;
  /** Epoch ms after which no new marketplace search is started. */
  deadline?: number;
}): Promise<LogoResult> {
  const deadline = input.deadline ?? Date.now() + SINGLE_BUDGET_MS;
  const fallback = emptyResult({ id: input.vendorId, display_name: "This vendor" });
  if (!isSupabaseServiceConfigured) {
    return { ...fallback, outcome: "error", notes: ["The database isn't configured on this deployment."] };
  }
  const admin = createSupabaseAdminClient();
  let result = fallback;
  try {
    const ctx = input.ctx ?? (await loadMatchContext(admin));
    const vendor = ctx.vendors.find((v) => v.id === input.vendorId);
    if (!vendor) return { ...fallback, outcome: "error", notes: ["That vendor no longer exists."] };
    result = emptyResult(vendor);

    if ((vendor.status ?? "").toLowerCase() === "archived") return { ...result, outcome: "archived" };
    if (vendor.logo_media_id && !input.replace) return { ...result, outcome: "already_has_logo" };

    if (ctx.warnings.length && !input.ctx) result.notes.push(...ctx.warnings);

    // 1) Find the profile and download its logo into the Media Library
    //    (sha256-deduped). A logo that won't download moves on to the next
    //    matching profile instead of ending the search (D222).
    let assetId = "";
    const accept: Accept = async (c) => {
      try {
        const { asset } = await importImageFromUrl({
          imageUrl: c.logoUrl ?? "",
          usageType: "vendor-logo",
          title: `${vendor.display_name} logo`,
          altText: `${vendor.display_name} logo`,
          uploadedBy: input.actor.id,
          tags: ["vendor-logo", c.platform],
          // D221 M3: the vendor is known; record it on the library row.
          provenance: { platform: c.platform, vendorId: vendor.id, role: "logo", creditText: vendor.display_name },
        });
        assetId = asset.id;
        return { ok: true };
      } catch (e) {
        return { ok: false, problem: e instanceof HarvestImageError ? e.message : "The image couldn't be saved." };
      }
    };
    const { found, notes, sawRefused } = await findLogo(vendor, ctx, deadline, accept);
    result.notes.push(...notes);
    if (!found || !found.logoUrl || !assetId) return { ...result, outcome: sawRefused ? "refused" : "not_found" };
    result.platform = found.platform;
    result.logoUrl = found.logoUrl;
    result.mediaAssetId = assetId;

    // 2) Publish the asset with provenance (D212f). RLS only serves published media.
    await checked(
      "Publishing the logo",
      admin
        .from("media_assets")
        .update({
          status: "published",
          license_status: "vendor-provided",
          source: `${found.platform}:${found.logoUrl}`.slice(0, 500),
        })
        .eq("id", assetId),
    );

    // 3) Plan + write vendor and brands (D212c/d).
    const vendorBrands = ctx.brands.filter((b) => b.vendor_id === vendor.id);
    const plan = planLogoWrite(vendor, vendorBrands, assetId, input.replace);
    if (plan.kind === "skip") {
      const outcome = plan.reason === "has_logo" ? "already_has_logo" : plan.reason;
      return { ...result, outcome };
    }
    await checked("Attaching the logo to the vendor", admin.from("vendors").update(plan.vendorUpdate).eq("id", vendor.id));
    vendor.logo_media_id = assetId;
    if (plan.vendorUpdate.status) vendor.status = plan.vendorUpdate.status;
    result.publishedVendor = plan.publishedVendor;
    await recordUsage(assetId, "vendor", vendor.id, "logo");

    for (const b of plan.brands) {
      if (b.archived) {
        result.brandsArchived += 1;
        continue;
      }
      if (b.keptOwnLogo) result.brandsKept += 1;
      const patch: { logo_media_id?: string; status?: "published" } = {};
      if (b.setLogo) patch.logo_media_id = assetId;
      if (b.publish) patch.status = "published";
      if (Object.keys(patch).length === 0) continue;
      await checked(`Updating brand "${b.name}"`, admin.from("brands").update(patch).eq("id", b.brandId));
      if (b.setLogo) {
        result.brandsUpdated += 1;
        await recordUsage(assetId, "brand", b.brandId, "logo");
      }
    }

    // 4) Remember where this vendor lives (best effort; never blocks the attach).
    await rememberPlatform({
      vendor_key: normalizeVendorKey(vendor.display_name),
      vendor_name: vendor.display_name,
      license_number: vendor.license_number,
      platform: found.platform,
      platform_ref: found.ref,
      platform_slug: null,
      last_seen_at: new Date().toISOString(),
    });

    return { ...result, outcome: "attached" };
  } catch (e) {
    const why = e instanceof LogoStoreError ? e.message : e instanceof Error ? e.message : "Unknown error.";
    return { ...result, outcome: "error", notes: [...result.notes, why] };
  }
}

export type BulkLogoReport = {
  results: LogoResult[];
  /** Vendors missing a logo that this click did not get to (beyond the cap/budget/skip list). */
  remaining: number;
  stoppedForTime: boolean;
  error: string | null;
};

/** D212e — "Fetch all missing logos": the most urgent vendors first, capped per click. */
export async function fetchMissingLogos(
  actor: LogoActor,
  opts: { cap?: number; skipIds?: readonly string[] } = {},
): Promise<BulkLogoReport> {
  const cap = opts.cap ?? BULK_LOGO_CAP;
  const skip = new Set(opts.skipIds ?? []);
  if (!isSupabaseServiceConfigured) {
    return { results: [], remaining: 0, stoppedForTime: false, error: "The database isn't configured on this deployment." };
  }
  const admin = createSupabaseAdminClient();
  const started = Date.now();
  try {
    const ctx = await loadMatchContext(admin);
    // D222: the same survivor-resolved stock the page uses (one read).
    const stock = ctx.stock;
    // Vendors already tried in this session (not found / refused) are skipped so
    // the next click moves on instead of retrying the same ones.
    const all = missingLogoQueue(ctx.vendors, stock, Number.MAX_SAFE_INTEGER).filter((v) => !skip.has(v.id));
    const queue = all.slice(0, Math.max(0, cap));
    const results: LogoResult[] = [];
    let stoppedForTime = false;
    const warnings = ctx.warnings;
    for (const v of queue) {
      if (Date.now() - started > BULK_BUDGET_MS) {
        stoppedForTime = true;
        break;
      }
      results.push(
        await fetchVendorLogo({ vendorId: v.id, replace: false, actor, ctx, deadline: started + BULK_BUDGET_MS }),
      );
    }
    if (warnings.length && results[0]) results[0].notes.push(...warnings);
    return { results, remaining: all.length - results.length, stoppedForTime, error: null };
  } catch (e) {
    const why = e instanceof Error ? e.message : "Unknown error.";
    return { results: [], remaining: 0, stoppedForTime: false, error: why };
  }
}
