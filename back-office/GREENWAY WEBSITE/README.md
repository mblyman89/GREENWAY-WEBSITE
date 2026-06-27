# GREENWAY WEBSITE — Master Operating Folder

This is the **single source of truth folder** for the Greenway Marijuana website and its back office. Everything the site needs to function — content, media, the vendor/brand/product database, the strain reference, the POS transformer pipeline, and exports — lives here in one organized, professional structure.

It is designed so that a non-technical employee can find anything, and so the website + back office software can read/write predictable paths.

---

## Top-level map

```
GREENWAY WEBSITE/
├── README.md                      ← you are here
├── database/                      ← the structured "source of truth" data
│   ├── vendors/                   ← every vendor → brands → products (with profiles + images folders)
│   │   ├── _index.json            ← master list of all vendors (slug, name, counts)
│   │   └── <vendor-slug>/
│   │       ├── vendor.json         ← editable vendor profile (logo, mission, about, contact)
│   │       ├── brands-index.json
│   │       ├── logo/               ← drop the vendor logo here
│   │       └── brands/
│   │           └── <brand-slug>/
│   │               ├── brand.json          ← editable brand profile
│   │               ├── products-index.json
│   │               ├── logo/               ← drop the brand logo here
│   │               └── products/
│   │                   └── <product-slug>/
│   │                       ├── product.json   ← POS metadata + enrichment fields
│   │                       └── images/        ← drop product photos here
│   ├── strains/                   ← STRAINS_MASTER.xlsx + .csv (type + descriptions to fill gaps)
│   ├── categories/                ← website categories + POS category usage mapping
│   └── promotions/                ← saved promotion definitions (daily deals, Thursday brands, clearance)
│
├── intake/                        ← where fresh files are dropped before processing
│   ├── pos-uploads/
│   │   ├── incoming/              ← drop new PRODUCTS.xlsx + INVENTORIES.xlsx here
│   │   ├── processed/             ← transformer moves files here after a successful run
│   │   └── archive/               ← timestamped history of every POS export ever uploaded
│   └── media-uploads/incoming/    ← drop loose images here before sorting into the media library
│
├── transformer/                  ← the POS → menu pipeline workspace
│   ├── inputs/                   ← the working PRODUCTS.xlsx + INVENTORIES.xlsx the transformer reads
│   ├── outputs/
│   │   ├── menu/                 ← generated menu JSON (pos-menu-preview.json etc.)
│   │   ├── diagnostics/          ← transform-summary.json, anomaly-report.json
│   │   └── reports/             ← human-readable import reports (xlsx/csv)
│   └── config/                  ← category mapping + transformer settings
│
├── media-library/               ← the curated, tagged asset library (the website's images)
│   ├── brand/                   ← Greenway logos, wordmarks, storefront
│   ├── home-banners/            ← hero + promo banners
│   ├── category-banners/
│   ├── vendor-logos/
│   ├── brand-logos/
│   ├── product-images/
│   ├── blog/
│   ├── newsletters/             ← newsletter PDFs + page images
│   ├── merch/
│   ├── social-glyphs/
│   ├── compliance/
│   └── storefront/
│
├── content/                     ← editable website text (no code editing required)
│   ├── site-text/               ← hero titles, section copy, business info
│   ├── legal/                   ← privacy policy, terms, consumer health data
│   ├── blog-posts/              ← blog/newsletter post content
│   └── faq/
│
├── exports/                     ← generated downloads from the back office
│   ├── reports/
│   ├── orders/
│   └── loyalty/
│
├── site-assets/
│   └── current-public-snapshot/ ← a copy of the live site's /public assets (reference)
│
└── docs/                        ← strategy report, schema, handoff todo, guides
```

---

## How the everyday workflows use these folders

**Updating the menu (POS refresh):**
1. Export `PRODUCTS.xlsx` and `INVENTORIES.xlsx` from Cultivera.
2. Drop both into `intake/pos-uploads/incoming/` (or upload through the back office).
3. The transformer reads them, writes the new menu to `transformer/outputs/menu/`, and writes a review report to `transformer/outputs/reports/`.
4. Staff review the report, approve, and publish. Files move to `intake/pos-uploads/processed/` and a timestamped copy lands in `archive/`.

**Adding a vendor/brand/product image or profile info:**
- Find the vendor at `database/vendors/<vendor-slug>/`, edit `vendor.json`, and drop the logo in `logo/`.
- Drill into `brands/<brand-slug>/` for brand info, and `products/<product-slug>/images/` for product photos.
- The back office media library mirrors these so non-technical staff never touch JSON directly.

**Filling missing product descriptions:**
- Open `database/strains/STRAINS_MASTER.xlsx`. Each strain has its type and any vendor-provided description. Fill the **Trusted Description** column from a reputable source and cite it in **Description Source**.

---

## Key facts derived from the current POS data

- **PRODUCTS.xlsx:** 3,311 product rows — the master metadata (brand, category, strain, type, description, price). Every product currently has a description; **none have images attached**, so product photography is a primary media-library task.
- **INVENTORIES.xlsx:** 3,917 rows — live operational data (price, units available, medical flag, THC/CBD, barcodes, vendor).
- **Vendors:** 105 resolved vendor groupings (121 raw vendor strings in POS — some are aliases/duplicates to merge).
- **Brands:** ~172–183 brands.
- **Strains:** 1,707 unique strain names (1,417 with a resolved type).
- **Categories:** 46 POS product categories mapped down to 21 website categories.

> **POS is the source of truth for price + inventory.** The enrichment fields in `vendor.json` / `brand.json` / `product.json` (logos, mission, photos, marketing copy) are layered *on top* and never overwrite POS price/stock.
