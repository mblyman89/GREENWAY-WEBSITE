# books-68 — the DSHS new hire report

Michael, verbatim:

> "I want to create the new hire form and add it to the w-4 payroll setup page
> in the same way the other forms are displayed. I want a button in the setup
> employee page at the top right corner that shows me the form filled out and
> downloadable for me to send to the state. ... I should be able to see the form
> empty. And if it's not too much work, learning lessons for each box would be
> amazing!"

Four asks, each with a completion test:

1. The form exists and renders like the others (FormSheet + FormPrintBar).
2. A button at the TOP RIGHT of the employee setup page opens it.
3. It draws EMPTY as well as filled (books-67's rule, already law here).
4. A lesson on every box.

---

## WHAT WAS MEASURED BEFORE ANY CODE

### The form is DSHS 18-463 (REV. 04/2023)

`pdfinfo example_new_hire_form.pdf` → 2 pages, letter, **`Form: none`**.

There is no AcroForm and there are no `/Widget` rectangles. Rule 127 requires
geometry to be read from the agency's file; there is none to read. So this form
takes the SAME path the ESD 5208A took in books-65: `FormSheet`, which needs no
geometry, plus a stated reason why the paper is not underneath. Placing boxes by
eye on a document that gets mailed to a state agency is guessing (rule 62d).

Page 1 measured with `pdftotext -bbox-layout`: four employee blocks at
y=147, y=271, y=394, y=518 — pitch **123.6pt**, four to a page. Page 2 is the
instructions sheet, not a data page.

### The employer block (page 1, measured)

    EMPLOYER NAME AND ADDRESS          LYMAN'S MARIJUANA
    EMPLOYER FEDERAL ID NUMBER (FEIN)  46-4217016
                                       4851 GEIGER RD SE
                                       PORT ORCHARD  WA 98366

### The eight employee boxes, in the order the paper prints them

    EMPLOYEE LAST NAME · FIRST NAME · MIDDLE NAME
    EMPLOYEE ADDRESS
    EMPLOYEE CITY · STATE · ZIP CODE
    EMPLOYEE SOCIAL SECURITY NUMBER · BIRTH DATE · DATE OF HIRE

Eleven fields; three employer, eight employee.

### THE AUTHORITY, and it settles two design questions at once

RCW 26.23.040, already mirrored at `docs/authorities/state-wa/rcw-26.23.040.txt`.

**(2)** — "Employers shall report to the extent practicable by W-4 form, or, at
the option of the employer, **an equivalent form**".

That is express statutory permission for a facsimile. It is also why this form
belongs on the W-4 page and nowhere else: the statute itself names the W-4 as
the primary reporting vehicle. Michael's instinct about placement is the
statute's own structure.

**(3)** — due "within twenty days", and the report "shall contain: (a) The
employee's name, **address**, social security number, and date of birth; and
(b) The employer's name, address, and identifying number".

**(5)** — $25/month/employee, or $500 for a conspiracy to not report.

### THE GAP — found by checking columns, not by assuming them

`grep 'add column if not exists' supabase/migrations/*.sql` on `employees`:

    badge_number, bank_account_number, date_of_birth, employment_status,
    flsa_exempt_reason, flsa_status, gl_shareholder_id, hire_date, soc_code,
    ssn_full, ssn_last_four, termination_date, termination_reason,
    wa_cares_exempt

`date_of_birth` (0207) and `hire_date` exist. **There is no address column of
any kind.** Verified with a second grep for address|street|city|zip|postal
across every migration: hits are vendors, billing, shipping, locations — never
`employees`.

So RCW 26.23.040(3)(a) names four employee facts and this database can state
three. The report CANNOT be produced complete today. Same shape as the gap 0207
records for DOB, and the honest response is the same one that migration took:
**add the columns, and let the form refuse by name until they are filled.**

This is exactly the 0207 precedent, quoted in that file:

> "the honest response is for the type to demand the fields and for the writer
> to refuse without them — not to default DOB to something plausible"

### Filed-example cross-check

The uploaded example prints "Draft Copy / Do Not File" and lists four employees
with addresses — proof the address is genuinely required on the real thing, and
proof of the exact formats: SSN `534-29-8006`, dates `MM/DD/YYYY`, state `WA`.

---

## TASKS

- [x] Measure the form, the authority, and the schema (above).
- [x] Migration 0208: employee home address (4 columns, nullable, no defaults).
- [x] `new-hire-report-core.ts` — pure: who must be reported, refusals, view.
- [x] `form-box-lessons-new-hire.ts` — 11 lessons, one per box.
- [x] Route `/admin/books/new-hire-report` — FormSheet + FormPrintBar + facsimile.
- [x] Top-right button on `/admin/books/payroll-setup`.
- [x] Tests: refusals, empty draw, lesson coverage, button presence (class gate).
- [x] Visual check (rule 130c), owner report, DEFECTS/roadmap.

## DELIBERATELY NOT DONE

- No pixel facsimile over agency artwork. No `/Rect` data exists (rule 127).
- No transmission to DSHS. We render; he files. Same boundary as every form.
- No backfill of addresses. There is no source to backfill from.

---

## WHAT THE VISUAL CHECK FOUND (D-21)

Every task above was checked off and all 11,695 tests were green when the first
screenshot was taken. The filled form rendered **`0` in all twelve boxes.**

`BoxMeasure` is `money | hours | count` with no text member, so `formatBoxValue`
sent every box down the count branch and printed `quantity ?? 0`. Nothing on the
18-463 is a figure — it is two names, an address, an SSN and two dates. The
thirty-three tests written for this form all asserted on the **view object**,
which was correct in every respect; the defect lived entirely between a correct
view and the rendered page.

The first fix followed the existing `employerEntityBoxes` road (flag
`notComputedYet`, which `formatBoxValue` reads before any numeric branch). The
zeroes went away, the suite went green, and the next screenshot showed a fully
populated report reading **"not computed yet" in all twelve boxes** — a different
false statement about the same form.

Shipped fix: an additive optional `text?: string | null` on `FormBox`, read only
through `boxText()`, consulted by `formatBoxValue` **after** `notComputedYet` and
**before** the numeric branches, with `assertBoxTextIsHonest` called from
`sheetGroups()` so every sheet in the system passes through one door (rule 23).
Widening `BoxMeasure` was rejected on budget: it is an exhaustively-switched union
across five modules, i.e. every form in the system, for one form's benefit.

Two gates, one per half, both mutation-proven: reverting `text` reproduces
*"expected '0' to contain 'LYMAN'S MARIJUANA L.L.C.'"*, and re-greying a populated
box fails with *"expected 'not computed yet' to be '46-4217016'"*.

## THE THREE SURFACES, EACH LOOKED AT

- **Filled** — five people over two sheets (4 + 1, tail short per rule 125(c)),
  real values in every box, MIDDLE NAME correctly greyed, overdue hires coloured.
- **Blank** — twelve boxes reading "not computed yet" under a heading that quotes
  his own words back to him. Reads as a specimen, never as a filed return of zero.
- **Refused** — no form drawn at all; each gap named with the employee and the
  field, citing RCW 26.23.040(3)(a).

Fabricated employees use 900-range SSNs, which the SSA has never issued, so no
real number appears in a screenshot or a test fixture.
