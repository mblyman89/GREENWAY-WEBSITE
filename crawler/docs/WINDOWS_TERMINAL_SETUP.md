# Greenway Crawler — Windows VM Setup via Terminal (PowerShell) ONLY

**Question answered:** *Can I set up the crawl4ai crawler on my Windows VM using only the terminal?*
**Yes.** The crawler is a Python service and crawl4ai is a Python package. The only "heavy" piece is
the Chromium browser it drives (via Playwright), and that installs entirely from the command line
with one command (`playwright install`). **No GUI, no PyCharm, no Docker required.** Everything below
runs in **Windows PowerShell**.

> The Windows terminal is called **PowerShell** (or **Windows Terminal**, which is a nicer wrapper
> around PowerShell). Either works. Open the Start menu, type **PowerShell**, right-click →
> **Run as administrator** for the install steps.

---

## What you'll end up with
A local web service running on your VM at `http://localhost:8200` that:
- takes a "research this vendor/brand" request from your site,
- crawls the public page, extracts info, runs the WA compliance scan,
- writes **drafts** into Supabase for staff to review.

For a **first test**, running it locally like this is perfect. Making it reachable from your live
Vercel site later needs a Cloudflare Tunnel — but that's a *separate, optional* step (Part 6). Let's
get it running locally first.

---

## PART 1 — Install the prerequisites (one time)

### 1.1 Install Python 3.11+
1. Go to https://www.python.org/downloads/ and download **Python 3.12** (Windows installer, 64-bit).
2. Run the installer. **CHECK the box "Add python.exe to PATH"** at the bottom of the first screen.
   (This is the #1 thing people miss — without it, `python` won't work in the terminal.)
3. Click **Install Now**, let it finish, close the installer.
4. **Close and reopen PowerShell**, then verify:
   ```powershell
   python --version
   ```
   You should see something like `Python 3.12.x`. If it says "not recognized," Python isn't on PATH —
   re-run the installer and tick that box, or reboot.

### 1.2 Install Git (so you can pull the code)
1. Download from https://git-scm.com/download/win and install with all defaults.
2. Reopen PowerShell and verify:
   ```powershell
   git --version
   ```

---

## PART 2 — Get the crawler code onto the VM

Pick a folder to work in (Documents is fine). In PowerShell:

```powershell
cd $HOME\Documents
git clone https://github.com/mblyman89/GREENWAY-WEBSITE.git
cd GREENWAY-WEBSITE\crawler
```

> If you already have the repo on the VM, just `cd` into its `crawler` folder instead of cloning.

You should now be inside `...\GREENWAY-WEBSITE\crawler`. Confirm you see the app files:
```powershell
dir
```
You should see `requirements.txt`, `app`, `docs`, `.env.example`, etc.

---

## PART 3 — Create the Python environment & install everything

### 3.1 Create and activate a virtual environment
```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```
Your prompt should now start with `(.venv)`.

> **If activation is blocked** with a red "running scripts is disabled" error, run this once
> (as administrator) to allow local scripts, then re-run the Activate line:
> ```powershell
> Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
> ```
> Answer `Y` when prompted. This is safe and standard for developer machines.

### 3.2 Install the Python dependencies (this includes crawl4ai)
```powershell
python -m pip install --upgrade pip
pip install -r requirements.txt
```
This pulls in FastAPI, crawl4ai, Supabase client, etc. It'll take a couple minutes.

### 3.3 Install the Chromium browser crawl4ai drives
This is the step people get stuck on — but it's just one command:
```powershell
python -m playwright install chromium
```
That downloads a self-contained Chromium into your user profile. On Windows you do **not** need the
`--with-deps` flag (that's a Linux-only thing for system libraries). Just `chromium` is correct here.

> If you ever see errors like *"browser not found"* or *"drafts not supported by source / empty,"*
> it almost always means this step didn't run — just run it again.

---

## PART 4 — Configure the crawler (.env file)

### 4.1 Create your .env from the template
```powershell
Copy-Item .env.example .env
notepad .env
```
Notepad opens the file. Fill in these values (leave the rest at their defaults for a first test):

| Setting | What to put | Notes |
|---|---|---|
| `CRAWLER_ENV` | `development` | Leave as development for local testing. In `production` it REFUSES to start unless `CRAWL_ALLOW_DOMAINS` is set. |
| `CRAWLER_SHARED_SECRET` | a long random string | Generate one — see 4.2 below. Your site sends this to prove it's allowed to call the crawler. |
| `SUPABASE_URL` | `https://YOURPROJECT.supabase.co` | From your Supabase project settings → API. |
| `SUPABASE_SERVICE_ROLE_KEY` | your **service role** key | Supabase → Settings → API → `service_role` secret. Server-side only — this worker isn't public. |
| `AI_API_KEY` | *(optional)* your OpenAI key | **Leave EMPTY for the first test** — the CSS-first extraction works without the LLM. Add later to enable smart extraction. |
| `AI_BASE_URL` / `AI_MODEL` | defaults are fine | Only used when `AI_API_KEY` is set. |
| `CRAWL_ALLOW_DOMAINS` | leave empty for now | In development, empty = allow any host you submit. **Required** in production. |

Save and close Notepad.

### 4.2 Generate the shared secret
Run this and paste the output into `CRAWLER_SHARED_SECRET` in your `.env`:
```powershell
python -c "import secrets; print(secrets.token_urlsafe(40))"
```
Keep this value — you'll paste the **same** value into your site's `CRAWLER_SHARED_SECRET` later.

---

## PART 5 — Run it and test locally

### 5.1 Start the service
Make sure `(.venv)` is still active, then:
```powershell
uvicorn app.main:app --host 0.0.0.0 --port 8200
```
You should see uvicorn print `Application startup complete` and `Uvicorn running on http://0.0.0.0:8200`.
**Leave this window open** — closing it stops the crawler.

### 5.2 Confirm it's alive (open a SECOND PowerShell window)
```powershell
curl http://localhost:8200/health
```
(or open `http://localhost:8200/docs` in a browser on the VM to see the interactive API page.)
A healthy response means the crawler is running. 🎉

### 5.3 Stopping it
In the window running uvicorn, press **Ctrl + C**.

---

## PART 6 — (OPTIONAL, LATER) Make your live site reach it

Everything above runs the crawler **locally on the VM**. Your live site is on Vercel, which can't
reach `localhost` on your VM. To connect them **without opening any inbound firewall port**, use a
**Cloudflare Tunnel**. This is optional and only needed when you want the "Research with the crawler"
button working from the production site.

Short version (full expert walkthrough is in `IT_DEPLOYMENT_GUIDE.md`):
1. Install `cloudflared` on the VM (Cloudflare's tunnel agent — also a terminal install).
2. `cloudflared tunnel login`, create a tunnel, route a hostname like
   `crawler.greenwaymarijuana.com` to `http://localhost:8200`.
3. In **Vercel** env vars, set:
   - `CRAWLER_BASE_URL` = `https://crawler.greenwaymarijuana.com`
   - `CRAWLER_SHARED_SECRET` = the **same** secret you put in the VM's `.env`
4. Redeploy the site. The "Research" button now reaches your VM through the tunnel.

For a **permanent, always-on** service (survives reboots/logoff), you'd also want to run uvicorn as a
Windows Service — the simplest robust way is **NSSM** (Non-Sucking Service Manager), a free tool that
turns any command into a Windows service. That's beyond a first test, but say the word and I'll write
you an exact NSSM step-by-step.

---

## Troubleshooting cheat-sheet

| Symptom | Cause | Fix |
|---|---|---|
| `python` not recognized | Python not on PATH | Reinstall Python, tick "Add to PATH", reopen PowerShell |
| `Activate.ps1 cannot be loaded` | Execution policy | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` then retry |
| `pip install` fails on lxml/build | missing build tools (rare on Win) | Ensure you're on the official python.org build; retry `pip install -r requirements.txt` |
| Crawler starts but drafts are empty / "not supported by source" | Chromium not installed | `python -m playwright install chromium` |
| Worker refuses to start in production | `CRAWLER_ENV=production` but no `CRAWL_ALLOW_DOMAINS` | Set `CRAWL_ALLOW_DOMAINS=brand1.com,brand2.com` (this is the S-5 safety gate) |
| Site can't reach crawler | it's only on localhost | Do Part 6 (Cloudflare Tunnel) + set `CRAWLER_BASE_URL` in Vercel |

---

## The 60-second version (once prerequisites are installed)
```powershell
cd $HOME\Documents\GREENWAY-WEBSITE\crawler
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m playwright install chromium
Copy-Item .env.example .env       # then edit .env (secret + Supabase keys)
uvicorn app.main:app --host 0.0.0.0 --port 8200
```

That's the whole thing — 100% terminal, no GUI needed.
