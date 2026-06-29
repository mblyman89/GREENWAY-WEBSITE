# Greenway Crawler — Fool-proof local testing guide

This guide is for the temporary phase: you want to test the crawler **now** on your work VM / desktop before your tech assistant builds the permanent shop-server VM + Cloudflare Tunnel setup.

Short answer: **yes, PyCharm is feasible** and is the nicest way to run it locally if you are comfortable clicking around in PyCharm. The crawler is just a small Python web service. PyCharm can create the Python environment, install the dependencies, and start it with the included run configuration. You do **not** need a new VM or tunnel for basic local testing.

For the first local test, keep expectations simple: you are proving that the crawler starts, can fetch public pages, can optionally write draft suggestions to Supabase, and can be called from your local Next.js back office. The permanent Cloudflare Tunnel setup is only needed when your Vercel-hosted production site needs to reach the worker over the internet.

---

## 0. What you are setting up

You will run two things on the same computer:

The **crawler worker** runs at:

```text
http://localhost:8200
```

Your local **Next.js back office** runs separately, usually at:

```text
http://localhost:3000
```

Then your local back office calls the crawler at `http://localhost:8200` when you click the vendor/brand crawler button.

If you only want to test the crawler itself, you can skip running the Next.js app and just use the `/health` endpoint plus a curl/Postman request. If you want the real back-office button test, run both.

---

## 1. What you need before starting

You need the following installed on the work VM / desktop:

1. **Git** — so the repo can be pulled.
2. **Python 3.11** — required for the crawler.
3. **PyCharm** — Community Edition is fine.
4. **Node.js 20** — only needed if you also want to run the local Next.js back office.
5. A copy of the `GREENWAY-WEBSITE` repo on your computer.

You also need these values available. Do **not** paste them into chat. Put them only in local `.env` files:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
CRAWLER_SHARED_SECRET
```

Optional for better extraction:

```text
AI_API_KEY
AI_BASE_URL
AI_MODEL
```

Optional for Instagram social testing once your Meta setup is done:

```text
META_GRAPH_TOKEN
META_IG_BUSINESS_ID
META_GRAPH_VERSION
```

Important: for your first smoke test, you can leave `AI_API_KEY`, `META_GRAPH_TOKEN`, and `META_IG_BUSINESS_ID` blank. Website crawling can still run CSS-first. Instagram buttons will stay disabled until the Meta values exist.

---

## 2. Recommended path: run the crawler in PyCharm

### Step 1 — Open the crawler folder, not the whole project

Open PyCharm.

Click:

```text
File → Open
```

Select the repo's crawler folder:

```text
GREENWAY-WEBSITE/crawler
```

Do **not** select only an individual file. Select the whole `crawler` folder.

PyCharm may ask whether to trust/open the project. Choose the normal trusted/open option for your own repo.

### Step 2 — Create or select the Python interpreter

In PyCharm, open:

```text
File → Settings → Project: crawler → Python Interpreter
```

On macOS this may be:

```text
PyCharm → Settings → Project: crawler → Python Interpreter
```

Click **Add Interpreter**.

Choose **Virtualenv Environment**.

Choose **New environment** if one does not already exist.

Set the location to:

```text
GREENWAY-WEBSITE/crawler/.venv
```

Set the base interpreter to Python 3.11.

Click **OK** / **Apply**.

If a `.venv` already exists and PyCharm detects it, you can choose **Existing environment** and point to:

Windows:

```text
GREENWAY-WEBSITE\crawler\.venv\Scripts\python.exe
```

macOS/Linux:

```text
GREENWAY-WEBSITE/crawler/.venv/bin/python
```

### Step 3 — Install Python requirements

Open PyCharm's built-in terminal. Make sure it is in the `crawler` folder. The prompt should show something ending like:

```text
.../GREENWAY-WEBSITE/crawler
```

If it does not, type:

Windows PowerShell:

```powershell
cd path\to\GREENWAY-WEBSITE\crawler
```

macOS/Linux terminal:

```bash
cd path/to/GREENWAY-WEBSITE/crawler
```

Now install dependencies:

```bash
python -m pip install --upgrade pip
pip install -r requirements.txt
```

If `pip` is not recognized, use:

```bash
python -m pip install -r requirements.txt
```

### Step 4 — Install the browser Playwright uses

Still in the PyCharm terminal, run:

```bash
python -m playwright install chromium
```

On Linux, if it complains about missing system libraries, run:

```bash
python -m playwright install --with-deps chromium
```

On a locked-down work VM, you may not have admin rights for `--with-deps`. That is okay for a first test: try the plain `python -m playwright install chromium` command first. If Playwright cannot run Chromium, the worker still has a plain HTTP fallback, but JavaScript-heavy sites will work worse until the browser install is fixed.

### Step 5 — Create the crawler `.env` file

In PyCharm's project file list, find:

```text
.env.example
```

Copy it and name the copy:

```text
.env
```

The full path should be:

```text
GREENWAY-WEBSITE/crawler/.env
```

Do **not** commit this file. It is gitignored and should stay local only.

Fill in these required values:

```env
CRAWLER_SHARED_SECRET=paste-a-long-random-secret-here
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

Generate a good local shared secret with:

```bash
python -c "import secrets; print(secrets.token_urlsafe(40))"
```

Copy the generated string into `CRAWLER_SHARED_SECRET`.

For the first test, it is okay to leave AI blank:

```env
AI_API_KEY=
```

That means CSS-first extraction only, no model cost.

Keep these as-is for normal testing:

```env
CRAWL_RESPECT_ROBOTS=true
CRAWL_REALISTIC_HEADERS=true
CRAWL_MIN_DELAY_SECONDS=2.0
CRAWL_MAX_RETRIES=3
```

Leave social blank until your Meta setup is ready:

```env
META_GRAPH_TOKEN=
META_IG_BUSINESS_ID=
META_GRAPH_VERSION=v21.0
```

### Step 6 — Start the crawler in PyCharm

The repo includes a PyCharm run config. Look near the top-right run dropdown for something like:

```text
Crawler API
```

Select it, then click the green play button.

If the run config does not appear, create one manually:

1. Click the run dropdown near the top-right.
2. Choose **Edit Configurations**.
3. Click **+**.
4. Choose **Python**.
5. Name it:

```text
Crawler API
```

6. Set **Module name** to:

```text
uvicorn
```

7. Set **Parameters** to:

```text
app.main:app --host 127.0.0.1 --port 8200 --reload
```

8. Set **Working directory** to the crawler folder:

```text
GREENWAY-WEBSITE/crawler
```

9. Make sure the Python interpreter is the `.venv` interpreter.
10. Click **Apply**, then **Run**.

Success looks like this in the PyCharm run window:

```text
Uvicorn running on http://127.0.0.1:8200
Application startup complete.
```

### Step 7 — Check the health endpoint

Open a browser on the same computer and go to:

```text
http://localhost:8200/health
```

You should see JSON similar to:

```json
{
  "ok": true,
  "ai_enabled": false,
  "supabase_configured": true,
  "social_configured": false,
  "proxy_enabled": false
}
```

What the flags mean:

`ok: true` means the worker is alive.

`supabase_configured: true` means it sees your Supabase URL and service role key.

`ai_enabled: false` is fine if `AI_API_KEY` is blank.

`social_configured: false` is fine until the Meta token is set.

If `supabase_configured` is false, stop the crawler, fix `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `crawler/.env`, then start it again.

---

## 3. Run the local back office and connect it to the local crawler

This part is only needed if you want to click the actual back-office buttons instead of just testing the crawler API directly.

### Step 1 — Open a second terminal at the repo root

The repo root is:

```text
GREENWAY-WEBSITE
```

Not the `crawler` folder.

### Step 2 — Create or update the site's local `.env.local`

At the repo root, create or edit:

```text
GREENWAY-WEBSITE/.env.local
```

Add these values:

```env
CRAWLER_BASE_URL=http://localhost:8200
CRAWLER_SHARED_SECRET=the-exact-same-secret-you-put-in-crawler-dot-env
```

The `CRAWLER_SHARED_SECRET` must match exactly. One extra space will break it.

Your site `.env.local` also needs the normal Supabase/site values your local Next.js app already uses. Do not remove existing values.

### Step 3 — Install Node dependencies if needed

From the repo root:

```bash
npm install
```

If dependencies are already installed, this may finish quickly.

### Step 4 — Start the local Next.js app

From the repo root:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

Log in to the back office as an admin/staff account with vendor permissions.

Go to a vendor page in admin, for example:

```text
/admin/vendors
```

Open a vendor, paste an official vendor/brand website URL, and click:

```text
Research with the crawler
```

If everything is connected, the crawler should fetch the page and write pending draft suggestions. Review them in the AI draft queue / vendor page.

---

## 4. Direct API test without running the Next.js app

If you want to test only the crawler, keep the crawler running and use a terminal.

### Health test

```bash
curl http://localhost:8200/health
```

### Dry-run research test

Dry-run means it returns draft candidates but does **not** write them to Supabase.

Replace `YOUR_SECRET_HERE` with the value from `crawler/.env`.

```bash
curl -X POST http://localhost:8200/research \
  -H "Content-Type: application/json" \
  -H "X-Crawler-Secret: YOUR_SECRET_HERE" \
  -d '{
    "url": "https://example.com",
    "entity_type": "vendor",
    "entity_id": "00000000-0000-0000-0000-000000000000",
    "display_name": "Test Vendor",
    "write": false
  }'
```

For a real dry run, use a real vendor/brand website URL. The dummy UUID is okay when `write` is false.

If you set `write` to true, use a real vendor or brand id from your Supabase database. Do not write with a fake id.

---

## 5. Testing Instagram later

Do this only after you complete `SOCIAL_SETUP.md`.

Once you have the Meta values, put them in `crawler/.env`:

```env
META_GRAPH_TOKEN=your-long-lived-page-token
META_IG_BUSINESS_ID=your-greenway-instagram-business-id
META_GRAPH_VERSION=v21.0
```

Restart the crawler.

Open:

```text
http://localhost:8200/health
```

You want:

```json
"social_configured": true
```

Then the local back office's `📸 Pull from Instagram` buttons should become available if the local site has `CRAWLER_BASE_URL=http://localhost:8200` and the matching `CRAWLER_SHARED_SECRET`.

Important: the vendor target must be a discoverable Instagram business/creator account. Personal/private accounts or accounts Meta does not expose through Business Discovery may return a clean error instead of data.

---

## 6. Common problems and fixes

### Problem: `ModuleNotFoundError` when starting the crawler

Usually dependencies are not installed into the interpreter PyCharm is using.

Fix:

1. Confirm PyCharm interpreter points to `crawler/.venv`.
2. Open PyCharm terminal in `crawler`.
3. Run:

```bash
python -m pip install -r requirements.txt
```

Restart the run config.

### Problem: `/health` does not load

The crawler is probably not running, or it started on a different port.

Fix:

1. Look at the PyCharm Run window.
2. Confirm it says `http://127.0.0.1:8200`.
3. If the port is already used, stop the other process or change the port in both places:
   - PyCharm run config
   - site `.env.local` `CRAWLER_BASE_URL`

### Problem: Back office button says unauthorized / 401

The two shared secrets do not match.

Fix:

1. Open `crawler/.env`.
2. Open root `.env.local`.
3. Make sure `CRAWLER_SHARED_SECRET` is identical in both.
4. Restart both the crawler and the Next.js dev server.

### Problem: Back office button says crawler not configured

The local Next.js app does not see `CRAWLER_BASE_URL` or `CRAWLER_SHARED_SECRET`.

Fix:

1. Add both values to root `.env.local`.
2. Restart `npm run dev`.

Next.js reads env vars at startup. Editing `.env.local` while it is running is not enough.

### Problem: Playwright / Chromium errors

Fix:

```bash
python -m playwright install chromium
```

On Linux:

```bash
python -m playwright install --with-deps chromium
```

If your work VM blocks the browser dependency install, you can still test simpler pages through the HTTP fallback, but JavaScript-heavy pages may be weak until Chromium works.

### Problem: Windows PowerShell refuses to run activation scripts

You do not need to manually activate the environment if PyCharm is using the `.venv` interpreter. In the terminal, you can run commands through Python directly:

```powershell
python -m pip install -r requirements.txt
python -m playwright install chromium
python -m uvicorn app.main:app --host 127.0.0.1 --port 8200 --reload
```

If you do want to activate manually and PowerShell blocks it, use PyCharm's interpreter instead or ask your tech assistant later to adjust execution policy.

### Problem: `supabase_configured` is false

Fix `crawler/.env`:

```env
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

Restart the crawler.

### Problem: The crawler returns no useful drafts

This can happen for a few normal reasons:

1. The page is thin and has no useful text.
2. The best information is on an About / Story / Products sub-page.
3. The site is very JavaScript-heavy and Chromium is not installed.
4. `AI_API_KEY` is blank, so the LLM gap-filling step is disabled.
5. The text fails the verify-against-source or I-502 compliance gates.

Try a strong vendor page first, then compare CSS-only vs AI-enabled.

---

## 7. If PyCharm is not feasible: run it from a plain terminal

This is the same setup without PyCharm.

From the repo's crawler folder:

```bash
cd GREENWAY-WEBSITE/crawler
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m playwright install chromium
cp .env.example .env
```

Edit `.env`, then run:

```bash
uvicorn app.main:app --host 127.0.0.1 --port 8200 --reload
```

Windows PowerShell version:

```powershell
cd GREENWAY-WEBSITE\crawler
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m playwright install chromium
copy .env.example .env
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8200 --reload
```

Then browse to:

```text
http://localhost:8200/health
```

---

## 8. If local desktop testing is blocked: short-term cloud trial options

Use this only if your work VM has locked-down permissions, cannot install Chromium, or cannot run Python reliably. For a one-week test, a temporary cloud box is fine.

### Best temporary choice: DigitalOcean Droplet

DigitalOcean is simple and predictable. It often offers credits for new accounts, but assume a small hourly cost.

Recommended test droplet:

```text
Ubuntu 22.04 or 24.04
2 GB RAM minimum, 4 GB preferred
1 vCPU is okay for light testing, 2 vCPU nicer
```

Basic setup after SSH:

```bash
sudo apt-get update
sudo apt-get install -y git python3 python3-venv python3-pip curl

git clone https://github.com/mblyman89/GREENWAY-WEBSITE.git
cd GREENWAY-WEBSITE/crawler
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m playwright install --with-deps chromium
cp .env.example .env
nano .env
uvicorn app.main:app --host 0.0.0.0 --port 8200
```

For a quick private test, you can SSH tunnel it to your laptop instead of opening a public firewall port:

```bash
ssh -L 8200:localhost:8200 root@YOUR_DROPLET_IP
```

Then on your laptop, use:

```text
http://localhost:8200
```

If you need Vercel or another remote app to reach it temporarily, use Cloudflare Tunnel, ngrok, or the platform's HTTPS ingress. Do not leave a raw unauthenticated port open. The crawler still requires `X-Crawler-Secret`, but do not rely on one lock when two are easy.

### Other acceptable temporary hosts

Render, Railway, Fly.io, and Google Cloud Run can work for a short test if they allow the Docker image and enough memory for Playwright/Chromium. They are less fool-proof than a normal VM because headless browsers and serverless limits can be fussy.

If the goal is just “test this week,” a small Ubuntu VM is the cleanest fallback.

---

## 9. What I would do in your exact situation

Use this order:

1. **Try PyCharm on your work VM first.** Fastest, no tunnel, no new server.
2. Run `/health` and one dry-run `/research` test.
3. Run the local Next.js app and click the real vendor/brand button.
4. Work through `SOCIAL_SETUP.md` separately while the permanent server VM is being built.
5. When the shop VM is ready, move the same `.env` values there and expose it with Cloudflare Tunnel per `WHERE_TO_RUN.md`.

This keeps today simple: local-only, no public exposure, no tunnel, no permanent infrastructure decision. Then the final deployment is just moving a working setup to its long-term home.
