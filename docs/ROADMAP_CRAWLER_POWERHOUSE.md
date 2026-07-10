# Roadmap — Crawler Powerhouse Upgrade (full-site deep crawl + image-context intelligence)

> Standing rules honored throughout: request recorded VERBATIM; never guess —
> every finding below was verified by reading the actual code; ONE slice per PR;
> crawler output is DRAFTS ONLY (the owner validates and tosses the junk);
> no migrations expected for this work (crawler writes to existing
> `ai_suggestions` / `kb_products` draft tables only).

## Owner's request (verbatim)

> "thank you. the next thing I need you to help me with is the web crawler
> again. it is working well, but it has a long way to go before it is
> acceptable. it does a great job with one or two pages, but it never goes
> through the full site, scraping each and ever page, the sub pages, etc.
> after viewing several of my vendors sites, they are intricate and complex
> and full of useful info that the crawler is failing to get. a lot of the
> product pictures, nearly all of them really, have their descriptions outside
> of the image, in plain text on the page either next to the image or below
> it. the crawler needs to be smarter. it needs to grab an image and realize
> there is text to be scraped right next to the image that is very relevant.
> my vendors pages have many pages with many products and such. I don't mind
> if the crawler takes several minutes to crawl a vendor site, I want it to
> take its time and get everything and somehow validate that it has gotten
> everything. I know we can make this thing smarter and more capable, it needs
> to be much more powerful. please do some deep research on the crawl4ai repo
> again and try and add as much complex super expert level professional logic
> in this thing so it really does what it is suppose to do. crawl around the
> whole site clicking everything, looking at everything and scraping
> everything. I can validate the results and toss the junk. just make it
> better, stronger, smarter, all around power house of a machine."

Distilled requirements:
1. **Full-site crawl** — every page and sub-page, not just 1–2 pages.
2. **Image ↔ adjacent-text intelligence** — product descriptions live in plain
   text NEXT TO or BELOW the image; the crawler must pair them.
3. **Slow and thorough is fine** — several minutes per vendor site is OK.
4. **Completeness validation** — the crawler must somehow verify it got
   everything and report it.
5. **Click everything** — dynamic content (load-more, scroll-loaded galleries,
   pagination) must be captured.
6. **Deep research on the crawl4ai repo** — use its expert-level features.
7. **Drafts-only preserved** — owner validates results and tosses junk.

## Verified findings (read from the real code this session)

### Why it "never goes through the full site" (the root cause, verified)

`crawler/app/pipeline.py::research_target` discovers extra pages **only from
the ENTRY page**: it calls `discover_nav_links(fetched.html, …)` once on the
first page's HTML, `discover_sitemap_urls` once, and `seed_site_urls` once,
builds ONE queue, and then fetches those URLs in a flat loop. **Links found on
sub-pages are never followed.** A vendor site whose homepage links to
`/products/` which links to 40 individual product pages will never reach those
40 pages — exactly the owner's complaint ("great job with one or two pages …
never goes through the full site"). Additionally the default budget is
`CRAWL_MAX_PAGES=5`.

### Why image descriptions are lost (verified)

`crawler/app/css_extract.py` collects images as `(url, alt)` pairs only. The
`research_images` reference draft in `pipeline.py` renders each line as
`"{alt or '(no alt text)'} — {url}"`. Vendor sites put product names +
descriptions in **text near the image** (card title, `<figcaption>`, sibling
paragraph) — none of which is captured, so most harvested images arrive as
`(no alt text) — https://…` and the reviewer has no idea what they are.

### Why dynamic content is missed (verified)

`crawler/app/fetcher.py::_fetch_with_crawl4ai` calls `crawler.arun(url,
word_count_threshold=10, bypass_cache=True)` with **no js_code, no
scan_full_page, no wait_for, no session reuse**. Lazy galleries that populate
on scroll and "Load more" buttons are never triggered (the lazy-attr reading in
`image_urls.py` recovers `data-src` images present in the initial HTML, but
content injected by JS after scroll/click is simply absent).

### No completeness signal exists (verified)

`ResearchResult` carries `pages` (list of URLs read) but nothing records what
was DISCOVERED and not crawled, what was skipped and why, or whether content
had saturated. The owner cannot see whether a crawl was complete.

### Existing architecture (kept)

- Python worker in `crawler/` (FastAPI, port 8200). Pipeline:
  fetch (robots/SSRF/allow-list/rate-limit/cache) → CSS-first extraction →
  LLM gap-fill (temp≈0) → verify-against-source → WA I-502 compliance scan →
  pending drafts in `ai_suggestions` (`source=crawl:<url>`).
- Batch layer `harvest.py` (jobs, crash-safe, one at a time,
  `max_pages_per_site` ≤ 50 hard cap).
- Next.js consumes via `src/lib/ai/crawler-client.ts`; review UIs parse
  `research_images` lines with `parseImageLines` in
  `src/components/admin/ai/HarvestImagePicker.tsx` (`caption — url` format —
  richer captions flow through UNCHANGED).
- 159 pytest tests in `crawler/tests/` (run locally; CI runs the TS compliance
  harness only). All passing at start of this work.

### crawl4ai deep research (docs.crawl4ai.com v0.9.x, researched this session)

- **Deep crawl strategies** (`crawl4ai.deep_crawling`): `BFSDeepCrawlStrategy`,
  `DFSDeepCrawlStrategy`, `BestFirstCrawlingStrategy` with `max_depth`,
  `max_pages`, `score_threshold`, `url_scorer=KeywordRelevanceScorer`,
  `filter_chain=FilterChain([DomainFilter, URLPatternFilter,
  ContentTypeFilter, SEOFilter, ContentRelevanceFilter])`, batch or
  `stream=True`. Depth/score arrive in `result.metadata`.
- **Adaptive crawling** (`AdaptiveCrawler.digest(start_url, query)`): stops on
  a three-metric sufficiency signal — **coverage / consistency / saturation**
  → a confidence score. This is the model for the owner's "validate that it
  has gotten everything" (we implement the same saturation math ourselves so
  it also works on the httpx fallback path — see C4).
- **Media context**: `result.media["images"]` items carry `src`, `alt`,
  `desc` (nearby text) and `score` — crawl4ai itself pairs images with
  surrounding text; we mirror that with a pure, unit-testable DOM-proximity
  extractor that works on RAW HTML from either fetch path (C1).
- **Page interaction**: `CrawlerRunConfig(js_code=…, wait_for="css:…"/"js:…",
  scan_full_page=True, scroll_delay=…, session_id=… + js_only=True,
  remove_overlay_elements=True, process_iframes=True, wait_for_images=True,
  delay_before_return_html=…)`; `VirtualScrollConfig` for feeds that REPLACE
  content while scrolling.
- **Version note**: `requirements.txt` pins `crawl4ai>=0.4.0,<0.10.0`. Every
  crawl4ai-specific feature must soft-degrade (try/except import + kwargs
  filtering) exactly like `seeding.py` does — a plain `arun(url)` must always
  remain the fallback. The httpx path (no browser) must keep working too.

## Design (drafts-only, politeness preserved everywhere)

Every new fetch goes through the EXISTING `fetch_page` gate (SSRF guard,
allow-list, robots.txt, per-domain delay, cache, retries). Nothing in this
upgrade adds a new write path — richer data lands in the SAME
`ai_suggestions` reference drafts the owner already reviews.

1. **Image-context intelligence** (`page_intelligence.py`, pure): for every
   real image (via the existing `best_image_url` selector) walk the DOM for
   its best description: `figcaption` → card-ancestor heading + text (a small
   ancestor containing exactly this image, e.g. a product card `div`/`li`) →
   nearest following/preceding sibling text → `alt`/`title`/`aria-label` →
   JSON-LD Product (image URL matched to `name` + `description`). Emit
   `ImageContext{url, alt, caption, heading, nearby_text, source}` and format
   `research_images` lines as `"{best context} — {url}"` (parser-compatible).
2. **Full-site frontier crawl** (`pipeline.py` rework): a proper crawl
   frontier — every fetched page's same-site links are discovered, scored
   (`page_interest_score` + pagination bonus), deduped
   (trailing-slash/fragment/query-insensitive) and enqueued until the page
   budget is exhausted. Pagination links (`rel=next`, `?page=N`, `/page/N/`)
   get a priority bonus so catalogs are walked to the end. Budget default
   raised (env `CRAWL_MAX_PAGES` default 5 → 25; harvest cap 50 → 120;
   several minutes per site is explicitly OK per the owner).
3. **Dynamic-content interaction** (`fetcher.py`): the crawl4ai path gains
   full-page scan/scrolling, lazy-image settling, overlay removal and
   best-effort "load more" clicking via `js_code` — all keyword-filtered
   against the installed crawl4ai's `CrawlerRunConfig` signature so any
   version from 0.4 onward still works, and any error falls back to the plain
   `arun` → httpx ladder that exists today.
4. **Completeness validation** (`coverage.py`, pure): accounting of
   discovered vs crawled vs skipped (with reasons: budget / robots / failed /
   boring / off-site) + a saturation signal (per-page new-content ratio over
   the crawl, adaptive-crawling style). Produces a human-readable
   `research_coverage` reference draft (drafts-only) + structured numbers on
   the API response and harvest job state, so the owner can SEE "got
   everything" vs "budget ran out at 25/63 discovered pages — raise the
   budget".
5. **Next.js surface**: label + lane for `research_coverage`, show coverage
   summary in the research UI, env-reference doc rows for the new knobs.

## Slice plan (one PR each)

- [x] **C1 (PR #356) — Image↔adjacent-text intelligence (pure core + wiring).**
      `crawler/app/page_intelligence.py` + tests; `css_extract.py` and
      `pipeline.py` emit context-rich `research_images` lines.
- [x] **C2 (PR #357) — Full-site frontier deep crawl.** Recursive same-site frontier in
      `pipeline.py` (links from EVERY fetched page); pagination-aware scoring
      landed in the new `crawler/app/frontier.py` (not `discovery.py` as
      originally sketched); budget defaults raised, tests.
- [x] **C3 (PR #358) — Dynamic-content capture.** `fetcher.py` crawl4ai config upgrade:
      scan_full_page/scroll, wait_for_images, overlay removal, load-more
      clicking; signature-filtered kwargs; safe fallback ladder; tests.
- [x] **C4 (PR #359) — Completeness validation + coverage report.**
      `crawler/app/coverage.py` (pure) + `research_coverage` reference draft +
      coverage in API response + harvest target state; tests.
- [x] **C5 (this PR) — Back-office surface.** `research_coverage` label/lane, coverage
      display on vendor/brand research results + harvest review, env
      reference rows, crawler README update.

## Non-goals / unchanged

- No scraping behind logins, no ToS-protected marketplaces (Leafly/Weedmaps),
  no CAPTCHA evasion — same stance as `docs/RESEARCH_CRAWL4AI_DISCOVERY.md`.
- Robots.txt, SSRF guard, allow-list, per-domain rate limit: untouched gates
  on every single fetch, including every new frontier fetch.
- Drafts-only: everything lands as pending `ai_suggestions` rows for human
  review. Nothing auto-publishes.
