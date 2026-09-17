# 15 — PREproduction run: observed results, 2026-09-17

**This is an OBSERVATION part.** Parts 02 and 03 record what the sources and the code
*say*; this part records what the system *did*. Where the two disagree, **this part wins on
behaviour** and Part 02 still wins on what we are contractually told. Four findings here
have no counterpart anywhere in LCB documentation.

Because these strings cannot be pinned `[G L####]`, cite them as **`[OBS 2026-09-17 T-xx]`**.

**Evidence (committed):** `docs/ccrs-bible/evidence/2026-09-17-preprod-run/`

- `success-emails-2026-09-17.txt` — 10 emails, subject **"PRE: CCRS Processing Successful"**
- `errors/` — the **14 returned error CSVs** (CCRS echoes the file back with an `ErrorMessage` column)
- `examiner-reply-2026-09-17.txt` — examiner reply, Brian McQuay, Data Consultant
  Supervisor, Cannabis Examiner Unit, 2026-09-17 1:23 PM
- `probes/` — the 23 files exactly as uploaded
- `correlate.py`, `timeline.py`, `rowcount.py`, `coverage.py` — re-derive every number below

24 uploads observed (23 probes; T-17's Area file appears twice). **10 accepted, 14 rejected.**

---

## A. The three findings that change the design

### A1. A success email exists. U-11 is DISPROVEN, not closed.

Every accepted file produced an email from `info@lcb.wa.gov`:

> **PRE**
> The file `Strain_413541_20250615213000_2026917T1252497.csv` you submitted has been
> processed. Date Submitted: 9/17/2026 12:52:20 PM For assistance, please contact the
> Cannabis Examiners by e-mail at examiner@lcb.wa.gov

Subject line: **"PRE: CCRS Processing Successful"**.

The bible said the opposite, in Part 06 line 9: *"There is no success email for the seven
weekly files in any LCB text … absence of an error email within the wait window is the
only 'pass' signal."* That sentence was **correctly sourced** — no LCB document mentions a
success email — and it was still **wrong about the system**. This is the single most
important lesson of the run: *the absence of a documented behaviour is not the absence of
the behaviour.* The register must be able to record "the docs are silent AND the system
does X."

The examiner confirmed it independently in answer 4: *"it is the email that submits the
file will get **confirmation** and error messages."*

**Consequences.**

1. The pass signal is now **positive and fast** (observed 30–90 s), not "wait and see
   nothing." The hub no longer needs a silence-timeout to declare a batch clean.
2. CCRS appends its own receipt token to the name it reports back:
   `Strain_413541_20250615213000` **`_2026917T1252497`** `.csv`. That token is a
   server-side correlation id — capture it, because it is the only shared key between our
   upload record and LCB's record of it. Format observed: `_<YYYYMD>T<H><mmss><ms>`,
   **not** zero-padded (`2026917T137959` = 2026-09-17 1:07:09.59 PM).
3. Both confirmation and error go to **the submitting email address** — U-15 answered.

### A2. Our E10 (Description required) blocks rows CCRS accepts.

**T-19 uploaded a Usable Cannabis product with an empty Description and was ACCEPTED**
(`Product_…_2026917T138506.csv`, success email 1:08 PM).

The guide states the requirement only as a Note `[G L0482-L0483]` and never as an error
string — Part 05 D-13 already recorded that we could not find error text. Now we know why:
**there is no error, because the rule is not enforced.**

`productRowIssues()` in `ccrs-preflight-core.ts:342` currently emits
`E10_DESCRIPTION_REQUIRED` and the builder **withholds the row**. So today we would refuse
to file a product that CCRS would have taken. Withholding a row is not a safe default: an
unfiled product is a compliance gap, and every Inventory row referencing it fails with
"Invalid Product."

**Recommendation: E10 must be demoted from error to warning** (file the row, flag it in
the hub). This is a code change for a later slice — recorded here, not made.

### A3. Excise tax is mandatory on every non-medical sale line.

T-42 returned, verbatim:

> `Only Medical Sales Excise tax can be 0`

This is materially different from the wording the plan predicted (`"Only Medical Sales can
be 0"`, `[G L1378]`). The real string names **Excise** explicitly, which confirms the
`OtherTax` column *is* the 37% cannabis excise and that **0.00 is legal only when the sale
is medical.**

Checked against our code: `ccrs-sales.ts` zeroes excise only for lines matched to a
`medical_exempt_sales` record, and the same `medicalOrderIds` set drives
`SaleType = RecreationalMedical` (L426). Because one set feeds both, a zeroed-excise line
is always also a medical-typed line. **Our current behaviour is consistent with the CCRS
rule** — this is a pre-existing safeguard confirmed by evidence, not a defect. It should
get a regression test naming this error string so it cannot silently drift.

---

## B. Every distinct CCRS error string (verbatim) — the triage table

These 11 strings are now **ground truth**, replacing every predicted wording. Note four of
them do not match the guide's phrasing, and one word — *CheckSum* — appears **nowhere** in
any LCB document (verified: 0 hits for `check ?sum` across all seven source files).

| # | Verbatim CCRS `ErrorMessage` | File type | Our gate | Status |
|---|---|---|---|---|
| 1 | `Duplicate Strain. The Strain must be unique for the LicenseNumber` | Strain | — | Harmless per `[G L0325]`; confirmed |
| 2 | `Strain name is invalid cannot be Unknown THC or Other` | Strain | E11 | **Wording confirmed** |
| 3 | `Duplicate External Identifier` | Area, Inventory | — | New rule, see §C |
| 4 | `If Useable Cannabis is selected Unit Weight Gram cannot be Zero` | Product | E9 | **Wording confirmed** (note LCB's own spelling *Useable*) |
| 5 | `Total Cost cannot equal zero` | Inventory | E7 | **Wording confirmed** |
| 6 | `QuantityOnHand is greater than InitialQuantity` | Inventory | E8 | **Wording confirmed**; LCB spelled it correctly here, unlike the FAQ's `QuanityOnHand` |
| 7 | `ExternalIdentifier not found` | Inventory | — | The Update-before-Insert failure |
| 8 | `Invalid Product` | Inventory | — | Product join **is** exact-match — see §C |
| 9 | `CheckSum and number of records don't match` | Inventory | E-new | Undocumented vocabulary |
| 10 | `Inventory Adjustment Details missing` | InventoryAdjustment | E13 | **Wording confirmed** |
| 11 | `Only Medical Sales Excise tax can be 0` | Sale | E12 | **Wording differs from prediction** |

### B1. The returned error file is a machine-readable artifact

CCRS returns **only the failing rows**, with the submitted columns **plus `ErrorMessage`**.
Two distinct shapes were observed, and this matters for anything that parses them:

- **Strain / Area / Product / InventoryAdjustment / Sale** — original column order,
  `ErrorMessage` **appended last**.
- **Inventory** — **columns reordered**, `ErrorMessage` in **position 3**, and an extra
  trailing `InventoryIdentifier` column that we never submitted (empty in all samples —
  presumably CCRS's internal key, populated only on rows it managed to match).

So a parser **must key on the column name, never on position.** Product also returned
`UnitWeightGrams` moved to last. This is a gift for the hub: error triage can be
automated by ingesting the returned CSV rather than scraping the email body.

---

## C. THE BIG ONE — rejection is all-or-nothing, and error messages are file-level

I initially wrote the opposite in a draft of this document, then tested it and was wrong.
Recording the correction because the conclusion is load-bearing.

**Measured: in all 14 rejected files, the number of data rows returned exactly equals the
number submitted. There is not one case of "only the bad row came back."**

| Probe | rows submitted | rows returned |
|---|---|---|
| T-11, T-17, T-54 | 2 | 2 |
| the other 11 | 1 | 1 |

### The decisive case — T-17

T-16 filed `AREA-1` successfully at 12:58:04. T-17 then submitted **AREA-1 + AREA-2**.
`AREA-2 had never been submitted before` — it cannot possibly be a duplicate. Yet CCRS
returned **both rows** stamped `Duplicate External Identifier`.

Corroborated by T-54: `CheckSum and number of records don't match` is unambiguously a
**file-level** fault, yet it too was stamped on each of the two rows individually.

### Two rules follow, and both are load-bearing

1. **A rejected file is filed in its entirety or not at all.** A valid row travelling in a
   file with one bad row **does not post**. So the safe recovery is to fix the bad row and
   **re-send the whole file** — there is no double-post risk, which is the opposite of the
   caution I nearly wrote.
2. **`ErrorMessage` is per-FILE, not per-ROW.** The same string is copied onto every
   returned row. **Do not build hub triage that says "row 7 is the broken one"** — the
   message identifies the *fault*, not the *row*. Any UI that points at a specific row
   based on this column would be actively misleading. To find the offending row we must
   re-derive it ourselves from the error string + our own pre-flight rules — which is
   exactly what `ccrs-preflight-core.ts` already does, and is now clearly worth more than
   we thought: **CCRS will not tell us which row is wrong.**

### Related proven behaviours

| Behaviour | Evidence | Why it matters |
|---|---|---|
| **`Duplicate External Identifier` is enforced on Area and Inventory** | T-33 re-sent `GWINV30A` (accepted at 13:12) as `Insert` and was rejected at 13:17:58 | Re-`Insert` of an existing id is an **error**, not an idempotent no-op. Settles **U-05: CCRS errors.** Weekly files must use `Update` for anything already filed — exactly what the examiner instructed in answer 2. |
| **The 10-minute prerequisite wait was NOT enforced on this run** | Last accepted Group 1 file (Product) 13:08:47 → first accepted Inventory 13:12:22 = **3.6 minutes**, and the Inventory file was **accepted**, resolving Strain/Area/Product references fine | `[G L0530]` says prerequisites must be submitted "prior to this submission by at least 10 minutes." Observed behaviour is more lenient. **Do not weaken our 10-minute rule** — one observation on a quiet PREprod box is not a guarantee about production under load, and the guide is still the written standard. But if a weekly run is ever late, a short gap is unlikely to be the cause of a failure. Logged as a new U-item, not as a design change. |
| **`Insert` of an existing Strain is a harmless duplicate error** | T-10 → T-11 | Consistent with `[G L0325]`. Strain files can be re-sent safely; the error is informational. |
| **Update of an unknown id fails** | T-35 → `ExternalIdentifier not found` | Confirms `[FAQ L0053]`. Combined with the row above: **Insert-then-Update is the only safe order**, and we must track which ids we have filed. |
| **Product join is exact-match** | T-37: `blue  dream flower 3.5g` (double space, lower case) → `Invalid Product` | Confirms `[G L0579-L0583]`. Product names must match byte-for-byte. Directly validates Part 07 R-5. |
| **`NumberRecords` mismatch rejects the file** | T-54 → `CheckSum and number of records don't match` | Confirms `[G L0203]`, but the *vocabulary* is undocumented. |
| **Comma-padded header rows are accepted** | T-11 processed successfully | **U-03 answered: padding is optional.** Both bare and padded work. No change needed. |
| **Lower-case filename prefix is accepted** | T-12 (`strain_…`) processed successfully | **U-02 answered: the prefix is NOT case-sensitive.** |
| **Hyphens are legal in an ExternalIdentifier** | T-21 (`GW-TEST-21`) succeeded | **U-06 answered.** |
| **`IsQuarantine=True` is accepted for a retailer** | T-17's AREA-2 failed only on duplicate id, not on quarantine | **U-04 partially answered:** CCRS *accepts* TRUE. It remains a compliance judgement (`[FAQ L0051]` says retailers should be FALSE), so the hub should still warn. |
| **`TotalCost = 0.01` trade sample is accepted** | T-31B succeeded | **U-16 answered:** the penny-cost encoding works. |
| **`F` / `T` are accepted for IsQuarantine** | Returned Area file shows `F`/`T` where we submitted `False`/`True` | CCRS normalises booleans on the way back. Do not treat the echo as a mismatch. |

---

## D. Examiner answers — logged verbatim

From **Brian McQuay, Data Consultant Supervisor, Cannabis Examiner Unit**, 2026-09-17:

> **1.** "Yes, I can get your data over to you that has been submitted by your integrator
> for your license, please give me a few days to get this together and prepared (if the
> size of all the files, exceeds what we can share via email, I will have a Box account
> set up with the files,)"

> **2.** "For your other questions, please continue to use the IDs already submitted and
> use the update path to update them vs creating new ones, this will simplify your
> workflow getting started doing your own uploads."

> **3.** "For retention, it is the same for all records as dictated in WAC 314-55-083,
> which is the standard 5 years for records."

> **4.** "Correct, after you unassign Cultivera, there is nothing else to complete, they
> will no longer have access to upload for your license once you unassign. And it is the
> email that submits the file will get confirmation and error messages."

### Register effects

| U-xx | Effect |
|---|---|
| **U-08** | **ANSWERED — option (a).** Continue using Cultivera's existing identifiers via the **Update** path. Do **not** Insert new ids, do **not** file InventoryTransfer old→new. Part 07 R-1/R-2 are confirmed; the InventoryTransfer contingency is **cancelled**. |
| **U-13** | **ANSWERED — 5 years, WAC 314-55-083.** Applies to uploaded CSVs *and* the returned error emails. Previously a verified negative in the CCRS docs; the authority is the WAC, not the guide. |
| **U-15** | **ANSWERED — the submitting email address** receives both confirmation and errors. Corroborated by the run itself. |
| **De-provisioning** | **ANSWERED — nothing beyond unassigning.** Access ends at unassignment. No LCB notification required. |
| **U-14 / Part 07 R-4, R-5** | **PENDING DELIVERY** — the actual filed data is coming within days, possibly via Box. This is the highest-value inbound artifact of the whole project. |

---

## E. Register status after this run

**Answered by the run:** U-02 (case-insensitive prefix), U-03 (padding optional),
U-05 (duplicate Insert errors), U-06 (hyphens legal), U-12 (Product join is exact-match,
via T-37 `Invalid Product`), U-16 (0.01 sample OK).
**Disproven by the run:** U-11 (a success email *does* exist).
**Partially answered:** U-04 (accepted, still a judgement call).
**Answered by the examiner:** U-08, U-13, U-15, de-provisioning.
**Still open:** U-09, U-10, and U-14 pending the data delivery.

That is **12 of the register's open items resolved in a single day**, and one long-standing
belief overturned.

### New U-items this run creates

| New | Statement | Why it is not yet proven |
|---|---|---|
| **U-17** | CCRS rejects a file as a whole; a good row in a bad file is never filed | Proven for 14/14 rejections here, but only on PREprod and only for single-fault files |
| **U-18** | The 10-minute prerequisite gap `[G L0530]` is advisory, not enforced | One observation (3.6 min accepted) on an idle system |
| **U-19** | The `_<receipt>` token CCRS appends to the returned file name is a stable server-side id we can correlate on | Format inferred from 10 samples; no LCB documentation exists |
| **U-20** | Production sends the identical mail without the `PRE` prefix | Inference from the `PRE` marker; unconfirmed until first production upload |
| **U-21** | An empty Description is permanently acceptable for Usable Cannabis | Accepted on 2026-09-17; the guide's Note `[G L0482-L0483]` suggests LCB may enforce it later |

---

## F. What must NOT be concluded from this run

Stated explicitly so a future agent does not over-read the evidence:

1. **T-18 vs T-19 are not symmetric.** T-18 (weight 0) errored; T-19 (no description) was
   accepted. Do not generalise "Product rules are enforced."
2. **We did not observe a clean T-33.** T-33 was a byte-identical re-Insert and it errored
   on duplicate id — so we still have **no** observation of a re-Insert where the ids were
   *new*. Idempotency of an unchanged file is still unproven.
3. **All-or-nothing is proven for rejection, not for acceptance.** Every rejected file
   returned all its rows (§C). We have **not** observed a file that was *partially*
   accepted, and we should not assume one is impossible — we have only shown that in 14/14
   rejections nothing suggested partial commit.
4. **The 10-minute observation is one data point on an idle test system.** It is evidence
   that the rule is not strictly enforced *there and then*. It is **not** grounds to
   change our sequencing. Keep the wait.
5. **PREprod ≠ production.** `[FAQ L0096]` — none of this touched the real record. In
   particular, the strains/areas/products now sitting in PREprod are test data; the
   duplicate errors we saw are artefacts of this run, not of Greenway's real filings.
6. **Success emails were observed in PREprod only.** The prefix `PRE` in the subject and
   body implies production sends the same mail without it, but that is an inference.
   Confirm on the first production upload before the hub relies on it.
