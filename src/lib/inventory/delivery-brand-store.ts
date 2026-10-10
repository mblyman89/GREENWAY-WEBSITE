/**
 * src/lib/inventory/delivery-brand-store.ts  (R37 S5)  SERVER-ONLY.
 *
 * Reads and writes for "Brand for this delivery" on Product onboarding and
 * the per-row brand override. Every DECISION lives in delivery-brand-core
 * (pure, self-tested); this file gathers rows, applies the plan and reports
 * exactly what happened. It never throws to the action.
 *
 * WHERE THE BRAND IS WRITTEN (each verified against the migrations)
 *   1. brands            - found by brandKey, adopted by the vendor when
 *                          unlinked, or created under the vendor (status
 *                          draft, like every other auto-created brand).
 *   2. catalog_product_drafts.brand_name + brand_id (0234; brand_id dropped
 *                          once on a pre-0234 database).
 *   3. inventory_lots.brand_id - the inventory table and the lot page read
 *                          brands.display_name by this id.
 *   4. menu_items.brand_name on the PUBLISHED and intake-STAGED cards that
 *                          sell the lot, plus approved drafts - through the
 *                          R33 propagateLotCorrections (lot-propagation-store),
 *                          the same path a "Correct lot details" save uses,
 *                          with its sibling-lot safety (a card that also sells
 *                          a lot of a DIFFERENT brand is left alone and
 *                          named). Customer cards, enrichment identity and the
 *                          Leafly identity bridge all read menu_items.brand_name.
 *   5. inbound_manifests.brand_id + vendors.default_brand_id (0257) - the
 *                          memory. Missing columns = remembered:null, the
 *                          banner says so; nothing else fails.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pagedAllChecked } from "@/lib/supabase/chunked-in";
import { isMissingColumnError } from "@/lib/inventory/coa-extract-core";
import type { BrandCandidate } from "@/lib/inventory/brand-resolve-core";
import { propagateLotCorrections } from "@/lib/inventory/lot-propagation-store";
import {
  cleanBrandInput,
  decideBrandForVendor,
  planDeliveryBrand,
  type BrandRow,
  type DeliveryBrandResult,
} from "@/lib/inventory/delivery-brand-core";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

const BRAND_SCAN_MAX = 20_000;

export type ResolvedBrand =
  | { ok: true; brandId: string; name: string; created: boolean; adopted: boolean; how: string }
  | { ok: false; refused: boolean; reason: string };

/** Every brand (id, name, vendor) with a completeness verdict. */
async function readAllBrands(admin: Admin): Promise<{ rows: BrandCandidate[]; complete: boolean }> {
  const { rows, verdict } = await pagedAllChecked<BrandCandidate>(
    async (from, to) => {
      const { data, error } = await admin
        .from("brands")
        .select("id, display_name, vendor_id")
        .order("id", { ascending: true })
        .range(from, to);
      if (error) return { rows: [], ok: false };
      return { rows: (data as BrandCandidate[] | null) ?? [], ok: true };
    },
    { maxRows: BRAND_SCAN_MAX },
  );
  return { rows, complete: verdict.complete };
}

async function vendorNameMap(admin: Admin, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const uniq = [...new Set(ids.filter(Boolean))];
  if (uniq.length === 0) return out;
  const { data } = await admin.from("vendors").select("id, display_name").in("id", uniq.slice(0, 200));
  for (const r of (data as { id: string; display_name: string | null }[] | null) ?? []) if (r.display_name) out.set(r.id, r.display_name);
  return out;
}

/** Find, adopt or create the brand the owner typed, for this vendor. */
export async function resolveOrCreateBrand(admin: Admin, name: string, vendorId: string | null, actorId: string | null): Promise<ResolvedBrand> {
  const { rows, complete } = await readAllBrands(admin);
  const owners = rows.map((r) => r.vendor_id ?? "").filter((v) => v && v !== vendorId);
  const decision = decideBrandForVendor({ name, vendorId, all: rows, complete, vendorNames: await vendorNameMap(admin, owners) });
  if (decision.kind === "refuse") return { ok: false, refused: true, reason: decision.reason };
  if (decision.kind === "use") {
    let adopted = false;
    if (decision.adoptVendor && vendorId) {
      // Only an UNLINKED brand is adopted (the .is guard makes a race safe).
      const { data, error } = await admin
        .from("brands")
        .update({ vendor_id: vendorId, updated_by: actorId })
        .eq("id", decision.brandId)
        .is("vendor_id", null)
        .select("id");
      adopted = !error && ((data as unknown[] | null) ?? []).length === 1;
    }
    return { ok: true, brandId: decision.brandId, name: decision.name, created: false, adopted, how: decision.how };
  }
  // Create - the slug is unique; on a collision try a short suffix once.
  for (const slug of [decision.slug, `${decision.slug.slice(0, 74)}-${Date.now().toString(36).slice(-5)}`]) {
    const { data, error } = await admin
      .from("brands")
      .insert({ display_name: decision.name, slug, vendor_id: vendorId, status: "draft", created_by: actorId, updated_by: actorId })
      .select("id")
      .single();
    if (!error && data) return { ok: true, brandId: (data as { id: string }).id, name: decision.name, created: true, adopted: false, how: "new brand" };
    if (error && error.code !== "23505") return { ok: false, refused: false, reason: `The new brand could not be saved (${error.message}).` };
  }
  return { ok: false, refused: false, reason: "The new brand could not be saved (its name is already taken twice over)." };
}

type DraftRow = { id: string; lot_id: string | null; brand_id?: string | null; brand_name: string | null; status: string };
type LotRow = { id: string; brand_id: string | null; vendor_id: string | null; strain_name: string | null };

export type ApplyOutcome = { changed: number; cards: number; skipped: number; errors: string[] };

/** Write one brand onto the given rows (drafts, lots, cards). */
async function applyBrandToRows(admin: Admin, rows: BrandRow[], brand: { id: string | null; name: string | null }): Promise<ApplyOutcome> {
  const out: ApplyOutcome = { changed: 0, cards: 0, skipped: 0, errors: [] };
  if (rows.length === 0) return out;
  const lotIds = [...new Set(rows.map((r) => r.lotId).filter((x): x is string => Boolean(x)))];
  const lots = new Map<string, LotRow>();
  for (let i = 0; i < lotIds.length; i += 200) {
    const { data, error } = await admin.from("inventory_lots").select("id, brand_id, vendor_id, strain_name").in("id", lotIds.slice(i, i + 200));
    if (error) {
      out.errors.push(`the inventory lots could not be read (${error.message}); their brand was not changed`);
      lots.clear();
      break;
    }
    for (const l of (data as LotRow[] | null) ?? []) lots.set(l.id, l);
  }
  let brandIdColumn = true;
  const doneLots = new Set<string>();
  for (const r of rows) {
    const patch: Record<string, unknown> = { brand_name: brand.name };
    if (brandIdColumn) patch.brand_id = brand.id;
    let { error } = await admin.from("catalog_product_drafts").update(patch).eq("id", r.draftId);
    if (error && brandIdColumn && isMissingColumnError(error)) {
      brandIdColumn = false;
      delete patch.brand_id;
      ({ error } = await admin.from("catalog_product_drafts").update(patch).eq("id", r.draftId));
    }
    if (error) {
      out.errors.push(`a product row was not updated (${error.message})`);
      continue;
    }
    out.changed += 1;
    const lot = r.lotId ? lots.get(r.lotId) : undefined;
    if (!lot || doneLots.has(lot.id)) continue;
    doneLots.add(lot.id);
    // The lot write is skipped when already right, but the card push is NOT:
    // a card can still carry a stale brand_name (the plan is idempotent and
    // leaves a card that already matches untouched).
    if (lot.brand_id !== brand.id) {
      const { error: lotErr } = await admin.from("inventory_lots").update({ brand_id: brand.id }).eq("id", lot.id);
      if (lotErr) {
        out.errors.push(`an inventory lot kept its old brand (${lotErr.message})`);
        continue;
      }
    }
    const prop = await propagateLotCorrections({
      lotId: lot.id,
      strainType: null,
      names: { brand: { from: r.brandName, to: brand.name, toId: brand.id } },
      target: { strainName: lot.strain_name, vendorId: lot.vendor_id, brandId: brand.id },
    });
    if (prop.details) {
      out.cards += prop.details.cardsUpdated.published + prop.details.cardsUpdated.staged;
      out.skipped += prop.details.cardsSkipped.length;
      out.errors.push(...prop.details.errors.slice(0, 2));
    }
  }
  return out;
}

async function readManifestDrafts(admin: Admin, manifestId: string): Promise<{ ok: true; rows: BrandRow[] } | { ok: false; error: string }> {
  const read = async (cols: string) => {
    let lastError: string | null = null;
    let missingColumn = false;
    const { rows, verdict } = await pagedAllChecked<DraftRow>(async (from, to) => {
      const { data, error } = await admin
        .from("catalog_product_drafts")
        .select(cols)
        .eq("manifest_id", manifestId)
        .in("status", ["draft", "approved"])
        .order("id", { ascending: true })
        .range(from, to);
      if (error) {
        lastError = error.message;
        missingColumn = isMissingColumnError(error);
        return { rows: [], ok: false };
      }
      return { rows: (data ?? []) as unknown as DraftRow[], ok: true };
    }, { maxRows: 10_000 });
    return { rows, complete: verdict.complete, lastError: lastError as string | null, missingColumn };
  };
  let res = await read("id, lot_id, brand_id, brand_name, status");
  if (!res.complete && res.missingColumn) res = await read("id, lot_id, brand_name, status");
  // Never act on a partial list: a half-branded delivery that LOOKS done is worse than a refusal.
  if (!res.complete) return { ok: false, error: res.lastError ?? "the product list could not be read completely" };
  return { ok: true, rows: res.rows.map((d): BrandRow => ({ draftId: d.id, lotId: d.lot_id, brandId: d.brand_id ?? null, brandName: d.brand_name })) };
}

/** Remember the brand on the delivery and the vendor. null = migration 0257 missing. */
async function remember(admin: Admin, manifestId: string, vendorId: string | null, brandId: string): Promise<boolean | null> {
  const m = await admin.from("inbound_manifests").update({ brand_id: brandId }).eq("id", manifestId);
  if (m.error) return isMissingColumnError(m.error) ? null : false;
  if (!vendorId) return true;
  const v = await admin.from("vendors").update({ default_brand_id: brandId }).eq("id", vendorId);
  if (v.error) return isMissingColumnError(v.error) ? null : false;
  return true;
}

export type DeliveryBrandRun = DeliveryBrandResult & { vendorId?: string | null; brandId?: string; adopted?: boolean };

/** "Set brand" for a whole delivery. */
export async function setDeliveryBrand(input: { manifestId: string; rawName: unknown; mode: "fill" | "replace"; actorId: string | null }): Promise<DeliveryBrandRun> {
  const clean = cleanBrandInput(input.rawName);
  if (!clean.ok) return { code: "refused", reason: clean.error };
  if (!clean.name) return { code: "refused", reason: "Type the brand name first." };
  if (!isSupabaseServiceConfigured) return { code: "error", reason: "The database is not configured here." };
  try {
    const admin = createSupabaseAdminClient();
    const { data: mData, error: mErr } = await admin.from("inbound_manifests").select("id, vendor_id").eq("id", input.manifestId).maybeSingle();
    if (mErr) return { code: "error", reason: `The delivery could not be read (${mErr.message}).` };
    if (!mData) return { code: "refused", reason: "That delivery no longer exists." };
    const vendorId = (mData as { vendor_id: string | null }).vendor_id ?? null;
    const drafts = await readManifestDrafts(admin, input.manifestId);
    if (!drafts.ok) return { code: "error", reason: `The products could not be read (${drafts.error}).` };
    if (drafts.rows.length === 0) return { code: "none" };
    const resolved = await resolveOrCreateBrand(admin, clean.name, vendorId, input.actorId);
    if (!resolved.ok) return { code: resolved.refused ? "refused" : "error", reason: resolved.reason };
    const plan = planDeliveryBrand(drafts.rows, { id: resolved.brandId, name: resolved.name }, input.mode);
    const applied = await applyBrandToRows(admin, plan.change, { id: resolved.brandId, name: resolved.name });
    const remembered = await remember(admin, input.manifestId, vendorId, resolved.brandId);
    const notes: string[] = [];
    if (applied.skipped > 0) notes.push(`${applied.skipped} menu card(s) also sell a lot of a different brand and kept theirs - fix those lots on the inventory page.`);
    if (applied.errors.length > 0) notes.push(`Not everything saved: ${applied.errors.slice(0, 2).join("; ")}.`);
    if (remembered === false) notes.push("The brand could not be remembered for this vendor just now.");
    return {
      code: "ok",
      brand: resolved.name,
      changed: applied.changed,
      already: plan.already,
      kept: plan.kept,
      cards: applied.cards,
      created: resolved.created,
      remembered,
      reason: notes.join(" ") || undefined,
      vendorId,
      brandId: resolved.brandId,
      adopted: resolved.adopted,
    };
  } catch (err) {
    return { code: "error", reason: err instanceof Error ? err.message : String(err) };
  }
}

/** Per-row brand: set (or clear with an empty name) on ONE product. */
export async function setDraftBrand(input: { draftId: string; rawName: unknown; actorId: string | null }): Promise<DeliveryBrandRun & { manifestId?: string | null }> {
  const clean = cleanBrandInput(input.rawName);
  if (!clean.ok) return { code: "refused", reason: clean.error };
  if (!isSupabaseServiceConfigured) return { code: "error", reason: "The database is not configured here." };
  try {
    const admin = createSupabaseAdminClient();
    let res = await admin.from("catalog_product_drafts").select("id, lot_id, brand_id, brand_name, status, manifest_id, vendor_id").eq("id", input.draftId).maybeSingle();
    if (res.error && isMissingColumnError(res.error)) {
      res = await admin.from("catalog_product_drafts").select("id, lot_id, brand_name, status, manifest_id").eq("id", input.draftId).maybeSingle();
    }
    if (res.error) return { code: "error", reason: `The product could not be read (${res.error.message}).` };
    const d = res.data as (DraftRow & { manifest_id: string | null; vendor_id?: string | null }) | null;
    if (!d) return { code: "refused", reason: "That product no longer exists." };
    if (d.status === "dismissed") return { code: "refused", reason: "That product was dismissed; restore it first.", manifestId: d.manifest_id };
    let vendorId = d.vendor_id ?? null;
    if (!vendorId && d.lot_id) {
      const { data } = await admin.from("inventory_lots").select("vendor_id").eq("id", d.lot_id).maybeSingle();
      vendorId = (data as { vendor_id: string | null } | null)?.vendor_id ?? null;
    }
    if (!vendorId && d.manifest_id) {
      const { data } = await admin.from("inbound_manifests").select("vendor_id").eq("id", d.manifest_id).maybeSingle();
      vendorId = (data as { vendor_id: string | null } | null)?.vendor_id ?? null;
    }
    const row: BrandRow = { draftId: d.id, lotId: d.lot_id, brandId: d.brand_id ?? null, brandName: d.brand_name };
    if (!clean.name) {
      if (row.brandId === null && !(row.brandName ?? "").trim()) return { code: "cleared", changed: 0, already: 1, manifestId: d.manifest_id };
      const applied = await applyBrandToRows(admin, [row], { id: null, name: null });
      return { code: "cleared", changed: applied.changed, cards: applied.cards, reason: applied.errors.slice(0, 2).join("; ") || undefined, manifestId: d.manifest_id };
    }
    const resolved = await resolveOrCreateBrand(admin, clean.name, vendorId, input.actorId);
    if (!resolved.ok) return { code: resolved.refused ? "refused" : "error", reason: resolved.reason, manifestId: d.manifest_id };
    const plan = planDeliveryBrand([row], { id: resolved.brandId, name: resolved.name }, "replace");
    const applied = await applyBrandToRows(admin, plan.change, { id: resolved.brandId, name: resolved.name });
    const notes: string[] = [];
    if (applied.skipped > 0) notes.push(`${applied.skipped} menu card(s) also sell a lot of a different brand and kept theirs.`);
    if (applied.errors.length > 0) notes.push(`Not everything saved: ${applied.errors.slice(0, 2).join("; ")}.`);
    return {
      code: "ok",
      brand: resolved.name,
      changed: applied.changed,
      already: plan.already,
      kept: 0,
      cards: applied.cards,
      created: resolved.created,
      reason: notes.join(" ") || undefined,
      vendorId,
      brandId: resolved.brandId,
      adopted: resolved.adopted,
      manifestId: d.manifest_id,
    };
  } catch (err) {
    return { code: "error", reason: err instanceof Error ? err.message : String(err) };
  }
}

export type DeliveryBrandContext = {
  vendorId: string | null;
  vendorName: string | null;
  deliveryBrand: string | null;
  vendorDefault: string | null;
  /** False = migration 0257 is not applied (no memory yet). */
  migrated: boolean;
  /** This vendor's brand names (suggestions for the field), A-Z, max 200. */
  vendorBrands: string[];
};

/** What the delivery brand field needs (never throws; empty on failure). */
export async function loadDeliveryBrandContext(manifestId: string): Promise<DeliveryBrandContext> {
  const empty: DeliveryBrandContext = { vendorId: null, vendorName: null, deliveryBrand: null, vendorDefault: null, migrated: true, vendorBrands: [] };
  if (!isSupabaseServiceConfigured) return empty;
  try {
    const admin = createSupabaseAdminClient();
    let migrated = true;
    let m = await admin.from("inbound_manifests").select("id, vendor_id, brand_id").eq("id", manifestId).maybeSingle();
    if (m.error && isMissingColumnError(m.error)) {
      migrated = false;
      m = await admin.from("inbound_manifests").select("id, vendor_id").eq("id", manifestId).maybeSingle();
    }
    const man = (m.data as { vendor_id: string | null; brand_id?: string | null } | null) ?? null;
    if (!man) return { ...empty, migrated };
    const vendorId = man.vendor_id ?? null;
    let vendorName: string | null = null;
    let defaultId: string | null = null;
    if (vendorId) {
      let v = await admin.from("vendors").select("display_name, default_brand_id").eq("id", vendorId).maybeSingle();
      if (v.error && isMissingColumnError(v.error)) {
        migrated = false;
        v = await admin.from("vendors").select("display_name").eq("id", vendorId).maybeSingle();
      }
      const vr = v.data as { display_name: string | null; default_brand_id?: string | null } | null;
      vendorName = vr?.display_name ?? null;
      defaultId = vr?.default_brand_id ?? null;
    }
    let vendorBrands: string[] = [];
    if (vendorId) {
      const { data } = await admin.from("brands").select("display_name").eq("vendor_id", vendorId).order("display_name").range(0, 199);
      vendorBrands = ((data as { display_name: string | null }[] | null) ?? []).map((b) => b.display_name ?? "").filter(Boolean);
    }
    const ids = [man.brand_id ?? null, defaultId].filter((x): x is string => Boolean(x));
    const names = new Map<string, string>();
    if (ids.length > 0) {
      const { data } = await admin.from("brands").select("id, display_name").in("id", ids);
      for (const b of (data as { id: string; display_name: string }[] | null) ?? []) names.set(b.id, b.display_name);
    }
    return {
      vendorId,
      vendorName,
      deliveryBrand: man.brand_id ? names.get(man.brand_id) ?? null : null,
      vendorDefault: defaultId ? names.get(defaultId) ?? null : null,
      migrated,
      vendorBrands,
    };
  } catch {
    return empty;
  }
}

/** The vendor's remembered brand id (null when unset, unmigrated or unreadable). Used at intake. */
export async function readVendorDefaultBrand(admin: Admin, vendorId: string | null): Promise<{ id: string; name: string | null } | null> {
  if (!vendorId) return null;
  try {
    const { data, error } = await admin.from("vendors").select("default_brand_id").eq("id", vendorId).maybeSingle();
    if (error) return null;
    const id = (data as { default_brand_id: string | null } | null)?.default_brand_id ?? null;
    if (!id) return null;
    const { data: b } = await admin.from("brands").select("display_name").eq("id", id).maybeSingle();
    return { id, name: (b as { display_name: string | null } | null)?.display_name ?? null };
  } catch {
    return null;
  }
}

/** Admin -> Vendors: set (or clear) the vendor's remembered brand from its own brands. */
export async function setVendorDefaultBrand(vendorId: string, brandId: string | null): Promise<{ ok: true } | { ok: false; error: string; migration?: boolean }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "The database is not configured here." };
  const admin = createSupabaseAdminClient();
  if (brandId) {
    const { data } = await admin.from("brands").select("id, vendor_id").eq("id", brandId).maybeSingle();
    const b = data as { id: string; vendor_id: string | null } | null;
    if (!b) return { ok: false, error: "That brand no longer exists." };
    if (b.vendor_id && b.vendor_id !== vendorId) return { ok: false, error: "That brand belongs to a different vendor." };
  }
  const { error } = await admin.from("vendors").update({ default_brand_id: brandId }).eq("id", vendorId);
  if (error) return { ok: false, error: isMissingColumnError(error) ? "Run migration 0257_delivery_brand.sql first." : error.message, migration: isMissingColumnError(error) };
  return { ok: true };
}
