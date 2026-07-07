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
