# 16 — Owner guide: S-13 Areas, the P-02 PREprod probe, and your end-to-end PREprod test

Written 2026-10-07. Everything below runs on **PREprod only** (`https://precannabisreporting.lcb.wa.gov`). Nothing here uploads to production.

---

## Part 1 — What changed for you (S-13)

- **No more "Quarantine" Area.** CCRS says IsQuarantine must be False for cannabis `[G L0298-L0299]`. Every lot is now reported in **Sales Floor**, and every Area row says `FALSE`. A lot on hold in our system stays on hold here, but CCRS sees it in Sales Floor. You will see a yellow advisory, **E45**, listing those lots.
- **Production Area file = 4 Updates, no Deletes.** CCRS holds 9 Area records under your license, and two different ones are called "Sales Floor". The system now sends an **Update** for your 4 kept records (`C1100011`–`C1100014`) so they are the newest "Sales Floor" `[BRIAN A12]`. It sends **no Delete** until test P-02 (Part 2) proves Delete is safe.
- **No more invented `AREA-SALES-FLOOR` id.** If the system ever can't tell what CCRS holds, it shows a red **E46** and blocks the batch. It does not guess.

---

## Part 2 — P-02 probe (about 45 minutes, mostly waiting)

**Why:** this tells us whether we can ever Delete the 5 Area records you don't use.

1. **Generate the files** (I can do this for you; just ask). Pick a run id you have never used: `P` + today's date + a letter (today's `P20261007A` is already used, so use `P20261007B`, or the next date).
   ```
   npx tsx scripts/compliance/generate-p02-area-probe.ts --run P20261008A
   ```
   **Expected:** `Wrote 10 P-02 files + MANIFEST.md to …`, with 10 numbered folders and `MANIFEST.md`.
2. **Open `MANIFEST.md`** and follow it exactly, one file at a time, waiting for each email.
   - Files 1–5: **expect** "PRE: CCRS Processing Successful" for each. Wait 10 minutes before file 5.
   - File 6: **this is the question.** Save the email exactly as it arrives, plus any error CSV.
   - Files 7–10: **expect** 7 success, 8 `Error: Invalid Area`, 9 success, 10 success. Wait 10 minutes before files 7 and 10.
3. **Send me every email and CSV.** I file them in `docs/ccrs-bible/evidence/<run>/`.
4. **What happens next** (the MANIFEST has the full table):
   - **A**: everything as expected → I ask you to confirm keeping set C, then switch production to Delete mode in a reviewed change.
   - **B, C, D or E** → production stays Update-only. That is already safe.

---

## Part 3 — Your end-to-end PREprod test (Cultivera products + receiving intake → test sales → PREprod upload)

**Before you start:** CCRS page → **PREprod (test site)** tab.
- If the amber "PREprod ledger not started (…)" box shows, go to **CCRS files → PREprod set-up (one time per test cycle)** and press **Start PREprod ledger** once.
  - **Expected:** the amber box goes away on reload.
  - **If it does not**, write down the exact text in brackets and send it to me. That is roadmap item **R-4**; don't try to work around it.

| Step | Do this | Expected result |
|---|---|---|
| 1 | Receive the Cultivera products through receiving intake as normal | Lots appear in inventory with your costs |
| 2 | Ring a few test sales at the register | Sales show in the week's report |
| 3 | CCRS page, PREprod tab, the week of the test sales: press **Assign PREprod ids** (with a new run id) | The blue "no CCRS Product id yet" box clears |
| 4 | Read the validation box | "✓ Validation passed". Yellow E45 only if a lot is on hold |
| 5 | Look at the **Area** file in the file list | **First PREprod run:** 1 row, `Insert`, Name `Sales Floor`, id `GWA-SALES-FLOOR`, IsQuarantine `FALSE`. **Later runs, after that file succeeded:** no Area file at all (nothing to send) |
| 6 | Press **Download batch zip** | Files numbered in upload order |
| 7 | Upload in order: Strain / Area / Product → wait 10 min → Inventory → wait 10 min → Sale (and others) `[G L0530]` | One "PRE: CCRS Processing Successful" email per file |
| 8 | For each file in **CCRS files**: **Mark uploaded** (time in Pacific), then **Record success** or **Record error file** when the email arrives | Each file moves to succeeded / errored |
| 9 | Send me any error email or CSV | I triage it to the guide error and fix it |

**Not expected** (tell me if you see any of these):
- an Area row saying `TRUE`;
- an Area id `AREA-SALES-FLOOR` or `AREA-QUARANTINE`;
- "Sold item cannot be in Quarantine";
- "Invalid Area".
