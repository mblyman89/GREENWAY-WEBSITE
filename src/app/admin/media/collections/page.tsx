/**
 * /admin/media/collections   (D221 M7)
 *
 * Curated media sets and brand kits. Create one here, then fill it from the
 * library's Select → "Add to collection" or from a picture's own page. Open a
 * collection = the library filtered to it (?coll=). Archive, never delete.
 */
import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, EmptyState } from "@/components/admin/ux";
import { Button } from "@/components/admin/ui/Button";
import { Input, Select } from "@/components/admin/ui/Field";
import { loadCollections, loadVendorNames } from "@/lib/media/library-v2-server";
import { createCollectionAction, archiveCollectionAction } from "../library-actions";

export const dynamic = "force-dynamic";

export default async function MediaCollectionsPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string; archived?: string }> }) {
  await requirePermission("media.manage");
  const { saved, error, archived } = await searchParams;
  const showArchived = archived === "1";
  const [read, vendors] = await Promise.all([loadCollections({ includeArchived: showArchived }), loadVendorNames()]);
  const selfHref = `/admin/media/collections${showArchived ? "?archived=1" : ""}`;
  const vendorList = [...vendors.names.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div>
      <AdminPageHeader
        title="Media collections"
        subtitle="Curated sets and brand kits. Fill them from the library (Select → Add to collection) or from a picture's page."
        breadcrumbs={<Breadcrumbs items={[{ label: "Digital Assets", href: "/admin/media" }, { label: "Collections" }]} />}
        action={
          <Link href="/admin/media" className="rounded-full border border-white/15 px-4 py-2 text-sm text-white/80 hover:border-[var(--admin-accent)] hover:text-white">
            ← Back to media library
          </Link>
        }
      />
      <div className="space-y-4 px-5 py-6 sm:px-8">
        {saved && <div className="rounded-[var(--admin-radius)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] px-4 py-2 text-sm text-[var(--admin-accent)]">Saved.</div>}
        {(error || read.error || vendors.error) && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-orange)]/40 bg-[var(--admin-orange-soft)] px-4 py-2 text-sm text-[var(--admin-orange)]">{error || read.error || vendors.error}</div>
        )}
        {read.missing && (
          <div className="rounded-[var(--admin-radius)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] px-4 py-2 text-sm text-[var(--admin-gold)]">
            Collections need the 0354 database update (docs/MIGRATIONS_TO_RUN.md). Apply it in Supabase, then refresh this page.
          </div>
        )}

        <form action={createCollectionAction} className="flex flex-wrap items-end gap-2 rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4 text-sm">
          <input type="hidden" name="return_to" value={selfHref} />
          <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-[var(--admin-text-muted)]">
            Name
            <Input name="name" required maxLength={120} placeholder="e.g. Holiday banners, Fairwinds brand kit" />
          </label>
          <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-[var(--admin-text-muted)]">
            Note (optional)
            <Input name="description" maxLength={500} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--admin-text-muted)]">
            Kind
            <Select name="kind" defaultValue="collection" className="w-auto">
              <option value="collection">Collection</option>
              <option value="brand-kit">Brand kit</option>
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--admin-text-muted)]">
            Vendor (optional)
            <Select name="vendor_id" defaultValue="" className="w-auto max-w-56">
              <option value="">None</option>
              {vendorList.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </Select>
          </label>
          <Button type="submit" variant="confirm">Create</Button>
        </form>

        <div className="flex gap-2 text-sm">
          <Link href="/admin/media/collections" className={!showArchived ? "font-semibold text-[var(--admin-text)]" : "text-[var(--admin-text-muted)] hover:text-[var(--admin-accent)]"}>Live</Link>
          <span className="text-[var(--admin-text-faint)]">·</span>
          <Link href="/admin/media/collections?archived=1" className={showArchived ? "font-semibold text-[var(--admin-text)]" : "text-[var(--admin-text-muted)] hover:text-[var(--admin-accent)]"}>Include archived</Link>
        </div>

        {read.collections.length === 0 && !read.missing && <EmptyState icon="🗂️" title="No collections yet" description="Create one above." />}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {read.collections.map((c) => (
            <div key={c.id} className="space-y-2 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-3 text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <Link href={`/admin/media?coll=${c.id}`} className="font-semibold text-[var(--admin-text)] hover:text-[var(--admin-accent)]">
                  {c.kind === "brand-kit" ? "🎨 " : "🗂️ "}{c.name}
                </Link>
                <span className="text-xs text-[var(--admin-text-faint)]">{c.items} picture(s)</span>
              </div>
              {c.description && <p className="text-xs text-[var(--admin-text-muted)]">{c.description}</p>}
              {c.vendor_id && <p className="text-xs text-[var(--admin-text-faint)]">Vendor: {vendors.names.get(c.vendor_id.toLowerCase()) ?? "Unknown vendor card"}</p>}
              <div className="flex items-center gap-2">
                <Link href={`/admin/media?coll=${c.id}`} className="text-xs font-semibold text-[var(--admin-accent)] hover:underline">Open in library →</Link>
                <form action={archiveCollectionAction} className="ml-auto">
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="return_to" value={selfHref} />
                  {c.archived_at ? (
                    <Button type="submit" name="restore" value="1" variant="neutral" size="sm">Restore</Button>
                  ) : (
                    <Button type="submit" variant="neutral" size="sm">Archive</Button>
                  )}
                </form>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
