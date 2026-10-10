# R37 - Product Onboarding gets smarter (roadmap + task list)

Branch `r37-onboarding-smarter` from main `ecc067fb` (R36 merged).
Standing rules: never guess / never assume, test it and test the tests,
commit + push after every task (the sandbox is unstable), no drift.

## Owner request (scope, in his order)
1. Edibles + liquids: fill serving facts automatically from the WA 10 mg THC
   per-serving rule (100 mg THC => 10 servings). Other cannabinoids have no
   per-serving cap. "There shouldn't be any product the system can't figure
   out on its own."
2. Facts volume field: choose **ml** or **fl oz**, with the standard
   conversion shown so nobody has to google it.
3. Remove the "Approve all N priced" button from Product Onboarding.
4. A button at the top of the page (AI lookup section) to re-run LlamaParse
   and re-read the delivery's COAs.
5. A Brand field at the top (AI section) that sets the brand for the whole
   manifest, or per product row; updates the vendor record; auto-filled for
   the next manifest from that vendor; flows to enrichment, the inventory
   table, the menu, the customer product cards and Leafly.
6. "Search all products with Gemini" knows past searches for the invoice's
   products: which products, when, what was found - BEFORE re-running; a
   clearer, more obvious bar; recommended while facts are still missing.

## Survey facts (verified in code / on Postgres, R37 day 1)
- Facts panel: `src/app/admin/inventory/drafts/ProductFactsPanel.tsx` -> saved
  by `resolveIntakeFactReview` (owner record in `pos_fact_reviews`); `Net
  volume (ml)` is a single text field `netVolumeMl`.
- COA serving facts: `deriveCoaDraftFacts` (coa-facts-core.ts) takes the
  servings count ONLY from the product name (`extractNameFacts`); with no
  count in the name it gives no package totals.
- WA constants: `serving-limit-warning-core.ts` (WA_SERVING_MAX_THC_MG = 10,
  WA_PACKAGE_MAX_THC_MG = 100, SERVING_LIMIT_CATEGORIES).
- Approve-all: page.tsx S17 block (`approveAllPricedAction`).
- COA re-read exists per lot only (`rereadLotCoaAction` -> `extractCoaForLot`,
  forced LlamaParse, then lab attach + restage). Manifest version
  `extractCoasForManifest` skips already-read rows (force:false).
- Brand: `brands` (vendor_id link) + `brand_aliases`; `catalog_product_drafts.
  brand_id/brand_name`, `inventory_lots.brand_id`, `menu_items.brand_name`,
  `product_enrichments.brand_id`; WCIA transfers carry NO brand
  (intake-parser `brand_name: null`), so brand is empty for most deliveries.
  The identity key uses vendor first, brand only when vendor is blank.
  Card label = brand else vendor (card-brand-core); Leafly item `brand`.
- Lookup history sources: `ai_usage` (feature, entity_id, model, created_at),
  `product_fact_provenance` (identity_key, field, value, source, created_at),
  `lookup_job_items.result_json`, `ai_suggestions`; S09 recall
  (`recallForDraft`) already reads the KB ladder + provenance.

## Slices (one at a time, each: code -> tests -> mutation -> commit/push)
- [ ] **S1 Approve-all removed** (#3): button + form gone from the page; the
      action stays unreachable from the UI; pin test that it never renders.
- [ ] **S2 Serving facts derived** (#1): pure `serving-derive-core.ts`
      (package / per-serving / servings, any two give the third; package only
      -> servings = ceil(package / 10) at the WA cap; minors per serving =
      package / servings, no cap); sources: owner > COA > name > derived;
      every derived figure labelled with its arithmetic + the WAC rule; wired
      into the facts panel prefill, COA attach and the saved record.
- [x] **S3 Volume ml / fl oz** (#2): unit select, exact US fl oz = 29.5735295625
      ml (NIST HB44), stored canonically in ml, conversion line on the form.
- [x] **S4 Re-read COAs button** (#4): delivery-level, forced LlamaParse,
      budgeted, then lab attach + restage; audited; banner with counts.
- [x] **S5 Brand for the delivery / row** (#5): migration 0257 (vendor default
      brand + manifest brand), server actions, vendor page, flow to drafts,
      lots, enrichment, menu, cards, Leafly.
      DONE: delivery-brand-core (51 self-tests, pure decisions: find / adopt
      unlinked / create / refuse another vendor's brand; fill vs replace;
      vendor default fills ONLY label-less intake lines; prefill order
      delivery > vendor > single shared row brand). delivery-brand-store:
      complete paged reads (a partial read refuses), drafts + lots + R33
      propagateLotCorrections (published + staged cards, sibling-safe), memory
      on inbound_manifests.brand_id + vendors.default_brand_id (0257; before
      it, applied but "not remembered"). Vendor page "Remembered brand" form.
      Tests: r37-delivery-brand.test.ts (23, real store over a strict fake
      DB), PG check for 0257, SQL mutants 9/9, store/core mutants 14/14.
- [x] **S6 Lookup history + clearer Search-all bar** (#6). DONE.
  The bar is now titled "Search the web for every product on this delivery -
  Google Gemini with Google Search" (the engine is named from the configured
  model; it never claims Gemini when it is not), says what it is for, and
  shows a verdict before anything is paid for: "Recommended: run the search -
  N products have never been searched; M are still turning up new facts" /
  "Not worth paying for again yet ... try again after <date>" / "Nothing left
  to harvest". A product-by-product list says, for every product, how many
  times it was searched, when, where (this row / another row of this delivery
  / the SAME product on an earlier delivery, joined by the S03 identity key),
  what the last search did, which facts the web has given, and what is still
  missing. Each row's Facts cell carries a short chip ("searched 12 days ago
  - worth searching again"). Rule (Akeneo-style completeness + a 90-day
  re-enrichment cadence): search until every web-fillable fact (strain type,
  description, short line, effects, aroma, flavor, terpenes) is on file; a
  search that still yields is worth repeating; one that found nothing new is
  not worth repeating for 90 days. "Search again" queues a FRESH web search
  (the row panel's Refresh: no memory short-cut, no already-known block) for
  only the recommended products an earlier batch on this delivery already
  did, still one active job per delivery. Files: lookup-history-core.ts (pure,
  67 assertions), lookup-history-server.ts (paged, chunked, checked reads;
  missing tables = no history; outage = said on screen), lookup-job-server.ts
  (againDraftIds + the marker + refresh), actions.ts lookupAgainAction,
  drafts/page.tsx. Tests: r37-search-history.test.ts (19, real postgrest-js),
  33/33 mutants killed.
- [ ] **S7 Wrap-up**: full suite, tsc, eslint, PG, TEST-PLAN, bible, PR,
      merge, report.
