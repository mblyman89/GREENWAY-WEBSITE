# D219 — Harvest crawler: hardening and "unleash" plan (proposal, read-only round)

## Phase 0: unstick it (no code needed)
- Restart the crawler service on Railway. The dead Chromium and the held lock both live in memory, so a restart clears them.
- Do not start a new harvest until Phase 1 ships.

## Phase 1: harden (stops the 20-hour hang)
1. One long-lived browser per worker, not one per page.
   - Health-check it.
   - Recycle it every N pages, and immediately after any "Target crashed" / "Browser closed".
   - Chromium flags: --disable-dev-shm-usage, --no-sandbox, --disable-gpu, --js-flags=--max-old-space-size.
2. Time limits everywhere:
   - browser start: 45 s
   - page: 90 s hard
   - site run (a slice): 25 min
   - LLM call: 60 s
   A timeout fails that page or slice and moves on. It never hangs the job.
3. Cancel takes effect mid-site (it cancels the running task).
4. A watchdog: a job with no progress for 10 minutes is marked stalled. The stalled site is retried once, then skipped with a reason.
5. Blocking calls (LLM, robots, httpx, sleep) move off the event loop, so /health and status polls stay fast.
6. Durable state: job, frontier and resume state go into Supabase tables (or onto a Railway volume) instead of /tmp, and auto-resume after a restart or redeploy.
7. Logs go to stdout, crawl4ai runs with verbose off, and each page gets one structured line.

## Phase 2: thorough, crawl until complete
- A "campaign" is a list of sites run in slices.
  - Each slice reads up to about 60 pages, saves the frontier, and requeues the site at the back of the line.
  - A site keeps getting slices until its frontier is empty AND the content is saturated, with a ceiling of about 1,500 pages and duplicate URLs collapsed.
- A false "COMPLETE" (fewer than 5 pages, or 0 links) triggers a second strategy:
  - full JavaScript render with the age-gate click
  - sitemap.xml and the platform APIs (Shopify /products.json, WordPress /wp-json, Wix/Squarespace sitemaps)
  - only then is the site marked "thin site — needs a human"
- Every image, not just 80:
  - Store each image URL per page with its alt text and caption in a per-site table, with no cap.
  - The LLM picks the best ones for drafts, but the full list is kept.
- Per-page extraction, not one 28k-character blob:
  - Each product page gets its own small LLM call (gpt-4o-mini) and becomes a kb_products draft.
  - Brand-level synthesis runs at the end over per-page summaries.

## Phase 3: find the missing websites (77 vendors)
- A "Find websites" step uses a search-grounded model: OpenAI web search (gpt-4o-search-preview / Responses web_search) or Gemini with Google Search grounding.
- Input: legal name + brands + license # + city.
- Every candidate is verified by fetching it, checking that the brand or legal name appears on the page, checking the WA/LCB license number where shown, and rejecting marketplaces (Leafly/Weedmaps/Jane, the existing deny-list).
- Results land as pending suggestions with a confidence score. High-confidence matches can be applied with one click.
- Expected cost: about $0.01–0.03 per vendor, under $3 total.
- CRAWL_ALLOW_DOMAINS must be updated automatically from the approved websites, or production will refuse them.

## Phase 4: one button, server-side, runs to the end
- "Harvest all current vendors" means the 107 vendors with stock on hand, with duplicate vendor rows that share a site merged into one target.
- The worker loops slices on its own until every site is complete or flagged.
- The console shows per site: pages read, pages left, images, products, status, last error.
- When it finishes, it sends a summary to the console and optionally an email.

## Speed estimate
- Per page: about 6–9 s fetch plus a 2 s polite delay per domain.
- Run 3–4 different sites in parallel (politeness is per domain, so this is safe). This needs about 2–4 GB of memory on Railway.
- Assume about 100 sites x about 80 pages each, roughly 8,000 pages:
  - 4 at a time: about 6–8 hours
  - 1 at a time: about 24 hours
- LLM cost on gpt-4o-mini: a few dollars.

## Order of work
Phase 0 now, then D220 = Phase 1 + 4 (safe unattended loop), D221 = Phase 3 (websites), D222 = Phase 2 depth and per-page extraction.
