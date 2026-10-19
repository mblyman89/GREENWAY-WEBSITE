# Owner screenshots — 2026-10-19 (CCRS hub, week 2026-10-11 → 2026-10-17)

Supplied by the owner (Michael Lyman) on 2026-10-19, after Bible Part 17 merged
(PR #1424, main `36d9dc86`). Both are screenshots of `/admin/compliance/ccrs`,
"Validation" section, for the reporting week **Sun 2026-10-11 → Sat 2026-10-17**
(due Sun 2026-10-18 per the hub's week picker).

| File | md5 | Environment | Pixel size |
|---|---|---|---|
| `CCRS_BLOCKED_UPLOAD_PREPRODUCTION_SIDE.png` | `82ac3f2b66ccffcd512f179845715c34` | PREprod | 1876×846 |
| `CCRS_BLOCKED_UPLOAD_PRODUCTION_SIDE.png` | `365dcbc8c6c9572b31aa80cd733f5b37` | Production | 1883×857 |

Each error line is wrapped inside an `<li>` by the hub (`src/app/admin/compliance/ccrs/page.tsx`
at the time); the right-hand truncation visible in the images is the **screenshot crop**,
not the UI. Everything below is transcribed only from what is visible; text cut by the
crop is marked `…`.

## Owner facts given with the screenshots (verbatim intent)

- "preproduction says i need to assign ids to them, which i did on the production side,
  so it has the second blocking issue on it." → the owner pressed **Assign CCRS Product ids (GWP-)**
  on production only. PREprod ids were NOT assigned (separate ledgers, by design — [FAQ L0096]).
- "i have one manifest in the system currently with 38 products on it, so yes i am only
  expecting 38 lots right now."
- "I tested a sale also before screen capturing the error messages."
- Cultivera's final upload of Greenway data to CCRS: **Saturday 2026-11-07**.
- Greenway begins using the new system: **2026-11-01**.
- Owner is registered on WA.gov.

## PREprod — transcription

Counters: **Total records 17 · Blocking errors 2 · Warnings 23 · Medical sale rows 0**.

Errors (verbatim, cut at crop):

1. `[Product] 20 product(s) were left out of Product.csv because no CCRS Product id is assigned or its CCRS status is unproven [G L0246-L0248]. Lots of these products are withheld from Inventory.csv too. (20)`
2. `[Inventory] 38 lot(s) were left out of Inventory.csv because we cannot prove what CCRS holds for them. Insert creates a record and Update alters "an existing record indicated by external identifier" [G L0246-L0248], so sending either on a guess …` `(38)`

Warnings visible (23 in total): Product "Inventory lots reference products not present in the
published menu (Product.csv). (38)"; Strain "13 strain(s) … defaulted to "Hybrid": Guava Melonz,
Greasy Grapezz, Tally Mon, Black Maple, Cake Bomb, Strawberry Candy, Spodie, White Cherry Runtz,
Papaya Melonz #7, Lemon Beltz, Modified Watermelon, Spodi, Huckleberry Pie"; several
"Heavenly Buds … Usable Marijuana → Usable Cannabis" alias notes; one Description truncation
("Heavenly Buds Orange Diesel Rosin 1g"); Inventory "No inventory lots found to report.";
InventoryAdjustment "No reportable adjustments…"; the InventoryTransfer intentionally-empty note;
"File contains no data rows" for Product, Inventory, InventoryAdjustment, InventoryTransfer.
**No** "No completed orders in the selected range." warning and **no** Sale "no data rows"
warning appear.

## Production — transcription

Counters: **Total records 49 · Blocking errors 1 · Warnings 23 · Medical sale rows 0**.

Error (verbatim, cut at crop):

1. `[Inventory] 17 lot(s) were left out of Inventory.csv because we cannot prove what CCRS holds for them. Insert creates a record and Update alters "an existing record indicated by external identifier" [G L0246-L0248], so sending either on a guess …` `(17)`

Warnings visible (23 in total):

- `[Inventory] 3 lot(s) are already filed in CCRS under a product whose name differs from ours. Inventory must name the product "in the same format and spelling as previously submitted" [G L0580-L0583], so the filed name was used. To change t…` (E40)
- `[Strain] 2 strain name(s) differ from another only by capital letters. CCRS must never receive the same strain with a different capitalization (LCB Service Desk: "Dutch Treat vs Dutch treat"), so each was written with one spelling everywhere and n…` (E39)
- `[Product] 18 Product free-text value(s) had commas changed to semicolons, because CCRS splits every row on every comma: GWP-000051 (Description); GWP-000052 (Description); GWP-000061 (Description); GWP-000064 (Description); GWP-… GWP-000067 (Description); GWP-000054 (Description) and 8 more. The rest of each row was sent unchanged. (18)` (E44 — proves ≥18 products were emitted under GWP- ids)
- `[Product] Inventory lots reference products not present in the published menu (Product.csv). (38)`
- Strain "5 strain(s) … defaulted to "Hybrid": Guava Melonz, Greasy Grapezz, Spodie, Modified Watermelon, Spodi"; alias/truncation notes; adjustment/transfer notes; "File contains no data rows" only for InventoryAdjustment and InventoryTransfer.

## What the screenshots prove / do not prove (analysis lives in Part 17 §K)

- PROVEN: Sale.csv had ≥1 data row in both environments (no Sale empty/no-orders warning).
- PROVEN: the production orphan warning `(38)` is a false positive — Product.csv column 6 holds
  GWP- ids while the check compares raw `pos_product_key`s (Part 17 §C.4 defect 3; fixed by S-17b).
- PROVEN: Part 17 §C.3's "2 products" reading was wrong for this week — PREprod withholds **20**.
- NOT shown: *why* each of production's 17 lots is withheld. The hub dropped `rows` (Part 17 §C.4
  defect 1). S-17a renders them.
