# 14 — THE FULL-SYSTEM BATTLE PLAN
### Five branches tested separately, then one end-to-end dry run
### Companion to file 13 (staging setup). Michael's directive, Aug 2026.

> **WHERE THIS LIVES:** repository root, `BATTLE_PLAN.md`.
> **Companion:** `BATTLE_PLAN_STAGING_SETUP.md` (how to build the staging site this plan runs against).
> **Related:** `docs/security/IS-ADMIN-AUDIT-REPORT.md` (the admin access-control audit).
>
> This is the master plan for battle-testing every branch of the system.
> It is kept at the repository root deliberately so it is not lost in `docs/`.

---


---

## 0. WHY THIS DOCUMENT EXISTS

File 13 explains how to BUILD the staging site. This file explains WHAT WE DO
once it exists.

Michael's instruction:

> "I would like to battle test the website, the website editor, the pos system,
> the financial branch and the bookkeeping/tax branch, each separately, then a
> full dry run starting from one end of the pipeline going all the way through
> to the other end."

That is the correct order and it is the order a real audit uses. You test each
control in isolation so that when something breaks you know WHICH control broke.
Then you test the whole chain, because a system can pass every unit test and
still fail at the seams. Most real-world failures live at the seams.

**Standing rules 13–19 apply to every line of this document.** Nothing here is
"try it and see." Every phase below has a defined attack list, a defined
evidence artifact, and a definition of done.

---

## 1. THE SIX PHASES

| Phase | Branch | Gate to start | Evidence artifact |
|---|---|---|---|
| **A** | Website (public storefront) | staging live | file 15 |
| **B** | Website editor / CMS | A complete | file 16 |
| **C** | POS system | B complete | file 17 |
| **D** | Financial branch (banking, ATM, cash) | C complete | file 18 |
| **E** | Bookkeeping + tax branch | F4–F10 built | file 19 |
| **F** | **END-TO-END DRY RUN** | A–E all complete | file 20 |

Phases A–D can begin as soon as staging exists. Phase E depends on slices F4
through F10, which are not built yet. **Phase F is gated on all five.** Running
the end-to-end dry run before the branches are individually clean would tell us
only that "something is broken somewhere," which is worthless.

---

## 2. WHAT MICHAEL IS PROVIDING (and what it unlocks)

Michael offered five categories of real material. Each unlocks specific tests
that are otherwise impossible. Recording exactly what each is FOR, so nothing is
collected that we do not have a use for.

### 2.1 Real CCRS manifests and vendor invoices
**Unlocks:** Phase F, the real pipeline trace.
**Privacy:** Michael is correct — WA I-502 vendor identities and line-item
product data are public record by statute; licensees are required to report
line-item detail to the LCB. There is no PII in a manifest. **Confirmed, not
assumed:** the repo's own parsers already treat manifest data as
non-PII, and the LCB FAQ confirms licensee reporting is line-item public
submission. Customer data is a different matter entirely and is addressed in §7.

### 2.2 Real invoices (vendor bills)
**Unlocks:** the purchase → A/P → COGS → 280E cost-classification path, which is
the single highest-stakes accounting path in the entire system. A misclassified
purchase is a 280E deduction error, and 280E errors are what turn an audit into
a catastrophe.

### 2.3 AI credits
**Unlocks:** honest evaluation of every AI feature (§5). Michael asked for a
verdict on "effectiveness and worthiness" — that means some features may come
back with the recommendation **turn this off**. That is a legitimate outcome and
I will say so plainly if I find it.

### 2.4 Months of CCRS market data (entire WA recreational market, line item)
**Unlocks:** the benchmark engine and the local-competition reporting. This is
the single most valuable dataset Michael can give me, because it is the actual
denominator. Everything the benchmark system claims can be checked against it.

### 2.5 Simulated months of business data
**Unlocks:** forecasting and reporting. **Important distinction:** simulated data
tests whether the MATH is right and whether the reports hold up under volume. It
CANNOT validate forecast accuracy, because a forecast tested against synthetic
data that was generated from a model only proves the model agrees with itself
(standing rule 15b — that is a tautology, not a test). Forecast ACCURACY can
only be judged against real history. §6 handles this correctly.

---

## 3. PHASE A — THE PUBLIC WEBSITE

**What it is:** everything a customer sees without logging in. Menu, product
pages, store info, ordering.

**Attack list:**
- Price displayed on the menu vs. price the POS would actually charge. Any
  mismatch is both a customer-trust problem and, in WA, an advertising problem.
- Products showing that are out of stock, inactive, or not yet compliant.
- Products showing that should be hidden (medical-only to a non-medical view).
- Potency/attribute claims rendered from enrichment data that do not match the
  COA on file. **This is a regulatory exposure, not a cosmetic one.**
- Order form: quantity limits (WA per-transaction carry limits), negative
  quantity, absurd quantity, zero, unicode in name fields, injection strings.
- Age gate: can it be bypassed by URL, by cookie edit, by direct link to a
  product page?
- Cached menu vs. live inventory — does an out-of-stock item stay purchasable?
- Rapid-fire duplicate order submission (double-click, retry after timeout).

**Definition of done:** every price and potency on the public menu traced to its
source record; every limit enforced server-side, not merely hidden in the UI.

---

## 4. PHASE B — THE WEBSITE EDITOR / CMS

**What it is:** the tools that let Michael change the site without a developer.

**Attack list:**
- Can a non-admin reach an editor route directly by URL? (Authorisation must be
  enforced server-side on every action, not by hiding a nav link.)
- Publish an unsaved/half-finished page. Publish, then immediately revert.
- Content that breaks layout: enormous text, 8MB image, unicode, RTL text,
  HTML/script in a text field (stored XSS).
- Does the editor let Michael publish something that violates WA cannabis
  advertising rules? (Health claims, appeal to minors, free-product promotion.)
  If the platform can publish it silently, that is a gap worth closing.
- Concurrent edit: two sessions editing the same page. Last-write-wins silently
  destroying the other edit is a real defect.
- Rollback: does the previous version actually restore, completely?

**Definition of done:** no editor action succeeds without a server-side
permission check; no content path allows stored script; rollback proven by
byte-comparison.

---

## 5. PHASE C — THE POS SYSTEM

**What it is:** the till. The place where money and inventory actually move.
This phase gets the most aggressive testing of the five, because a POS defect
costs cash on the day it happens.

**Attack list — money:**
- Change due on cash tender: sweep the full range, prove no cent is invented or
  lost (rule 13d). Float is forbidden in this path (rule 13e).
- Excise tax (37%) and sales tax computed on the correct base, in the correct
  order, with the correct rounding. Verified against the LCB's own worked
  example from the CCRS FAQ: QTY 3 @ $5.00, discount $3.00 → sales tax $1.20,
  excise $4.44.
- Medical exemption: a qualifying medical sale must charge **neither** sales tax
  **nor** excise tax, and per the LCB that exemption **is not a discount** and is
  **not optional**. Attack: apply it to a non-qualifying sale; apply it with an
  expired card; apply it to a non-medically-compliant product. All three must be
  refused.
- Discounts: stacking, negative discount, discount exceeding line total,
  discount applied after tax instead of before.
- Split tender, overpayment, underpayment, tender of $0.
- Void and return: **the return path is where Michael's historical
  backwards-card-signs failure lives** (rule 19). Return of a discounted item,
  return of a taxed item, partial return, return of an item never sold, double
  return of the same line.

**Attack list — inventory:**
- Sell more than on hand. Must refuse; must never produce a negative balance
  (rule 19: negative inventory is on the permanent corpus).
- Concurrent sale of the last unit from two registers at the same instant.
- Sell an item whose lot has been recalled, expired, or quarantined.

**Attack list — till/cash:**
- Till count that does not reconcile; forced close with a variance.
- Negative till. Drawer opened without a sale. Mid-shift till handoff.

**Definition of done:** every money computation swept, not sampled; every refusal
asserts its SPECIFIC error (rule 13c); the return path proven to reverse signs
correctly in every combination.

---

## 6. PHASE D — THE FINANCIAL BRANCH

**What it is:** banking, the ATM operation, cash handling, and the bridges
between them.

**Attack list:**
- Bank feed: duplicate transactions on re-sync, transactions arriving out of
  order, a transaction that changes amount after import, a pending transaction
  that later settles at a different value.
- **ATM: negative cash is on the permanent failure corpus (rule 19).** Attack
  every path that could produce it — vault load, dispense, reconciliation,
  surcharge revenue recognition.
- Cash: deposit recorded twice, deposit recorded that never reached the bank,
  vault count vs. till counts vs. deposit slip three-way mismatch.
- The cash-only reality: Greenway operates cash-only, so the cash controls ARE
  the financial controls. There is no card processor to catch an error.

**Definition of done:** three-way cash reconciliation (till → vault → bank)
proven to refuse any combination that does not tie, with the specific variance
reported rather than silently plugged (rule 12: **silent plugs are forbidden**).

---

## 7. PHASE E — BOOKKEEPING AND TAX

Gated on slices F4–F10 plus the tax branch. Detailed attack list will be written
per slice as each is built, following the F1/F2/F3 pattern already established.
The permanent corpus (rule 19) is replayed against every one of them:

- the **$4,624,697.31 LAZY INVENTORY ENTRY** plug
- negative inventory balances
- backwards card signs
- negative ATM cash
- the `GRWNY`/`GRNWY` entity typo that hid 18 live accounts including all payroll
- debit-A/P-credit-revenue
- pre-2026 backdating

**The tax forms deliverable.** Michael wants real forms generated from real data
for his grandfather (Nicholas Mullan, his accountant) to verify and sign off.
This is the correct final gate and I want to state the standard plainly:

> A generated tax form is not "done" when it computes. It is done when a
> practising accountant reviews it against the source records and signs it.

Every generated form must ship with a **tie-out worksheet**: every number on the
form traced to the journal entries that produced it, so Nicholas can audit the
form without reverse-engineering our software. A form he cannot verify is a form
he cannot sign, and an unsigned form is worthless to Michael.

---

## 8. THE CCRS TEST SUBMISSION — **THE MOST IMPORTANT FINDING IN THIS DOCUMENT**

Michael asked:

> "I want to test somehow uploading a test report to the CCRS system to see if
> it passes or fails."

**Michael — this is not only possible, the LCB built it for exactly this
purpose, and it is free.** I verified this from the LCB's own published
documents rather than assuming.

### 8.1 There is an official PREproduction environment

From the LCB's CCRS FAQ, verbatim:

> **Q: Does CCRS provide an integration sandbox for integrators to develop
> against?**
> **A: The LCB provides all cannabis licensees, labs and integrators access to
> the PREproduction CCRS environment for training and testing.**

Note "**all cannabis licensees**" — that includes Greenway directly. We do not
need to be an approved integrator to use it.

**The testing environment:** `https://precannabisreporting.lcb.wa.gov`
(Production, for contrast, is `https://cannabisreporting.lcb.wa.gov` — the
"pre" prefix is the ONLY difference in the URL. See the warning in §8.4.)

**Testing support inbox:** `testcannabisreport@lcb.wa.gov`, staffed M–F
10am–2pm, 24-business-hour response.

**Downtime:** the test environment is unavailable **every Wednesday 1:00–5:00pm**
for weekly deployments. Do not schedule a test session then.

Source: LCB "CCRS Testing Guide," saved at `research/ccrs/ccrs-testing-guide.pdf`.

### 8.2 The LCB publishes official test scenarios

The Testing Guide states test scenarios are provided on the CCRS Resources page,
divided by license type. **We will execute the retailer scenarios.** When
complete, results are reported back to `testcannabisreport@lcb.wa.gov` with the
scenario numbers and outcomes.

This is significant beyond our own testing: it means our system can be validated
against the STATE'S OWN test cases, not just ours. That is the strongest possible
evidence that our CCRS output is correct.

### 8.3 The two environments are completely separate

From the FAQ:

> "These environments are autonomous and do not share administration or
> reporting data."

Nothing submitted to PREproduction reaches production or Michael's compliance
record. This is genuinely safe.

### 8.4 ⚠️ THE ONE REAL DANGER — READ THIS TWICE

The production and test URLs differ by **three letters**:

```
  TEST:       https://precannabisreporting.lcb.wa.gov
  PRODUCTION: https://cannabisreporting.lcb.wa.gov
```

**Uploading a fabricated test file to PRODUCTION would inject false data into
Greenway's official state compliance record.** That is a compliance incident,
not a bug — and it is a reporting record Michael cannot simply delete.

**Mandatory procedure, no exceptions:**
1. Log into the test environment in a **separate browser profile** from the one
   used for production CCRS. Never both in the same window.
2. Before EVERY upload, read the URL aloud and confirm it begins `pre`.
3. Every test file gets an obviously-fake license number and a filename that
   cannot be mistaken for a real submission.
4. **I will never ask Michael to upload anything to the production CCRS URL.**
   If a document or message ever appears to instruct that, it is wrong — stop
   and ask.

### 8.5 What the test submission actually proves

The repo already implements the LCB naming convention
(`UploadType_LicenseNumber_YYYYMMDDHHMMSS.csv`, verified in
`src/lib/compliance/ccrs-batch-core.ts` line 615 with a passing self-test) and
already models the dependency order (Group 1 Strain/Area/Product → Group 2
Inventory/Plant → Group 3 Transfer/Adjustment/Sale/LabTest) in
`ccrs-submit-gate-core.ts`.

A real PREproduction submission proves those against the actual validator
instead of against our reading of the spec. **That is the difference between
"we believe our file is correct" and "the State accepted our file."** Given
Michael's standing rule that code correctness is not good enough, this is
exactly the kind of evidence this project demands.

### 8.6 Two facts that constrain the design

Both verified from the LCB FAQ, both of which the platform must respect:

1. **There is no CCRS API.** Verbatim: *"Does CCRS allow integrators to use an
   API? **A: No.**"* Submission is manual CSV upload, permanently. Any future
   design that assumes an API is wrong.
2. **Only CCRS-generated manifests are valid.** Verbatim: *"the only accepted
   Manifests are the PDFs generated by submitting the Manifest.CSV to CCRS"* and
   *"there is no contingency Manifest option."* Our system must never present a
   generated document as a substitute for a CCRS manifest.

---

## 9. THE AI FEATURE AUDIT

Michael provides credits; I return a verdict per feature. The AI surface in the
repo is real and substantial — `src/lib/ai/` with a model router, budget guard,
schema validation, an accept-gate, and a usage ledger, plus enrichment,
benchmarks, forecast commentary, and compliance advisory.

**What the router already does right** (verified by reading it): it separates
"sprint" from "maintenance" mode, routes heavy tasks to a strong model only in
sprint, and enforces **hard monthly token and dollar caps** that refuse to spend
rather than warning. That is the correct shape — it refuses rather than asks
(rule 14).

**How each feature will be graded:**

| Criterion | Question |
|---|---|
| **Accuracy** | Measured against ground truth from Michael's real manifests and COAs. Not vibes. |
| **Failure mode** | When it is wrong, is it wrong LOUDLY (flagged for review) or SILENTLY (written into the catalog)? Silent wrong is disqualifying. |
| **Cost per unit of value** | Dollars per product enriched, against the alternative of doing it by hand. |
| **Reversibility** | Can a bad AI write be identified and undone? |
| **Necessity** | Would a deterministic rule do this job better? **If yes, the AI feature should be deleted.** |

That last row is where I expect to deliver unwelcome news, and it is the row
Michael is paying me to be honest about. AI applied to a problem that a lookup
table solves is bloat — and Michael explicitly said *"we don't want bloat."*
Every feature that survives this audit will have earned it.

**The hard line on enrichment:** AI-generated potency, test results, or
compliance attributes must **never** be written to a customer-facing field or a
regulatory field as fact. Descriptions and imagery are marketing. Potency is a
regulated claim that must trace to a COA. Any place the current system blurs
that line is a defect and I will report it as one.

---

## 10. SIMULATED DATA AND FORECASTING — DOING THIS HONESTLY

Michael asked for months of simulated business data to test forecasting.
I will build it, with one methodological correction stated up front.

**What simulated data legitimately tests:**
- Report math at volume (does a year of data still tie?)
- Performance and pagination
- Period boundaries: month-end, quarter-end, year-end, **leap day**, DST
  transitions, the 53-week year problem
- Whether the books still balance after 100,000 transactions

**What simulated data CANNOT test:** forecast accuracy. If I generate data with
a weekly pattern and the forecaster detects that weekly pattern, I have proven
nothing except that my generator and my forecaster share an assumption. That is
standing rule 15b — a predicate that cannot return false is not a test.

**The honest method (backtesting on real history):** hold out the last N weeks of
Michael's REAL data, forecast them from the earlier data only, and measure the
error against what actually happened. The forecast core already exposes a
`ForecastAccuracy` type, so the plumbing exists.

**Therefore the simulator will be adversarial, not flattering.** It will
deliberately include the things that break naive forecasters: holiday spikes,
420 and Green Wednesday, a supply gap where a top SKU is unavailable for two
weeks, a price change mid-period, a competitor opening nearby, and a week with a
data outage. A forecaster that only works on clean synthetic data is useless in
Port Orchard.

---

## 11. THE BENCHMARK / COMPETITIVE INTELLIGENCE TEST

Michael's framing:

> "test our benchmark system and local competition benchmark reporting so we
> have full confidence in our ability to crush them using their data against
> them."

The engine exists (`local-benchmarks-core.ts`, `benchmarks-core.ts`,
`benchmarks-history-core.ts`). With full-market CCRS line-item data, we can do
something most retailers never can: **check the benchmark engine against the
actual denominator.**

**Attack list:**
- Does our computed market share match a hand-computed share from the raw file?
- Category mix, average unit price, and price-per-gram vs. the market — each
  recomputed independently and compared.
- Trading area definition: does "local competition" use a defensible radius, and
  does the answer change materially if that radius changes? A benchmark that
  swings wildly on an arbitrary parameter is a benchmark that should not drive
  decisions.
- Small-denominator trap: a category with 3 sales in the trading area will
  produce a wild "market share" number. **The system must suppress or flag
  low-sample comparisons rather than present them confidently.** This is the
  single most likely way this feature misleads Michael into a bad pricing call.
- Stale data: is a benchmark built on a two-month-old file clearly labelled as
  such?

**The value framing.** Michael wants to compete on data. The way that goes wrong
is confident numbers built on thin samples driving a price cut that costs margin.
So the deliverable here is not just "the math is right" — it is **"here is
exactly how much confidence each number deserves."** That is what a CFO would
demand before repricing.

---

## 12. THE END-TO-END DRY RUN (PHASE F)

The whole point. One real manifest, traced from arrival to tax return, with
every intermediate value checked.

**The chain, as it actually exists in the repo:**

```
 1. Vendor emails manifest  →  Resend inbound webhook
                               (api/webhooks/inbound-email)
 2. Inbound email parsed / harvested        (lib/inbound-email/*)
 3. Manifest staged + deduped               (manifest-dedupe-core)
 4. PDF/CSV parsed — GrowFlow, OpenTHC,
    Cultivera, CCRS CSV formats             (pdf-*-manifest-core)
 5. Intake checklist walks the receive:
    pending → in_transit → received →
    accepted / partially_accepted / rejected (intake-checklist-core)
 6. Lots created, dispositions recorded      (intake-store)
 7. KB bridge links products to knowledge    (manifest-kb-bridge)
 8. Enrichment: photos, descriptions,
    attributes, potency                      (lib/enrichment/*, lib/ai/kb/*)
 9. Mastering + menu staging                 (pos/intake-mastering-core,
                                              intake-menu-staging-core)
10. Product live on menu / POS
11. SALE at the register
12. Inventory decrements
13. CCRS reporting (Inventory, Sale,
    Adjustment, Transfer)                    (compliance/ccrs-*)
14. Vendor invoice → A/P → payment
15. → GENERAL LEDGER (F1/F2/F3 door)
16. → trial balance, financials (F4+)
17. → excise / B&O / sales tax returns
18. → federal 1120S + K-1s, personal 1040
```

**The three questions the dry run answers:**

1. **Does the quantity survive?** Grams on the vendor's manifest must equal
   grams received, equal grams available for sale, equal grams reported to CCRS,
   equal grams relieved from inventory when sold. **Any break in that chain is
   both an inventory error and a traceability violation.**
2. **Does the money survive?** Invoice total must equal A/P recorded, equal cash
   paid, equal inventory capitalised, equal COGS relieved on sale, equal the
   COGS line on the tax return. This is the drift Michael has been living with,
   traced end to end for the first time.
3. **Does the classification survive?** The 280E cost class assigned at
   purchase must be the class that lands on the return. A product reclassified
   mid-stream is a tax error.

**Seam-by-seam checks** (seams are where systems fail):
- email → staging: manifest arrives twice; arrives corrupted; arrives from an
  unknown sender; arrives with the PDF but no CSV
- staging → intake: partial acceptance, rejected line, quantity variance between
  manifest and physical count
- intake → menu: a product that fails enrichment — does it silently reach the
  menu with missing data?
- menu → POS: price changed between menu render and sale
- POS → CCRS: a sale voided AFTER the CCRS week was reported (per the LCB, a
  retail return requires the sale identifier to be **deleted** from CCRS and the
  inventory reported on an Inventory Adjustment as a return — our system must
  produce exactly that, not an ad-hoc correction)
- everything → GL: the F3 door refuses anything unbalanced, so the real question
  is whether upstream produces balanced, correctly-classified entries at all

**Definition of done for Phase F:** one manifest traced from vendor email to a
line on a tax form, with a written tie-out at every one of the 18 steps, and
every quantity, dollar, and cost class reconciled at each step. Any break gets
its own defect report before Phase F is called complete.

---

## 13. WHAT MICHAEL NEEDS TO COLLECT

In priority order. **Nothing here contains customer information.**

1. **2–3 real CCRS manifests** (PDF and CSV if both exist) with the matching
   vendor invoices. Ideally: one clean, one that had a problem (short shipment,
   wrong item, price discrepancy). **The messy one is worth more than the clean
   one.**
2. **A few months of full-market CCRS data** for the benchmark tests.
3. **AI credits** — an API key set as `AI_API_KEY` **on staging only**, with
   `AI_MONTHLY_USD_BUDGET` set to a number Michael is comfortable losing
   entirely. The budget guard is already built; staging should prove it refuses
   at the cap.
4. **CCRS PREproduction login** (§8), set up in a separate browser profile.
5. **A COA or two** matching the manifests, so enrichment potency claims can be
   checked against the actual lab result.

**Explicitly NOT wanted:** customer names, phone numbers, loyalty records,
medical card data, or any production database dump. Staging gets realistic
SHAPES, never real people. If a test ever appears to need customer PII, that
test gets redesigned instead.

---

## 14. DELIVERABLES

One report per phase, each in plain English, each containing:
- what was attacked, and what happened
- every defect found, with the exact reproduction steps
- every defect FIXED, with the evidence it is fixed
- what I could not test, and why (**stated plainly — an untested area silently
  omitted is how false confidence gets built**)
- a recommendation per AI feature: keep, improve, or delete

And at the end, one consolidated document: **"What this system does, what it
refuses to do, and where it is still soft."** That last section will exist. Any
report claiming a system this large has no soft spots is a report that was not
written honestly.

---

## 15. BLOCKING GATES BEFORE GO-LIVE (2026-11-01)

These are not suggestions and they are not "nice to have". Each one is a
**hard gate**: the system does not go live with any of them open. They are
recorded here rather than in a working file because a promise kept only in
conversation is a promise that gets lost.

### R1 — re-gate the 20 financial policies to `is_admin()`  **[OPEN]**

Twenty tables carrying financial data are still readable/writable under
policies broader than they should be. The fix splits read from write and gates
write on `is_admin()`.

**Sequencing matters and getting it backwards breaks the business:** inventory
the sync-job callers FIRST. Plaid and the crypto sync run as service callers,
and if their access is tightened before they are inventoried, bank and wallet
sync fail silently — which is worse than the original problem, because the
books then look settled while going stale.

**Owner decision still needed:** which of these tables (if any) managers
legitimately need to read day to day. Michael has said he intends to be the
only person performing administrative work, which likely makes this "none" —
but that is his call to state explicitly, not mine to assume.

**Done when:** every one of the 20 tables has its own attack in the suite
proving a non-admin is refused, plus a negative control proving an admin is
allowed. Structural assertions on `pg_policy` are required, because the test
harness runs as a superuser and therefore BYPASSES RLS — a behavioural test
alone would pass against a table with no protection whatsoever.

### R3 — remove the bootstrap backdoor  **[OPEN]**

The bootstrap path that allows the first admin to be created must be closed
once Michael's own admin account exists. It is a legitimate chicken-and-egg
solution during construction and an unlocked door in production.

**Done when:** the path is removed or hard-gated, AND the suite contains an
attack proving it can no longer be used to mint an admin.

### Why these are deferred rather than done now

Both change WHO can do things, and both are best applied when the set of real
accounts is final. Doing them early means re-doing them. Doing them late means
forgetting them — hence this section.

---

## 16. KNOWN ENVIRONMENTAL LIMIT (not a code defect)

`next build` compiles successfully and is then `SIGKILL`ed while running the
TypeScript worker. This is the build sandbox running out of memory (3.9 GB;
the kernel log shows `Out of memory: Killed process (node)`), not a fault in
the code. `tsc --noEmit` performs the same type-check and passes with zero
errors, and is the gate relied upon in its place.

Stated here plainly rather than quietly omitted, per §14: an untested area
silently left out is how false confidence gets built. If this ever needs to be
closed properly, it needs a build machine with more memory — not a code change.
