"use client";

/**
 * src/components/admin/books/FormPrintBar.tsx   (books-61)
 *
 * ══════════════════════════════════════════════════════════════════════════
 * GET THE FORM OFF THE SCREEN AND INTO HIS RECORDS
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Michael, twice, unprompted:
 *
 *   "I want to be able to export the form to be added to my digital records.
 *    Sage allows me to do this and it is something we will do too. We are not a
 *    filing service, I agree, but being able to see and print and export a form
 *    doesn't mean we are a filing service."
 *
 * and then:
 *
 *   "I want what the cpa needs. ... It's meant to be a part of the process for
 *    bookkeeping and taxes, not just informative."
 *
 * He is right about the boundary, and it is worth stating precisely because it
 * is the thing that decides what this file may do. TRANSMITTING a return to an
 * agency on his behalf would make us a filing service. RENDERING the return he
 * owes, on the agency's own paper, so he can read it, print it, and file the
 * copy in his own records, is what every accounting package on earth does. This
 * bar is the second half of that, and nothing in it talks to the IRS.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THIS IS `window.print()` AND NOT A PDF WRITER
 * ──────────────────────────────────────────────────────────────────────────
 * Because the browser already has a better one than I could add, and adding one
 * would cost a runtime dependency this slice is not allowed to spend.
 *
 * "Print" in every modern browser includes "Save as PDF", and that path has a
 * property a server-side PDF writer would not: WHAT HE SAVES IS PIXEL-FOR-PIXEL
 * WHAT HE WAS LOOKING AT. There is no second rendering engine that might place
 * a figure four points to the left of where the screen showed it. On a tax form
 * that difference is the difference between a document and a liability.
 *
 * It also means the artwork in the saved PDF is still the IRS's own vector
 * drawing, embedded from the file whose sha256 is recorded in the geometry -
 * not a raster of a screenshot of it.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THE BUTTON RENAMES THE DOCUMENT BEFORE IT PRINTS
 * ──────────────────────────────────────────────────────────────────────────
 * Because "digital records" is a filing cabinet, and a filing cabinet is only
 * as good as the labels on the folders.
 *
 * Every browser seeds the Save-as-PDF filename from `document.title`. Left
 * alone, ten W-2 runs saved over a year all land in his Downloads folder as
 * `Form W-2 — the form itself.pdf`, `Form W-2 — the form itself (1).pdf`, and so
 * on, and by March nobody can tell which year is which without opening all of
 * them. So the title becomes the name of the artifact for exactly as long as the
 * print dialog is open, and is put back afterwards - restored on `afterprint`
 * AND on a timer, because `afterprint` is not fired by every browser in every
 * situation and a page left with the wrong title is a bug that outlives the
 * click.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE IS FORBIDDEN TO DO
 * ──────────────────────────────────────────────────────────────────────────
 * Decide anything about the form. It does not know what a W-2 is. It is handed
 * a name and, optionally, a caution written where the evidence for that caution
 * lives, so that a claim printed next to a tax form is always traceable to the
 * artifact it came from rather than to this component's imagination.
 */

import { useCallback } from "react";
import { Button } from "@/components/admin/ui";

export type FormPrintBarProps = {
  /**
   * What is about to come out of the printer, in his words rather than the
   * route's - "Form W-2 (2025) — MICHAEL LYMAN", "Form 941 — Q2 2026".
   * Doubles as the saved PDF's filename.
   */
  readonly what: string;
  /**
   * An agency caution to show BESIDE the print button, quoted from the form
   * itself. Optional because most forms do not carry one; supplied by the route
   * because that is where the artifact's provenance is recorded.
   *
   * This exists for one real case. The IRS W-2 PDF says, in as many words, that
   * Copy A downloaded from irs.gov must NOT be printed and filed with the SSA,
   * and that "You may be charged a penalty if you file forms that can't be
   * scanned." A print button on a W-2 page that stays quiet about that is a trap
   * with a friendly label on it.
   */
  readonly caution?: string;
  /**
   * Where the same figures can be had as a spreadsheet, if the route offers it.
   *
   * A printed form is for the file and for the eye. It is useless for tying out
   * against a trial balance, which is the other half of "part of the process for
   * bookkeeping and taxes" - so where a data export exists it belongs next to
   * the paper, not on some other screen.
   */
  readonly dataHref?: string;
  /** What the data export is, e.g. "all 10 employees". */
  readonly dataLabel?: string;
};

/**
 * Make a string safe to be a filename on Windows, macOS and Linux at once.
 *
 * Windows is the strict one - `\ / : * ? " < > |` are all illegal, and it is
 * where his records live. The em dash and other typography are LEFT ALONE on
 * purpose: they are legal everywhere and stripping them would make
 * "Form W-2 (2025) — MICHAEL LYMAN" read as "Form W2 2025  MICHAEL LYMAN",
 * which is worse for a human reading a folder listing.
 */
export function printableFilename(what: string): string {
  const cleaned = what
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // A browser given an empty title falls back to the URL, which is the exact
  // unreadable filename this function exists to prevent.
  return cleaned === "" ? "Form" : cleaned;
}

export function FormPrintBar({ what, caution, dataHref, dataLabel }: FormPrintBarProps) {
  const print = useCallback(() => {
    const previous = document.title;
    let restored = false;
    const restore = () => {
      if (restored) return;
      restored = true;
      document.title = previous;
      window.removeEventListener("afterprint", restore);
    };

    window.addEventListener("afterprint", restore);
    document.title = printableFilename(what);
    window.print();

    // Belt and braces. Chromium fires `afterprint` when the dialog closes, but
    // it is not fired everywhere, and a page whose title is stuck on a filename
    // is a bug that outlives the click that caused it.
    window.setTimeout(restore, 1000);
  }, [what]);

  return (
    <div
      data-testid="form-print-bar"
      className="admin-chrome mx-auto mt-4 flex w-full max-w-[900px] flex-wrap items-center gap-3 px-4 print:hidden"
    >
      <Button type="button" size="sm" onClick={print} data-testid="form-print-button">
        &#128424; Print / save as PDF
      </Button>

      {dataHref !== undefined ? (
        /*
         * A plain anchor, not a <Link>. This is a file download, and Next's
         * client router would try to render the response as a page.
         */
        <a
          href={dataHref}
          data-testid="form-data-export"
          className="rounded-full border border-white/20 px-3.5 py-1.5 text-[0.7rem] font-black uppercase tracking-[0.1em] text-white/70 hover:bg-white/10"
        >
          &#11015; Figures as a spreadsheet{dataLabel === undefined ? "" : ` (${dataLabel})`}
        </a>
      ) : null}

      <p className="text-[11px] leading-snug text-white/40">
        Prints <span className="text-white/70">{what}</span> at actual size on Letter paper,
        with the highlighting and the lesson overlay left off &mdash; so what comes out is the
        form, not a screenshot of an app.
      </p>

      {caution !== undefined ? (
        <p
          data-testid="form-print-caution"
          className="w-full rounded-md border border-[var(--admin-gold)]/40 bg-[var(--admin-gold)]/10 p-2.5 text-[11px] leading-snug text-white/75"
        >
          {caution}
        </p>
      ) : null}
    </div>
  );
}
