# 17 — Examiner thread register, the 2026-10-19 block, the cleanup plan, the fresh copy

Written 2026-10-19 at repo HEAD `e518435e`. **Audience: the agent.** The owner gets a plain-language version in the slice report.

Sources added by this part. Every pin is checked by `check_pins.py`:

- `[EXAM L####]` is `evidence/2026-10-19-owner-request/owner-request-verbatim.txt`. It holds the owner's full message: the hub text, the PREprod success emails, the whole Brian McQuay thread, and the owner's own emails.
- `[FAQ19 L####]` is the LCB FAQ as fetched 2026-10-19. It is a different file from `[FAQ]`.
- `[SIGNIN L####]` is the CCRS User Sign-In Guide CIB154.
- `[BUL1006 L####]` is the LCB bulletin of 2026-10-06.

Provenance and md5s are in that folder's README and in Part 13 §G.

Rule for this part: **a code finding cites a file:line at `e518435e`; an LCB/examiner finding cites a pin.** Anything else is marked *inference*.

---

## A. Examiner answer register (Brian McQuay, Cannabis Examiner Unit)

Every answer the examiner gave in writing, one row each.

Older parts cite some of these as `[BRIAN A##]`. No register of those A-numbers was ever committed, so new citations use `[EXAM L####]`, which is a line number in a committed file.

| # | Topic | Examiner, verbatim | Pin | What it binds |
|---|---|---|---|---|
| X-01 | Filed ids | "please continue to use the IDs already submitted and use the update path to update them vs creating new ones" | `[EXAM L0096]` | D-01b Keep; filed lots → Update (S-10/S-11). Already built |
| X-02 | Retention | "it is the same for all records as dictated in WAC 314-55-083, which is the standard 5 years for records." | `[EXAM L0097]` | U-13 closed (unchanged) |
| X-03 | De-provisioning Cultivera | "after you unassign Cultivera, there is nothing else to complete" | `[EXAM L0098]` | Part 07 §D step 6 |
| X-04 | Who gets emails | "it is the email that submits the file will get confirmation and error messages." | `[EXAM L0098]` | U-15 closed (unchanged) |
| X-05 | Opening in Excel | "When you open the inventory file, make sure to click do not convert on the pop up window" | `[EXAM L0139]` | Owner guidance only. Never round-trip a CCRS CSV through Excel |
| X-06 | Priority | "Inventory and product are the primary concern, products are less, as you create new products feel free to update the ids to a pattern that suits your needs." | `[EXAM L0320]` | D-01a GWP- ids for new products (built) |
| X-07 | Dots in ids | "This would be your choice" | `[EXAM L0323]` | Pass-through of dotted filed ids (S-10) |
| X-08 | Numeric ids | "I do recommend not a purely numeric format due to how excel will automatically convert that to scientific notation." | `[EXAM L0326]` | Minted ids are never purely numeric (GWP-, P…-L01) |
| X-09 | Id length | "Yes, the character limit is 100." | `[EXAM L0329]` | `validatePassThroughExternalId` (>100 flagged) |
| X-10 | Data ownership | "it is your data, and it is your responsibility to maintain a copy of all records." | `[EXAM L0426]` | Keep the LCB delivery and every uploaded file for 5 years (X-02) |
| X-11 | **Stale lots** | "It would be best if you did submit an inventory update for all those ids and get them to zero and then an inventory adjustment for those ids, with the reason as reconciliation" | `[EXAM L0430]` | **The cleanup mechanism** (§E). Answers D-02/P-01 for the stale-lot case: BOTH an Inventory Update to 0 AND an InventoryAdjustment `Reconciliation` |
| X-12 | File size (rows) | "To minimize slower response times, limit a file size to 1 million rows." | `[EXAM L0467]` | Our 10,000-row chunks (D-07) are far below it; keep them |
| X-13 | Speed | "It is expected that the licensee corrects the data in the quickest way possible once the incorrect data has been identified." | `[EXAM L0470]` | Schedule (§E.5): cleanup starts in the first production weeks, not "eventually" |
| X-14 | Consequence | "by not correcting the data a license can face possible penalties associated with failure to meet regulatory requirements." | `[EXAM L0473]` | Same |
| X-15 | Data currency | "That was the most recent at the time, as I provide what data was reported up to the date I pulled." | `[EXAM L0476]` | U-30: the seed is current only to its pull date (2026-09-18) |
| X-16 | Areas | "Using a delete operation for those not in use is advised." | `[EXAM L0483]` | S-13 / P-02 / U-31 (unchanged) |
| X-17 | Area name lookup | "It captures the most recent file that was ingested for that name and license." | `[EXAM L0486]` | Area resolution by most recent ingest |
| X-18 | Area rename | "Any area name change would have to reflected the next time you updated that inventory row or it would result in an error." | `[EXAM L0489]` | Area changes ride on the next Inventory Update of each lot |
| X-19 | TotalCost 0 | "That validation came into effect in June of 2025, if those rows are updated, that will have to be addressed also." | `[EXAM L0496]` | Any Update of one of the 3,005 zero-cost lots must carry TotalCost ≠ 0 (§E.3) |
| X-20 | QoH > Initial | "If they are old data and the inventory is no longer on hand they need to be updated to reflect that." | `[EXAM L0499]` | The 77 lots: zero them if they are gone. If they are kept, InitialQuantity must be ≥ QoH (§E.3) |
| X-21 | Strain casing | "No, just do not submit the same name with a variation of captilization." | `[EXAM L0502]` | S-11 one-spelling rule (built) |
| X-22 | "THC" strain | "if it is older and needs to be updated, updating it on the inventory report to a new name that already exist and is accurately will work." | `[EXAM L0505]` | A lot naming strain `THC` must be re-pointed to a real filed strain **when it is Updated** (§E.3) |
| X-23 | CSV in Excel | "Opening in a text program would be fine." | `[EXAM L0513]` | Same as X-05 |
| X-24 | PREprod reset | "NO, you can request a copy from the Service Desk for what has been reported to Preproduction" | `[EXAM L0518]` | PREprod is never reset. PREprod ids are prefixed per run (`P\d{8}[A-Z]-`) |
| X-25 | Environments | "They are separate environments." | `[EXAM L0521]` | Separate ledgers per env (built) |
| X-26 | Size (bytes) | "Limit to less then 1 gb per upload." | `[EXAM L0524]` | 10,000 rows is a few MB (fine) |
| X-27 | Maintenance | "Only when we post about it being down." | `[EXAM L0527]` | Watch bulletins (e.g. `[BUL1006 L0010]`) |
| X-28 | Failure scope | "Header and operation errors are full file, individual row errors are specific to that row" | `[EXAM L0532]` | U-17 closed false (unchanged). Hub copy "re-send only the listed rows" |
| X-29 | Receipt token | "It is a file time stamp and internal system generated, you would not be able to track by it." | `[EXAM L0535]` | U-19: **do not** use the `_<receipt>` token as a correlation id. Correlate by our own file name |
| X-30 | Production email | "yes" (to: production confirmations are the same, without `PRE`) | `[EXAM L0538]` | U-20 → **ANSWERED by examiner** (still confirm on first prod upload) |
| X-31 | 10-minute wait | "Guideline, as soon as you receive a successful response that the prior file was ingested, you can upload the new file." | `[EXAM L0541]` | U-18 → ANSWERED: pace by success email, not by clock (matches the existing [BRIAN A27] wording) |
| X-32 | Daily limit | "Not at this time, however at any time we can set a limit" | `[EXAM L0544]` | No limit today; re-check the Resources page before big waves |
| X-33 | Duplicates | "The exact same file name will not be accepted twice, nor would the data." | `[EXAM L0547]` | The outbox's "same content twice → duplicate" guard is required, not optional |
| X-34 | Description | "There is an expectation that a description is on file, and enhancements to CCRS are an ongoing basis." | `[EXAM L0552]` | U-21: an empty Description is accepted today but **expected**. Keep the E10 warning; fill descriptions |
| X-35 | Date/boolean formats | "That is the correct convention" | `[EXAM L0555]` | MM/DD/YYYY and True/False (built) |
| X-36 | WA.gov impact | "At this time no other impacts." | `[EXAM L0560]` | U-10 → CLOSED with `[FAQ19 L0191]` (§F) |
| X-37 | API | "At this time it is just for integrators, future enhancements are being researched." | `[EXAM L0563]` | R-1 unchanged: no self-API |
| X-38 | Fresh copy | "No notice is required, after the initial uploads, recommendation is to reach out for a copy of what was submitted to check for accuracy." | `[EXAM L0568]` | **§G fresh-copy plan** |

The owner's own measured findings, which the examiner answered, are pinned too:
- the delivery counts `[EXAM L0184]`;
- 4,098/4,208 barcode match `[EXAM L0202]`;
- 44,746 open lots / ~532,000 units vs 4,284 / ~30,000 `[EXAM L0203]`;
- ~40,662 lots not in the back office `[EXAM L0204]`;
- duplicated Area names `[EXAM L0221]`;
- 3,005 TotalCost 0.00 `[EXAM L0233]`;
- 77 QoH > Initial `[EXAM L0235]`.

---

## B. Known-good file format: the P20261007A files (owner-uploaded 2026-10-19)

The seven files under `evidence/P20261007A/files/` were **all accepted** by PREprod on 2026-10-07 `[EXAM L0024-L0052]`. By `cat -A` they are:
- ASCII, with CRLF on every line and no BOM;
- 3 header rows (`SubmittedBy,…` / `SubmittedDate,MM/DD/YYYY` / `NumberRecords,n`), with no comma padding (U-03);
- then the column row, exactly as the template;
- booleans `False`, dates `10/06/2026`, TotalCost `10.00`;
- Inventory rows that name the Strain, Area and Product by **exact Name**;
- an Update row that repeats CreatedBy/CreatedDate and fills UpdatedBy/UpdatedDate.

This is the reference the production emitter must stay byte-compatible with. Golden fixtures already enforce the same shape (Part 03).

---

## C. The 2026-10-19 block: what the hub said, and why (code-anchored)

### C.1 The text (verbatim, `[EXAM L0001-L0016]`)

Errors:
- `[Product] 2 product(s) were left out of Product.csv …` `[EXAM L0002]`
- `[Inventory] 38 lot(s) were left out of Inventory.csv …` `[EXAM L0003]`

Warnings (12):
- orphan products (38) `[EXAM L0005]`;
- the Usable Marijuana → Usable Cannabis alias `[EXAM L0006]`;
- a Description truncated `[EXAM L0007]`;
- "No inventory lots found to report." `[EXAM L0008]`;
- no adjustments, the InventoryTransfer note, "No completed orders in the selected range." `[EXAM L0011]`;
- five "File contains no data rows".

The owner saw this "for both production, and preproduction".

### C.2 What each line is (code at `e518435e`)

| Line | Emitted by | Meaning |
|---|---|---|
| 2 products | `ccrs-batch.ts` L826–L836 (`E41_LEDGER_WITHHELD`), from `applyProductPlan` (`ccrs-ledger-core.ts` L436, withheld at L458) | Product plan = `withhold`. Possible reasons: (a) `NO_PRODUCT_ID_REASON` "no CCRS Product id (GWP-) is assigned to this product" (L228, set at L404); (b) the exact name is already filed under another product (L389–L395); (c) the assigned id's ledger state is uncertain/deleted/unknown (L399–L400 via `routeOperation` L134) |
| 38 lots | `ccrs-batch.ts` L555–L557 → L646–L656 (`E41`), from `planLedgerBatch` lots | Lot plan = `withhold`. Possible reasons: `routeOperation` withhold for the lot id (L336–L339); `resolveProductName` withhold for a filed lot (L208–L214: "filed lot has no filed Product Identifier", "filed Product X is not in the Product ledger", "…is in state…", "…has no filed Name"); or, for a lot CCRS does not hold, "its product is withheld: <reason>" / "its product is not in the published menu" (L421–L424) |
| "No inventory lots found" | `ccrs-batch.ts` L633: fires **only when `rows.length === 0`** | **Every** lot reached the plan and **every** lot was withheld. None was emitted. No lot lacked an id: E3 (L637–L645) is absent from the error list |
| Product "no data rows" | `ccrs-batch-core.ts` L1137 | After the plan, Product.csv has zero rows. Every published product was withheld or skipped |
| Orphan (38) | `ccrs-batch.ts` L972–L986 | Counts **distinct lot product keys** (`sanitizeExternalId(pos_product_key)`) that are not in column 6 of the emitted Product rows. Product.csv is empty, so this is the number of distinct non-empty product keys across all lots. See C.4 |
| Usable Marijuana alias | `ccrs-batch.ts` ~L420–L424 | Advisory. CCRS gets the current vocabulary. Fix the vendor type in the source to silence it |
| Description truncated | `ccrs-batch.ts` L448 | Advisory. Shorten that product's description to ≤ 250 |
| No completed orders / adjustments | Sale and Adjustment builders | Advisory. The selected week has no completed POS orders and no adjustments. **Not an error: zero sales do not block** (`classifyWarning`) |

### C.3 What the facts imply (inference, stated as such)

> **Correction 2026-10-19 (owner screenshots, §K).** Item 3 below assumed that PREprod showed the same counts as the text quoted in C.1. It did not. The PREprod screenshot of week 2026-10-11 → 10-17 withholds **20 products**, not 2, and every one of them lacks a PREprod id (§K.2). So the "at most 2 menu products" reasoning and the conclusion "the main cause is not ids" are **withdrawn** for PREprod. In production, after the owner pressed Assign, 21 of 38 lots now emit and 17 are withheld for reasons the hub did not show until S-17a. Items 1, 2, 4 and 5 stand.

1. **The ledger is loaded in both environments.** If it were not, the plan's `!view` branch emits every row as Insert (`ccrs-ledger-core.ts` L330–L332, L370–L372), there is no E41, and the page shows the amber banner (`page.tsx` L495–L499).
2. **Exactly 38 lots exist** in `inventory_lots` with `status <> 'destroyed'` and an assigned CCRS id. The query is at `ccrs-batch.ts` L763–L774; "every lot withheld" follows from L633 and the absence of E3.
   - The Cultivera import produced 4,208 lots in the 9/01 rehearsal `[EXAM L0202]`. So today's database is **not** holding the migrated inventory. The live migration is scheduled for 10/30 (Part 05 D-16).
   - *Inference to confirm:* these 38 are test or hand-entered lots.
3. **38 lots, 38 different products. At most 2 of those products are in the published menu.**
   - The orphan count (38) is the number of distinct non-empty `pos_product_key` values across all lots, because Product.csv is empty. So every one of the 38 lots names a different product.
   - Product.csv is built only from the published menu: `menu_items` of the newest published `menu_versions`, `hidden = false` (`ccrs-batch.ts` L736–L746, L366–L372).
   - In PREprod the ledger is started empty, so nothing is filed and nothing is "skipped". Every menu product that reaches the plan is either emitted or withheld. Zero were emitted and 2 were withheld. So, **if the PREprod screen showed the same counts**, the published menu has exactly 2 visible items.
   - Then at least 36 of the 38 lots are withheld with **"its product is not in the published menu"** (`ccrs-ledger-core.ts` L423). The other ≤2 are "its product is withheld: no CCRS Product id (GWP-) is assigned…".
   - The two named warnings (L0006 Super Boof Flower 7g, L0007 Orange Diesel Rosin 1g) are very probably those 2 menu products. *Inference, consistent with the text, not proven.*
   - **So the main cause is not ids. Our lots point to products the published menu does not show.** Possible reasons: the menu version is stale, the items are hidden, or the lot's `pos_product_key` does not equal the item's `source_item_id`. *Unproven; this needs the per-row reasons and one look at the published menu (§I item 4).*
4. **Why the same in PREprod and production.** Both environments read the same menu and the same lots. Only the ledger differs.
   - In PREprod the ledger is started empty (0249), so every lot is "ours" and needs its product emitted. Products without a PREprod id are withheld.
   - In production the 38 lots are not in the 9/18 seed (they are not Cultivera barcodes), so the outcome is the same.
5. **The fix is data and setup, not file format.** The format is proven (§B). In order:
   1. Read the per-row reasons (S-17a, or ask the owner for them).
   2. For lots whose reason is "not in the published menu", find why their product is absent: publish the item, unhide it, or fix the key join. This is a data step and is diagnosed before anything is changed.
   3. Press **Assign CCRS Product ids (GWP-)** on production (`page.tsx` L501–L516; shown only when `unassignedProductKeys` > 0, `ccrs-batch.ts` L1029–L1032), or **Assign PREprod ids** with a run id on PREprod (`CcrsFilesPanel.tsx` L136–L150).
   4. Rebuild.

### C.4 Defects found by this recon (code, not data)

1. **The orphan warning compares the wrong column.** `ccrs-batch.ts` L974 builds the set from `product.rows.map((r) => r[6])`.
   - After `applyProductPlan`, column 6 (`ExternalIdentifier`) holds the **ledger id** (GWP-…, or a filed Cultivera id), set at `ccrs-ledger-core.ts` L458 `row[iExt] = pp.ext`.
   - L977 then compares that with `sanitizeExternalId(pos_product_key)`.
   - Once ids are assigned, every lot of an emitted product is still reported as "orphan".
   - Withheld and skipped products are also absent from `rows`, so the warning mixes three causes under one wording.
   - Severity is warning, so it never blocks, but it misleads.
   - Fix: compare by product key, using `product.keys` filtered to emitted rows plus the plan. Split the message into "not in the published menu" and "withheld (see error)". Write the test first.
   - **Confirmed live 2026-10-19 (§K.3):** production emitted ≥18 products under GWP- ids (E44 lists GWP-000051…) and still reported "(38)". Fix: S-17b.
   - **FIXED by S-17b (2026-10-19, §K.7).** The warning is now E47, computed from the planner's own decision, with one row per product key, the reason, and every lot.
2. **The hub never shows the per-row reasons.** `CcrsSyncIssue.rows` carries `{id, label, detail}` for every withheld product and lot (`ccrs-batch.ts` L831, L652). But `page.tsx` L213–L218 maps `syncIssues` to `{severity, file, message, count}` only, and the list at L533–L537 prints `[file] message (count)`.
   - The error text says "Each row says why" `[EXAM L0003]`, yet the owner cannot see a single row.
   - **This is why the owner is blocked without a next step.**
   - Fix: render `rows` (label + detail) under each issue, uncapped, with a copy button.
   - **FIXED by S-17a (2026-10-19, §K.4).** The gate now carries `rows`/`code`/`specPin`; the hub, the compliance report and the export refusal show every row with a next step.
3. **The assign button's help text says "Production only"** (`page.tsx` L513). That is correct for that form. The PREprod equivalent sits in a different panel further down (`CcrsFilesPanel`). When the PREprod tab shows E41 for lack of ids, the error should point to it. This is a UX item, part of fix 2. **FIXED by S-17a:** a PREprod "no CCRS Product id" group says to use "Assign PREprod ids", explains that production ids do not carry over (`[FAQ L0096]`: "These environments are autonomous and do not share administration or reporting data"), and links to `#ccrs-files`.

---

## D. What "accurate" means for the first production upload

The examiner's bar is "kept up to date and accurate" `[EXAM L0473]`, corrected "in the quickest way possible" `[EXAM L0470]`. Concretely, accurate means:

1. Every lot we physically hold is in Inventory.csv, under the id CCRS already has `[EXAM L0096]`, with QoH = our count. The Oct 30 count is applied as a Reconciliation (D-16).
2. Every lot CCRS holds open that we do not have is brought to zero by Update + Reconciliation `[EXAM L0430]` (§E).
3. Every new product has a GWP- id and a description `[EXAM L0552]`.
4. Every sale, return and adjustment of the week is in the Group 3 files.

---

## E. The cleanup plan (examiner-endorsed mechanism)

### E.1 The population (from the 9/18 delivery, measured in earlier slices)

- 62,744 inventory records `[EXAM L0184]`.
- 44,746 open lots `[EXAM L0203]`. Of these, about 40,662 are absent from our back office `[EXAM L0204]`.
- The 9/18 seed has 17,998 closed + 44,746 open lots (`seed-ccrs-ledger.ts` `EXPECTED_2026_09_18`).

### E.2 Mechanism (X-11, `[EXAM L0430]`)

For each stale lot:
1. **Group 2:** an Inventory **Update** with `QuantityOnHand = 0`. It names the filed Product and Strain exactly as CCRS holds them, and the Area by its current name (X-18).
2. **Group 3:** an **InventoryAdjustment** with `AdjustmentReason = Reconciliation` and the quantity removed. That tells the examiners "you were doing an inventory audit and cleaning up old data" `[EXAM L0430]`.

**Not used:** Inventory `Delete` (U-46 stays open; D-15 item 2).

### E.3 Rows that must be repaired as they are touched

- **TotalCost 0.00:** 3,005 records `[EXAM L0233]`. Any Update must carry a non-zero TotalCost (X-19).
  - Sources, in order: our own cost if we hold the lot; otherwise the filed cost if non-zero.
  - Otherwise it is an open question (Q-B3 in §H). **Never invent a cost.**
- **QoH > Initial:** 77 records `[EXAM L0235]`. If zeroed, QoH = 0 ≤ Initial, so it resolves itself. If kept, it needs our true InitialQuantity (X-20).
- **Strain `THC` / Other / Unknown:** re-point to a real filed strain on the Update (X-22). If no strain can be proven, ask (Q-B6).
- **Area:** each lot names the surviving Area (S-13 set C) when Updated (X-18). Area Deletes wait for P-02 (U-31).

### E.4 Volume and pacing

- About 40,662 Updates plus the same number of adjustments, at 10,000 rows per file: roughly 5 Inventory files and 5 Adjustment files.
- Files go out one at a time, each after the previous success email (X-31).
- This is well inside 1M rows `[EXAM L0467]` and 1 GB `[EXAM L0524]`.

### E.5 Order and timing (proposal; owner decides, OD-6)

1. **Week 1 of self-reporting:** the normal weekly batch only: our real lots as Update, sales, adjustments. Prove a clean production cycle.
2. **Weeks 2–3:** equalize waves (S-14), built from a **same-day pair**: a fresh Service Desk copy plus the same day's back-office state (D-14 item 2). One wave per week, each zeroing a slice of stale lots, preceded by the normal weekly files.
3. **After the last wave:** request a copy and diff it (§G step 3).

Speed matters (X-13), so the waves should not wait for perfection elsewhere.

---

## F. WA.gov login: what changed (Oct 12) and what that means for us

- The transition was **Monday Oct. 12, 2026**, with CCRS down "approximately 5 p.m. to 8 p.m." `[BUL1006 L0010]`.
- "All licensees must make a WA.gov account and complete a one-time registration process after the cutover to link their account with their license." `[BUL1006 L0011]`
- Testing deadline: "please make sure to finalize any testing by the end of this week, Friday, Oct. 9." `[BUL1006 L0015]`. The bulletin does not say what happens to PREprod after that date. Ask (Q-B9).
- FAQ (10/19): "CCRS now uses WA.gov for login." `[FAQ19 L0166]` and "SAW accounts did not automatically transition." `[FAQ19 L0170]`.
- **Scope:** "None. The only change in scope is the transition from SAW to WA.gov authentication. All CCRS functionality and upload processes remain the same as they are now." `[FAQ19 L0191]`, plus the examiner: "At this time no other impacts." `[EXAM L0560]`. **U-10 CLOSED.** File formats, upload page and the integrator model are unchanged.
- **Two accounts:** "You will need separate WA.gov accounts for the Pre-Production environment and the live environment." `[SIGNIN L0035-L0036]`
- The registration email "must already have been set up with LCB Licensing." `[SIGNIN L0062]`. Help: `[SIGNIN L0069]`.
- Code impact (S-09, text only). Six strings still say "SAW login":
  - `compliance-reminders.ts:108`
  - `ccrs-outbox-core.ts:300`
  - `excise-payment-core.ts:46`
  - `UploadWalkthrough.tsx:184`
  - `ErrorTriagePanel.tsx:160`
  - `concierge-kb.ts:350`
  
  Since the switch has happened, the S-09 setting design (`portal_login_mode`) is no longer needed. A plain text change to "WA.gov" is enough.

---

## G. The fresh copy of CCRS data after Nov 1: needed, and when

**Yes, it is needed.**

The ledger is the system's memory of what CCRS holds. It decides Insert vs Update vs withhold for every row (`routeOperation`, `ccrs-ledger-core.ts` L134). Today it is seeded from the delivery current to 2026-09-18 (`EXPECTED_2026_09_18`, U-30, X-15). Cultivera kept filing after that date and keeps filing until it is unassigned (Part 07 §D). Every lot Cultivera creates or changes after 9/18 is unknown to the ledger:
- a lot that exists in CCRS would be sent as Insert and rejected "Duplicate External Identifier" (U-05);
- a lot's filed product name may differ (U-12).

Brian recommends the copy without notice: "after the initial uploads, recommendation is to reach out for a copy of what was submitted to check for accuracy." `[EXAM L0568]`. The FAQ permits it: "A license can request their data from the examiner unit for CCRS." `[FAQ19 L0448]`.

**Plan:**

| Step | When | Why | How it enters the system |
|---|---|---|---|
| G-1 | Immediately after Cultivera's **last** filing (the cutover; 11/01 go-live) | Closes U-30: catch everything Cultivera filed 9/18 → cutover | A new delivery is loaded by `seed-ccrs-ledger.ts` **with `--expect`** (required for a non-9/18 delivery). The seed is idempotent and refuses a second finalize, so G-1 needs a reviewed **re-seed / diff** procedure (new slice S-15). Until G-1 lands, the first production batch carries the risk above. Mitigation: the first batch Updates only lots in both the seed and our count, and holds the rest (S-12b behaviour) |
| G-2 | Same day as each equalize wave | D-14 item 2: a wave is built from a same-day pair | The S-16 diff (copy vs ledger vs our inventory) produces the wave's row list |
| G-3 | After the initial uploads (first production week and after the last wave) | `[EXAM L0568]`: check what was submitted for accuracy | The S-16 diff verifies every row we sent is stored as sent (U-27b/U-44b), closes U-20/U-45b, and confirms zeroed lots read 0 |

Format to request: the same CSV export the 9/21 delivery used, so the existing loader reads it unchanged (Q-B5).

---

## H. Questions for the examiner (new; none are answered anywhere above)

| Q | Question | Why we need it | U-row |
|---|---|---|---|
| Q-B1 | For the stale-lot cleanup, may the Inventory Update (to 0) and the Reconciliation adjustment go out in the **same weekly batch** (Inventory in group 2, adjustment in group 3), or should the adjustment wait a week? | E.5 pacing | U-55 |
| Q-B2 | For lots CCRS already shows at QoH 0 but never adjusted: is a Reconciliation adjustment still wanted, or only for lots we zero now? | Volume: about 18k closed lots | U-56 |
| Q-B3 | When zeroing a stale lot whose filed TotalCost is 0.00 and whose true cost is unknown, what TotalCost should the Update carry? Is a nominal $0.01 acceptable for a zeroing Update, as for samples? | X-19 requires non-zero; we never invent | U-57 |
| Q-B4 | May an Area be Deleted while lots that are zero (or that we are zeroing) still name it, or must every lot be re-pointed first? | P-02 / U-31 | U-31 |
| Q-B5 | For the post-cutover copy: same CSV format as the 9/21 delivery? How long does a request take? Should we email you or the Service Desk? | §G | U-30 |
| Q-B6 | A stale lot names strain `THC` (or Other/Unknown) and no correct strain can be proven. Which filed strain should the zeroing Update name? | X-22 | U-58 |
| Q-B7 | Is "1 million rows" per file, and is there a per-day row ceiling for a large cleanup? | X-12 / X-32 | — |
| Q-B8 | Is an Inventory **Delete** of a Cultivera-filed lot with sales behind it ever preferred to Update + Reconciliation? | U-46 | U-46 |
| Q-B9 | After Oct. 9, is PREprod still available for our testing under the new WA.gov PREprod account? | `[BUL1006 L0015]` | U-59 |

---

## I. What we need from the owner

1. **The per-row reasons** for the 2 products and 38 lots. Either a screenshot of the full validation section with any expanded detail, or wait for slice S-17a (C.4 item 2), which shows them.
2. **Which week and environment** each screenshot was (the hub's week picker and env tab).
3. Whether **Assign CCRS Product ids (GWP-)** (production) or **Assign PREprod ids** (PREprod) was pressed.
4. Whether **38** is the number of lots he expects in the system today (our reading: the migrated Cultivera inventory is not imported yet), and whether the products of those lots are visible on the published menu (C.3 item 3).
5. The **date of Cultivera's last filing** and the cutover day (OD-1).
6. Whether **both WA.gov accounts** (PREprod and production) are created and registered `[SIGNIN L0035-L0036]`.
7. **Approval to send the §H questions** to Brian.

---

## J. Slice proposals (tests-first, in this order)

| Slice | What | Unblocks |
|---|---|---|
| S-17a | Show per-row reasons for every hub error and warning (C.4 item 2). PREprod E41 links to the PREprod set-up | The owner can act on the block |
| S-17b | Fix the orphan-warning comparison (C.4 item 1) and split its wording | Honest warnings |
| S-17c | S-09 text: SAW → WA.gov (6 strings) + a guardrail test; drop the `portal_login_mode` design | §F |
| S-15 | Re-seed / diff loader for a post-cutover delivery (G-1) | First-production accuracy |
| S-14 | Equalize waves: Update-to-0 + Reconciliation, same-day pair, TotalCost/QoH/THC repairs, 10k chunks | §E |
| S-16 | Copy diff verifier (G-2/G-3) | Proof of acceptance |

---

## K. 2026-10-19 owner screenshots: what they prove, and slice S-17a

Evidence: `docs/ccrs-bible/evidence/2026-10-19-owner-screenshots/` (two PNGs, md5 in the README, verbatim transcription). Week **2026-10-11 → 2026-10-17**. The owner pressed **Assign CCRS Product ids (GWP-)** on production only.

### K.1 Owner facts (answers to §I)

| §I item | Answer (owner, 2026-10-19) |
|---|---|
| 1 per-row reasons | Not visible: the hub did not render them (C.4 defect 2). S-17a renders them |
| 2 week / env | Week 2026-10-11 → 10-17, one screenshot per environment |
| 3 assign pressed | Production: yes. PREprod: no |
| 4 38 lots expected | **Yes**: "one manifest in the system currently with 38 products on it" |
| 5 Cultivera's last filing / cutover | Cultivera's final upload: **Saturday 2026-11-07**. New system in use from **2026-11-01** (§K.5) |
| 6 WA.gov | "i am registered" (which accounts, PREprod and/or production, is not stated; Q-B9 stays open) |
| 7 approval to send §H | The owner asked for an email draft to send himself |

### K.2 PREprod (Total 17, Blocking 2, Warnings 23)

- `[Product] 20 product(s) … no CCRS Product id is assigned or its CCRS status is unproven (20)` and `[Inventory] 38 lot(s) … (38)`. Product.csv and Inventory.csv are empty ("File contains no data rows" for both).
- **Cause, by code:** the PREprod ledger starts empty (0249), so no PREprod product is filed and no lot is "filed". A product with no PREprod id is withheld with `NO_PRODUCT_ID_REASON` (`ccrs-ledger-core.ts` `planLedgerBatch`), and each of its lots is withheld with "its product is withheld: …". Pressing Assign in production does not assign PREprod ids: the two ledgers are separate by design, and the environments are autonomous `[FAQ L0096]`.
- **Next step:** PREprod set-up step 2, "Assign PREprod ids" with a run id (e.g. `P20261019A`), then rebuild. Whether all 38 lots then emit depends on whether each lot's product is among the 20 (see K.3: in production 17 lots are still withheld after assignment, so PREprod will very probably show the same 17 for the same reasons).

### K.3 Production (Total 49, Blocking 1, Warnings 23)

- 17 of 38 lots withheld; 21 emit. Production has the 9/18 seed, so some lots can be "filed": the E40 warning (3 lots filed under a product whose name differs) proves that at least 3 of the 38 lots are in the seed.
- E44 lists GWP-000051 … GWP-000067 among 18 rewritten Description values, so **at least 18 products were emitted** with their new ids.
- The orphan warning still says "(38)". That is C.4 defect 1 (U-60), now observed live. It is wrong, not a data problem.
- The 17 reasons are **not visible** in the screenshot. They are one or more of: "its product is not in the published menu"; a filed lot whose filed product is not proven ("filed Product X is not in the Product ledger", "… is in state …", "… has no filed Name", "filed lot has no filed Product Identifier"); or "its product is withheld: <reason>" for a product still unassigned (e.g. the exact name already filed under another CCRS product). **Not inferred further.** S-17a shows them on the next build.

### K.4 Sales: what the screenshots prove and what they do not

- **Proven (code + screenshot):** Sale.csv had data rows in both environments. `buildCcrsSaleCsv` warns "No completed orders in the selected range." when the week has no completed order (`ccrs-sales.ts`), and `verifyCcrsFile` warns "File contains no data rows" for an empty file (`ccrs-batch-core.ts`). Neither appears for Sale in either screenshot, while the same warning appears for four other files. So the test sale was completed, fell in the week, and was turned into Sale rows.
- **PREprod record arithmetic (inference):** 17 records = Strain + Area + Sale (Product, Inventory, Adjustment and Transfer are empty). Area = 1 (PREprod Inserts `Sales Floor`, `PREPROD_AREA_PLAN` is empty). If Strain = the 13 strains in the "defaulted to Hybrid" warning, Sale = 3 rows. The Strain count is not shown, so the 3 is not proven.
- **Not yet proven: that CCRS will accept the sale.** A Sale row must name a lot CCRS already holds; otherwise CCRS returns "Invalid InventoryExternalIdentifier" `[G L1302]` with the note "ensure that you have already reported the" `[G L1303]` inventory in an inventory.CSV. In PREprod no lot is in Inventory.csv yet. In production the sold lot may be one of the 17 withheld. The export route refuses this case (`verifyOutboxAgainstLedger` `L_REF_INVENTORY`), but the hub did not run that check, so the hub could show green while the download refuses. Slice S-17b runs the same check in the hub.
- **Answer to the owner:** the sale is captured and formatted; it can be accepted only once its lot is filed (or sent in the same batch). Fix the withheld lots first, then the sale goes through.

### K.5 Cutover dates and the duplicate-sale risk (owner decision needed, OD-1)

Facts: new system in use from **Sun 2026-11-01**; Cultivera's **final upload Sat 2026-11-07**; CCRS weeks run Sunday–Saturday `[FAQ L0041]`, so 11/01–11/07 is exactly one CCRS week; the hub's first day of sales is the site setting `compliance_obligation_start` (S-12d measured it with 2026-11-01; the stored value is data and is not verified from code; see Part 05 D-19).

Risk: if Cultivera's 11/07 upload contains any sale or adjustment for 11/01–11/07 and Greenway also files that week, the second copy of each sale fails with "Duplicate Sale for Licensee" `[G L1390]` (Part 07 §D step 7). If neither files it, the week is unreported.

What decides it is **which data Cultivera's 11/07 upload contains**. If sales are rung in the new POS from 11/01, Cultivera has no record of them unless they are also entered there. The options, for the owner and Cultivera (not decided here):
- (a) Greenway files week 11/01–11/07 (Sunday 11/08). Cultivera's 11/07 upload must contain **nothing dated 11/01 or later** (only catch-up of 10/25–10/31). The hub setting stays 2026-11-01.
- (b) Cultivera files week 11/01–11/07 from data it holds. Only possible if the 11/01–11/07 sales are in Cultivera. Greenway's first week is then 11/08–11/14, and the hub's first day of sales must move to 2026-11-08.

Until the owner confirms (a) or (b) in writing with Cultivera, U-61 stays open. Fresh copy G-1 (§G) is requested **after** 11/07, the last Cultivera filing, and before Greenway's first production upload.

### K.6 Slice S-17a: every withheld row shown, with the next step (DONE in code, 2026-10-19)

- `ccrs-submit-gate-core.ts`: `GateIssueInput`/`GateIssue` carry `code`, `specPin`, `rows`. Deduplication **merges** the rows of a dropped duplicate. New `toGateInput()` is the one mapping every caller uses (hub, compliance report, export route), so no caller can drop the rows by hand again.
- `ccrs-issue-display-core.ts` (new, pure): `classifyWithholdReason` turns each reason produced by `ccrs-ledger-core.ts` into one of 10 classes. A lot withheld for its product takes the product's class. `nextStepFor(class, env)` names the exact control (production Assign, PREprod set-up, Menu review, the CCRS files list, the fresh copy). `issuePlainText` and `issuesPlainText` give an uncapped plain-text copy. An unknown reason is "unclassified" and says do not upload; it is never guessed.
- `CcrsIssueList.tsx` (new): each issue shows its code, one line per reason class with the next step (largest first), a `<details>` list of **every** row, and copy buttons. PREprod no-id groups link to `#ccrs-files`.
- Hub `/admin/compliance/ccrs` and `/admin/reports/compliance` render errors and warnings with it. The compliance report's `batchWarnings.slice(0, 30)` cap is removed (Part 05 §H).
- `batch-export` 409 refusal prints every row and the next steps.
- Harness: mutation M101's anchor had been dead since S-13 moved the Area plan into `ccrs-area-core.ts`, so `mutate_check.py` aborted at M101. It is retargeted to the same behaviour in its new home and killed by `s13-ccrs-areas.test.ts`.
- Tests: `tests/compliance/s17a-hub-issue-rows.test.tsx`. It **reads `ccrs-ledger-core.ts`** and requires every `reason:` literal there (13 today) to be classified, so a new reason cannot fall through silently. It also runs real `planLedgerBatch` output through the gate and the display, renders the component (40 rows, no cap), and pins each caller. Self-tests are registered in both runners. Mutations M120–M130 are all killed.
- Not changed: no CSV byte, no routing decision, no migration.

### K.7 Slice S-17b: honest "not in the menu" rows, and the hub runs the export's self-check (DONE in code, 2026-10-19)

**1. The "(38)" orphan warning (C.4 defect 1, U-60) is replaced by E47.**
- Old rule: `product.rows.map((r) => r[6])` against the lot's sanitized key. Column 6 holds the CCRS id after `applyProductPlan`, so every lot of an emitted product was "orphaned". The test reproduces it: 4 of 4 lots flagged against real `planLedgerBatch` + `applyProductPlan` output.
- New rule (`ccrs-lot-product-core.ts`, pure): E47 speaks only about the lots the planner **withheld** with "its product is not in the published menu". It takes the planner's decision, it does not re-derive it, so the warning and Inventory.csv cannot disagree. Two kinds of lot are excluded on purpose:
  - a lot CCRS already holds whose product left the menu: the planner emits it as an Update under its **filed** product name;
  - a lot refused for another reason: it is already an E41 row with that reason.
- Legacy mode (no ledger view) withholds nothing. There, E47 lists the lots **written with a blank Product**, and it is an **error**, because CCRS answers "Product is required" `[G L0578]`. With a ledger it is a **warning**, because each lot is already a blocking E41 row.
- Each E47 row is one product key with **why** and every lot. The extra menu read (`readMenuPresence`) gives the reason:
  - hidden in the published version, with the menu's own `hiddenReasonText`;
  - only in a staged version;
  - no menu item with that key;
  - blank key;
  - visible but its cleaned-up id is empty or collides with another item's;
  - "the menu could not be read". A failed read is **never** treated as "no item".
- The E41 lot row with that reason is enriched the same way: "its product is not in the published menu (hidden in the published menu: …)". It keeps its S-17a class and next step.
- Pin: `E47_LOT_PRODUCT_NOT_IN_MENU` → `[G L0579-L0583]`. Inventory must name a product "submitted this product on the product.CSV" in "the same format and spelling".

**2. The hub runs the export route's ledger self-check (§K.4, U-62).**
- `ledgerSelfCheckIssues` (in `ccrs-outbox-core.ts`) runs the **same** `planOutboxFiles → verifyOutboxAgainstLedger` that `batch-export/route.ts` runs. It uses the same bytes, the same `now` (`generatedAt`) and the same `lastStamp`. It returns one blocking gate issue per (file, code), with every row named "<file name> row N".
- Each code has its guide pin (`LEDGER_PROBLEM_PIN`); the test checks each against `guide.txt`:
  - L_INSERT_ON_FILE `[G L0246]`
  - L_UPDATE_NOT_ON_FILE `[G L0247]`
  - L_DELETE_NOT_ON_FILE `[G L0248]`
  - L_REF_PRODUCT `[G L0579]`
  - L_REF_STRAIN `[G L0555]`
  - L_REF_AREA `[G L0570]`
  - L_REF_INVENTORY `[G L1302-L1304]`
  - L_TOTALS `[G L0246-L0248]`
- Effect: a Sale whose lot is withheld and not filed is now a **red blocking issue in the hub and in the report**. Before, it appeared only as a refused download. The route keeps its own check as the last guard. Legacy mode has no ledger to check against, exactly as in the route.

**Not changed:** no CSV byte, no routing decision, no migration, no planner reason string. The test reads `ccrs-ledger-core.ts` and requires the literal to be the same.

**Proof:**
- `tests/compliance/s17b-honest-orphans-and-hub-selfcheck.test.ts`.
- Self-tests registered in both runners.
- Mutations M131–M148, all killed.
- Full `tests/compliance` suite green.

**What the owner will see on the next build:**
- the "(38)" line is gone;
- if any lot names a product not in the menu, one E47 row per product says why;
- if the test sale's lot is withheld, a blocking `L_REF_INVENTORY` row names the Sale file row. Fix the lot (S-17a reason), rebuild, and it clears.
