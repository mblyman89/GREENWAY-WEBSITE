# How WA Cannabis Analytics Firms Source Their Data (verified research)

Date: research session. All facts below are from primary/authoritative sources, quoted.

## The company: Your Weed Data (yourweeddata.com)
- Founder: Joseph Holmesmeyer ("Franz Joseph"), "Chief Insight Officer."
- Built/operated by **Alma Analytics** (alma-analytics.com), "a team of cannabis data experts."
- Platform is built on **Looker Studio** (Google) dashboards (per Medium article tags: "Looker Studio", "Analytics Engineering").
- Free 30-day trial, promo "PIONEER". It is a **paid subscription** analytics product.

## THE KEY ANSWER — how they get product/brand/vendor/category trends
Direct quote from the founder's launch article (medium.com/your-weed-data, 2025-05-13):

> "We've taken Washington's **full traceability dataset** — **four years of transactional sales, inventory movement, lab testing, and licensee-to-licensee transfers** — and turned it into a powerful, intuitive analytics platform. **No POS data. No third-party integrations. Just the source-of-truth from the state**, cleaned and compiled into a self-service dashboard."

And:

> "Washington's cannabis market is one of the most tightly monitored in the country. **Every licensee is required to report detailed data each month: inventory changes, product transfers, sales transactions, lab results.** This system captures a complete picture of the industry's activity. But accessing that picture? That's the hard part."

They advertise these capabilities (all derived from that one dataset):
- Benchmark your performance against every licensee in the state
- Monitor pricing trends and category sales across regions
- Understand who's selling to whom and how product flows through the supply chain (licensee-to-licensee transfers)
- Compare lab results (testing frequency, THC/CBD ranges)
- Download clean, export-ready data

## THE MECHANISM — CCRS + Public Records Act
1. **CCRS = Cannabis Central Reporting System** (lcb.wa.gov/ccrs). The state's traceability
   platform (replaced Leaf Data Systems). Every WA producer, processor, and retailer is
   legally required to report **monthly**: inventory, product transfers (manifests),
   **sales transactions**, and lab results.
2. This full dataset is obtainable from the WSLCB via the **Public Records Act (RCW 42.56)**.
   Academics have done exactly this — e.g. peer-reviewed studies analyzing "30 million cannabis
   sales in Washington State" (Firth et al.; UW ADAI) all cite WSLCB traceability data obtained
   via records request.
3. So analytics firms (Your Weed Data / Alma Analytics, and historically Headset/BDSA for
   parts) obtain the **raw CCRS extract** (often as very large CSV/flat files) via a public
   records request, then clean/model it and publish dashboards.

## THE LEGAL CAVEAT (must be respected)
On lcb.wa.gov/records/frequently-requested-lists, verbatim at top of page:

> "*Note: Per RCW 42.56.070(8), records received through the Public Records Act may not be used for commercial purposes.*"

- This is the same caveat noted in our migration 0078 seed for the WSLCB source.
- The owner has stated their WSLCB **enforcement officer confirmed retailer sourcing/benchmarking use is acceptable practice for a retailer**. Analytics firms operate commercially on this data (a paid product), which indicates the practical interpretation in the industry is broader than a literal reading — but **we should keep this documented and keep the feature removable / owner-controlled** per standing rules.

## WHAT THE WSLCB ALREADY PUBLISHES FOR FREE (no records request needed)
From lcb.wa.gov/records/frequently-requested-lists (verified live):
- **Cannabis License Applicants** xlsx (applicants + issued licenses) — used for vendor leads.
- **Medically Endorsed Stores** xls.
- **Approved Infused Products List** xlsx.
- **Approved Testing Labs** xlsx.
- **Cannabis Enforcement Visits / Violations / Compliance Checks** xlsx (monthly).
- **Cannabis Sales Activity by License Number** (older, thru 2017).
- **Sales & Excise Tax by County** FY2015–FY2025 xlsx (aggregate, county-level — NOT product/brand).
- **Local Government Distributions** xlsx.
- WSLCB **Research Dashboards** (lcb.wa.gov/research/dashboards) — aggregate public dashboards.

### What is NOT free / requires a records request:
- The **transaction-level CCRS extract** (per-product, per-brand, per-licensee sales, transfers,
  lab results). This is the "full traceability dataset" the analytics firms buy access to or
  request. It is NOT available as a live API. It comes as large flat files via a formal
  Public Records Request through the WSLCB portal (portal.lcb.wa.gov / lcbwa.govqa.us).

## IMPLICATIONS FOR GREENWAY'S BUILD
- There is **no free live API** for product/brand-level WA sales trends. The analytics firms'
  "secret" is simply: **request the raw CCRS files under the PRA, then model them.**
- Options for Greenway:
  A. **Subscribe** to Your Weed Data / Headset for market benchmarks (fastest, paid, external).
  B. **Submit our own WSLCB Public Records Request** for the CCRS extract, ingest the flat
     files into Supabase, and build our OWN benchmark/leads engine (free data, more work,
     periodic manual refresh — matches "no web crawler / direct way").
  C. **Compute benchmarks from our OWN verified POS/PO/inventory data** (always allowed, no
     legal caveat, but only reflects our own store — good for internal turn-rate/margin
     targets, not statewide market share).
- The honest, standing-rules-compliant design: build the ingestion pipeline for the CCRS
  flat-file extract (option B) as the market-benchmark source, keep option C for internal
  targets, and never fabricate market prices.
