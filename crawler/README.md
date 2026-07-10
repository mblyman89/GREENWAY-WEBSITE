# Greenway Crawler — the "work-horse"

A small, self-contained **Python service** that researches vendor / brand / product
information from the public web and writes **drafts** into Supabase
(`ai_suggestions`) for staff to review in the existing back-office queue.

It is intentionally a **separate worker** from the Next.js site:

- The site runs on **Vercel**, which can't run a long-lived headless browser.
- crawl4ai drives a real browser (Playwright) for JavaScript-heavy pages.
- So the crawler lives here, exposes one authenticated HTTP endpoint, and the
  Next.js app calls it on demand. Everything it produces is **drafts-only** —
  nothing is ever auto-published.

## The honest pipeline (LLM is the last resort)

For every target URL:

1. **Fetch politely** — robots.txt check, per-domain rate limit, on-disk cache.
2. **CSS-first, no-LLM extraction** — JSON-LD / OpenGraph / meta / common DOM
   selectors. If this is enough, we never call the model.
3. **`fit_markdown` cleanup** — prune boilerplate to the meaningful content.
4. **Schema LLM extraction** — only the leftover gaps, with a Pydantic schema,
   `temperature≈0`, on an OpenAI-compatible endpoint (same `AI_BASE_URL`/`AI_MODEL`
   as the site).
5. **Verify-against-source** — drop any extracted fact whose text isn't actually
   supported by the fetched page (kills hallucinations).
6. **Compliance scan** — the exact same WA I-502 rules the site uses.
7. **Write drafts** — `ai_suggestions` rows with `source=crawl:<url>`, a grounding
   `confidence`, and image candidates. Status `pending`. A human accepts/rejects.

## Batch harvest (Slice H1)

Beyond the single-target `/research`, the worker can work through a **list** of
sites unattended — the KB harvest fleet:

- `POST /harvest` — submit `{ targets: [{url, entity_type, entity_id, display_name}], max_pages_per_site?, delay_between_targets?, write?, label? }`.
  Returns `202` + a job snapshot immediately.
- `GET /harvest` — recent jobs. `GET /harvest/{id}` — live progress.
- `POST /harvest/{id}/cancel` — stop between targets (a site is either fully
  researched or untouched).
- `POST /harvest/{id}/resume` — crash recovery: after a VM reboot, pending /
  interrupted targets re-queue; finished targets are never redone.

Guarantees: **one job crawls at a time** (politeness is per-domain and the VM
is one box; extra jobs wait in line), state is persisted to
`.cache/jobs/job_<id>.json` after **every** target (crash-safe), every target
goes through the exact same honest pipeline as `/research` (robots.txt, SSRF
guard, rate limits, verify-against-source, compliance), and everything lands
as **pending drafts** in `ai_suggestions` — drafts-only, always.
`max_pages_per_site` sets the per-job depth (Tier 1 vendors ≈ 15–40,
prospects ≈ 8–15, whole-market directory pass ≈ 2–4 with a
`delay_between_targets` trickle).

## Full-site frontier crawl (Slices C1–C4)

The deep-research crawl is a **best-first frontier walk of the whole site**,
not a one-hop link list:

- **C2 — frontier crawl.** Every fetched page's own same-site links (nav,
  anchors, `rel="next"`/pagination) join a priority queue scored by
  `page_interest_score`, so `homepage → /products/ → 40 product pages →
  ?page=2 …` is fully walked until the page budget (`CRAWL_MAX_PAGES`,
  default 25; per-job override for harvests) is spent or the site is
  exhausted. Same-origin only, deduped, boring URLs (cart/login/privacy)
  refused. Every fetch still goes through the exact same politeness gate
  (robots.txt, SSRF guard, allow-list, per-domain delay).
- **C1 — image ↔ adjacent-text pairing.** Product pictures almost never carry
  their description in the image: it's the card heading/body next to the
  image, the `figcaption`, or the JSON-LD Product entry. `page_intelligence`
  captures that nearby text with every image, so `research_images` drafts read
  "GG4 — award-winning gorilla glue phenotype — https://…/gg4.jpg" instead of
  a bare URL.
- **C3 — dynamic-content capture.** The browser fetch scrolls the full page
  (lazy loading), waits for images, removes cookie/newsletter overlays, and
  best-effort clicks visible "load more / show more / view all" buttons before
  capturing HTML. Every crawl4ai feature is signature-filtered against the
  installed version and soft-degrades: advanced config → plain `arun` → httpx.
  Knobs: `CRAWL_DYNAMIC_CONTENT` (default `true`), `CRAWL_SCROLL_DELAY_SECONDS`,
  `CRAWL_SETTLE_SECONDS`, `CRAWL_PAGE_TIMEOUT_SECONDS`.
- **C4 — completeness validation.** After every crawl the pipeline knows
  exactly how many discovered pages were read / failed / still queued
  (frontier accounting) and whether the last pages were still adding new
  content (saturation signal, computed pure — works on the httpx path too).
  The verdict ships as a `research_coverage` reference draft
  ("COMPLETE" / "COMPLETE WITH GAPS" / "SATURATED" / "BUDGET REACHED — raise
  CRAWL_MAX_PAGES"), as a `coverage` object on the `/research` response, and
  as `pages_leftover` + `coverage_assessment` on harvest targets.

## URL seeding (Slice H2)

Deep research used to discover extra pages only from **nav links + the
sitemap**. With seeding enabled the pipeline also asks crawl4ai's
`AsyncUrlSeeder` for the site's full URL inventory (sitemap and/or the Common
Crawl index — **no page fetches**, near-zero cost), scores every candidate
with BM25 against a query tuned for the seven KB target fields
(`about story mission company brand products menu strains flower`), merges all
three sources (same-origin only, deduped, boring URLs dropped), and spends the
crawl budget on the **best pages first**. Two-phase cost control: cheap
inventory + scoring first, expensive browser crawl second.

Env knobs (all optional):

| Var | Default | Meaning |
| --- | --- | --- |
| `CRAWL_SEED_ENABLED` | `true` | Master switch for the seeder. |
| `CRAWL_SEED_SOURCE` | `sitemap` | `sitemap`, `cc` (Common Crawl), or `sitemap+cc`. |
| `CRAWL_SEED_MAX_URLS` | `100` | Max candidate URLs pulled from the seeder. |

Seeding **soft-disables** (contributes zero candidates; nav + sitemap
discovery still work) when crawl4ai < 0.7 is installed or the seeder errors —
it can never break a crawl. `pip install -r requirements.txt` now pulls a
seeder-capable crawl4ai.

## Quick start

For a temporary desktop / work-VM test, start with **[`docs/LOCAL_TESTING_GUIDE.md`](docs/LOCAL_TESTING_GUIDE.md)**.

For a proper production deployment on a business VM (Docker + systemd, Cloudflare
Tunnel, secrets, Vercel wiring), hand your IT person
**[`docs/IT_DEPLOYMENT_GUIDE.md`](docs/IT_DEPLOYMENT_GUIDE.md)**.

See **[`docs/RUNBOOK.md`](docs/RUNBOOK.md)** for the full production walkthrough.
The 30-second version:

```bash
cd crawler
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m playwright install --with-deps chromium   # browser for crawl4ai
cp .env.example .env                                 # fill in the values
uvicorn app.main:app --host 0.0.0.0 --port 8200
```

Then in the back office, set `CRAWLER_BASE_URL` + `CRAWLER_SHARED_SECRET` and
click **"Research with the crawler"** on a vendor or brand.

## Opening in PyCharm

`File → Open → select the `crawler/` folder`. PyCharm will detect it as a Python
project. Point the interpreter at `crawler/.venv` (Settings → Project → Python
Interpreter → Add → Existing → `.venv/bin/python`). The included
`.run/` configs let you start the API with one click.
