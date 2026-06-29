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

## Quick start

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
