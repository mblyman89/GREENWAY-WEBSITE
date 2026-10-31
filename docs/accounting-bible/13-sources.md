# 13 — Sources (authorities and references used in this bible)

> **Audience: me.** AGENTS.md: re-verify against the **live current version** before encoding any rate, date or rule in code.
> "Fetched" = retrieved during the 2026-10-31 recon. Rates and thresholds quoted in part 02 come from these.

## 1. Washington State: cannabis excise and LCB

| Authority | URL | Used for |
|---|---|---|
| RCW 69.50.535: cannabis excise tax 37%, medical exemption until 2029-06-30, trust/personal liability | https://app.leg.wa.gov/rcw/default.aspx?cite=69.50.535 | INV-05, N-09, S-03b, S-12 (fetched; (2)(a)-(c) quoted in part 09) |
| LCB CIB-94 / HB 1453 medical excise exemption infographic | https://lcb.wa.gov/sites/default/files/publications/temp_links/CIB-94_HB1453_InfoGraphic_v5.pdf | S-03b |
| LCB guidance on SHB 1453 implementation | https://content.govdelivery.com/accounts/WALCB/bulletins/39db27f | S-03b |
| DOH HB 1453 excise exemption FAQ | https://doh.wa.gov/sites/default/files/2024-07/608050-HB1453ExciseTaxExemptionFAQ.pdf | S-03b |
| DOH medical cannabis product compliance (ch. 246-70 WAC) | https://doh.wa.gov/you-and-your-family/cannabis/medical-cannabis/product-compliance | S-03b |
| LIQ-1295 Cannabis Retailer excise form (R 7/24) | https://lcb.wa.gov/sites/default/files/2025-01/LIQ1295%20Cannabis%20Retailer%20Form%20%28R%207%2024%29.pdf | T-04, U-17 |
| WAC 314-55-092 (excise reporting, due the 20th) / 314-55-089 / 314-55-090 | https://apps.leg.wa.gov/wac/default.aspx?cite=314-55-092 (and -089, -090) | close calendar, S-12 |

## 2. Washington State: Department of Revenue

| Authority | URL | Used for |
|---|---|---|
| WAC 458-20-22801 (tax reporting frequency, due dates) | https://apps.leg.wa.gov/wac/default.aspx?cite=458-20-22801 | due the 25th |
| DOR filing frequencies and due dates | https://dor.wa.gov/file-pay-taxes/filing-frequencies-due-dates | close calendar |
| DOR B&O classifications (retailing .00471; service tiers) | https://dor.wa.gov/taxes-rates/business-occupation-tax/business-occupation-tax-classifications | S-13, N-07, F-05 |
| DOR penalty waivers | https://dor.wa.gov/file-pay-taxes/late-filing/penalty-waivers | tax-penalty-core context |
| DOR bulletin (B&O rate change) | https://content.govdelivery.com/accounts/WADOR/bulletins/30abca2 | dated rates (rule 114) |
| RCW 82.08.9998: retail sales tax exemption for qualifying patients | https://app.leg.wa.gov/rcw/default.aspx?cite=82.08.9998 | S-03b (as cited in estimator-core.ts:20,41) |
| Secondary: WA excise due dates summaries | https://contractorlane.com/resources/washington-excise-tax-due-dates ; https://prophit.ai/resources/sales-tax-atlas/washington/filing ; https://www.seattle-taxattorney.com/washington-dor/excise-tax | cross-check only |

## 3. Federal tax

| Authority | URL | Used for |
|---|---|---|
| 26 U.S.C. §280E | https://www.law.cornell.edu/uscode/text/26/280E | entity design, T-08 |
| 26 CFR 1.471-3 (inventory cost) | https://www.law.cornell.edu/cfr/text/26/1.471-3 | INV-12, S-08 freight |
| 26 CFR 1.471-2 (valuation, LCM) | https://www.law.cornell.edu/cfr/text/26/1.471-2 | S-21 |
| Harborside (Patients Mutual) v. Commissioner, 9th Cir. No. 19-73078 | https://www.govinfo.gov/content/pkg/USCOURTS-ca9-19-73078/pdf/USCOURTS-ca9-19-73078-0.pdf | 280E COGS limits (Q-06) |
| Rev. Proc. 98-29 (retail safe harbor shrinkage) | https://www.irs.gov/pub/irs-drop/rp-98-29.pdf | F-03 |
| Form 7203 instructions | https://www.irs.gov/instructions/i7203 ; https://www.irs.gov/forms-pubs/about-form-7203 | S-27 |
| Publication 15 (Circular E), 2026 | https://www.irs.gov/publications/p15 | S-16; SS wage base $184,500; 1099-NEC $2,000 |
| Secondary on Form 7203 | https://www.tavellagroup.com/tax-guides/s-corporation-shareholder-basis-form-7203 ; https://ledgerism.net/form-7203-s-corp-basis ; https://dimovtax.com/irs-form-7203 ; https://madrasaccountancy.com/blog-posts/form-7203-s-corporation-shareholder-stock-and-debt-basis-limitations | cross-check |

## 4. Accounting standards (reference only; book is tax-basis accrual)

| Authority | URL | Used for |
|---|---|---|
| FASB ASU 2015-11 (inventory LCNRV) | https://storage.fasb.org/ASU%202015-11.pdf | F-02, S-21 |
| ASC 330 overview (PwC Viewpoint) | https://viewpoint.pwc.com/dt/us/en/fasb/GAAP/Codification/Codification/208049.html | F-02 |
| ASC 330 article | https://cpcongroup.com/insights/article/asc-330-inventory-accounting | cross-check |
| LCNRV teaching | https://courses.lumenlearning.com/suny-clinton-financialaccounting/chapter/lower-of-cost-or-net-realizable-value-applied | mentor copy |

## 5. Controls, banking, enterprise patterns

| Authority | URL | Used for |
|---|---|---|
| COSO Internal Control – Integrated Framework (2013) | https://www.como.gov/archive/2021/12/COSO-2013.pdf | part 11 §6, S-35 |
| FinCEN FIN-2014-G001 (marijuana-related businesses) | https://www.fincen.gov/system/files/guidance/FIN-2014-G001.pdf | F-12, S-18 |
| NetSuite help: period close checklist | https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1455781.html | part 08 §6, part 11 §7 |
| Plaid Transactions API (`/transactions/sync`) | https://plaid.com/docs/api/products/transactions/ | S-17, U-09 |

## 6. In-repo authorities (the code is the spec of record)

| Doc | Path |
|---|---|
| Standing rules | AGENTS.md; todo rules (25, 27, 50, 100, 114, 131, 133, 134) |
| Defects ledger | docs/DEFECTS.md (D-30…D-82, line numbers in part 04 §6) |
| Medical compliance | docs/MEDICAL_CANNABIS_COMPLIANCE.md |
| Cut-over one-pager | CUTOVER_WEEKEND_ONE_PAGE.md (generated from src/lib/pos/cutover-weekend-core.ts) |
| Census | src/lib/accounting/ledger-census-data.ts |
| GL migrations | supabase/migrations/0172–0178, 0185–0192, 0205–0213, 0238, 0240, 0316, 0318 |
