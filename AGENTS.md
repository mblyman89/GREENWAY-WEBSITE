<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:greenway-standing-rules -->
# Greenway Back-Office — Standing Rules (BINDING)

These rules govern ALL work in this repository. They are owner-mandated and permanent.

1. **Record every request verbatim.** Capture the owner's words word-for-word before acting.
2. **Deep-research every topic. Ground all decisions in verified fact — never guess.** Cite the authoritative source. If unsure, STOP and ask.
3. **AI / crawler / machine output is DRAFTS-ONLY.** An employee validates before it becomes truth. Never silently invent a value; surface a precise warning for the human to resolve.
4. **Walk the file tree repeatedly.** Do not assume something doesn't exist — verify. Reuse existing, verified work instead of rebuilding it.
5. **Ship 6 slices at a time.** Each slice: ground → PURE `*-core.ts` logic + `__run…Tests()` → verify (tsc 0, eslint 0, next build ok) → branch → PR → **rebase-merge** (rule 6) → sync main.
6. **`main` is branch-protected, and REBASE MERGE is the only way in.** Owner-authorized, permanent. Every change goes through a branch + PR, merged with `gh pr merge <n> --rebase --delete-branch --admin`. Never a merge commit, never a direct push to `main`. History stays linear, so any slice can be reverted as a unit.

   **Never squash-merge in this repository.** This is not a style preference, it is a deployment constraint, and it was established by direct experiment on this repo rather than assumed. A squash merge performed by the automation token rewrites the commit **author** to `superninja-app[bot]`, which belongs to no team member, and Vercel then refuses the deployment with **BLOCKED** and no build logs (rule 7). Measured on throwaway `zz-lab/*` branches:

   | merge method | commits in PR | resulting author | Vercel |
   | --- | --- | --- | --- |
   | squash | 2 (PR #1090) | `superninja-app[bot]` | BLOCKED |
   | squash | 1 (PR #1091) | `superninja-app[bot]` | BLOCKED |
   | rebase | 3 (PR #1092) | `Greenway Dev <dev@greenwaymarijuana.com>` on all 3 | builds |

   Rebase merge rewrites each commit's **committer** to the bot but leaves the **author** intact, and Vercel reads the author. Note that a rebase merge changes commit SHAs, so after merging, re-sync local `main` with `git fetch origin && git reset --hard origin/main` instead of assuming the branch SHAs survived. Keep Supabase migrations **idempotent** (owner applies them MANUALLY in the SQL editor).
7. **Every commit MUST be authored `Greenway Dev <dev@greenwaymarijuana.com>`.** This is a DEPLOYMENT PRECONDITION, not a preference. Vercel resolves the git author email to a GitHub account and refuses to build when that account is not a team member — the deployment shows **BLOCKED with no build logs**, which looks nothing like a build failure and cannot be diagnosed from CI. `dev@greenwaymarijuana.com` is verified on the owner's GitHub account `mblyman89`; Slice 13 was authored `superninja@ninjatech.ai`, which belongs to no GitHub account, and was blocked. **Set the identity before the first commit of every session** — git does not error on an unset identity, it silently invents one from the hostname:
   ```
   git config user.name  "Greenway Dev"
   git config user.email "dev@greenwaymarijuana.com"
   ```
   Enforced by `scripts/compliance/verify-commit-authorship.ts` in CI. Because a rebase merge (rule 6) preserves each commit's author verbatim, the branch author is exactly what lands on `main` — so the identity must be right **on the branch**, before the merge. CI cannot catch it after the fact, because a merge that rewrites authorship produces a commit that no CI run ever inspected.
8. **Money in MINOR UNITS (cents).** Convert only at the boundary.
9. **Pacific time is the business clock.** Greenway operates in `America/Los_Angeles`. Any calendar-day / reporting-period logic MUST anchor to Pacific, never raw UTC.
10. **Prefer non-blocking narrative updates;** only use `ask` for essential decisions. Use best judgment even when it's harder.
11. **🔴 RECEIVING INTAKE IS THE ONLY WAY PRODUCTS ENTER GREENWAY. THE CULTIVERA MENU IMPORT IS A ONE-TIME EVENT THAT WILL NEVER BE USED AGAIN.** Owner-mandated, permanent. Products arrive as a **vendor manifest / invoice with physical inventory** and are received through `src/lib/inventory/intake-*` → `inventory_lots` → mastering → staged menu → published menu → POS/cart. That chain is the **real, permanent, business-critical infrastructure that maintains the business** — it runs every time a truck arrives, forever.
    - **Cultivera is crap data we import ONCE to get it into our own software.** It is **not** an architecture, it is **not** the product pipeline, and we do **not** build the system around it. `src/lib/purchasing/cultivera-*` and the spreadsheet/menu import (`src/lib/pos/import-service.ts`) are **migration tools with an expiry date.**
    - **Fix order for ANY pipeline work — no exceptions:** (1) receiving intake, (2) mastering/staging/publish, (3) POS/cart/promotions, (4) Cultivera **last**, and only when it blocks the one-time import.
    - **Before shipping any "pipeline" change, verify it reaches receiving intake.** Unifying a rule across the menu half while the receiving door still has its own copy is **not** done. This rule exists because SLICE T1 unified five brand matchers and every one of them was in the promotions/menu half: the receiving resolver still used `.ilike("display_name", label)`, which ignores case ONLY. Measured over the store's 168 real brands and 771 realistic manifest spellings (`scripts/recon/receiving-brand-gap.py`): **ILIKE resolved 41.2%, the shared matcher resolved 100% — 453 spellings were silently dropped.** `inventory_lots` has no `brand_name` column, so an unresolved brand wrote `brand_id: null` with **no error**, the item reached the menu **unbranded**, and it fell off Top Shelf Thursday **at full price**.
    - Never re-implement a rule that already has a shared core. Receiving brand identity now goes through the SAME `brandKey()` as promotions (`src/lib/inventory/brand-resolve-core.ts`), enforced by `tests/compliance/receiving-is-the-real-pipeline.test.ts`. Living reference: `docs/RECEIVING-IS-THE-REAL-PIPELINE.md`.
12. **Vercel plan: PRO (required). Crons may run as often as once a minute — use that where it buys real safety, and build every cron route for it.** Owner-stated (L-34): the project cannot be deployed on Hobby, so Pro is permanent, not an experiment. Verified from Vercel's docs (cron "Usage and pricing" and "Managing cron jobs"; Functions "Usage and pricing", read 2026-09-24):
    - **Limits on Pro:** 100 cron jobs per project; minimum interval **once per minute**; **per-minute** scheduling precision (Hobby was once a day, ±59 min). Expressions are **UTC** — convert from Pacific (rule 9) and write the arithmetic in the route header, because `vercel.json` cannot hold comments.
    - **Delivery is best effort.** Vercel may deliver the same tick **twice**, a run that outlasts its interval can **overlap** the next, a failed invocation is **not retried**, and Instant Rollback does **not** roll back cron definitions. So every cron route MUST be: idempotent; guarded against concurrent runs with a real claim (compare-and-swap or insert-then-verify — a read-then-act check is NOT a lock); and redundant enough that one skipped tick loses nothing.
    - **A tick is a REQUEST TO CONSIDER, never a command.** Timing decisions live in a pure core. Rows that record a refusal ("not due", "cooldown") must never reset the clocks the decision reads, and routine refusals must not be written on every tick. L-34 found exactly these defects the moment the Leafly cadence was raised — a once-a-day cron hides them. **Before raising any cron's cadence, execute the real core at the new tick rate and compare before/after** (template: `scripts/recon/l34-cadence-probe.mts`).
    - **Cost is not the constraint:** Pro bills function invocations at **$0.60 per million** (plus active CPU only while executing). Every-2-minutes is ~21,600 invocations a month. Choose cadence by what the business needs, not by invocation count.
    - **Current schedule (pinned by `tests/compliance/leafly-certification.test.ts`, which parses every expression):** `leafly-ack-sweep` every 2 min (owner asked for 2–3; gives each order ~6 chances inside Leafly's 15-minute window); `leafly-menu-sync` every 15 min (= the finest interval the owner can pick); `compliance-reminders`, `regulatory-watch`, `atm-sync` daily. Changing a cadence means changing that test on purpose, with the reason.
    - **Unchanged by the plan:** rules 6 and 7. The owner may make the GitHub repository public or private depending on Actions minutes; rebase-merge and `Greenway Dev` authorship apply either way, so builds keep working when it goes private again.

13. **Staging is PAUSED by the owner. Ignore it; production is the only deploy that gates a merge.** Owner-stated (after L-45, verbatim): *"I paused the staging site. I was using too much of their usage. Don't worry about it. Add it to the standing rules please. The supabase staging db is paused too."*
    - The Vercel project **`greenway-staging`** is paused, so its PR check reports **"Deployment was blocked"** on every PR. That is EXPECTED and has no code cause. Do **not** push empty commits for it, do not investigate it, and do not wait for it.
    - The **Supabase staging database** is paused too, so the **"Supabase Preview"** check may skip or fail. Also expected; ignore it.
    - **Merge gate while staging is paused:** CI `build`, `compliance`, `migrations` green **and** the production Vercel check **`greenway_website`** green. After merging, verify production by reading the **`greenway_website` context itself**: `gh api repos/mblyman89/GREENWAY-WEBSITE/commits/<sha>/status --jq '.statuses[]|select(.context=="Vercel – greenway_website")|.state'` until `success`. Do NOT use the combined top-level `.state`: with staging paused it contains the blocked `greenway-staging` context and reads `failure` forever (observed on the L-45 merge `9d498a09`). If `greenway_website` fails with no code cause, one empty commit (authored per rule 7) re-triggers it.
    - Never point code, tests, scripts or docs at the staging URL or the staging database as if it were live. This rule stays until the owner says staging is back on; then delete this rule in its own PR.

## 🔴 CCRS COMPLIANCE — ALWAYS CHECK AND SATISFY (BINDING)

### ⛔ MANDATORY FIRST STEP — READ THE BIBLE BEFORE YOU EDIT ANY CCRS CODE

**`docs/ccrs-bible/` is REQUIRED reading and it OUTRANKS memory, habit, and every other
doc in this repo.** Before you touch ANY file that produces, validates, schedules,
displays, or records a CCRS file — or any schema/route/component those files depend on —
you MUST, in this order:

1. Read `docs/ccrs-bible/00-INDEX.md`, then `01-standing-rules-and-handoff.md` (the
   owner's binding rules + the 8-step slice protocol), then `05-owner-decisions-log.md`
   (what the owner has already decided — do not re-litigate or "improve" on it), then
   `04-current-state-and-gap-matrix.md`, then `09-slice-plan.md` (the slice order is
   BINDING; find the slice your work belongs to and follow it).
2. Ground every CCRS rule you rely on with a pin into `02-authoritative-spec.md`
   (`[G L####]`, `[FAQ L####]`, `[API L####]`, `[LOGIN/ADMIN/SAW/MANI L####]`,
   `[TPL <File> R#]`). **A CCRS statement with no pin is an opinion; it goes in
   `12-unverified-register.md` as a `U-xx`, NOT into the code.**
3. Ground every code anchor against `03-code-anchor-atlas.md` and confirm it has not
   moved: `git diff <atlas commit> -- <file>`. If it moved, REGENERATE the atlas
   (`python3 scripts/ccrs-bible/build_atlas_part.py`) and re-pin BEFORE writing code.
4. Tests first, with the spec pin written as a comment in the test. Then implement.
   Then update Part 04 (status), Part 12 (if a `U-xx` closed), and regenerate Part 03
   **in the same PR**.
5. Run the pin checker before opening the PR:
   `python3 scripts/ccrs-bible/check_pins.py` — it must report `range_errors=0`.
6. **Test the tests.** Before opening the PR, prove your new tests can actually fail:
   `python3 scripts/ccrs-bible/mutate_check.py` — it must report `0 survived`. Add a
   mutation for each behaviour your slice introduces. A test that cannot fail is not a
   test (Part 05 D-10, D-11). Beware two false greens: a broken harness/flag that exits
   before any test runs, and an *equivalent mutant* whose arithmetic self-limits — in
   S-01 two "thorough" assertions could not fail until the fixture shape changed.

**Never guess, never assume. Never "fix" a CCRS format from memory of another state's
system. Never treat a `warning` as safe — several guide-listed hard errors are still
warnings in this codebase (Part 04 W1/W2/W4/W12/W15).** Do not test against production
CCRS; all unknowns are settled in PREproduction (`https://precannabisreporting.lcb.wa.gov`)
per Part 06. If the bible does not cover what you are about to do, STOP and add it to the
bible first — that is the whole point of the document.

Regenerate the reference volumes (never hand-edit Parts 02 or 03):

```bash
python3 scripts/ccrs-bible/build_spec_part.py    # needs the LCB sources (Part 13 §E)
python3 scripts/ccrs-bible/build_atlas_part.py   # reads this working tree
python3 scripts/ccrs-bible/check_pins.py         # every pin must resolve
python3 scripts/ccrs-bible/mutate_check.py      # your tests must be able to FAIL
```

The POS / back office MUST strictly adhere to the WA LCB **Cannabis Central Reporting
System (CCRS)** at all times. Compliance protects the owner's license. For ANY change
that touches inventory, sales, products, strains, areas, adjustments, transfers, tax,
manifests, or any file/data the LCB ingests, you MUST:

- **Ground against the authoritative spec — never guess a CCRS field, column, enum,
  format, or rule.** Verified sources (re-verify against the LIVE current versions):
  - CCRS Resources + current `.CSV` templates: https://lcb.wa.gov/ccrs/resources
  - **CCRS Data Model File Specifications Manual** (PDF) — field types, lengths,
    required flags, and **valid-value enums** (SaleType, StrainType,
    InventoryCategory/Type, AdjustmentReason, Boolean columns, etc.).
  - CCRS Upload User Guide (CIB / dated) and `docs/ccrs-data-model.md`,
    `docs/ccrs-templates/*.csv` (kept in sync with the live templates).
  - Manifests: https://lcb.wa.gov/ccrs/manifests
- **Every generated CCRS file MUST be upload-valid:**
  - The **3-row common header** (`SubmittedBy,<v>` / `SubmittedDate,<v>` /
    `NumberRecords,<v>`) with `NumberRecords` EXACTLY equal to the data-row count,
    then the exact template **column header row**, then data rows. Use `\r\n`.
  - **Exact template column names + order** (e.g. Sale uses `RetailSalesTax` /
    `CannabisExciseTax`; InventoryAdjustment includes its own `ExternalIdentifier`).
    There is ONE authoritative column spec: `src/lib/compliance/ccrs-batch-core.ts`
    `CCRS_COLUMNS`. Do not duplicate/diverge it.
  - **Valid enum values only** — validate SaleType, StrainType,
    InventoryCategory/InventoryType, AdjustmentReason, Booleans (`TRUE`/`FALSE`)
    against the Data Model Manual. Unknown values → keep the value but raise an
    **error-level sync warning** for the employee; never invent one.
  - **Text-length clamps** per the manual (e.g. Product.Name 75, Description 250).
  - **Pacific calendar dates** (`pacificDayKey`) formatted `MM/DD/YYYY` — never UTC.
  - **Stable, non-drifting external identifiers** reused consistently across files
    (`src/lib/compliance/ccrs-identifiers.ts`).
  - Respect the **order-of-operations** groups (Strain/Area/Product → Inventory →
    Adjustment/Transfer/Sale) and CCRS rules (e.g. no sale of quarantined inventory).
- **Add guardrails, not just fixes.** Prefer PURE, unit-tested normalize/validate
  layers that flag non-conformant data BEFORE it can be uploaded (CCRS only notifies
  failures by email, so catch them here).
- **Keep the spec docs current.** When the LCB updates a template/manual, update
  `docs/ccrs-data-model.md` + `docs/ccrs-templates/` and re-verify generators. Also
  re-download per `docs/ccrs-bible/13-sources.md` §E, compare md5s, regenerate Part 02,
  and re-verify EVERY pin whose line moved.
- The living audit + findings ledger is `docs/CCRS_COMPLIANCE_AUDIT.md`.
- The authoritative roadmap, gap matrix, PREprod test plan, and UNVERIFIED register are
  `docs/ccrs-bible/` (see the MANDATORY FIRST STEP above). The old
  `docs/CCRS_WEEKLY_UPLOAD_BIBLE.md` was superseded and deleted.

## 🔴 DOH MEDICAL CANNABIS COMPLIANCE — ALWAYS RESPECT (BINDING)

The medical program MUST strictly adhere to WA **DOH** (Medical Cannabis Registry / MCR)
and the medical provisions of LCB rules at all times. Compliance protects the owner's
license and the patient. For ANY change that touches medical patients, recognition
cards, authorization intake, tax exemptions (sales/excise), possession/purchase limits,
DOH-compliant products, or the medical audit trail, you MUST:

- **Ground against the authoritative sources — never guess a DOH rule, field, rate,
  limit, or date.** Verified sources (re-verify against the LIVE current versions):
  - DOH **Medical Cannabis Registry (MCR)** program page (replaced "Airlift" on
    2025-06-30). There is **NO public retailer API** — staff validate cards by logging
    into the MCR; our system stores the **validation result**, it never calls the MCR.
  - **RCW 69.51A** (esp. `.230` recognition-card unique patient identifier / dates),
    **RCW 69.50.375/.535**, **HB 1453** (DOH 608-050 FAQ), **DOH 608-048** (authorization-
    form validation checklist), **WAC 314-55-090** (recognition-card sales + the
    `(2)` excise-exempt recordkeeping, 5-yr retention; `(6)` exemption sunset
    **2029-06-30**), **WAC 246-70-040** (DOH-compliant product), **WAC 314-55-095**
    (purchase limits). The living reference is `docs/medical-doh-requirements.md`.
- **Never issue a card unless DOH 608-048 is fully satisfied.** All four form checks
  (complete/signed, tamper-resistant paper w/ security feature, identity verified,
  embossed RCW 69.51A.030 seal) MUST be verified server-side. If ANY cannot be
  verified → do NOT create a card. A UPID is required whenever the patient is marked
  in the MCR; effective ≤ expiration; never issue an already-expired card.
- **Two tax exemptions — never conflate them.** Sales tax (9.3%) exempt for a
  carded patient/DP buying ANY cannabis at a medically-endorsed store. Excise (37%)
  exempt ONLY when ALL THREE hold: endorsed retailer + valid **in-MCR** card + product
  is **DOH-compliant** (WAC 246-70-040). An expired/invalid card grants NO exemption.
- **Retain the WAC 314-55-090(2) record for every excise-exempt sale for 5 years**
  (date, UPID, card effective + expiration, product SKU, sales price). If we cannot
  produce it, excise is presumed owed. Keep the durable `medical_exempt_sales` ledger.
- **Enforce the 3× carded purchase limits** (WAC 314-55-095: 3 oz usable, 48 oz
  solid, 216 oz infused-liquid, 21 g concentrate) for carded patients.
- **Protect PHI.** Scanned authorization forms and patient data are sensitive: keep
  them in the PRIVATE `medical-forms` bucket (staff-only), never public; audit access.
- **Add guardrails, not just fixes** — PURE, unit-tested validate layers that BLOCK a
  non-compliant card/exemption before it can happen. Drafts-only for anything crawled.
- The living reference is `docs/medical-doh-requirements.md`; keep it current.
<!-- END:greenway-standing-rules -->
