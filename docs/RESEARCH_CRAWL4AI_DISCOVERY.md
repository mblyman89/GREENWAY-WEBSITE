# Research — crawl4ai for Product & Vendor Discovery (feasibility)

> Owner's ask (verbatim): *"add to the list, the ability to unleash the crawl4ai
> web crawler on sources of data that tells us what products and vendors we
> should be pursuing to get into the store. I think there are sources out there
> that can make this happen. I want you to deep research this topic and report
> back to me with your findings and how feasible this concept is and how we can
> add it to the workflow."*
>
> Scope of THIS pass: **research only.** No crawler is built. This documents the
> tool, candidate data sources, legality/feasibility, and a proposed phased plan
> to fold discovery into the purchasing workflow. Standing rule: NEVER guess —
> everything below is sourced and dated (researched during this session).

---

## 1. What crawl4ai is (from the official docs)

Source: **docs.crawl4ai.com (v0.9.x)** and the GitHub repo `unclecode/crawl4ai`.

- **Open source, self-hostable.** Free, Apache-licensed, `pip install crawl4ai`
  or Docker. No forced API keys. Runs fully inside our own infra.
- **LLM-friendly output.** Its headline feature is turning any page into **clean
  Markdown** ideal for feeding an LLM — perfect for "read this vendor menu / trend
  page and extract the products."
- **Structured extraction** three ways: (1) **CSS/XPath** selectors (fast, free,
  no LLM), (2) **LLM-based extraction** against a schema (flexible, costs tokens),
  (3) schema auto-generation. So we can extract without an LLM where the page is
  regular, and fall back to LLM extraction where it's messy.
- **Real browser control.** Async (`AsyncWebCrawler.arun(url=...)`), JS execution,
  handles lazy-loading / infinite scroll, sessions, proxies, and stealth modes —
  necessary for JS-heavy menu sites.
- **Adaptive crawling.** Knows when it has gathered enough to answer a query
  (information-foraging) — keeps runs bounded and cheap.

**Verdict on the tool itself:** technically an excellent fit. It's the right kind
of crawler for "read a page → get structured product/vendor rows." The hard part
is **NOT the crawler — it's the data sources and their legality.**

---

## 2. Candidate data sources (what could tell us "what to stock")

Ranked by usefulness × legality. Legality is the deciding factor, not capability.

### Tier A — Authoritative & free, but with a legal caveat: **WSLCB public data**
Source: **lcb.wa.gov/records/frequently-requested-lists** and **lcb.wa.gov/ccrs**.

- **Cannabis License Applicants list** (Excel) — every licensed producer/processor
  and retailer in WA, with status. This is the definitive "who are the real
  vendors" list — exactly what we need to validate/expand our vendor roster.
- **Cannabis Approved Infused Products list**, **Approved Testing Labs**,
  **Medically Endorsed Stores**, sales/excise-tax-by-county datasets.
- **CCRS (Cannabis Central Reporting System)** — the state traceability system;
  aggregate/statistical outputs inform market size but unit-level data is not a
  public product catalog.

  ⚠️ **CRITICAL LEGAL CAVEAT (verified on the page):** the Frequently Requested
  Lists page states, *"Per RCW 42.56.070(8), records received through the Public
  Records Act may not be used for commercial purposes."* Using these lists to
  drive our commercial purchasing decisions may run afoul of that restriction.
  **Action before use:** confirm with counsel / the LCB which datasets are cleared
  for business use (the LCB separately publishes a *Licensee List* for tax
  reporting that is meant for business use). Do NOT assume — verify.

  Also: these are **static file downloads** (`.xlsx`/`.xls`), so they don't even
  need crawl4ai — a scheduled fetch + `csvkit`/spreadsheet parse is simpler and
  more robust. crawl4ai adds nothing for a direct file download.

### Tier B — Commercial market intelligence (the "right" paid path)
- **Headset Insights** (headset.io) and **BDSA** (bdsa.com): cannabis-specific
  market-intelligence platforms that sell exactly the signal the owner wants —
  category trends, top brands, best-selling SKUs, market share, by state/market.
  They offer **licensed data / APIs**. This is the legitimate, ToS-clean way to
  answer "what products and vendors should we pursue" with real demand data.
  crawl4ai is unnecessary here (use their API). Cost: paid subscription.

### Tier C — Consumer menu marketplaces (legally risky to scrape)
- **Leafly** and **Weedmaps**: huge public menus/brand pages that *look* scrapable.
  BUT both operate under **Master Services Agreements / Terms** (e.g. Leafly's
  "US Retail Master Service Agreement", Weedmaps' terms & privacy policy) that
  generally **prohibit automated scraping** and reserve the data. Scraping these
  at scale risks ToS violation, IP blocks, and legal exposure.
  ✅ Better route: their **official partner integrations/APIs** (Leafly and
  Weedmaps both court retailers). crawl4ai should NOT be pointed at them.

### Tier D — Wholesale B2B marketplaces & distributor menus
- WA wholesale/B2B platforms (e.g. Distru, Flourish, LeafLink-style marketplaces)
  publish live producer/processor menus to licensed buyers. These are the most
  *directly actionable* ("here's a product a real WA vendor is selling wholesale
  right now"), but access is **gated to logged-in licensed buyers** and governed
  by each platform's ToS. Route: use our account + any official API; crawling
  behind a login is both technically fragile and usually contractually barred.

### Tier E — Individual vendor / producer websites
- Some producers publish public brand/product pages. Low legal risk to read a
  handful of *public* pages politely (respect robots.txt, rate-limit), and this
  is where crawl4ai genuinely shines: point it at a known vendor's public
  catalog → get structured product rows to consider onboarding. Small scale,
  high signal, low risk.

---

## 3. Feasibility summary

| Dimension | Finding |
|-----------|---------|
| **Tool capability** | ✅ crawl4ai is more than capable (markdown + structured/LLM extraction, JS, adaptive). |
| **Self-host / cost** | ✅ Free & self-hostable; LLM-extraction adds token cost only where used. |
| **Best *data* for the goal** | Headset/BDSA (paid API) for demand trends; WSLCB lists for the authoritative vendor universe; public vendor sites for specific catalogs. |
| **Legality** | ⚠️ The blocker. WSLCB PRA lists carry a "no commercial use" caveat (verify). Leafly/Weedmaps ToS prohibit scraping. B2B marketplaces gate behind login/ToS. |
| **Where crawl4ai fits** | Tier E (public vendor/producer pages) cleanly; Tier A files are better fetched directly (no crawler needed). |

**Bottom line:** the concept is **feasible and genuinely valuable**, but the smart
architecture is *source-first, not crawler-first*: (1) buy the demand signal from a
compliant market-data API (Headset/BDSA), (2) fetch the authoritative WA vendor
universe from LCB files (after confirming commercial-use is permitted), and (3) use
crawl4ai only to read **public** vendor/producer catalog pages politely. Do NOT
point crawl4ai at ToS-protected marketplaces (Leafly/Weedmaps) or behind logins.

---

## 4. Proposed phased plan to add "Discovery" to the workflow

A new **Product Discovery** surface feeding the top of the purchasing funnel:
Discovery → shortlist → *New purchase order* (already built) → send → receive.

- **Phase 0 — Legal clearance (gate, do first).** Confirm with counsel/LCB which
  public datasets may be used commercially; capture each source's robots.txt/ToS
  stance. Nothing crawls until this is signed off. (Standing rule: never guess on
  compliance.)

- **Phase 1 — Authoritative vendor universe (no crawler).** Scheduled fetch of the
  LCB Cannabis License Applicants list; parse to a `discovery_vendors` table;
  reconcile against our existing `vendors` (flag "licensed vendors we don't yet
  buy from"). Pure file download + parse.

- **Phase 2 — Demand signal (paid API, no crawler).** Integrate Headset **or** BDSA
  to pull category trends + top brands/SKUs for the WA market; surface "rising
  categories/brands we don't carry" as discovery leads.

- **Phase 3 — Targeted public crawl (crawl4ai, opt-in).** For a *specific* public
  vendor/producer URL the manager pastes in, run crawl4ai to extract candidate
  products (name, category, pack size, price if listed) into a **draft** discovery
  list. Respect robots.txt, rate-limit, cache. Output is drafts-only — the manager
  promotes a lead into a PO line.

- **Phase 4 — Close the loop.** From a discovery lead → "Start PO" prefills
  `/admin/purchasing/new` with the chosen products/vendor. Discovery becomes the
  front door of the same purchasing pipeline we just overhauled.

### Engineering notes (for when we build it)
- crawl4ai is **Python**; our app is **Next.js/TS**. Run it as a **separate
  self-hosted microservice/worker** (FastAPI + crawl4ai, or the crawl4ai Docker
  image) that writes results to Supabase; the Next.js back office reads/curates.
  Keep it decoupled so a crawl never blocks the app.
- Store raw crawl output + a parsed/normalized draft; never auto-insert into the
  live catalog (drafts-only rule).
- Rate-limit + cache + robots.txt honoring baked in from day one.
- All discovery output is a **draft** a human promotes — same discipline as the
  reorder suggestions.

---

## 5. Recommendation

1. **Yes, it's worth building** — but as a *Discovery* funnel that is **source-led**,
   with crawl4ai as one tool among several (best for public vendor pages), not the
   centerpiece.
2. **Do Phase 0 (legal clearance) first.** The WSLCB "no commercial use" caveat and
   Leafly/Weedmaps ToS are real constraints; verify before crawling anything.
3. **Prioritize compliant paid data (Headset/BDSA) + LCB files** for the highest-
   signal, lowest-risk wins; add crawl4ai for targeted public catalogs in Phase 3.
4. Fold the output into the **existing purchasing pipeline** (Discovery → PO), so
   it's one seamless powerhouse rather than a bolt-on.

*(Deferred to a future slice — not built this pass, per the owner's "research only"
instruction. This doc is the reference for that future work.)*
