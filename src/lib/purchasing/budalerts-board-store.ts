/**
 * src/lib/purchasing/budalerts-board-store.ts
 *
 * D242 — what the Vendor Menus page needs from Budalerts, in ONE cache()d
 * load per request (the "Still need a menu" table and the new "Done — from
 * Budalerts" table share it):
 *
 *   - the coverage tables' `needed` rows, split into still-needed and done
 *     (a vendor is done once a linked Budalerts brand has a usable pull);
 *   - per-row link state and exact-slug suggestions (D243: for "Menus on
 *     file" vendors too, not only "Still need a menu");
 *   - how many linked brands are due for a refetch.
 *
 * Reads are named-column and paged; decisions are in budalerts-core.ts.
 */
import "server-only";

import { cache } from "react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pagedAll } from "@/lib/supabase/chunked-in";
import { dbErrorForStaff } from "@/lib/db/rpc-fallback-core";
import { loadVendorMenuCoverage } from "@/lib/purchasing/vendor-menu-coverage-store";
import type { NeededRow } from "@/lib/purchasing/vendor-menu-coverage-core";
import {
  budalertsLookupVendorIds,
  budalertsStateByVendor,
  budalertsVendorNames,
  buildBudalertsRowInfo,
  pickDueSlugs,
  splitNeededByBudalerts,
  type BudalertsRowInfo,
  type BudalertsVendorState,
} from "@/lib/purchasing/budalerts-core";
import { loadBudalertsOverview, toSnapshotRow } from "@/lib/purchasing/budalerts-store";

export type BudalertsDoneRow = NeededRow & { budalerts: BudalertsVendorState };

export type BudalertsBoard = {
  /** false until migration 0364 is run (the page then shows a notice and the old table). */
  available: boolean;
  stillNeeded: NeededRow[];
  done: BudalertsDoneRow[];
  rows: Record<string, BudalertsRowInfo>;
  linkedBrands: number;
  dueBrands: number;
  knownSlugCount: number;
  knownSlugsAt: string | null;
  lastRunAt: string | null;
  lastRunNote: string | null;
  warnings: string[];
};

async function readBrandNames(warnings: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!isSupabaseServiceConfigured) return out;
  const db = createSupabaseAdminClient();
  let failed = false;
  const rows = await pagedAll<{ id: string; vendor_id: string | null; display_name: string | null }>(async (f, t) => {
    if (failed) return [];
    const { data, error } = await db
      .from("brands")
      .select("id, vendor_id, display_name")
      .not("vendor_id", "is", null)
      .order("id", { ascending: true })
      .range(f, t);
    if (error) {
      failed = true;
      warnings.push(`Brands (for Budalerts suggestions): ${dbErrorForStaff(error, "the read failed")}`);
      return [];
    }
    return (data as { id: string; vendor_id: string | null; display_name: string | null }[] | null) ?? [];
  });
  for (const r of rows) {
    if (!r.vendor_id || !r.display_name) continue;
    const list = out.get(r.vendor_id) ?? [];
    list.push(r.display_name);
    out.set(r.vendor_id, list);
  }
  return out;
}

async function loadUncached(nowMs: number): Promise<BudalertsBoard> {
  const [cov, ov] = await Promise.all([loadVendorMenuCoverage(nowMs), loadBudalertsOverview()]);
  const base: BudalertsBoard = {
    available: ov.available,
    stillNeeded: cov.needed,
    done: [],
    rows: {},
    linkedBrands: 0,
    dueBrands: 0,
    knownSlugCount: ov.knownSlugs.length,
    knownSlugsAt: ov.state?.known_slugs_at ?? null,
    lastRunAt: ov.state?.last_run_at ?? null,
    lastRunNote: ov.state?.last_run_note ?? null,
    warnings: [...ov.warnings],
  };
  if (!ov.available) return base;

  const links = ov.links.map((l) => ({ vendorId: l.vendor_id, slug: l.slug, brandName: l.brand_name }));
  const snaps = ov.snapshots.map(toSnapshotRow);
  const state = budalertsStateByVendor(links, snaps);
  const split = splitNeededByBudalerts(cov.needed, state);

  const brandNames = await readBrandNames(base.warnings);
  // D243 — the lookup also runs on "Menus on file" rows (vendors found on
  // Cultivera / GrowFlow / LeafLink), using the menus' seller names too.
  const vendorNames = budalertsVendorNames(cov.needed, cov.searched);
  const info = buildBudalertsRowInfo(
    budalertsLookupVendorIds(cov.needed, cov.searched),
    links,
    snaps,
    vendorNames,
    brandNames,
    new Set(ov.knownSlugs),
  );

  return {
    ...base,
    stillNeeded: split.stillNeeded,
    done: split.done,
    rows: Object.fromEntries(info),
    linkedBrands: new Set(links.map((l) => l.slug)).size,
    dueBrands: pickDueSlugs(links, snaps, nowMs, 100_000).length,
  };
}

export const loadBudalertsBoard = cache(loadUncached);
