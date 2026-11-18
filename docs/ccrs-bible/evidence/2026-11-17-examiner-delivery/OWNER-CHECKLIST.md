# D250 owner checklist: load the delivery, send the two late weeks, clean up, confirm with Brian

Do the steps in order. Each step says what to look for before going on. If a step refuses, stop: the refusal message names the cause and the fix. Nothing in this list deletes data or guesses a value.

The data files Brian sent are kept off GitHub, because the repo is public. Keep them on your computer.

## 1. Apply migration 0368 (once)

1. Open the Supabase SQL editor and paste `supabase/migrations/0368_ccrs_delivery_loads.sql`.
2. Run it, then run its check SQL from `docs/MIGRATIONS_TO_RUN.md` (entry 0368).
3. Look for: RLS on shows `true` for both tables, `fn` = 1 and `loads_now` = 0. Then tick 0368 in MIGRATIONS_TO_RUN.

## 2. Load the examiner's delivery (once)

1. Go to Admin, then Compliance, then CCRS, then **Records**, and open the panel **Load the examiner's delivery**.
2. Drop the five files Brian sent:
   - `11_17_datarequest.xlsx`
   - `Data_Request_11_13_26_inventory.csv`
   - `Data_Request_11_13_26_sales.csv`
   - `Data_Request_11_17_26_inventory.csv`
   - `Data_Request_11_17_26_sales.csv`
3. Read the check. Each file should show a ✓. On scratch, the expected counts were about 1,174 lots, 65,264 products, 129 strains and 9 areas; the live counts may be a little lower if some rows are already on file.
4. Type `LOAD`. A second load plans nothing, so it is safe to repeat.

## 3. Send the two late weeks (11/01-11/07, then 11/08-11/14)

1. On the CCRS hub, open the panel **Late weeks: ready to upload?**. It lists the oldest week first.
2. For each week, do what the verdict says, in order:
   1. Answer any waiting files.
   2. Fix any blocking errors.
   3. Download and upload the files in group order: Group 1 (Strain, Area, Product), then Group 2 (Inventory), then Group 3 (Adjustment, Transfer, Sale). Leave no more than 15 minutes between files (Brian 4a `[EXAM2 L0029]`).
   4. Apply each success email.
   5. Record the week.
3. Every held row is listed with a reason and a next step. Rows released by the load in step 2 are marked as released.
4. Upload no later than each Sunday for the previous week (Brian 7a `[EXAM2 L0046]`).

## 4. Make the count list (protects stock on the shelf)

Turn your audit workbooks into a list of barcodes that were on the shelf:

```
npx tsx scripts/compliance/count-barcodes.ts --out counted.txt <each count workbook>.xlsx
```

Every barcode on this list is kept out of the clean-up. If you have no count workbooks, use `--no-counted-file` in step 5 instead of `--counted-file`.

## 5. Clean-up wave W1: plan, then send

1. Plan the wave. Nothing is sent at this step:

   ```
   npx tsx scripts/compliance/equalize-ccrs-wave.ts --phase inventory --wave W1 \
     --wave-date <today, YYYY-MM-DD> --composite 2026-11-17 --brian \
     --final-upload-date 2026-11-01 --counted-file counted.txt \
     --psql "<PGURL>" --report w1-plan.md
   ```

2. Read `w1-plan.md`:
   - **In this wave:** the lots that will be zeroed.
   - **Held:** each held lot, with its reason.
   - **Next wave:** lots left over beyond the 10,000 per wave.
   - **Q-B rows:** these show Brian's answers in use: cost 0.01, the strain already filed, and separate files.
3. Copy the `wave counts: {...}` line the script printed.
4. Send it, on the same day as `--wave-date`:

   ```
   ...the same arguments... --emit --expect '<the wave counts JSON>'
   ```

5. Upload the Inventory file. Apply its success email.

## 6. Clean-up adjustments for W1 (within 15 minutes of the success email)

1. Plan the adjustments:

   ```
   npx tsx scripts/compliance/equalize-ccrs-wave.ts --phase adjustments --wave W1 \
     --wave-date <the W1 date> --adjust-date <today> --psql "<PGURL>" --report w1-adjust.md
   ```

2. Send them, upload the file, and apply its email:

   ```
   ...the same arguments... --emit --expect '<the adjust counts JSON>'
   ```

3. Only lots whose Update CCRS accepted get a Reconciliation row.
4. If `w1-plan.md` listed a next wave, repeat steps 5-6 as W2, W3, and so on.

## 7. Ask Brian for a fresh copy, then check it

1. When every wave is in, email the Examiner unit (`examiner@lcb.wa.gov`; they answer in 24-48 hours, Brian 2c `[EXAM2 L0019]`). Ask for:
   - a full copy of Inventory (including quantity 0), Product, Strain and Area;
   - the date the data was pulled.

   The draft email is in your working folder (`ccrs-work/EMAIL-2026-11-17-examiner-post-cleanup-copy.md`).
2. When it arrives, run the check:

   ```
   npx tsx scripts/compliance/verify-ccrs-copy.ts --as-of <pull date> \
     --inventory Inventory.csv --product Product.csv --strain Strain.csv --area Area.csv \
     --psql "<PGURL>" --report copy-check.md
   ```

3. Exit code 0 means CCRS matches what we sent. Any difference is named in `copy-check.md`.

## What was never changed

- No Area is deleted. The Area plan is update-only, because Brian 5a says never to delete an Area that a lot still names `[EXAM2 L0040]`.
- Lots already at 0 are not touched, following Brian 4b, "focus on going forward" `[EXAM2 L0031]`.
- A lot we hold, a lot our own files sent, and a counted barcode are never zeroed.
