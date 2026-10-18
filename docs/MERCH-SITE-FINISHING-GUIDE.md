# Greenway Merch: the one finishing guide

This guide covers everything needed to finish greenwaymerch.com and the merch parts of the back office (greenwaymarijuana.com). Follow it from top to bottom. Each step says where to click, what to type, and why.

There are two websites, and each has its own **Vercel project**:

| Website | Vercel project | What it is |
| --- | --- | --- |
| greenwaymarijuana.com | `greenway_website` (the main project) | The store website and back office, including **Merch Studio** at `/admin/merch-studio` |
| greenwaymerch.com | the merch project (Root Directory `merch-site`) | The online merch shop customers buy from |

Both projects build from the same GitHub repo. Each one has its own list of **environment variables** ("env vars"), and you add them in each project separately.

> **What's an environment variable?** A labelled box holding a secret or a setting, like a password. The code reads the box by its name. You type the name exactly as written here, in CAPITALS with underscores, and then paste the value.

---

## Part 0. What was broken, and what was fixed (already done for you)

### 0.1 "This page hit a snag" on Merch Studio (iPad and MacBook)

**What happened.** The Merch Studio page has two halves. A server half gets the page ready, and a browser half shows the buttons and tabs. The server half tried to use a list of tab names that lives inside the browser half. Next.js forbids this: on the server, the browser half is only a placeholder, so the server crashed every time, on every device. That's why it hit your MacBook too.

**The fix.** The tab list moved into a small shared file that both halves can read. The same hidden mistake was also waiting on the payroll run page (`/admin/payroll/<id>`), and that's fixed too. We also added an automatic test that scans the whole codebase for this mistake, so it can't come back.

### 0.2 Vercel couldn't finish deploying greenwaymerch.com (`ENOENT … /vercel/path0/.next/package.json`)

**What happened.** The site built fine. In the very last step, Vercel looked for the finished files in the wrong folder: the repo's top folder instead of `merch-site/`. This is a known bug between Next.js 16 and Vercel when a site lives in a sub-folder (vercel/vercel issue #15937). Because no deployment ever finished, your domains showed **"No Deployment"**.

**The fix.** The merch site now tells Next.js where the repo's top folder is, so Vercel looks in the right place. It also builds with Next's standard webpack builder, so the build never touches the main site's files. We tested this with a full production build: it succeeded, and the output was labelled `merch-site` correctly.

**What you need to do:** nothing, as long as this change is merged to `main`. Vercel then builds the merch site by itself. Part 2 shows how to check it.

---

## Part 1. Make your secret tokens (the "32-character token" question)

Some variables need a long random password that you invent. You don't sign up anywhere for these. Your Mac makes them in one second.

**You need three random tokens:**

| Token | Used for | Same value in both projects? |
| --- | --- | --- |
| Token A, `MERCH_CATALOG_TOKEN` | Lets greenwaymerch.com read the products you publish in Merch Studio | **YES**: paste the exact same value in BOTH Vercel projects |
| Token B, `MERCH_ADMIN_KEY` | The password you type to open `greenwaymerch.com/admin/orders` | Merch project only |
| Token C, `PRINTFUL_WEBHOOK_TOKEN` | Secret part of the web address Printful uses to say "this order shipped" | Merch project only |

**How to make one (baby steps):**

1. On your MacBook, press **⌘ Command + Space**. A search bar appears.
2. Type **Terminal** and press **Return**. A window with a blinking cursor opens.
3. Click in that window and type exactly this, then press **Return**:

   ```
   openssl rand -hex 32
   ```

4. A line of 64 letters and numbers appears, for example `9f2c4e…` (yours will be different). That's your token. 64 characters is more than the 32 minimum, which is good: longer is safer.
5. Highlight the whole line with your mouse, press **⌘ Command + C** to copy it, and paste it into the matching Vercel variable (Part 3).
6. Press the **↑ Up arrow** and then **Return** to make the next token. **Each token must be different.** Make three in total.

> Keep a copy in a safe place, like a password manager or a locked note. You'll need Token B every time you log in to the orders page. You can always make new ones later. Just update Vercel afterwards (and, for Token A, update both projects).

---

## Part 2. Get greenwaymerch.com working (Vercel, merch project)

### 2.1 Check the project settings (one time)

1. Go to **vercel.com** and sign in.
2. Click the **merch project** (the one with greenwaymerch.com in its Domains).
3. Click **Settings** at the top, then **Build and Deployment** in the left menu (on some accounts it's called **General**).
4. Check these:
   - **Root Directory**: `merch-site`
   - **Framework Preset**: `Next.js`
   - **Build Command**: the "Override" switch is **OFF**. The project's own `npm run build` now does the right thing.
   - **Output Directory**: Override **OFF**.
   - **Install Command**: Override **OFF**.
5. If you changed anything, click **Save**.

### 2.2 Make sure a deployment exists

Merging this fix changes files inside `merch-site/`, so Vercel builds and deploys the merch site automatically. (It deliberately skips builds when nothing in `merch-site/` changed. That saves build minutes.)

1. In the merch project, click **Deployments**.
2. The newest one at the top should go **Building** → **Ready** (green dot) within a few minutes.
3. If it says **Error**, click it, click **Build Logs**, and send me the last 30 lines.
4. To re-run a deployment by hand later, for example after changing an env var: click the **⋯** (three dots) next to the latest **Production** deployment, then **Redeploy**, then **Redeploy** again.

> **Important:** environment variable changes only take effect after a new deployment. Every time you add or change variables, redeploy (step 4).

### 2.3 Pick ONE main address, and why it matters for payments

Your Domains page shows `greenwaymerch.com` **308-redirecting** to `www.greenwaymerch.com`. Shoppers won't notice, but **Stripe counts any redirect as a failed webhook** (Stripe's own docs: "We consider redirect responses to webhook requests as failures"). If you leave it like this and tell Stripe `https://greenwaymerch.com/...`, paid orders never reach Printful.

The code, the README and every URL in this guide use **`greenwaymerch.com` without www**, so make that the main address:

1. Merch project → **Settings** → **Domains**.
2. Next to **greenwaymerch.com**, click **Edit**. Set the **Redirect to** dropdown to **No redirect** (connect it to Production). Click **Save**.
3. Next to **www.greenwaymerch.com**, click **Edit**. Set **Redirect to** = `greenwaymerch.com` (308 Permanent). Click **Save**.
4. Leave `greenway-merch-website.vercel.app` alone. It's Vercel's built-in address.
5. Once the deployment is **Ready**, open **https://greenwaymerch.com** in a browser. You should see the shop, and the address bar should stay on `greenwaymerch.com`.

> Vercel's own docs slightly prefer www as the main address, but they say non-www also works, and the code defaults to non-www. If you'd rather keep **www** as the main address, that also works. In that case, use `https://www.greenwaymerch.com` everywhere this guide says `https://greenwaymerch.com`: in `MERCH_SITE_URL`, the Stripe webhook URL, and the Printful webhook URL.

**How you reach the site:** type `greenwaymerch.com` in any browser. Your private orders page is `greenwaymerch.com/admin/orders`, and it asks for Token B.

---

## Part 3. Every variable, every value

### 3.1 Merch project (greenwaymerch.com)

Where to add them: merch project → **Settings** → **Environment Variables**. For each one, type the **Key** (name) and **Value**, tick **Production** (and Preview, if you like), and click **Save**. Turn on **Sensitive** for anything secret (keys, tokens, passwords).

| # | Name | Need it? | Value to use |
| --- | --- | --- | --- |
| 1 | `MERCH_SITE_URL` | yes | `https://greenwaymerch.com` (no slash at the end) |
| 2 | `NEXT_PUBLIC_MERCH_CONTACT_EMAIL` | yes | `contact@greenwaymerch.com` ✅ you've done this |
| 3 | `NEXT_PUBLIC_MERCH_CONTACT_PHONE` | recommended | your customer-service phone, e.g. `(360) 555-0123` |
| 4 | `NEXT_PUBLIC_MERCH_BUSINESS_ADDRESS` | recommended | one line, e.g. `123 Main St, Olympia, WA 98501` (shown on the policy pages) |
| 5 | `MERCH_ORDER_ALERT_EMAIL` | yes | `orders@greenwaymerch.com` ✅ you've done this. Problem alerts go here. |
| 6 | `RESEND_API_KEY` | yes | your Resend key (starts `re_`) ✅ you've done this. See Part 4. |
| 7 | `MERCH_EMAIL_FROM` | **yes** | `Greenway Merch <orders@greenwaymerch.com>`. See Part 4. |
| 8 | `STRIPE_SECRET_KEY` | yes | the **LLC's** Stripe secret key, `sk_live_…`. See Part 5. |
| 9 | `STRIPE_WEBHOOK_SECRET` | yes | `whsec_…` from the Stripe webhook. See Part 5. |
| 10 | `MERCH_SHIP_FLAT_CENTS` | **yes** | shipping per order **in cents**, e.g. `599` = $5.99. Checkout stays closed until this is set. Write `599`, not `5.99`. |
| 11 | `MERCH_SHIP_EXTRA_ITEM_CENTS` | optional | extra per additional item, in cents, e.g. `200` |
| 12 | `MERCH_FREE_SHIP_OVER_CENTS` | optional | free shipping at or above this subtotal, in cents, e.g. `7500` = $75 |
| 13 | `MERCH_SHIP_MIN_DAYS` | optional | fewest business days shown at checkout, e.g. `3` |
| 14 | `MERCH_SHIP_MAX_DAYS` | optional | most business days shown at checkout, e.g. `8` |
| 15 | `MERCH_STRIPE_AUTOMATIC_TAX` | after Stripe Tax setup | `true`. Only add this after step 5.4. |
| 16 | `PRINTFUL_API_TOKEN` | yes | the LLC's Printful private token. See Part 6. |
| 17 | `PRINTFUL_STORE_ID` | only sometimes | only if your token is an **Account**-level token. See 6.2. |
| 18 | `PRINTFUL_WEBHOOK_TOKEN` | yes | **Token C** from Part 1 |
| 19 | `MERCH_ADMIN_KEY` | yes | **Token B** from Part 1 |
| 20 | `MERCH_CATALOG_TOKEN` | yes | **Token A** from Part 1, the **same** value as in the main project |
| 21 | `MERCH_PRINTFUL_AUTO_CONFIRM` | leave OFF for now | `true` sends paid orders straight to production with no review. Leave it unset until you've watched several orders go through. |
| — | `MERCH_CATALOG_URL`, `MERCH_CONTENT_URL` | **don't add** | only for testing against a preview back office |

### 3.2 Main project (greenwaymarijuana.com, `greenway_website`)

Where: main project → **Settings** → **Environment Variables**. Same steps as above.

| # | Name | Need it? | Value to use |
| --- | --- | --- | --- |
| 1 | `MERCH_CATALOG_TOKEN` | yes | **Token A**, exactly the same as the merch project |
| 2 | `PRINTFUL_API_TOKEN` | yes | the **same** Printful token as the merch project. Merch Studio and the merch order board use it. |
| 3 | `PRINTFUL_STORE_ID` | only sometimes | same rule as the merch project (6.2) |
| 4 | `VERCEL_ANALYTICS_TOKEN` | for Reports > Merch | a Vercel access token (Part 7) |
| 5 | `MERCH_VERCEL_PROJECT` | for Reports > Merch | the merch project's **Project ID** (Part 7) |
| 6 | `VERCEL_TEAM_ID` | sometimes | only if you chose **Full Account** for the token (Part 7) |

Redeploy **both** projects after adding variables (Part 2.2, step 4; the main project works the same way).

---

## Part 4. Resend (the emails), and what `MERCH_EMAIL_FROM` is for

### 4.1 What `MERCH_EMAIL_FROM` is for

Every email needs a **"From"** line, the name and address the customer sees in their inbox. The merch site sends two kinds of email through Resend:

1. **To customers:** "Your order shipped" (with the tracking link), and "Your order was cancelled" if someone outside Washington tries to buy.
2. **To you:** alerts (bad address, Printful rejected an order, an order on hold, an email that failed).

`MERCH_EMAIL_FROM` is the **sender**. The other two variables are different jobs:

- `NEXT_PUBLIC_MERCH_CONTACT_EMAIL` (contact@) is *shown on the website*. It's also the **reply-to** on customer emails, so when a customer hits Reply, the reply goes to contact@.
- `MERCH_ORDER_ALERT_EMAIL` (orders@) is the **recipient** of your alerts.

**If `MERCH_EMAIL_FROM` is empty, no email is sent at all.** The code checks for it and stops with "RESEND_API_KEY / MERCH_EMAIL_FROM not set."

**The value to use:**

```
Greenway Merch <orders@greenwaymerch.com>
```

Type it exactly like that, including the `< >`. The part before `<` is the friendly name customers see. The address must be on the domain you verified in Resend (greenwaymerch.com). Since orders@ is a real Google Workspace mailbox, any bounce messages land somewhere you can read them.

### 4.2 Check the Resend domain is really verified

1. Go to **resend.com** and sign in.
2. Click **Domains** in the left menu.
3. `greenwaymerch.com` should say **Verified** (green). If it says **Pending** or **Failed**:
   - Click it. Resend lists DNS records (usually a TXT record for DKIM, plus an MX and a TXT record on a `send` sub-name).
   - Add each one, exactly as shown, at your **domain's DNS provider**. That's wherever the domain's nameservers point (if Vercel manages the DNS, use Vercel → **Domains** → greenwaymerch.com → **DNS Records**).
   - **Don't delete** the Google Workspace MX records. Resend's records sit on a sub-name like `send`, so they don't clash with Gmail.
   - Back in Resend, click **Verify DNS Records**. It can take a few minutes, sometimes longer.
4. Click **API Keys**. You already made one and put it in `RESEND_API_KEY`. If you're not sure you copied it fully, make a new one (**Create API Key** → name it `greenwaymerch` → Permission **Sending access** → Domain **greenwaymerch.com** → **Add**), copy it, and replace the value in Vercel.

### 4.3 Send yourself a test (optional but nice)

Once Stripe and Printful are set up, the full test in Part 8 sends real emails. Resend → **Emails** shows every email the site sent and whether it was delivered.

---

## Part 5. Stripe (taking payments)

Use the **LLC's** Stripe account (Greenway Merchandising LLC), not the dispensary's.

### 5.1 Secret key → `STRIPE_SECRET_KEY`

1. Go to **dashboard.stripe.com** and make sure the LLC account is selected (top-left).
2. Make sure **Test mode** is **OFF** for the live key. For the practice run in Part 8, turn it ON and use the test key.
3. Click **Developers** (bottom-left, or under the gear), then **API keys**.
4. Next to **Secret key**, click **Reveal** (or **Create secret key**). Copy the value starting with `sk_live_`.
5. In Vercel (merch project), add `STRIPE_SECRET_KEY` = that value, marked **Sensitive**.

### 5.2 Webhook → `STRIPE_WEBHOOK_SECRET`

A webhook is Stripe calling your website to say "someone just paid."

1. In Stripe: **Developers** → **Webhooks** → **Add endpoint** (newer dashboards say **Add destination**: choose **Webhook endpoint**, your account, then the events).
2. **Endpoint URL:** `https://greenwaymerch.com/api/stripe/webhook` (or the www version if you chose www as the main address in 2.3).
3. **Events:** search for and tick both of these:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
4. Click **Add endpoint** / **Create destination**.
5. On the endpoint's page, find **Signing secret**, click **Reveal**, and copy the value starting with `whsec_`.
6. In Vercel (merch project), add `STRIPE_WEBHOOK_SECRET` = that value, **Sensitive**.

> Test mode and live mode have **separate** webhooks and secrets. When you switch from practice to live, make the live webhook and update both Stripe variables.

### 5.3 Why checkout says "Washington only"

The site only sells to Washington. Stripe can't block a state on its own, so the site does two things. It refuses non-WA ZIP codes before checkout. It also only *holds* the card at checkout, and charges it once the webhook confirms a Washington address. Out-of-state holds are released for free, and the customer gets an email. You don't need to set anything for this.

### 5.4 Sales tax (Stripe Tax) → `MERCH_STRIPE_AUTOMATIC_TAX`

1. Stripe → **Tax** (search "Tax" in the top bar) → **Get started** / **Activate**.
2. Enter the LLC's head-office address (Washington) and choose a default product tax code. Clothing is "General – Tangible Goods" unless your accountant says otherwise.
3. Under **Registrations**, click **Add registration** → **United States** → **Washington**, and enter the LLC's Washington sales-tax registration details.
4. Only after that, add `MERCH_STRIPE_AUTOMATIC_TAX` = `true` in the merch project and redeploy.
5. Stripe Tax costs 0.5% per transaction where tax is calculated (Stripe's pricing page).

> Without this variable, checkout charges no tax. Don't turn it on before the Washington registration exists, or Stripe won't calculate tax correctly.

---

## Part 6. Printful (making and shipping the shirts)

Use the **LLC's** Printful account.

### 6.1 Private token → `PRINTFUL_API_TOKEN` (both projects)

1. Go to **developers.printful.com/tokens** and log in with the LLC's Printful login.
2. Click **Create token** (or **+ Add new token**).
3. **Token name:** `greenway-websites`.
4. **Access level:** pick **A single store** and choose the store your merch orders go into. That's the simplest choice: you then **don't** need `PRINTFUL_STORE_ID`.
5. **Scopes** (permissions): tick at least
   - `orders`: view and manage orders. Needed to create and confirm orders and to read the order board.
   - `webhooks`: view and manage webhooks. Needed for the "shipped" notices.
   - `file_library`: view and manage the file library. Recommended for Merch Studio print files. (Printful's scope list has no separate "mockup" scope.)
6. **Expiration:** choose the longest date offered and put a reminder in your calendar a week before it. When it expires, both sites lose Printful until you paste a new one.
7. Click **Create**. **Copy the token now.** Printful shows it only once.
8. Paste it as `PRINTFUL_API_TOKEN` in **both** Vercel projects, marked **Sensitive**.

### 6.2 `PRINTFUL_STORE_ID`: only if you picked "Account" level

- If you chose **a single store** in 6.1, **skip this**.
- If you chose **Account** level, find the store's ID in the Printful dashboard (**Stores** → your store; the number in the page address) and add it as `PRINTFUL_STORE_ID` in both projects.

### 6.3 Tell Printful where to send "shipped" notices (one time)

Do this **after** the merch site is live (Part 2) and `PRINTFUL_WEBHOOK_TOKEN` is saved in Vercel and redeployed.

1. Open **Terminal** again (⌘ Space → Terminal).
2. Copy the block below into a text editor (TextEdit is fine) and swap in your values:
   - Replace `PASTE_PRINTFUL_TOKEN` with your Printful token (6.1).
   - Replace `PASTE_TOKEN_C` with Token C (the same value as `PRINTFUL_WEBHOOK_TOKEN`).

   ```bash
   curl -X POST https://api.printful.com/webhooks \
     -H "Authorization: Bearer PASTE_PRINTFUL_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"url":"https://greenwaymerch.com/api/printful/webhook/PASTE_TOKEN_C","types":["package_shipped","order_failed","order_canceled","order_put_hold"]}'
   ```

3. Paste the edited block into Terminal and press **Return**.
4. A good answer starts with `{"code":200`. If you see `401`, the Printful token is wrong.
5. If you used an Account-level token, add one more line before `-d`: `-H "X-PF-Store-Id: YOUR_STORE_ID" \`.

> Printful doesn't sign its notices, so the secret Token C inside the address is what keeps strangers out. A wrong token gets "Not found."

### 6.4 Payment card and resale certificate (in Printful's dashboard)

- **Billing** → add the **LLC's** card. Printful charges it when you press **Confirm** on an order.
- **Billing** → **Legal info**: enter the LLC's legal name and address first.
- **Billing** → **Resale certificates** (printful.com/dashboard/billing/resale-certificates) → **Add certificate**. Pick Washington, fill in the form (Washington accepts the MTC or SSUTA form), and sign it. Printful reviews it within about 2 business days. After approval, Printful stops charging you sales tax on the blanks (you collect tax from the customer instead). Printful doesn't refund tax on orders placed before approval, so do this before your first real order.

---

## Part 7. Analytics (finishing after you pressed "Enable")

Turning on Web Analytics starts counting visits on greenwaymerch.com. These steps let the back office show those numbers under **Reports → Merch**.

### 7.1 Confirm the merch site is counting visits

1. Merch project → **Analytics** tab. It should say **Enabled**.
2. Counting starts after the **next deployment**, so redeploy once if you enabled it after the last one (Part 2.2, step 4).
3. Visit `https://greenwaymerch.com` and click around for a minute. Within a few minutes the Analytics tab should show visitors.
4. Nothing to install: the analytics code is already built into the merch site. It skips your private `/admin` pages and never sends Stripe's payment details.

### 7.2 Make a Vercel access token → `VERCEL_ANALYTICS_TOKEN` (main project)

1. Go to **vercel.com/account/tokens** (or click your avatar, top-right → **Account Settings** → **Tokens**). Make sure your personal account is selected at the top-left of that page.
2. **Token name:** `greenway-merch-reports`.
3. **Scope:** choose your **team** (the one both projects are in). If you can, choose the merch project inside it; that's the safest. If you choose **Full Account** instead, you'll need step 7.4.
4. **Expiration:** pick the longest option (or "No expiration") and set a calendar reminder.
5. Click **Create Token**. **Copy it now.** It's shown only once.
6. Main project → Environment Variables → add `VERCEL_ANALYTICS_TOKEN` = the token, **Sensitive**.

### 7.3 The merch project's ID → `MERCH_VERCEL_PROJECT` (main project)

1. Open the **merch project** → **Settings** → **General**.
2. Scroll to **Project ID** and click the copy icon. It starts with `prj_`.
3. Main project → Environment Variables → add `MERCH_VERCEL_PROJECT` = that ID.

### 7.4 Team ID → `VERCEL_TEAM_ID` (only if you chose "Full Account" in 7.2)

1. In Vercel, switch to your team (top-left), then **Settings** → **General**.
2. Copy **Team ID** (starts with `team_`).
3. Main project → add `VERCEL_TEAM_ID` = that ID.

### 7.5 Turn it on

1. Redeploy the **main** project (Deployments → ⋯ → Redeploy).
2. Open `greenwaymarijuana.com/admin/reports/merch`.
3. The traffic section shows visits, top pages, referrers, devices and countries. If something is wrong, the page says exactly which variable to fix, for example "Vercel refused the token".

Cost: Vercel Pro bills Web Analytics at $0.03 per 1,000 events (Vercel pricing page). A small shop costs pennies.

---

## Part 8. Practice run (no real money)

1. In Stripe, turn **Test mode** ON. Copy the **test** secret key (`sk_test_…`). Make a **test** webhook (Part 5.2, same URL and events) and copy its `whsec_…`.
2. In the merch project, temporarily set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` to the test values. Redeploy.
3. In Merch Studio (greenwaymarijuana.com → `/admin/merch-studio`), publish one product. Within a few minutes it appears on greenwaymerch.com.
4. Buy it with a **Washington** address and the test card **4242 4242 4242 4242**, any future date, any 3-digit CVC.
5. Check:
   - A **draft** order appears at `greenwaymerch.com/admin/orders` (log in with Token B) and in Printful → **Orders**.
   - **Delete the draft in Printful without confirming**, so you're not charged.
6. Put the **live** `sk_live_…` key and the **live** webhook's `whsec_…` back in Vercel. Redeploy. You're open for business.

---

## Part 9. The checklist

**Already done by you** ✅
- [x] Domain bought, Google Workspace with contact@ and orders@
- [x] Resend Pro domain + `RESEND_API_KEY`
- [x] `NEXT_PUBLIC_MERCH_CONTACT_EMAIL`, `MERCH_ORDER_ALERT_EMAIL`
- [x] Web Analytics enabled on the merch project

**Still to do**
- [ ] Merch project settings checked (2.1), and a deployment shows **Ready** (2.2)
- [ ] `greenwaymerch.com` set as the main domain, www redirects to it (2.3)
- [ ] Three tokens made in Terminal (Part 1)
- [ ] `MERCH_EMAIL_FROM` = `Greenway Merch <orders@greenwaymerch.com>` (4.1)
- [ ] Resend domain shows **Verified** (4.2)
- [ ] `MERCH_SITE_URL`, phone, address, the shipping cents variables (3.1)
- [ ] Stripe secret key + webhook secret (5.1, 5.2)
- [ ] Stripe Tax for Washington, then `MERCH_STRIPE_AUTOMATIC_TAX=true` (5.4)
- [ ] Printful token in BOTH projects (6.1), webhook registered (6.3), card + resale certificate (6.4)
- [ ] `MERCH_ADMIN_KEY`, `PRINTFUL_WEBHOOK_TOKEN`, and `MERCH_CATALOG_TOKEN` (same in both)
- [ ] Analytics: `VERCEL_ANALYTICS_TOKEN`, `MERCH_VERCEL_PROJECT` (+ `VERCEL_TEAM_ID` if needed) in the main project (Part 7)
- [ ] Redeploy BOTH projects
- [ ] Practice run in Stripe test mode (Part 8), then switch to live keys

## If something goes wrong

| You see | It means | Do this |
| --- | --- | --- |
| Checkout says shipping isn't set up | `MERCH_SHIP_FLAT_CENTS` missing or written in dollars | Set it in cents, e.g. `599`, then redeploy |
| Checkout button doesn't work at all | `STRIPE_SECRET_KEY` missing | Part 5.1, then redeploy |
| Paid, but no draft in Printful | Stripe webhook failing | Stripe → Webhooks → your endpoint → look at the failed events. A **3xx** means the domain redirect issue (2.3). A **400** means the wrong `whsec_` secret. |
| No "shipped" emails | `MERCH_EMAIL_FROM` empty, domain not verified, or Printful webhook not registered | Parts 4 and 6.3. Resend → Emails shows what was tried. |
| Products from Merch Studio don't show | `MERCH_CATALOG_TOKEN` differs between the projects, or is shorter than 32 characters | Paste the identical Token A in both, then redeploy both |
| `/admin/orders` won't accept the password | `MERCH_ADMIN_KEY` shorter than 16 characters, or a typo | Use Token B exactly |
| Reports → Merch says the token was refused | wrong or expired `VERCEL_ANALYTICS_TOKEN`, or a Full-Account token without `VERCEL_TEAM_ID` | Part 7 |
| Merch deploy fails again | — | Send me the last 30 lines of the Build Logs |
