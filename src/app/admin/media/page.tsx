import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { listMedia, countMedia, publicUrlForKey } from "@/lib/media/store";
import type { MediaAsset } from "@/lib/supabase/types";
import { uploadMediaAction } from "./actions";

export const dynamic = "force-dynamic";

const USAGE_TYPES = ["vendor-logo", "brand-logo", "hero", "banner", "product", "blog", "icon", "other"];

function isImage(mime: string | null): boolean {
  return Boolean(mime && mime.startsWith("image/"));
}

function prettyBytes(n: number | null): string {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function MediaPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; usage?: string; saved?: string; deleted?: string; error?: string }>;
}) {
  await requirePermission("media.manage");
  const { q, status, usage, saved, deleted, error } = await searchParams;

  if (!isSupabaseServiceConfigured) {
    return (
      <div>
        <AdminPageHeader title="Media Library" subtitle="Upload and manage logos, banners, and images." />
        <div className="px-5 py-6 sm:px-8">
          <div className="rounded-xl border border-[#ffd700]/30 bg-[#ffd700]/5 p-5 text-sm text-[#ffd700]">
            Supabase is not configured yet. Add the env vars from
            <code className="mx-1 rounded bg-black/40 px-1">docs/BACK_OFFICE_SETUP.md</code>.
          </div>
        </div>
      </div>
    );
  }

  const counts = await countMedia();
  const all = await listMedia({ usageType: usage, status });
  const filtered = q
    ? all.filter(
        (m) =>
          (m.title ?? "").toLowerCase().includes(q.toLowerCase()) ||
          (m.filename ?? "").toLowerCase().includes(q.toLowerCase()) ||
          (m.tags ?? []).some((t) => t.toLowerCase().includes(q.toLowerCase())),
      )
    : all;

  return (
    <div>
      <AdminPageHeader
        title="Media Library"
        subtitle="One home for every logo, banner, and image. Upload, tag, and publish — published assets serve publicly."
        breadcrumbs={<Breadcrumbs items={[{ label: "Media Library" }]} />}
        help={
          <HelpPanel
            id="media"
            title="How the media library works"
            steps={[
              "Upload images (logos, banners, product photos).",
              "Add a short tag or description so they're easy to find.",
              "Publish an image to use it on the public site.",
              "Reuse the same image anywhere — no need to upload twice.",
            ]}
          >
            <p>
              Keeping images here means you upload once and reuse everywhere.
              Before deleting an image, we&apos;ll warn you if it&apos;s in use.
            </p>
          </HelpPanel>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {saved && (
          <div className="rounded-lg border border-[#7ed957]/40 bg-[#7ed957]/10 px-4 py-2 text-sm text-[#7ed957]">
            {saved === "1" ? "Saved." : `Uploaded ${saved} file(s).`}
          </div>
        )}
        {deleted && (
          <div className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/70">Asset deleted.</div>
        )}
        {error && (
          <div className="rounded-lg border border-[#ff7f00]/40 bg-[#ff7f00]/10 px-4 py-2 text-sm text-[#ff7f00]">{error}</div>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Total assets" value={counts.total} accent="muted" />
          <StatCard label="Published" value={counts.published} accent="green" />
          <StatCard label="Drafts" value={counts.total - counts.published} accent="orange" />
        </div>

        {/* Upload */}
        <form
          action={uploadMediaAction}
          encType="multipart/form-data"
          className="space-y-4 rounded-xl border border-white/10 bg-[#0a0a0a] p-5"
        >
          <p className="text-sm font-semibold text-white">Upload media</p>
          <input
            type="file"
            name="files"
            multiple
            accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,application/pdf"
            className="block w-full text-sm text-white/70 file:mr-3 file:rounded-lg file:border-0 file:bg-[#7ed957] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-black hover:file:bg-[#6cc746]"
          />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-white/50">Usage type</span>
              <select
                name="usage_type"
                className="w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
              >
                <option value="">— none —</option>
                {USAGE_TYPES.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-white/50">Tags (comma separated)</span>
              <input
                name="tags"
                placeholder="logo, dark, square"
                className="w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-white/50">Alt text</span>
              <input
                name="alt_text"
                placeholder="Describe the image"
                className="w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-white/50">Status</span>
              <select
                name="status"
                defaultValue="draft"
                className="w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
              >
                <option value="draft">Draft (staff only)</option>
                <option value="published">Published (public)</option>
              </select>
            </label>
          </div>
          <button
            type="submit"
            className="rounded-full bg-[#7ed957] px-5 py-2 text-sm font-semibold text-black hover:bg-[#6cc746]"
          >
            Upload
          </button>
          <p className="text-xs text-white/35">PNG, JPG, WEBP, GIF, SVG, or PDF · up to 10 MB each.</p>
        </form>

        {/* Filters */}
        {counts.total > 0 && (
          <form className="flex flex-wrap items-center gap-3" method="get">
            <input
              name="q"
              defaultValue={q ?? ""}
              placeholder="Search title, filename, tags…"
              className="flex-1 min-w-48 rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
            />
            <select
              name="usage"
              defaultValue={usage ?? ""}
              className="rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
            >
              <option value="">All usage types</option>
              {USAGE_TYPES.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
            <select
              name="status"
              defaultValue={status ?? ""}
              className="rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
            >
              <option value="">All statuses</option>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="archived">Archived</option>
            </select>
            <button
              type="submit"
              className="rounded-full border border-white/15 px-4 py-2 text-sm text-white/80 hover:border-[#7ed957] hover:text-white"
            >
              Filter
            </button>
          </form>
        )}

        {/* Grid */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {filtered.map((m: MediaAsset) => {
            const url = publicUrlForKey(m.storage_key);
            return (
              <Link
                key={m.id}
                href={`/admin/media/${m.id}`}
                className="group overflow-hidden rounded-xl border border-white/10 bg-[#0a0a0a] transition hover:border-[#7ed957]/50"
              >
                <div className="relative flex aspect-square items-center justify-center bg-[checkerboard] bg-black p-2">
                  {isImage(m.mime_type) && url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={url} alt={m.alt_text ?? ""} className="h-full w-full object-contain" />
                  ) : (
                    <span className="text-4xl">{m.mime_type === "application/pdf" ? "📄" : "🗂"}</span>
                  )}
                  <span
                    className={`absolute right-1.5 top-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                      m.status === "published"
                        ? "bg-[#7ed957]/20 text-[#7ed957]"
                        : m.status === "archived"
                          ? "bg-white/10 text-white/40"
                          : "bg-[#ff7f00]/20 text-[#ff7f00]"
                    }`}
                  >
                    {m.status}
                  </span>
                </div>
                <div className="p-2">
                  <p className="truncate text-xs font-medium text-white group-hover:text-[#7ed957]">
                    {m.title || m.filename}
                  </p>
                  <p className="text-[10px] text-white/35">
                    {m.usage_type ?? "—"} · {prettyBytes(m.size_bytes)}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>

        {counts.total === 0 && (
          <div className="rounded-xl border border-white/10 bg-[#0a0a0a] p-6 text-sm text-white/60">
            No media yet. Upload logos and banners above, or they&apos;ll appear here automatically when you add vendor/brand
            logos from the Vendors editor.
          </div>
        )}
        {filtered.length === 0 && counts.total > 0 && (
          <p className="text-sm text-white/50">No assets match your filter.</p>
        )}
      </div>
    </div>
  );
}
