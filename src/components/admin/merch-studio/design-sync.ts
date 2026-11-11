"use client";

/**
 * D232 M-4 (G-79) - the browser half of server-saved designs. The server
 * (merch_designs, migration 0360) is the source of truth; this browser's
 * localStorage list is the offline cache, and IndexedDB keeps the artwork
 * files (art is ALSO copied to the private merch-files bucket, art/<asset id>).
 *
 *   syncDesigns(local)  pull every server design, merge (never loses work -
 *                       mergeDesigns keeps a "(this computer)" copy when both
 *                       sides changed), push this browser's new/edited ones,
 *                       and fetch any artwork this browser doesn't have.
 *   pushDesign(d)       upload missing art, then save with the last rev this
 *                       browser saw (compare-and-set on the server).
 */
import { assetIds, newId, type MerchDesign } from "@/lib/merch-studio/merch-design-core";
import { contentHash, DESIGN_CONFLICT, mergeDesigns, type DesignRow, type SyncMeta } from "@/lib/merch-studio/merch-design-sync-core";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";
import { artDownloadUrlsAction, listMerchDesignsAction, saveMerchDesignAction, startArtUploadsAction } from "@/app/admin/merch-studio/design-actions";
import { getAsset, putAsset } from "./merch-assets";

export const SYNC_META_KEY = "gw-merch-sync-v1";

export function loadMeta(): SyncMeta {
  try { const o = JSON.parse(window.localStorage.getItem(SYNC_META_KEY) ?? "{}") as unknown; return o && typeof o === "object" ? (o as SyncMeta) : {}; } catch { return {}; }
}
export function saveMeta(m: SyncMeta): void {
  try { window.localStorage.setItem(SYNC_META_KEY, JSON.stringify(m)); } catch { /* quota: next sync re-learns it */ }
}

/** PUT one file to a signed upload URL (any image type - print-export's helper is PNG only). */
export async function putSignedFile(bucket: string, key: string, token: string, blob: Blob): Promise<void> {
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  const body = new FormData();
  body.append("cacheControl", "3600");
  body.append("", new File([blob], key.split("/").pop() || "file", { type: blob.type || "application/octet-stream" }));
  const res = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/upload/sign/${bucket}/${encoded}?token=${encodeURIComponent(token)}`, { method: "PUT", body, headers: { apikey: supabaseAnonKey, "x-upsert": "false" } });
  if (!res.ok && res.status !== 409) throw new Error(`Upload failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 200)}`);
}

/** Copy this design's artwork (from IndexedDB) to the server, skipping what is already there. */
export async function uploadArt(d: MerchDesign): Promise<{ missingHere: number }> {
  const ids = assetIds(d);
  if (!ids.length) return { missingHere: 0 };
  const start = await startArtUploadsAction({ assetIds: ids });
  if (!start.ok) throw new Error(start.error);
  let missingHere = 0;
  for (const u of start.uploads) {
    const blob = await getAsset(u.assetId).catch(() => null);
    if (!blob) { missingHere++; continue; }
    await putSignedFile(start.bucket, u.key, u.token, blob);
  }
  return { missingHere };
}

/** Fetch artwork this browser lacks from the server into IndexedDB. Returns how many are still missing. */
export async function downloadArt(designs: readonly MerchDesign[]): Promise<number> {
  const want: string[] = [];
  for (const id of [...new Set(designs.flatMap(assetIds))]) if (!(await getAsset(id).catch(() => null))) want.push(id);
  if (!want.length) return 0;
  let missing = 0;
  for (let i = 0; i < want.length; i += 40) {
    const r = await artDownloadUrlsAction({ assetIds: want.slice(i, i + 40) });
    if (!r.ok) return want.length;
    missing += r.missing.length;
    for (const [id, url] of Object.entries(r.urls)) {
      const res = await fetch(url).catch(() => null);
      if (!res?.ok) { missing++; continue; }
      await putAsset(id, await res.blob());
    }
  }
  return missing;
}

export type PushResult = { ok: true; rev: number; designHash: string } | { ok: false; error: string; conflict?: boolean };

export async function pushDesign(d: MerchDesign, meta: SyncMeta): Promise<PushResult> {
  try {
    await uploadArt(d);
    const r = await saveMerchDesignAction({ design: d, baseRev: meta[d.id]?.rev ?? 0 });
    if (!r.ok) return { ok: false, error: r.error, conflict: r.conflict };
    meta[d.id] = { rev: r.rev, hash: contentHash(d) };
    saveMeta(meta);
    return { ok: true, rev: r.rev, designHash: r.designHash };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't reach the server." };
  }
}

export interface SyncOutcome {
  list: MerchDesign[];
  rows: DesignRow[];
  error: string | null;
  forked: { from: string; copy: string }[];
  artMissing: number;
}

export async function syncDesigns(local: readonly MerchDesign[]): Promise<SyncOutcome> {
  const listed = await listMerchDesignsAction().catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : "Couldn't reach the server." }));
  if (!listed.ok) return { list: [...local], rows: [], error: listed.error, forked: [], artMissing: 0 };
  const meta = loadMeta();
  const m = mergeDesigns(local, listed.rows, meta, () => newId("ds"));
  saveMeta(m.meta);
  let error: string | null = null;
  for (const id of m.push) {
    const d = m.list.find((x) => x.id === id);
    if (!d) continue;
    const r = await pushDesign(d, m.meta);
    if (!r.ok) error = r.conflict ? DESIGN_CONFLICT : r.error;
  }
  const artMissing = await downloadArt(m.list).catch(() => 0);
  const again = m.push.length ? await listMerchDesignsAction().catch(() => null) : null;
  return { list: m.list, rows: again && again.ok ? again.rows : listed.rows, error, forked: m.forked, artMissing };
}

/**
 * Read-only view for Proof & Export and Publish: this browser's list plus
 * anything newer or only on the server, with the artwork fetched. Pushes
 * nothing (only the Design tab writes), so two tabs never race.
 */
export async function pullDesigns(local: readonly MerchDesign[]): Promise<{ list: MerchDesign[]; error: string | null }> {
  const listed = await listMerchDesignsAction().catch(() => null);
  if (!listed || !listed.ok) return { list: [...local], error: listed && !listed.ok ? listed.error : "Couldn't reach the server." };
  const m = mergeDesigns(local, listed.rows, loadMeta(), () => newId("ds"));
  const copies = new Set(m.forked.map((f) => f.copy));
  const list = m.list.filter((d) => !copies.has(d.id));
  await downloadArt(list).catch(() => 0);
  return { list, error: null };
}
