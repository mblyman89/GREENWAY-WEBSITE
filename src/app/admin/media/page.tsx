import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { listMedia, countMedia, publicUrlForKey } from "@/lib/media/store";
import type { MediaAsset } from "@/lib/supabase/types";
import { MediaDropzone } from "@/components/admin/media/MediaDropzone";
import { MEDIA_PURPOSES, purposeLabel } from "@/lib/media/taxonomy";
import { uploadMediaAction } from "./actions";
import { Button } from "@/components/admin/ui/Button";
import { Input, Select } from "@/components/admin/ui/Field";
import { EmptyState } from "@/components/admin/ux";

export const dynamic = "force-dynamic";

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
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] p-5 text-sm text-[var(--admin-gold)]">
            The database isn&apos;t fully set up yet. Once your administrator
            finishes the one-time setup, your media library will appear here.
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
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]">
            {saved === "1" ? "Saved." : `Uploaded ${saved} file(s).`}
          </div>
        )}
        {deleted && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border-strong)] bg-white/5 px-4 py-2 text-sm text-[var(--admin-text-muted)]">Asset deleted.</div>
        )}
        {error && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-orange)]/40 bg-[var(--admin-orange-soft)] px-4 py-2 text-sm text-[var(--admin-orange)]">{error}</div>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Total assets" value={counts.total} accent="muted" />
          <StatCard label="Published" value={counts.published} accent="green" />
          <StatCard label="Drafts" value={counts.total - counts.published} accent="orange" />
        </div>

        {/* Upload (drag & drop) */}
        <MediaDropzone uploadAction={uploadMediaAction} />

        {/* Filters */}
        {counts.total > 0 && (
          <form className="flex flex-wrap items-center gap-3" method="get">
            <Input
              name="q"
              defaultValue={q ?? ""}
              placeholder="Search title, filename, tags…"
              className="min-w-48 flex-1"
            />
            <Select name="usage" defaultValue={usage ?? ""} className="w-auto">
              <option value="">All purposes</option>
              {MEDIA_PURPOSES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
            <Select name="status" defaultValue={status ?? ""} className="w-auto">
              <option value="">All statuses</option>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="archived">Archived</option>
            </Select>
            <Button type="submit" variant="subtle">
              Filter
            </Button>
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
                className="group admin-card-interactive overflow-hidden rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)]"
              >
                <div className="relative flex aspect-square items-center justify-center bg-black p-2">
                  {isImage(m.mime_type) && url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={url} alt={m.alt_text ?? ""} className="h-full w-full object-contain" />
                  ) : (
                    <span className="text-4xl">{m.mime_type === "application/pdf" ? "📄" : "🗂"}</span>
                  )}
                  <span
                    className={`absolute right-1.5 top-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                      m.status === "published"
                        ? "bg-[var(--admin-accent)]/20 text-[var(--admin-accent)]"
                        : m.status === "archived"
                          ? "bg-white/10 text-[var(--admin-text-faint)]"
                          : "bg-[var(--admin-orange)]/20 text-[var(--admin-orange)]"
                    }`}
                  >
                    {m.status}
                  </span>
                  {/* Pixel dimensions — so staff can tell the AI the exact size to make */}
                  {m.width && m.height ? (
                    <span className="absolute bottom-1.5 left-1.5 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[var(--admin-text)] backdrop-blur">
                      {m.width}×{m.height}
                    </span>
                  ) : null}
                </div>
                <div className="p-2">
                  <p className="truncate text-xs font-medium text-[var(--admin-text)] group-hover:text-[var(--admin-accent)]">
                    {m.title || m.filename}
                  </p>
                  <p className="text-[10px] text-[var(--admin-text-faint)]">
                    {purposeLabel(m.usage_type)} · {prettyBytes(m.size_bytes)}
                    {m.width && m.height ? ` · ${m.width}×${m.height}px` : ""}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>

        {counts.total === 0 && (
          <EmptyState
            icon="🖼️"
            title="No media yet"
            description="Upload logos and banners above. Vendor and brand logos you add from the Vendors editor will also show up here automatically."
          />
        )}
        {filtered.length === 0 && counts.total > 0 && (
          <p className="text-sm text-[var(--admin-text-muted)]">No assets match your filter.</p>
        )}
      </div>
    </div>
  );
}
