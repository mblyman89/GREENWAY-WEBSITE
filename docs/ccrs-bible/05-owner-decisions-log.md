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

**Plain-language answer for the owner (to be repeated at handoff):** It is required. Every week Greenway receives product, CCRS expects an InventoryTransfer row per received lot: the vendor's license, Greenway's license, the vendor's inventory id, Greenway's inventory id, the quantity, and the date. Vendor returns and destruction are NOT InventoryTransfer rows; they are InventoryAdjustment rows (the code already does that: `disposition.ts` L786 `createVendorReturn` → `other`, L973 `completeDestruction` → `destruction`).

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

## D-12 — S-02 withholds bad rows instead of shipping them (2026-09-15, S-02)

The owner's instruction for this slice was to "continue on to the next slice"
and to advise on how to start testing real uploads. Two judgement calls inside
S-02 were made on his behalf and are recorded here so he can overrule either.

**First: a row that fails pre-flight is WITHHELD from the file, not emitted with
a warning.** CCRS emails errors only to the person who uploaded, and only after
processing `[G L0051]` `[FAQ L0102]`. A knowingly-bad row therefore costs a full
upload cycle to discover. The builders now `continue` past a failing row and
return a `CcrsSyncIssue` carrying the error code, the spec pin, and the affected
rows, so the hub can show "3 lots have no cost — fix these" *before* the file is
produced. Nothing is silently dropped: every withheld row is reported.

**Second: E8 is evaluated before E7.** A lot with both "on hand exceeds
received" and "cost is zero" reports the quantity problem first, because a
quantity that exceeds what was received usually means the receiving record
itself is wrong, and fixing that often changes the cost. The order is asserted
by a test and by mutation `M20-verdict-order-e7-first`.

Also settled here: **"Other" is a reserved strain name only as an exact match**
`[G L0358]` `[FAQ L0014]`. A strain genuinely called "Other Kush" is legal and
must not be blocked. Mutation `M9` proves a substring match would be caught.

## D-13 — E10's authority is a Note, not an error string (2026-09-15, S-02)

Part 04 previously cited E10 as "`[G]` p.14", a page reference the roadmap
forbids shipping. The exact line was located: `[G L0482-L0483]` — *"Note:
required when inventorytype = Useable cannabis, or Cannabis Mix Packaged"*.

Worth flagging to the owner: a grep of the entire guide and FAQ found **no
error-message text** for a missing Description. Every other rule in S-02 has a
quotable error string; E10 has only a Note. So we cannot predict what CCRS
actually does when Description is blank — it may reject, or may accept. That is
exactly why test **T-19** exists in the PREproduction plan, and why its result
should be recorded verbatim before we trust our own enforcement.

Until T-19 is run, our behaviour is the conservative one: we block the row
locally rather than risk a rejected file.

## D-14 — Build Bible v2; "make CCRS and our inventory equal" (2026-10-05, S-10)

Owner, verbatim: *"I want to proceed with all of your recommendations you laid out above. … this must be perfect before we go live. Please follow the standing rules and never guess, never assume. Test it, test the tests. Guide me how to test via preprod."* Then, relaying the Cannabis Examiner Unit on questions 5 and 6: *"Q5 and q6, Brian says to clean it all out. Make CCRS and our inventory equal each other."*

Recorded consequences:

1. **D-01b Keep** is in force: every filed id passes through byte-for-byte (S-10). Only new lots get minted ids (D-01a formats, S-12).
2. The cleanup target is **CCRS QoH = our QoH for every lot**, not only "zero the stale lots". Measured against the 2026-09-01 back-office snapshot: of 4,098 barcodes in both, QoH matches on 1,040 and differs on 3,058; and 495 of the 40,662 "stale" lots were created on or after 2026-09-01, so a dated snapshot must never zero a lot created after it. Therefore every equalize wave is built from a **same-day** pair (fresh Service Desk copy + same-day back-office export), and lots created after the older snapshot are HELD (S-14).
3. The mechanism (Inventory Update vs InventoryAdjustment) is still decided by PREprod probe P-01 (D-02), not by inference.
4. An inventory lot with no assigned CCRS id is withheld from Inventory.csv with a blocking error rather than given an invented id (S-10, `E3_EXTERNAL_ID_UNASSIGNED`).

## D-03-AREA (2026-10-07, S-13) — Area set; NOT the same as D-03 (medical) above

Bible v2 (analysis3 Part 08) reused the number D-03 for "which Area set survives". The code calls it D-03 because the slice plan does. Recommendation: keep `C1100011`–`14`, retire `C1-11021100011`–`14` + `A65303` `[BRIAN A11]`. The owner accepted "all of your recommendations". The summary line he saw read "most-recently-dated Sales Floor set", and both sets share CreatedDate 2024-08-22. **Status: production runs Update-only (no Delete) until (1) PREprod P-02 answers U-31 and (2) the owner explicitly confirms set C.** The plan is a reviewed code constant (`PROD_AREA_PLAN` in `ccrs-area-core.ts`), not a `license_settings` column.

## D-15 — Examiner green light: migrated garbage is flagged for removal from CCRS at the first upload (2026-10-13, R50 S10c)

Owner, verbatim (follow-up #5): *"There will be several items that we end up migrating to our system that we know are broken and the system won't like. The LCB examiners office has given me the green light to clean up my CCRS account so all the dead broken non existent products we migrate will end up immediately being flagged to be removed from CCRS. … I want the system to know, when we migrate, it's going to be intaking some garbage, and I want the system to recognize this and help me remove them from the system when I comes time to do our first CCRS upload."*

Recorded consequences:

1. This is the same direction as D-14 ("clean it all out"). It adds no new CCRS mechanism. The target is still **CCRS QoH = our QoH**. A dead record is "removed" when its lot is zeroed by a **Reconciliation** adjustment ("Balance inventory → Reconciliation" `[G L1142]`), which is the existing R15b path (`legacy-lot-removal-core.ts`). Whether that zero reaches CCRS through Inventory Update or InventoryAdjustment is still settled by P-01 (D-02, D-14 item 3).
2. **No Inventory `Delete` is sent** for a migrated lot. The guide defines Delete as "delete a record indicated by external identifier" `[G L0248]`, but nothing pinned says what CCRS does with a Delete of a Cultivera-filed lot that has sales and transfers behind it (new **U-46**, Part 12). The ledger's `routeOperation(..., "delete")` already refuses any id not on file.
3. "Garbage" is evidence-based and never guessed. **Dead** means the product is missing from the Cultivera Products export (`no_product_master`) or the lot has no filed barcode (`import_lot_missing_barcode`, a synthetic id CCRS never held). **Broken but fixable** (cost, potency, size, dates, COA) is listed for fixing, not removal.
4. Each dead lot is routed by the ledger: on file → zero it out; not on file / never filed → local-only removal (nothing to remove in CCRS, and a reference would be rejected as an invalid id); uncertain / unknown / deleted → hold and reconcile first; ledger not loaded → unknown, so no action is offered.

## D-16 — The Oct 30 count is opening inventory: Sage adjustments export leaves it out; CCRS gets it as Reconciliation (2026-10-13, R50 S11)

Owner, verbatim (follow-up #6 clarification #2): *"the system will then take those counts, and update all of the lots we intake from cultivera with the accurate ones"*; standing rule: do not disturb accounting or vendor pay.

Recorded consequences:

1. Each count move is an `inventory_adjustments` row with reason `count` and the note `R50 Oct-30 count <importId>: barcode …`, applied through R15b (`applyLotDelta`, strict). CCRS reads it like any other adjustment: Reconciliation, "Balance inventory" `[G L1142]`. The CCRS export is unchanged.
2. Migration stock is opening inventory, never a purchase (R50 §1.4, S2a). The count corrects that opening figure, so the Sage adjustments export **leaves these rows out** (`isMigrationCountAdjustment`: reason `count` plus that note prefix) and prints a warning line with the number left out. Shrink and loss adjustments are not affected.
3. Nothing about vendor pay, bills or receipts changes. A count row never creates a payable.
4. The count is never applied over a lot that moved after the import (`moved_since_import`), and it is never applied while any 10/31 sale is missing from the harvest (U-50, U-51).

## Decisions that are still the owner's to make (do NOT decide these for him)

| Ref | Decision | Why it is his |
|---|---|---|
| OD-1 | Cutover Sunday date | business/timing |
| OD-2 | Whether to file a Public Records request for Greenway's already-reported CCRS data `[FAQ L0142]` vs trusting the Cultivera Barcode export | cost/time vs certainty |
| OD-3 | Approve the N-01 Area change (Quarantine→Hold FALSE) after examiner reply | changes what LCB sees |
| OD-4 | Flip medical (Part 10) | licensing |
| OD-5 | Who holds the PREprod / prod credentials and receives the LCB error email (the uploader is the only recipient `[FAQ L0102]`) | staffing |

## D-17 — Sage will not be used; no accounting work now; POS readiness first (2026-10-13, R50 follow-up #7)

(Appended after the open-decisions table because this log is append-only.)

Owner, verbatim: *"As for the Sage decision, that's fine with me. Since we built our own books and accounting branch, I won't be using Sage going forward. So long as our bookkeeping and accounting system can manage them is all I need. But it's not ready for that yet, the books aren't ready yet, so I don't want to spend time on that right now. We need to make sure the pos system is ready to and working properly."*

Recorded consequences:

1. No new Sage export work. The existing Sage exports are left exactly as they are (standing rule: do not disturb accounting), including D-16's count exclusion.
2. Accounting for migrated stock and the Oct 30 count moves to Greenway's own books when they are ready. Nothing is built for that now.
3. Priority is the POS and the Cultivera menu upload pipeline for the 11/01 go-live.

Owner, verbatim, same message: *"We currently use Cultivera for sales and returns. My Cultivera has both of these in the same sales file you will scrape with the crawler."* Recorded against U-48 (Part 12). It supports, but does not close, the reading of `ReturnUnits`.

## D-18 — Finish the CCRS pipeline; clean up the CCRS data; first slice is research and bible (2026-10-19, Part 17)

(Appended after D-17; this log is append-only.)

Owner, verbatim `[EXAM L0001]`: *"I need your help finishing the ccrs upload pipeline we have built so that it can successfully create spreadsheets that ccrs will accept as well as being accurate. this includes the cleanup of my ccrs data sent by brian a month ago."* And `[EXAM L0843]`: *"…please let me know if you have more questions for brian the examiner, and if we need a fresh copy of my ccrs data given to me after november 1st 2026. and how that plays a part in our system. please read agents.md. then proceed with the first slice, read, recon, research the internet, report, strategize, bible build…"*

Recorded consequences:

1. The examiner's written answers are now one register (Part 17 §A, X-01…X-38), each pinned `[EXAM L####]`.
2. The stale-lot cleanup mechanism is the examiner's: Inventory Update to 0, **then** an InventoryAdjustment with reason Reconciliation `[EXAM L0430]`. This settles D-02/P-01 **for stale lots**. It does not change D-15: no Inventory Delete.
3. A fresh copy is needed (Part 17 §G): G-1 right after Cultivera's last filing, then copies around each equalize wave and after the initial uploads `[EXAM L0568]`.
4. U-10 is closed. The WA.gov change is login-only `[FAQ19 L0191]` `[EXAM L0560]`.
5. Nothing in code changes in this slice. The next slices are proposed in Part 17 §J. Sending the Part 17 §H questions to the examiner is the owner's decision (new **OD-6**: wave timing; **OD-7**: send the §H questions).

## D-19 — Owner facts for the cutover and the first build (2026-10-19, Part 17 §K)

(Appended after D-18; this log is append-only.)

Owner, verbatim: *"the week is 10/11/26 - 10/17/26. i have one manifest in the system currently with 38 products on it, so yes i am only expecting 38 lots right now. … the date of cultivera's final upload of our data to ccrs will be saturday 11/7/26. we will begin using the new system 11/1/26. i am registered."*

Recorded:
1. **38 lots is correct** for today's database. It is one manifest; it is not the migrated inventory.
2. **New system in use from Sun 2026-11-01.** The hub's first day of sales is the site setting `compliance_obligation_start` (S-12d). Its stored value is data, not code, and is not verified here. S-12d measured its effect with 2026-11-01. Under option (a) it must read 2026-11-01; under option (b) it must read 2026-11-08. The owner should check it on the CCRS page.
3. **Cultivera's final upload is Sat 2026-11-07.** That covers exactly the CCRS week 11/01–11/07 `[FAQ L0041]`. Which data it contains decides OD-1 / U-61 (option (a) Greenway files that week; option (b) Cultivera files it). The owner is to confirm this with Cultivera in writing. Not decided here.
4. **WA.gov: "i am registered".** Which accounts (PREprod and/or production) is not stated, so Q-B9 stays open.
5. Pressing Assign in production does not assign PREprod ids (separate ledgers; `[FAQ L0096]` "These environments are autonomous"). PREprod needs "Assign PREprod ids".
6. Fresh copy G-1 is requested **after** 11/07 and before Greenway's first production upload (Part 17 §G). The email to the examiner is drafted for the owner to send (OD-7).

## D-20 — Owner facts for the hand-over dates, and the first upload date (2026-10-19, slice S-17d)

(Appended after D-19; this log is append-only.)

Owner, verbatim: *"our last sale with cultivera will be sometime before closing on 10/31/2026. our first sale with our new system will be sometime in the morning of 11/1/2026. so my assumption is that cultivera will upload on 11/7/2026 for ccrs activity related to 10/25/2026 through 10/31/2026. then we would make our first submission on 11/14/2026?"*

Recorded:
1. **Last sale in Cultivera: Sat 2026-10-31 (before close). First sale on the new system: Sun 2026-11-01 (morning).** 11/01 is a Sunday, so no CCRS week is split between the two systems `[FAQ L0041]`.
2. The first Greenway upload is due **Sun 2026-11-08**, not 11/14. The week 11/01–11/07 is Greenway's first week, and a week is due "no later than Sunday for the previous week" `[FAQ L0041]`. It may be uploaded Sat 11/07 after close ("Reporting more frequently than weekly is allowed." `[FAQ L0041]`). The week 11/08–11/14 is due 11/15.
3. **Cultivera's last week is 10/25–10/31, due Sun 2026-11-01.** The owner's stated assumption that Cultivera uploads it on 11/07 is **six days after** that Sunday. The FAQ applies the Sunday rule "After the transition period"; what that phrase means for this license today is **U-64** (not verified). The owner should ask Cultivera to upload by 11/01. The licensee is responsible either way `[FAQ19 L0346]`.
4. This resolves the reading of D-19 item 3: the 11/07 upload is meant to cover **10/25–10/31**, which is option (a) of Part 17 §K.5. **U-61 stays OPEN** until Cultivera confirms in writing that the upload holds nothing dated 11/01 or later (otherwise "Duplicate Sale for Licensee" `[G L1390]`).
5. The hub's first day of sales (`compliance_obligation_start`) must read **2026-11-01** (option (a)). Its stored value is data and is still not verified here.
6. The hub now works this out (S-17d: `ccrs-handover-core.ts`, card "Hand-over from Cultivera"). The owner records Cultivera's last sale day and final upload day there; the card shows the first upload date and the warnings above.
7. `docs/audit/CUTOVER-CHECKLIST.md` still scheduled an Oct 18 cutover. It now opens with a superseding notice, and C-107, C-110–C-112, C-120, C-130, C-132, C-133 and C-140 carry the dates above. No ID was renumbered.

## D-21 — Owner facts: who files the last Cultivera week, the production account, and the CCRS mailbox (2026-10-20, slice S-18a)

(Appended after D-20; this log is append-only.)

Owner, verbatim: *"I did not fully understand the reporting requirements, I thought it was due Saturday for the previous weeks data. But if it's due Sunday, the day after the filing period ends, then yes, Cultivera will upload our final reports on our behalf on 11/1/26. Our first upload of reports will be 11/8/26. I will open a production account with CCRS through their new wa.gov portal."* And: *"I want to add to the system a fetching service that monitors my michael@greenwaymarijuana.com address for CCRS emails, specifically the upload confirmations."* And, later: *"Failed uploads have an attachment with the failures identified if I remember correctly."*

Recorded:
1. **Cultivera uploads week 10/25–10/31 on Sun 2026-11-01**, its due Sunday `[FAQ L0041]`. This replaces the 11/07 date in D-19 item 3 and D-20 item 3. If Cultivera does upload on 11/01, the S-17d warning FINAL_UPLOAD_AFTER_DUE no longer applies once the owner records 11/01 on the hub card. **U-61 stays OPEN** until Cultivera confirms in writing that the upload holds nothing dated 11/01 or later. **U-64 stays OPEN** because the question still matters for any later week (Q-B10).
2. **First Greenway upload: Sun 2026-11-08**, for week 11/01–11/07. This matches D-20 item 2.
3. The owner is opening the **production** CCRS account through WA.gov (Part 11). PREprod is a separate account `[SIGNIN L0035-L0036]`, U-59.
4. Confirmations and error files go to the email address that submits the file `[EXAM L0098]`. That is michael@greenwaymarijuana.com. S-18a reads that mailbox with read-only access. It lists each CCRS email on the hub for the owner to apply; nothing is applied automatically (standing rule 3).
5. The owner's memory that failed uploads carry an attachment matches U-14 (ANSWERED 2026-09-17: a CSV with an `ErrorMessage` column; 15 such files are committed). The **subject, body and MIME type** of an error email were never captured, so this is **U-66**. S-18a therefore recognises an error email only by a `.csv` attachment with an `ErrorMessage` column.

## D-22 — Owner question: when the lot cleanup (equalize waves) can run, and the hand-over schedule reconfirmed (2026-10-20, slices S-14b, R-3)

(Appended after D-21; this log is append-only.)

Owner, verbatim: *"On October 31 after our last sale, I will press the Cultivera upload and scape all data from my portal. On October 30, an audit will be done, every item scanned so we have a list of every single lot and its quantity. How do we zero out the garbage on October 31 after close/ November 1 before we open. I might be able to get an updated copy of my CCRS data before the 1st, but I doubt I'll get the copy I need after nov 1 by the time we will need it. Can the system equalize and zero out records happen after the migration is complete and I get all lots scraped into our system and on the menu? I need to be able to sell the products by open on Nov 1, but we also need to clean up soon after migration so we have a clean start."* And, later the same day: *"Cultivera's last upload is 11/1. Mine is 11/8. I was confused before. Now we know the schedule."*

Recorded:
1. **The schedule is settled:** Cultivera's last upload is Sun 2026-11-01; Greenway's first is Sun 2026-11-08 (D-21 confirmed). **U-61 stays OPEN** until Cultivera confirms in writing that its 11/01 upload holds nothing dated 11/01 or later.
2. **Selling on 11/01 does not wait for the cleanup.** The cleanup runs **after** the migration, in weeks 2–3 (§E.5, §E.6).
3. **No wave on 10/31 or 11/01, and none from a copy pulled before or on 11/01.** The system refuses it (S-14b), with no override.
4. **The 10/30 audit protects the shelf.** `count-barcodes.ts` turns the counters' workbooks into a list. Every wave must be given that list, and no listed barcode is ever zeroed.
5. **R-3 (DOR return) is built:** it is on the compliance calendar with reminders, and "filed" is recorded with Mark done.

## D-23 — Owner report of the first end-to-end PREprod run, Round 6 scope, and the workspace rule (2026-10-20, slices R6-1, R6-2)

(Appended after D-22; this log is append-only.)

Owner, verbatim: *"I need you to help me pick back up where the last agent left off. please clone a copy of the github repo, read agents.md first. then read the handoff doc. then deep recon the code areas you need to know more about so you can properly and accurately build the next set of slices. the last round of slices ended after I began testing the full pipeline end to end to see if sales generated from product I received from real manifests my business intakes via cultivera, would upload successfully to ccrs from real retail activity. I know the test data I am using is reliable, so every test the passes gives me a great deal of confidence it is working properly. that being said, i want to keep enhancing it, keep making it better, keep making it harder and more robust. the point of the statement above about testing it before the last round finished is because, 4 of 6 files uploaded succeeded, Area, Product, Inventory adjustments, and sale. the two failures were strain and inventory. I have not yet tested the inventory transfer file yet, I need to generate some activity that covers that, but it is what we are building next I think. If its not included in the build plan for inventory transfers already, please deep research the proper enterprise grade way to complete one. by enterprise grade way too, I mean assume we will be allow to automate the process. I want to make it very simple to return products back to vendors. cultivera makes it damn near impossible and there is just a ton of hoops to jump through. we can eliminate them now that we will have automation allowed and we now have all of the data from past successful uploads, what worked based on our research and why the two files failed, so we can adjust our understanding of the problem and solution and then fix it to be accurate again. please complete 2 slices of work, commit, push merge each slice individually. commit work out of the sand box as much as possible, keep things in the root workspace folder if you need or want, I have nothing in there but space for you to use to keep our code safe from sandbox resets. please add to the standing rules that the main root workspace folder in this environment is available for you to use, all of its space. please provide a summary report at the end of the two slice round with what was built, what and how to test it, and what is still left to build. also, please tell me when I can test uploading the cultivera menu not in test mode so I can test selling those products, test uploading the ccrs files with their data in it, test uploading ccrs files with products from cultivera and products received by our system in the same files. follow the standing rules, agents.md. thank you!"*

Recorded:
1. **2026-10-20 PREprod run: 4 of 6 files accepted** (Area, Product, InventoryAdjustment, Sale). The 6 sent files and the 2 error files are committed in `evidence/2026-10-20-real-upload/` with their hashes.
2. **Strain failed, and that is by design.** 11 rows were answered `Duplicate Strain. The Strain must be unique for the LicenseNumber`: the strains were already on file, and a duplicate strain is benign `[G L0325-L0326]`. Nothing to fix.
3. **Inventory failed because our PREprod ledger started empty, not because of the data.** 13 of 18 Inserts were answered `Duplicate External Identifier`. They are exactly the 13 lots whose strains were Duplicate Strain: the same vendor lots (we keep the vendor's id as our lot id) had been filed by an earlier PREprod test. The **accepted Sale** named 4 of them, which proves PREprod holds them `[G L1302-L1304]`. PREprod cannot be reset `[EXAM L0518]`.
4. **R6-1 fixes it** (migration 0284):
   - an uncertain lot named by a later accepted Sale/Adjustment row is filed again automatically, in both environments;
   - PREprod gets a "Settle PREprod duplicates" button;
   - production keeps its copy-only rule.
5. **R6-2 is planned as InventoryTransfer from receiving intake** (S-05). It was already in the build plan (Part 09 S-05). Vendor returns (the owner wants them simple): the enterprise design is researched and recorded in Part 09 under R6-2, with its open questions in Part 12. What R6-2 actually shipped is recorded in Part 09, not here.
6. **Standing rule 14 (AGENTS.md):** the root `/workspace` folder of the agent environment is free to use, all of its space; commit and push early and often.

## D-24 — The examiner's 9b/9c answers built in: no transfer suffix, the vendor's id kept, corrections by Update (2026-10-30, slice C1)

(Appended after D-23; this log is append-only. Report A-4 noted this entry was owed.)

Owner, verbatim (2026-10-30, `/workspace/ccrs-work/00-owner-request-2026-10-30b-verbatim.md`): *"Thank you! Please push and merge the work now. Then proceed with another two slices. Working meticulously through the issues so you accurately and properly fix and enhance and harden the pipeline. Go above and beyond for me. Follow the standing rules. Thank you!"*

Recorded:
1. **Transfer ExternalIdentifier = our reported lot id, no suffix** [EXAM2 L0056]. Transfers already filed as `TR-<id>` stay valid history: they are recognised and never sent again.
2. **A new lot keeps the vendor's own id** when it came from the WCIA JSON or a CCRS csv and no other lot has it, so returns and recalls trace back [EXAM2 L0056]. Ids read from a PDF keep the minted form until confirmed (U-76). A lot already filed is never renamed.
3. **A transfer CCRS accepted is corrected only by an Update with the same id** [EXAM2 L0058], and only after the owner presses **Approve correction** for exactly the values shown. Nothing is corrected on a guess. This needs migration 0325, which the owner applies by hand.
4. Still open from report A-4: whether to re-point strain names (Part 17 §E.3) remains the owner's decision. C1 does not change strains.

## D-25 — The final PREprod tests: no "unknown" answers, Area explained (2026-10-31, slice P-F)

(Appended after D-24; this log is append-only.)

Owner, verbatim (2026-10-31, `evidence/2026-10-31-preprod/owner-request-verbatim.md`): *"the system keeps telling me we dont know the answer to these issues, but we have every answer from brian… nothing is unknown at this point… we have two areas/ rooms or so right? and if they are already set up, how do I pass that test?"*

Recorded:
1. **The hub never says "unclear" for a message we have seen.** Every CCRS message received so far is in the known list with its fix. A truly new message is shown in CCRS's own words, with an examiner draft offered.
2. **PREprod has one Area, Sales Floor (`GWA-SALES-FLOOR`).** CCRS has held it since the 10/20 success. "Duplicate External Identifier" on a later Area row means CCRS already has it, which passes the test. The production rooms (Sales Floor, Incoming Orders and the others) are a production matter (Part 16) and need no PREprod test.
3. **Strain on Inventory is never guessed.** It is the product's strain, else what CCRS last accepted for the lot [EXAM2 L0034-L0035], else the row is held (E64) until the product has a strain.
4. No push or merge until the owner says so. The work is delivered as a bundle and patches in `/workspace/ccrs-work`.

