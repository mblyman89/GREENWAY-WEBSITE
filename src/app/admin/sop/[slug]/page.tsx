import { BackLink } from "@/components/admin/ux";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth/session";
import { findSopDoc, SOP_BASE_PATH, SOP_DOCS } from "@/lib/catalog/sop-core";
import { PrintButton } from "@/components/admin/orders/PrintButton";

export const dynamic = "force-dynamic";

/**
 * W13 — one printable SOP sheet (audit G11).
 *
 * House print pattern (same as the order pick-ticket and lot labels):
 *  - a per-route <style> block sets @page to letter with normal margins;
 *  - the global print CSS (globals.css) already strips all admin chrome and
 *    forces black-on-white;
 *  - on-screen controls carry `print:hidden` so paper shows only the sheet;
 *  - PrintButton is the existing generic window.print() client component.
 *
 * Content comes from sop-core (PURE) — the same verified workflows the
 * on-page HelpPanels teach.
 */
export default async function SopSheetPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ back?: string }>;
}) {
  await requireStaff();
  const { slug } = await params;
  const { back } = await searchParams;

  const doc = findSopDoc(slug);
  if (!doc) notFound();

  const packIndex = SOP_DOCS.findIndex((d) => d.slug === doc.slug);

  return (
    <div className="sop-sheet mx-auto max-w-2xl bg-white px-8 py-8 text-black print:max-w-none">
      {/* Letter-size page for a wall-ready one-pager. */}
      <style>{`
        @page { size: letter; margin: 0.5in; }
        @media print {
          .sop-sheet { margin: 0 !important; max-width: 100% !important; box-shadow: none !important; }
          .sop-sheet li { page-break-inside: avoid; }
        }
      `}</style>

      {/* On-screen navigation — never printed. */}
      <div className="mb-4 flex items-center justify-between print:hidden">
        <BackLink fallback={SOP_BASE_PATH} back={back} className="text-xs font-bold uppercase tracking-[0.1em] text-black/60 hover:text-black">
          ← All SOPs
        </BackLink>
        <PrintButton />
      </div>

      {/* Header */}
      <div className="border-b-2 border-black pb-3">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-black/60">
          Greenway Marijuana · Standard Operating Procedure · Sheet {packIndex + 1} of {SOP_DOCS.length}
        </p>
        <h1 className="mt-1 text-2xl font-black leading-tight tracking-tight">{doc.title}</h1>
        <p className="mt-2 text-sm leading-relaxed">{doc.purpose}</p>
        <p className="mt-1 text-xs text-black/60">
          Where: <span className="font-bold">{doc.where}</span> in the back office
        </p>
      </div>

      {/* Before you start */}
      <div className="mt-4">
        <h2 className="text-xs font-black uppercase tracking-[0.2em]">Before you start</h2>
        <ul className="mt-2 space-y-1.5 text-sm leading-snug">
          {doc.before.map((item, i) => (
            <li key={i} className="flex gap-2">
              <span className="font-black">□</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Steps */}
      <div className="mt-4">
        <h2 className="text-xs font-black uppercase tracking-[0.2em]">Steps</h2>
        <ol className="mt-2 space-y-2 text-sm leading-snug">
          {doc.steps.map((step, i) => (
            <li key={i} className="flex gap-3">
              <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-black text-xs font-black">
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </div>

      {/* Done when — boxed so it can't be missed. */}
      <div className="mt-4 border-2 border-black p-3">
        <h2 className="text-xs font-black uppercase tracking-[0.2em]">You&apos;re done when</h2>
        <p className="mt-1 text-sm font-bold leading-snug">{doc.doneWhen}</p>
      </div>

      {/* If you get stuck */}
      <div className="mt-4">
        <h2 className="text-xs font-black uppercase tracking-[0.2em]">If you get stuck</h2>
        <ul className="mt-2 space-y-1.5 text-sm leading-snug">
          {doc.ifStuck.map((item, i) => (
            <li key={i} className="flex gap-2">
              <span className="font-black">→</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Footer */}
      <p className="mt-6 border-t border-black/30 pt-2 text-[0.65rem] leading-4 text-black/60">
        This sheet restates the same steps the page&apos;s on-screen help panel teaches — if they ever
        disagree, the screen is newer: reprint this sheet from Dashboard → Printable SOPs.
      </p>
    </div>
  );
}
