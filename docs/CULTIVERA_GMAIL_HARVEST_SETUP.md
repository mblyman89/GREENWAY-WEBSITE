# Setting up Google so the site can read stephen@ (the Cultivera email harvest)

R74, round 4. Written for Michael. Plain English, one step at a time.

## What this is for, in one paragraph

Every Cultivera manifest was emailed to **stephen@greenwaymarijuana.com**. Some products in Cultivera
(about 148 lots) have no manifest that the crawler can find. The email harvest reads stephen@'s
mailbox, back as far as it goes, and pulls out the vendor files attached to those emails (the
transfer JSON, the manifest PDF, invoices, COAs). The site only ever **reads**. It cannot send,
delete, move or mark anything. Google calls this permission `gmail.readonly`.

## The short version (if you already set up the CCRS email monitor)

The CCRS email monitor (Admin → Compliance → CCRS → "Check the mailbox now") already uses this same
Google sign-in. **If that button works today, you are almost done.** Google's approval (it is called
"domain-wide delegation") covers **every mailbox in greenwaymarijuana.com**, not just michael@. So:

1. Make sure stephen@ is still an active Google Workspace user (Part A, step A3).
2. Optional: set `CULTIVERA_HARVEST_MAILBOX` on Vercel (Part E). If you leave it unset, the site uses
   stephen@greenwaymarijuana.com.
3. Press **Test the vendor mailbox** (Part F).

If the CCRS button has never worked, or you never set it up, do Parts A to F in order. It takes about
30 minutes of clicking. Google says the last approval "might take up to 24 hours" to switch on.

---

## Part A. Check the mailbox itself (2 minutes)

A1. On a computer, open **https://admin.google.com** and sign in with your Google Workspace admin
account (the one you use to add employees' email).

A2. In the left menu, click **Directory**, then **Users**.

A3. Find **Stephen** (stephen@greenwaymarijuana.com) in the list.
   - The status must say **Active**. If it says **Suspended**, click the name, then **Reactivate**.
     Google refuses to read a suspended user's mail, and the test button will say so.
   - If stephen@ was deleted, its mail is gone from Gmail and the harvest cannot read it. Tell me,
     and we will plan around it.

Why: the site reads mail "as" stephen@. Google only allows that for a real, active mailbox.

---

## Part B. Vercel: turn on the secure sign-in (3 minutes)

The site proves to Google who it is with a short-lived pass that Vercel issues. There is no password
or key file to lose.

B1. Open **https://vercel.com** and sign in.

B2. Click the project **greenway_website**.

B3. Click **Settings** (top menu), then **Security** (left menu).

B4. Find **Secure backend access with OIDC federation**. Turn it **ON**.

B5. Under issuer mode, choose **Team**. Click **Save**.

Write these down. You need them in Part C. They are Greenway's real values:

| What | Value |
|---|---|
| Issuer URL | `https://oidc.vercel.com/michael-lymans-projects` |
| Audience | `https://vercel.com/michael-lymans-projects` |
| Subject (production) | `owner:michael-lymans-projects:project:greenway_website:environment:production` |

---

## Part C. Google Cloud: the project, the two APIs, the trust link (15 minutes)

C1. Open **https://console.cloud.google.com** and sign in with the same Workspace admin account.

C2. At the top left, next to "Google Cloud", is the **project picker**.
   - If you already made a project for the CCRS monitor, pick it.
   - If not: click the picker → **New project** → name it `greenway-mail` → **Create**. Wait for it,
     then pick it.

C3. On the project's **Dashboard** (the home page), find **Project number**. It is all digits, for
example `123456789012`. Write it down. **Do not use the "Project ID"**, which has letters.

C4. Turn on the two APIs:
   - In the top search bar, type **Gmail API** and click it. Click **Enable**.
   - Search **IAM Service Account Credentials API** and click it. Click **Enable**.

C5. Create the trust link with Vercel (Google calls it a "Workload Identity pool"):
   - Search **Workload Identity Federation** and open it (it is under IAM & Admin).
   - Click **Create pool**. Name `vercel`, Pool ID `vercel`. Click **Continue**.
   - Add a provider: choose **OpenID Connect (OIDC)**.
     - Provider name `vercel`, Provider ID `vercel`.
     - Issuer (URL): the Issuer URL from Part B.
     - Audiences: choose **Allowed audiences** and paste the Audience from Part B.
     - Click **Continue**.
   - Attribute mapping: set **google.subject** = `assertion.sub`. Click **Save**.

C6. Create the robot account that does the reading (a "service account"):
   - Search **Service Accounts** (IAM & Admin) → **Create service account**.
   - Name `ccrs-mail`. Click **Create and continue**.
   - **Do not grant any project role.** Click **Done**.
   - **Do not create a key.** Google blocks keys for new organisations anyway; we do not need one.
   - Click the new account. Write down its **Email** (it ends in `.iam.gserviceaccount.com`) and its
     **Unique ID** (a long number, also called the "OAuth 2 Client ID"). You need the Unique ID in Part D.
   - If the CCRS monitor already has a service account, reuse it. Do not make a second one.

C7. Let Vercel use the robot account:
   - Still on the service account, open the **Permissions** tab (some screens call it **Principals with
     access**) → **Grant access**.
   - New principal: paste this, replacing `PROJECT_NUMBER` with your number from C3:
     `principal://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/vercel/subject/owner:michael-lymans-projects:project:greenway_website:environment:production`
   - Role: **Service Account Token Creator**. Click **Save**.

---

## Part D. Google Workspace: allow reading mail (3 minutes plus Google's wait)

D1. Back at **https://admin.google.com**.

D2. Left menu: **Security** → **Access and data control** → **API controls**.

D3. At the bottom, click **Manage Domain Wide Delegation**.

D4. If the robot's Unique ID (C6) is already listed with `https://www.googleapis.com/auth/gmail.readonly`,
    **you are done with this part**. Do nothing; it already covers stephen@.

D5. If not, click **Add new**:
   - Client ID: the **Unique ID** from C6 (the number, not the email).
   - OAuth scopes: `https://www.googleapis.com/auth/gmail.readonly`
   - Click **Authorize**.

Google says this "might take up to 24 hours". It is usually minutes.

Why this is safe: `gmail.readonly` cannot send, delete, label or change anything.

---

## Part E. Vercel: the settings (5 minutes)

E1. Vercel → **greenway_website** → **Settings** → **Environment Variables**.

E2. Add each of these for **Production** (skip any that already exist with the right value):

| Name | Value |
|---|---|
| `GMAIL_WIF_SERVICE_ACCOUNT_EMAIL` | the service account Email from C6 |
| `GMAIL_WIF_PROJECT_NUMBER` | the Project number from C3 (digits only) |
| `GMAIL_WIF_POOL_ID` | `vercel` |
| `GMAIL_WIF_PROVIDER_ID` | `vercel` |
| `CULTIVERA_HARVEST_MAILBOX` | `stephen@greenwaymarijuana.com` (optional: this is already the default) |

E3. If any variable starting with `GMAIL_SA_` or `GMAIL_OAUTH_` exists, **delete it**. The site refuses
    to sign in when two sign-in methods are set, and it says so.

E4. Changes only apply after a redeploy: **Deployments** → the top (newest) one → the **⋯** menu →
    **Redeploy** → **Redeploy**.

After the migration, change `CULTIVERA_HARVEST_MAILBOX` to `vendor_intake@greenwaymarijuana.com` and
redeploy. No Google change is needed for that.

---

## Part F. Test it (1 minute)

F1. Open the **production** site (www.greenwaymarijuana.com/admin). The sign-in is set up for
    production only, so a preview link will not work.

F2. Go to **Admin → Menu imports**, scroll to **Vendor mailbox (email harvest)**.
   - The line under the heading should be green: *"Ready to read stephen@greenwaymarijuana.com (sign-in:
     workload-identity, read-only)."*
   - Gold means a setting is missing or wrong, and it names which one.

F3. Click **Test the vendor mailbox**. It signs in and runs the vendor-document search once. It opens no
    email and stores nothing.
   - Green banner *"Signed in to stephen@ … finds emails"*: everything works.
   - Red banner: copy the whole text to me. Common ones:

| The red text says | What it means / what to do |
|---|---|
| `unauthorized_client` | Part D is missing or not active yet. Check the Unique ID and the scope, or wait (up to 24 h). |
| `invalid_grant` … `Invalid email or User ID` | stephen@ is suspended or does not exist (Part A). |
| `turn on the Gmail API` | C4: the Gmail API is not enabled on that project. |
| `Service Account Token Creator` | C7 is missing; the message prints the exact principal to paste. |
| `invalid_target` / `does not exist` | The pool or provider ID, or the project number, is wrong (C3, C5, E2). |
| `Both the … variables are set` | E3: delete the old `GMAIL_SA_*` or `GMAIL_OAUTH_*` variables. |
| `OIDC` / `no Vercel token` | Part B is off, or the site was not redeployed after it (E4). |

---

## What the harvest reads, exactly

Status (R74 S7): the harvest runs. After Google is set up and database update **0293** is applied
(docs/MIGRATIONS_TO_RUN.md), Menu imports -> Vendor mailbox has **Harvest the next batch**. Each press
reads up to 47 more emails (about 3 minutes at most) and keeps every vendor file privately; press it
again until the line under it says **Finished**. Nothing in the mailbox changes (read-only), and
pressing twice never stores anything twice. Moving the lots onto the emailed manifests is the next
Wave 2 slice.

- The search is: any email with a `.json`, `.pdf`, `.csv`, `.xlsx` or `.xls` attachment, or whose text
  says manifest, invoice, COA, "certificate of analysis", "transfer data" or WCIA. Chat messages are
  excluded.
- There is **no start date**: it walks back to the oldest email in the mailbox ("as far back as you are
  allowed").
- It will work in short runs and remember its place (a bookmark Gmail hands back), so years of mail are
  read over several runs without starting over.
- Google's limit is 6,000 "units" per mailbox per minute. Opening one email costs 60 units and each
  attachment 20, so a run will open about 47 emails with two attachments each. That keeps it under the limit
  with room to spare.
- Attachments are downloaded as exact bytes. A PDF must really start like a PDF, and a JSON like a JSON,
  before anything reads it. A file that does not match its name is reported, never parsed.

## Reading the kept PDFs and spreadsheets (R74 S9)

When the harvest finds a PDF or spreadsheet, it keeps the file as "kept to read later". Under
**Harvest the next batch** there is a second button, **Read the kept PDFs and spreadsheets**. Each
press (R74 S19) reads five files at once, newest email first, for about three minutes (up to 100
files), so keep pressing until it says **Finished**.

**Or press once and walk away (R74 S20).** Below it, **Read everything in the background** reads for
about three minutes right away, then the every-minute worker keeps reading (five at a time, newest
email first) until nothing is left, even with the page closed. Press it before bed; the status line
shows how many were read, how many are left and the last run. **Pause background reading** stops it
(documents already being read finish). If LlamaParse is unavailable it waits rather than reading the
PDFs another way, and after three failed runs in a row it pauses itself and the line says why. It needs no new
database update; 0293 is enough.

- **PDFs are read by LlamaParse.** This is the same AI reader the inbox intake uses, and it can read
  scanned PDFs. It needs the Vercel setting `LLAMA_CLOUD_API_KEY`. The intake already uses this
  setting, so it is most likely set. If it is missing or LlamaParse is down, the button still works,
  but it only reads the PDF's own text, so scanned PDFs come back "without barcodes". The note on
  each document says which reader ran. LlamaParse usage is logged under the feature
  `cultivera-mail-read`.
- **Every barcode LlamaParse reads is checked against the PDF's own text.** If a barcode appears
  only in the AI reading, it is dropped and counted, never guessed.
- **Spreadsheets (.xlsx) are read cell by cell, without AI.** A barcode is only taken from a column
  whose header names it, such as Barcode, Inventory ID, Lot ID or External Identifier. An old .xls
  file is marked "without barcodes" with the reason. To read one, open it in Excel and use Save As
  .xlsx.
- If storage is unreachable, the press stops and says so. Nothing is lost: the file is read on the
  next press.
