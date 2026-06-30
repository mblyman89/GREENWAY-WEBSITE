-- =============================================================================
-- Greenway Back Office — Vendor KB Batch 3 (large ~80-name list).
-- Idempotent: upsert on slug. Run AFTER migration 0003 (vendors/brands tables).
-- Companion research/audit: VENDOR_BASELINE_RESEARCH.md → "Batch 3" section.
--
-- Same conventions as the baseline + Batch 2 seeds:
--   * Strict no-guessing — only human-verified facts are written.
--   * provenance + confidence live in `internal_notes`; full audit in the .md.
--   * Rows seeded as status='draft' (employee validates before publishing).
--   * On conflict (slug): update fields but NEVER overwrite `status`.
--   * sort_order continues from Batch 2 (which ended at 24); Batch 3 = 25–45.
--
-- 20 CONFIRMED vendors are seeded below (21 list names, since "NWCS" and
-- "Northwest Cannabis Solutions" are the same entity — seeded once; "WALDEN"
-- and "WALDEN CANNABIS" are also the same entity — seeded once).
--
-- DUPLICATES already in the KB are NOT re-seeded here: FIREBROS (=fire-bros,
-- Batch 2), Klaritie Farms (baseline), Alpha Crux (baseline), Edgemont Group
-- (Batch 2).
--
-- The ~55 UNCONFIRMED / holding-company / consultancy names are NOT seeded — a
-- representative subset is listed as commented-out stubs at the bottom. Do NOT
-- uncomment until the owner supplies the exact legal entity / UBI or the brand
-- the entity trades as. We never invent these fields.
-- =============================================================================

insert into public.vendors
  (display_name, slug, legal_name, mission_statement, about, website, email, phone,
   social_json, internal_notes, status, sort_order)
values
  -- 25. Northwest Cannabis Solutions (NWCS) ----------------------------------
  ('Northwest Cannabis Solutions',
   'northwest-cannabis-solutions',
   null,
   null,
   'Major WA producer/processor operating the Satsop production facility. Maker of multiple lines including Liberty Reach (flower, joints, edibles, vape cartridges, concentrates).',
   null,
   null,
   null,
   '{}'::jsonb,
   'BATCH3. confidence=0.85. sources=Wikipedia (NWCS Satsop facility),destinationhwy420.com (brand). List entries "Northwest Cannabis Solutions" and "NWCS" are the same entity (seeded once).',
   'draft', 25),

  -- 26. Skagit Organics ------------------------------------------------------
  ('Skagit Organics',
   'skagit-organics',
   null,
   null,
   'WA producer/processor in the Skagit Valley, marketed as "Washington''s Best RSO." Products include RSO (Rick Simpson Oil), edibles, and tinctures.',
   'https://www.skagitorganics.net',
   null,
   null,
   '{}'::jsonb,
   'BATCH3. confidence=0.90. sources=skagitorganics.net (official),LinkedIn. "Born and Blazed in the Skagit Valley."',
   'draft', 26),

  -- 27. CannaSol Farms -------------------------------------------------------
  ('CannaSol Farms',
   'cannasol-farms',
   null,
   null,
   'Regenerative / sungrown organic cannabis farm in Riverside, WA (Okanogan County). Sun+Earth certified.',
   'https://www.cannasol.com',
   null,
   null,
   '{}'::jsonb,
   'BATCH3. confidence=0.90. sources=cannasol.com (official),sunandearth.org (certification). Riverside, WA.',
   'draft', 27),

  -- 28. Forbidden Farms ------------------------------------------------------
  ('Forbidden Farms',
   'forbidden-farms',
   null,
   null,
   'WA cannabis producer/processor (self-described "Cannabis Producer/Processor"). Flower and concentrate lines.',
   'https://www.forbidden-farms.com',
   null,
   null,
   '{}'::jsonb,
   'BATCH3. confidence=0.90. sources=forbidden-farms.com (official).',
   'draft', 28),

  -- 29. SKORD (SKoRD) --------------------------------------------------------
  ('SKORD',
   'skord',
   null,
   null,
   'Artisan-quality WA cannabis brand (stylized "SKöRD").',
   'https://iskord.com',
   null,
   null,
   '{}'::jsonb,
   'BATCH3. confidence=0.85. sources=iskord.com (official),Headset brand data. Stylized SKoRD.',
   'draft', 29),

  -- 30. Xtracted Labs --------------------------------------------------------
  ('Xtracted Labs',
   'xtracted-labs',
   null,
   null,
   'WA hash-oil / extraction labs. Maker of the Refine brand of concentrates.',
   'https://x-tracted.com',
   null,
   null,
   '{}'::jsonb,
   'BATCH3. confidence=0.88. sources=x-tracted.com (official),LinkedIn. Brand: Refine.',
   'draft', 30),

  -- 31. Craft Elixirs --------------------------------------------------------
  ('Craft Elixirs',
   'craft-elixirs',
   'Craft Elixirs LLC',
   null,
   'Small-batch cannabis infusions producer/processor. Maker of the Pioneer Squares brand. Founder Jamie Hoffman.',
   'https://www.craftelixirs.com',
   null,
   null,
   '{}'::jsonb,
   'BATCH3. confidence=0.88. sources=craftelixirs.com (official),pioneersquares.com (brand),LinkedIn. Brand: Pioneer Squares.',
   'draft', 31),

  -- 32. Royal Tree Gardens ---------------------------------------------------
  ('Royal Tree Gardens',
   'royal-tree-gardens',
   null,
   null,
   'WA producer/processor. Product lines include the Royal line and Royal Trees.',
   'https://www.royaltreegardens.com',
   null,
   null,
   '{}'::jsonb,
   'BATCH3. confidence=0.88. sources=royaltreegardens.com (official).',
   'draft', 32),

  -- 33. New Leaf Enterprises -------------------------------------------------
  ('New Leaf Enterprises',
   'new-leaf-enterprises',
   'New Leaf Enterprises Inc.',
   null,
   'Seattle, WA producer/processor (part of the New Leaf Ventures group).',
   null,
   null,
   null,
   '{}'::jsonb,
   'BATCH3. confidence=0.80. sources=LinkedIn (New Leaf Enterprises Inc.),Yahoo Finance (New Leaf Ventures). Seattle, WA.',
   'draft', 33),

  -- 34. Tumbleweed Farm ------------------------------------------------------
  ('Tumbleweed Farm',
   'tumbleweed-farm',
   'Tumbleweed Farm LLC',
   null,
   'WA cannabis farm (producer).',
   'http://www.gotumbleweed.com',
   null,
   null,
   '{}'::jsonb,
   'BATCH3. confidence=0.85. sources=gotumbleweed.com (official),L&I (state). L&I UBI 603324694.',
   'draft', 34),

  -- 35. Free Rain Farms ------------------------------------------------------
  ('Free Rain Farms',
   'free-rain-farms',
   'Free Rain Farms, Inc.',
   null,
   'WA cannabis producer.',
   null,
   null,
   null,
   '{}'::jsonb,
   'BATCH3. confidence=0.82. sources=L&I (FREE RAIN FARMS INC),LinkedIn. L&I UBI 603360630.',
   'draft', 35),

  -- 36. Blue Roots Cannabis Co. ----------------------------------------------
  ('Blue Roots Cannabis Co.',
   'blue-roots-cannabis',
   null,
   null,
   'WA producer/processor founded by Eben von Ranson. Flower and pre-rolls; recognized in Inlander "Best Of."',
   'https://bluerootscannabis.com',
   null,
   null,
   '{}'::jsonb,
   'BATCH3. confidence=0.88. sources=bluerootscannabis.com (official),Inlander Best Of,carterscannabis.com (profile).',
   'draft', 36),

  -- 37. Spark Industries -----------------------------------------------------
  ('Spark Industries',
   'spark-industries',
   'Spark Industries, LLC',
   null,
   'WA craft cannabis extraction company (Mount Vernon area).',
   'https://www.sparkindustrieswa.com',
   null,
   null,
   '{}'::jsonb,
   'BATCH3. confidence=0.85. sources=sparkindustrieswa.com (official),LinkedIn.',
   'draft', 37),

  -- 38. Legacy Organics ------------------------------------------------------
  ('Legacy Organics',
   'legacy-organics',
   'Legacy Organics, LLC',
   null,
   'WA producer/processor based in Kennewick, WA.',
   null,
   null,
   null,
   '{}'::jsonb,
   'BATCH3. confidence=0.78. sources=LinkedIn (Josiah Glesener, Legacy Organics LLC),Alignable,Tri-Cities Area Journal of Business (marijuana license listing). Kennewick, WA.',
   'draft', 38),

  -- 39. Mama J's -------------------------------------------------------------
  ('Mama J''s',
   'mama-js',
   null,
   null,
   'WA cannabis brand ("Grown with Love, Smoked with Purpose"), associated with Whidbey Island Cannabis Co.',
   null,
   null,
   null,
   '{}'::jsonb,
   'BATCH3. confidence=0.80. sources=whidbeyislandcannabisco.com,Kush21,Commencement Bay Cannabis (WA dispensary menus). Related to Whidbey Island Cannabis Co.',
   'draft', 39),

  -- 40. Two Heads Co. --------------------------------------------------------
  ('Two Heads Co.',
   'two-heads-co',
   null,
   null,
   'WA premium cannabis concentrate producer. Signed an exclusive distribution agreement with Evergreen Herbal to expand its concentrate sales.',
   null,
   null,
   null,
   '{}'::jsonb,
   'BATCH3. confidence=0.82. sources=PRWeb (Evergreen Herbal x Two Heads Co. agreement),Cannabis Business Times.',
   'draft', 40),

  -- 41. My Weed Bunny --------------------------------------------------------
  ('My Weed Bunny',
   'my-weed-bunny',
   null,
   null,
   'Woman-owned WA cannabis brand (flower).',
   null,
   null,
   null,
   '{}'::jsonb,
   'BATCH3. confidence=0.75. sources=Falcanna (woman-owned WA brands list),White Rabbit Cannabis (WA dispensary menu).',
   'draft', 41),

  -- 42. Walden (Walden Cannabis) ---------------------------------------------
  ('Walden Cannabis',
   'walden-cannabis',
   null,
   null,
   'Sustainability-focused WA cannabis company; also operates Walden Genetics (a seed line). Concentrates and flower.',
   'https://waldencannabis.com',
   null,
   null,
   '{}'::jsonb,
   'BATCH3. confidence=0.88. sources=waldencannabis.com (official),LinkedIn. List entries "WALDEN CANNABIS" and "WALDEN" are the same entity (seeded once). Sub-line: Walden Genetics.',
   'draft', 42),

  -- 43. 1937 Farms -----------------------------------------------------------
  ('1937 Farms',
   '1937-farms',
   null,
   null,
   'Family-run craft cannabis grown in Washington State.',
   'https://www.1937farms.com',
   null,
   null,
   '{}'::jsonb,
   'BATCH3. confidence=0.85. sources=1937farms.com (official),Have A Heart profile. Also 1937cannabis.com.',
   'draft', 43),

  -- 44. Top Shelf ------------------------------------------------------------
  ('Top Shelf',
   'top-shelf-cannabis',
   null,
   null,
   'WA cannabis brand (Top Shelf Cannabis).',
   null,
   null,
   null,
   '{}'::jsonb,
   'BATCH3. confidence=0.72. sources=Weedmaps (Top Shelf Cannabis WA brand page). Brand presence confirmed; licensee entity not pinned. Generic name — owner to confirm exact licensee/UBI if needed.',
   'draft', 44)

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
-- DUPLICATES — already in the KB, intentionally NOT re-seeded here:
--   FIREBROS        -> fire-bros        (Batch 2)
--   Klaritie Farms  -> klaritie-farms   (baseline)
--   Alpha Crux, llc -> alpha-crux       (baseline)
--   EDGEMONT GROUP  -> edgemont-group   (Batch 2)
-- =============================================================================

-- =============================================================================
-- HELD BACK — UNCONFIRMED / holding-company / consultancy / possible-retailer.
-- A representative subset is listed below. Do NOT uncomment until the owner
-- supplies the exact legal entity name / UBI or the brand the entity trades as.
-- We never invent these fields. (Full list is in VENDOR_BASELINE_RESEARCH.md.)
-- =============================================================================

-- Possible RETAILER (verify it is a producer/processor before seeding):
--   Frosted Cannabis — the clean match is "Frosted Cannabis" dispensary, Spokane.

-- Cannabis brands with weak/ambiguous sourcing (need licensee/UBI):
--   Hang Roots, Hometown Herbs, Pastime Brands, Limelight, Coastal Growers,
--   Greenleaf Growers, Hermanos Del Fuego, Grow Bros, Cult Cannabis Co.,
--   Crimsoneye Farms LLC, Bliss Road LLC, Tiger Mountain Cannabis LLC,
--   Olympus Horticulture LLC, Sustainable Organic Solutions, Methow Horticulture,
--   Wild Mint, Hazy Daze, Prismatic, Pinnacle Green, Green Beard & Co,
--   Green Adventures, Green Labs, Alphapheno, Everigreene, Cannaseurs Choice,
--   Prince Farms, Mas Farms, Farmwest 2, South Bay Master Growers, Alki Herbal,
--   Cannabis Northwest C-M Inc., Budz Bud.

-- Holding / consultancy / packaging entities (no marketing data; need brand+UBI):
--   TTL Holdings LLC, RGL Industries, Georgetown Bottling SPC, 2727, NCMX LLC,
--   Pacific Northwest Consulting, Joint Ventures, JMS Consultants, Green Network,
--   Big City Sasquatch LLC, Green Research Network LLC, Saturn Group,
--   EV Enterprises, Sitka Packaging, Kohl Processing Enterprises,
--   Dynamic Processors, PHDC2, Purform Labs Distribution, Nalley Valley Partners
--   LLC, Five O 2, Agro Couture, Cassidy Cannabis LLC, Translucency LLC,
--   Suspended Brands.

-- Example stub format (uncomment + fill once verified):
-- insert into public.vendors (display_name, slug, status, internal_notes)
-- values ('TTL Holdings', 'ttl-holdings', 'draft',
--   'UNCONFIRMED: provide brand traded-as + UBI to match WA records.')
-- on conflict (slug) do nothing;
