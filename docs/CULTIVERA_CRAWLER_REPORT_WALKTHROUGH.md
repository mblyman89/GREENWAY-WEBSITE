# Getting the crawler data to the developer: baby steps (R74 round 3)

Owner asked (R74 round 3): "Please walk me through the steps to getting you the crawler data you need. Baby
steps, plain English, every step needs full explanations, every button, every screen every setting, whatever.
I use railway to deploy the crawler if that matters."

**What we need:** one file called `cultivera-run-<run id>-report.txt`, made by the **Download crawler report**
button (R74 S3) on the Fetch It All run page. It contains everything: the stage numbers, the vendor-file
(WCIA JSON) coverage, every fetch error, and the raw `state.json` and `errors.jsonl`. There are no passwords
in it. You never have to open Railway's file system.

There are four parts. Part A is done once. Parts B to D are done each time you test.

---

## Part A: make sure Railway is running the newest crawler (once, about 5 minutes)

**Why:** R74 S2 changed the crawler program (it now counts the vendor files it missed). Railway only runs
the new code after it redeploys. If it is still running the old code, the report will say *"this crawler was
deployed before R74 S2. Redeploy the crawler on Railway"*.

1. **Open Railway.** In your web browser, go to `https://railway.com` and log in. Use the same login you
   used when you set up the crawler.
2. **Open the project.** The first screen is your **Dashboard**, which shows a card for each project. Click
   the project that holds the crawler. It is probably named something like "greenway-crawler".
3. **Open the crawler service.** You now see the project **canvas**: a dark grid with one box (a
   "service") per program. Click the box for the crawler. A panel slides open on the right with tabs across
   the top: **Deployments**, **Variables**, **Metrics** and **Settings**. The wording can differ slightly
   between Railway versions.
4. **Check that it builds from GitHub.** Click **Settings**. Under **Source** it should show the repo
   `mblyman89/GREENWAY-WEBSITE`, branch `main`, and a root directory of `crawler`.
   - If it does, Railway rebuilds by itself every time we merge to `main`. The S2 code (merged as `7e56786c`)
     should already be live, so go on to step 5 just to confirm.
   - If **Source** shows no GitHub repo (the crawler was uploaded by hand), you need step 6.
5. **Look at the newest deployment.** Click **Deployments**. The top row is the newest. It should say
   **Active** (or **Success**) in green. Click the row to see which commit it built. It must be
   **"R74 S2: vendor transfer files (WCIA JSON) fail loud…"** (`7e56786c`) or any later commit. If Railway is set
   to rebuild only when files in `crawler/` change, S2 is the newest crawler commit. S3 and S4 changed only the
   website, which Vercel deploys.
6. **If it is old, or failed: Redeploy.** On the top deployment row, click the **⋮** (three dots) menu and
   choose **Redeploy**. Wait 2 to 4 minutes until the row turns green and says **Active**.
7. **Check the variables (do not change them).** Click **Variables**. You should see
   `CULTIVERA_POS_USERNAME`, `CULTIVERA_POS_PASSWORD` (Railway hides the value) and the shared secret the
   site uses. `CULTIVERA_POS_PACE_SECONDS` and `CULTIVERA_POS_BUDGET_SECONDS` are optional. Leave them out,
   or set them to 0.6 and 1800. If you ever change a variable, Railway asks you to **Deploy** the change. Do it.

> **Important (Railway storage):** the crawler keeps each run's files inside the running container, in
> `crawler/.cache/cultivera_pos/<run id>/`, and keeps the newest 12 runs. Unless a Railway **Volume** is
> attached, a redeploy or restart **wipes those files**. So always do it in this order: **redeploy first, then
> fetch, then download the report**. Never redeploy between the fetch and the download.

---

## Part B: run the fetch (about 8 to 15 minutes, mostly waiting)

1. **Open the admin.** Go to your site's admin and log in as owner, admin or manager. Those are the
   roles allowed to import.
2. **Open Menu Imports.** In the left admin menu, click **Menu Imports** (`/admin/menu-imports`).
3. **Find the Fetch box.** Scroll to the green box titled **"Fetch everything from Cultivera POS"**. If the
   one-time import already went live, it is folded under **"Show one-time import tools"**. Click that to open it.
   - If the box says *"The crawler is not connected"*, the site is missing `CRAWLER_BASE_URL` or
     `CRAWLER_SHARED_SECRET` in Vercel. Stop and tell me.
4. **Set the options.**
   - **Start fresh:** tick it for a dry run. This forces a brand-new harvest. If you leave it off, the
     crawler resumes the newest unfinished run.
   - **Shelf count date:** leave it **blank** for dry runs. It is only for the real 10/30 count fetch, and it
     makes the crawler also read sales.
5. **Press "Fetch It All, Fuck Cultivera".** You land on the **run page**
   (`/admin/menu-imports/fetch/<run id>`). The run id looks like `20261023T150405Z-1a2b3c4d`, which is the
   UTC time it started plus a random tag.
6. **Wait.** The page refreshes itself. The table lists each stage: log in, the two exports, the inventory
   list, transfers, manifest details, batch dates, sales and **Vendor transfer files (lab results)**. Each one
   goes from PENDING to RUNNING to DONE. You can close the tab and come back later. The run keeps going on
   Railway.
   - A red box at the top, or a red **PARTIAL · MISSING** on the vendor-files row, is the loud warning from S2.
     That is exactly what we want to see in the report. Do not try to fix it. Just carry on.
   - If the harvest says **FAILED** or **CANCELLED**, you can still do Part C. The report works for every
     run state.

---

## Part C: download the report (1 minute)

1. **Stay on the run page**, or reopen it: Menu Imports → Fetch box → "Recent fetches" → click the run id.
2. **Scroll to "Crawler report (for support)".** It sits right under the stage table.
3. **Click "Download crawler report".** Your browser saves a file named
   `cultivera-run-<run id>-report.txt` to your Downloads folder. On an iPhone, Safari may show it in a new tab
   instead. Tap the share icon and choose **Save to Files**.
4. **Optional raw files.** Next to the button are three small links: `state.json`, `errors.jsonl` and
   `manifest.json`. Everything in them is already inside the report. Only click them if I ask.
   - `errors.jsonl` may answer *"not in this run"*. That is good news: the crawler only writes that file when
     something failed.

---

## Part D: send it to me

1. Start a new chat with me and attach the `.txt` file, using the paperclip or upload button.
2. In the same message, tell me:
   - whether this was **Test mode** or not, if you also staged it;
   - anything you saw on screen that looked wrong (a screenshot is fine);
   - whether you **redeployed** the crawler first (Part A, step 6).

That's it. I get the stage numbers, the vendor-file gap with the exact transfer ids, and the reason for each
error, without anyone needing to open Railway's logs or file system.

---

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| "Could not reach the crawler" on the run page | The Railway service is asleep, crashed or redeploying | Railway → crawler → Deployments. Wait until it is **Active**, then reload |
| Report section 1 says "state.json could not be read" | The run's files are gone, most likely from a redeploy or restart after the fetch | Run Part B again, then Part C, with no redeploy in between |
| Report says "deployed before R74 S2" | Railway is still on old crawler code | Part A, step 6 (Redeploy), then fetch again |
| 404 when you click the button | The run id is wrong or older than the newest 12 runs | Open a run from "Recent fetches" |
| Logged out / "not allowed" | The download needs the menu-import permission | Log in as owner, admin or manager |

## Railway logs (only if I ask)

Railway → crawler service → **Deployments** → click the Active row → **View Logs** (or the **Logs** tab). The
crawler logs one line per action (`phase_a_end status=… seconds=… calls=…`). Click the **download** /
**export** icon, or select all and copy, then paste the text into a `.txt` file and attach it. The logs
never contain the Cultivera password.
