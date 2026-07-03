import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { Button } from "@/components/admin/ui/Button";
import { getKbCounts } from "@/lib/ai/kb/store";
import { seedKbAction } from "../actions";
import { KbFlash } from "../KbFlash";

export const dynamic = "force-dynamic";

export default async function KbSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; error?: string }>;
}) {
  await requirePermission("products.enrich");
  const { msg, error } = await searchParams;
  const counts = await getKbCounts();

  return (
    <div>
      <AdminPageHeader
        title="Setup & starter data"
        subtitle="Load a curated baseline of strains, terpenes, and category vocabulary"
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Knowledge Base", href: "/admin/knowledge-base" },
              { label: "Setup" },
            ]}
          />
        }
      />
      <div className="px-5 py-6 sm:px-8 space-y-6">
        <KbFlash msg={msg} error={error} />

        {!counts.migrated ? (
          <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-orange)]/40 bg-[var(--admin-orange-soft)] px-4 py-4 text-sm text-[var(--admin-text)]">
            <p className="font-medium">The knowledge base isn&apos;t fully set up yet.</p>
            <p className="mt-1 text-[var(--admin-text-muted)]">
              Once your administrator finishes the one-time database setup, this page will let you seed
              and manage the AI&apos;s reference facts.
            </p>
          </div>
        ) : null}

        <section className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <h2 className="text-base font-semibold text-[var(--admin-text)]">Expert starter set</h2>
          <p className="mt-1 text-sm text-[var(--admin-text-muted)]">
            Loads a curated baseline of common strains, the terpene aroma/flavor map, and per-category
            vocabulary. It&apos;s safe to run more than once — it refreshes the starter rows and leaves
            anything you&apos;ve added untouched.
          </p>
          <form action={seedKbAction} className="mt-4">
            <Button type="submit" variant="primary" disabled={!counts.migrated}>
              Seed expert starter set
            </Button>
          </form>
        </section>
      </div>
    </div>
  );
}
