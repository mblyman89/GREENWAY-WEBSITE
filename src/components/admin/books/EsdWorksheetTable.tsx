/**
 * src/components/admin/books/EsdWorksheetTable.tsx   (slice books-64)
 *
 * The 5208A worksheet as Michael reads it: his figure beside the LINE NUMBER
 * and CAPTION printed on the return he actually files.
 *
 * WHY THIS IS A COMPONENT AND NOT MARKUP INSIDE THE PAGE.
 *
 * The visual check cannot drive the real route in this sandbox -- there is no
 * `.env`, so `next dev` serves the access gate. The only honest way to
 * photograph this table is to render it directly. Had the markup stayed inline
 * in page.tsx, the harness would have needed a COPY of it, and a copy is a
 * second thing that can drift: the photograph would then prove a layout the
 * owner never sees. One component, rendered by both, is rule 25 -- extend,
 * never duplicate.
 *
 * It is deliberately a pure function of `worksheet`. It fetches nothing and
 * decides nothing. Every figure, caption, line number and the notice itself
 * arrive already built by `esd-5208-worksheet-core`, which is where the
 * arithmetic is gated.
 */
import { Badge } from "@/components/admin/ui";
import type { EsdWorksheet } from "@/lib/payroll/esd-5208-worksheet-core";

export function EsdWorksheetTable({ worksheet }: { worksheet: EsdWorksheet }) {
  return (
    <div>
      {/*
       * THE NOTICE GOES FIRST, AND IT IS NOT SUBTLE.
       *
       * It is rendered from `worksheet.notAFilingCopyNotice` rather than typed
       * here, because the core ASSERTS the notice onto every worksheet it
       * builds. A future screen that renders this component therefore cannot
       * show the figures without the sentence -- which is the failure mode this
       * arrangement exists to prevent: a screen that looks like a 5208A with no
       * statement that it is not one.
       */}
      <div className="mb-4 rounded-[var(--admin-radius-sm)] border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] p-4">
        <p className="text-sm text-[var(--admin-text)]">{worksheet.notAFilingCopyNotice}</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
              <th className="pb-2 pr-3">Line</th>
              <th className="pb-2">As printed on the return</th>
              <th className="pb-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {worksheet.lines.map((l) => (
              <tr
                key={l.lineNumber}
                className={`border-t border-white/8 ${
                  l.isTotal ? "bg-[var(--admin-gold-soft)]" : ""
                }`}
              >
                <td className="py-3 pr-3 align-top font-mono text-base text-[var(--admin-text-dim)]">
                  {l.lineNumber}
                </td>
                <td className="py-3 align-top">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-[var(--admin-text)]">{l.caption}</span>
                    {l.provenance === "computed_not_on_filed_form" ? (
                      <Badge tone="outline">not a line on the filed form</Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--admin-text-muted)]">
                    {l.explanation}
                  </p>
                </td>
                <td className="py-3 align-top text-right font-mono text-lg text-[var(--admin-text)]">
                  {l.amount}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/*
       * LINE 24 IS DELIBERATELY ABSENT, AND SAYING SO IS THE POINT.
       *
       * The filed return computes AMOUNT DUE at line 24 by adding lines 19, 20,
       * 21, 22 and 23 -- penalty, interest and any prior balance among them.
       * This system computes none of those, so printing a figure at 24 would
       * assert that Greenway owes no penalty and no interest, which is not
       * something we know. An unexplained gap in a numbered sequence reads as a
       * bug, so the gap is explained rather than left to be noticed.
       */}
      <p className="mt-4 text-xs leading-relaxed text-[var(--admin-text-muted)]">
        This worksheet stops at line 19, TOTAL TAX DUE. The return&rsquo;s line 24, AMOUNT DUE,
        adds penalty, interest and any prior balance to it, and this system computes none of those
        &mdash; so leaving 24 blank is a statement that we do not know it, rather than a claim that
        it is zero. EAMS works it out from your account.
      </p>
    </div>
  );
}
