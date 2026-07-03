import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs } from "@/components/admin/ux";
import { getKbCounts, listKbNotes } from "@/lib/ai/kb/store";
import { NotesManager } from "../NotesManager";
import { KbFlash } from "../KbFlash";

export const dynamic = "force-dynamic";

export default async function KbNotesPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; error?: string }>;
}) {
  await requirePermission("products.enrich");
  const { msg, error } = await searchParams;

  const [counts, notes] = await Promise.all([getKbCounts(), listKbNotes(500)]);

  return (
    <div>
      <AdminPageHeader
        title="Reference notes"
        subtitle="Your own facts and house knowledge the AI should treat as authoritative"
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: "Knowledge Base", href: "/admin/knowledge-base" },
              { label: "Notes" },
            ]}
          />
        }
      />
      <div className="px-5 py-6 sm:px-8 space-y-6">
        <KbFlash msg={msg} error={error} />
        <section className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
          <h2 className="mb-3 text-base font-semibold text-[var(--admin-text)]">
            Your reference notes ({counts.notes})
          </h2>
          <NotesManager notes={notes} migrated={counts.notesMigrated} />
        </section>
      </div>
    </div>
  );
}
