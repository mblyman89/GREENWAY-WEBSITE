"use server";

/**
 * /admin/knowledge-base/campaigns — server actions (D220 S6).
 *
 * Start/stop durable crawl campaigns, run the Website Finder, approve/reject
 * website candidates, and confirm/reject image → product matches. Targets are
 * computed SERVER-SIDE (never trusted from the form). Every write is audited.
 */
import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  cancelCampaign,
  CrawlerNotConfiguredError,
  findVendorWebsites,
  isCrawlerConfigured,
  rematchCampaignSite,
  resumeCampaign,
  startCampaign,
} from "@/lib/ai/crawler-client";
import {
  candidatesForVendor,
  getCatalogImage,
  planCurrentVendorHarvest,
  setVendorWebsite,
  updateCatalogImage,
  updateWebsiteCandidates,
} from "@/lib/kb/crawl-campaigns";
import {
  buildCurrentVendorTargets,
  normalizeWebsite,
  planCandidateApproval,
  planImageDecision,
} from "@/lib/kb/crawl-campaigns-core";
import { listVendors } from "@/lib/vendors/store";
import { importImageFromUrl, HarvestImageError } from "@/lib/media/harvest";
import { attachKbProductImage } from "@/lib/ai/kb/store";
import { recordUsage } from "@/lib/media/store";

const BASE = "/admin/knowledge-base/campaigns";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function go(path: string, kind: "msg" | "error", text: string): never {
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${sep}${kind}=` + encodeURIComponent(text));
}

function back(formData: FormData, fallback: string): string {
  const b = String(formData.get("back") ?? "");
  return b.startsWith("/admin/knowledge-base/") ? b : fallback;
}

function crawlerError(err: unknown, what: string): string {
  return err instanceof CrawlerNotConfiguredError
    ? "Crawler isn't set up (CRAWLER_BASE_URL / CRAWLER_SHARED_SECRET)."
    : `Couldn't ${what}: ${err instanceof Error ? err.message : "please try again"}`;
}

/** Checkbox + hidden "false" fallback: any truthy value wins; absent → default. */
function bool(formData: FormData, key: string, dflt: boolean): boolean {
  const vals = formData.getAll(key).map(String);
  if (vals.length === 0) return dflt;
  return vals.some((v) => v === "on" || v === "true" || v === "1");
}

function int(formData: FormData, key: string, lo: number, hi: number): number | undefined {
  const n = Number.parseInt(String(formData.get(key) ?? ""), 10);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(lo, Math.min(hi, n));
}

/* ------------------------------------------------------------------ *
 * Campaigns
 * ------------------------------------------------------------------ */

/** The one button: crawl every stocked vendor that has a website, until each site is complete. */
export async function harvestAllCurrentVendorsAction(formData: FormData): Promise<void> {
  const session = await requirePermission("vendors.manage");
  if (!isCrawlerConfigured()) go(BASE, "error", "Crawler isn't set up (CRAWLER_BASE_URL / CRAWLER_SHARED_SECRET).");
  const plan = await planCurrentVendorHarvest();
  if (plan.targets.length === 0) {
    go(BASE, "error", `None of the ${plan.stockedVendors} stocked vendors has a website yet — run "Find websites" first.`);
  }
  const options = {
    write: true,
    feeds: true,
    vision: bool(formData, "vision", true),
    page_ai: bool(formData, "page_ai", true),
    parallel_sites: int(formData, "parallel_sites", 1, 8),
    max_pages_per_site: int(formData, "max_pages_per_site", 10, 10_000),
  };
  try {
    const camp = await startCampaign({
      label: `Harvest all current vendors · ${plan.targets.length} sites`,
      scope: "current_vendors",
      targets: plan.targets,
      options,
      createdBy: session.userId,
    });
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "kb.campaign_started",
      entityType: "kb_crawl_campaign",
      entityId: camp.id,
      after: {
        scope: "current_vendors",
        targets: plan.targets.length,
        needWebsite: plan.needWebsite.length,
        sharedHost: plan.sharedHost.length,
        options,
      },
    });
  } catch (err) {
    unstable_rethrow(err);
    go(BASE, "error", crawlerError(err, "start the campaign"));
  }
  revalidatePath(BASE);
  go(
    BASE,
    "msg",
    `Campaign started — ${plan.targets.length} vendor sites will be crawled until complete.` +
      (plan.needWebsite.length ? ` ${plan.needWebsite.length} stocked vendors have no website yet (use "Find websites").` : ""),
  );
}

/** Crawl hand-picked vendors (checkbox values are vendor ids; URLs come from the DB). */
export async function startCustomCampaignAction(formData: FormData): Promise<void> {
  const session = await requirePermission("vendors.manage");
  if (!isCrawlerConfigured()) go(BASE, "error", "Crawler isn't set up.");
  const ids = new Set(formData.getAll("vendor").map(String).filter((s) => UUID.test(s)));
  if (ids.size === 0) go(BASE, "error", "Pick at least one vendor.");
  const vendors = (await listVendors()).filter((v) => ids.has(v.id));
  const plan = buildCurrentVendorTargets(vendors, ids);
  if (plan.targets.length === 0) go(BASE, "error", "None of the picked vendors has a usable website.");
  try {
    const camp = await startCampaign({
      label: String(formData.get("label") ?? "").trim().slice(0, 120) || `Custom crawl · ${plan.targets.length} sites`,
      scope: plan.targets.length === 1 ? "single" : "custom",
      targets: plan.targets,
      options: {
        write: true,
        feeds: true,
        vision: bool(formData, "vision", true),
        page_ai: bool(formData, "page_ai", true),
        max_pages_per_site: int(formData, "max_pages_per_site", 10, 10_000),
      },
      createdBy: session.userId,
    });
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "kb.campaign_started",
      entityType: "kb_crawl_campaign",
      entityId: camp.id,
      after: { scope: "custom", targets: plan.targets.length },
    });
  } catch (err) {
    unstable_rethrow(err);
    go(BASE, "error", crawlerError(err, "start the campaign"));
  }
  revalidatePath(BASE);
  go(BASE, "msg", `Campaign started — ${plan.targets.length} site${plan.targets.length === 1 ? "" : "s"}.`);
}

export async function cancelCampaignAction(formData: FormData): Promise<void> {
  const session = await requirePermission("vendors.manage");
  const id = String(formData.get("campaignId") ?? "");
  if (!UUID.test(id)) go(BASE, "error", "Missing campaign id.");
  try {
    await cancelCampaign(id);
    await recordAudit({ actorId: session.userId, actorEmail: session.email, action: "kb.campaign_cancelled", entityType: "kb_crawl_campaign", entityId: id });
  } catch (err) {
    unstable_rethrow(err);
    go(BASE, "error", crawlerError(err, "cancel the campaign"));
  }
  revalidatePath(BASE);
  go(BASE, "msg", "Cancel requested — sites stop after their current page; progress is saved and can be resumed.");
}

export async function resumeCampaignAction(formData: FormData): Promise<void> {
  const session = await requirePermission("vendors.manage");
  const id = String(formData.get("campaignId") ?? "");
  if (!UUID.test(id)) go(BASE, "error", "Missing campaign id.");
  try {
    await resumeCampaign(id);
    await recordAudit({ actorId: session.userId, actorEmail: session.email, action: "kb.campaign_resumed", entityType: "kb_crawl_campaign", entityId: id });
  } catch (err) {
    unstable_rethrow(err);
    go(BASE, "error", crawlerError(err, "resume the campaign"));
  }
  revalidatePath(BASE);
  go(BASE, "msg", "Campaign resumed — every site continues from its saved frontier (no page is read twice).");
}

export async function rematchSiteAction(formData: FormData): Promise<void> {
  const session = await requirePermission("vendors.manage");
  const siteId = String(formData.get("siteId") ?? "");
  const dest = back(formData, BASE);
  if (!UUID.test(siteId)) go(dest, "error", "Missing site id.");
  let out: { products: number; imagesMatched: number } = { products: 0, imagesMatched: 0 };
  try {
    out = await rematchCampaignSite(siteId);
    await recordAudit({ actorId: session.userId, actorEmail: session.email, action: "kb.campaign_site_rematched", entityType: "kb_crawl_site", entityId: siteId, after: out });
  } catch (err) {
    unstable_rethrow(err);
    go(dest, "error", crawlerError(err, "re-match the images"));
  }
  revalidatePath(dest);
  go(dest, "msg", `Re-matched against ${out.products} product cards — ${out.imagesMatched} images now have a suggested or confirmed product.`);
}

/* ------------------------------------------------------------------ *
 * Website finder
 * ------------------------------------------------------------------ */

const WEBSITES = `${BASE}/websites`;

/** Search the web for every stocked vendor without a website (or the picked ones). */
export async function findWebsitesAction(formData: FormData): Promise<void> {
  const session = await requirePermission("vendors.manage");
  if (!isCrawlerConfigured()) go(WEBSITES, "error", "Crawler isn't set up.");
  const picked = new Set(formData.getAll("vendor").map(String).filter((s) => UUID.test(s)));
  let vendors;
  if (picked.size > 0) {
    const cards = (await listVendors()).filter((v) => picked.has(v.id));
    vendors = cards.map((v) => ({
      vendor_id: v.id,
      name: v.display_name,
      legal_name: v.legal_name ?? "",
      dba: v.dba ?? "",
      license_number: v.license_number ?? "",
      city: v.shipping_city ?? v.billing_city ?? "",
    }));
  } else {
    vendors = (await planCurrentVendorHarvest()).needWebsite;
  }
  if (vendors.length === 0) go(WEBSITES, "msg", "Every stocked vendor already has a website on file.");
  try {
    const job = await findVendorWebsites({ vendors: vendors.slice(0, 300), useAi: bool(formData, "use_ai", true) });
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "kb.website_finder_started",
      entityType: "website_finder_job",
      entityId: job.id,
      after: { vendors: vendors.length },
    });
  } catch (err) {
    unstable_rethrow(err);
    go(WEBSITES, "error", crawlerError(err, "start the website finder"));
  }
  revalidatePath(WEBSITES);
  go(WEBSITES, "msg", `Searching for ${Math.min(vendors.length, 300)} vendor websites — candidates appear below as they are verified (refresh in a minute).`);
}

export async function approveWebsiteAction(formData: FormData): Promise<void> {
  const session = await requirePermission("vendors.manage");
  const id = String(formData.get("candidateId") ?? "");
  const vendorId = String(formData.get("vendorId") ?? "");
  if (!UUID.test(id) || !UUID.test(vendorId)) go(WEBSITES, "error", "Missing candidate.");
  let website = "";
  try {
    const all = await candidatesForVendor(vendorId);
    const chosen = all.find((c) => c.id === id);
    if (!chosen) go(WEBSITES, "error", "Candidate not found.");
    const plan = planCandidateApproval(chosen!, all);
    if ("error" in plan) go(WEBSITES, "error", plan.error);
    const ok = plan as Exclude<typeof plan, { error: string }>;
    website = ok.website;
    const now = new Date().toISOString();
    const { before } = await setVendorWebsite(vendorId, ok.website);
    await updateWebsiteCandidates([ok.approveId], { status: "approved", reviewed_by: session.userId, reviewed_at: now });
    await updateWebsiteCandidates(ok.supersedeIds, { status: "superseded", reviewed_by: session.userId, reviewed_at: now });
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "vendor.website_approved",
      entityType: "vendor",
      entityId: vendorId,
      before: { website: before },
      after: { website: ok.website, candidateId: id, superseded: ok.supersedeIds.length },
    });
  } catch (err) {
    unstable_rethrow(err);
    go(WEBSITES, "error", `Couldn't approve: ${err instanceof Error ? err.message : "please try again"}`);
  }
  revalidatePath(WEBSITES);
  revalidatePath(BASE);
  go(WEBSITES, "msg", `Website saved: ${website}. The vendor is now included in "Harvest all current vendors".`);
}

export async function rejectWebsiteAction(formData: FormData): Promise<void> {
  const session = await requirePermission("vendors.manage");
  const id = String(formData.get("candidateId") ?? "");
  if (!UUID.test(id)) go(WEBSITES, "error", "Missing candidate.");
  try {
    await updateWebsiteCandidates([id], { status: "rejected", reviewed_by: session.userId, reviewed_at: new Date().toISOString() });
    await recordAudit({ actorId: session.userId, actorEmail: session.email, action: "vendor.website_rejected", entityType: "vendor_website_candidate", entityId: id });
  } catch (err) {
    unstable_rethrow(err);
    go(WEBSITES, "error", `Couldn't reject: ${err instanceof Error ? err.message : "please try again"}`);
  }
  revalidatePath(WEBSITES);
  go(WEBSITES, "msg", "Rejected — the finder will never suggest that site for this vendor again.");
}

/** Type a website by hand (when the finder came up empty). */
export async function setWebsiteManuallyAction(formData: FormData): Promise<void> {
  const session = await requirePermission("vendors.manage");
  const vendorId = String(formData.get("vendorId") ?? "");
  const website = normalizeWebsite(String(formData.get("website") ?? ""));
  if (!UUID.test(vendorId)) go(WEBSITES, "error", "Missing vendor.");
  if (!website) go(WEBSITES, "error", "That doesn't look like a website address.");
  try {
    const { before } = await setVendorWebsite(vendorId, website);
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "vendor.website_set",
      entityType: "vendor",
      entityId: vendorId,
      before: { website: before },
      after: { website, via: "website_finder_manual" },
    });
  } catch (err) {
    unstable_rethrow(err);
    go(WEBSITES, "error", `Couldn't save: ${err instanceof Error ? err.message : "please try again"}`);
  }
  revalidatePath(WEBSITES);
  go(WEBSITES, "msg", `Website saved: ${website}.`);
}

/* ------------------------------------------------------------------ *
 * Image catalog
 * ------------------------------------------------------------------ */

const IMAGES = `${BASE}/images`;

/**
 * Confirm an image ↔ product match. Downloads the image into the Media
 * Library (draft, pending license review, hash-deduped) and adds it to the
 * product card's gallery (primary only when the card has none). Never
 * publishes the product.
 */
export async function confirmImageMatchAction(formData: FormData): Promise<void> {
  const session = await requirePermission("media.manage");
  const imageId = String(formData.get("imageId") ?? "");
  const productIdRaw = String(formData.get("productId") ?? "").trim();
  const dest = back(formData, IMAGES);
  if (!UUID.test(imageId)) go(dest, "error", "Missing image.");
  if (productIdRaw && !UUID.test(productIdRaw)) go(dest, "error", "Pick a product from the list.");
  let note = "";
  try {
    const img = await getCatalogImage(imageId);
    if (!img) go(dest, "error", "Image not found.");
    const plan = planImageDecision(img!, "confirm", {
      productId: productIdRaw || null,
      actorId: session.userId,
      nowIso: new Date().toISOString(),
      force: bool(formData, "force", false),
    });
    if (plan.kind === "error") go(dest, "error", plan.error);
    if (plan.kind !== "confirm") go(dest, "error", "Unexpected decision.");
    const label = img!.product_name || img!.jsonld_name || img!.alt || "Product photo";
    let mediaId = img!.media_asset_id;
    if (!mediaId) {
      const { asset } = await importImageFromUrl({
        imageUrl: img!.image_url,
        usageType: "product",
        title: `${label} (vendor site)`.slice(0, 200),
        altText: (img!.alt || label).slice(0, 300),
        uploadedBy: session.userId,
        tags: ["crawl-campaign", img!.role, ...(img!.tags ?? []).slice(0, 8)].filter(Boolean),
      });
      mediaId = asset.id;
    }
    const attach = await attachKbProductImage(plan.productId, mediaId!, session.userId);
    if (!attach.ok) go(dest, "error", attach.error ?? "Couldn't attach the image to the product card.");
    await updateCatalogImage(imageId, { ...plan.patch, media_asset_id: mediaId });
    await recordUsage(mediaId!, "kb_product", plan.productId, "gallery");
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "kb.crawl_image_confirmed",
      entityType: "kb_crawl_image",
      entityId: imageId,
      after: { productId: plan.productId, mediaId, becamePrimary: attach.becamePrimary, alreadyPresent: attach.alreadyPresent },
    });
    note = attach.alreadyPresent
      ? "Confirmed — that image was already on the product card."
      : attach.becamePrimary
        ? "Confirmed — it is now the product card's main photo (draft, pending license review)."
        : "Confirmed — added to the product card's gallery (draft, pending license review).";
  } catch (err) {
    unstable_rethrow(err);
    const msg = err instanceof HarvestImageError ? err.message : err instanceof Error ? err.message : "please try again";
    go(dest, "error", `Couldn't confirm: ${msg}`);
  }
  revalidatePath(IMAGES);
  go(dest, "msg", note);
}

export async function rejectImageMatchAction(formData: FormData): Promise<void> {
  const session = await requirePermission("media.manage");
  const imageId = String(formData.get("imageId") ?? "");
  const dest = back(formData, IMAGES);
  if (!UUID.test(imageId)) go(dest, "error", "Missing image.");
  try {
    const img = await getCatalogImage(imageId);
    if (!img) go(dest, "error", "Image not found.");
    const plan = planImageDecision(img!, "reject", { actorId: session.userId, nowIso: new Date().toISOString() });
    if (plan.kind !== "reject") go(dest, "error", "Unexpected decision.");
    await updateCatalogImage(imageId, plan.patch);
    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "kb.crawl_image_rejected",
      entityType: "kb_crawl_image",
      entityId: imageId,
      before: { matched: img!.matched_kb_product_id },
    });
  } catch (err) {
    unstable_rethrow(err);
    go(dest, "error", `Couldn't reject: ${err instanceof Error ? err.message : "please try again"}`);
  }
  revalidatePath(IMAGES);
  go(dest, "msg", "Rejected — re-matching will never suggest it again.");
}

