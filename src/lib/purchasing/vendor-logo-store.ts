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
import { getMemoriesForVendor, rememberPlatform } from "@/lib/purchasing/vendor-platform-store";
import { normalizeVendorKey } from "@/lib/purchasing/unified-search-core";
import { rollupLots, type CoverageAlias, type CoverageBrand, type CoverageLot } from "@/lib/purchasing/vendor-menu-coverage-core";
import {
  buildLogoMatcher,
  cultiveraLogoCandidate,
  growflowLogoCandidate,
  leaflinkHeaderLogo,
  leaflinkSearchCandidate,
  logoPlatformLabel,
  logoPlatformOrder,
  missingLogoQueue,
  pickLogoCandidate,
  planLogoWrite,
  vendorSearchTerms,
  type LogoBrand,
  type LogoCandidate,
  type LogoPlatform,
  type LogoResult,
  type LogoVendor,
} from "@/lib/purchasing/vendor-logo-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
type DbErr = { code?: string | null; message?: string | null } | null;

const VENDOR_COLS =
  "id, display_name, slug, dba, legal_name, license_number, email, phone, website, is_active, total_accepted_ytd_cents, last_accepted_at, status, logo_media_id";
const BRAND_COLS = "id, display_name, vendor_id, status, logo_media_id";

/** Worker search timeout per call — short, so one slow platform can't eat the click. */
const SEARCH_TIMEOUT_MS = 45_000;
const HEADER_TIMEOUT_MS = 60_000;

/** Bulk: vendors per click, and the wall-clock budget before we stop starting new ones. */
export const BULK_LOGO_CAP = 5;
const BULK_BUDGET_MS = 170_000;
/** One vendor: stop starting new searches after this (the page allows 300 s). */
const SINGLE_BUDGET_MS = 170_000;

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

type MatchContext = {
  vendors: LogoVendor[];
  aliases: CoverageAlias[];
  brands: (CoverageBrand & LogoBrand)[];
};

async function loadMatchContext(admin: Admin): Promise<MatchContext> {
  const [vendors, aliases, brands] = await Promise.all([
    readAll<LogoVendor>("Vendors", (f, t) =>
      admin.from("vendors").select(VENDOR_COLS).order("id", { ascending: true }).range(f, t)),
    readAll<CoverageAlias>("Vendor aliases", (f, t) =>
      admin.from("vendor_aliases").select("id, vendor_id, source_name, source_system").order("id", { ascending: true }).range(f, t)),
    readAll<CoverageBrand & LogoBrand>("Brands", (f, t) =>
      admin.from("brands").select(BRAND_COLS).order("id", { ascending: true }).range(f, t)),
  ]);
  return { vendors, aliases, brands };
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

/** Search one platform with one term and turn its rows into logo candidates. */
async function searchPlatform(platform: LogoPlatform, term: string): Promise<{ candidates: LogoCandidate[]; note: string | null }> {
  const res =
    platform === "growflow"
      ? await searchGrowflowStores(term, SEARCH_TIMEOUT_MS)
      : platform === "cultivera"
        ? await searchCultiveraMarkets(term, SEARCH_TIMEOUT_MS)
        : await searchLeaflinkBrands(term, SEARCH_TIMEOUT_MS);
  if (!res.configured) return { candidates: [], note: `${logoPlatformLabel(platform)} isn't connected, so it wasn't searched.` };
  if (!res.ok) {
    return { candidates: [], note: `${logoPlatformLabel(platform)} search failed${res.error ? `: ${res.error}` : ""}.` };
  }
  const read =
    platform === "growflow" ? growflowLogoCandidate : platform === "cultivera" ? cultiveraLogoCandidate : leaflinkSearchCandidate;
  return { candidates: res.records.map((r) => read(r)), note: null };
}

/**
 * Find a usable logo URL for this vendor. Platforms in remembered order,
 * then each search term; stops at the first matching profile with a usable
 * logo. LeafLink search rows carry no logo, so a LeafLink match is followed
 * by ONE brand-header read (`brand.image`).
 */
async function findLogo(
  vendor: LogoVendor,
  ctx: MatchContext,
  deadline: number,
): Promise<{ found: LogoCandidate | null; notes: string[]; sawRefused: boolean }> {
  const match = buildLogoMatcher(ctx.vendors, ctx.aliases, ctx.brands);
  const memories = await getMemoriesForVendor(vendor.display_name);
  const order = logoPlatformOrder(memories[0]?.platform ?? null);
  const terms = vendorSearchTerms(vendor);
  const notes: string[] = [];
  let sawRefused = false;
  let ambiguous = 0;

  let outOfTime = false;
  for (const platform of order) {
    let skipPlatform = false;
    for (const term of terms) {
      if (skipPlatform) break;
      if (Date.now() > deadline) {
        outOfTime = true;
        break;
      }
      const { candidates, note } = await searchPlatform(platform, term);
      if (note) {
        notes.push(note);
        skipPlatform = true; // not connected / failed: don't retry with every term
        continue;
      }
      const pick = pickLogoCandidate(candidates, vendor.id, match);
      ambiguous += pick.ambiguous;
      if (pick.pick) return { found: pick.pick, notes, sawRefused };
      for (const c of pick.needsHeader) {
        const header = await fetchLeaflinkMenu({ brandId: c.ref ?? "" }, HEADER_TIMEOUT_MS);
        if (!header.ok) {
          notes.push(`LeafLink profile "${c.name}" was found but couldn't be opened${header.error ? `: ${header.error}` : ""}.`);
          continue;
        }
        const cleaned = leaflinkHeaderLogo(header.raw);
        if (cleaned.url) return { found: { ...c, logoUrl: cleaned.url, logoProblem: null }, notes, sawRefused };
        if (cleaned.problem) {
          sawRefused = true;
          notes.push(`LeafLink profile "${c.name}": ${cleaned.problem}`);
        } else {
          notes.push(`LeafLink profile "${c.name}" has no logo.`);
        }
      }
      for (const r of pick.refused) {
        sawRefused = true;
        notes.push(`${logoPlatformLabel(r.candidate.platform)} profile "${r.candidate.name}": ${r.problem}`);
      }
      for (const c of pick.noLogo) notes.push(`${logoPlatformLabel(c.platform)} profile "${c.name}" has no logo.`);
      // A matching profile was found on this platform (with or without a usable
      // logo): other search terms would only find the same profile.
      if (pick.refused.length || pick.noLogo.length || pick.needsHeader.length) skipPlatform = true;
    }
  }
  if (outOfTime) notes.push("Stopped searching to stay inside the time limit — click again to finish the search.");
  if (ambiguous) {
    notes.push(
      `${ambiguous} marketplace profile${ambiguous === 1 ? "" : "s"} matched more than one of our vendors, so ${ambiguous === 1 ? "it was" : "they were"} skipped rather than guessed.`,
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

    const { found, notes, sawRefused } = await findLogo(vendor, ctx, deadline);
    result.notes.push(...notes);
    if (!found || !found.logoUrl) return { ...result, outcome: sawRefused ? "refused" : "not_found" };
    result.platform = found.platform;
    result.logoUrl = found.logoUrl;

    // 1) Download into the Media Library (sha256-deduped).
    let assetId: string;
    try {
      const { asset } = await importImageFromUrl({
        imageUrl: found.logoUrl,
        usageType: "vendor-logo",
        title: `${vendor.display_name} logo`,
        altText: `${vendor.display_name} logo`,
        uploadedBy: input.actor.id,
        tags: ["vendor-logo", found.platform],
        // D221 M3: the vendor is known; record it on the library row.
        provenance: { platform: found.platform, vendorId: vendor.id, role: "logo", creditText: vendor.display_name },
      });
      assetId = asset.id;
    } catch (e) {
      const why = e instanceof HarvestImageError ? e.message : "The image couldn't be saved.";
      return { ...result, outcome: "refused", notes: [...result.notes, `${logoPlatformLabel(found.platform)} logo: ${why}`] };
    }
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
    const lots = await readAll<CoverageLot>("Inventory lots", (f, t) =>
      admin.from("inventory_lots")
        .select("id, vendor_id, on_hand_qty, status, received_on, created_at, category")
        .not("vendor_id", "is", null).order("id", { ascending: true }).range(f, t));
    const stock = rollupLots(lots);
    // Vendors already tried in this session (not found / refused) are skipped so
    // the next click moves on instead of retrying the same ones.
    const all = missingLogoQueue(ctx.vendors, stock, Number.MAX_SAFE_INTEGER).filter((v) => !skip.has(v.id));
    const queue = all.slice(0, Math.max(0, cap));
    const results: LogoResult[] = [];
    let stoppedForTime = false;
    for (const v of queue) {
      if (Date.now() - started > BULK_BUDGET_MS) {
        stoppedForTime = true;
        break;
      }
      results.push(
        await fetchVendorLogo({ vendorId: v.id, replace: false, actor, ctx, deadline: started + BULK_BUDGET_MS }),
      );
    }
    return { results, remaining: all.length - results.length, stoppedForTime, error: null };
  } catch (e) {
    const why = e instanceof Error ? e.message : "Unknown error.";
    return { results: [], remaining: 0, stoppedForTime: false, error: why };
  }
}
