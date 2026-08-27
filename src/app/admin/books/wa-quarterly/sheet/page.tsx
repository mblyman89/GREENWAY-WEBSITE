/**
 * src/app/admin/books/wa-quarterly/sheet/page.tsx   (books-65)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE WASHINGTON RETURNS ON ONE PAGE — THE FORM MICHAEL COULD NOT FIND
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Michael, books-65:
 *
 *   "i can not figure out how to open and view the state forms. did they get
 *    wired in correctly?"
 *
 * He was right, and the answer is more specific than "no". MEASURED, before
 * anything was written:
 *
 *   - "WA Quarterly Returns" IS in the menu (admin-nav-data.ts, gated
 *     books.view), so the tabbed screen was always reachable.
 *   - `find src/app/admin/books/form-*` shows 941, 940 and W-2 each have a
 *     `sheet/page.tsx` — the "as it prints" view reached by a link on the
 *     tabbed screen.
 *   - `wa-quarterly` had NO `sheet` route at all.
 *
 * So there was no state form to open. Every federal form had a paper view and
 * a door to it; the Washington ones had neither. This file is that door.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT A FACSIMILE, AND WHY THAT IS A FINDING RATHER THAN A CORNER CUT
 * ───────────────────────────────────────────────────────────────────────────
 * The federal sheets show the agency's own vector artwork with figures placed
 * into the agency's own rectangles. That is possible because every IRS fillable
 * PDF carries a `/Widget` annotation per input with an exact `/Rect` — 116 of
 * them on the 941. The positions are the IRS's answer, not a guess.
 *
 * The ESD forms cannot be done that way. Measured with pypdf on the files in
 * `public/forms/esd/`:
 *
 *     esd5208a.pdf  pages 1  fields 0   /Annots 0   (AcroForm present, /Fields [])
 *     esd5208b.pdf  pages 1  fields 0   /Annots 0   (no AcroForm at all)
 *
 * Zero rectangles. There is no agency answer to "where does line 17 sit", so
 * placing figures on that artwork would mean measuring the paper by eye and
 * typing coordinates — which is guessing, at the exact spot where a mistake
 * puts the UI tax on the EAF line and looks perfectly correct while doing it.
 *
 * And there is a second, worse problem. `pdftotext -layout` on that same file
 * prints "12) TOTAL GROSS WAGES", "13) EXCESS WAGES", "14) TAXABLE WAGES", and
 * "Enter total wages paid during this quarter in excess of $37,300 per
 * employee". That is the 2011 draft (its own title is
 * "5208A-final-draft-4-2011"). D-13 established from Michael's ACTUAL filed
 * returns that today's form numbers those lines 13, 14 and 16, and the wage
 * base is $78,200 for 2026, not $37,300. Rendering his 2026 figures onto 2011
 * artwork would produce a document that is wrong in its line numbers, wrong in
 * its threshold, and utterly convincing.
 *
 * So this page shows the SAME boxes, the SAME lessons and the SAME figures as
 * the federal sheets, using `FormSheet` — which needs no geometry — and says
 * plainly why the paper is not underneath them. Rule 62d: never invent a rule,
 * or a rectangle, the agency did not write.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * READ-ONLY, ON PURPOSE
 * ───────────────────────────────────────────────────────────────────────────
 * Michael, same message:
 *
 *   "Sage lets me fill the form in on the page, but i dont want that method.
 *    the form should only have numbers on it based on records from the books,
 *    not something i snuck in last minute by erasing one and replacing another.
 *    if a correction is to be made, it needs to be a correcting journal entry
 *    with the proper audit trail."
 *
 * There is not one input on this page and there is no server action behind it.
 * Every figure arrives from `waBoxes(result, form)`, which translates a built
 * quarter and computes nothing of its own.
 */

import Link from "next/link";

import { requireBooksAccess } from "@/lib/accounting/books-access";
import { loadCompanyProfile } from "@/lib/accounting/company-profile-store";
import { FormSheet } from "@/components/admin/books/FormSheet";
import { FormScopeBar } from "@/components/admin/books/FormScopeBar";
import { WaSheetHeader } from "@/components/admin/books/WaSheetHeader";
import { waBoxes } from "@/lib/payroll/form-box-adapters";
import { teachingBoxes } from "@/lib/payroll/form-box-teaching-core";
import { WA_QUARTERLY_LESSONS } from "@/lib/payroll/form-box-lessons-wa";
import { type WaQuarterFormId } from "@/lib/payroll/wa-quarterly-core";
import { waFormGuide } from "@/lib/payroll/wa-quarterly-mentor";
import {
  waQuarterLabel,
  waRateAsOfDate,
  waResolveRates,
} from "@/lib/payroll/wa-quarterly-ui-core";
import { loadWaQuarter } from "@/lib/payroll/wa-quarterly-store";
import { GREENWAY_RATES } from "@/lib/payroll/payroll-rates-2026";
import { type QuarterRef } from "@/lib/payroll/payroll-deposit-schedule-core";
import {
  mostRecentlyClosedQuarter,
  readScope,
  scopeQuarters,
  scopeYears,
  type FormScope,
} from "@/lib/payroll/form-scope-core";

export const dynamic = "force-dynamic";

/*
 * The same four forms, in the same order, as the tabbed screen. Written here
 * rather than imported because ../page.tsx keeps it as a module-private const;
 * a gate in the WA test file asserts the two lists are identical, so this copy
 * cannot drift silently. (Rule 25 would prefer one list — the gate is the
 * honest second-best when the original is not exported.)
 */
const FORM_ORDER: readonly WaQuarterFormId[] = [
  "esd_5208a",
  "esd_5208b",
  "pfml_wa_cares",
  "lni_quarterly",
];

export default async function WaQuarterlySheetPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  await requireBooksAccess();

  const sp = (await searchParams) ?? {};
  const now = new Date();
  const scope: FormScope = readScope(sp, now, "quarter");
  const quarter: QuarterRef = {
    year: scope.year,
    quarter: scope.quarter ?? mostRecentlyClosedQuarter(now).quarter,
  };

  /*
   * ═══ WHOSE RETURNS THESE ARE ═══
   *
   * The same `company_profile` row every federal sheet reads. It is read here
   * for a reason beyond symmetry: the 5208A prints the FEDERAL id number in box
   * 2, so the EIN on this page and the EIN on the 941 must be the same string
   * from the same row, or Greenway is two taxpayers.
   *
   * D-15, fixed in this slice, is why this is worth stating. The federal sheets
   * were reading this row correctly and still printing nothing, because the
   * teaching specimen had no box for the value to land in.
   */
  const profileLoad = await loadCompanyProfile();
  const profile = profileLoad.ok ? profileLoad.profile : {};
  const str = (key: string): string | null => {
    const v = profile[key];
    return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
  };

  const asOf = waRateAsOfDate(quarter);
  const resolved = waResolveRates(GREENWAY_RATES, asOf);

  const loaded = resolved.ok
    ? await loadWaQuarter(quarter, resolved.rates, {
        employerOwesEmployerShare: false,
        determinedAverageHeadcount: null,
      })
    : null;

  /*
   * TWO layers of "ok", and they mean different things. `loaded.ok` is whether
   * the DATABASE could be read; `loaded.result.ok` is whether the ENGINE could
   * honestly build a return from what it read (it refuses, rather than
   * guessing, when a rate or a determination is missing). Only when both are
   * true is there a figure worth printing, so both are unwrapped here and the
   * page below never sees a partially-good answer.
   */
  const ret = loaded !== null && loaded.ok && loaded.result.ok ? loaded.result.value : null;

  /*
   * ═══ THREE REASONS A BOX CAN BE EMPTY, AND THEY ARE NOT THE SAME ═══
   *
   * A gate in form-sheet-core.test.ts requires every sheet route to tell a READ
   * FAILURE apart from an honest absence, and it is right to: the teaching
   * specimen's figures are not Michael's, so showing it because the database
   * broke would dress a fault up as a form. Named separately here rather than
   * folded into one boolean, because the three produce identical blank boxes
   * and mean completely different things:
   *
   *   ratesMissing  - the rate that was in force is not on file. Refusal.
   *   readFailed    - the database could not be read. Fault.
   *   (neither)     - read fine, no pay run has produced a figure yet. Honest.
   */
  const ratesMissing = !resolved.ok;
  const readFailed = loaded !== null && !loaded.ok;

  return (
    <main className="min-h-screen bg-[var(--admin-bg)] text-white/85">
      <div className="admin-chrome mx-auto w-full max-w-[900px] px-4 pt-6 print:hidden">
        <Link
          href={`/admin/books/wa-quarterly?year=${quarter.year}&q=${quarter.quarter}`}
          className="text-xs text-white/45 underline hover:text-white"
        >
          &larr; Back to the Washington screen, with the deadlines and the checks
        </Link>

        <WaSheetHeader
          quarterLabel={waQuarterLabel(quarter)}
          ein={str("ein")}
          legalName={str("legal_name")}
          tradeName={str("trade_name")}
          esdAccount={str("esd_account_number")}
          ubi={str("wa_ubi")}
          ratesResolved={!ratesMissing}
          missingRates={resolved.ok ? [] : resolved.missing.map((m: { label: string }) => m.label)}
          readFailed={readFailed}
        />

        <div className="mt-4">
          <FormScopeBar
            basePath="/admin/books/wa-quarterly/sheet"
            scope={scope}
            years={scopeYears(scope, now)}
            quarters={scopeQuarters(scope, now)}
            employees={null}
          />
        </div>
      </div>

      {/* ── THE FOUR RETURNS ────────────────────────────────────────────────
          One sheet each, in the order they are worked. Figures when the engine
          produced them for THAT form; the teaching specimen when it did not —
          never a zero, because a zero on a Washington return is a claim that
          nothing was paid. The 5208B never produces figures at all (it is a
          form made of people, one row per employee), so it always teaches. */}
      {FORM_ORDER.map((form) => {
        const guide = waFormGuide(form);
        const computed = ret !== null ? waBoxes(ret, form) : [];
        const hasFigures = computed.length > 0;
        return (
          <div key={form} className="admin-chrome">
            <FormSheet
              title={`${guide ? guide.officialName : form} \u2014 ${waQuarterLabel(quarter)}`}
              boxes={hasFigures ? computed : teachingBoxes(form)}
              lessons={WA_QUARTERLY_LESSONS}
            />
          </div>
        );
      })}
    </main>
  );
}
