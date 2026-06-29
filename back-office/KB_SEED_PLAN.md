# Knowledge Base — Large-Scale Strain Seed Plan

## Goal
Seed `kb_strains` with a large, **accurate, no-guessing** set of cannabis strains
so the AI knows the strain universe before it ever sees your inventory. Strains
are a finite, well-documented domain (lineage, type, terpenes, aroma/flavor are
widely and consistently published), so this is the easy, high-leverage win.

Defer (hard, needs crawling later): vendor/brand data, product images, and
mixed-cannabinoid edibles/drinks (CBD/CBG/CBN/CBC products).

## The "no guessing" rule
A strain row is included ONLY when its core facts are corroborated by reputable,
consistent sources. If lineage or type is disputed/unknown across sources, we
either (a) omit the disputed field (leave null) but keep the verified ones, or
(b) skip the strain entirely. We never invent lineage, terpenes, or origin.

## Sources (reputable, widely cross-referenced)
- **Leafly** strain database — type, lineage, terpene, flavor/aroma descriptors.
- **Wikileaf**, **AllBud**, **Seedfinder** (lineage/genealogy), **Cannabis
  breeders' own descriptions** for flagship strains.
- Cross-reference: a fact is "verified" when ≥2 reputable sources agree (or it's
  a breeder-stated cross). Aroma/flavor terms normalized to our controlled vocab.

## Data shape (matches kb_strains; a few new optional columns proposed)
Existing columns: slug, name, aliases[], strain_type, lineage, aroma_notes[],
flavor_notes[], terpenes[], summary.

Proposed NEW optional columns (migration 0020) for the richer dimensions you
asked for — all nullable, all sensory/botanical/factual (never medical):
- `dominant_cannabinoid` text  — 'thc' | 'cbd' | 'balanced' | 'cbg' | … (only
  when a strain is notably high-CBD/CBG, e.g. ACDC, Charlotte's Web, Harlequin).
- `potency_note` text          — factual potency descriptor ('typically high THC')
  WITHOUT effect claims. Sensory/market-fact only.
- `bud_structure` text         — 'dense', 'fluffy', 'spear-shaped', 'frosty' …
- `origin` text                — only when well-documented ('Afghani landrace',
  'Northern California'). Null when unknown.

## Controlled vocabularies (so the AI gets clean, consistent words)
- aroma/flavor: citrus, lemon, orange, lime, grapefruit, berry, blueberry, grape,
  tropical, pineapple, mango, pine, earthy, woody, floral, lavender, diesel/fuel,
  skunky, pungent, sweet, vanilla, cream, chocolate, coffee, mint, herbal, spicy,
  pepper, cheese, nutty, sour, tropical, melon, cherry, apple, honey.
- terpenes: myrcene, limonene, caryophyllene, pinene, linalool, terpinolene,
  humulene, ocimene, bisabolol, valencene, nerolidol, geraniol, fenchol.

## Deliverables
1. A large CSV (`back-office/kb_seed/strains_seed.csv`) — human-reviewable,
   one row per strain, with a `source_confidence` and `sources` column so you
   can audit every row.
2. A generated TypeScript seed (`src/lib/ai/kb/strains-data.ts`) the app uses.
3. Migration `0020` adding the optional richer columns + a SQL seed file you can
   paste into Supabase (`back-office/kb_seed/strains_seed.sql`).
4. The admin "Seed expert starter set" upserts the full set (idempotent).

## Scale
Target ~250–400 well-verified strains in this pass (the strains that actually
appear on WA shelves + the classic genetics everything else descends from).
That covers the overwhelming majority of real inventory by name match.
