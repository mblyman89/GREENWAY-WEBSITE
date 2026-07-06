# Canonical reporting period basis (S-8, COMPLIANCE_ROADMAP)

**Decision: tax and compliance filings are based on COMPLETED orders, bucketed
by `orders.completed_at` (UTC timestamp, Pacific-time bucketing for month/day
keys), with `placed_at` as a fallback for legacy completed orders that predate
the `completed_at` column.**

## Why

Three artifacts must reconcile to the dollar for every filing period:

| Artifact | Builder | Basis (after S-8) |
| --- | --- | --- |
| LIQ-1295 excise return (Box 1/2) | `src/lib/compliance/excise-return.ts` | completed orders by `completed_at` (already) |
| CCRS `Sale.csv` | `src/lib/compliance/ccrs-sales.ts` | completed orders by `completed_at` (was `placed_at` range over all statuses) |
| WA tax report (excise + DOR sales tax) | `src/lib/reports/wa-tax.ts` | completed orders by `completed_at` (was non-cancelled by `placed_at`) |

Before S-8 the three disagreed in two ways:

1. **Status**: wa-tax counted every non-cancelled order (including never-picked-up
   ones); the excise return and CCRS only counted completed orders. Excise was
   overstated relative to the LIQ-1295.
2. **Timestamp**: an order placed 11:55 pm on the last day of the month and
   completed 12:10 am the next day landed in different periods per artifact.
   The CCRS `SaleDate` column already prints `completed_at ?? placed_at`, so a
   `placed_at`-ranged query could emit rows whose printed SaleDate falls
   outside the requested range.

`completed_at` is when the sale legally happened (product handed over, money
taken) — the WSLCB reporting event. `placed_at` is only when the online order
was submitted.

## Fallback rule

`completed_at` may be null on legacy completed rows (the column is set by
`updateOrderStatus` on the completed transition). Every basis query uses:

```
status = 'completed' AND (
  completed_at BETWEEN from AND to
  OR (completed_at IS NULL AND placed_at BETWEEN from AND to)
)
```

and buckets by `completed_at ?? placed_at`.

## Scope

Applies to filing-grade artifacts: wa-tax, CCRS Sale.csv, LIQ-1295 (already).
Operational analytics (sales/analytics/customers reports) intentionally keep
`placed_at` over non-cancelled orders — they answer "what happened in the shop
that day", not "what do we owe the state" — and are labelled as such in the UI.

## Medical exemption cross-wiring (S-8)

- `medical_exempt_sales.product_sku` MUST equal the sold order line's
  `product_id` (POS product key). Both wa-tax and ccrs-sales join exempt
  records to lines by `(order_id, product_sku)`.
- wa-tax: exempt lines contribute ZERO to collected sales-tax/excise totals;
  the exempted amounts are reported separately (`medicalExempt*` fields) for
  the LIQ-1295 Box 2 deduction.
- CCRS Sale.csv: exempt lines report `SalesTax` and/or `OtherTax` as `0.00`
  and the order reports `SaleType = RecreationalMedical`.
- Unmatched exempt records (bad SKU / missing order id) are surfaced as
  warnings in both artifacts instead of silently ignored.

## Record-retention query proof (WAC 314-55-090(2), 5 years)

Per-sale exempt records carry {sale_date, UPID, card effective/expiration,
product SKU + name, sales price} in `medical_exempt_sales`; completeness is
enforced at write time (`verifyExemptSaleRecord`, Slice 103) and re-checked in
`compliance-health.ts`. A 5-year lookback is a single indexed query:
`select * from medical_exempt_sales where sale_date >= current_date - interval '5 years' order by sale_date`.
