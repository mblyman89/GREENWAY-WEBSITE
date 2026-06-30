-- =============================================================================
-- Greenway Back Office — Vendor KB Baseline (Golden Set), 12 top vendors.
-- Idempotent: upsert on slug. Run AFTER migration 0003 (vendors/brands tables).
--
-- This is the HUMAN-VERIFIED baseline used to score the web crawler's accuracy.
-- Facts come from VENDOR_BASELINE_RESEARCH.md (this folder) — strict no-guessing.
-- The vendors table has no sources/confidence columns, so provenance + confidence
-- are stored in `internal_notes` (staff-only) and the full audit is in the .md.
--
-- Rows are seeded as status='draft' so an employee validates before publishing —
-- consistent with the standing rule that AI/crawler/seed output is drafts-only.
--
-- Vendors #10 (Mountain Hi), #11 (Evergreen Hydro Farms), #12 (Canna Processing)
-- are UNCONFIRMED and intentionally left as commented-out stubs below. Do NOT
-- uncomment them until the owner supplies the exact legal entity / UBI.
-- =============================================================================

insert into public.vendors
  (display_name, slug, legal_name, mission_statement, about, website, email, phone,
   social_json, internal_notes, status, sort_order)
values
  -- 1. Grow Op Farms ---------------------------------------------------------
  ('Grow Op Farms',
   'grow-op-farms',
   'Grow Op Farms, LLC',
   null,
   'WA I-502 Tier 3 producer/processor in Spokane Valley, founded 2014 by Robert & Katrina McKinley. Widely cited as the #1 cannabis producer in Washington (2019–2025). Flagship brand Phat Panda; parent of 12+ brands including Dabstract, Hot Sugar, Snickle Fritz, Panda Pen, Bangers, Juice Box, Cake House, Kandy Shoppe, Firecracker, Hot Shotz, Eluzion, Sticky Frog, Six Fifths, Flav. 850+ team members.',
   'https://growopfarms.com',
   'generalinfo@growopfarms.com',
   '(509) 720-8821',
   '{"instagram":"https://instagram.com/phatpanda"}'::jsonb,
   'BASELINE golden-set. confidence=0.95. sources=growopfarms.com,phatpanda.com (official). Address: 2611 N Woodruff Rd, Spokane Valley, WA 99206.',
   'draft', 1),

  -- 2. Lifted Cannabis -------------------------------------------------------
  ('Lifted Cannabis',
   'lifted-cannabis',
   null,
   null,
   'Indoor Tier 3 producer/processor in Tacoma, WA (operating in the former Nalley Fine Foods pickle factory). Flower and concentrates distributed to 200+ WA retailers. President/Owner Tony Ferro. Products include Slush, Diamonds n'' Sauce, all-in-one vapes, cartridges, live resin, and badder.',
   'https://liftedcannabisco.com',
   null,
   null,
   '{}'::jsonb,
   'BASELINE golden-set. confidence=0.90. sources=liftedcannabisco.com (official),LinkedIn.',
   'draft', 2),

  -- 3. Canna Organix ---------------------------------------------------------
  ('Canna Organix',
   'canna-organix',
   null,
   null,
   'WA-licensed cannabis manufacturer/distributor in Sequim, WA. Official site is sparse; contact and UBI corroborated by state records.',
   'https://cannaorganix.com',
   null,
   '(360) 542-7000',
   '{"instagram":"https://instagram.com/cannaorganix","twitter":"https://twitter.com/cannaorganix","facebook":"https://facebook.com/CannaOrganixWA"}'::jsonb,
   'BASELINE golden-set. confidence=0.88. sources=cannaorganix.com (official),WA state records. UBI 603354913. Address: 374 Business Park Loop, Sequim, WA 98382.',
   'draft', 3),

  -- 4. Evergreen Herbal ------------------------------------------------------
  ('Evergreen Herbal',
   'evergreen-herbal',
   null,
   null,
   'Seattle SODO producer/processor of cannabis edibles and beverages. Established 2013 in the medical market (4.20 Bar, Cannabis Quencher) and entered recreational in 2014. Blaze American Cola won Best Beverage at the 2014 Dope Cup. Brands include 4.20 Bar, Blaze Sodas, Happy Apple, Major, Sinners & Saints, Velvet Swing, Vertus Cannapagne, and ReImagine Wellness. NCIA member.',
   'https://forevergreenherbal.com',
   null,
   '206-596-8600',
   '{}'::jsonb,
   'BASELINE golden-set. confidence=0.92. sources=forevergreenherbal.com (official),greensiderec.com (secondary). Store: buy.forevergreenherbal.com.',
   'draft', 4),

  -- 5. Green Revolution ------------------------------------------------------
  ('Green Revolution',
   'green-revolution',
   'Green Revolution One LED LLC',
   null,
   'Producer/processor of fast-acting THC edibles, beverages, and tinctures using UNET nanotechnology. WA operations in Kitsap County, with multi-state presence (CA, MA, NY, WA). Products include Doozies, WildSide, and sublingual tinctures.',
   'https://greenrevolution.com',
   'support@greenrevolution.com',
   null,
   '{}'::jsonb,
   'BASELINE golden-set. confidence=0.90. sources=greenrevolution.com (official). CBD line: greenrevolutioncbd.com.',
   'draft', 5),

  -- 6. Klaritie Farms Inc ----------------------------------------------------
  ('Klaritie Farms',
   'klaritie-farms',
   'Klaritie Farms Inc',
   null,
   'WA producer/processor founded 2014 by Marty White (CEO; COO Kathleen Nash). Maker of Honu edibles since 2018. Brands include Honu, Kares, BOB''s, Herbal Warrior, and Skuared. First-place finishes at the Dope Cup, Light Up Cup, and NW Cannabis Cup.',
   'https://klaritiefarms.com',
   null,
   null,
   '{}'::jsonb,
   'BASELINE golden-set. confidence=0.90. sources=klaritiefarms.com (official),Leafly (secondary).',
   'draft', 6),

  -- 7. Alpha Crux LLC --------------------------------------------------------
  ('Alpha Crux',
   'alpha-crux',
   'Alpha Crux LLC',
   null,
   'WA producer & processor in Ellensburg (Kittitas County), operating two licensed Ellensburg locations. Operating since July 2022. A major vendor by volume — ranked roughly 15 of 538 WA producer/processors with ~$790k pre-tax sales (Apr 2026) and no reported violations.',
   null,
   null,
   null,
   '{}'::jsonb,
   'BASELINE golden-set. confidence=0.90. sources=topshelfdata.com (LCB traceability),yourweeddata.com,L&I. License 427037, UBI 604213965. DISCREPANCY: yourweeddata says Arlington; Top Shelf Data (live LCB) says Ellensburg — Ellensburg recorded as primary.',
   'draft', 7),

  -- 8. Northwest Harvesting Co -----------------------------------------------
  ('Northwest Harvesting Co',
   'northwest-harvesting-co',
   'Northwest Harvesting Co. LLC',
   null,
   'WA Tier 2 producer & processor in Elma (Grays Harbor County), operating since November 2015. ~$106k pre-tax sales (Apr 2026), ranked roughly 164 of 538 WA producer/processors, with no reported violations. No consumer-facing website found; verified via state/traceability records.',
   null,
   null,
   null,
   '{}'::jsonb,
   'BASELINE golden-set. confidence=0.88. sources=topshelfdata.com (LCB traceability),L&I. License 412435, UBI 603343419. Elma, WA 98541.',
   'draft', 8),

  -- 9. Dogtown Pioneers (MEDIUM confidence — clearly flagged) -----------------
  ('Dogtown Pioneers',
   'dogtown-pioneers',
   null,
   null,
   'Reported as a Tier 3 producer/processor in Clayton, WA, growing sun-grown cannabis across nine climate-controlled greenhouses and using alcohol extraction. Associated product "Rays Infused Lemonade"; cited use of Mr. Nice and DJ Short genetics. NOTE: a single secondary source (AskGrowers) listed a "Founded 2026" date that is clearly a data error and is NOT treated as fact.',
   null,
   null,
   null,
   '{}'::jsonb,
   'BASELINE golden-set. confidence=0.60 (single secondary source: AskGrowers). No official website found. "Founded 2026" flagged as source data error — not used.',
   'draft', 9)

on conflict (slug) do update set
  display_name      = excluded.display_name,
  legal_name        = excluded.legal_name,
  mission_statement = excluded.mission_statement,
  about             = excluded.about,
  website           = excluded.website,
  email             = excluded.email,
  phone             = excluded.phone,
  social_json       = excluded.social_json,
  internal_notes    = excluded.internal_notes,
  sort_order        = excluded.sort_order,
  updated_at        = now();
-- NOTE: `status` is intentionally NOT overwritten on conflict, so re-running this
-- seed will not un-publish a vendor an employee has already reviewed & published.

-- =============================================================================
-- HELD BACK — UNCONFIRMED / UNRESOLVED. Do NOT uncomment until the owner supplies
-- the exact legal entity name and/or UBI. We never invent these fields.
-- =============================================================================

-- 10. Mountain Hi — UNRESOLVED (retailer vs producer ambiguity).
--   mhccanna.com = "Mountain High Cannabis", a RETAILER in Republic, WA (not a P/P).
--   Leafly "Mountain High Garden" producer page is empty and shows Boardman, OR.
--   Owner must confirm which exact entity Greenway buys from before seeding.
-- insert into public.vendors (display_name, slug, status, internal_notes)
-- values ('Mountain Hi', 'mountain-hi', 'draft',
--   'UNRESOLVED: confirm legal entity + WA P/P license before filling.')
-- on conflict (slug) do nothing;

-- 11. Evergreen Hydro Farms — UNCONFIRMED (no official site / no licensee profile).
-- insert into public.vendors (display_name, slug, status, internal_notes)
-- values ('Evergreen Hydro Farms', 'evergreen-hydro-farms', 'draft',
--   'UNCONFIRMED: provide exact legal entity name / UBI to match WA records.')
-- on conflict (slug) do nothing;

-- 12. Canna Processing — UNCONFIRMED (no official site / generic name).
-- insert into public.vendors (display_name, slug, status, internal_notes)
-- values ('Canna Processing', 'canna-processing', 'draft',
--   'UNCONFIRMED: provide exact legal entity name / UBI to match WA records.')
-- on conflict (slug) do nothing;
