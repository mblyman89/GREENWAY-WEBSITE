import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { listMedia, countMedia, publicUrlForKey } from "@/lib/media/store";
import type { MediaAsset } from "@/lib/supabase/types";
import { MediaDropzone } from "@/components/admin/media/MediaDropzone";
import { MEDIA_PURPOSES } from "@/lib/media/taxonomy";
import { pickListParams, withListParams } from "@/lib/media/return-state-core";
import { uploadMediaAction, bulkDeleteMediaAction } from "./actions";
import { Button } from "@/components/admin/ui/Button";
import { Input, Select } from "@/components/admin/ui/Field";
import { EmptyState } from "@/components/admin/ux";
import { MediaGrid } from "@/components/admin/media/MediaGrid";

export const dynamic = "force-dynamic";

export default async function MediaPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; usage?: string; saved?: string; deleted?: string; note?: string; error?: string }>;
}) {
  await requirePermission("media.manage");
  const { q, status, usage, saved, deleted, note, error } = await searchParams;
  // H12d: the active filters travel with every grid link so the detail page
  // can send the owner back to this exact filtered view.
  const listParams = pickListParams({ q, status, usage });

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
        action={
          <Link href="/admin/marketing/midjourney">
            <Button variant="neutral">🎨 Midjourney prompt builder</Button>
          </Link>
        }
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
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border-strong)] bg-white/5 px-4 py-2 text-sm text-[var(--admin-text-muted)]">
            {note && note.trim() ? note : "Asset deleted."}
          </div>
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
            <Button type="submit" variant="neutral">
              Filter
            </Button>
          </form>
        )}

        {/* Grid — with multi-select bulk delete (Task B). Cards carry the
            active filters into the detail URL so the detail page's back link +
            breadcrumb can return to this exact filtered view (H13a). */}
        {filtered.length > 0 && (
          <MediaGrid
            returnTo={withListParams("/admin/media", listParams)}
            bulkDeleteAction={bulkDeleteMediaAction}
            items={filtered.map((m: MediaAsset) => ({
              asset: m,
              url: publicUrlForKey(m.storage_key),
              href: withListParams(`/admin/media/${m.id}`, listParams),
            }))}
          />
        )}

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
