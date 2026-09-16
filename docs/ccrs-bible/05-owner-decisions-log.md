# 05 — Owner Decisions Log

Dated 2026-09-15 (session 2 → 3 of the CCRS strategy work). Every decision below is quoted verbatim from the owner, followed by (a) the LCB fact that bears on it and (b) exactly what it changes in the plan. New decisions get appended with a date; nothing is ever edited in place.

## The seven questions and the owner's answer (verbatim, one message)

> "Thank you. for question 1, i have not uploaded any csv files yet, we are still in the development stage. my weekly upload is handled by cultivera currently, we will be migrating from them soon. we need to make sure the upload process works first, its about the last thing we need to lock in and perfect. i have reached out to my enforcement officer asking how i test uploads before going live. unless you already know how to make test uploads. for question 2, no, we have not made any uploads yet. for question 3, yes, we are a retailer and receive product, we transfer product back to the vendor, we destroy product, we do all the things a retail cannabis business would do. if it is required by the lcb or ccrs, then yes i want InventoryTransfer.csv populated from those manifests. i am not entirely sure i understand the question. if its required yes, if not, please explain better what the advantage would be for doing so or not doing so. I have not been asked by the examiner about missing transfers, we have not made any uploads yet. for question 4, we are not currently medically endorsed yet, but we will be making that election soon, the system is built and ready to create new patients, register medical doh products to the registry, sell and track all medical sales, etc. for now though, we need to leave IsMedical=FALSE for now until we are ready to flip that switch. for question 5, yes, this feels like a professional and necessary addition that would add value for our system. for question 6, yes i like this idea very much. i want one central command center/ HUB that allows me to do all work flows from that one centralized hub. if it is ccrs weekly upload related, it should live in the hub. for question 7, ideally, i would like to begin work on this now if possible so we can get ahead of the curve before the transition happens. from my understanding though, the only change is how i login to my portal account. the weekly upload will remain the same in every way. but if i am wrong about that, we should know sooner than later so we dont get bit in the butt. now that you know more details about where we are at in the project, i want you to update and modify the roadmap strategy so we build each slice properly so they add value rather than make it worse for me. the ccrs weekly upload bible is good, but i think you can do so much better. i want you to now create a detailed strategy roadmap for you, the ai, to follow. it should anchor code lines and work from verbatim authoritative sources. i want this roadmap task list todo list strategy document to lay out every single detail that needs to be worked on. if it is not included in this document, future ai agents will drift and we will start building garbage. this report has to be so incredibly detailed that when agents handoff the new agent can look at this document and say with 100% confidence it knows where to start and what is left to build. this document should be thousands of lines long so that there is no possible way to drift from it. if you need to create this new roadmap strategy bible in multiple slices so it is supremely accurate, that is fine with me. i would rather spend extra here so we can create a very well thought out and brilliant plan, then try to make it up on the fly as we go trying to remember back to this point what we need to do next. so again, complete this report in multiple slices if you need. recon, research, report in logical batches. i want to make sure we build this part of the process right, my license depends on this feature working flawlessly. follow the standing rules and never guess, never assume. go above and beyond. no code edits, more strategy. remember, i want a bible roadmap report that is thousands of lines long. i do not plan on reading this document, it is for you. you do not need to condense it or summarize it, or anything like that. give yourself the full report, with everything included, anchors and pins and all. i trust your judgement, so please add as much value as you can. thank you."

## D-01 (Q1/Q2) — No uploads have ever been made; Cultivera files today; migration soon

**LCB facts that bear on it**
- "The LCB provides all cannabis licensees, labs and integrators access to the PREproduction CCRS environment for training and testing." `[FAQ L0088]`
- "These environments are autonomous and do not share administration or reporting data." `[FAQ L0096]`
- PREprod host: "(Pre-Production) precannabisreporting.lcb.wa.gov" `[API L0070]`.
- "Yes, the individual (integrator) uploading the .CSV file would be notified of any errors, but the licensee will not receive an email." `[FAQ L0102]` — so today Greenway sees LCB errors only if Cultivera forwards them.
- "The licensee is ultimately responsible to meet data reporting obligations" `[FAQ L0085]`.
- Only the license admin can add/remove an integrator: Account → Licensee → Edit → Manage Integrators → checkbox → Update `[ADMIN]` Part 02 §5.

**What it changes**
- Answer to "unless you already know how to make test uploads": **yes — PREproduction.** The owner needs a SAW (soon WA.gov) login that reaches `https://precannabisreporting.lcb.wa.gov`; his enforcement officer / examiner (`examiner@lcb.wa.gov`) can confirm his license is provisioned there. Part 06 is the complete test plan.
- Every "UNVERIFIED" in Part 12 must be closed in PREprod or by written examiner answer before the first production upload.
- Part 07 (cutover) is mandatory, not optional: Cultivera is currently filing under Greenway's license with the Barcode as InventoryExternalIdentifier.
- The hub must show `Environment: PREPRODUCTION | PRODUCTION` on every upload event (Part 08) so test uploads never get mistaken for the real ledger.

## D-02 (Q3) — InventoryTransfer.csv: "if it is required by the lcb or ccrs, then yes"

**LCB facts**
- "InventoryTransfer.CSV is required weekly by any licensed facility that receives inventory." `[G L1162]`
- "Only the receiving licensee should submit an inventory transfer report, as typically only the receiving licensee would know what the new external ID is for the inventory." `[G L0126-L0128]`
- Retailer workflow: "The retailer uploads a product to create a product, inventory and inventory transfer files." `[G L0143-L0144]`
- "If a retailer incorrectly enters the 'FromInventoryExternalIdentifier' … They would perform an 'Update' operation … If the license is going to use a new ID, it is important they submit an Inventory Transfer file, to provide both the old and new IDs for inventory items." `[FAQ L0058-L0059]`
- Error strings: "Duplicate InventoryTransfer for Licensee" `[G L1190]`, "Invalid FromInventoryExternalIdentifier … dependent on the seller completing the sales.CSV" `[G L1191]`, "ToLicense cannot be the same license number as FromLicense" `[G L1205]`.

**Plain-language answer for the owner (to be repeated at handoff):** It is required. Every week Greenway receives product, CCRS expects an InventoryTransfer row per received lot: the vendor's license, Greenway's license, the vendor's inventory id, Greenway's inventory id, the quantity, and the date. Vendor returns and destruction are NOT InventoryTransfer rows; they are InventoryAdjustment rows (the code already does that: `disposition.ts` L783 `createVendorReturn` → `other`, L973 `completeDestruction` → `destruction`).

**What it changes:** E14 + N-02 in Part 04 become mandatory (slice S-05). Requires storing the vendor's raw id at intake.

## D-03 (Q4) — Not medically endorsed yet; "leave IsMedical=FALSE for now until we are ready to flip that switch"

**LCB facts**
- "IsMedical: This field may only be marked TRUE if passing test results have been received that verify the inventory meets the standards for compliant medical product as outlined in WAC 314-55-102 & WAC 246-70-050." `[G L0640-L0642]`
- Exemption conditions and $0.00 tax columns `[FAQ L0115-L0121]`; "a tax exemption is not a 'discount.'" `[FAQ L0162]`.

**What it changes:** `buildInventoryFile` L393 hard `"FALSE"` stays. Part 10 holds the flip procedure. The Sale.csv medical path (W6) stays as-is but is not gated by the pre-flight until the flip. The hub's DOH block (page.tsx L532) remains informational.

## D-04 (Q5) — YES to pasting LCB error emails so the ledger reflects the LCB verdict

**LCB facts:** errors only by email `[G L0051]`; fixing → examiner with CSV + forwarded email `[FAQ L0030]`.

**What it changes:** E15/E16/E17 (slice S-06): `ccrs_upload_events` table, paste box in the hub, triage → per-file verdict → ledger status derived, examiner draft prefilled with the exact files.

## D-05 (Q6) — "one central command center/ HUB … if it is ccrs weekly upload related, it should live in the hub"

**What it changes:** E18 + E1-UI (slice S-08): `/admin/compliance/ccrs` is the only page; `/admin/reports/compliance` becomes a pointer card; `LicenseSettingsForm` moves into the hub; every fix-link from the validation queue deep-links to the editor and back.

## D-06 (Q7) — WA.gov: start now; owner believes only the login changes

**LCB facts:** "CCRS will be transitioning to WA.gov in October 2026 … All users need to manually set up a new account." `[FAQ L0010-L0012]`. The Upload User Guide's upload steps reference SAW `[G L0155-L0157]`; the Integrator API already uses `login.wa.gov` tokens `[API]` Part 02 §3. Nothing in any LCB text says the upload UI changes.

**What it changes:** Part 11: (1) dated task to create the WA.gov account before October 2026; (2) walkthrough step 2 text becomes environment-aware; (3) a question to the examiner: "Does the Upload page or file format change with the WA.gov transition?" is logged as **U-10** and answered by written reply, not assumption — owner: "if i am wrong about that, we should know sooner than later".

## D-07 — Roadmap form

Owner: multi-part, thousands of lines, anchors and pins, verbatim sources, no code edits, for the AI not for him. This folder is that deliverable; Part 01 §D is the protocol every later slice follows.

## D-08 — Commit the bible; delete v1; version the generators (2026-09-15)

Owner, verbatim: "Please commit all of this work to my git repo. Delete the v1. Yes please copy the two generator scripts into the repo. Please also update the standing rules to required, make mandatory, to read the bible before editing code. Then please proceed with the first slice of the roadmap. Follow the standing rules and never guess, never assume. Test it, test the tests. Go above and beyond for me please."

**What it changes:**
1. `docs/ccrs-bible/` is committed to `main` (docs-only PR, rebase-merged).
2. `docs/CCRS_WEEKLY_UPLOAD_BIBLE.md` (v1) is **deleted** in that same PR — no pointer release. Part 00 updated.
3. The generators are versioned at `scripts/ccrs-bible/{build_spec_part.py,build_atlas_part.py,check_pins.py}` + README, made path-portable via `CCRS_SOURCE_ROOT` / `CCRS_REPO` (verified to reproduce Parts 02/03 byte-identically apart from the timestamp line).
4. **AGENTS.md now makes reading this bible MANDATORY before any CCRS code edit** — new "MANDATORY FIRST STEP" block at the top of the CCRS COMPLIANCE section, with the reading order, the pin rule, the atlas-drift rule, tests-first, and `check_pins.py` as a pre-PR gate.
5. Build begins at **S-01** (Part 09), which is the only slice that depends on nothing from the examiner.

## D-09 — Build order confirmed: start at S-01 (2026-09-15)

Owner: "Then please proceed with the first slice of the roadmap." Part 09's order is therefore binding, not advisory. S-01 = Pacific file stamp `[FAQ L0075]`, header-padding flag (default OFF until U-03 closes), submit-gate self-test registration. No behaviour that depends on an UNVERIFIED item may change its default in this slice.

## D-10 — Testing standard restated by the owner (2026-09-15)

Owner: "Test it, test the tests." Operationally, for every slice: the new test must be observed FAILING for the right reason before the implementation lands, the pure self-test must be registered in `tests/compliance/pure-selftests.test.ts` (so the embedded assertions themselves run under Vitest), and golden fixtures are re-verified after the change. A test that cannot fail is not a test.

## D-11 — Mutation testing is now the definition of "test the tests" (2026-09-15, S-01)

"Test it, test the tests" was executed literally in S-01 by way of a mutation
harness, `scripts/ccrs-bible/mutate_check.py`. It deliberately breaks the
implementation one edit at a time and asserts the suite goes RED. A mutation
that SURVIVES is a hole in the tests, not a pass.

S-01 ran 8 mutations; the first pass was **6 killed, 2 survived**. Both
survivors were real holes in tests that *looked* thorough:

- **M4 (`padHeaderRowsForTemplates` idempotence guard removed) survived.** The
  existing idempotence test could not fail, because after one pad a header row
  has EXACTLY the column count, so the guard computes `",".repeat(0)` — a
  no-op either way. The guard's real job is an **over-wide** row, where
  `width - cells` is NEGATIVE and `String.prototype.repeat` throws
  `RangeError`. A new test feeds an over-wide header row and asserts no throw
  plus no truncation.
- **M5 (padding loop widened past the 3 header rows) survived.** The fixture's
  data rows already carried exactly the column count, so touching them changed
  nothing. A new test uses a deliberately SHORT data row and asserts it stays
  short while rows 0-2 are padded.

After adding those two tests: **8 killed, 0 survived.**

Two further process findings, both of which would have produced a FALSE GREEN:

1. **The harness itself was wrong first.** It invoked Vitest with
   `--reporter=basic`; Vitest 4 removed that reporter, so vitest exited
   non-zero *before running a single test*. Every mutation would have been
   scored "killed" for the wrong reason. The harness now uses `--reporter=dot`
   and refuses to count a kill unless the output contains an actual test
   tally — an infrastructure error is reported INCONCLUSIVE and aborts.
2. **A pre-existing embedded self-test hard-coded the old UTC behaviour.**
   `__runCcrsBatchCoreTests` asserted
   `Inventory_123456_20250102030405.csv`. Under the corrected Pacific rule
   `Date.UTC(2025,0,2,3,4,5)` is 2025-01-01 19:04:05 PST, so the stamp is
   `20250101190405` — deliberately the PREVIOUS calendar day. It was updated
   with a comment warning future agents not to "fix" it back. This was caught
   only because the harness re-runs a green baseline across ALL affected test
   files before mutating; running just the new test file would have missed it.

Standing rule for every future slice: a slice is not done until its mutations
are all killed, and the harness's own failure modes are ruled out first.

## Decisions that are still the owner's to make (do NOT decide these for him)

| Ref | Decision | Why it is his |
|---|---|---|
| OD-1 | Cutover Sunday date | business/timing |
| OD-2 | Whether to file a Public Records request for Greenway's already-reported CCRS data `[FAQ L0142]` vs trusting the Cultivera Barcode export | cost/time vs certainty |
| OD-3 | Approve the N-01 Area change (Quarantine→Hold FALSE) after examiner reply | changes what LCB sees |
| OD-4 | Flip medical (Part 10) | licensing |
| OD-5 | Who holds the PREprod / prod credentials and receives the LCB error email (the uploader is the only recipient `[FAQ L0102]`) | staffing |
