# Greenway Crawler — Production Runbook

A short, thorough walkthrough for running the crawler worker in production and
connecting it to the back office. The crawler is a **separate service** from the
Vercel site (Vercel can't run a headless browser), so it lives wherever you can
run a small always-on Python process: a cheap VM (Fly.io / Render / Railway /
DigitalOcean / a Raspberry Pi / your own machine for overnight batches).

---

## 0. What it does (recap)

`POST /research { url, entity_type, entity_id }` → fetches the page politely →
CSS-first extraction → (only if needed) schema LLM extraction → verify against
the page → WA I-502 compliance scan → writes **pending** rows to Supabase
`ai_suggestions` with `source=crawl:<url>`. Staff review them in the existing
back-office queue. **Nothing auto-publishes.**

---

## 1. One-time setup

```bash
cd crawler
python3 -m venv .venv
source .venv/bin/activate                 # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Install the headless browser crawl4ai drives (downloads Chromium):
python -m playwright install --with-deps chromium
```

Copy the env template and fill it in:

```bash
cp .env.example .env
```

| Variable | What to put |
|---|---|
| `CRAWLER_SHARED_SECRET` | A long random string. Generate: `python -c "import secrets; print(secrets.token_urlsafe(40))"`. The **same** value goes in the site's env as `CRAWLER_SHARED_SECRET`. |
| `SUPABASE_URL` | Your project URL (`https://xxxx.supabase.co`). |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key (Project Settings → API). Server-side only — this worker is never public. |
| `AI_BASE_URL` / `AI_MODEL` / `AI_API_KEY` | Same OpenAI-compatible provider the site uses. **Leave `AI_API_KEY` empty** to run CSS-only (no model cost) for a first dry run. |
| `CRAWL_USER_AGENT` | Keep a real contact email so site owners can reach you. |
| `CRAWL_RESPECT_ROBOTS` | `true` in production. |

---

## 2. Run it

**Local / a VM (simplest):**

```bash
source .venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8200
```

Smoke-test it:

```bash
curl http://localhost:8200/health
# {"ok":true,"ai_enabled":...,"supabase_configured":...}
```

**As a managed service (Docker):** a `Dockerfile` is included.

```bash
docker build -t greenway-crawler ./crawler
docker run --env-file ./crawler/.env -p 8200:8200 greenway-crawler
```

Deploy that image to Fly.io / Render / Railway / Cloud Run. Point the platform's
secrets at the same env vars. Expose port `8200` (TLS terminated by the platform).

**Keep it alive** (bare VM): use `systemd` or `pm2`/`supervisor`. Example
`systemd` unit at `crawler/docs/greenway-crawler.service`.

---

## 3. Connect the back office

In the **site's** environment (Vercel → Project → Settings → Environment
Variables), set:

| Variable | Value |
|---|---|
| `CRAWLER_BASE_URL` | The public URL of the worker, e.g. `https://crawler.yourhost.com` (or `http://localhost:8200` when developing locally). |
| `CRAWLER_SHARED_SECRET` | The **same** secret as the worker. |

Redeploy the site. Now the **"Research with the crawler"** button on a vendor or
brand page calls the worker; results land as drafts in the review queue with a
**Researched · <site>** provenance badge and a confidence %.

---

## 4. Recommended first run (verify before you scale)

1. Start the worker with `AI_API_KEY` **empty** (CSS-only) — free, proves the
   plumbing end-to-end.
2. Open a high-traffic vendor/brand (e.g. one of your top brands), paste its
   official site URL, click **Research with the crawler**.
3. Review the drafts. Accept the good ones, reject the rest. Watch the
   **accept-rate** panel on `/admin/ai-usage` fill in by source.
4. Add `AI_API_KEY` to enable the LLM gap-filling step. Re-run on the same
   vendor; compare quality + accept-rate.
5. Once you're happy on a handful of top vendors/brands, we turn on overnight
   batch processing (DF-7).

---

## 5. Cost & safety notes

- **Cheapest path first:** robots/cache → CSS extraction (free) → small model
  only for gaps. The cache (`.cache/`, 24h default) means re-running research on
  the same page costs nothing.
- **Drafts only:** the worker can only INSERT `pending` suggestions. It never
  edits or publishes vendor/brand/product records.
- **No guessing:** every LLM-extracted value is verified against the page text;
  unsupported facts are dropped. Compliance-blocking text is dropped too.
- **Politeness:** robots.txt is respected and each domain is rate-limited
  (`CRAWL_MIN_DELAY_SECONDS`).

---

## 6. Troubleshooting

| Symptom | Fix |
|---|---|
| `/health` shows `supabase_configured: false` | Fill `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in `.env`, restart. |
| Button returns 401 | The site's `CRAWLER_SHARED_SECRET` ≠ the worker's. Make them identical. |
| Button returns 503 "not configured" | Worker has no `CRAWLER_SHARED_SECRET` set. |
| `crawl4ai`/Playwright errors | Run `python -m playwright install --with-deps chromium`. The worker still falls back to plain-HTTP fetch if the browser is unavailable. |
| Everything `accepted:false` "not supported by source" | The page is JS-rendered and the plain-HTTP fallback got an empty shell — make sure Chromium is installed so crawl4ai can render it. |
