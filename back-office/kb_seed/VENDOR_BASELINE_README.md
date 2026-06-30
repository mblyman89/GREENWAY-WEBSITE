# Vendor KB Baseline — the crawler-accuracy "golden set"

This folder now contains a small, **human-verified** baseline of 12 of Greenway's
top vendors. Its only job is to give us a trusted yardstick so we can measure how
accurate the web crawler is *before* we trust its output at scale.

## What's here

| File | What it is |
|------|------------|
| `VENDOR_BASELINE_RESEARCH.md` | The research record. Every fact, its source, and a confidence score per vendor. Strict no-guessing — unconfirmed vendors are flagged, not invented. |
| `vendors_baseline_seed.sql` | Idempotent upsert (on `slug`) that loads the 9 confirmed vendors as `draft` rows. The 3 unconfirmed vendors are commented-out stubs. |
| `VENDOR_BASELINE_README.md` | This file. |

## How to load it (owner — manual, in Supabase SQL editor)

Per our standing rule, migrations and seeds are applied by you, by hand:

1. Make sure migration `0003_slice3_vendors_brands.sql` has already been run
   (the `vendors` table must exist).
2. Open the Supabase SQL editor.
3. Paste the contents of `vendors_baseline_seed.sql` and run it.
4. It's **idempotent** — safe to run again. Re-running updates the facts but will
   **not** un-publish any vendor an employee has already reviewed and published
   (we deliberately don't overwrite `status` on conflict).

The rows load as `status = 'draft'`, so they show up in the back office for an
employee to review and publish — same as any other AI/crawler/seed output.

## How it scores the crawler

The 12 vendors here are the same vendors the crawler can research on demand.
The evaluation loop is:

1. Run the crawler's vendor research for one of these 12 (it produces a *draft*).
2. Compare the crawler's draft, field by field, against the verified facts in
   `VENDOR_BASELINE_RESEARCH.md`:
   - **Match** = the crawler found the same value we verified (true positive).
   - **Miss** = the crawler left a field blank we have (false negative).
   - **Wrong/invented** = the crawler produced a value that contradicts the
     baseline (false positive — the dangerous kind).
3. Tally matches / misses / wrongs across the 9 confirmed vendors to get an
   accuracy and a hallucination rate.
4. The 3 held-back vendors (Mountain Hi, Evergreen Hydro Farms, Canna Processing)
   are a **negative test**: a well-behaved crawler should also struggle to find
   clean facts for them and should NOT confidently invent data. If the crawler
   returns confident, specific facts for these three, that's a red flag we want
   to catch.

This is the seed for the "golden-set eval harness" noted under DF-8 in
`CRAWLER_AND_DATA_FILLING_TODO.md`.

## Confirmed vs. held back

- **Seeded (9):** Grow Op Farms, Lifted Cannabis, Canna Organix, Evergreen Herbal,
  Green Revolution, Klaritie Farms, Alpha Crux, Northwest Harvesting Co, and
  Dogtown Pioneers (medium confidence, clearly flagged).
- **Held back (3) — need owner input:**
  - **Mountain Hi** — ambiguous: "Mountain High Cannabis" (mhccanna.com) is a
    *retailer* in Republic, WA, not a producer/processor; Leafly's "Mountain High
    Garden" producer page is empty and shows Boardman, OR. Please confirm the exact
    entity Greenway buys from.
  - **Evergreen Hydro Farms** and **Canna Processing** — no official site or clean
    licensee profile found. Please provide the exact legal entity name or UBI and
    we'll match them against WA state records and seed them.
