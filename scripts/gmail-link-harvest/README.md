# Gmail Transfer-Link Harvester (owner-run, read-only)

Pulls every Cultivera **"WCIA Transfer Data Link"** out of 12+ months of order
emails and writes them to `transfer-links.txt` — ready to paste into the back
office **Batch import** panel (Inventory → Receiving), which stages every
manifest as a pending draft. Then one click of **"Promote all manifests to KB
drafts"** seeds the Knowledge Base.

## Why this is safe

- **Runs only on YOUR computer.** Nothing about your email ever touches the
  website, the database, or any third party.
- **You never type your password into this script.** You sign in in your own
  browser on Google's standard consent screen (OAuth). The script receives a
  token limited to **read-only** Gmail access (`gmail.readonly`) — it cannot
  send, delete, or change anything.
- **Zero dependencies.** The script uses only what ships with Node.js — there
  is no `npm install`, so there is no third-party code to trust.
- **Easy to revoke.** Delete `token.json` in this folder to sign out locally;
  revoke the app entirely at <https://myaccount.google.com/permissions>.

## One-time setup (about 10 minutes)

### Step 1 — Install Node.js (if you don't have it)

1. Open a terminal (Mac: **Terminal** app; Windows: **PowerShell**).
2. Run `node --version`. If you see `v18` or higher, skip to Step 2.
3. Otherwise download the LTS installer from <https://nodejs.org> and run it,
   then re-open the terminal and check `node --version` again.

### Step 2 — Create a (free) Google Cloud project with the Gmail API

1. Go to <https://console.cloud.google.com/> and sign in with the Google
   account that receives the Cultivera order emails.
2. Top bar → project picker → **New Project**. Name it e.g.
   `greenway-link-harvest` → **Create** → make sure it's selected.
3. Left menu → **APIs & Services → Library** → search **Gmail API** →
   **Enable**.

### Step 3 — Configure the consent screen

1. **APIs & Services → OAuth consent screen**.
2. If asked for a user type, pick **External** → **Create**. (With Google
   Workspace you may see **Internal** — that's fine too and even simpler.)
3. Fill in only the required fields: app name (`Greenway Link Harvest`), your
   email as user-support email and developer contact → **Save and Continue**
   through the remaining screens (no scopes need adding here).
4. If your app is **External**, open **Audience** (or "Test users") and add
   your own Gmail address as a **test user**. While the app is in "Testing"
   mode only listed test users can sign in — that's exactly what we want; do
   NOT publish the app.

### Step 4 — Create the Desktop-app credential

1. **APIs & Services → Credentials → + Create Credentials → OAuth client ID**.
2. Application type: **Desktop app**. Name: `harvester` → **Create**.
3. Click **Download JSON** on the new client.
4. Rename the downloaded file to exactly `credentials.json` and put it in this
   folder (`scripts/gmail-link-harvest/`), next to `harvest.mjs`.

> `credentials.json` and `token.json` are git-ignored — they stay on your
> machine and can never be committed.

## Running it

From the repository root:

```bash
cd scripts/gmail-link-harvest
node harvest.mjs --after 2024/06/01
```

1. The script prints a Google URL — open it, pick the right account, and click
   **Continue/Allow**. (If Google shows "app isn't verified", click
   **Advanced → Go to … (unsafe)** — that warning appears for every personal
   test-mode app; it is YOUR app, restricted to you as a test user.)
2. The browser tab says "Signed in" — return to the terminal.
3. The script searches your mail, reads each matching email, and writes:
   - `transfer-links.txt` — one link per line (this is what you paste)
   - `transfer-links.csv` — date/from/subject/url audit trail
4. Re-runs skip the browser step (token is cached in `token.json`).

### Useful options

```bash
node harvest.mjs --self-test                 # verify the extractor (no Gmail access)
node harvest.mjs --after 2024/01/01 --before 2025/01/01
node harvest.mjs --query 'from:cultivera "Transfer Data Link"'
node harvest.mjs --all-json                  # keep every .json link, not just Cultivera
```

The default search is the exact phrase `"Transfer Data Link"`, which appears in
every Cultivera order email ("Copy and paste the following WCIA Transfer Data
Link into your system to import your order"). The doubled-link bug some emails
carry (`https://files.cultivera.com/https://files.cultivera.com/...`) is fixed
automatically, and duplicates are removed.

## Feeding the back office

1. Open the back office → **Inventory → Receiving**.
2. In **"Batch import — paste many Transfer Data Links"**, paste the contents
   of `transfer-links.txt` (up to 500 per run — for more, paste in batches).
3. Click **Fetch & stage**. Watch the per-link results; already-imported links
   are skipped automatically, so re-running an overlapping list is safe.
4. Review the staged manifests (they're pending drafts — nothing activates).
5. Click **"⚡ Promote all manifests to KB drafts"** once at the end: every
   product line's verified facts (name, strain, category, vendor, COA potency)
   become Knowledge Base drafts for your team to validate.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `credentials.json not found` | The downloaded JSON isn't in this folder or isn't named exactly `credentials.json`. |
| `Error 403: access_denied` at sign-in | Your email isn't listed as a **test user** on the consent screen (Step 3.4). |
| "App isn't verified" warning | Expected for a personal test-mode app — **Advanced → Go to … (unsafe)**. |
| `Token request failed` after a long time | Delete `token.json` and run again (testing-mode refresh tokens expire after ~7 days of no use). |
| `No matching emails found` | Try `--query 'from:cultivera'` or widen/remove `--after`. |
| Matched emails but 0 links | Run with `--all-json` and check `transfer-links.txt`; email format may have changed. |
