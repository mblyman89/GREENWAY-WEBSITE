# Cultivera Naming & Product-Mastering — Deep Research (report-first)

> **Purpose.** Before we migrate off Cultivera, the owner wants to *re-upload cleaned
> spreadsheets into Cultivera* so the source system is tidy first. This document is the
> verified reference for **how Cultivera names products, what fields it requires, and how
> it "masters" (dedupes) products** — so our normalization (Slice E) produces names that
> Cultivera will actually accept.
>
> **Status:** Research complete. Report-only (no code). Feeds Slice E.
> **Standing rule honored:** every claim below is grounded in an official Cultivera support
> article or a WA LCB publication and is cited. Nothing is guessed. Where Cultivera does
> not document a hard rule, that is stated explicitly as "not documented — verify in-app."

---

## 1. Sources (verified)

| # | Source | URL |
|---|--------|-----|
| S1 | Cultivera Support — POS Inventory Management: Creating Products | https://support.cultivera.com/article/6jx2fft9yn-inventory-products |
| S2 | Cultivera Support — PRO Inventory Management: Adding and Cloning Products | https://support.cultivera.com/article/103x738cw6-pro-inventory-products |
| S3 | Cultivera Support — PRO Inventory Management: Working with Strains | https://support.cultivera.com/article/za3xq027w1-pro-strains-tab |
| S4 | Cultivera Support — PRO (WA): Adding and Cloning Non-Cannabis Products | https://support.cultivera.com/article/4k6pq4rzeg-add-clone-non-cannabis-inventory |
| S5 | WA LCB — CCRS Upload User Guide (7-7-23) | https://lcb.wa.gov/sites/default/files/publications/Marijuana/CCRS/CCRS%20Upload%20Users%20Guide%207-7-23.pdf |
| S6 | WAC 314-55-105 (labeling) / WAC 314-55-095 (serving/transaction limits) | Washington Administrative Code |

All Cultivera articles were read in full on the research date; the quoted rules below are
verbatim or close paraphrase from those pages.

---

## 2. The one rule that governs everything: **unique Product Name**

Cultivera **enforces a unique Product Name** and uses it as the de-facto master key.

> *"Not changing the 'Name' field will result in an error — this is to prevent users from
> having multiple products with the same name."* — S2 (cannabis) **and** S4 (non-cannabis)

**Implications for our cleanup:**
- Two rows that are *genuinely the same product* must collapse to **one** Product with that
  single unique Name. (This is exactly the 708 / 581 duplicate-name groups we measured in the
  two spreadsheets — see Slice E.)
- Two rows that are *different products* must have **distinct** Names. If our convention would
  produce the same Name for two truly-different SKUs (e.g. same vendor/brand/strain/type but a
  different **package size**), the size **must** be present in the Name to keep them unique.
- Therefore our convention's optional `[{Size}]` segment becomes **mandatory** whenever it is
  the only thing distinguishing two otherwise-identical Names. Slice E enforces this.

---

## 3. How Cultivera models a "product" (fields)

### 3.1 Cultivera **POS** — Create Product (S1)

Prerequisite objects that must already exist: **Vendor, Brand, Price, Profile, Strain, Category.**

| Field | Meaning (verbatim/paraphrase from S1) | Our mapping |
|-------|----------------------------------------|-------------|
| **Product Name** | *Internal* name — shown in back office **and** at the terminal. | ← our Compliance Name |
| **Receipt Name** | *Customer-facing* product name. | ← our Display Name (menu) |
| **Description** | Info shown when searching, back office + terminal. | ← our description |
| **Inventory Type** | State-defined; drives transfer/sales tracking + allowed UOM. | pass through unchanged |
| **Category** | Shop-defined, for sales tracking. | pass through unchanged |
| **Brand** | *"The company that is printed on the package… the company the customer should identify the product with."* | our `{Brand}` |
| **Strain** | Pre-created strain (from the Strains list). | our `{Strain/Flavor}` |
| **Type** | The **strain type** (indica/sativa/hybrid/…). | strain-type (not in Name) |
| **Package Size / Content UOM** | Weight/volume; UOM options change with Inventory Type; must satisfy state UOM limits. | our `{Size}` |
| **Tags** | Keywords for search. | optional |
| Feature flags | Tax Exempt · **Cannabis Product** (uncheck for non-cannabis) · Non-depletable · Make Available · **Pre-Packaged** (uncheck → bulk/by-weight) · Use Price Model | pass through |

### 3.2 Cultivera **PRO** — Add Product (S2)

**Required fields (red asterisk):** **Inventory Type · Strain · Product Line · Sub-Product Line ·
Package Size · Label Template.** Any dropdown with a "+" lets you add a new entry inline.

> Note the PRO model adds **Product Line** and **Sub-Product Line** — a two-level catalog
> hierarchy that POS does not surface. When re-uploading to a PRO tenant these must be present.

### 3.3 Non-cannabis (S4)

- Created under **Inventory Management > Products > Non-Cannabis** ("+Create > New Non-Cannabis
  Product"); the **"Product is Cannabis Product" flag is unchecked** (S1).
- Fields include a **Non-Cannabis Type** (e.g. *Packaging, Additives*) and a **Unit of
  Measurement** (or **'each'**).
- **Does NOT track Cost of Goods Sold** (COGS) — explicitly called out in S4.
- Same **unique-Name** rule applies (S4).

> This maps cleanly onto our Slice B non-cannabis convention
> `{Brand} {Type} {Size} {Gender} {Color}` and our smart-SKU generator.

---

## 4. Strains are a controlled list (S3)

- The **Strains** tab is the single source of strain names; Products reference a strain from it.
- **METRC users cannot edit a strain name in Cultivera** — you must *add a new strain* and then
  perform a **Conversion** for a specific batch (which requires a new METRC package tag). S3.
- **Renaming a strain does NOT auto-rename Products or Labels** — those are edited separately in
  *Inventory Management > Manage Menu*. S3.

**Implication for cleanup:** we must **not** invent or silently alter strain spellings during
normalization. Our normalizer will **preserve the strain token as-is** (only fixing casing /
stray punctuation), and flag — never auto-merge — near-duplicate strain spellings for the owner
to reconcile against the controlled Strains list in-app.

---

## 5. Product-mastering ("dedup") — how it actually works in Cultivera

Cultivera does not expose a bulk "merge duplicates" button in the documented UI. Its mastering
is **preventative**, via three mechanisms (all from S1–S4):

1. **Unique Product Name enforcement** — the system refuses a second product with an identical
   Name (§2). This is the primary de-dup guardrail.
2. **"Search before you add"** — the documented workflow explicitly tells users to *search the
   existing list first* ("potentially under a slightly different name than expected") before
   creating anything. Duplicates arise precisely when this step is skipped and a slightly
   different spelling sneaks in — which is what produced the 700+ dup groups in our export.
3. **Clone, don't recreate** — for near-identical items (differing only by *flavor, strain,
   package size, color, brand*), users **Clone** an existing product and change just those
   fields, then must give it a **new unique Name**. S2 / S4.

**Consequence for Slice E:** the cleanest way to satisfy Cultivera is to
(a) **canonicalize** each Name with our convention so accidental spelling variants collapse to
one string, then (b) **collapse exact-duplicate canonical Names to a single master row**, and
(c) where two *different* SKUs canonicalize to the same string, **append the distinguishing
Size** so both remain unique and importable. No merge tooling on the Cultivera side is required
— a clean, unique-Name spreadsheet is import-ready.

---

## 6. Character / formatting constraints to respect

| Constraint | Value | Source | Why it matters for the Name |
|------------|-------|--------|------------------------------|
| CCRS `Product.Name` max length | **75 chars** | S5 (CCRS Product schema) | Our Compliance Name already clamps to 75 on a word boundary. |
| CCRS `Product.Name` **no commas** | CSV field; commas break the delimiter | S5 | Our engine strips `, / & ! # $ @ " |` + control chars. |
| CCRS Inventory ↔ Product join | by **exact `Product.Name`** | S5 | Names must match byte-for-byte between our Product + Inventory outputs (already fixed in Slice A). |
| Cultivera UOM must match Inventory Type | e.g. grams for Usable Marijuana | S1 | Our normalizer keeps the source UOM/Inventory Type; it never re-derives them. |
| Label Template (PRO) | required | S2 | Not part of the Name; owner sets per product in-app. |

> **Not documented (verify in-app):** Cultivera's own hard max length for the *internal Product
> Name* field is not published in S1–S4. Because CCRS caps the reported Name at **75** and CCRS
> is the stricter downstream consumer, we treat **75** as the binding ceiling and stay under it.
> If Cultivera's field is shorter than 75, that will surface as an import error and we adjust —
> but 75 is the safe, defensible target and matches what the state accepts.

---

## 7. Recommended Cultivera-ready Name (what Slice E will emit)

```
{Vendor} {Brand} {Strain/Flavor} {CannabinoidTag} {Type} [{Size}]
```
- **Drop `{Brand}` when `Brand == Vendor`** (owner rule Q2).
- **CannabinoidTag**: empty for THC-only; ratio (`1:1`, `2:1`) for THC+CBD; `THC:CBD:CBN` for 3+
  (owner rule Q1). CBD-flower gets an explicit `CBD` marker.
- **`{Size}` is included whenever it is required to keep the Name unique** (§2) — and always for
  edibles/beverages/tinctures where size disambiguates dose packs.
- **Flower → grams only**; food/beverage → ounces + grams on the *label/menu* (WAC 314-55-105);
  the Cultivera Package Size field keeps the state-compliant UOM (owner rule Q5).
- **No "house flower"** — Greenway only carries approved-supplier product; every Name carries a
  real Vendor (owner rule Q3).
- **≤ 75 chars, no commas / disallowed chars** (§6).

This is identical to the finalized convention in `PRODUCT_NAMING_CONVENTION.md`, now confirmed
to be **compatible with Cultivera's field model and unique-Name mastering**.

---

## 8. Cleanup checklist the owner can run before re-uploading to Cultivera

1. **Export** current Products + Inventories from Cultivera (done → `PRODUCTS_UPDATED.xlsx`,
   `INVENTORIES_UPDATED.xlsx`).
2. **Run our normalizer** (Slice E) → produces `*_NORMALIZED.xlsx` + a **change report** +
   a **duplicates report**.
3. **Review the duplicates report**: confirm each collapsed group is truly one product; split
   any that must stay separate by adding/keeping the distinguishing Size.
4. **Review the strain-variant flags**: reconcile near-duplicate strain spellings against the
   Cultivera **Strains** list (do not bulk-edit strain names for METRC-tracked batches — add +
   convert instead). S3.
5. **Re-import** the cleaned, unique-Name sheet into Cultivera (or hand-correct the flagged
   rows in-app, cloning where appropriate).
6. **Then** proceed with the Greenway migration off Cultivera.

---

*Prepared as the Slice D deliverable. No customer data or guesses; all rules cited above.*
