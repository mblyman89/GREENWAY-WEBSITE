import Link from "next/link";
import { requireStaff } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { BackLink, HelpPanel } from "@/components/admin/ux";
import {
  SOP_DOCS,
  TRUCK_DAY_SLUG,
  sopHref,
} from "@/lib/catalog/sop-core";

export const dynamic = "force-dynamic";

/**
 * W13 — the printable SOP pack index (audit G11).
 *
 * One card per sheet: the "truck day" master SOP a new hire follows on day
 * one, plus a one-page SOP for each stage of the Product Intake journey.
 * Every sheet opens as a print-ready page (black-on-white, letter size) with
 * a Print button. Content is derived from sop-core, which restates the same
 * verified workflows the on-page HelpPanels teach — paper and screen never
 * disagree.
 */
export default async function SopPackPage({
  searchParams,
}: {
  searchParams: Promise<{ back?: string }>;
}) {
  const { back } = await searchParams;
  await requireStaff();

  const master = SOP_DOCS.find((d) => d.slug === TRUCK_DAY_SLUG)!;
  const stageDocs = SOP_DOCS.filter((d) => d.stageKey !== null);

  return (
    <div>
      <AdminPageHeader
        title="Printable SOPs"
        subtitle="One-page standard operating procedures for every stage of the product journey — print them and put them on the wall."
        action={
          <BackLink fallback="/admin" back={back} className="text-sm text-white/60 hover:text-white">
            ← Dashboard
          </BackLink>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        <HelpPanel
          id="sop-pack"
          title="How the SOP pack works"
          steps={[
            "Open a sheet below — each is a one-page procedure in plain language.",
            "Click Print (or Ctrl/Cmd+P). The sheet prints black-on-white on letter paper.",
            "Give the 'Truck day' master sheet to every new hire — it walks the whole journey from delivery to sellable.",
            "These sheets restate the same steps each page's help panel teaches, so paper and screen always agree.",
          ]}
        />

        {/* Master SOP — the day-one sheet, visually promoted. */}
        <Link
          href={sopHref(master.slug)}
          className="block rounded-xl border border-[#7ed957]/40 bg-[#7ed957]/[0.06] p-5 transition hover:border-[#7ed957]/70"
        >
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#7ed957]">
            Master SOP · give this to every new hire
          </p>
          <p className="mt-1 text-lg font-semibold text-white">{master.title}</p>
          <p className="mt-1 text-sm text-white/60">{master.purpose}</p>
        </Link>

        {/* One card per journey stage, in canonical order. */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stageDocs.map((doc, i) => (
            <Link
              key={doc.slug}
              href={sopHref(doc.slug)}
              className="block rounded-xl border border-white/10 bg-white/[0.03] p-4 transition hover:border-[#7ed957]/50"
            >
              <p className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-white/40">
                Stage {i + 1} of {stageDocs.length}
              </p>
              <p className="mt-1 text-sm font-semibold text-white">
                {doc.title.replace(/^SOP — /, "")}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-white/55">{doc.purpose}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
