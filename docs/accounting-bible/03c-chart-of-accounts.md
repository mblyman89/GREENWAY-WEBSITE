# ACCOUNTING BIBLE — 03c · FULL CHART OF ACCOUNTS (193 codes, every migration)

> Generated during recon on 2026-10-31 with:
> `grep -ohE "gl_upsert_account\('[0-9]{5}','[^']*'" supabase/migrations/*.sql | sort -u`
> Seeded by 0173 (120 codes) and 0178 (fixed assets 21xxx), plus later migrations (71050+, 72xxx–85xxx).
> Re-run that command before trusting a code. **Never invent an account (rule 25).** Parents (x0000 / xx000 headers) refuse postings (0176:211-213 for OB; check `gl_post_journal` for the journal rule).

| Code | Name | Group |
|---|---|---|
| 10000 | Cash & Cash Equivalents | Cash |
| 10100 | Cash on Hand — Vault | Cash |
| 10110 | Cash on Hand — Tills | Cash |
| 10200 | Bank — Operating | Cash |
| 10300 | Bank — ATM Vault Account | Cash |
| 10400 | Undeposited Funds | Cash |
| 10900 | Cash — Clearing / In Transit | Cash |
| 12000 | Other Current Assets | Other current assets |
| 12100 | Employee Advances Receivable | Other current assets |
| 12200 | Prepaid Expenses | Other current assets |
| 12300 | Excise Tax Receivable / Overpayment | Other current assets |
| 20000 | Inventory — Cannabis (control) | Inventory |
| 20010 | Inventory — Flower | Inventory |
| 20020 | Inventory — Popcorn Bud | Inventory |
| 20030 | Inventory — Infused Flower | Inventory |
| 20040 | Inventory — Trim | Inventory |
| 20050 | Inventory — Preroll | Inventory |
| 20060 | Inventory — Preroll Pack | Inventory |
| 20070 | Inventory — Blunt | Inventory |
| 20080 | Inventory — Infused Preroll | Inventory |
| 20090 | Inventory — Infused Preroll Pack | Inventory |
| 20100 | Inventory — Infused Blunt | Inventory |
| 20120 | Inventory — Cartridge | Inventory |
| 20130 | Inventory — Disposable Cartridge | Inventory |
| 20140 | Inventory — Concentrate | Inventory |
| 20150 | Inventory — RSO | Inventory |
| 20160 | Inventory — Edible (Solid) | Inventory |
| 20170 | Inventory — Edible (Liquid) | Inventory |
| 20180 | Inventory — Tincture | Inventory |
| 20190 | Inventory — Topical | Inventory |
| 20200 | Inventory — Accessories | Inventory |
| 20210 | Inventory — Paraphernalia | Inventory |
| 20220 | Inventory — Greenway Merch | Inventory |
| 20800 | Inventory — In Transit | Inventory |
| 20810 | Inventory Shrink / Waste Reserve | Inventory |
| 20890 | Inventory — UNCLASSIFIED (quarantine) | Inventory |
| 21000 | Property, Plant & Equipment | Fixed assets |
| 21100 | Land | Fixed assets |
| 21200 | Land Improvements | Fixed assets |
| 21300 | Buildings | Fixed assets |
| 21400 | Building Improvements | Fixed assets |
| 21500 | Leasehold Improvements | Fixed assets |
| 21600 | Furniture, Fixtures & Equipment | Fixed assets |
| 21700 | Vehicles | Fixed assets |
| 21800 | Construction in Progress | Fixed assets |
| 21900 | Accumulated Depreciation | Fixed assets |
| 30000 | Accounts Payable | Liabilities |
| 31000 | Accrued Payroll | Liabilities |
| 31100 | Payroll Taxes Payable — Employee Withheld | Liabilities |
| 31200 | Payroll Taxes Payable — Employer | Liabilities |
| 31300 | Garnishments & Child Support Payable | Liabilities |
| 32000 | Cannabis Excise Tax Payable (37%) — TRUST | Liabilities |
| 32100 | Retail Sales Tax Payable — TRUST | Liabilities |
| 32200 | B&O Tax Payable | Liabilities |
| 33000 | Credit Cards Payable | Liabilities |
| 34000 | Notes & Loans Payable | Liabilities |
| 35000 | Accrued Liabilities | Liabilities |
| 36000 | Due To / From Related Entity | Liabilities |
| 40000 | Owner Equity | Equity |
| 40100 | Common Stock / Members Capital | Equity |
| 40200 | Additional Paid-In Capital | Equity |
| 40300 | Retained Earnings | Equity |
| 40400 | Opening Balance Equity | Equity |
| 41000 | Shareholder Distributions | Equity |
| 41100 | Shareholder Contributions | Equity |
| 50000 | Sales — Cannabis | Revenue |
| 50010 | Sales — Flower | Revenue |
| 50020 | Sales — Popcorn Bud | Revenue |
| 50030 | Sales — Infused Flower | Revenue |
| 50040 | Sales — Trim | Revenue |
| 50050 | Sales — Preroll | Revenue |
| 50060 | Sales — Preroll Pack | Revenue |
| 50070 | Sales — Blunt | Revenue |
| 50080 | Sales — Infused Preroll | Revenue |
| 50090 | Sales — Infused Preroll Pack | Revenue |
| 50100 | Sales — Infused Blunt | Revenue |
| 50120 | Sales — Cartridge | Revenue |
| 50130 | Sales — Disposable Cartridge | Revenue |
| 50140 | Sales — Concentrate | Revenue |
| 50150 | Sales — RSO | Revenue |
| 50160 | Sales — Edible (Solid) | Revenue |
| 50170 | Sales — Edible (Liquid) | Revenue |
| 50180 | Sales — Tincture | Revenue |
| 50190 | Sales — Topical | Revenue |
| 50200 | Sales — Accessories | Revenue |
| 50210 | Sales — Paraphernalia | Revenue |
| 50220 | Sales — Greenway Merch | Revenue |
| 50900 | Discounts & Comps | Revenue |
| 50910 | Returns & Refunds | Revenue |
| 50920 | Cash Over / (Short) | Revenue |
| 51000 | ATM Surcharge Income | Revenue |
| 52000 | Rental Income | Revenue |
| 60000 | COGS — Cannabis | COGS |
| 60010 | COGS — Flower | COGS |
| 60020 | COGS — Popcorn Bud | COGS |
| 60030 | COGS — Infused Flower | COGS |
| 60040 | COGS — Trim | COGS |
| 60050 | COGS — Preroll | COGS |
| 60060 | COGS — Preroll Pack | COGS |
| 60070 | COGS — Blunt | COGS |
| 60080 | COGS — Infused Preroll | COGS |
| 60090 | COGS — Infused Preroll Pack | COGS |
| 60100 | COGS — Infused Blunt | COGS |
| 60120 | COGS — Cartridge | COGS |
| 60130 | COGS — Disposable Cartridge | COGS |
| 60140 | COGS — Concentrate | COGS |
| 60150 | COGS — RSO | COGS |
| 60160 | COGS — Edible (Solid) | COGS |
| 60170 | COGS — Edible (Liquid) | COGS |
| 60180 | COGS — Tincture | COGS |
| 60190 | COGS — Topical | COGS |
| 60200 | COGS — Accessories | COGS |
| 60210 | COGS — Paraphernalia | COGS |
| 60220 | COGS — Greenway Merch | COGS |
| 60800 | Freight-In / Inbound Delivery | COGS |
| 60810 | Inventory Shrink & Destruction | COGS |
| 60900 | Purchase Discounts Received | COGS |
| 61000 | Payroll — Inventory Handling (allocable) | COGS |
| 70000 | Occupancy | Operating expense |
| 70010 | Rent | Operating expense |
| 70020 | Utilities | Operating expense |
| 70030 | Repairs & Maintenance | Operating expense |
| 70040 | Property Tax | Operating expense |
| 70050 | Security & Alarm | Operating expense |
| 70060 | Janitorial & Waste Removal | Operating expense |
| 71000 | Personnel | Operating expense |
| 71010 | Wages & Salaries | Operating expense |
| 71020 | Overtime | Operating expense |
| 71030 | Paid Sick & Leave | Operating expense |
| 71040 | Employer Payroll Taxes | Operating expense |
| 71050 | L&I / Workers Compensation | Operating expense |
| 71060 | PFML & WA Cares | Operating expense |
| 71070 | Employee Benefits & Insurance | Operating expense |
| 71080 | Payroll Service Fees | Operating expense |
| 72000 | Selling & Marketing | Operating expense |
| 72010 | Advertising & Promotion | Operating expense |
| 72020 | Menu & Website Listings | Operating expense |
| 72030 | Customer Loyalty & Comps | Operating expense |
| 73000 | Technology | Operating expense |
| 73010 | Software Subscriptions | Operating expense |
| 73020 | POS & Traceability Systems | Operating expense |
| 73030 | Hardware & Equipment | Operating expense |
| 73040 | Internet & Telephone | Operating expense |
| 74000 | Professional Services | Operating expense |
| 74010 | Accounting & Bookkeeping | Operating expense |
| 74020 | Legal | Operating expense |
| 74030 | Consulting & Advisory | Operating expense |
| 75000 | Compliance & Licensing | Operating expense |
| 75010 | Licences & Permits | Operating expense |
| 75020 | Product Testing | Operating expense |
| 75030 | Background Checks & Fingerprinting | Operating expense |
| 75040 | B&O Tax Expense | Operating expense |
| 75050 | Regulatory Fines & Penalties | Operating expense |
| 76000 | Office & Administration | Operating expense |
| 76010 | Office Supplies | Operating expense |
| 76020 | Packaging & Store Supplies | Operating expense |
| 76030 | Postage & Shipping (outbound) | Operating expense |
| 76040 | Bank Fees | Operating expense |
| 76050 | Merchant & Payment Processing Fees | Operating expense |
| 76060 | Insurance | Operating expense |
| 76070 | Dues & Subscriptions | Operating expense |
| 77000 | Vehicle & Travel | Operating expense |
| 77010 | Fuel | Operating expense |
| 77020 | Vehicle Maintenance & Repair | Operating expense |
| 77030 | Travel | Operating expense |
| 77040 | Meals | Operating expense |
| 78000 | Depreciation & Amortization | Operating expense |
| 78010 | Depreciation Expense | Operating expense |
| 78020 | Amortization Expense | Operating expense |
| 79000 | Personal — Living Expenses | Personal (personal entity) |
| 79010 | Personal — Housing & Utilities | Personal (personal entity) |
| 79020 | Personal — Groceries | Personal (personal entity) |
| 79030 | Personal — Restaurants & Coffee | Personal (personal entity) |
| 79040 | Personal — Medical & Health | Personal (personal entity) |
| 79050 | Personal — Insurance | Personal (personal entity) |
| 79060 | Personal — Vehicle & Fuel | Personal (personal entity) |
| 79070 | Personal — Childcare & Family | Personal (personal entity) |
| 79080 | Personal — Pets | Personal (personal entity) |
| 79090 | Personal — Entertainment & Travel | Personal (personal entity) |
| 79100 | Personal — Clothing & Personal Care | Personal (personal entity) |
| 79110 | Personal — Gifts & Charity | Personal (personal entity) |
| 79120 | Personal — Fees & Interest | Personal (personal entity) |
| 79900 | Personal — Uncategorized (review) | Personal (personal entity) |
| 80000 | Other Income | Other income |
| 80010 | Interest Income | Other income |
| 80020 | Dividend Income | Other income |
| 80030 | Realized Investment Gain / (Loss) | Other income |
| 80040 | Unrealized Investment Gain / (Loss) | Other income |
| 80050 | Gain / (Loss) on Asset Disposal | Other income |
| 85000 | Other Expense | Other expense |
| 85010 | Interest Expense | Other expense |
| 85020 | Theft & Casualty Loss | Other expense |
| 85030 | Bad Debt Expense | Other expense |
