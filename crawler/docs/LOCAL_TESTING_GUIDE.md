# Greenway Crawler — beginner local testing guide

This guide is for the temporary phase: you want to test the crawler **now** on your work VM / desktop before a permanent shop-server VM + Cloudflare Tunnel home is built.

Short answer: **yes, PyCharm is feasible**. For local testing you do **not** need Cloudflare Tunnel, a new VM, Vercel changes, or a public URL. You can run the crawler on your computer at `http://localhost:8200`, run the website back office locally at `http://localhost:3000`, and click the crawler buttons in the local back office.

This guide assumes you know very little about Python, PyCharm, Node, local env files, or command lines. That is fine. Follow it slowly, one baby step at a time.

---

## 0. The big picture in plain English

You are going to run two local programs on the same computer.

First, the **crawler worker**. This is a Python app. It fetches vendor/brand webpages, extracts useful public information, verifies it, runs compliance checks, and writes **draft suggestions** into Supabase. It will run here:

```text
http://localhost:8200
```

Second, the **website back office**. This is the Next.js website/admin app. It shows your admin pages and has the buttons like “Research with the crawler.” It will usually run here:

```text
http://localhost:3000
```

When you click a crawler button in the local back office, the local website talks to the local crawler. The crawler writes pending draft suggestions into the real Supabase database, and then you review them in the back office.

Nothing should auto-publish. The crawler creates **drafts only**.

---

## 1. Stop first: fix “No space left on device”

If PyCharm says:

```text
ERROR: Could not install packages due to an OSError: [Errno 28] No space left on device
```

that means the computer/VM running PyCharm is out of usable disk space. It is not a crawler bug. Python packages, Playwright, Chromium, Node modules, and build caches can use several GB.

Do **not** keep trying to install packages until you free space. The install will keep failing and may leave half-installed junk behind.

### 1A. Check how much space you have

If your work VM is Windows, open **File Explorer** and click **This PC**. Look at the main drive, usually `C:`. You want at least:

```text
10 GB free minimum
20–30 GB free preferred
```

If your work VM is Linux, open a terminal and run:

```bash
df -h
```

Look for the main drive, usually `/`. You want at least 10 GB free.

### 1B. Easy Windows cleanup checklist

If you are on Windows, do these in order.

#### Step 1 — Empty the Recycle Bin

Right-click **Recycle Bin** → **Empty Recycle Bin**.

#### Step 2 — Use Windows Storage cleanup

Open:

```text
Settings → System → Storage
```

Click **Temporary files**.

Safe things to delete usually include:

```text
Temporary files
Recycle Bin
Thumbnails
Delivery Optimization Files
Windows Update cleanup
Temporary Internet Files
```

Do **not** delete anything you personally need from Downloads unless you have checked it.

#### Step 3 — Remove old project folders you do not use

Look in places like:

```text
Documents
Desktop
Downloads
C:\Users\YOURNAME\PycharmProjects
C:\Users\YOURNAME\source
C:\Users\YOURNAME\repos
```

If you have old Python projects you truly do not use anymore, you can delete those entire old project folders.

Keep the Greenway website repo folder.

#### Step 4 — Delete old Python virtual environments from unused projects

A Python virtual environment is usually a folder named one of these:

```text
.venv
venv
env
```

These can be large and are safe to delete **inside old projects you no longer use**. They are just reinstallable package folders.

Example old project folder:

```text
C:\Users\YOURNAME\PycharmProjects\old-test-project\.venv
```

You can delete that `.venv` if you do not use that project.

Do **not** delete the Greenway repo itself.

#### Step 5 — Clear pip’s package download cache

In Windows PowerShell, run:

```powershell
python -m pip cache purge
```

If that says Python is not found, try:

```powershell
py -m pip cache purge
```

If both fail, skip this step.

#### Step 6 — Clear old Node caches if needed

Only do this if you still need space:

```powershell
npm cache clean --force
```

#### Step 7 — Re-check free space

Go back to **This PC** and confirm you now have at least 10 GB free.

### 1C. Easy Linux cleanup checklist

If your work VM is Linux, run these one at a time:

```bash
df -h
```

Clear pip cache:

```bash
python3 -m pip cache purge || true
```

Clear npm cache:

```bash
npm cache clean --force || true
```

If old unused project folders contain `.venv`, `venv`, `node_modules`, or `.next` folders, those are usually safe to delete **inside old projects you no longer use**.

Examples:

```bash
rm -rf ~/PycharmProjects/old-project/.venv
rm -rf ~/PycharmProjects/old-project/node_modules
rm -rf ~/PycharmProjects/old-project/.next
```

Be careful with `rm -rf`. Only delete folders you are sure are old unused projects.

### 1D. Clean half-installed Greenway crawler packages and retry

After freeing space, if the Greenway crawler install failed halfway, it is okay to delete only the crawler virtual environment and recreate it.

Inside the Greenway repo:

Windows path:

```text
GREENWAY-WEBSITE\crawler\.venv
```

macOS/Linux path:

```text
GREENWAY-WEBSITE/crawler/.venv
```

Delete that `.venv` folder, then recreate it later using the steps below.

Do **not** delete:

```text
GREENWAY-WEBSITE
GREENWAY-WEBSITE/crawler/app
GREENWAY-WEBSITE/src
```

Those are the actual code.

---

## 2. What Node.js 20 is and how to get it

The crawler itself uses Python. But if you want to test through the **website back office**, you also need to run the website locally. The website is a Next.js app, and Next.js runs on **Node.js**.

So:

```text
Python = runs the crawler
Node.js 20 = runs the local website/back office
```

You only need Node.js 20 on the computer where you will run the local website.

### 2A. Check whether Node is already installed

Open a terminal or PowerShell and run:

```bash
node -v
```

If it prints something like this, you are good:

```text
v20.x.x
```

If it prints `v18`, `v21`, `v22`, or says node is not found, install Node 20.

### 2B. Windows: easiest Node.js 20 install

1. Go to:

```text
https://nodejs.org/en/download
```

2. Choose the **LTS** version if it is Node 20. If the page offers a newer LTS, look for older downloads / previous releases and choose **Node.js 20.x LTS**.
3. Download the **Windows Installer (.msi)**.
4. Run it.
5. Accept the defaults.
6. Close and reopen PowerShell.
7. Check:

```powershell
node -v
npm -v
```

You want `node -v` to start with `v20`.

### 2C. Windows: if you already use nvm-windows

If you have `nvm` installed on Windows, run:

```powershell
nvm install 20
nvm use 20
node -v
```

### 2D. macOS/Linux: use nvm if possible

If you have `nvm`, run:

```bash
nvm install 20
nvm use 20
node -v
```

If you do not have `nvm`, ask your tech assistant later or use the installer from nodejs.org. For the one-week test, the Windows installer path is usually simplest on a work VM.

---

## 3. Where the values come from

You asked: “where are those values coming from? Do I need to do anything in Vercel or Supabase?”

For **local testing**, most values go in local files on your computer. You do **not** need to change Vercel just to test locally.

### 3A. Values for the crawler `.env`

These go in:

```text
GREENWAY-WEBSITE/crawler/.env
```

#### `CRAWLER_SHARED_SECRET`

Where it comes from: you generate it yourself.

It is just a long password shared between the website and the crawler. The website sends it; the crawler checks it.

Generate it with:

```bash
python -c "import secrets; print(secrets.token_urlsafe(40))"
```

If `python` does not work on Windows, try:

```powershell
py -c "import secrets; print(secrets.token_urlsafe(40))"
```

You will paste the exact same value into two places:

```text
crawler/.env
root .env.local
```

#### `SUPABASE_URL`

Where it comes from: Supabase project settings.

In Supabase:

```text
Open Supabase → choose your Greenway project → Project Settings → API → Project URL
```

It looks like:

```text
https://something.supabase.co
```

#### `SUPABASE_SERVICE_ROLE_KEY`

Where it comes from: Supabase project settings.

In Supabase:

```text
Open Supabase → choose your Greenway project → Project Settings → API → service_role key
```

Important: this is powerful. Treat it like a password. Do not paste it into chat. Do not commit it. Only put it in local `.env` or server secret storage.

The crawler needs the service role key because it writes pending rows into `ai_suggestions` from a trusted server-side worker.

#### `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL`

Where they come from: your AI provider / existing website env.

For the first test, you can leave:

```env
AI_API_KEY=
```

That means the crawler only uses CSS-first extraction. This is free and good for proving the plumbing.

Later, if you want the LLM gap-filling step, use the same OpenAI-compatible values the website uses.

#### `META_GRAPH_TOKEN`, `META_IG_BUSINESS_ID`

Where they come from: Meta developer setup in `SOCIAL_SETUP.md`.

Leave them blank until you finish the Meta setup. The normal website crawler can still be tested without Instagram.

### 3B. Values for the website `.env.local`

These go in the repo root:

```text
GREENWAY-WEBSITE/.env.local
```

For the crawler connection, add:

```env
CRAWLER_BASE_URL=http://localhost:8200
CRAWLER_SHARED_SECRET=same-exact-secret-as-crawler-env
```

The root `.env.local` also needs the normal website values: Supabase URL, anon key, auth settings, etc. Your local site may already have these. If it does not, copy the required non-secret structure from the root `.env.example` and fill values from Supabase/Vercel.

### 3C. Do you need to do anything in Vercel?

For **local testing on your own computer**: usually **no**.

You only set Vercel env vars when the **deployed production website** needs to call a crawler running somewhere reachable from the internet, such as the future shop VM Cloudflare Tunnel.

Later, production Vercel will need:

```env
CRAWLER_BASE_URL=https://your-future-crawler-tunnel-url
CRAWLER_SHARED_SECRET=same-secret-as-production-worker
```

But for now, local testing uses:

```env
CRAWLER_BASE_URL=http://localhost:8200
```

That only works from the local website running on the same computer.

### 3D. Do you need to do anything in Supabase?

For this local test, you usually do **not** need a new migration if PR #94/#95 are already merged and the current database has the `ai_suggestions` table.

You do need to retrieve:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

from Supabase settings.

The crawler will use those to write draft suggestions.

---

## 4. Exact PyCharm crawler setup, baby step by baby step

### Step 4.1 — Open only the crawler folder in PyCharm

Open PyCharm.

Click:

```text
File → Open
```

Choose:

```text
GREENWAY-WEBSITE/crawler
```

Not the whole `GREENWAY-WEBSITE` folder. Not an individual file. Choose the `crawler` folder.

### Step 4.2 — Make sure PyCharm uses Python 3.11

In PyCharm:

```text
File → Settings → Project: crawler → Python Interpreter
```

Click **Add Interpreter**.

Choose **Virtualenv Environment**.

If you are starting fresh, choose **New environment**.

Set location to:

```text
GREENWAY-WEBSITE/crawler/.venv
```

Set base interpreter to Python 3.11.

Click **OK** or **Apply**.

If you previously got “No space left on device” and deleted `.venv`, this step recreates it.

### Step 4.3 — Install crawler packages

Open PyCharm’s terminal at the bottom.

Make sure it is in the crawler folder. If not, change into it.

Windows example:

```powershell
cd C:\path\to\GREENWAY-WEBSITE\crawler
```

macOS/Linux example:

```bash
cd /path/to/GREENWAY-WEBSITE/crawler
```

Run:

```bash
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

If you see “No space left on device,” stop and go back to Section 1.

### Step 4.4 — Install Chromium for Playwright

Run:

```bash
python -m playwright install chromium
```

If you are on Linux and it complains about missing dependencies, try:

```bash
python -m playwright install --with-deps chromium
```

If this part fails because the work VM is locked down, you can still test some pages through the fallback fetcher, but real browser rendering will be weaker.

### Step 4.5 — Create `crawler/.env`

In PyCharm’s left file panel, right-click `.env.example` and copy it.

Paste it into the same `crawler` folder and rename the copy:

```text
.env
```

So now you have:

```text
crawler/.env.example   ← template, safe to commit
crawler/.env           ← your real local secrets, never commit
```

Open `crawler/.env`.

For the first test, edit these lines:

```env
CRAWLER_SHARED_SECRET=replace-this-with-your-generated-secret
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
AI_API_KEY=
META_GRAPH_TOKEN=
META_IG_BUSINESS_ID=
```

A realistic first-test example shape is:

```env
CRAWLER_SHARED_SECRET=2jvZEXAMPLE_long_random_string_do_not_use_this_exact_one
SUPABASE_URL=https://abcd1234.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...your-real-service-role-key...abc
AI_API_KEY=
META_GRAPH_TOKEN=
META_IG_BUSINESS_ID=
```

Do not use the example values above. Use your own real Supabase values and generated secret.

Keep these defaults:

```env
CRAWL_RESPECT_ROBOTS=true
CRAWL_REALISTIC_HEADERS=true
CRAWL_MIN_DELAY_SECONDS=2.0
CRAWL_MAX_RETRIES=3
CRAWL_ALLOW_DOMAINS=
CRAWL_PROXY_URL=
```

Save the file.

### Step 4.6 — Start the crawler

Look for the PyCharm run dropdown near the top-right. If you see:

```text
Crawler API
```

select it and click the green play button.

If you do not see it, create it:

1. Click the run dropdown.
2. Click **Edit Configurations**.
3. Click **+**.
4. Choose **Python**.
5. Name it:

```text
Crawler API
```

6. Use **Module name**:

```text
uvicorn
```

7. Use **Parameters**:

```text
app.main:app --host 127.0.0.1 --port 8200 --reload
```

8. Use **Working directory**:

```text
GREENWAY-WEBSITE/crawler
```

9. Make sure the interpreter is `crawler/.venv`.
10. Click **Apply**, then **Run**.

Success looks like:

```text
Uvicorn running on http://127.0.0.1:8200
Application startup complete.
```

### Step 4.7 — Check crawler health

Open your web browser and go to:

```text
http://localhost:8200/health
```

Good first-test output looks roughly like:

```json
{
  "ok": true,
  "ai_enabled": false,
  "supabase_configured": true,
  "social_configured": false,
  "proxy_enabled": false
}
```

For now:

```text
ok: true                    good
supabase_configured: true   good
ai_enabled: false           okay for first test
social_configured: false    okay until Meta setup is done
```

If `supabase_configured` is false, your `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` is missing/wrong in `crawler/.env`. Fix it, save, stop the crawler, start it again, and reload `/health`.

---

## 5. Set up the local website back office

This is the part you said needs more explanation. This is what lets you test the crawler through the website backend instead of only testing the crawler by itself.

### Step 5.1 — Open the full website folder separately

You can keep PyCharm open for the crawler.

For the website, use a normal terminal / PowerShell, or open the full repo in a second editor window.

The website root is:

```text
GREENWAY-WEBSITE
```

This is the folder that contains:

```text
package.json
src
crawler
.env.example
```

The website commands must be run from this root folder, **not** from `crawler`.

### Step 5.2 — Create or edit root `.env.local`

In the root `GREENWAY-WEBSITE` folder, create or edit:

```text
.env.local
```

This is different from:

```text
crawler/.env
```

You need both files:

```text
GREENWAY-WEBSITE/crawler/.env   ← crawler settings
GREENWAY-WEBSITE/.env.local     ← local website settings
```

In root `.env.local`, add these two crawler lines:

```env
CRAWLER_BASE_URL=http://localhost:8200
CRAWLER_SHARED_SECRET=paste-the-same-secret-from-crawler-env-here
```

The secret must be exactly the same value as `CRAWLER_SHARED_SECRET` in `crawler/.env`.

No quotes. No extra spaces.

Good:

```env
CRAWLER_SHARED_SECRET=abc123longsecret
```

Bad:

```env
CRAWLER_SHARED_SECRET = abc123longsecret
CRAWLER_SHARED_SECRET="abc123longsecret"
```

The root `.env.local` also needs the normal website environment values. If your local website has already run before, they may already be there. Do not delete them.

If you do not have a root `.env.local` yet, start by copying the root template:

```text
GREENWAY-WEBSITE/.env.example
```

Copy it to:

```text
GREENWAY-WEBSITE/.env.local
```

Then fill in the required Supabase/site values from your existing Vercel/Supabase settings. Vercel can be useful as a reference because it already has the production site env vars, but you do not need to change Vercel for local testing.

### Step 5.3 — Where to find existing website env values if `.env.local` is missing

If your local website has never been run before, you may need to populate `.env.local` from the same values production uses.

Possible sources:

1. **Vercel Project Settings → Environment Variables** — copy the website env values into your local `.env.local`.
2. **Supabase Project Settings → API** — copy Supabase URL and anon/public key values.
3. Existing private notes/password manager used for Greenway dev secrets.

Do not paste secrets into chat. Put them directly into `.env.local`.

For local crawler testing, the key new lines are still only:

```env
CRAWLER_BASE_URL=http://localhost:8200
CRAWLER_SHARED_SECRET=same-secret-as-crawler-env
```

### Step 5.4 — Install website packages

Open PowerShell/terminal in the root folder:

```text
GREENWAY-WEBSITE
```

Check you are in the right place by listing files.

Windows PowerShell:

```powershell
dir
```

macOS/Linux:

```bash
ls
```

You should see:

```text
package.json
src
crawler
```

Now install packages:

```bash
npm install
```

This can take a while and can use several GB because it creates:

```text
node_modules
```

If it fails with “No space left on device,” go back to Section 1 and free more disk space.

### Step 5.5 — Start the local website

From the root folder, run:

```bash
npm run dev
```

Success usually says something like:

```text
Local: http://localhost:3000
```

Open:

```text
http://localhost:3000
```

### Step 5.6 — Log into the local back office

Open the local website in your browser:

```text
http://localhost:3000
```

Log in with a Greenway admin/staff account that has permission to manage vendors.

Then go to:

```text
http://localhost:3000/admin/vendors
```

If login does not work locally, the root `.env.local` is probably missing one of the normal Supabase/auth env values. Compare with Vercel’s environment variables or your existing local setup.

### Step 5.7 — Confirm both programs are running

Before clicking the crawler button, confirm:

Crawler is running:

```text
http://localhost:8200/health
```

Website is running:

```text
http://localhost:3000
```

Keep both terminal/run windows open.

Do not close PyCharm while testing. Do not close the `npm run dev` terminal while testing.

### Step 5.8 — Test a vendor website through the back office

In the local back office:

1. Go to `/admin/vendors`.
2. Open one vendor.
3. Find the crawler/research box.
4. Paste the vendor’s official website URL.
5. Click **Research with the crawler**.
6. Wait. Some pages can take 10–60 seconds.
7. Look for new AI draft suggestions on the vendor page / AI draft section.

Good first test choices are vendor/brand official websites with normal public pages and an About/Story page. Avoid Instagram for the first test; social requires the Meta setup.

### Step 5.9 — What success looks like

A successful local backend test means:

1. The website button does not error.
2. The crawler PyCharm window logs a request.
3. The vendor page gets pending AI draft suggestions.
4. The suggestions show source/provenance like:

```text
crawl:https://vendor-site.example/...
```

5. You can accept/reject drafts like normal.

### Step 5.10 — If the button errors

If it says unauthorized / 401:

```text
CRAWLER_SHARED_SECRET does not match between crawler/.env and root .env.local
```

Fix both files, restart both programs.

If it says crawler not configured:

```text
Root .env.local is missing CRAWLER_BASE_URL or CRAWLER_SHARED_SECRET
```

Fix root `.env.local`, restart `npm run dev`.

If it says connection refused / fetch failed:

```text
The crawler is not running at http://localhost:8200
```

Start PyCharm crawler and check `/health`.

If drafts do not appear but no error shows:

```text
The page may not have useful extractable text, or values failed verification/compliance.
```

Try another vendor URL, ideally an About/Story page.

---

## 6. Optional direct crawler test without website

This is useful if you want to prove the crawler works before involving the website.

Make sure the crawler is running in PyCharm.

Open a terminal and run:

```bash
curl http://localhost:8200/health
```

Then run a dry-run research request. Dry-run means it returns possible drafts but does **not** write to Supabase.

Replace `YOUR_SECRET_HERE` with your real `CRAWLER_SHARED_SECRET` from `crawler/.env`.

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

Use a real vendor/brand URL instead of `https://example.com` for a meaningful test.

Keep `write:false` unless you are using a real vendor/brand id from Supabase.

---

## 7. Testing Instagram later

Do this later, after following `SOCIAL_SETUP.md`.

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

Then restart the local website too:

```bash
npm run dev
```

The local back office’s “📸 Pull from Instagram” buttons should become available.

Important: the target vendor account must be a discoverable Instagram business/creator account. Personal/private accounts or accounts Meta does not expose through Business Discovery may return a clean error instead of data.

---

## 8. If PyCharm is not feasible: terminal-only crawler

You can run the crawler without PyCharm.

From the crawler folder:

Windows PowerShell:

```powershell
cd C:\path\to\GREENWAY-WEBSITE\crawler
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m playwright install chromium
copy .env.example .env
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8200 --reload
```

macOS/Linux:

```bash
cd /path/to/GREENWAY-WEBSITE/crawler
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python -m playwright install chromium
cp .env.example .env
uvicorn app.main:app --host 127.0.0.1 --port 8200 --reload
```

Remember to edit `.env` before expecting Supabase writes to work.

---

## 9. If local desktop testing is blocked: one-week cloud fallback

Use this only if your work VM cannot free enough disk space, cannot install Chromium, or cannot run Python packages.

The simplest one-week fallback is a small Ubuntu VM from a provider like DigitalOcean, Hetzner, Linode/Akamai, Vultr, or similar. DigitalOcean is often the most beginner-friendly.

Recommended temporary VM:

```text
Ubuntu 22.04 or 24.04
2 GB RAM minimum
4 GB RAM preferred
1–2 vCPU
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

For a private temporary test from your own computer, use an SSH tunnel instead of opening the crawler publicly:

```bash
ssh -L 8200:localhost:8200 root@YOUR_VM_IP
```

Then your local browser can use:

```text
http://localhost:8200
```

Do not leave a raw crawler port open to the public internet. The worker has `X-Crawler-Secret`, but the permanent professional setup should still use Cloudflare Tunnel or another controlled HTTPS ingress.

---

## 10. The safest testing order for you

Follow this exact order:

1. Free disk space until you have at least 10 GB free, preferably 20–30 GB.
2. Install/check Python 3.11.
3. Install/check Node.js 20.
4. Open `GREENWAY-WEBSITE/crawler` in PyCharm.
5. Create the PyCharm `.venv` interpreter.
6. Install crawler Python packages.
7. Install Playwright Chromium.
8. Create `crawler/.env` using Supabase URL + service role key.
9. Start crawler and confirm `http://localhost:8200/health`.
10. Create/update root `.env.local` with `CRAWLER_BASE_URL=http://localhost:8200` and the same secret.
11. From repo root, run `npm install`.
12. From repo root, run `npm run dev`.
13. Open `http://localhost:3000/admin/vendors`.
14. Click a vendor crawler button using a normal vendor website URL.
15. Review pending drafts.

Once that works locally, moving to the permanent VM is mostly copying the same crawler `.env` values to the server and changing `CRAWLER_BASE_URL` from local `http://localhost:8200` to the future Cloudflare Tunnel URL.
