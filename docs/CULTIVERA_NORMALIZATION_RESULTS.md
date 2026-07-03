# Cultivera Spreadsheet Normalization — Results (Slice E)

> **What this is.** The owner uploaded two Cultivera exports —
> `PRODUCTS_UPDATED.xlsx` (the product master) and `INVENTORIES_UPDATED.xlsx`
> (inventory lots) — and asked us to *fix the names to the Greenway convention* and
> *dedupe mindful of Cultivera product-mastering* so the sheets can be re-uploaded
> into Cultivera cleanly before migration. This is the report-back on that attempt.
>
> **How it was produced.** `scripts/naming/normalize_cultivera.py` (reproducible;
> re-run anytime). Every name is rebuilt from the sheet's **structured columns**
> (the trustworthy source of truth), never guessed. Rules mirror the finalized
> convention (`docs/PRODUCT_NAMING_CONVENTION.md`) and the Cultivera research
> (`docs/CULTIVERA_NAMING_RESEARCH.md`).

---

## 1. Headline results

| Sheet | Rows in | Rows out | Renamed | True duplicates collapsed | Dup-name groups **before → after** | Names > 75 chars **before → after** | Names with commas **before → after** |
|-------|--------:|---------:|--------:|--------------------------:|:----------------------------------:|:----------------------------------:|:------------------------------------:|
| **PRODUCTS** (master) | 3,500 | **2,676** | 2,647 | **824 rows** (756 groups) | 708 → **0** | 110 → **0** | 46 → **0** |
| **INVENTORIES** (lots) | 4,346 | **4,346** | 4,344 | 0 (lots kept separate) | 581 → **0** | 132 → **0** | 41 → **0** |

- **Every** resulting name is **unique**, **≤ 75 characters**, and **comma-free** — i.e. it
  satisfies both Cultivera's unique-Name rule and the CCRS `Product.Name` constraints.
- **PRODUCTS** is the master, so **824 genuine duplicate rows were collapsed** into their
  master (down to 2,676 unique products). **INVENTORIES** are physical lots (each a distinct
  barcode/package), so rows were **renamed but not collapsed** — that is correct; two lots of
  the same product legitimately coexist.

---

## 2. What the convention did to the names (examples)

| Before (messy) | After (convention) |
|----------------|--------------------|
| `3pk Train Wreck Snickle Fritz Cart` | `Grow Op Farms Phat Panda Trainwreck Cartridge 3g` |
| `- 3pk Lemon Cherry Gelato Snickle Fritz Cart` | `Grow Op Farms Phat Panda Lemon Cherry Gelato Cartridge 3g` |
| `Indica - 3pk Hawaiian Zkittlez Snickle Fritz Cart` | `Grow Op Farms Phat Panda Hawaiian Zkittlez Cartridge 3g` |
| `1937 - Pre-Rolls .5 x 2 pack - Cobra Chi 9 - 1g` | `1937 Cobra Chi 9 Pre-roll 1g` |
| `Downtown live resin Comatoast 1g` | `Downtown Comatoast Live Resin 1g` |
| `Full Spec-Live Resin-Gummies-Blueberry Lavender-THC/CBN-100mg` | `Edgemont Group Llc Full Spec Blueberry Lavender 1:1 Edible 0.95oz` |
| `JAR_XTRA_DRAGON_BALM_CBD_2oz` | (underscores → spaces, title-cased, cleaned) |

**Transformations applied (all deterministic, all cited to the convention):**
- **Vendor prefix** added from the `Vendor` column (Inventories only — Products has no Vendor).
- **Brand dropped when it equals the Vendor** (owner rule Q2).
- **Cannabinoid tag** derived from the measured `Thc/Thca/Cbd/Cbda` columns: empty for
  THC-dominant, ratio (`1:1`, `2:1`, `5:1`) for balanced THC+CBD, `THC:CBD` letters for 3+ — with
  a **trace-cannabinoid guard** (a co-cannabinoid under 10 % of the dominant is ignored, so a
  92 % THC / 1.7 % CBD cart is **not** mislabeled `20:1`).
- **Package size** normalized (`1.00 Grams`→`1g`, `2.00 FluidOunce`→`2floz`, `1.00 Each`→ none).
- Leading dashes, `Indica -`/`Sativa -` prefixes, underscores, and `- ` delimiters cleaned.
- Commas and CCRS-disallowed characters (`, / & ! # $ @ " |` + control chars) stripped.
- Title-cased with acronyms (THC/CBD/…), ratios, and unit tokens preserved; clamped to 75 on a
  word boundary.

---

## 3. Deliverables (in `normalized_cultivera/`)

| File | What it is |
|------|-----------|
| `PRODUCTS_NORMALIZED.xlsx` | Deduped product **master** (2,676 unique rows), all columns preserved, Name rebuilt. |
| `INVENTORIES_NORMALIZED.xlsx` | All 4,346 inventory lots, Name rebuilt (no collapse). |
| `PRODUCTS_change_report.csv` | Every product row: `Old Name → New Name` + notes (renamed / collapsed_duplicate / …). |
| `INVENTORIES_change_report.csv` | Every inventory row: `Id, Old Name → New Name` + notes. |
| `PRODUCTS_collapsed_groups.csv` | The 756 duplicate groups that were merged, with the master name + how many rows folded in. **Review this to confirm each merge (or split any that should stay separate).** |
| `PRODUCTS_duplicates_after.csv` / `INVENTORIES_duplicates_after.csv` | Post-run duplicate check — **both empty** (0 remaining), proving uniqueness. |
| `INVENTORIES_strain_variants.csv` | Near-duplicate strain spellings to reconcile against Cultivera's controlled Strains list (empty this run). |

---

## 4. Honest limitations (reported, not hidden — nothing guessed)

1. **PRODUCTS has no Vendor column and no cannabinoid columns.** Product-master names therefore
   carry **no vendor prefix and no ratio tag** (both flagged `no_vendor_column` /
   `no_cannabinoid_columns` in the change report). The **INVENTORIES** sheet *does* have Vendor +
   cannabinoids, so its names are fully enriched. If you want vendor/ratio on the product master
   too, we can join the two sheets on the shared product identity — say the word.
2. **INVENTORIES has only THC/CBD columns (no CBN/CBG).** A source name like
   `CBN:CBD:THC 1:1:1` can only be re-derived as `1:1` from the two columns we actually have.
   This is grounded in the available data, not guessed.
3. **Strain spellings are preserved, never merged.** Cultivera's Strains list is controlled and
   METRC-locked (see research doc §4); any near-duplicate spellings are *flagged* for you to
   reconcile in-app, not auto-changed.
4. **`1 1/4"` → `1 1 4`** on some rolling papers: the `/` and `"` are CCRS-disallowed and must be
   stripped. Compliant, if slightly less pretty; review in the change report if you'd prefer a
   hand-edit (e.g. `1.25in`).

---

## 5. Recommended next steps for the owner

1. Open `PRODUCTS_collapsed_groups.csv` and confirm each merged group is truly one product;
   split any that must stay separate (add the distinguishing size/flavor to the name).
2. Skim `*_change_report.csv` for any renames that look wrong; hand-correct in the normalized xlsx.
3. Re-import the cleaned, unique-Name sheets into Cultivera (clone for near-duplicates per its
   workflow), **or** hand-correct flagged rows in-app.
4. Proceed with the Greenway migration off Cultivera.

*Re-run at any time:*
```
python3 scripts/naming/normalize_cultivera.py \
  --products <PRODUCTS.xlsx> --inventories <INVENTORIES.xlsx> --outdir <dir>
```
