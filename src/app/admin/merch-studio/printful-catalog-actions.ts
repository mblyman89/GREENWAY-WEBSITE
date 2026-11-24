"use server";
/**
 * D266 - Browse Printful's full public catalog from the Garments tab.
 *
 * Printful catalog API v1 is public (no token): GET /products lists every
 * product, GET /products/{id} its variants (colour, color_code, color_code2,
 * photo). Read-only, display only - nothing is ordered, priced or saved.
 * Display cache only (rule 18): 12 h, and a failed read throws so it is
 * never stored.
 */
import { unstable_cache } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { PRINTFUL_API } from "@/lib/merch-studio/printful-client";
import { colorsFromVariants, isGarmentType, toCatalogItems, type CatalogItem, type ColorInfo } from "@/lib/merch-studio/garment-preview-core";

const TIMEOUT_MS = 20_000;

async function pfPublic(path: string): Promise<unknown> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${PRINTFUL_API}${path}`, { headers: { Accept: "application/json", "User-Agent": "greenway-merch-studio" }, signal: ctl.signal, cache: "no-store" });
    const json = (await res.json().catch(() => null)) as { result?: unknown } | null;
    if (!res.ok || !json) throw new Error(`Printful ${res.status}`);
    return json.result;
  } finally {
    clearTimeout(t);
  }
}

const cachedCatalog = unstable_cache(async () => {
  const raw = (await pfPublic("/products")) as Record<string, unknown>[];
  if (!Array.isArray(raw)) throw new Error("Printful catalog shape changed");
  const garments = raw.filter((p) => isGarmentType(p?.type));
  return toCatalogItems(garments);
}, ["printful-public-catalog-v1"], { revalidate: 43_200 });

const cachedProduct = unstable_cache(async (id: number) => {
  const r = (await pfPublic(`/products/${id}`)) as { variants?: unknown } | null;
  return colorsFromVariants(r?.variants);
}, ["printful-public-product-v1"], { revalidate: 43_200 });

export async function printfulCatalogAction(): Promise<{ ok: true; items: CatalogItem[] } | { ok: false; error: string }> {
  await requirePermission("content.edit");
  try {
    return { ok: true, items: await cachedCatalog() };
  } catch (e) {
    return { ok: false, error: `Couldn't load Printful's catalog (${(e as Error)?.name === "AbortError" ? "timed out" : (e as Error)?.message || "network error"}). Try again.` };
  }
}

export async function printfulProductColorsAction(input: { id: number }): Promise<{ ok: true; colors: ColorInfo[] } | { ok: false; error: string }> {
  await requirePermission("content.edit");
  const id = Number(input?.id);
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "Unknown Printful product." };
  try {
    return { ok: true, colors: await cachedProduct(id) };
  } catch (e) {
    return { ok: false, error: `Couldn't load that product from Printful (${(e as Error)?.message || "network error"}).` };
  }
}
