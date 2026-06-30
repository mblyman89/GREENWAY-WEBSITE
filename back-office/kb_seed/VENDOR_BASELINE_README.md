# Vendor KB Baseline — the crawler-accuracy "golden set"

This folder now contains a small, **human-verified** baseline of 12 of Greenway's
top vendors. Its only job is to give us a trusted yardstick so we can measure how
accurate the web crawler is *before* we trust its output at scale.

## What's here

| File | What it is |
|------|------------|
| `VENDOR_BASELINE_RESEARCH.md` | The research record. Every fact, its source, and a confidence score per vendor. Strict no-guessing — unconfirmed vendors are flagged, not invented. |
| `vendors_baseline_seed.sql` | Idempotent upsert (on `slug`) that loads the 9 confirmed golden-set vendors as `draft` rows. The 3 unconfirmed vendors are commented-out stubs. |
| `vendors_batch2_seed.sql` | **Batch 2.** Idempotent upsert (on `slug`) that loads 15 confirmed producer/processors as `draft` rows (`sort_order` 10–24). The 6 unconfirmed/low vendors are commented-out stubs. Research/audit is the "Batch 2" section of `VENDOR_BASELINE_RESEARCH.md`. |
| `vendors_batch3_seed.sql` | **Batch 3.** Idempotent upsert (on `slug`) that loads 20 confirmed producer/processors / WA cannabis brands as `draft` rows (`sort_order` 25–44) from a ~80-name list. Duplicates of earlier batches are skipped; ~55 unconfirmed/holding-company names are flagged (commented-out stubs). Research/audit is the "Batch 3" section of `VENDOR_BASELINE_RESEARCH.md`. |
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

## Batch 2 — 21 producer/processors (load `vendors_batch2_seed.sql`)

Same load procedure as above: run `vendors_batch2_seed.sql` in the Supabase SQL
editor after migration `0003`. Idempotent; loads as `status='draft'`; does not
overwrite `status` on re-run. Full per-vendor sources + confidence are in the
"Batch 2" section of `VENDOR_BASELINE_RESEARCH.md`.

- **Seeded (15):** Fire Bros., Canna Pacific, Clarity Farms, Seattle Bubble Works,
  Heavenly Buds, Ceres Garden, Avitas, Sky High Gardens, Mfused, Seattle's Private
  Reserve, Quality Green Trees (operates Freddy's Fuego), Cultivar Farms, Edgemont
  Group, Fireline Cannabis, Botanica Seattle (Mr. Moxey's + Journeyman).
- **Held back (6) — need owner input:** Washington Packaging and Processing,
  R&B Group, Virtual Services, Wamsterdam Farms, Botanical Arts (no official/
  licensee source under the given name), and **Alpenglow Extracts** (a Spokane
  Valley brand is cited by a single weak source; must not be confused with the
  California brand "Alpenglow Farms 707" — please confirm the WA entity/UBI).
  Provide the legal entity name / UBI for any of these and we'll seed them.

## Batch 3 — large ~80-name list (load `vendors_batch3_seed.sql`)

Same load procedure: run `vendors_batch3_seed.sql` in the Supabase SQL editor after
migration `0003`. Idempotent; loads as `status='draft'`; does not overwrite `status`
on re-run. Full per-vendor sources + confidence are in the "Batch 3" section of
`VENDOR_BASELINE_RESEARCH.md`.

- **Seeded (20):** Northwest Cannabis Solutions (=NWCS), Skagit Organics, CannaSol
  Farms, Forbidden Farms, SKORD, Xtracted Labs (Refine), Craft Elixirs (Pioneer
  Squares), Royal Tree Gardens, New Leaf Enterprises, Tumbleweed Farm, Free Rain
  Farms, Blue Roots, Spark Industries, Legacy Organics, Mama J's, Two Heads Co.,
  My Weed Bunny, Walden Cannabis (=Walden), 1937 Farms, Top Shelf.
- **Duplicates (4) — not re-seeded:** FIREBROS (fire-bros), Klaritie Farms,
  Alpha Crux, Edgemont Group.
- **Flagged/unconfirmed (~55) — need owner input:** a large set of WA cannabis
  brand names with weak/ambiguous sourcing, plus holding-company / consultancy /
  packaging entities (TTL Holdings, RGL Industries, NCMX LLC, PHDC2, 2727, Five O 2,
  Saturn Group, JMS Consultants, Pacific Northwest Consulting, etc.) that have no
  verifiable marketing data. Also **Frosted Cannabis** appears to be a *retailer*
  (verify before seeding). Provide the legal entity / UBI or the brand each entity
  trades as, and we'll verify + seed. Full list is in the research doc.
