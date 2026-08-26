-- ═══════════════════════════════════════════════════════════════════════════
-- 0207  THE THREE FACTS AN ESD UPLOAD NEEDS AND THIS DATABASE CANNOT STATE
--
-- books-64. Found the same way 0203 was found, which is the only reason this
-- file exists at the right moment instead of after a rejected upload: the pure
-- CSV writers were built and self-tested first, then the store was written to
-- join them to real data, and then the columns the store selected were CHECKED
-- against the migrations rather than assumed to exist.
--
--     $ grep -rln "date_of_birth\|wa_cares_exempt\|soc_code" supabase/migrations/
--     (no output)
--
-- Three of the nine columns esd-upload-store.ts selects do not exist. Postgres
-- would not have been quiet about it, but it would have failed at the moment
-- Michael pressed Download in a quarter-end hurry, with a PostgREST message
-- about an unknown column rather than a sentence about what to fix.
--
-- ───────────────────────────────────────────────────────────────────────────
-- WHY THE ENGINE ALREADY KNEW TWO OF THESE WERE MISSING AND SAID SO
-- ───────────────────────────────────────────────────────────────────────────
--
-- src/lib/payroll/esd-paid-leave-csv-core.ts (books-56) carries this, written
-- eight slices before the column existed:
--
--     "`WaQuarterSubject` in `wa-quarterly-core.ts` carries wages and hours. It
--      does NOT carry a date of birth or a WA Cares exemption status. The
--      specification marks both as **Required**, and DOB has been required
--      since 1 October 2023. So this file CANNOT be produced from what the
--      engine holds today. That is a real gap, and the honest response is for
--      the type to demand the fields and for the writer to refuse without them
--      — not to default DOB to something plausible, and not to default the
--      exemption to 'N'."
--
-- That is what a gap recorded honestly buys: this migration is a five-minute
-- job with a known shape, instead of an archaeology exercise.
--
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- §1  DATE OF BIRTH — REQUIRED BY PAID LEAVE AND WA CARES SINCE 2023-10-01
--
-- Nullable, for the identical reason 0203 gave for the legal-name columns: a
-- refusal needs a distinguishable "not entered". A DEFAULT here would be worse
-- than merely wrong, because WA Cares uses the date of birth to decide who is
-- eligible at all — people born before 1 January 1968 have their own rule — so
-- a placeholder date is not a cosmetic blemish on a report, it is a false
-- statement that changes an outcome.
--
-- `date`, not `text`. The Paid Leave file wants MMDDYYYY and the store holds
-- ISO YYYY-MM-DD; the conversion lives in `paidLeaveDob` in the pure core,
-- where it is tested. Storing the wire format would push the spec's formatting
-- into the database and make every other reader convert it back.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.employees
  add column if not exists date_of_birth date;

comment on column public.employees.date_of_birth is
  'Employee date of birth. REQUIRED by the ESD Paid Leave and WA Cares quarterly wage file since 1 October 2023, which is why it is here rather than in an HR nicety. Nullable so that "never captured" is distinguishable from a value, which is what lets buildEsdUpload refuse by name instead of shipping a plausible guess; WA Cares eligibility turns on this date, so a placeholder would change an outcome and not just a printout. Stored as a real date because the file format MMDDYYYY is a wire detail belonging to paidLeaveDob in esd-paid-leave-csv-core.ts.';


-- ═══════════════════════════════════════════════════════════════════════════
-- §2  THE WA CARES EXEMPTION — A FLAG THAT ONLY MICHAEL MAY SET
--
-- This is the one column of the three that carries a NOT NULL DEFAULT false,
-- and the reasoning is the reverse of §1's, so it is worth being explicit.
--
-- The Paid Leave spec says of this column: "Otherwise enter 'N' for no or leave
-- blank." So `N` looks free. It is not free — entering N asserts that Greenway
-- holds no approved exemption letter for that person for that quarter. But that
-- assertion is TRUE by construction for an employee nobody has ever exempted:
-- an exemption exists only if ESD granted one and somebody recorded it, and
-- there is no third state in between. Absent and no genuinely mean the same
-- thing here, exactly as 0203 argued for `w2_void`.
--
-- The contrast with §1 is the test worth keeping: for a date of birth, absent
-- and any particular value are different claims, so no default is allowable.
-- For an exemption, absent IS the claim.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.employees
  add column if not exists wa_cares_exempt boolean not null default false;

comment on column public.employees.wa_cares_exempt is
  'True ONLY when Greenway holds this employee''s approved WA Cares exemption letter for the quarter being reported. Feeds the WACaresExempt(Y/N) column of the ESD Paid Leave upload. Defaulted false because, unlike date_of_birth, absent and no are the same claim: an exemption exists only if ESD granted one and somebody recorded it. Setting this true is a statement about a document Greenway must be able to produce, so it is a stored fact set by a person, never inferred by the upload builder.';


-- ═══════════════════════════════════════════════════════════════════════════
-- §3  THE SOC CODE — BLANK IS A LEGITIMATE VALUE, NOT A GAP
--
-- Nullable with NO default, and the CHECK forbids a whitespace-only string the
-- way 0203's name columns do.
--
-- ESD's own rule for this column, quoted in esd-eams-csv-core.ts, is:
-- "Can be only 6 digits or blank." Blank is expressly permitted, so an empty
-- SOC code is a value ESD documents rather than a hole being papered over —
-- which is why the EAMS writer accepts empty here while the Paid Leave writer
-- refuses an empty date of birth. Two absences, two different rules, because
-- two different agencies' specifications say so.
--
-- The CHECK accepts six digits with or without the hyphen ESD prints, because
-- Michael's filed 5208B shows `41-2031` and a person copying from the filed
-- return will type it that way. `eamsSocCode` strips the hyphen on write.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.employees
  add column if not exists soc_code text
    check (soc_code is null
           or soc_code ~ '^[0-9]{2}-?[0-9]{4}$');

comment on column public.employees.soc_code is
  'Standard Occupational Classification code for this employee, feeding the last column of the EAMS unemployment wage file. NULL or absent is FINE: ESD says the column "can be only 6 digits or blank", so unlike date_of_birth this absence needs no refusal — and inventing a code would state what work a person does without knowing. The CHECK accepts the hyphenated form (41-2031, Retail Salespersons, as printed on Greenway''s filed 5208B) as well as bare digits, because someone copying from the filed return will include the hyphen; eamsSocCode strips it on write. A malformed code is rejected here rather than at upload time, so the error names the record instead of the file.';


-- ═══════════════════════════════════════════════════════════════════════════
-- §4  WHAT IS DELIBERATELY NOT HERE
--
-- No index. All three columns are read only by buildEsdUpload, which already
-- reads the whole active roster for the quarter and joins in memory; an index
-- on a table of this size would be write cost for no read benefit.
--
-- No backfill. There is no source to backfill FROM — that is the entire point
-- of the gap. Michael enters these three facts once per employee, and until he
-- does, the Paid Leave upload refuses by name and says which person and which
-- fact. That refusal is the feature.
-- ═══════════════════════════════════════════════════════════════════════════
