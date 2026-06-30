-- =============================================================================
-- Greenway Back Office — Vendor KB Batch 2 (21 producer/processors).
-- Idempotent: upsert on slug. Run AFTER migration 0003 (vendors/brands tables).
-- Companion research/audit: VENDOR_BASELINE_RESEARCH.md → "Batch 2" section.
--
-- Same conventions as vendors_baseline_seed.sql:
--   * Strict no-guessing — only human-verified facts are written.
--   * The vendors table has no sources/confidence columns, so provenance +
--     confidence live in `internal_notes` (staff-only); full audit in the .md.
--   * Rows are seeded as status='draft' so an employee validates before
--     publishing (AI/crawler/seed output is drafts-only).
--   * On conflict (slug) we update fields but NEVER overwrite `status`, so
--     re-running won't un-publish a vendor an employee already reviewed.
--   * sort_order continues from the baseline (which used 1–9); Batch 2 = 10–24.
--
-- 15 CONFIRMED vendors are seeded below. The 6 UNCONFIRMED/LOW vendors
-- (Washington Packaging and Processing, R&B Group, Virtual Services,
-- Alpenglow Extracts, Wamsterdam Farms, Botanical Arts) are intentionally left
-- as commented-out stubs at the bottom. Do NOT uncomment them until the owner
-- supplies the exact legal entity name and/or UBI — we never invent these fields.
-- =============================================================================

insert into public.vendors
  (display_name, slug, legal_name, mission_statement, about, website, email, phone,
   social_json, internal_notes, status, sort_order)
values
  -- B1. Fire Bros. -----------------------------------------------------------
  ('Fire Bros.',
   'fire-bros',
   null,
   null,
   'WA I-502 vertically integrated producer/processor. Cultivation in Arlington, WA, with extraction/processing operations in Seattle. Product lines span flower, vape cartridges, pre-rolls, and concentrates.',
   'https://firebros.com',
   null,
   null,
   '{"instagram":"https://instagram.com/firebros"}'::jsonb,
   'BATCH2. confidence=0.90. sources=firebros.com (official),Instagram @firebros/@firebrosworld (official).',
   'draft', 10),

  -- B3. Canna Pacific --------------------------------------------------------
  ('Canna Pacific',
   'canna-pacific',
   null,
   null,
   'WA I-502 Tier II Producer & Processor; DOH-compliant. Maker of "Trichome Extracts." Based in Tacoma, WA 98409.',
   'https://cannapacific.com',
   null,
   null,
   '{}'::jsonb,
   'BATCH2. confidence=0.88. sources=cannapacific.com (official). Tier II P/P; Tacoma, WA 98409.',
   'draft', 11),

  -- B5. Clarity Farms --------------------------------------------------------
  ('Clarity Farms',
   'clarity-farms',
   'Streamer LLC dba Clarity Farms',
   null,
   'Sungrown / organic-method cannabis cultivation in the Columbia Basin. Holds a registered trademark for the Clarity Farms mark.',
   'https://clarityfarms.net',
   'office@clarityfarms.net',
   null,
   '{}'::jsonb,
   'BATCH2. confidence=0.90. sources=clarityfarms.net (official),USPTO trademark (secondary). Alt email: ashley@clarityfarms.net. Legal entity: Streamer LLC dba Clarity Farms.',
   'draft', 12),

  -- B6. Seattle Bubble Works -------------------------------------------------
  ('Seattle Bubble Works',
   'seattle-bubble-works',
   null,
   null,
   'Solvent-free ice-water / bubble hash maker operating since 2016, based in Seattle, WA. Founder Joby Sewell; head hash maker Justin Boujelle.',
   'https://seattlebubbleworks.com',
   'support@seattlebubbleworks.com',
   '360-829-8929',
   '{"facebook":"https://facebook.com/seattlebubbleworks","instagram":"https://instagram.com/seattlebubbleworks","twitter":"https://twitter.com/SeaBubbleWorks"}'::jsonb,
   'BATCH2. confidence=0.92. sources=seattlebubbleworks.com (official),official social profiles. YouTube channel exists.',
   'draft', 13),

  -- B8. Heavenly Buds --------------------------------------------------------
  ('Heavenly Buds',
   'heavenly-buds',
   null,
   null,
   'WA Tier 2 producer/processor based in Longview, WA (with operations noted in East Bremerton). Pesticide-free indoor soil-grown, hand-trimmed flower. Cited as the first WA producer/processor to pass full medical-grade testing. Strains include Yoda OG and Raspberry Kush. Propagation specialist Mike Fujimoto.',
   'https://heavenlybuds.com',
   null,
   null,
   '{}'::jsonb,
   'BATCH2. confidence=0.88. sources=heavenlybuds.com (official). Tier 2 P/P; Longview, WA.',
   'draft', 14),

  -- B10. Ceres (Ceres Garden) ------------------------------------------------
  ('Ceres Garden',
   'ceres-garden',
   'Whidbey Island Cannabis Co.',
   null,
   'Producer/processor brand "Ceres Garden" by Whidbey Island Cannabis Co., located at 1860 Scott Road, Freeland, WA 98249. Products include topicals, tinctures, and edibles (e.g., Dragon Balm).',
   null,
   'whidbeyislandcannabisco@gmail.com',
   '(360) 321-6151',
   '{}'::jsonb,
   'BATCH2. confidence=0.85. sources=Whidbey Island Cannabis Co. (official),brand listings (secondary). Owner-provided list named this vendor "Ceres"; verified entity is Ceres Garden by Whidbey Island Cannabis Co.',
   'draft', 15),

  -- B11. Avitas --------------------------------------------------------------
  ('Avitas',
   'avitas',
   null,
   null,
   'Cannabis producer/processor — "Blazing Trails since 2014." Owned by Holistic Industries. Products include Ultra, Live Resin, and pre-rolls.',
   'https://avitasgrown.com',
   null,
   '1-833-888-1191',
   '{"instagram":"https://instagram.com/avitas_co"}'::jsonb,
   'BATCH2. confidence=0.90. sources=avitasgrown.com (official),Holistic Industries (corporate). Alt IG: @avitaspnw.',
   'draft', 16),

  -- B13. Sky High Gardens LLC ------------------------------------------------
  ('Sky High Gardens',
   'sky-high-gardens',
   'Sky High Gardens LLC',
   null,
   'Producer/processor based in Seattle, WA. CEO Phil Seda. Strains include 12th Man Haze, Glassworks OG, and Blue Dream.',
   'https://skyhighgardens.net',
   null,
   null,
   '{"instagram":"https://instagram.com/skyhighgardensseattle","facebook":"https://facebook.com/SkyHighGardens"}'::jsonb,
   'BATCH2. confidence=0.88. sources=skyhighgardens.net (official),L&I (state). L&I UBI 603358819.',
   'draft', 17),

  -- B14. Mfused --------------------------------------------------------------
  ('Mfused',
   'mfused',
   null,
   null,
   'Vape and concentrates producer (products include Super Fog). Reported ~$100M scale with multi-state presence, including Arizona via Flow Distribution.',
   'https://mfused.com',
   null,
   null,
   '{}'::jsonb,
   'BATCH2. confidence=0.88. sources=mfused.com (official),trade press (secondary).',
   'draft', 18),

  -- B15. Seattle's Private Reserve -------------------------------------------
  ('Seattle''s Private Reserve',
   'seattles-private-reserve',
   null,
   null,
   'Small-batch, cold-cured, hand-trimmed craft cannabis. Evergreen Cup winner.',
   'https://seattlesprivatereserve.com',
   null,
   null,
   '{}'::jsonb,
   'BATCH2. confidence=0.85. sources=seattlesprivatereserve.com (official).',
   'draft', 19),

  -- B16. Quality Green Trees (operates Freddy's Fuego) -----------------------
  ('Quality Green Trees',
   'quality-green-trees',
   null,
   null,
   'WA LCB licensee entity that operates the Freddy''s Fuego brand. Products: flower, pre-rolls, concentrates, and vapes. Owner Tim Haggerty. Brand menu hosted at cultiveramarket.com/bm/market/quality-green-trees/menu.',
   'https://freddysfuego.com',
   null,
   null,
   '{"instagram":"https://instagram.com/freddysfuego"}'::jsonb,
   'BATCH2. confidence=0.88. sources=freddysfuego.com (official brand),Cultivera menu link (licensee confirmation: cultiveramarket.com/bm/market/quality-green-trees/menu). Alt IG: @ffpiratelife. Brand=Freddy''s Fuego.',
   'draft', 20),

  -- B17. Cultivar Farms LLC --------------------------------------------------
  ('Cultivar Farms',
   'cultivar-farms',
   'Cultivar Farms LLC',
   null,
   'Seattle producer/processor. Packaging/processing associated with Brett Pursley. No consumer-facing website found; verified via state/traceability records.',
   null,
   null,
   null,
   '{}'::jsonb,
   'BATCH2. confidence=0.80. sources=topshelfdata.com (LCB traceability),L&I (state). L&I UBI 603348577. Seattle, WA.',
   'draft', 21),

  -- B18. Edgemont Group LLC --------------------------------------------------
  ('Edgemont Group',
   'edgemont-group',
   'Edgemont Group LLC',
   null,
   'WA producer/processor with multiple locations in East Wenatchee, WA (3540 Doneen Rainey Rd; 349 Urban Industrial Way; 730 Urban Industrial Way).',
   null,
   null,
   '707-672-5928',
   '{}'::jsonb,
   'BATCH2. confidence=0.85. sources=cached WA LCB renewal data (directly confirmed),L&I. UBI base 603313835. East Wenatchee, WA.',
   'draft', 22),

  -- B19. Fireline Cannabis ---------------------------------------------------
  ('Fireline Cannabis',
   'fireline-cannabis',
   null,
   null,
   'WA I-502 production company; flower line includes White Fire OG. Arlington-area, WA. No clean consumer-facing website found; the production-company fact is confirmed via brand listings/traceability.',
   null,
   null,
   null,
   '{}'::jsonb,
   'BATCH2. confidence=0.80. sources=brand listings/traceability (secondary). MEDIUM-strength CONFIRMED on the production-company fact.',
   'draft', 23),

  -- B21. Botanica Seattle ----------------------------------------------------
  ('Botanica Seattle',
   'botanica-seattle',
   'Botanical Investment Group, Inc.',
   null,
   'WA cannabis manufacturer founded 2014 (legal entity Botanical Investment Group, Inc.). CEO/founder Chris Abbott; President Tim Elliott. Makes Mr. Moxey''s (cited as the #1 cannabis-infused mint nationally, 40M+ sold) and Journeyman (drinks/gummies). Raised a $9M Series B in 2023.',
   'https://mrmoxeys.com',
   null,
   null,
   '{}'::jsonb,
   'BATCH2. confidence=0.92. sources=mrmoxeys.com,lifeisajourneyman.com (official brands),trade press (Series B, secondary). Brands: Mr. Moxey''s, Journeyman. Legal entity: Botanical Investment Group, Inc.',
   'draft', 24)

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
-- HELD BACK — UNCONFIRMED / LOW. Do NOT uncomment until the owner supplies the
-- exact legal entity name and/or UBI. We never invent these fields.
-- =============================================================================

-- B2. Washington Packaging and Processing — UNCONFIRMED (generic name; no source).
-- insert into public.vendors (display_name, slug, status, internal_notes)
-- values ('Washington Packaging and Processing', 'washington-packaging-and-processing', 'draft',
--   'UNCONFIRMED: provide exact legal entity name / UBI to match WA records.')
-- on conflict (slug) do nothing;

-- B4. R&B Group — UNCONFIRMED (no official site / no licensee profile).
-- insert into public.vendors (display_name, slug, status, internal_notes)
-- values ('R&B Group', 'r-and-b-group', 'draft',
--   'UNCONFIRMED: provide exact legal entity name / UBI to match WA records.')
-- on conflict (slug) do nothing;

-- B7. Virtual Services — UNCONFIRMED (generic name; no cannabis source).
-- insert into public.vendors (display_name, slug, status, internal_notes)
-- values ('Virtual Services', 'virtual-services', 'draft',
--   'UNCONFIRMED: provide exact legal entity name / UBI to match WA records.')
-- on conflict (slug) do nothing;

-- B9. Alpenglow Extracts — LOW / ambiguous. A Spokane Valley concentrates brand is
--   cited by a single dispensary blog, but no clean official source. Must NOT be
--   conflated with the California brand "Alpenglow Farms 707" (alpenglowfarms707.com).
-- insert into public.vendors (display_name, slug, status, internal_notes)
-- values ('Alpenglow Extracts', 'alpenglow-extracts', 'draft',
--   'LOW: confirm WA entity / UBI. Do NOT conflate with CA Alpenglow Farms 707.')
-- on conflict (slug) do nothing;

-- B12. Wamsterdam Farms — UNCONFIRMED (no official site / no licensee profile).
-- insert into public.vendors (display_name, slug, status, internal_notes)
-- values ('Wamsterdam Farms', 'wamsterdam-farms', 'draft',
--   'UNCONFIRMED: provide exact legal entity name / UBI to match WA records.')
-- on conflict (slug) do nothing;

-- B20. Botanical Arts — UNCONFIRMED (generic name; no source).
-- insert into public.vendors (display_name, slug, status, internal_notes)
-- values ('Botanical Arts', 'botanical-arts', 'draft',
--   'UNCONFIRMED: provide exact legal entity name / UBI to match WA records.')
-- on conflict (slug) do nothing;
