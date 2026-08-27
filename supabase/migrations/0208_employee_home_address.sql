-- ═══════════════════════════════════════════════════════════════════════════
-- 0208  THE EMPLOYEE ADDRESS A STATE REPORT REQUIRES AND THIS DATABASE LACKS
--
-- books-68. Found the way 0207 was found, and the reason that matters is that
-- it was found BEFORE the form was written rather than after a rejected mailing:
-- the new-hire report's required fields were read out of the statute, then the
-- columns were checked against the migrations rather than assumed.
--
--     $ grep -rhoE "add column if not exists [a-z_]+" supabase/migrations/*.sql
--       (employees:) badge_number bank_account_number date_of_birth
--       employment_status flsa_exempt_reason flsa_status gl_shareholder_id
--       hire_date soc_code ssn_full ssn_last_four termination_date
--       termination_reason wa_cares_exempt
--
-- Date of birth is there (0207). Hire date is there. NO ADDRESS OF ANY KIND.
-- A second grep for address|street|city|zip|postal across every migration
-- returns vendors, billing, shipping and locations — never employees.
--
-- RCW 26.23.040(3), mirrored at docs/authorities/state-wa/rcw-26.23.040.txt:
--
--     "The report shall contain: (a) The employee's name, address, social
--      security number, and date of birth"
--
-- Four facts. This database could state three. The report could not be
-- produced complete, and the failure mode was the bad kind: a form that looks
-- finished with an empty address line is more dangerous than one that refuses,
-- because RCW 26.23.040(5) charges "twenty-five dollars per month per employee"
-- for failing to report, and an incomplete report is a failure to report.
--
-- ───────────────────────────────────────────────────────────────────────────
-- WHY FOUR COLUMNS AND NOT ONE TEXT BLOB
-- ───────────────────────────────────────────────────────────────────────────
-- Because the form has four boxes, measured off the agency's own page:
--
--     EMPLOYEE ADDRESS
--     EMPLOYEE CITY | EMPLOYEE STATE | EMPLOYEE ZIP CODE
--
-- A single blob would have to be split to fill them, and splitting a mailing
-- address by guessing where the city starts is exactly the class of invention
-- rule 62d forbids. Storing the shape the form asks for means the form is
-- filled by reading, not by parsing.
--
-- Only ONE street line. The measured form gives one box and Michael's own
-- filed example uses one line ("3444 SW CHRISTMAS TREE LN"). A line 2 that the
-- paper has nowhere to print is a field that silently loses data at report
-- time, which is worse than not offering it.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- §1  ALL FOUR NULLABLE, NONE DEFAULTED
--
-- Same reasoning 0207 gave for date_of_birth, and it applies harder here.
-- "Not entered" and "any particular value" are different claims about where a
-- person lives. A default — even an empty string — would let the report print
-- a blank line that reads as "this employee has no address" rather than as
-- "nobody has captured it yet", and only the second one is true.
--
-- The refusal is the feature: buildNewHireReport names the employee and the
-- missing field, so the fix is a data entry task with an address on it, not a
-- debugging session.
--
-- The CHECK forbids whitespace-only, exactly as 0203's name columns do, so
-- that a spacebar cannot masquerade as a captured fact.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.employees
  add column if not exists home_street text
    check (home_street is null or btrim(home_street) <> '');

comment on column public.employees.home_street is
  'Employee street address, one line. REQUIRED by RCW 26.23.040(3)(a) for the DSHS new-hire report, which is why it is here rather than as an HR nicety. One line only because the DSHS 18-463 form prints one EMPLOYEE ADDRESS box; a second line would have nowhere to go and would lose data silently at report time. Nullable with no default so that "never captured" stays distinguishable from a value, which is what lets buildNewHireReport refuse by employee name instead of printing a blank line that reads as "no address".';

alter table public.employees
  add column if not exists home_city text
    check (home_city is null or btrim(home_city) <> '');

comment on column public.employees.home_city is
  'Employee city, filling the EMPLOYEE CITY box of DSHS 18-463. Stored separately from the street rather than as part of one blob because splitting a mailing address by guessing where the city begins is invention, and the form asks for the parts separately anyway.';

-- Two letters, uppercase. Not a free text box.
--
-- The form prints a two-character STATE box and Michael's filed example shows
-- "WA". Accepting "Washington" or "wa" would put a value in a box that cannot
-- hold it and would be discovered by a person at DSHS, not by us. Constrained
-- here so the error names the employee record at entry time rather than
-- surfacing as a truncated line on a mailed report.
--
-- NOT defaulted to 'WA' even though every current employee lives there. A
-- default would state a fact about where a person lives that nobody entered,
-- and the whole point of §1 is that this database stops doing that.
alter table public.employees
  add column if not exists home_state text
    check (home_state is null or home_state ~ '^[A-Z]{2}$');

comment on column public.employees.home_state is
  'Employee state as the two-letter postal abbreviation, filling the EMPLOYEE STATE box of DSHS 18-463. CHECKed to exactly two uppercase letters because the form prints a two-character box; "Washington" would not fit and the truncation would be found by DSHS rather than by us. Deliberately NOT defaulted to WA: every current employee lives in Washington, but a default asserts where a person lives without anyone having said so.';

-- Five digits, or ZIP+4 with the hyphen.
--
-- The measured example prints "98367" and "98366". The +4 form is accepted
-- because USPS issues it and a person copying from a W-4 may include it; it is
-- not required, because the form does not require it.
alter table public.employees
  add column if not exists home_zip text
    check (home_zip is null or home_zip ~ '^[0-9]{5}(-[0-9]{4})?$');

comment on column public.employees.home_zip is
  'Employee ZIP, filling the EMPLOYEE ZIP CODE box of DSHS 18-463. Five digits, or ZIP+4 with the hyphen because USPS issues that form and someone copying off a W-4 may include it. A malformed ZIP is rejected here so the error names the employee record instead of appearing as a bad line on a report already in the mail.';


-- ═══════════════════════════════════════════════════════════════════════════
-- §2  WHAT IS DELIBERATELY NOT HERE
--
-- No index. These four columns are read only when building a new-hire report,
-- which already reads the roster and joins in memory. An index would be write
-- cost for no read benefit on a table this size — the same call 0207 made.
--
-- No backfill. There is no source in this database to backfill an address FROM.
-- That absence IS the gap; inventing values to close it would defeat the point.
-- Michael enters an address once per employee, and until he does, the report
-- refuses and says which person is missing which fact.
--
-- No country column. DSHS 18-463 has no country box.
-- ═══════════════════════════════════════════════════════════════════════════
