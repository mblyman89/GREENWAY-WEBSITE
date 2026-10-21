# 2026-10-20 — the owner's first end-to-end PREprod upload (real retail activity)

Product came in on **real vendor manifests**, was received through Cultivera, sold at the register, and the hub produced the week's files. The owner uploaded them to PREprod (`precannabisreporting.lcb.wa.gov`) on 2026-10-20. The bytes here are exactly what was sent and what came back (D-23).

| file | rows | CCRS answer |
|---|---|---|
| `sent/Strain_413541_20261020165828.csv` | 14 | error file `errors/Strain_20261020T170115355_failed.csv`: 11 × `Duplicate Strain. The Strain must be unique for the LicenseNumber` (benign `[G L0325-L0326]`) |
| `sent/Area_413541_20261020165829.csv` | — | success |
| `sent/Product_413541_20261020165830.csv` | 18 Inserts (`P20261020A-GWP-000087..104`) | success |
| `sent/Inventory_413541_20261020165831.csv` | 18 Inserts | error file `errors/Inventory__20261020T171203677_failed.csv`: 13 × `Duplicate External Identifier` |
| `sent/InventoryAdjustment_413541_20261020165832.csv` | 3 (2 customer returns, 1 vendor return as `Other`) | success |
| `sent/Sale_413541_20261020165833.csv` | 7 RecreationalRetail | success |

md5: Strain sent `378b4fe6…`, Inventory sent `61c325f0…`, Strain error `2fedaefe…`, Inventory error `a6fce1a4…` (pinned in `tests/compliance/r6-1-preprod-settle.test.ts`).

## What it proves

1. **The Inventory "failure" was ours, not the data's.** The 13 refused lots are exactly the lots whose strains were answered Duplicate Strain. Those vendor lots had been filed by an **earlier PREprod test**. Lot ids are the vendor's own ids and get no per-run prefix, unlike PREprod Product ids. Our PREprod ledger starts **empty** (0249 `ccrs_preprod_ledger_start`), so we routed them as Insert. An Insert must create a new unique record `[G L0246]`, so CCRS refused them.
2. **The Sale file proves 4 of the 13 are on file.** It was accepted and names `WA413287-INE6AQ`, `WA413287-INUKZB`, `21375127720298989`, `21375127433073461`. CCRS refuses a sale naming inventory not already reported `[G L1302-L1304]`.
3. **The 5 accepted lots:** `21375127410682809`, `21375127714797798` (Pure Michigan), `21375127733003150` (Sour Gak), `21375127729537320`, `21375127499408998` (EDOG).
4. **Error file shape, again:**
   - `ErrorMessage` is the 3rd column;
   - a trailing `InventoryIdentifier` column comes back that we never sent;
   - `IsMedical` is echoed as `False`.
   Parse by column name (Part 04 §H).

## What changed because of it (R6-1, migration 0284)

- `ccrs_prove_by_reference(env)` runs after every recorded answer. An uncertain lot named by a **later** accepted Sale/Adjustment row becomes filed.
- `ccrs_preprod_settle_duplicates(by)` sits behind the "Settle PREprod duplicates" button and is **PREprod only**. It handles ids refused only as `Duplicate External Identifier` on our Insert; they become filed. The examiner: PREprod cannot be reset, *"you can request a copy … and clean or work around the data"* `[EXAM L0518]`.
- Production is unchanged: a Service Desk copy settles production uncertainty.
