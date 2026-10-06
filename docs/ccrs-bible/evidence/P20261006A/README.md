# PREprod evidence, 2026-10-06: runs P20261006A (P-04b) and P20261005B (S-11), plus run-A Strain/Area/Inventory C2

Uploaded by the owner (Michael Lyman) to `https://precannabisreporting.lcb.wa.gov`, license 413541, on 2026-10-06 (Pacific).
Owner report, verbatim: *"i have now uploaded all files from preprod-P20261006A-P04b.zip and they were all successful, no errors in any of the files. i have also finished uploading all preprod-P20261005B-S11.zip, and all 5 of them were uploaded successfully, no errors in any of the files."*
**28 files, 28 success emails, 0 error files.** Every email came from `info@lcb.wa.gov` and had the body *"PRE The file <name>_<CCRS token>.csv you submitted has been processed. Date Submitted: <time> For assistance, please contact the Cannabis Examiners by e-mail at examiner@lcb.wa.gov"* (wording pasted by the owner). The full list is in `success-emails-2026-10-06.txt`.

The exact bytes of every file sent are the generator outputs. They are reproducible from `scripts/compliance/generate-p04-fidelity-probe.ts` (P-04b), `/workspace/tools/gen-s11-casing-probe.ts` (P20261005B; workspace tool, its 5 output files are byte-quoted in this folder's `SENT-data-rows.txt`), and `/workspace/tools/gen-u17-probe.ts` (file 20). The data rows quoted below were read back from those files with `cat -A`.

## What each result proves (and what it does not)

| # | File | Data row it carried (exact) | Result | Proves |
|---|---|---|---|---|
| P-04b 1–2 | Strain, Area | `P20261006A Fidelity Kush` / `P20261006A Sales Floor` | Success | prerequisites filed |
| P-04b 3–10 | 8 Product Inserts, one case each | C3 TAB, C4 `ñ è`, C5 `Ã©`, C6 double spaces, C8 trailing space (sent bare), C9 `'`, Q1 `7" Cone`, Q2 `"…"` wrapped | Success ×8 | each name is accepted by the Product file |
| P-04b 11–18 | 8 Inventory Inserts, each naming its case's Product by the **same bytes** | — | Success ×8 | **the Inventory→Product join finds every one of the 8 names** |
| P-04b 19 | one Inventory **Update** of the 6 plain cases, QoH 10→9 | — | Success | the Update path round-trips the same 6 names a second time |
| P-04b 20 (optional) | Inventory Insert naming run-A product `P20261005A Pre-Rolls  - Double  Space - 5g` (P06) | — | Success | **U-17: CCRS filed the clean rows of run A's failed Product file** (see below) |
| run A 01, 02 | Strain/Area of P20261005A | — | Success | prerequisites for file 20 |
| run A 05 | Inventory C2 naming `"P20261005A 7"" Cone Fidelity - 1g"` (RFC 4180 quoted, old S-09 encoder) | — | Success | see the U-44 note: proves nothing about storage, only that this run-A product was also filed |
| S-11 1–4 | Strain `P20261005B Dutch Treat`, Area, Product, Inventory naming `P20261005B Dutch Treat` | — | Success ×4 | expected |
| S-11 5 (control) | Inventory naming **`P20261005B Dutch treat`** (lower-case t; this spelling was **never** sent in any Strain file) | — | **Success** | **U-45: CCRS's Inventory→Strain lookup ignores capital letters** |

### The limit on "round-trip"

Every Inventory join above compares the bytes we sent in the Inventory file with what CCRS stored from the Product file. **Both files go through the same reader.** So suppose CCRS changed a name in exactly the same way both times, for example by trimming a trailing space or removing a `"`. The join would still succeed. These results therefore prove that **a name is accepted and can be referenced again using the same bytes.** That is the thing a rejection depends on. They do **not** prove the stored bytes are identical to ours. Only a Service Desk copy of PREprod `[BRIAN A20]` shows the stored form. That residue is tracked as U-27b and U-44b (Part 12).

### U-17: per-row acceptance, now observed

Run A's Product file `Product_413541_20261005182936.csv` had 8 rows. CCRS's error CSV listed only the 3 rows containing a comma (`../P20261005A/`). File 20 is an Inventory Insert naming P06, one of the 5 rows **not** listed. It succeeded. CCRS can only join an Inventory row to a Product it holds, so P06 was filed from a file that also produced an error email. This matches Brian's A24 (*"individual row errors are specific to that row, so a file that passes operation and header validation can have 5 rows fail and 1 row pass"*). The two conclusions:

1. After an error email, the rows **not** in the error file are filed. Re-sending the whole file would try to Insert them again, and each would come back `Duplicate External Identifier`. **Re-send only the rows the error file lists.**
2. In this run the error file listed **only** the failing rows. The September observation that every row is echoed came from files where every row shared the same fault (Part 15).

### U-45: the control file (S-11 file 5)

S-11 expected file 5 to fail `Invalid Strain`. That expectation relied on the Upload Guide's wording, *"Valid Values: Strain.Strain"* `[G L0552]`, and on Brian's A16 instruction *"do not submit the same name with a variation of captilization. EX: Dutch Treat vs Dutch treat"*. Neither says how the lookup compares. CCRS **accepted** the row. CCRS reports a row it cannot join as an error: T-37 came back `Invalid Product` in a row-level error file, and run A's 3 comma rows came back the same way. So a success email with no error file means this row joined.

Production corroborates this independently (`analysis3/s12/strain_fold.py` → `strain_fold.out`, over Brian's 2026-09-21 delivery):
- **1,017** filed Inventory rows name a strain that is **not** in the Strain report exactly, but **is** there when capitals are ignored. That is 348 distinct pairs, e.g. 42 lots `GOLDEN PINEAPPLE` → filed `Golden Pineapple`, and 36 lots `Trophy Wife` → filed `Trophy wife`. They were created 2019–2022. Strains cannot be deleted `[G L0319-L0320]`, so the exact spelling never existed.
- Only **22** rows name a strain absent even when capitals are ignored (e.g. `4:01`, `DefaultStrain`, the 3 quote-wrapped report artifacts).

**What it changes:** a capital-letter mismatch between a lot and its Strain is **not** a rejection risk. That makes S-11's spelling fix a tidiness rule (Brian A16), not a defence against rejection, and it stays in place. D-06 ("insert the 16 hard-missing strains only") is confirmed correct: the other ~348 case-only mismatches need no Strain row.

**What it does not change:**
- The **Product** join. T-37 (`blue  dream flower 3.5g` → `Invalid Product`) differed in both capitals and spaces, so it does not isolate case. Product names stay byte-exact on our side.
- The **Strain file**. Whether CCRS would answer `Duplicate Strain` to a case variant was not tested. We never send one (A16).
- Spaces and punctuation in strain names. Only letter case was tested.

### U-44: bare double quotes

Q1 (`P20261006A 7" Cone Fidelity - 1g`) and Q2 (`"P20261006A Mama J's Quoted - 3.5g"`) were filed as Products and then found by Inventory using the same bytes. A value containing `"` is therefore accepted and can be referenced. S-09c lifts the E43 hold. Whether the stored Name keeps the `"` characters is U-44b (copy).

Run A file 05 (RFC 4180 form `"…7"" Cone…"`) also succeeded, but in run A that same doubled form was in the Product file too, so the two sides were consistent. It proves only that this product was filed, and it is not used as evidence for any rule.

## Recommended follow-up (one email; owner decides)

Ask the Service Desk for a **PREprod copy** for license 413541 covering 2026-10-05 → 2026-10-06 (Product, Inventory, Strain). Brian A20 says such copies are available. That copy settles U-27b, U-44b and U-45b (how lot `P20261005B-L02` is stored) in one step. A draft is in the S-09c owner guide.
