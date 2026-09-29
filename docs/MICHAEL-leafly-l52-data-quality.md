# Leafly L-52: why "Data quality" stayed red, and how to get it green

Michael, this is the plain-English write-up of the last certification criterion.

## What you showed me

- **Data quality screenshot:** criterion 5 was **NOT MET** with the message that the menu had "never been read back".
- **"Read the menu back" PDF:** "753 of 811 matched, 16 problems, 24 to look at". The line under it said "No record of a previous push…", so the check was run against the menu as it stands now, not against what was sent.

## What I checked, and how

I read the code paths for the read-back, the baseline chooser, the reconciler and the certification gate. I also read the live sandbox menu so I could prove each finding from evidence rather than guess.

**Disclosure (this matters for criterion 3):** to read the live menu I made **read-only** calls from my workspace: one token request to Leafly's sandbox sign-on, then `GET /menu`. Nothing was written, deleted or pushed. Criterion 3 asks you to confirm we use no manual tools, so you should know these calls happened. They were diagnostic reads only, and they were in the **sandbox**.

## Root cause 1: the page could never see a read-back

When you pressed "Read the menu back from Leafly and check it", the result appeared on screen but was **never stored**. Its log row had an empty payload. The certification section on the page was built with `reconcile: null` hard-coded, so however many times you read back, criterion 5 would still say "never been read back".

**Fix:**
- Every read-back now stores a small **verdict** on its own log row. The verdict records Leafly's answer, the error and warning counts, the kinds of error, what it was compared against, whether it ran too soon after a push, and when it ran. It contains no menu data.
- The page looks that verdict up **directly**, not from the last 40 log rows. Automatic syncs add a row every run, so a morning read-back would otherwise drop off the list by afternoon.
- The rules for what counts are strict. A read-back **does not count** as proof if any of these is true:
  - Leafly returned an error;
  - it ran inside Leafly's ~2.5-minute processing window after a push;
  - it had no record of what was sent (the orange "No record…" case);
  - it checked only a targeted push rather than the whole menu;
  - it matched zero products.
- Any real difference makes the criterion **not met**, and the page gives you the fix.
- A push made after the read-back does not undo it. The page simply says how many pushes have happened since.

## Root cause 2: the read-back compared against the wrong thing (811 vs 753)

Automatic syncs and deletes store only a **compact** record: which ids were sent, deleted or held back, not the full items. The baseline chooser treated that record as unreadable. It then fell back to a fresh preview that skips your sync settings, size repair and withholding. That preview had **811** items, Leafly had **753**, and the extra 58 showed up as false problems.

**Fix:** a new baseline, **rebuilt from sync state**.
- It rebuilds the menu exactly as the automatic sync builds it, including your settings and size repair.
- It keeps only the products whose content fingerprint matches the fingerprint stored when they were last sent. So the read-back compares against **what was sent**, proven product by product.
- Products that have changed here since they were last sent cannot be proven. They are counted as **"not checked this time"**, not reported as errors, and the next sync sends them.

## False alarms the check no longer raises

These are all things **Leafly** does to the menu after we send it. I confirmed each one in the live menu.

- **Strain names.** Leafly renames products to match its own strain names. Examples: GG4 → Original Glue, Royal Girl Scout Cookies → Royal GSC, Sunset Sherbet → Sherbet. A name difference now becomes a **warning**, not an error, but only when a strict rule proves that the only changed words are strain words. Any other name difference is still an error.
- **Stand-in images.** For products with no photo, Leafly adds its own image: 728 product-type icons and 25 brand logos. These are recognised by exact Leafly hosts and shown as a note, not a warning.

## Real problems it still finds, and your one manual step

Four products are held at Leafly with **no sizes at all**, and Leafly has hidden them. They were all created 2026-09-22 between 06:26 and 06:29 and have not changed since:

- `pos-6384543dd7ee`
- `pos-566470ef3889`
- `pos-33cc1ca16194`
- `pos-8d9b834230f3`

These are real differences, so they stay **errors**. The report now tells you how to fix each one.

The five products the old report called "missing" (`pos-28303ca50762`, `pos-568d9904e73c`, `pos-323083449a42`, `pos-60edb3570df0`, `pos-5a58ded11852`) **are at Leafly under the same ids**. They were false alarms from root cause 2.

## Data we now send better

- **Zero cannabinoids become empty.** A CBD or THC value of exactly 0 is now sent as empty (null), because Leafly's spec asks for null rather than 0. Real small values such as 0.24 mg are still sent.
- **Placeholder strains become empty.** Strains like "No Strain", "Paraphernalia", "Mixed" or "NA" are now sent as empty, because Leafly's spec asks for null rather than "NA". Leafly then matches the strain from the product name. The rule is now shared with the POS missing-product check, so both sides agree.

## Your steps to turn criterion 5 green

1. Open the Leafly integration page and use **"Remove products from Leafly"** on the four ids listed above.
2. Let the next **automatic sync** run, or press "Send my whole menu". It sends those four products again with their sizes.
3. **Wait at least 3 minutes.**
4. Press **"Read the menu back from Leafly and check it"**. Under "What this was checked against" it should say it was rebuilt from what was sent, **not** the orange "No record…" text.
5. **Reload the page.** Criterion 5 now shows the stored verdict. If it is still not met, it names the remaining differences and the fix.

## Things only you can fix at the source (in the POS)

These do not block certification, but they make the Leafly menu less accurate.

- **Accessories typed as Concentrate.** 13 products are typed Concentrate but carry placeholder strains ("No Strain" ×7, "Paraphernalia" ×5, "Mixed" ×1). They look like accessories, so their category in the POS should be corrected. The placeholder strains are no longer sent.
- **DOHC edible potency.** Some "100mg" edibles show about 0.25 mg THC per item. That looks like a per-serving or unit mix-up in the POS data. Please check the labels and correct the potency there. The code does not guess at a correction.

## Checks run

- Every self-test suite passes. The ones for this work: baseline 56, read-back 133, read-back proof 40, certification 85, payload 217, placeholder strains 43. Each is registered in both test runners, with raised floors.
- The scoped type-check is clean.
- The Leafly compliance tests pass: 59 files, 2,251 tests.
- No database migrations. Nothing changed in how money is handled.
