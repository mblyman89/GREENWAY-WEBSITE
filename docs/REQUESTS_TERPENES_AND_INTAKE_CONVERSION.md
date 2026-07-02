# Requests — Terpenes + Intake Category/Type Conversion

Recorded verbatim (standing rule: record every request verbatim). Date: 2026-07-02.

## Request A — Terpenes as a descriptive attribute of strains

> "Will you go back through all of the file tree to make sure the terpenes that
> we have included into the project as a way to add a descriptive more inclusive
> of all info relating to cannabis strains. I want to be able to assign terpenes
> to strains, have them be apart of the kb, have the ai automatically fill in the
> terpene field for known terpenes that have been validated accurate and attached
> to the cannabis strain. I also want to be able to filter for terpenes in the
> menu of the website. I don’t need to track or report on terpenes. I just want to
> make sure it is able to be recorded and attached to a strain."

Distilled acceptance criteria (to be verified against the audit, NOT assumed):
- A1. Terpenes can be **assigned to a strain**.
- A2. Terpenes are **part of the knowledge base (KB)**.
- A3. The **AI automatically fills in the terpene field** for known, validated
      terpenes attached to a cannabis strain.
- A4. Customers can **filter for terpenes in the website menu**.
- A5. **No tracking / no reporting** on terpenes required. Just recorded + attached.

## Request B — Convert intake product type/category to OUR conventions

> "The next thing I need you to fix is how products get recorded in the back
> office for website and reporting purposes. When inventory comes in, it has
> specific types and categories the LCB/ CCRS use. But these types associated to
> the intake products do not reflect how we categories and type our products. So
> I need all inventory entering the system via the intake process to be converted
> to our conventions so it works properly with the menu and the back office. For
> example, in cycle counts, the filters are based on the LCB classification, like
> usable marijuana and such. The LCB/ CCRS requirements should be left untouched
> for their reporting purposes, but for backend and website purposes we need them
> to be converted to use our conventions."

Distilled acceptance criteria (to be verified against the audit, NOT assumed):
- B1. Inventory entering via **intake** must be converted from LCB/CCRS
      type/category to **our conventions** (used by menu + back office).
- B2. **Cycle-count filters** (currently LCB-classified, e.g. "usable marijuana")
      must reflect OUR conventions instead.
- B3. **LCB/CCRS reporting must remain untouched / hard-set** (same rule as strain
      type — CCRS is authoritative for its own reporting).
- B4. The conversion must work for **both the website AND the back office**.

## Standing rules reminder
- Record verbatim; deep-research; ground in verified fact, NEVER guess; stop & ask
  if unsure; slices; AI output = drafts-only; walk the tree repeatedly; best
  judgment even if harder; Supabase migrations applied MANUALLY by owner + keep
  idempotent; `main` branch-protected (branch + PR + squash-merge); money in
  MINOR UNITS (cents); ALWAYS satisfy CCRS + DOH compliance.

## Process
1. Walk the tree. Record findings in AUDIT docs (one per request).
2. Present the report + a fully-inclusive task list.
3. Only then build, in slices, without breaking anything.

## OWNER DECISIONS (confirmed 2026-07-02, verbatim)

> "Question 1: I agree, replace m, but keep the old one available just in case we
> ever need it. Question 2: yes I agree with this as well. The only way a product
> can be edited should be through the product enhancements and kb. I also agree
> with you about the no migration approach. I also want you to include in this
> build the enhancement you talked about in the previous enhancement. Let's make
> the product cards neon color effect be the leaning sides color on the left side,
> and the hybrid color on the right side. So sativa hybrid would be sativa left,
> hybrid right. After building please merge the pr. Follow the standing rules and
> make sure you are hand off ready in case you change agents mid task. Please
> proceed."

Decisions resolved:
- **B / Q1 — Cycle-count filter:** REPLACE the primary type/category filter with
  OUR-convention (website category), but KEEP the raw LCB value available (visible
  column/tooltip) "just in case we ever need it".
- **B / Q2 — Intake review screen:** YES, show the resolved our-category read-only
  with an unmapped warning. Products are only ever edited via product enrichment +
  KB (never by rewriting the stored CCRS lot values).
- **A — approach:** NO migration. Terpenes joined onto menu items from the KB
  strain (validated single source of truth). Add website menu terpene filter.
- **BONUS (this build):** product-card neon effect = a SPLIT for leaning hybrids —
  the LEANING side's color on the LEFT, the base HYBRID color on the RIGHT. E.g.
  sativa-hybrid = sativa (left) + hybrid (right); indica-hybrid = indica (left) +
  hybrid (right). Pure indica/sativa/hybrid/cbd keep their single color.
- After build: push + open PR + squash-merge.
