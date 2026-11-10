# 2026-11-10: PREprod Sale file, 2 rows refused for a 1-cent excise mismatch (D227)

The owner uploaded the weekly Sale file to PREprod on 2026-11-10. CCRS filed 1,330 of its 1,332 rows and refused 2. Its email read "PRE: CCRS errors for file: Sale_413541_20261110101609_20261110T1041970.csv", with the body "Errors have occurred in file: Sale_413541_20261110101609_20261110T1041970.csv. Please correct errors and resubmit data."

| file sent | rows | CCRS answer (error file) |
|---|---|---|
| `sent/Sale_413541_20261110101609.csv` (md5 b688a6b061de68fb97b67ce9f1c22c46) | 1,332 | `errors/Sale__20261110T104153061.csv` (md5 4e9b6f7ee3b681061ed0668978c83916): 2 rows, "Cannabis Excise Tax does not equal 37% of Unit Price" |

Hub records (read-only, 2026-11-10): ccrs_files 828c7a8f-820a-4768-9719-df0f5fce3029 (preprod, uploaded); rows 80 and 185; ccrs_mail_messages 2345db48-c5ab-4252-8cae-c84e00e2b827 (new, never-seen message).

## The two refused rows

| SaleDetailExternalIdentifier | Qty | UnitPrice | Discount | RetailSalesTax | CannabisExciseTax | 37% of (Qty x UnitPrice - Discount) |
|---|---|---|---|---|---|---|
| GWY-AZ3ALV-5a216511 | 3 | 12.30 | 0.00 | 3.43 | 13.66 | 36.90 -> 13.65 |
| GWY-7DPS89-c54049ac | 2 | 12.30 | 0.00 | 2.29 | 9.11 | 24.60 -> 9.10 |

Both lines are lot GF41583505719517, stored at $18.00 a unit tax-inclusive (`order_lines.price_minor_units` = 1800 = regular), no discount, no exemption.

## Cause (exporter, not data)

`ccrs-sales.ts` backed the tax out twice: UnitPrice = round(1800 / 1.463) = 1230, base = round(3 x 1800 / 1.463) = 3691. Excise was 37% of 3691 = 1366, but the printed row reads 3 x 12.30 - 0.00 = 36.90. CCRS checks the printed row.

**What CCRS checks.** On all 1,330 rows it accepted in this file, excise == round_half_up(37% x (Quantity x UnitPrice - Discount)). Every one matched exactly; floor and ceiling rounding each mismatch more than 600 rows. 892 of the accepted rows carry a discount, and 886 of those would fail if the discount were not subtracted. So the guide's "37% of unit price" [G L1374] is applied to the discounted line total, as in the FAQ example [FAQ L0153-L0160].

**Exposure.** Of 290 multi-quantity lines sold in prod between 2026-11-01 and 2026-11-10, 2 would fail. Single-unit lines never do.

## Fix (D227)

A single helper, `ccrsSaleLineMoney` in `src/lib/reports/tax-base-core.ts`, now computes the row's money. When rounded UnitPrice x Quantity falls short of the base, it lifts UnitPrice to the smallest covering cent, and Discount absorbs the rest. Taxes are unchanged.

The re-sent rows are 3 x 12.31 - 0.02 = 36.91 (excise 13.66) and 2 x 12.31 - 0.01 = 24.61 (excise 9.11).
