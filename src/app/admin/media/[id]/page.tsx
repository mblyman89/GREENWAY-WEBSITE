import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { getMedia, whereUsed, publicUrlForKey } from "@/lib/media/store";
import { isAiConfigured } from "@/lib/ai/provider";
import { MediaAltField } from "@/components/admin/media/MediaAltField";
import { updateMediaMetaAction, setMediaStatusAction, deleteMediaAction } from "../actions";

export const dynamic = "force-dynamic";

const field =
  "w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]";
const label = "mb-1 block text-xs font-medium text-white/50";

function isImage(mime: string | null): boolean {
  return Boolean(mime && mime.startsWith("image/"));
}

function prettyBytes(n: number | null): string {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function MediaDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  await requirePermission("media.manage");
  const { id } = await params;
  const { saved, error } = await searchParams;

  const asset = await getMedia(id);
  if (!asset) notFound();

  const url = publicUrlForKey(asset.storage_key);
  const usages = await whereUsed(id);
  const inUse = usages.length > 0;

  return (
    <div>
      <AdminPageHeader
        title={asset.title || asset.filename}
        subtitle="Edit metadata, control visibility, and review where this asset is used."
        action={
          <Link
            href="/admin/media"
            className="rounded-full border border-white/15 px-4 py-2 text-sm text-white/80 hover:border-[#7ed957] hover:text-white"
          >
            ← Back to library
          </Link>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {saved && (
          <div className="rounded-lg border border-[#7ed957]/40 bg-[#7ed957]/10 px-4 py-2 text-sm text-[#7ed957]">Saved.</div>
        )}
        {error && (
          <div className="rounded-lg border border-[#ff7f00]/40 bg-[#ff7f00]/10 px-4 py-2 text-sm text-[#ff7f00]">{error}</div>
        )}

        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          {/* Preview + status */}
          <div className="space-y-4">
            <div className="flex aspect-square items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-black p-3">
              {isImage(asset.mime_type) && url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={url} alt={asset.alt_text ?? ""} className="h-full w-full object-contain" />
              ) : (
                <span className="text-6xl">{asset.mime_type === "application/pdf" ? "📄" : "🗂"}</span>
              )}
            </div>

            <dl className="space-y-1 rounded-xl border border-white/10 bg-[#0a0a0a] p-4 text-xs text-white/60">
              <div className="flex justify-between"><dt>Filename</dt><dd className="truncate pl-2 text-white/80">{asset.filename}</dd></div>
              <div className="flex justify-between"><dt>Type</dt><dd className="text-white/80">{asset.mime_type ?? "—"}</dd></div>
              <div className="flex justify-between"><dt>Size</dt><dd className="text-white/80">{prettyBytes(asset.size_bytes)}</dd></div>
              <div className="flex justify-between"><dt>Status</dt><dd className="font-semibold text-white/80">{asset.status}</dd></div>
              {url && (
                <div className="pt-2">
                  <a href={url} target="_blank" rel="noreferrer" className="text-[#7ed957] hover:underline">Open public URL ↗</a>
                </div>
              )}
            </dl>

            {/* Status controls */}
            <form action={setMediaStatusAction} className="flex flex-wrap gap-2 rounded-xl border border-white/10 bg-[#0a0a0a] p-4">
              <input type="hidden" name="id" value={asset.id} />
              <input type="hidden" name="returnTo" value={`/admin/media/${asset.id}`} />
              <span className="w-full text-xs font-medium text-white/50">Visibility</span>
              <button name="status" value="published" className="rounded-full bg-[#7ed957] px-3 py-1.5 text-xs font-semibold text-black hover:bg-[#6cc746]">Publish</button>
              <button name="status" value="draft" className="rounded-full border border-white/20 px-3 py-1.5 text-xs font-semibold text-white/80 hover:border-white/40">Draft</button>
              <button name="status" value="archived" className="rounded-full border border-white/20 px-3 py-1.5 text-xs font-semibold text-white/50 hover:border-white/40">Archive</button>
            </form>
          </div>

          {/* Metadata form */}
          <div className="space-y-6">
            <form action={updateMediaMetaAction} className="space-y-4 rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
              <input type="hidden" name="id" value={asset.id} />
              <p className="text-sm font-semibold text-white">Metadata</p>
              <label className="block">
                <span className={label}>Title</span>
                <input name="title" defaultValue={asset.title ?? ""} className={field} />
              </label>
              <MediaAltField
                id={asset.id}
                initial={asset.alt_text ?? ""}
                aiEnabled={isAiConfigured}
                fieldClassName={field}
                labelClassName={label}
              />
              <label className="block">
                <span className={label}>Description</span>
                <textarea name="description" defaultValue={asset.description ?? ""} rows={3} className={field} />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className={label}>Usage type</span>
                  <input name="usage_type" defaultValue={asset.usage_type ?? ""} placeholder="vendor-logo, hero…" className={field} />
                </label>
                <label className="block">
                  <span className={label}>Tags (comma separated)</span>
                  <input name="tags" defaultValue={(asset.tags ?? []).join(", ")} className={field} />
                </label>
              </div>
              <button type="submit" className="rounded-full bg-[#7ed957] px-5 py-2 text-sm font-semibold text-black hover:bg-[#6cc746]">
                Save metadata
              </button>
            </form>

            {/* Where used */}
            <div className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5">
              <p className="text-sm font-semibold text-white">Where used</p>
              {inUse ? (
                <ul className="mt-3 space-y-1.5 text-sm text-white/70">
                  {usages.map((u, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase text-white/60">{u.entity_type}</span>
                      <span className="text-white/50">{u.field_key ?? "—"}</span>
                      {u.entity_type === "vendor" && (
                        <Link href={`/admin/vendors/${u.entity_id}`} className="text-[#7ed957] hover:underline">view vendor →</Link>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-white/40">Not used anywhere yet — safe to delete.</p>
              )}
            </div>

            {/* Delete */}
            <form action={deleteMediaAction} className="rounded-xl border border-[#ff7f00]/20 bg-[#ff7f00]/5 p-5">
              <input type="hidden" name="id" value={asset.id} />
              <p className="text-sm font-semibold text-[#ff7f00]">Danger zone</p>
              <p className="mt-1 text-xs text-white/50">
                {inUse
                  ? "This asset is in use and cannot be deleted. Replace it on the linked entity first."
                  : "Permanently remove this asset and its file. This cannot be undone."}
              </p>
              <button
                type="submit"
                disabled={inUse}
                className="mt-3 rounded-full border border-[#ff7f00]/50 px-4 py-2 text-sm font-semibold text-[#ff7f00] hover:bg-[#ff7f00]/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Delete asset
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
