/**
 * src/components/admin/media/MediaDetailV2.tsx   (D221 M5 + M7)
 *
 * The v2 cards on a picture's own page:
 *   - "SEO and AI fields": every SEO / AI field with an AI / Person / Rule
 *     badge (from field_provenance), so the owner sees what the AI wrote;
 *   - "Where it came from" (provenance): vendor, platform, menu item, source
 *     page, captured date, credit, publish reason, with the one-click
 *     Undo / Redo auto-publish for THIS picture (M5);
 *   - duplicates: the archived copies that point here, or the original this
 *     copy points at;
 *   - similar pictures (0354 media_similar) with the "why" chips;
 *   - collections: add to / take out of a collection.
 * Server component. All reads degrade to empty when 0354 is missing.
 */
import Link from "next/link";
import { Button } from "@/components/admin/ui/Button";
import { publicUrlForKey } from "@/lib/media/store";
import type { MediaAsset } from "@/lib/supabase/types";
import { BADGE_TEXT, PLATFORM_LABEL, ROLE_LABEL, SEO_FIELDS, fieldBadge } from "@/lib/media/library-v2-core";
import { similarReasonLabel } from "@/lib/catalog/image-recommend-core";
import type { DuplicateRow, MediaCollection, SimilarHit } from "@/lib/media/library-v2-server";

type Act = (formData: FormData) => Promise<void>;

const BADGE_CLASS: Record<string, string> = {
  ai: "border-sky-400/40 bg-sky-400/10 text-sky-300",
  human: "border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]",
  rule: "border-white/20 bg-white/5 text-white/60",
};

const PUBLISH_REASON: Record<string, string> = {
  "vendor-source-auto": "Published automatically (it came from the vendor's own menu)",
  "auto-reverted": "Auto-publish was undone (kept as a draft)",
  human: "Published by a person",
};

function show(v: unknown): string {
  if (Array.isArray(v)) return v.join(", ");
  if (v === null || v === undefined) return "";
  return String(v);
}

function Tile({ row, href, chips }: { row: DuplicateRow; href: string; chips?: string[] }) {
  const url = publicUrlForKey(row.storage_key);
  return (
    <Link href={href} className="block w-32 shrink-0 space-y-1 rounded border border-white/10 p-1.5 text-[11px] hover:border-[var(--admin-accent)]">
      <span className="flex h-24 items-center justify-center overflow-hidden rounded bg-black">
        {url && row.mime_type?.startsWith("image/") ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={row.title ?? row.filename} loading="lazy" className="h-full w-full object-contain" />
        ) : (
          <span className="text-2xl">🗂</span>
        )}
      </span>
      <span className="block truncate text-white/70">{row.title ?? row.filename}</span>
      <span className="block text-white/40">{row.status}</span>
      {chips && chips.length > 0 && (
        <span className="flex flex-wrap gap-0.5">
          {chips.map((c) => (
            <span key={c} className="rounded-full bg-white/10 px-1.5 text-[10px] text-white/60">{c}</span>
          ))}
        </span>
      )}
    </Link>
  );
}

export function MediaDetailV2({
  asset,
  selfHref,
  vendorName,
  publishedByName,
  similar,
  similarRows,
  duplicates,
  collections,
  memberOf,
  readError,
  autoPublishAction,
  collectionAction,
}: {
  asset: MediaAsset;
  selfHref: string;
  vendorName: string | null;
  publishedByName: string | null;
  similar: SimilarHit[];
  similarRows: DuplicateRow[];
  duplicates: { copies: DuplicateRow[]; original: DuplicateRow | null };
  collections: MediaCollection[];
  memberOf: Set<string>;
  readError: string | null;
  autoPublishAction: Act;
  collectionAction: Act;
}) {
  const prov = (asset.field_provenance as Record<string, unknown> | null | undefined) ?? null;
  const rec = asset as unknown as Record<string, unknown>;
  const rowsById = new Map(similarRows.map((r) => [r.id, r]));
  const reason = asset.publish_reason ?? null;
  const inColls = collections.filter((c) => memberOf.has(c.id));
  const outColls = collections.filter((c) => !memberOf.has(c.id));

  return (
    <>
      {readError && <p className="text-xs text-[var(--admin-orange)]">{readError}</p>}

      {/* SEO and AI fields with who-wrote-it badges */}
      <div data-testid="media-seo-fields" className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5 text-sm">
        <p className="font-semibold text-white">SEO and AI fields</p>
        <p className="mt-1 text-[11px] text-white/40">
          Badges say who wrote each value: <span className="text-sky-300">AI</span>, a <span className="text-[var(--admin-accent)]">Person</span>, or a{" "}
          <span className="text-white/60">Rule</span>. The AI never overwrites a Person value. Edit the title, description and alt text in the form above.
        </p>
        <dl className="mt-3 grid gap-2 sm:grid-cols-2">
          {SEO_FIELDS.map((f) => {
            const value = rec[f.column];
            const text = f.column === "role" ? ROLE_LABEL[show(value)] ?? show(value) : show(value);
            const badge = fieldBadge(prov, f.column, value);
            return (
              <div key={f.column} className="rounded border border-white/10 px-2 py-1.5">
                <dt className="flex items-center gap-1.5 text-[11px] text-white/40">
                  {f.label}
                  {badge && <span className={`rounded-full border px-1.5 text-[10px] ${BADGE_CLASS[badge]}`}>{BADGE_TEXT[badge]}</span>}
                </dt>
                <dd className={text ? "text-white/80" : "text-white/30"}>{text || "not set yet"}</dd>
              </div>
            );
          })}
        </dl>
        {asset.ai_model && (
          <p className="mt-2 text-[11px] text-white/40">
            AI model {asset.ai_model}
            {asset.ai_described_at ? ` · ${new Date(asset.ai_described_at).toLocaleString("en-US", { timeZone: "America/Los_Angeles" })}` : ""}
          </p>
        )}
      </div>

      {/* Provenance + M5 undo for this picture */}
      <div data-testid="media-provenance" className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5 text-sm">
        <p className="font-semibold text-white">Where it came from</p>
        <dl className="mt-3 space-y-1 text-xs text-white/60">
          <div className="flex justify-between gap-2"><dt>Vendor</dt><dd className="text-right text-white/80">{asset.vendor_id ? <Link href={`/admin/vendors/${asset.vendor_id}`} className="hover:text-[var(--admin-accent)]">{vendorName ?? "Vendor card"}</Link> : "not known yet"}</dd></div>
          <div className="flex justify-between gap-2"><dt>Came from</dt><dd className="text-right text-white/80">{asset.platform ? PLATFORM_LABEL[asset.platform] ?? asset.platform : "unknown"}</dd></div>
          {asset.product_name && <div className="flex justify-between gap-2"><dt>Product on the menu</dt><dd className="text-right text-white/80">{asset.product_name}</dd></div>}
          {asset.strain_name && <div className="flex justify-between gap-2"><dt>Strain</dt><dd className="text-right text-white/80">{asset.strain_name}</dd></div>}
          {asset.category && <div className="flex justify-between gap-2"><dt>Category</dt><dd className="text-right text-white/80">{asset.category}</dd></div>}
          {asset.menu_item_ref && <div className="flex justify-between gap-2"><dt>Menu item</dt><dd className="truncate text-right text-white/80">{asset.menu_item_ref}</dd></div>}
          {asset.source_page_url && <div className="flex justify-between gap-2"><dt>Source page</dt><dd className="truncate text-right"><a href={asset.source_page_url} target="_blank" rel="noreferrer" className="text-[var(--admin-accent)] hover:underline">open ↗</a></dd></div>}
          {asset.source_url && <div className="flex justify-between gap-2"><dt>Original file</dt><dd className="truncate text-right"><a href={asset.source_url} target="_blank" rel="noreferrer" className="text-[var(--admin-accent)] hover:underline">open ↗</a></dd></div>}
          {asset.captured_at && <div className="flex justify-between gap-2"><dt>Captured</dt><dd className="text-right text-white/80">{new Date(asset.captured_at).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles" })}</dd></div>}
          {asset.credit_text && <div className="flex justify-between gap-2"><dt>Credit</dt><dd className="text-right text-white/80">{asset.credit_text}</dd></div>}
          <div className="flex justify-between gap-2"><dt>Published</dt><dd className="text-right text-white/80">{reason ? PUBLISH_REASON[reason] ?? reason : asset.status === "published" ? "Published" : "Not published"}{publishedByName ? ` · ${publishedByName}` : ""}</dd></div>
        </dl>
        {(reason === "vendor-source-auto" && asset.status === "published") || (reason === "auto-reverted" && asset.status === "draft") ? (
          <form action={autoPublishAction} className="mt-3">
            <input type="hidden" name="id" value={asset.id} />
            <input type="hidden" name="return_to" value={selfHref} />
            {reason === "vendor-source-auto" ? (
              <Button type="submit" name="mode" value="undo" variant="neutral" size="sm" data-testid="media-undo-auto-one">Undo auto-publish</Button>
            ) : (
              <Button type="submit" name="mode" value="redo" variant="neutral" size="sm">Publish again</Button>
            )}
          </form>
        ) : null}
      </div>

      {/* Duplicates */}
      {(duplicates.copies.length > 0 || duplicates.original) && (
        <div className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5 text-sm">
          <p className="font-semibold text-white">{duplicates.original ? "This is a copy" : `Same file, archived copies (${duplicates.copies.length})`}</p>
          <p className="mt-1 text-[11px] text-white/40">Copies of the exact same file are archived and point at the original. They are kept, never deleted.</p>
          <div className="mt-3 flex gap-2 overflow-x-auto">
            {duplicates.original && <Tile row={duplicates.original} href={`/admin/media/${duplicates.original.id}`} chips={["original"]} />}
            {duplicates.copies.map((r) => (
              <Tile key={r.id} row={r} href={`/admin/media/${r.id}`} />
            ))}
          </div>
        </div>
      )}

      {/* Similar pictures */}
      <div data-testid="media-similar" className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5 text-sm">
        <p className="font-semibold text-white">Similar pictures ({similar.length})</p>
        {similar.length === 0 ? (
          <p className="mt-2 text-xs text-white/40">Nothing close enough yet (same vendor, brand, strain, product name or package text).</p>
        ) : (
          <div className="mt-3 flex gap-2 overflow-x-auto">
            {similar.map((h) => {
              const r = rowsById.get(h.media_id);
              return r ? <Tile key={h.media_id} row={r} href={`/admin/media/${h.media_id}`} chips={h.reasons.map(similarReasonLabel)} /> : null;
            })}
          </div>
        )}
      </div>

      {/* Collections */}
      <div className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5 text-sm">
        <div className="flex items-baseline justify-between">
          <p className="font-semibold text-white">Collections</p>
          <Link href="/admin/media/collections" className="text-xs text-[var(--admin-accent)] hover:underline">Manage →</Link>
        </div>
        {inColls.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {inColls.map((c) => (
              <form key={c.id} action={collectionAction}>
                <input type="hidden" name="media_id" value={asset.id} />
                <input type="hidden" name="collection_id" value={c.id} />
                <input type="hidden" name="remove" value="1" />
                <input type="hidden" name="return_to" value={selfHref} />
                <button type="submit" title="Take out of this collection" className="rounded-full border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-2 py-0.5 text-xs text-[var(--admin-accent)]">
                  {c.name} ✕
                </button>
              </form>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-xs text-white/40">Not in any collection.</p>
        )}
        {outColls.length > 0 && (
          <form action={collectionAction} className="mt-3 flex items-center gap-2">
            <input type="hidden" name="media_id" value={asset.id} />
            <input type="hidden" name="return_to" value={selfHref} />
            <select name="collection_id" defaultValue="" aria-label="Collection" className="max-w-56 rounded border border-white/15 bg-black px-2 py-1 text-xs">
              <option value="">Add to a collection…</option>
              {outColls.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <Button type="submit" variant="neutral" size="sm">Add</Button>
          </form>
        )}
      </div>
    </>
  );
}
