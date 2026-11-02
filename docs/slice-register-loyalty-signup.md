# Slice: register-loyalty-signup

## The request (verbatim)

> I need your help adding a new feature to the iPad register. I need a way to sign up new loyalty customers from the iPad register. Clone the repo, read agents.md, the standing rules, then proceed with building the feature. Make sure to include anything and everything to make the process simple and powerful. I have another agent working, so build everything, commit the work out of the sandbox into the shared root workspace folder to keep the work safe while we wait for the other agent to finish. Follow the standing rules. Thank you!

## What was there before

- Customers could join loyalty only on the website form (`/loyalty`, `src/lib/loyalty/signup.ts`). Staff then turned the signup into a customer (`connectSignupToCustomer`) and opened the loyalty account (`enrollCustomer`).
- The register could only *find* an existing member (`/api/pos/member`, AO-3 auto-attach by name + birthday after an ID scan). A new customer at the counter could not join.

## What changed

1. **A "⭐ Sign up for loyalty" button at the register.** It sits next to *Attach customer* on the customer band. Inside the customer search it says *"New customer? Sign up for loyalty"*, and turns solid *"Not found: sign them up for loyalty"* when the search finds nobody. Web register and iPad app share it (both mount `RegisterShell` → `SaleFlow`).
2. **One short sheet** (`src/app/(site)/pos/RegisterLoyaltySignup.tsx`):
   - **Names** come from the scanned ID, title-cased (`JANE` → `Jane`, `O'BRIEN` → `O'Brien`). With no scan, they come from what was typed in the search. They can be edited.
   - **Birthday is locked** to this sale's passing ID check (`verdict.dateOfBirth`). Nobody types it, so it has no typos. Next visit, the ID scan attaches the member by itself (AO-3 matches name + birthday).
   - **Phone** (formatted as typed) and/or **email**. One of them is required so the account can be found by search.
   - **The live program terms** (signup bonus, earn rate, point value) from `loyalty_config`, so the budtender can pitch it in one sentence.
   - **Messages are optional and start unchecked.** Ticking *"Customer wants deals by text and email"* shows the exact published consent wording (the same `loyalty.form.consent_text` block the website uses) and a signature box where the customer types their name.
3. **Duplicate check before anything is saved.** The server looks for customers with the same phone, the same email, or the same name + birthday. The sheet lists them with the reason (*"Same phone number"*). The budtender taps **Use this account** or **Not them: create a new account anyway**.
4. **Success attaches the member to the sale.** This purchase earns points when it completes. The sheet shows *"Welcome, Jane! The loyalty account is open. 200 points on the account (signup bonus)."*
5. **Route** `GET/POST /api/pos/loyalty-signup` (device-authenticated, CORS for the iPad app, online-only):
   - GET returns the published consent wording, its SHA-256 and the program terms.
   - POST, in order: replay check, consent check, duplicate check, `loyalty_signups` row, `customers` row (created or linked), `enrollCustomer` (signup bonus once), audit.
6. **Back office sees it.** The signup row has `source = "greenway-register"`, `status = "entered"` (already handled) and a staff note naming the register, the budtender and the ID method. The customer has `import_source = "register-signup"` and `loyalty_signup_id` pointing at the row. Audit action `register.loyalty_signup`.

## Rules it follows

- **21+ (RCW 69.50.357).** The birthday must be 21 or more on the Pacific calendar (`pacificToday()`). It comes from the sale's own ID check.
- **Message consent (47 CFR 64.1200(f)(9), prior express written consent).** It is optional and never a condition of joining or buying. The customer signs electronically, which counts as a signature under the E-SIGN Act (the rule says so). The server checks the SHA-256 of the wording the customer saw against the published wording. If staff changed the wording while the sheet was open, the server refuses (409 `consent_changed`), sends the new wording, and the customer signs again. The row stores the wording and its hash (0264 columns), the same as the website.
- **A "no" is a no.** The newsletter sends only to `consent = true` signups, so a register signup that said no is never emailed. Linking an existing customer never downgrades an earlier signed "yes" and never overrides `do_not_contact` (shared `buildLinkPatch`).
- **Idempotent (standing rule 15).** The sheet makes one request id when it opens and re-sends it on every retry. `loyalty_signups.legacy_id = "register:<id>"` is UNIQUE. A retry returns the same account (`outcome: "replayed"`), and a race that hits `23505` reads the winner's row. `loyalty_accounts.customer_id` is UNIQUE and `enrollCustomer` is idempotent.
- **Every `{error}` is read and classified** (`classifySignupDbError`): 42501 → run `0330_service_role_grants.sql`; 42P01/PGRST205 → missing table; 42703/PGRST204 → missing column. Nothing fails silently. The consent wording read is strict: a failed read refuses instead of falling back.
- **Explicit columns** for every customers read (`DUPLICATE_CANDIDATE_COLUMNS`).
- **Audit has no personal data**: ids, the choices (consent yes/no, had phone/email, birthday from scan or hand check), the duplicate reasons, the device and register.
- **No migration.** Every table and column used already exists and is in the DB contract (`build-db-contract.ts --check`: up to date).

## Files

- `src/lib/pos/register-loyalty-signup-core.ts`: pure logic + `__runRegisterLoyaltySignupCoreTests` (128 assertions, floor 120 in `scripts/compliance/run-pure-selftests.ts`).
- `src/app/api/pos/loyalty-signup/route.ts`: GET/POST/OPTIONS.
- `src/app/(site)/pos/RegisterLoyaltySignup.tsx`: the sheet.
- `src/app/(site)/pos/SaleFlow.tsx`: `onLoyaltySignup` prop; keeps the scanned name; buttons in `MemberPanel`; the sheet lives in `CustomerBand` so the Welcome screen stays up after the member attaches.
- `src/app/(site)/pos/RegisterShell.tsx`: wiring through `posFetch` with device headers; offline messages.
- `tests/compliance/register-loyalty-signup.test.ts`: the real route against a fake Supabase (create, replay, duplicates, use existing, create anyway, consent stored, consent changed, under 21, missing contact, 42501 classified, explicit columns) plus wiring pins.
- `docs/sop/SOP-01-register-operations.md` §4.12a and §5.4; `docs/LOYALTY_COMPLIANCE.md` §6.

## The iPad app

The iPad app must be rebuilt for the new button and sheet (same as every register UI change).

## Tests

- `npx tsx scripts/compliance/run-pure-selftests.ts`: ALL PURE SELF-TESTS PASSED (register-loyalty-signup-core 128/0).
- `npx vitest run tests/compliance/register-loyalty-signup.test.ts`: 17/17. The 31 existing register test files still pass.
- `npx tsx scripts/platform/build-db-contract.ts --check`: up to date.
- tsc / eslint: 0 errors on every changed file.
