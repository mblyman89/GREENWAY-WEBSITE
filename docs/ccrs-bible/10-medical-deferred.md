# 10 — Medical Endorsement Path (DEFERRED by owner decision D-03)

Owner (Part 05, Q4): leave `IsMedical=FALSE` until he flips it. The store is built for medical but is not yet medically endorsed. **No agent starts S-10 until the owner says go in a message that can be quoted in Part 05.** This part exists so the flip is a procedure, not a rediscovery.

## A. What the LCB text requires (verbatim pins)

1. Inventory `IsMedical`: "This field may only be marked TRUE if passing test results have been received that verify the inventory meets the standards for compliant medical product as outlined in WAC 314-55-102 & WAC 246-70-050." `[G L0640-L0642]`
2. Sale excise: "CannabisExciseTax must equal 37% of unit price (except medical)" `[G L1374]`; errors "CannabisExciseTax does not equal 37% of UnitPrice" `[G L1377]` and "Only Medical Sales can be 0" `[G L1378]`.
3. FAQ conditions for a $0.00 tax report — all must be met `[FAQ L0115-L0121]`:
   - "The Medical Card holder is registered in the Medical Cannabis Authorization Database." `[FAQ L0115]`
   - "The product(s) are Medically Compliant products." `[FAQ L0116]`
   - "The retail licensee must have a medical endorsement." `[FAQ L0118]`
   - "The product must be marked in the retailer's inventory upload to CCRS as 'Medically Compliant.'" `[FAQ L0119]`
   - "The sale must be RecreationalMedical when reporting to CCRS." `[FAQ L0120]`
   - "If all these conditions are met, the two tax columns can be reported as $0.00 to show the tax exemption. All sales that do not meet these conditions must have taxes reported following current reporting requirements." `[FAQ L0121]`
4. "A reminder that a tax exemption is not a 'discount'" `[FAQ L0162]` — the Sale `Discount` column is not where the exemption goes; the tax columns are.
5. AGENTS.md DOH section (Part 01 §B): two exemptions never conflated; excise exempt only when endorsed retailer + valid in-MCR card + DOH-compliant product; `medical_exempt_sales` retained 5 years.

## B. What the code does today (pins at `c1ca753`)

| Element | Anchor | Behaviour |
|---|---|---|
| Inventory `IsMedical` | `ccrs-batch.ts` L393 | hard-coded `"FALSE"` with comment "medical exemptions are tracked per-sale, not per-lot" |
| Sale `SaleType` | `ccrs-sales.ts` L238-L250, L427-L429 | `RecreationalMedical` when the order has rows in `medical_exempt_sales` (0040 L84-L104), keyed `(order_id, product_sku)`; that line's tax columns zeroed |
| W6 warning | `ccrs-sales.ts` L470-L489 | counts `RecreationalMedical` lines and warns |
| Endorsement config | `src/lib/medical/store.ts` L83-L100 `getEndorsementConfig()` → `isMedicallyEndorsed`, `endorsementNumber`, `exciseExemptionUntil` from `medical_endorsement_config` | read by the hub DOH block (`page.tsx` L143) |
| DOH-compliant registry | `medical_product_registry` (0113 L22-…) keyed by `pos_product_key`, categories general_use / high_thc / … | not read by any CCRS builder today |
| Exempt-sale ledger | `medical_exempt_sales` 0040 L84-L104 (`sales_tax_exempt`, `excise_tax_exempt`, `excise_amount_exempt_minor`) | source of `RecreationalMedical` |
| Customer return medical path | `disposition.ts` L612-L625 | snapshots medical flags on return |

Gap between text and code: the FAQ's condition 4 (`[FAQ L0119]` — product marked medically compliant *in the inventory upload*) is `IsMedical=TRUE` on the Inventory row. Today every row is FALSE, so **a `RecreationalMedical` sale with $0.00 tax would today reference inventory the LCB sees as non-medical**. That is consistent with the owner's "not endorsed yet" state — as long as no `medical_exempt_sales` rows exist. Guardrail needed now (S-02 or S-03, not S-10): if `getEndorsementConfig().isMedicallyEndorsed === false` **and** any Sale row would be `RecreationalMedical`, raise a blocking error `E_MEDICAL_SALE_WHILE_UNENDORSED` `[FAQ L0118]`. This protects the owner from a stray exempt record producing a $0 tax row before he flips.

## C. The flip procedure (S-10, only after D-03 is reversed in writing)

1. **Owner inputs**: endorsement number and effective date → `medical_endorsement_config.is_medically_endorsed = true` (existing table; existing admin UI under `/admin/medical` — verify route at slice time).
2. **Inventory `IsMedical`**: replace L393 with a per-lot value: `TRUE` iff (a) `medical_product_registry` has the lot's `pos_product_key` with a DOH category, **and** (b) the lot's `lab_result_id` (intake-store insert L654) resolves to a passing result that meets WAC 314-55-102 / 246-70-050 `[G L0640-L0642]` — the lab-result predicate must be a PURE function with pins in its self-test; if the repo has no field for "medical-grade pass", add `lab_results.medical_compliant boolean` with `source` and stop there until the owner confirms how he reads that off the COA.
3. **Operation for existing lots**: flipping a lot from FALSE to TRUE is an Inventory `Update` (with `UpdatedBy/UpdatedDate` `[G L0229-L0243]`), which N-03 tracking (S-05) will produce automatically once the emitted-row hash changes.
4. **Sale**: keep the `medical_exempt_sales` keying; add the FAQ-condition gate as a PURE function `canReportMedicalExempt({ endorsed, cardValidOnSaleDate, productDohCompliant, lotIsMedical })` → all four must be true or the row is reported with full tax and a blocking error names which leg failed (`[FAQ L0115-L0121]` legs 1–4). The hub DOH block (Part 08 §B "four legs") already lists the legs; wire it to this function so the UI and the file agree.
5. **W6** → becomes informational (count) once the gate exists; the gate carries the severity.
6. **Tests first**: fixture order with one exempt line; four tests, each breaking one leg; golden `Sale.golden.csv` unchanged (fixture has no medical rows); new golden `Sale.medical.golden.csv` optional.
7. **PREprod**: T-38 (`IsMedical=TRUE` accepted syntactically) and a new T-39 (RecreationalMedical with $0.00 taxes) must run in PREprod before the first prod week with medical rows. Record in Part 06 §A ledger.
8. **Docs**: `docs/MEDICAL_CANNABIS_COMPLIANCE.md` gets a "CCRS reporting" section that cites this part; Part 04 W6 → DONE; Part 05 gets the new dated decision.

## D. What must not happen before the flip

- No `IsMedical=TRUE` in any prod file.
- No `RecreationalMedical` row with $0.00 tax in any prod file (guardrail §B).
- No PREprod test of medical rows that reuses prod identifiers that later need to be real (environments are separate `[FAQ L0096]`, so this is safe, but use `GW-TEST-` prefixed ids anyway — Part 06 §B convention).
