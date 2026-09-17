"""One-shot editor: fold the 2026-09-17 PREprod run + examiner reply into Part 12.

Rewrites only the final `Status` cell of the affected rows, then appends the new
U-17..U-21 rows. Idempotent: refuses to run twice (checks for a marker).
"""
import re, sys, os

P = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "ccrs-bible", "12-unverified-register.md")
P = os.path.abspath(P)
t = open(P, encoding="utf-8").read()

if "U-17" in t:
    print("Already applied (U-17 present). No change.")
    sys.exit(0)

RUN = "[run 2026-09-17]"

STATUS = {
 "U-02": ("**ANSWERED 2026-09-17** — the prefix is **NOT** case-sensitive. T-12 uploaded "
          "`strain_413541_20250615213000.csv` (lower-case) and CCRS accepted it "
          f"(processed 12:57). {RUN} No emitter change needed."),
 "U-03": ("**ANSWERED 2026-09-17** — padding is **OPTIONAL**. T-10 (bare header rows) and "
          "T-11 (comma-padded) were **both** accepted. `assembleCcrsFile`'s unpadded output "
          f"is correct as-is. {RUN}"),
 "U-04": ("**PARTIALLY ANSWERED 2026-09-17** — CCRS **accepts** `IsQuarantine=True` from a "
          "retailer (T-17's AREA-2 was rejected only by a file-level duplicate fault, never "
          "for quarantine). Acceptance is **not** endorsement: `[FAQ L0051]` still says "
          f"retailers should be FALSE. Keep as a hub **warning**, never a block. {RUN}"),
 "U-05": ("**ANSWERED 2026-09-17** — CCRS **errors**. T-33 re-`Insert`ed `GWINV30A` (accepted "
          "13:12) and was rejected 13:17:58 \"Duplicate External Identifier\". A re-Insert is "
          "**not** an idempotent no-op → the weekly file must `Update` anything already filed, "
          f"which is exactly what the examiner instructed. {RUN}"),
 "U-06": ("**ANSWERED 2026-09-17** — hyphens are legal. T-21 filed `GW-TEST-21` successfully. "
          f"`sanitizeExternalId` may keep passing hyphens through. {RUN}"),
 "U-08": ("**ANSWERED 2026-09-17 by the Cannabis Examiner Unit** (Brian McQuay, Data Consultant "
          "Supervisor) — **option (a)**, verbatim: \"please continue to use the IDs already "
          "submitted and use the update path to update them vs creating new ones, this will "
          "simplify your workflow getting started doing your own uploads.\" Part 07 R-1/R-2 "
          "**confirmed**; the (b) InventoryTransfer cutover is **CANCELLED**."),
 "U-11": ("**DISPROVEN 2026-09-17** — a success email **does** exist. Subject `PRE: CCRS "
          "Processing Successful`, from `info@lcb.wa.gov`: \"The file "
          "`Strain_413541_20250615213000_2026917T1252497.csv` you submitted has been processed. "
          "Date Submitted: 9/17/2026 12:52:20 PM\". Observed on **10/10** accepted files, "
          "latency 30–90 s. Corroborated by the examiner: \"it is the email that submits the "
          "file will get confirmation and error messages.\" **The pass signal is positive, not "
          "silence.** Part 06's old premise is superseded. *No LCB document mentions this — "
          "silence in the docs is not silence in the system.*"),
 "U-12": ("**ANSWERED 2026-09-17** — the Inventory→Product join is **exact-match**. T-37 sent "
          "\"blue  dream flower 3.5g\" (lower case, double space) against filed \"Blue Dream "
          "Flower 3.5g\" and got \"Invalid Product\". Confirms `[G L0579-L0583]` and validates "
          f"Part 07 R-5. {RUN}"),
 "U-13": ("**ANSWERED 2026-09-17** — **5 years, per WAC 314-55-083.** Examiner verbatim: \"For "
          "retention, it is the same for all records as dictated in WAC 314-55-083, which is the "
          "standard 5 years for records.\" Applies to uploaded CSVs **and** returned error "
          "emails. Note: our earlier \"no retention text\" finding was right about the CCRS "
          "sources and incomplete about the law — the authority is the WAC."),
 "U-14": ("**ANSWERED 2026-09-17** — both formats captured. **Errors** are returned as a **CSV "
          "attachment**: the submitted file echoed back with an `ErrorMessage` column, **one "
          "file per upload**, containing **every** submitted row. **Successes** are a plain "
          "email naming the file. CCRS appends a receipt token to the name it reports "
          "(`…_20250615213000_2026917T1252497.csv`). 14 error files + 10 success emails are "
          "committed under `docs/ccrs-bible/evidence/2026-09-17-preprod-run/`. **Two traps:** "
          "`ErrorMessage` is per-FILE not per-row, and Inventory/Product reorder their columns "
          "— parse by name, never position."),
 "U-15": ("**ANSWERED 2026-09-17** — the **submitting** email address receives both. Examiner "
          "verbatim: \"it is the email that submits the file will get confirmation and error "
          "messages.\" Corroborated by the run: all 10 confirmations and all 14 error files "
          "arrived at the uploading account."),
 "U-16": ("**ANSWERED 2026-09-17** — accepted. T-31B filed a trade-sample lot with "
          f"`TotalCost = 0.01` successfully. The S-02 sample branch is correct. {RUN}"),
}

lines = t.split("\n")
hits = 0
for i, l in enumerate(lines):
    m = re.match(r"\| (U-\d+) \|", l)
    if not m:
        continue
    uid = m.group(1)
    if uid not in STATUS:
        continue
    cells = l.split("|")
    # last real cell is cells[-2] (line ends with '|')
    cells[-2] = " " + STATUS[uid] + " "
    lines[i] = "|".join(cells)
    hits += 1

t = "\n".join(lines)
print(f"rewrote {hits} status cells (expected {len(STATUS)})")
if hits != len(STATUS):
    sys.exit("ABORT: did not match every targeted row")

NEW = """| U-17 | CCRS rejects a file as a **whole**; a valid row inside a rejected file is never filed | Measured: **14/14** rejected files returned **every** data row submitted, never a subset. Decisive case: T-17's `AREA-2` had never been submitted yet came back "Duplicate External Identifier"; T-54's file-level checksum fault was likewise stamped on both rows | PRE **T-70** (mixed-fault probe, Part 06) | O | S-06b recovery design; hub "re-send the whole file" copy | OPEN — strongly evidenced |
| U-18 | The 10-minute prerequisite gap `[G L0530]` is advisory, not enforced | Observed: last Group-1 accept 13:08:47 → Inventory accepted 13:12:22 = **3.6 min**, references resolved fine | PRE **T-71**; or ask the examiner | O | weekly scheduler tolerance (do **not** relax the rule on one observation) | OPEN |
| U-19 | The `_<receipt>` token CCRS appends to the echoed file name is a stable correlation id | 10 samples, e.g. `_2026917T1252497` = 2026-09-17 12:52:49.7, **not** zero-padded; no LCB documentation exists | Confirm shape on the first production upload | A | S-06 `ccrs_upload_events` correlation column | OPEN |
| U-20 | Production sends the identical confirmation without the `PRE` prefix | Inference from the `PRE` marker in the PREprod subject/body; never observed in production | First production upload | O | hub "confirmed" state copy | OPEN |
| U-21 | An empty `Description` is **permanently** acceptable for Usable Cannabis | T-19 was **accepted** 13:07:18 despite the guide's Note `[G L0482-L0483]`; the Note exists, so LCB may begin enforcing | PRE **T-72** (re-run monthly) | A | S-02b demotes E10 error→warning | OPEN |"""

# append after the last U- row
idx = max(i for i, l in enumerate(lines) if re.match(r"\| U-\d+ \|", l))
lines = t.split("\n")
lines.insert(idx + 1, NEW)
t = "\n".join(lines)

open(P, "w", encoding="utf-8").write(t)
print("appended U-17..U-21")
