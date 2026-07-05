# KB Product Formats — Seed Sources & Research (Slice 2)

> **KB Hardening v2 — Slice 2: Consumption methods / product formats.**
> Purpose: give the AI a single authoritative record for *the physical form a
> product takes* (loose flower, pre-roll, vape cartridge, shatter/wax, gummies,
> tincture, topical, etc.) — what it is, how it's used, its typical WA-market
> potency range, and a house-voiced budtender note. This complements the
> effects vocabulary (Slice 1): effects = *how it feels*, formats = *what it is
> and how you use it*.

This slice is grounded in **Washington State–specific** authoritative sources
(WSLCB + a public-health-law fact sheet citing WAC). Every potency range, THC
cap, and consumption fact below was verified by scraping the primary source.
**Never guessed.**

---

## Why a `kb_product_formats` table (and not just kb_category_terms)?

The repo already has two adjacent tables:

- **`kb_category_terms`** (seed `SEED_CATEGORIES`) — broad *category* vocabulary
  (flower/vape/edible/…): legal descriptor words + sensory words for copy. It
  answers *"what words may I use for this category?"*
- **`kb_product_categories`** (deep taxonomy) — hierarchical product-type tree.

Neither carries the **verified WA-market facts** a budtender-grade brain needs:
*how a product is consumed, its typical potency band, onset behavior, and a
house note in our voice.* `kb_product_formats` is that missing layer — a
controlled vocabulary of concrete product *forms*, mirroring the `kb_effects`
(0086) drafts/provenance pattern exactly. It keys off a product's category so
the retrieval brain can surface accurate form + consumption facts alongside the
existing category vocab.

**Compliance guardrails (WA I-502):** every record is *factual and descriptive*
— what the form is, how it is used, and its measured potency band. It carries
**no** medical/therapeutic claim and **no** dosing instruction ("take X"). The
`house_note` is fun-but-professional and non-medical. All prose is routed
through the existing `checkCompliance` gate before it can surface in retrieval.

---

## VERIFIED: WA product taxonomy & typical potency

**Source — WSLCB "Types of Products":** https://lcb.wa.gov/education/types_of_products
(Washington State Liquor and Cannabis Board, scraped this session.)

### Inhaled
- **Loose flower** — dried, cured cannabis buds. Consumed by smoking (joint,
  blunt, bowl/pipe, bong/water pipe) or by dry-flower vaporizer. THC content
  varies widely by cultivar; commonly ~**15–25%+ THC** on the WA shelf.
- **Pre-roll** — flower already ground and rolled into a joint (sometimes a
  blunt). Ready to smoke. **Infused** pre-rolls add concentrate/kief and run
  **higher THC** than the flower alone.
- **Concentrates** — the potent, extracted class:
  - **Vape cartridges** (distillate / live-resin / full-spectrum oil) — heated
    by a battery/pen; inhaled as vapor. Typically **high THC**.
  - **Kief / hash** — sifted or pressed trichomes; **~30–60% THC** (WSLCB).
  - **Shatter / wax / budder / dabs (BHO-style)** — solvent- or heat-extracted
    concentrates, vaporized/"dabbed"; **~60–90% THC** (WSLCB) — the most potent
    everyday form on the shelf.

### Consumable / ingestible
- **Edibles** — cannabis-infused food (gummies, chocolate, hard candy, mints)
  **and** infused beverages. Eaten/drunk; effects come on **more slowly** than
  inhalation and can last longer (a *factual onset* statement, not a medical
  claim).
- **Capsules / tablets** — swallowed like a supplement pill.
- **Tinctures** — liquid extract taken with a **sublingual dropper** (held under
  the tongue) or added to food/drink.

### Topicals
- **Lotions / ointments / balms / salves** — applied to the skin.
- **Transdermal patches** — adhesive patches worn on the skin.
- **Suppositories.**
- *(Non-THC CHABA topicals are governed separately.)*

---

## VERIFIED: WA edible THC cap (safety fact, feeds Slice 3)

**Source — Network for Public Health Law, "State Regulation of Edible Cannabis
Products" fact sheet**, citing **WAC 314-55-095** (scraped this session):

- **Washington limit: 10 mg active THC (delta-9) per serving, 100 mg per
  package.**

This is a hard state cap and a **safety fact**, not dosing advice. It is
recorded here for Slice 2 context; the customer-facing safety surfacing lives
in **Slice 3 (compliance rules in the KB)**.

---

## VERIFIED: WA purchase / possession limits & use rules (context for Slice 3)

**Sources — WSLCB "Using and Having Cannabis"**
(https://lcb.wa.gov/education/using_and_having_cannabis), **RCW 69.50.360** &
**RCW 69.50.4013** (scraped this session):

- **21+ only.** Adults 21 and over.
- **Possession limits:** 1 oz usable cannabis (flower); 16 oz cannabis-infused
  solid edibles; 72 oz cannabis-infused liquids; 7 g concentrate.
- **No public consumption** — using cannabis in public view is prohibited.
- **Vehicle transport** — keep in the original sealed container / trunk; open
  container while driving is prohibited.

(These belong to Slice 3; captured here so the two slices stay consistent.)

---

## The curated format set (Slice 2)

Categories used for UI grouping ONLY (not medical): `inhaled` | `ingested` |
`topical`. Each format record: `slug`, `name`, `category`, `consumption`
(factual how-it's-used), `potency_note` (WA-verified range), `definition`,
`house_note` (fun-but-professional, non-medical), `aliases[]`, `sources[]`,
`confidence`.

1. **flower** (inhaled) — dried buds; smoked or dry-vaped; ~15–25%+ THC.
2. **preroll** (inhaled) — pre-rolled joint/blunt, ready to smoke.
3. **infused-preroll** (inhaled) — pre-roll boosted with concentrate/kief;
   higher THC than flower alone.
4. **vape-cartridge** (inhaled) — oil cart heated by a battery; high THC.
5. **disposable-vape** (inhaled) — all-in-one pen; nothing to assemble.
6. **kief-hash** (inhaled) — sifted/pressed trichomes; ~30–60% THC.
7. **concentrate** (inhaled) — shatter/wax/budder/dabs; ~60–90% THC.
8. **live-resin-rosin** (inhaled) — terpene-forward fresh-frozen extract
   (solvent = resin, solventless = rosin).
9. **edible** (ingested) — infused food/candy; WA cap 10 mg/serving,
   100 mg/pack; slower onset than inhalation.
10. **beverage** (ingested) — infused drink; same edible cap; slower onset.
11. **capsule** (ingested) — swallowed pill/softgel; slower onset.
12. **tincture** (ingested) — liquid extract via sublingual dropper.
13. **topical** (topical) — lotion/balm/salve applied to skin.
14. **transdermal-patch** (topical) — adhesive skin patch.

All 14 describe **form + use + measured potency band** only — no medical claim,
no "take this much" dosing directive. Onset statements ("comes on more slowly")
are factual descriptions of how ingestion differs from inhalation, not a health
benefit claim.

---

## Sources (canonical)

- WSLCB — Types of Products: https://lcb.wa.gov/education/types_of_products
- WSLCB — Using and Having Cannabis: https://lcb.wa.gov/education/using_and_having_cannabis
- Network for Public Health Law — State Regulation of Edible Cannabis Products
  (citing WAC 314-55-095, 10 mg/serving · 100 mg/package WA cap).
- RCW 69.50.360, RCW 69.50.4013 (possession limits / lawful use).
