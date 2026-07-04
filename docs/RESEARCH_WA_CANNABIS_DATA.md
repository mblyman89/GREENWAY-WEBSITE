# Research — WA Cannabis Public Data (verified for Discovery automation)

All items below were verified live during research (endpoints hit, columns and
sample rows inspected). This is the source of truth the automation is built on.
Owner's WSLCB enforcement officer confirmed a retailer using LCB public
licensee data for its own sourcing/benchmarking is acceptable practice.

## 1. WA LCB — Cannabis Renewal (SODA/Socrata) — PRIMARY vendor feed
- Landing: https://data.wa.gov/d/brpd-b6zd
- SODA JSON: `https://data.wa.gov/resource/brpd-b6zd.json`
- Bulk CSV: `https://data.wa.gov/api/views/brpd-b6zd/rows.csv?accessType=DOWNLOAD`
- Verified columns:
  `license, ubi, designatedsignee, countycode, countyname, citycode, cityname,
   dayphone, l_a_type, tradename, streetaddress, roomnumber, city, state,
   zipcode, mailaddress, mailcity, mailstate, mailzip, privdesc01..privdesc08,
   applicants, renewaldate, location{latitude,longitude}`
- Verified `privdesc01` breakdown (total 384 rows):
  Cannabis Producer Tier 2 (94), Producer Tier 3 (79), Retailer (66),
  Processor (47), (blank 36), Medical Cannabis Endorsement (30),
  Producer Tier 1 (26), Transportation (4), Social Equity Retailer (2).
- SODA supports `$select,$where,$group,$order,$limit,$offset`. Example
  (producers/processors only):
  `...brpd-b6zd.json?$where=upper(privdesc01) like 'CANNABIS PRODUCER%25' OR upper(privdesc01) like 'CANNABIS PROCESSOR%25'&$limit=1000`
- Optional higher rate limit via header `X-App-Token: <token>` (env only).
- Caveat: this is the renewal-notification slice (businesses up for renewal),
  not the full active-licensee universe — still a real, fresh, filterable feed.

## 2. WA LCB — Local Authority Letters (SODA) — NEW-applicant feed
- SODA JSON: `https://data.wa.gov/resource/vgcw-qfjm.json`
- Adds `applicationdate, l_a_type` (NEW LICENSE APPLICATION, ASSUMPTION OF A
  LICENSE, CHANGE OF LOCATION/GOVERNING PEOPLE), `licenseename`, same privdesc.
- Lower volume but the freshest "brand-new prospect" signal.

## 3. WSLCB "Cannabis License Applicants" (xlsx) — MOST COMPLETE roster
- Page: https://lcb.wa.gov/records/frequently-requested-lists (auto-downloads)
- Verified file `CannabisApplicants06302026.xlsx`: sheets `Retailers`,
  `SE Retailers`; columns `Tradename, License, UBI, Street Address, Suite Rm,
  City, State, county, Zip Code, Priv Desc, Privilege Status, Day Phone`.
  Current month's export is retailers-only; keep as the CSV/manual import path
  (already shipped in PR #240).
- LEGAL NOTE printed on the page: "Per RCW 42.56.070(8), records received
  through the Public Records Act may not be used for commercial purposes."
  The SODA open-data feeds (§1–2) are the open-data distribution and are what
  we automate; the officer approved retailer use for sourcing/benchmarking.

## 4. What does NOT exist for free (so we don't fabricate it)
- No free WA per-product **wholesale price** API. Market-price products
  (Headset, LeafLink, BDSA) are paid. Therefore benchmarks are computed from
  **our own** POS sales, PO unit costs, and inventory — never invented.
- The `data.wa.gov` catalog has only 2 cannabis licensing datasets (Renewal,
  Local Authority Letters). Similarly-named `data.ct.gov` datasets
  (Cannabis Product Registry, Retail Sales by Month/Product Type) are
  **Connecticut**, not WA — explicitly excluded.

## 5. Benchmark inputs (our verified internal data)
- POS sales velocity + retail price (existing purchasing reorder store).
- Purchase-order unit costs (minor units) from `purchase_orders` (0048).
- On-hand inventory + category/brand taxonomy from the catalog.
- Category turn-rate guidance already documented in
  `docs/RESEARCH_CANNABIS_PURCHASING.md` (industry ranges, labeled as guidance).
