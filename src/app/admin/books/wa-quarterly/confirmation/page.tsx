/**
 * src/app/admin/books/wa-quarterly/confirmation/page.tsx   (books-66)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * "THE ONE GIVEN AFTER EFILING" — THE 5208A MICHAEL ACTUALLY RECOGNISES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Michael, books-66, choosing between two ways of showing him the 5208A:
 *
 *   "I will upload a version from sage that does not say record copy do not
 *    file, if you can recreate or redraw or do some sort of genius technique to
 *    allow me to see the form filled as sage does it so I can visualize my
 *    data. however, I would not be opposed to the form looking like the one
 *    given after efiling, the example you have in the workspace folder,
 *    1st_quarter_form_5208a.pdf. that would actually be better in my opinion as
 *    thats what I am used to seeing."
 *
 * He offered a Sage copy and preferred the EAMS one. This builds the EAMS one,
 * which means the Sage upload he offered is not needed — noted so nobody waits
 * on it.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THIS ROUTE EXISTS BESIDE `sheet/` RATHER THAN REPLACING IT
 * ───────────────────────────────────────────────────────────────────────────
 * `sheet/` shows all FOUR Washington returns as box lists, which is what a
 * person wants when the question is "what goes on line 16 of the 5208B". This
 * shows ONE of them, laid out as the page ESD hands back after a filing, which
 * is what a person wants when the question is "does this look like what I filed
 * last quarter". Different questions. Both stay.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * READ-ONLY
 * ───────────────────────────────────────────────────────────────────────────
 * No inputs, no server actions. Every figure comes from `buildWaQuarter` by way
 * of `buildEamsConfirmation`, which computes no tax of its own.
 */

import Link from "next/link";

import { requireBooksAccess } from "@/lib/accounting/books-access";
import { loadCompanyProfile } from "@/lib/accounting/company-profile-store";
import { EamsConfirmationSheet } from "@/components/admin/books/EamsConfirmationSheet";
import { FormScopeBar } from "@/components/admin/books/FormScopeBar";
import { buildEamsConfirmation } from "@/lib/payroll/eams-confirmation-core";
import { loadConfirmationEmployeeFacts } from "@/lib/payroll/esd-upload-store";
import { WA_QUARTERLY_LESSONS } from "@/lib/payroll/form-box-lessons-wa";
import { GREENWAY_RATES } from "@/lib/payroll/payroll-rates-2026";
import { wageBaseSpec } from "@/lib/payroll/payroll-withholding-core";
import { type QuarterRef } from "@/lib/payroll/payroll-deposit-schedule-core";
import { loadWaQuarter } from "@/lib/payroll/wa-quarterly-store";
import { waRateAsOfDate, waResolveRates } from "@/lib/payroll/wa-quarterly-ui-core";
import {
  mostRecentlyClosedQuarter,
  readScope,
  scopeQuarters,
  scopeYears,
  type FormScope,
} from "@/lib/payroll/form-scope-core";

export const dynamic = "force-dynamic";

/**
 * A refusal panel that says which of the three different "no form" states this
 * is.
 *
 * The same distinction `sheet/page.tsx` draws, for the same reason: a missing
 * rate, a broken database and an honestly empty quarter all produce a blank
 * page and mean completely different things. Michael must not read a fault as
 * "no payroll this quarter".
 */
function CannotDraw({ heading, body }: { readonly heading: string; readonly body: string }) {
  return (
    <div className="mx-auto mt-6 w-full max-w-[1000px] px-4">
      <div className="rounded-md border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-100">
        <div className="font-semibold">{heading}</div>
        <p className="mt-2 text-xs leading-relaxed">{body}</p>
      </div>
    </div>
  );
}

export default async function EamsConfirmationPage({
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

  const asOf = waRateAsOfDate(quarter);
  const resolved = waResolveRates(GREENWAY_RATES, asOf);

  const header = (
    <div className="admin-chrome mx-auto w-full max-w-[1000px] px-4 pt-6 print:hidden">
      <Link
        href={`/admin/books/wa-quarterly?year=${quarter.year}&q=${quarter.quarter}`}
        className="text-xs text-white/45 underline hover:text-white"
      >
        &larr; Back to the Washington screen, with the deadlines and the downloads
      </Link>
      <div className="mt-4">
        <FormScopeBar
          basePath="/admin/books/wa-quarterly/confirmation"
          scope={scope}
          years={scopeYears(scope, now)}
          quarters={scopeQuarters(scope, now)}
          employees={null}
        />
      </div>
    </div>
  );

  if (!resolved.ok) {
    return (
      <main className="min-h-screen bg-[var(--admin-bg)] text-white/85">
        {header}
        <CannotDraw
          heading="No rate on file for this quarter, so there is no form to draw"
          body={
            `This is a refusal, not an empty quarter. The rates that were in force on ` +
            `${asOf} are missing: ${resolved.missing.map((m: { label: string }) => m.label).join(", ")}. ` +
            `Drawing the page with a guessed rate would produce a convincing document with the ` +
            `wrong tax on it, so nothing is drawn until the rate is recorded.`
          }
        />
      </main>
    );
  }

  const loaded = await loadWaQuarter(quarter, resolved.rates, {
    employerOwesEmployerShare: false,
    determinedAverageHeadcount: null,
  });

  if (!loaded.ok) {
    return (
      <main className="min-h-screen bg-[var(--admin-bg)] text-white/85">
        {header}
        <CannotDraw
          heading="The books could not be read"
          body={
            `This is a fault, not an empty quarter: ${loaded.message} Nothing on this page ` +
            `would be trustworthy, so nothing is shown. Fix the connection and reload.`
          }
        />
      </main>
    );
  }

  if (!loaded.result.ok) {
    return (
      <main className="min-h-screen bg-[var(--admin-bg)] text-white/85">
        {header}
        <CannotDraw
          heading="The engine refused to build this quarter"
          /*
           * `because` and `fix`, not a bare code. The reader of this panel is
           * Michael at a quarter-end deadline; "SUBJECT_MISSING_RATE" tells him
           * nothing he can act on, while the refusal's own sentences name the
           * person or field at fault and the single thing to do about it.
           */
          body={
            `It found ${loaded.result.refusals.length} thing(s) it will not guess about. ` +
            loaded.result.refusals.map((r) => `${r.because} ${r.fix}`).join(" ")
          }
        />
      </main>
    );
  }

  const ret = loaded.result.value;

  /*
   * SSNs and SOC codes, read through the store that already owns the ESD column
   * list. A read failure here is NOT fatal to the page: the wage table can still
   * show names, hours and wages, and every SSN cell says so. Losing the whole
   * preview because one lookup failed would be a worse answer than a page with
   * eleven honest "not on file" cells.
   */
  const factsResult = await loadConfirmationEmployeeFacts(
    ret.wageDetail.map((r) => r.subjectId),
  );
  const facts = factsResult.ok
    ? factsResult.facts
    : { ssnBySubject: {}, socCodeBySubject: {} };

  const profileLoad = await loadCompanyProfile();
  const profile = profileLoad.ok ? profileLoad.profile : {};
  const str = (key: string): string | null => {
    const v = profile[key];
    return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
  };

  /*
   * The confirmation prints the mailing address as one line ("PORT ORCHARD WA
   * 98367-9350"). The books hold city, state and zip separately, so they are
   * joined here rather than a fourth combined column being added to the profile.
   * If any part is missing the whole line reads as absent — a half address on a
   * tax document is worse than an obviously blank one.
   */
  const cityStateZip = ((): string | null => {
    const city = str("city");
    const state = str("state_code");
    const zip = str("zip_code");
    if (city === null || state === null || zip === null) return null;
    return `${city} ${state} ${zip}`;
  })();

  const view = buildEamsConfirmation({
    quarter,
    ret,
    profile: {
      legalName: str("legal_name"),
      tradeName: str("trade_name"),
      ein: str("ein"),
      esdAccount: str("esd_account_number"),
      ubi: str("wa_ubi"),
      /*
       * The real confirmation prints "LimitedLiabilityComp" under BUSINESS
       * STRUCTURE. The books hold `entity_type`, whose values are the tax
       * classifications (`llc_s_corp` and friends) rather than ESD's own
       * wording. It is shown as stored rather than translated: inventing a
       * mapping from our vocabulary to ESD's would be guessing at what ESD
       * calls each structure, and this field is decoration on a preview.
       */
      businessStructure: str("entity_type"),
      mailingCityStateZip: cityStateZip,
      /*
       * ESD's "preparer" is the person it contacts about the report. The books
       * call that the contact, and the filed Q1 confirmation shows Michael's own
       * name, phone and email in those three slots, which is the same person the
       * contact fields hold.
       */
      preparerName: str("contact_name"),
      preparerPhone: str("contact_phone"),
      preparerEmail: str("contact_email"),
    },
    uiRateMilliPct: resolved.rates.sutaUiMilliPct,
    eafRateMilliPct: resolved.rates.sutaEafMilliPct,
    /*
     * The wage base comes from `wageBaseSpec("wa_suta")`, the same constant the
     * withholding engine charges against — not a number typed here. Michael's
     * filed Q1 confirmation prints "Annual taxable wage base: $78,200.00" and
     * that spec holds 7_820_000 cents, which is how we know the two agree.
     */
    wageBaseCents: wageBaseSpec("wa_suta").ceilingCents,
    socCodeBySubject: facts.socCodeBySubject,
    ssnBySubject: facts.ssnBySubject,
    /*
     * Monthly headcount is not yet determined by the engine, so it is passed as
     * three nulls and the sheet prints em dashes. NOT zeros: EAMS asks for the
     * count of employees who worked in each month, and a zero there is a claim
     * that nobody did. An em dash says "we have not worked this out", which is
     * true. Recorded in DEFECTS as the one field of the real confirmation this
     * preview cannot yet fill.
     */
    monthlyHeadcount: [null, null, null],
  });

  return (
    <main className="min-h-screen bg-[var(--admin-bg)] text-white/85">
      {header}
      {!factsResult.ok && (
        <div className="mx-auto mt-4 w-full max-w-[1000px] px-4">
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-100">
            The employee lookup failed, so the SSN and SOC columns are blank below. The wages and
            hours are still correct. {factsResult.message}
          </div>
        </div>
      )}
      <EamsConfirmationSheet view={view} lessons={WA_QUARTERLY_LESSONS} />
    </main>
  );
}
