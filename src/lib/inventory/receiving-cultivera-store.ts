/**
 * src/lib/inventory/receiving-cultivera-store.ts  (R50 S10a)
 *
 * Read-only loader for the Receiving table's "Cultivera manifests" view:
 * EVERY manifest rebuilt from the Cultivera export (paged past PostgREST's
 * row cap) plus the onboarding tally that decides Complete / Needs attention.
 * The whole set is loaded so the owner's filters and sorting apply to all of
 * them, not to one page (~700 rows of six short columns; measured scale in
 * R50 §1.1 / §1.9).
 *
 * Fail-soft, never a guess:
 *   - the manifest read fails  -> { ok: false } (the page shows the error);
 *   - the draft tally fails    -> rows come back with tallyRead=false, and the
 *     table shows "Unknown" (never "Complete", never "Needs attention").
 *
 * Writes nothing.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { RECONSTRUCTED_MANIFEST_KIND } from "@/lib/inventory/cultivera-manifest-group-core";
import {
  cultiveraManifestRows,
  tallyCultiveraDrafts,
  type CultiveraManifestRow,
} from "@/lib/inventory/cultivera-onboarding-core";
import { cultiveraDayKey, cultiveraTableRows, type CultiveraTableRow } from "@/lib/inventory/receiving-table-core";
import { sourceOfGroupKind, type CultiveraSource } from "@/lib/inventory/cultivera-vendor-core";
import { loadAllPublishedCategoryHoldKeys } from "@/lib/inventory/cultivera-category-gate";
import { tallyCategoryHolds } from "@/lib/inventory/cultivera-category-gate-core";

export type ReceivingCultiveraLoad =
  | { ok: true; rows: CultiveraTableRow[]; tallyRead: boolean; truncated: boolean }
  | { ok: false; error: string };

const PAGE = 1000;
/** Safety stop: far above the measured ~700 rebuilt manifests. */
const MAX_MANIFESTS = 20_000;
/** ids per `.in()` so the request URL stays well under proxy limits. */
const ID_CHUNK = 100;

const short = (e: unknown) =>
  (e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e)).slice(0, 200);

export async function loadReceivingCultiveraRows(): Promise<ReceivingCultiveraLoad> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Supabase is not configured." };
  const admin = createSupabaseAdminClient();

  // R74 S11: group_kind says where each manifest came from (transfer match,
  // emailed manifest, the CV-UNMATCHED catch-all, or a received-date group).
  const manifests: (CultiveraManifestRow & { group_kind?: string | null })[] = [];
  let truncated = false;
  for (let off = 0; ; off += PAGE) {
    if (off >= MAX_MANIFESTS) {
      truncated = true;
      break;
    }
    const { data, error } = await admin
      .from("inbound_manifests")
      .select("id, manifest_number, vendor_label, transfer_date, accepted_at, accepted_lot_count, group_kind:raw_payload->>group_kind")
      .eq("raw_payload->>kind", RECONSTRUCTED_MANIFEST_KIND)
      .order("accepted_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: true })
      .range(off, off + PAGE - 1);
    if (error) return { ok: false, error: short(error) };
    const got = (data as (CultiveraManifestRow & { group_kind?: string | null })[] | null) ?? [];
    manifests.push(...got);
    if (got.length < PAGE) break;
  }

  // Onboarding tally, chunked by manifest id and paged inside each chunk.
  const drafts: { manifest_id: string | null; status: string | null; pos_product_key?: string | null }[] = [];
  let tallyRead = true;
  outer: for (let i = 0; i < manifests.length; i += ID_CHUNK) {
    const ids = manifests.slice(i, i + ID_CHUNK).map((m) => m.id);
    for (let off = 0; off < 200_000; off += PAGE) {
      const { data, error } = await admin
        .from("catalog_product_drafts")
        .select("id, manifest_id, status, pos_product_key")
        .in("manifest_id", ids)
        .order("id", { ascending: true })
        .range(off, off + PAGE - 1);
      if (error) {
        tallyRead = false;
        break outer;
      }
      const got = (data as { manifest_id: string | null; status: string | null; pos_product_key?: string | null }[] | null) ?? [];
      drafts.push(...got);
      if (got.length < PAGE) break;
    }
  }

  // R74 S15: a manifest with a product still held for a category is never
  // Complete. One read of every held live card (there are few); a failed read
  // keeps would-be-Complete manifests open (fail closed).
  let holds: Map<string, number> | null = new Map();
  if (tallyRead && drafts.some((d) => d.pos_product_key)) {
    const read = await loadAllPublishedCategoryHoldKeys(admin);
    holds = read.ok ? tallyCategoryHolds(drafts, read.held) : null;
  }
  const views = cultiveraManifestRows(manifests, tallyRead ? tallyCultiveraDrafts(drafts) : null, holds);
  const dayKeys = new Map(manifests.map((m) => [m.id, cultiveraDayKey(m)] as const));
  const sources = new Map<string, CultiveraSource>(manifests.map((m) => [m.id, sourceOfGroupKind(m.group_kind)] as const));
  return { ok: true, rows: cultiveraTableRows(views, dayKeys, tallyRead, sources), tallyRead, truncated };
}
