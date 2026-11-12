# SOP-11 — Merch Studio, Merch Inventory and the Greenway Goods Store (greenwaymerch.com)

| | |
|---|---|
| **Version** | 1.9 (living document. v1.0 was recon and audit; v1.1 records the owner's answers (D232) and slice **M-1** as built; v1.2 records slice **M-2**, Merch Health, as built; v1.3 records slice **M-3a**, the Setup & Launch coach and form 8.1, as built; v1.4 records slice **M-3b**, the Product journey stepper and tab strips, as built; v1.5 records slice **M-5**, re-publish keeps Hidden, the catalog version check and print-file cleanup, as built; v1.6 records slice **M-4**, designs saved on the server with Import and the sample gate, as built; v1.7 records slice **M-6**, the Printful webhook button and automatic stock, as built; v1.8 records slice **M-7**, the held-card monitor, the merch alerts inbox, the Refund / Release button and the auto-confirm switch, as built; v1.9 records slice **M-8**, the pricing guard, helpers, integration guides and concierge, and the studio-default placement check, as built; v1.10 records the D235 fix: the shop was not redeploying, so `MERCH_HEALTH_TOKEN` could never be accepted) |
| **Effective** | On owner approval |
| **Owner** | Michael Lyman |
| **Applies to** | **Merch Studio** (`/admin/merch-studio`, permission `content.edit`: designers, content editors, managers, admin, owner; **Publish to greenwaymerch.com** is owner/admin only, `merch.publish`, D232). **Merch Inventory** (`/admin/inventory/merch`, `inventory.manage`; **Remove** is owner/admin only, `merch.remove`). **Merch orders** in the back office (`/admin/orders` merch panel and `/admin/orders/merch/[ref]`, `orders.manage`). **Reports → Merch** (`reports.view`). **Website → Merchandise** editors (`/admin/merch-site/*`, `content.edit`). The separate shop **greenwaymerch.com** (its own Vercel project `merch-site/`) and its private order desk `greenwaymerch.com/admin/orders` (Token B). The **account setup** at Printful, Stripe, Resend and Vercel is the **owner's** job. |
| **Seller** | **Greenway Merchandising LLC (dba Greenway Glass & Goods)**, never the cannabis licensee (`src/lib/merch-studio/listing-package-core.ts` L46). |
| **Verified against** | `main@d766e4a8` (2026-11-11). Live read-only probes of greenwaymerch.com and greenwaymarijuana.com on 2026-11-11 08:36 UTC (§9.4). Printful, Stripe and Resend facts were checked against their own developer documents on the same day (Appendix A.3). |
| **Program records** | Findings `F-11-*` in `docs/sop-program/03-FINDINGS-LEDGER.md` · gaps `G-76`…`G-93` in `docs/sop-program/05-GAP-REGISTER.md` · proposed plan rows `M-1`…`M-8` in `docs/sop-program/06-FIX-PHASE-PLAN.md` · owner request D231 in `00-OWNER-REQUEST-VERBATIM.md` · concierge coverage in `04-CONCIERGE-COVERAGE-LEDGER.md`. |
| **Scope (this version)** | Merch Studio and Merch Inventory first, as the owner asked: *"I want you to first focus your attention entirely on the merch studio and merch inventory."* The **Creative Studio** (banners and ads for the cannabis site, `/admin/marketing/**`) is the second half of SOP-11 and gets its own version later (Appendix B, last row). |

> **This SOP is a living document (owner decision D41).** The owner: *"write the full sop and add it to the repo and back office as a living doc, we will update it as we build from your roadmap strategy report."* Each time a gap in Appendix B is built, the section it names is rewritten to match the screen, the version goes up, and Appendix D records the change. Until then, the **interim** steps in this SOP are the procedure.

> **The one thing to know before anything else.** Today **no product can reach greenwaymerch.com, even after you press Publish.** The shop asks the back office for its product list at `https://greenwaymarijuana.com/api/merch-catalog` (`merch-site/lib/site.ts` L30, `merch-site/lib/catalog.ts` L23). That address now **redirects to www** (live probe: `308 → https://www.greenwaymarijuana.com/api/merch-catalog`). A browser or server following a redirect to a **different host drops the `Authorization` header**, and this was proven in a local Node test. So the back office sees no token and answers *Not found* (404, `src/app/api/merch-catalog/route.ts` L20–27), and the shop quietly shows **its last good list, which is empty** (`catalog.ts` L38–44). **D232 update:** slice M-1 fixes this in code (the shop now asks the **www** address, moves a bare `greenwaymarijuana.com` value to www, and never follows a redirect). The fix reaches the shop when the merch project redeploys after the merge. **Until then (or to be safe), the one-minute fix at Vercel still works:** on the **merch** project, add `MERCH_CATALOG_URL` = `https://www.greenwaymarijuana.com/api/merch-catalog` and redeploy (§4.2 step M-9; F-11-1, G-76). The second blocker is that **checkout is closed**: both `/api/checkout` and `/api/stripe/webhook` answer 503 today, so the Stripe keys, the webhook secret and/or `MERCH_SHIP_FLAT_CENTS` are not set (§9.4).

> **How to use this document.** **Part 1** (§4.1) is the map: what each piece is and how a shirt goes from an idea to a customer's door. **Part 2** (§4.2–§4.5) is the **one-time setup**, written as a numbered walkthrough with a "you know it worked when…" check after every step: Printful, Stripe, Resend, Vercel, then the first test order. **Part 3** (§4.6–§4.12) covers the **six Studio tabs**, one by one. **Part 4** (§4.13–§4.16) is **Merch Inventory**. **Part 5** (§4.17–§4.21) covers **orders**: confirm, cancel, refund and holds. **Part 6** (§4.22–§4.24) covers the website editors, reports and the redirect ad. §5 explains every message you can see, and §6 covers what to do when something goes wrong. §8 has the printable checklists. **Appendix B is the roadmap**: the step-by-step setup guide and the health panel the owner asked for.

---

## Table of contents

1. Purpose & scope
2. Roles & permissions
3. Before you start
4. Procedures

   **Part 1: The map**
   - 4.1 The three systems, the two websites, and the life of one shirt

   **Part 2: One-time setup (owner), step by step**
   - 4.2 The setup walkthrough, steps S-1 to S-12 (Printful, Stripe, Resend, Vercel)
   - 4.3 The three secret tokens (A, B, C)
   - 4.4 Every Vercel variable, both projects (checked against the code)
   - 4.5 The first test order, end to end (test mode, then live)

   **Part 3: Merch Studio, tab by tab**
   - 4.6 The Studio page and where your work is saved (read this first)
   - 4.7 Tab 1, Garments
   - 4.8 Tab 2, Design
   - 4.9 Tab 3, Proof & Export (print files, mockups, the sample)
   - 4.10 Tab 4, Artwork Check
   - 4.11 Tab 5, Fulfillment & Pricing
   - 4.12 Tab 6, Publish & Ads (the listing and the redirect ad)

   **Part 4: Merch Inventory**
   - 4.13 Reading the page
   - 4.14 Hide, show and remove
   - 4.15 Copying Printful stock to the website
   - 4.16 The CSV export

   **Part 5: Orders and money**
   - 4.17 What happens when a customer pays
   - 4.18 Confirming an order (the human click)
   - 4.19 Cancelling an order **and** refunding the customer
   - 4.20 Card holds that are never captured (the 7-day clock)
   - 4.21 Shipped emails, problems at Printful and owner alerts

   **Part 6: The shop's look, the reports and the ad**
   - 4.22 Website → Merchandise editors
   - 4.23 Reports → Merch
   - 4.24 The Greenway Goods ad on the cannabis site (WAC 314-55-155)
5. Messages you may see, and what to do
6. Exceptions & troubleshooting
7. Controls: what the app already does well, and what it does not do yet
8. Checklists & forms
9. Quick reference (cards, links, live status snapshot)
10. Glossary

- Appendix A: Source map (every claim pinned to file and line) and external sources
- Appendix B: Findings, gaps and the **roadmap strategy**
- Appendix C: Owner questions
- Appendix D: Revision history

---

## 1. Purpose & scope

**Purpose.** This SOP lets anyone on the team set up, use and keep healthy the Greenway Goods apparel business, with no guessing. It covers designing a garment, checking it prints well, publishing it to the separate shop, watching stock, and confirming, cancelling and refunding orders. It also covers the one-time account setup behind all of that. The owner's words: *"I am very confused on how to use the merch studio. I do not know how to properly set up my printful and stripe accounts… we need a printful store and stripe health maybe so we know when things break or go offline."*

**What the business is.** It is print-on-demand apparel with **no inventory**. A customer pays on **greenwaymerch.com**. That order becomes a **draft** at **Printful**, and a person presses **Confirm**. Printful then prints that one item, charges the LLC's card and ships to the customer (`src/lib/merch-studio/fulfillment-core.ts` L80–88). The cannabis website only shows a **redirect ad** with no product details. Apparel is **never** rung up on the cannabis POS or sent with delivery (`page-helpers-core.ts` L339 note; SOP-05b covers the in-store merch items that *are* on the POS, which are a different thing).

**In scope (v1.0):**
- the Merch Studio, all six tabs;
- Merch Inventory;
- the back-office merch order panel and order detail;
- Reports → Merch;
- the five Website → Merchandise editors;
- the shop app `merch-site/` (checkout, Stripe webhook, Printful webhook, order desk);
- the setup of Printful, Stripe, Resend and the Vercel variables in both projects;
- health and monitoring (what exists, what does not, and the plan).

**Out of scope (v1.0):**
- the **Creative Studio** (`/admin/marketing/**`, Midjourney builder, banners for the cannabis site; SOP-11 v2.0);
- in-store merch and accessories sold on the POS (**SOP-05b**);
- general website content (SOP-12/SOP-21).

---

## 2. Roles & permissions

| Who | Can | Pinned |
|---|---|---|
| **Anyone with `content.edit`** (content editor, manager, admin, owner) | open the Merch Studio, design, export, make mockups, download the listing package, edit and publish the redirect ad, edit the five shop-look editors | `src/app/admin/merch-studio/page.tsx` L35; `catalog-actions.ts` L38, L60; nav `src/components/admin/admin-nav-data.ts` L101, L164–168 |
| **Anyone with `inventory.manage`** | open Merch Inventory, hide or show a product, copy Printful stock, download the CSV | `src/app/admin/inventory/merch/page.tsx` L35; nav L86 |
| **Owner and admin only** (`merch.publish`, D232, owner Q-11-1: *"Q1: owner/admin."*) | **Publish to greenwaymerch.com** (it puts a product on sale). Everyone else sees the button greyed out with the reason | `src/lib/auth/roles.ts` (`merch.publish`); `catalog-actions.ts` (both actions); `PublishPanel.tsx` |
| **Owner and admin only** (`merch.remove`, G-30A, owner Q05b-3) | **Remove** a product from the shop for good | `inventory/merch/page.tsx` L37; `concierge-kb.ts` L194 |
| **Anyone with `orders.manage`** | see merch orders in the back office, **Confirm** or **Cancel** at Printful | `src/app/admin/orders/merch/[ref]/page.tsx`; `src/lib/orders/merch-actions.ts` |
| **Anyone with `reports.view`** | Reports → Merch (traffic, sales, WA tax) | `src/app/admin/reports/merch/page.tsx` L67 |
| **Whoever holds Token B** (`MERCH_ADMIN_KEY`) | the shop's own order desk `greenwaymerch.com/admin/orders` (12-hour cookie) | `merch-site/lib/admin.ts`; `merch-site/app/admin/orders/actions.ts` L35–42 |
| **The owner** | accounts at Printful, Stripe, Resend and Vercel, every secret, the LLC card at Printful, refunds in Stripe | not in the app (§4.2) |

> **Who may publish (decided, Q-11-1, D232).** Publishing puts a product on sale **immediately** (§4.12). The owner decided: *"Q1: owner/admin."* Since slice M-1 the app enforces it (`merch.publish`). A designer finishes the design and downloads the listing package, then the owner or an admin publishes after the sample is approved (§4.9.5).

---

## 3. Before you start

1. **Use one computer for merch design work.** Designs and uploaded art are saved **in that browser only** (§4.6). If you clear the browser or switch computers, they are gone unless you have the ZIP or JSON backup.
2. **Setup must be finished** (§4.2) before a real order can work. Check the live status card (§9.4) and **Merch Health** (Merch Studio → **Merch Health** button, `/admin/merch-studio/health`, owner & admin; built in D232 M-2).
3. **Know the two websites.** **greenwaymarijuana.com** is the cannabis store and back office, where you design, publish and look at stock. **greenwaymerch.com** is the shop, where customers pay and where the private order desk lives.
4. **Know the three outside accounts.** All of them belong to the **LLC**, not the dispensary:
   - **Printful** makes and ships the item.
   - **Stripe** takes the card payment.
   - **Resend** sends the emails.
5. **Money is in cents** in every setting that asks for money. For example, `599` means $5.99. The shop refuses `5.99` (`merch-site/lib/checkout-core.ts` L40–41, self-test L134).

---

## 4. Procedures

### Part 1: The map

### 4.1 The three systems, the two websites, and the life of one shirt

```
 BACK OFFICE (greenwaymarijuana.com)                SHOP (greenwaymerch.com)                     OUTSIDE
 ───────────────────────────────────               ────────────────────────                     ───────
 Merch Studio ─ Publish ──► site_settings           /api/checkout ─ re-prices from catalog ──►   Stripe Checkout
   (6 tabs)                 "merch_catalog"             (WA ZIP only, card HELD not charged)        (card held)
                            │                                                                         │
 Merch Inventory ◄──────────┤  GET /api/merch-catalog ◄── shop reads it                               │ webhook
   hide / show / remove     │  (Bearer Token A,            every 60 s + fresh                         ▼
   copy Printful stock      │   404 if wrong)              at checkout and webhook   /api/stripe/webhook
                            │                                                       WA? capture : cancel
 Orders → Merch ◄──── Printful API (orders) ◄───────────── Printful DRAFT order ◄───────────────────┘
   Confirm / Cancel                                         /admin/orders (Token B): Confirm
 Reports → Merch ◄── Printful orders + Vercel Analytics                                  Printful ──► ships
                                                            /api/printful/webhook/<Token C> ◄── "shipped" ──► Resend email
```

**The life of one shirt (nine steps, `fulfillment-core.ts` L80–88):**

| # | Step | Who | Where | What the app does today |
|---|---|---|---|---|
| 1 | Pick a premium blank | Designer | Studio → Garments | Printful-backed catalog of garments, colours and placements |
| 2 | Design on a true-to-inch canvas | Designer | Studio → Design | live print checks (DPI, text size, seams, zippers) |
| 3 | Export print files and a proof | Studio | Studio → Proof & Export | 300-DPI transparent PNGs, ZIP, proof sheet, Printful mockups |
| 4 | **Order one sample** | **Owner** | Printful dashboard, then Studio → Proof & Export | **enforced (D232 M-4)**: owner/admin approves it with every checklist item and a photo; Publish is blocked until then; owner-only override with a typed reason |
| 5 | Package and publish the listing | Owner | Studio → Publish & Ads | uploads print PNGs, writes the catalog, **live at once** |
| 6 | Customer pays | Customer | greenwaymerch.com | Stripe Checkout, card **authorized only**, Washington addresses only |
| 7 | Draft Printful order | Shop (automatic) | Stripe webhook | captures the card for a WA address, creates a Printful **draft** |
| 8 | **Confirm** (a human click) | Owner/staff | shop order desk or back office | Printful charges the LLC card and starts production (2–5 business days) |
| 9 | Ship | Printful | Printful webhook | the shop emails the customer the tracking link |

> **Note: stale copy on the Fulfillment tab.** Step 5 on the tab still says *"drop it in merch-site/catalog/"* (`fulfillment-core.ts` L84). That was the old manual way. Since R73 S7 the **Publish to greenwaymerch.com** button does it, and there is no file to drop (F-11-12, G-91).

---

### Part 2: One-time setup (owner), step by step

> **Coaching note.** Do the steps **in order**. Each one ends with **✅ You know it worked when…**. Do not move on until you see that. If a step fails, look up the message in §5. Allow about **2 hours**, plus up to 2 business days for Printful's resale-certificate review. Use the printable **form 8.1** to tick as you go and to record expiry dates.

### 4.2 The setup walkthrough, steps S-1 to S-12

> **In the app (D232 M-3a):** Merch Studio → **Setup & Launch** (`/admin/merch-studio/launch`, owner & admin) walks you through these same steps one card at a time. Steps that Merch Health can prove (S-2, S-4, S-6 … S-12) turn green by themselves; the rest you tick. **Print setup record** prints form 8.1 already filled in. The steps below are the paper copy.

**Step S-1. Make the three secret tokens (A, B, C).** (5 minutes, see §4.3.)
Make three different random strings, each **at least 32 characters** (§4.3 shows how). Save them in your password manager as *Merch Token A (catalog)*, *Merch Token B (order desk)* and *Merch Token C (Printful webhook)*.
✅ **You know it worked when** you have three different long strings saved and none of them has a space.

**Step S-2. Printful: create or confirm the LLC account and its store.** (10 minutes)
1. Sign in at **printful.com** with the **LLC's** login, not a personal one.
2. **Stores** → there should be one store for the shop. A **Manual order platform / API** store is the right type, because our own website sends the orders. Write the store name on form 8.1.
3. **Settings → Store settings**: set the **packing slip** to the Greenway Goods return address and contact email.
✅ **You know it worked when** Stores shows exactly one API/manual store for greenwaymerch.com.

**Step S-3. Printful: billing card, legal info and the Washington resale certificate.** (15 minutes, plus Printful's review)
1. **Billing → Legal info**: enter the LLC's legal name and address first.
2. **Billing → Billing methods**: add the **LLC's** card. Printful charges it when an order is **confirmed** (§4.18).
3. **Billing → Resale certificates → Add certificate** → Washington. Washington accepts the MTC or SSUTA form. Sign it. Without it, Printful charges sales tax on its own invoices to you.
✅ **You know it worked when** Billing shows the card as the default method and the certificate says *Approved* (or *Pending review*; write the date on form 8.1).

**Step S-4. Printful: make the private token.** (10 minutes)
1. Go to **developers.printful.com/tokens** (signed in as the LLC) → **Create token**.
2. **Name:** `greenway-websites`.
3. **Access level:** **A single store** → pick the store from S-2. With a single-store token you do **not** need `PRINTFUL_STORE_ID`. With an **Account** token, every call needs the store id, and the app sends `X-PF-Store-Id` whenever `PRINTFUL_STORE_ID` is set (`src/lib/merch-studio/printful-client.ts` L32).
4. **Scopes:** tick at least:
   - `orders` (create, confirm, cancel and read orders; the order board and the webhook need it);
   - `webhooks` (to register the shipped notices in S-10);
   - `file_library` (recommended for print files).

   Printful has no separate "mockup" scope. For the future health check (G-77), also tick `stores_list` and `webhooks/read` if they are offered.
5. **Expiration:** choose the **longest** date. Printful's documents say: *"Private Tokens have an expiration date… expired tokens cannot be refreshed and must be replaced manually."* **Write the expiry date on form 8.1** and put a calendar reminder **14 days before** it. **D232 M-2:** also type the date on **Merch Health → H-3** (Printful has no API that returns it). H-3 turns amber at 30 days and red at 7 days, and the morning check emails staff when it turns red.
6. **Copy the token now.** Printful shows it only once.
✅ **You know it worked when** the token list shows `greenway-websites` with your scopes and an expiry date, and the token is in your password manager.

**Step S-5. Stripe: the LLC account.** (20 minutes)
1. Sign in at **dashboard.stripe.com**. Top-left, select (or create) the account for **Greenway Merchandising LLC**. **Never** use a dispensary account. Card networks and Stripe do not allow cannabis, and this shop sells only apparel.
2. Finish **Settings → Business details** (legal entity, EIN, bank account for payouts) until the dashboard says payments and payouts are enabled.
3. **Settings → Public details**: statement descriptor `GREENWAY GOODS` (or similar). Support email is `contact@greenwaymerch.com`.
✅ **You know it worked when** the dashboard home has no "Activate payments" banner and you can see the **Test mode** switch.

**Step S-6. Stripe: secret key (test first).** (5 minutes)
1. Switch **Test mode ON**. Go to **Developers → API keys** → copy the **Secret key** `sk_test_…`. A restricted key `rk_test_…` also works. The shop accepts `sk_` or `rk_`, `live` or `test` (`merch-site/app/api/checkout/route.ts` L22).
2. Later, for live, repeat with Test mode **OFF** (`sk_live_…`).
✅ **You know it worked when** you have the `sk_test_…` key saved. It goes into Vercel in S-9.

**Step S-7. Stripe: the webhook endpoint.** (5 minutes)
1. **Developers → Webhooks → Add endpoint.** Newer dashboards say **Add destination → Webhook endpoint**.
2. **URL:** `https://greenwaymerch.com/api/stripe/webhook`. Use exactly this; **no www**. Stripe treats a redirect as a failure: *"We consider redirect responses to webhook requests as failures"*. Today `www.greenwaymerch.com` redirects (307) to the apex, so **the apex is correct** (§9.4).
3. **Events:** `checkout.session.completed` **and** `checkout.session.async_payment_succeeded`. These are the only two the shop handles (`merch-site/app/api/stripe/webhook/route.ts` L36).
4. Open the endpoint → **Signing secret → Reveal** → copy `whsec_…`.
5. Test mode and live mode have **separate** endpoints and secrets. Do this again in live mode when you go live (§4.5).
✅ **You know it worked when** the endpoint shows **Enabled** with exactly those 2 events.

**Step S-8. Stripe Tax (Washington).** (15 minutes; do it before going live)
1. **Tax → Get started.** Head office = the LLC's Washington address. Default product tax code: General – Tangible Goods (or what your accountant says).
2. **Registrations → Add → United States → Washington** with the LLC's WA sales-tax details.
3. Only then set `MERCH_STRIPE_AUTOMATIC_TAX=true` (S-9). Without it the shop charges **no** sales tax (`checkout-core.ts` L118; self-test L155). Stripe Tax costs 0.5% per transaction where tax is calculated.
✅ **You know it worked when** Tax → Registrations lists Washington as **Active**.

**Step S-9. Vercel: the merch project's variables.** (15 minutes, table in §4.4.1)
Merch project → **Settings → Environment Variables** → add every **required** row of §4.4.1. Mark secrets **Sensitive**. **Add `MERCH_CATALOG_URL` = `https://www.greenwaymarijuana.com/api/merch-catalog`** (the fix for F-11-1). Then **Deployments → ⋯ → Redeploy**. Variables only take effect after a redeploy.
✅ **You know it worked when**:
- `https://greenwaymerch.com/api/checkout` no longer answers *"Checkout isn't open yet"* when you try to buy in test mode (§4.5);
- a **POST** to `/api/stripe/webhook` without a signature answers **400**, not **503** (503 means `STRIPE_SECRET_KEY` or `STRIPE_WEBHOOK_SECRET` is missing, `route.ts` L41).

**Step S-10. Printful: register the webhook (shipped emails, problems, stock).** (5 minutes, after S-9 is deployed)
Since D232 M-6 (G-89) this is a button; no Terminal needed.

1. **Token C in both projects.** In Vercel, the merch project already has `PRINTFUL_WEBHOOK_TOKEN` (Token C). Add `PRINTFUL_WEBHOOK_TOKEN` to the **main Greenway project** too, with the **same value**, and redeploy it. (If a correct shop webhook is already registered, the button can reuse it without this, but set it anyway so a repair always works.)
2. Open **Merch Studio → Merch Health** (owner/admin). Under **H-5 Printful webhook**, press **Check what is registered**. It reads Printful's `GET /webhooks` and shows the address (Token C hidden as `…`), the events and the garments the stock watch covers, then what pressing Register would change. Nothing is changed yet.
3. Press **Register / repair the Printful webhook** and confirm. The server first sends the shop a harmless test notice on that address; the shop answers **200 only if Token C matches**. If it does not, **nothing is changed at Printful** and the message says why. Then it registers **all 5 events**: `package_shipped`, `order_failed`, `order_canceled`, `order_put_hold`, `stock_updated`, with every garment in the catalog under the stock watch, and keeps any other event type that was already there. Audited as `merch.webhook_registered` (or `merch.webhook_register_failed`).
- **Warning from Printful's documents:** *"only one webhook URL can be active for a store, so calling this method disables all existing webhook configuration."* That is why the button reads first, keeps extra types and probes before it writes.
- **Press it again** after Token C changes, and after you publish a **new garment** (H-5 turns amber and names the garment the stock watch does not cover yet).
- The daily Merch Health run (G-77) re-checks H-5 every morning.

The old way still works if you ever need it (Terminal; add `-H "X-PF-Store-Id: YOUR_STORE_ID"` for an Account token):

```bash
curl -X POST https://api.printful.com/webhooks \
  -H "Authorization: Bearer PASTE_PRINTFUL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://greenwaymerch.com/api/printful/webhook/PASTE_TOKEN_C","types":["package_shipped","order_failed","order_canceled","order_put_hold","stock_updated"],"params":{"stock_updated":{"product_ids":[PASTE_GARMENT_IDS]}}}'
```

✅ **You know it worked when** Merch Health shows **H-5 green**: *"Registered to the shop with all 5 events (4 order events + stock_updated)."*

**Step S-11. Resend (emails).** (15 minutes)
1. **resend.com → Domains**: `greenwaymerch.com` must say **Verified**. If it does not, add the DNS records it lists and **do not** delete the Google Workspace MX records.
2. **API Keys**: a *Sending access* key for greenwaymerch.com → `RESEND_API_KEY`.
3. In Vercel (merch): `MERCH_EMAIL_FROM` = `Greenway Merch <orders@greenwaymerch.com>` and `MERCH_ORDER_ALERT_EMAIL` = `orders@greenwaymerch.com`.
4. **If `RESEND_API_KEY` or `MERCH_EMAIL_FROM` is missing, no email is sent at all.** That includes the alerts to you, which then exist only in the Vercel logs as `[merch-alert]` lines (`merch-site/lib/fulfillment.ts` L41–43, L55–58; F-11-9).
✅ **You know it worked when** Resend → Domains is Verified, and after your test order (§4.5) Resend → Emails shows the shipped email as **Delivered**.

**Step S-12. Vercel: the main project's variables.** (5 minutes, table in §4.4.2)
Main project → add:
- `MERCH_CATALOG_TOKEN` (Token A, **the same** value as the merch project);
- `PRINTFUL_API_TOKEN` (the same token as S-4);
- `PRINTFUL_STORE_ID` (only for an Account token);
- for Reports → Merch: `VERCEL_ANALYTICS_TOKEN`, `MERCH_VERCEL_PROJECT` and, sometimes, `VERCEL_TEAM_ID`.

Redeploy.
✅ **You know it worked when** **Merch Studio → Proof & Export → Generate mockups** no longer says *"Printful isn't connected"*, and **Orders** shows the merch panel without a *not connected* note.

### 4.3 The three secret tokens (A, B, C)

| Token | Variable | Where it goes | What it protects | What happens if it is wrong |
|---|---|---|---|---|
| **A** | `MERCH_CATALOG_TOKEN` | **both** projects, the same value | the private product feed `GET /api/merch-catalog` | the back office answers 404 to anything other than the exact token; a token shorter than 32 characters is treated as **off** (`src/app/api/merch-catalog/route.ts` L23–27). The shop also ignores a token shorter than 32 characters (`merch-site/lib/catalog.ts` L32) and shows only its built-in list |
| **B** | `MERCH_ADMIN_KEY` | merch project | the shop's order desk `greenwaymerch.com/admin/orders` | the desk keeps asking for the key |
| **C** | `PRINTFUL_WEBHOOK_TOKEN` | merch project **and** main project (same value, M-6) **and** in the S-10 URL | Printful's shipped and problem notices (Printful does not sign them) | Printful's notices get 404; no shipped emails and no problem alerts |

**How to make one** (Mac Terminal): `openssl rand -hex 32` prints 64 random characters. Run it three times. Never reuse the same value for two tokens. If one leaks, make a new one, update Vercel, redeploy, and for Token C update it in **both** projects and press Register on Merch Health H-5 (S-10).

**Token D, `MERCH_HEALTH_TOKEN` (D232 M-2; owner decision *"Q3: yes."*, its own token).** Put it in **both** projects with the same value (32+ characters, `openssl rand -hex 32`), then redeploy both. It lets the back office's Merch Health page ask `greenwaymerch.com/api/health` how the shop is doing (`merch-site/app/api/health/route.ts`). With no token, a short one, or a wrong one, the shop answers **404**, and Merch Health shows the shop checks (H-7 … H-15, H-19) as **Unknown** with this fix. The shop reports only whether each setting is **present** and what the shipping amounts parse to. It never returns a key.

> **If the token is right and Merch Health still says 404 (D235, F-11-19).** Look at what H-9 says. *"The shop's live build has no /api/health at all"* means the token is fine and the **shop is running old code**. Until D235 the merch project skipped every build after 2026-10-18 (its Ignored Build Step looked only at the last commit, which is always a docs commit). After the D235 merge, do this once: Vercel → the **merch** project → **Deployments** → **Create Deployment** → `main` → **Create** (or open the newest main deployment, even one marked *Canceled* or *Ignored*, → ⋯ → **Redeploy**). When it is **Ready**, open `https://greenwaymerch.com/api/health` in a browser: the answer should be the short text *Not found* (the token check), not the big Greenway Glass & Goods "page not found" page. Then press **Run check now**. From then on every merch change deploys by itself.

**Token E, `MERCH_PAYMENTS_TOKEN` (D232 M-7; owner decision *"Q4: guidance first, but build the button too please and all that goes with it."*).** Put it in **both** projects with the same value (32+ characters, `openssl rand -hex 32`, never the same as Token D), then redeploy both. It is the only key that lets the back office **move money**: the order page's **Refund in Stripe** and **Release the card hold** buttons call `POST greenwaymerch.com/api/payments` with it (`merch-site/app/api/payments/route.ts`). Reading a payment uses Token D; moving one needs Token E, so a leak of the read token can never refund anything. With no Token E the buttons are hidden and the page shows the Stripe link instead (guidance first). With a wrong one the shop answers **404**.

### 4.4 Every Vercel variable, both projects (checked against the code)

#### 4.4.1 Merch project (greenwaymerch.com)

| Variable | Need | Value | Read at (code) | If missing |
|---|---|---|---|---|
| `MERCH_SITE_URL` | yes | `https://greenwaymerch.com` | `merch-site/lib/site.ts` | links and emails fall back to the default `https://greenwaymerch.com` |
| `NEXT_PUBLIC_MERCH_CONTACT_EMAIL` | yes | `contact@greenwaymerch.com` | footer, reply-to | no contact shown (it is **set today**, §9.4) |
| `NEXT_PUBLIC_MERCH_CONTACT_PHONE` | recommended | customer-service phone | footer, policies | not shown (set today) |
| `NEXT_PUBLIC_MERCH_BUSINESS_ADDRESS` | recommended | one line | policy pages | not shown (set today) |
| `MERCH_ORDER_ALERT_EMAIL` | yes | `orders@greenwaymerch.com` | `lib/fulfillment.ts` L58 | alerts are only logged |
| `RESEND_API_KEY` | yes | `re_…` | `lib/fulfillment.ts` L41 | **no email at all** |
| `MERCH_EMAIL_FROM` | **yes** | `Greenway Merch <orders@greenwaymerch.com>` | `lib/fulfillment.ts` L42 | **no email at all** |
| `STRIPE_SECRET_KEY` | yes | `sk_test_…` then `sk_live_…` | `app/api/checkout/route.ts` L22; webhook L41 | checkout closed (503); webhook 503 |
| `STRIPE_WEBHOOK_SECRET` | yes | `whsec_…` (test and live differ) | webhook `route.ts` L41 | webhook 503 (Stripe retries for up to 3 days, then gives up) |
| `MERCH_SHIP_FLAT_CENTS` | **yes** | e.g. `599` | `lib/checkout-core.ts` L40–41 | checkout closed (503) |
| `MERCH_SHIP_EXTRA_ITEM_CENTS` | optional | e.g. `200` | `checkout-core.ts` L47 | 0 |
| `MERCH_FREE_SHIP_OVER_CENTS` | optional | e.g. `7500` | `checkout-core.ts` | no free shipping |
| `MERCH_SHIP_MIN_DAYS` / `MERCH_SHIP_MAX_DAYS` | optional | e.g. `3` / `8` | `checkout-core.ts` L42–43 | no delivery estimate |
| `MERCH_STRIPE_AUTOMATIC_TAX` | after S-8 | `true` | `checkout-core.ts` L118 | **no sales tax charged** |
| `PRINTFUL_API_TOKEN` | yes | the S-4 token | `lib/fulfillment.ts` | paid orders alert *"Printful isn't connected"* and Stripe retries (webhook L100–101) |
| `PRINTFUL_STORE_ID` | only for an Account token | store id | `lib/fulfillment.ts` | Printful refuses calls for an Account token |
| `PRINTFUL_WEBHOOK_TOKEN` | yes | Token C | `app/api/printful/webhook/[token]/route.ts` L24 | every Printful notice gets 404 |
| `MERCH_ADMIN_KEY` | yes | Token B | `lib/admin.ts` | order desk locked (set today) |
| `MERCH_CATALOG_TOKEN` | yes | Token A | `lib/catalog.ts` L24 | the shop shows only its built-in list |
| **`MERCH_CATALOG_URL`** | **yes until M-1 deploys (F-11-1); optional after** | `https://www.greenwaymarijuana.com/api/merch-catalog` | `lib/catalog.ts` L23 | the default non-www address redirects and **drops Token A**, so **no Studio products appear** |
| `MERCH_CONTENT_URL` | recommended | `https://www.greenwaymarijuana.com/api/merch-content` | `lib/site-content.ts` L21 | still works (the feed is public), but every read takes an extra redirect hop |
| `MERCH_PRINTFUL_AUTO_CONFIRM` | **leave unset** | `true` only after many good orders | webhook `route.ts` L112–113 | orders stay **drafts** for a human Confirm (safe default) |
| `MERCH_HEALTH_TOKEN` | yes (D232 M-2) | Token D (the same as main) | `app/api/health/route.ts` | `/api/health` answers 404, so Merch Health shows the shop checks as Unknown |
| `MERCH_PAYMENTS_TOKEN` | for the Refund / Release buttons (D232 M-7) | Token E (the same as main) | `app/api/payments/route.ts` | `POST /api/payments` answers 404; the back office shows the Stripe link only |

> **Correction to the finishing guide.** `docs/MERCH-SITE-FINISHING-GUIDE.md` §3.1 says `MERCH_CATALOG_URL` / `MERCH_CONTENT_URL` are *"don't add"*. That was right when greenwaymarijuana.com did not redirect to www. **It is wrong today** (F-11-1). Add `MERCH_CATALOG_URL` until the code fix in G-76 ships, then the variable can be removed. **D232: G-76 is built (slice M-1)** and the guide row is corrected.

#### 4.4.2 Main project (greenwaymarijuana.com)

| Variable | Need | Value | Read at | If missing |
|---|---|---|---|---|
| `MERCH_CATALOG_TOKEN` | yes | Token A (the same as merch) | `src/app/api/merch-catalog/route.ts` L23 | feed answers 404 to everyone, so the shop shows nothing new |
| `PRINTFUL_API_TOKEN` | yes | the same token as the merch project | `src/lib/merch-studio/printful-client.ts` L25, L29 | mockups, live stock, the order panel, Confirm and Cancel say *"Printful isn't connected"* |
| `PRINTFUL_STORE_ID` | Account token only | store id | `printful-client.ts` L32 | Printful refuses calls |
| `VERCEL_ANALYTICS_TOKEN` | for Reports → Merch | Vercel token | `src/lib/merch/merch-reports-*` | the traffic card says it is not set up |
| `MERCH_VERCEL_PROJECT` | for Reports → Merch | merch project id `prj_…` | same | the same |
| `VERCEL_TEAM_ID` | if the token is Full Account | `team_…` | same | the same |
| `MERCH_HEALTH_TOKEN` | yes (D232 M-2) | Token D (the same as merch) | `src/lib/merch/merch-health-server.ts` | Merch Health does not ask the shop; its checks show Unknown with the setup steps |
| `MERCH_PAYMENTS_TOKEN` | for the Refund / Release buttons (D232 M-7) | Token E (the same as merch) | `src/lib/merch/merch-payments-server.ts` | the order page hides the buttons and shows the Stripe link |
| `MERCH_SHOP_URL` | optional | `https://greenwaymerch.com` (the default) | `merch-health-server.ts` `merchShopOrigin()` | the default is used |

### 4.5 The first test order, end to end (test mode, then live)

> **Do this once in Stripe test mode, then once with a real card for a real shirt.** Each step names what you should see.

1. **Publish a cheap test product** (§4.12) with one colour and one size. Within about 60 seconds it should appear on `greenwaymerch.com`. If it does not, see §6.1. Today it will not, until F-11-1 is fixed.
2. Add it to the cart and check out with a **Washington** address. In test mode use card `4242 4242 4242 4242`, any future date and any CVC.
3. In Stripe → **Payments**, the payment shows **Uncaptured** for a moment, then **Succeeded**. The webhook captured it because the address is in WA (`webhook route.ts` L103–104).
4. In Stripe → **Developers → Webhooks → your endpoint**, the event shows **200**.
5. In Printful → **Orders**, a **Draft** order appears with the right garment, colour, size and print files. It is also on `greenwaymerch.com/admin/orders` and in the back office under **Orders**.
6. In test mode, **do not Confirm**. Cancel it at Printful (§4.19). In live mode, press **Confirm** (§4.18). Printful charges the LLC card and production starts.
7. **Out-of-state test:** check out with an Oregon address. The card hold is released for free, the shopper gets a cancelled email, and you get an alert that says *"cancelled automatically (not charged)"* (webhook L74–87).
8. When Printful ships the live order, the customer gets the **shipped** email with tracking. You can see it in Resend → Emails.
9. **Go live:** Stripe live key, live webhook and live `whsec_` in Vercel (S-6, S-7), then redeploy. Record the date on form 8.1.

✅ **Setup is complete when** all 9 steps passed and form 8.1 is filled and signed.

---

### Part 3: Merch Studio, tab by tab

### 4.6 The Studio page and where your work is saved (read this first)

**Where it is:** **MKTG & ADV → Merch Studio** (`/admin/merch-studio`). The header **?** opens the helper *How the Merch Studio works* (`src/lib/admin/page-helpers-core.ts` L323–341). The gold strip under the header reminds you that the seller is the LLC (`page.tsx` L53–56). There are six tabs, and the address remembers the open one as `?tab=garments|design|proof|check|fulfillment|publish` (`src/lib/merch-studio/studio-tabs-core.ts` L12–18).

> **Where your work is saved (D232 M-4, G-79 built).**
> - **Designs** are saved **on the server** (table `merch_designs`, migration 0360) a moment after you stop editing. The Design tab shows *"✔ Saved on this device · ✔ Saved on the server"* (`DesignStudio.tsx` L45). Any computer signed in to the back office sees the same designs.
> - **Uploaded art** is copied to the private `merch-files` bucket (`art/<asset id>`) when the design is saved, and fetched into a new computer's browser when it opens the Studio (`design-sync.ts`, `design-actions.ts` L110, L132).
> - **This browser** keeps a copy (local storage `gw-merch-designs-v1` and IndexedDB `gw-merch-assets`), so you can keep working if the internet drops; it sends the changes when it can (*"⚠ Not saved on the server … Try again"*).
> - **Two computers editing one design:** the second save is refused (version number `rev`), and you see *"This design was changed on another computer. Load the newest copy - your version is kept as a copy."* Press **Load the newest copy**; your version stays in Drafts named *"(this computer)"* (`merch-design-sync-core.ts` L161). Nothing is overwritten.
> - **Delete** in Drafts archives the design on the server (it is not erased) and removes it from every computer.
> - **Import design (.json/.zip)** on the Drafts sub-tab (`DesignStudio.tsx` L644) reads a `design.json`, or the ZIP from Proof & Export (it takes the `design.json` inside, `merch-design-sync-core.ts` L121). If a different design already has that id it comes in as a copy, *"(imported)"*. `design.json` holds the layout, not the pictures: art that is on neither the server nor this browser must be uploaded again.
> - Still press **Proof & Export → Download print files (.zip)** after every finished design. It is your off-site backup and it can be imported.
>
> **Owner step:** apply migration **0360** in Supabase (SQL editor). Until then the Studio works on this browser only and says *"The merch designs table doesn't exist yet - apply migration 0360_merch_designs.sql"*, and Publish is blocked (the sample gate cannot be checked).

**The order of work (the "happy path"):** Garments → Design → Proof & Export (ZIP + mockups) → **order a sample at Printful and approve it** → Publish & Ads → Merch Inventory → wait for orders. The Studio does not guide you through this order or stop you skipping a step today. Appendix B, G-78 adds a step-by-step coach.

### 4.7 Tab 1, Garments

1. Open **👕 Garments**. You see the premium blanks (`garment-catalog-core.ts` L171–249):
   - Comfort Colors 1717, 6014 and 1566
   - Bella + Canvas 3001
   - Independent IND4000 and EXP54LWZ
   - Lane Seven LS14003 full-zip
   - Yupoong 6089M, 6245CM and 1501KC
   - Richardson 112
2. Each card shows the **fabric** and **weight**, the **sizes and Printful base price** (one unit, before placements and shipping), the **print placements** (max area, methods, Printful key and upcharge), the **source** of the measurements, and **Watch out for**.
3. **Source matters.** A placement marked **studio-default** is an estimate, not from Printful's guide. There are **8** of them, not 7 as v1.0 said (`printfile-check-core.ts` `studioDefaultPlacements()`; self-test *"8 studio-default placements"*): the Independent hoodie front and both wrists, the Comfort Colors 1566 wrists, the zip-hoodie front, and the windbreaker front and back (`garment-catalog-core.ts` L151, L195, L214, L225–226). **Since D232 M-8 (G-92)** the Garments tab shows them in gold as *"Studio estimate - awaiting sample measurement"*, and **Compare with Printful's print files** reads Printful's `GET /mockup-generator/printfiles/{id}` and shows Printful's own print-file size (inches, pixels, DPI) next to the studio box. **Red** means the studio box is **bigger** than Printful's file, so art near the edge could be cut off: keep the art smaller. The owner approved ordering samples (Q-11-6: *"Q6: yes."*). They are **not measured yet**, so the app never calls these sizes confirmed. When a sample arrives, measure the printed area with a ruler and send the width and height to the developer, who changes the source in the catalog (F-11-14).
4. Pick a garment and a colour, then press **Start a new design on it**.

✅ **Done when** the Design tab opens with that garment and colour.

### 4.8 Tab 2, Design

1. Choose a **placement pill** (front, back, sleeve and so on). The **green dashed box** is the exact printable area in true inches.
2. **➕ Add**: headline, wordmark, arched text, small tagline (`AddPanel.tsx` L20–23), icons, shapes, or **your own art** (PNG, JPEG, WEBP, SVG; `AddPanel.tsx` L65).
3. **✏️ Selected**: size, colour, font, curve and so on. **🗂️ Layers & Arrange**: Bring to front, Send to back. Keyboard shortcuts:
   - arrows nudge 1/16″ (Shift = 1/4″);
   - Ctrl+Z / Ctrl+Shift+Z undo and redo;
   - Ctrl+D duplicates;
   - Alt-drag skips snapping (helper step 2).
4. **✅ Print checks** shows blockers (⛔) and warnings live: DPI, smallest letter height, thread colours for embroidery, seams, zippers, pouch pockets. **Fix every ⛔ before moving on.**
5. **🎨 Colours & Preview**: see the design on each garment colour.
6. **💾 Drafts**: autosaves in this browser (§4.6). **Duplicate this design** makes a copy.

✅ **Done when** Print checks shows **0 ⛔** on every placement you used.

### 4.9 Tab 3, Proof & Export (print files, mockups, the sample)

1. Pick the saved design. The tab shows **Print files (n), exactly what Printful receives**: trimmed, transparent, true inches, DPI, and the distance from the collar or brim (`ProofPanel.tsx` L217).
2. **Download print files (.zip)** (L208). The ZIP holds every 300-DPI sRGB PNG plus a README, a proof sheet and `design.json`. Keep it in the shared drive (form 8.2).
3. **Open proof sheet** (L209). Print it or save it as a PDF. This is what you approve and measure the sample against.
4. **Photo mockups (Printful)** (L253). Pick colours and press the button.
   - The print files are uploaded to the **private** `merch-files` bucket. Printful gets a 1-hour link (`proof-actions.ts` L28, L88, L96).
   - Wait for the pictures. **Printful allows 2 mockups a minute for new stores and 10 for established ones.** If you see that message, wait a minute (L97).
   - If you see *"The private 'merch-files' bucket doesn't exist yet - apply migration 0281…"* (L56), the owner applies `supabase/migrations/0281_merch_print_files_bucket.sql` in Supabase.
5. **Order a sample** (the human step, Printful dashboard):
   1. Printful → **Orders → New order → Sample** (Printful gives 20% off samples, `ProofPanel.tsx` L282 text). Upload the PNGs from the ZIP to the same placements.
   2. When it arrives, work through the **Sample checklist** on this tab (`print-export-core.ts` L360–368):
      - measure the position and the size against the proof sheet;
      - compare colours in daylight;
      - check the fit (S–XL);
      - check the neck label and the packing slip say Greenway Glass & Goods;
      - wash cold inside-out and re-inspect;
      - feel the print.
   3. Tick every item (the ticks stay on this computer, `gw-merch-sample-<id>`). Then the **owner or an admin** presses **Approve the sample - add its photo** under the checklist and picks a photo of the real sample (JPEG, PNG or WebP). The approval is saved on the server with who and when, the ticked items and the photo (`design-actions.ts` L180; `SampleGate.tsx`). Staff without `merch.publish` see *"Only the owner or an admin can approve the sample."*
   4. **Publish is blocked until the sample is approved** (D232 M-4, G-81; `catalog-actions.ts` L89). The approval belongs to **the print as it was approved**: move, resize or change any printed element, or the method, and Publish is blocked again with *"The design changed after its sample was approved."* Renaming the design or changing the garment colour does not need a new sample.
   5. **Owner override** (owner D232: *"Q2: yes, owner only and reason."*): only the owner sees **Owner: publish without an approved sample** (Proof & Export and Publish). Type the reason (5 characters or more) and press **Override with this reason**. It is saved with the owner's name and time and written to the audit log as `merch.sample_overridden`; the publish audit row carries the reason too (`design-actions.ts` L196–199).
   6. **Take back this approval** (owner/admin) blocks Publish again (`merch.sample_cleared`).
   7. Still sign **form 8.2** for the paper trail.

✅ **Done when** the ZIP is saved, the proof sheet is printed, the mockups look right and form 8.2 is signed.

### 4.10 Tab 4, Artwork Check

Use this **before** you design. It tells you whether a file will print sharp on a garment, placement and method.
1. Pick **Method**, **Placement** and the **Artwork file**. The file is read on this device only and nothing is uploaded (`ArtCheckPanel.tsx` L61–69).
2. Set the **Print width**. Tick **gradients / soft shadows** or **photo** if they apply (L74–76).
3. Optional: **Test a line of text** with a letter (cap) height (L79–82). For embroidery on a blank that supports it, there is a **3D puff** toggle (L83).

✅ **Done when** the result shows no blockers at the width you plan to print.

### 4.11 Tab 5, Fulfillment & Pricing

1. **The pipeline** shows the nine steps of §4.1 (`FulfillmentPanel.tsx` L39; `fulfillment-core.ts` L80–88).
2. **The unit-economics calculator:**
   - Enter the **retail price**, the **Printful cost** (from the Garments tab: base price plus placement upcharges), the **shipping you charge** and the **shipping it costs you**.
   - It works out the **card fee** (Stripe 2.9% + 30¢), the **profit** and the **margin**. It also warns that a **dispute** costs $15 (`fulfillment-core.ts`, `STRIPE_DISPUTE_CENTS`; self-tests L93–99).
3. **Shipping cost.** The shop charges the **flat** shipping you set in `MERCH_SHIP_FLAT_CENTS` (and the optional extras); Printful charges you its own rate per order. **Since D232 M-8 (G-87)**, press **Fill both from Printful + Merch Health**: *Shipping charged to customer* gets the flat first-item price read from the last Merch Health run (H-11), and *Printful shipping cost* gets Printful's **STANDARD** rate to ship one of this garment to Washington (`POST /shipping/rates`, ZIP 98501; the shop only sells in WA). If the flat price is lower, the line under the boxes says **Gap $x.xx per order (you pay it)**. If Merch Health has never run, run it first (Merch Studio → Merch Health → Run check now; §B.4).
4. **Suggested retail** now **includes the shipping gap** and charges the card fee on retail + shipping (`suggestRetailCents(…, ship)`, `fulfillment-core.ts`). The **Target margin** slider starts at the owner's minimum, **35%** (Q-11-8: *"Q8: 35% is fine."*, `MIN_MARGIN_BPS = 3500`). Below 35% the line adds *"Below your 35% minimum: Publish will warn."*

✅ **Done when** the margin is what you want **after** the real shipping cost. Write the price on form 8.2.

### 4.12 Tab 6, Publish & Ads (the listing and the redirect ad)

This tab has **two separate jobs** (`PublishPanel.tsx` L4–16).

**A. The listing: Publish to greenwaymerch.com**
1. **Design**: the dropdown lists only designs **saved in this browser** (`PublishPanel.tsx` L31, L235).
2. Set the **Title** (up to 80 characters) and the **Description** (up to 1,000) (`listing-package-core.ts` L47). The title becomes the web address (the **handle**).
3. **Colours** and **sizes**: at most **100 colour × size combinations**, which is Printful's limit (`listing-package-core.ts` L45, L171). Untick some colours or sizes, or split the design into two listings.
4. **Retail price, smallest size (USD)**: **since D232 M-8 (G-87)** there is no hard-coded $35. It starts at this design's **last published price** (from Merch Inventory; the hint says *"Last published price: $x"*), or **empty**, which uses the suggestion. Under the box: **Suggested for 35% on every size**, the lowest whole-dollar price at which every chosen size earns at least 35% after Printful's estimate, the card fee and the shipping gap (`suggestListingRetailCents`), with **Use it**. The line below shows the shipping to WA: what you charge, what Printful charges, and **you pay the $x gap** when the flat price is lower (**Check Printful shipping** asks again). The variant table's profit and margin include the gap. The issue list warns *"Some variants earn under your 35% minimum margin"* and *"Flat shipping ($x) is under Printful's US rate ($y)"* (raise `MERCH_SHIP_FLAT_CENTS`, §4.4.1, or price the gap in); a sale at a loss still blocks. If shipping cannot be read, a tip says *"Shipping isn't checked yet"*. Change the price to your form 8.2 price if it differs. **Add Printful's bigger-size upcharge (e.g. 2XL) to the price** passes the 2XL+ upcharge on to the customer.
5. **Photos**: up to 8 `https://` pictures from the Media Library (`merch-inventory-core.ts`, `MERCH_ITEM_MAX_IMAGES = 8`). Mockups from §4.9 are a good choice.
6. Read the issues list. **Every blocker must be fixed** before the button enables (L383).
7. Press **Publish to greenwaymerch.com** (L383–384). What happens next (`PublishPanel.tsx` L265–285, `catalog-actions.ts` L38–97):
   - every print PNG is rendered and uploaded to `media/merch-print/<handle>/<nonce>/`. This is the **public** bucket, because Printful must be able to fetch the files;
   - the server checks each file really is a PNG, and enforces the 100-variant limit and the handle;
   - it writes the product into the catalog **as Live**, with `stockSyncedAt` cleared (`merch-inventory-core.ts` L102, L107);
   - it audits `merch.product_published` or `merch.product_republished`;
   - the message reads *"Published "…". It is in Merch Inventory now and on greenwaymerch.com within about a minute"* with **Open Merch Inventory**.
8. **Download listing package (.json)** (L400) is an optional backup of the listing, not of the design.

> **Re-publishing (F-11-7, fixed in D232 M-5).** Pressing Publish again for an **existing** handle replaces the listing but **keeps its status**: a product you hid in Merch Inventory **stays Hidden**, and the message says *"It stays Hidden: it is NOT on greenwaymerch.com. Show it in Inventory → Merch Inventory when you want it back."* The last Printful stock copy and its date are kept for every colour and size that was already there (`upsertItem`, `merch-inventory-core.ts`). New colours or sizes start as Printful reported them at publish; press **Copy Printful stock to the website** (§4.15) after adding any.

> **⚠ Same title, different design.** If another design already uses that web address, publishing is refused with *"Another design is already published as "…". Change the product title so it gets its own web address."* (L97–98). This is protection, not a bug.

> **Old print files (F-11-15, fixed in D232 M-5).** Each re-publish uploads to a new `<nonce>` folder. Once the new listing is saved, the previous folder's PNGs under `merch-print/<handle>/` are deleted (`stalePrintKeys`, `catalog-actions.ts`), and the message says how many. Nothing outside that product's folder is ever touched. If the delete fails, the publish still stands and the old files are harmless.

**B. The Greenway Goods ad on the cannabis website** (also reached from Website → Merchandise → *Merch Ad Card (on Shop)*, which simply redirects here, `merch-site/ad-card/page.tsx` L13)
1. **Show the ad on the cannabis website**: toggle it on.
2. **Greenway Goods website address** must be `https://` on the **separate** merch domain. It cannot be greenwaymarijuana.com, and it cannot have `?` or `#`, an IP address or a port (`merch-ad-core.ts` L211+).
3. Eyebrow, heading, intro and button words. **No prices, and no cart or product details.** The checker blocks words that look like a price or a checkout (*"Prices live only on the merch site - the cannabis site shows no product details"*).
4. Up to 4 picture **tiles** and up to 12 **category cards**. Use **standard category cards** to fill them in. Without cards the shop's "Greenway Merch" filter stays hidden.
5. Read **Live preview (exactly what customers will see)**. Then **Save draft** or **Publish to the website**. Publish is refused while a blocker remains, and the server checks again (`ad-actions.ts` L36–38). Publishing refreshes `/menu` and every category page (L58–59).

✅ **Done when** the product is in Merch Inventory as **Live** and, within about a minute, visible on greenwaymerch.com. **Today it will not appear until F-11-1 is fixed** (§6.1).

---

### Part 4: Merch Inventory

### 4.13 Reading the page

**Where:** **Inventory → Merch Inventory** (`/admin/inventory/merch`). The subtitle says *"Publishing in Merch Studio adds products here automatically."* There are **Publish a design** and **Download CSV** buttons.

| Card | Meaning |
|---|---|
| **Products** | every published product (live and hidden). The catalog holds at most **200** (`MERCH_CATALOG_MAX_ITEMS`, `merch-inventory-core.ts` L28) |
| **Variants** | colour × size combinations |
| **Need attention** | *n out of stock at Printful* plus *n website mismatches* (`page.tsx` L77) |
| **Units sold** / **Revenue / gross profit** | from Printful orders. **Cancelled and failed orders are not counted** (`NOT_A_SALE`, L184) |

**Filters:** Search, then **All / Live / Hidden / Needs attention** (`page.tsx` L47–50, L87).

**Per product:** status badge, *n website mismatch* badge, **Hide/Show**, **Remove…** (owner/admin), and the variants table. The table columns are Colour, Size, **Printful stock**, **Website** (Shown or Hidden), Retail, Printful cost, Profit, Margin, Sold and Revenue.

**Printful stock labels** (`merch-inventory-core.ts` L141):

| Label | Meaning | Sellable? |
|---|---|---|
| **In stock** | Printful has the blank | yes |
| **Made to order** | `stocked_on_demand` | yes |
| **Out of stock** | Printful cannot make it now | no |
| **Discontinued** | gone for good; remove that colour or size and re-publish | no |
| **Not checked** | Printful did not answer or is not connected | unknown |

A **website mismatch** means Printful's answer and what the website shows differ (`L232`). Fix it with §4.15.

> **Helper (D232 M-8, G-90).** The page header's **?** opens **How Merch Inventory works** on the Helpers page (`helpId="merch-inventory"`, `page-helpers-core.ts`, section *Merch: Inventory & Reports*).

### 4.14 Hide, show and remove

- **Hide** takes the product off greenwaymerch.com within about a minute and keeps it here. **Show** puts it back. Both are audited (`merch.product_hidden` / `merch.product_shown`, `actions.ts` L22–30).
- **Remove** is **owner/admin only**. Type the product's web name (handle) **exactly** to confirm. It removes the product from the catalog **and** deletes its current print PNGs. Past orders at Printful are not affected (`actions.ts` L33–48). It is audited as `merch.product_removed` with the title and variants. **There is no undo.** You would have to publish again from the original browser (§4.6).
- **Rule:** prefer **Hide**. Use **Remove** only for a product you will never sell again.

> **Two people editing at once (F-11-16, fixed in D232 M-5).** Each change re-reads the catalog and saves only if nobody else saved in between (compare-and-set on the row's `updated_at`, `merch-inventory-store.ts`). The second person gets *"Someone else changed the catalog - reload and try again."* and nothing of theirs is saved. Reload the page and do it again.

### 4.15 Copying Printful stock to the website

1. Press **Copy Printful stock to the website** (`page.tsx` L93).
2. The server asks Printful once per **garment** (at most 40 garments, `merch-inventory-server.ts` L15–16). It sets every variant to sellable or not, saves, and audits `merch.stock_synced` (`actions.ts` L51–63).
3. The message reads *"Checked n variants at Printful; m changed on greenwaymerch.com."* plus a note if Printful did not answer for some garments.

**How often:** **automatic since D232 M-6 (G-83).** Two things now do it without anyone pressing the button:
- **Every 6 hours** (00:40, 06:40, 12:40, 18:40 UTC) the main project's cron `/api/cron/merch-stock` (`vercel.json`) runs the same copy (`src/lib/merch/merch-stock-server.ts`), audited as `merch.stock_synced` by `cron:merch-stock`.
- **Within about a minute of Printful's notice:** once the webhook is registered with `stock_updated` (S-10), Printful tells the shop when a watched garment's stock changes; the shop passes the garment number to the back office (`/api/merch-stock`, the catalog token), which re-reads that garment from Printful and saves it, audited by `printful:stock_updated`.

Press the button by hand only right after a re-publish, or if Merch Health **H-17** says the copy is over a day old (then check Vercel → main project → Cron Jobs). If Printful runs out between copies, the webhook still alerts you when Printful puts an order on hold.

> **A safety net.** At checkout and in the webhook the shop re-reads the catalog fresh and drops variants marked out of stock (`merch-site/lib/catalog-core.ts` L267). So a sync stops further sales at once.

### 4.16 The CSV export

**Download CSV** (`/admin/inventory/merch/export`) gives one row per variant with the same columns as the table. Use it for the monthly review (form 8.3) or the accountant.

---

### Part 5: Orders and money

### 4.17 What happens when a customer pays

`merch-site/app/api/stripe/webhook/route.ts` L1–121:

1. Checkout re-prices the cart from the **fresh** catalog, so prices in the browser are never trusted (`checkout/route.ts` L33). It accepts **US** addresses only. The session lasts at most 24 hours (`checkout-core.ts` L79–80). The card is **authorized only**, not charged (`capture_method=manual`, L85).
2. Stripe calls the webhook. The shop checks the signature (5-minute tolerance) and re-reads the session from Stripe. Then (`region-core.ts` `decidePayment`):
   - **Washington address** → **capture** the card → create a Printful **draft** order. With `MERCH_PRINTFUL_AUTO_CONFIRM=true` the order is confirmed straight away (L112–113), which is not recommended.
   - **Not Washington** → **cancel** the authorization (free) → email the shopper *cancelled* → alert you *"cancelled automatically (not charged)"* (L74–87).
   - **A problem with the order plan** (catalog changed, bad address) → **not captured** → alert *"Order … needs you - NOT sent to Printful"* with *"Holds expire after about 7 days"* (L90–95). See §4.20.
   - **Printful not connected** → alert, answer 500 so Stripe retries (L100–101).
   - **Printful down** → alert, answer 500 so Stripe retries for up to 3 days. **Printful rejected it** → alert, no retry (L116–117).

### 4.18 Confirming an order (the human click)

**Either place works.**
- **Shop desk:** `greenwaymerch.com/admin/orders`. Enter Token B, which is remembered for 12 hours (`actions.ts` L24). Filter **Draft** → check the item, the address and paid vs Printful cost → **Confirm** (`POST /orders/{id}/confirm`, L42).
- **Back office:** **Orders** → merch panel → open the order (`/admin/orders/merch/[ref]`) → **Confirm**. Only a **draft** can be confirmed (`merch-orders-core.ts` L79). The page re-reads Printful first, so a stale page can never confirm twice. The action is audited as `merch.order_confirm` (`merch-actions.ts` L32–51).

**After Confirm**, Printful charges the LLC card and production takes about 2–5 business days.
**Rule:** confirm every draft **the same business day** (form 8.3).

### 4.19 Cancelling an order and refunding the customer

> **Since D232 M-7 (G-86) the order page shows both halves.** The **Stripe half** card reads the payment from the shop (`GET /api/payments`, Token D) and shows its state, the amount, and a link to it in the Stripe dashboard. Owner and admin (`merch.refund`) get **Release the card hold** (an uncaptured payment, free) or **Refund in Stripe** (a captured one, full amount). You must type the order ref to confirm. The shop re-reads Stripe first and sends a fixed idempotency key (`gm-cancel-<pi>`, `gm-refund-<pi>`), so a double press can never refund twice. Audited as `merch.payment_release` / `merch.payment_refund`. Without Token E (§4.3) the page shows the Stripe link and the steps below (guidance first, Q-11-4).
>
> **Before M-7: cancel was two systems, and the app only did one of them** (F-11-10). The order page said so: *"Cancels it at Printful (any Printful charge is returned to the LLC's card). This does **not** refund the customer: refund them in Stripe as well."* (`orders/merch/[ref]/page.tsx` L176–186).

1. **Back office:** the order page → **Cancel this order…** → **Yes, cancel at Printful**. You can cancel orders that are Draft, Pending or Failed (`merch-orders-core.ts` L81). It is audited as `merch.order_cancel`.
2. **Then, the same minute: the Stripe half** on the same page → **Refund in Stripe** (or **Release the card hold**) → type the order ref → confirm. If the button is not shown: **Stripe** → **Payments** (link on the page, L170) → find the payment (search the customer email or the order ref) → **Refund** → full amount → reason. If the payment is still **Uncaptured**, press **Cancel** instead; that is free.
3. Write it on form 8.4: order ref, Printful cancelled (time), Stripe refunded (time), by whom.

**After production has started** (In process / Shipped), Printful will not cancel. Contact Printful support. For a customer return, see the shop's policy pages.

### 4.20 Card holds that are never captured (the 7-day clock)

The webhook leaves the authorization in place when something needs you (§4.17). Card networks keep a card-not-present hold for about **7 days** (Visa customer-initiated 7 days; Mastercard, Amex and Discover 7 days). **Then it expires and the sale is lost** (Stripe documents, Appendix A.3).

**Since D232 M-7 (G-84) the daily check reminds you.** The shop's `/api/health` lists every hold older than 3 days (up to 25, oldest first). Merch Health H-15 names the orders, and the daily run emails `ORDER_STAFF_EMAILS` once at **day 3** and once at **day 5** for each hold (deduped in `compliance_reminder_log` as `merch-held:<pi>:day3|day5`). Each order page's Stripe half shows the hold age and **Release the card hold**.

**Rule:** every *"needs you"* alert is handled the same day. Stripe → Payments → filter **Uncaptured** → fix the cause → **Capture**. Then create the Printful order by hand, or resend the event from Stripe → Webhooks. Otherwise **Cancel** the hold.

### 4.21 Shipped emails, problems at Printful and owner alerts

- **Shipped:** Printful calls `/api/printful/webhook/<Token C>` and the shop emails the customer the tracking link. If the email fails, you get *"Shipped email NOT sent for …"* (`[token]/route.ts` L43–45).
- **Problems:** `order_failed`, `order_canceled` and `order_put_hold` give an alert *"Printful: order put hold - …"* with the reason (`orders-core.ts` L170; route L31–32).
- **Where alerts go:**
  - by email to `MERCH_ORDER_ALERT_EMAIL` through Resend;
  - **always** as well into the merch project's Vercel logs as `[merch-alert] …` (`fulfillment.ts` L55–58).
  - **since D232 M-7 (G-85)**, into the back office: the shop POSTs each alert to `/api/merch-alerts` (Token A). It is stored in `merch_alerts` (migration 0361), and the same alert repeating bumps a counter instead of making a new row. You see open alerts on **Orders** (above the merch panel), on **Merch Health**, and on each order's page. Press **Acknowledge** when handled (`orders.manage`, audited as `merch.alert_acknowledged`). A repeat after acknowledge re-opens it.
- **Before M-7, if Resend was not set up, alerts existed only in the logs and nobody was told** (F-11-9). The inbox closes that hole; email stays as a second channel.
- **Weekly check** (form 8.3): the alerts inbox on **Orders** is empty or every row is acknowledged. If the back office was down, also search Vercel → merch project → **Logs** for `[merch-alert]`.

---

### Part 6: The shop's look, the reports and the ad

### 4.22 Website → Merchandise editors

All of them follow the same pattern: **draft → preview → Publish**, with revisions you can restore. Each has its own **?** helper (`page-helpers-core.ts` L246–300).

| Editor | Where | What it controls |
|---|---|---|
| **Merch Header & Footer** | `/admin/merch-site/header-footer` | the header, announcement bar and footer on every shop page |
| **Merch Banners** | `/admin/merch-site/banners` | a finished banner for the home page or any category (desktop, phone, alt text, link) |
| **Merch Product Cards** | `/admin/merch-site/cards` | the wording on product and category cards, and each category's image and blurb |
| **Merch Order Emails** | `/admin/merch-site/emails` | the shipped and cancelled-outside-Washington emails |
| **Merch Ad Card (on Shop)** | `/admin/merch-site/ad-card` | redirects to Merch Studio → Publish & Ads (§4.12 B) |

The shop reads published content from `/api/merch-content`, which is public and serves published content only, cached for 60 s. Like the catalog, that address now redirects to www. It still works because the feed is public (F-11-1). Set `MERCH_CONTENT_URL` to the www address to save the extra hop.

### 4.23 Reports → Merch

**Reports → Merch** (`/admin/reports/merch`, `reports.view`):
- **Merch sales by day**: what customers paid, in Pacific days.
- **Breakdown**: where the money went.
- **Top merch items**.
- **By delivery location**.
- **Washington sales tax**: tax charged at checkout, read back from Printful orders. *"Greenway Merchandising LLC files this with WA DOR; Printful does not collect or remit it."*
- **Cancelled / failed (not counted)**.
- **greenwaymerch.com traffic** (Vercel Web Analytics: top pages, sources, countries, devices). Until `VERCEL_ANALYTICS_TOKEN` and `MERCH_VERCEL_PROJECT` are set, the card shows the three setup steps.

**Helper (D232 M-8, G-90):** the first notice on the page ends with **How this page works**, which opens **How Reports → Merch works** on the Helpers page (the tab shares the Reports header, so the link lives in the notice).

### 4.24 The Greenway Goods ad on the cannabis site (WAC 314-55-155)

The cannabis site may **link** to the LLC's shop. Its wording must still follow Washington's cannabis advertising rules (WAC 314-55-155), with no prices and no product details. The ad checker enforces the no-prices, no-checkout and separate-domain rules (§4.12 B). The checker cannot judge **appeal to children**, false health claims or the other WAC themes, so a person reads every ad before Publish (form 8.2, part C). The Creative Studio version of this SOP (v2.0) will cover advertising compliance in full.

---

## 5. Messages you may see, and what to do

| Message (exact) | Where | Why | What to do |
|---|---|---|---|
| *Checkout isn't open yet. Please check back soon.* | shop cart | `STRIPE_SECRET_KEY` missing or invalid, or `MERCH_SHIP_FLAT_CENTS` missing (`checkout/route.ts` L22–24) | S-6/S-9; check both in Vercel and redeploy |
| `{"error":"Webhook not configured."}` (503) | Stripe → Webhooks attempts | `STRIPE_WEBHOOK_SECRET` or `STRIPE_SECRET_KEY` missing (webhook L41) | S-7/S-9; then Stripe → event → **Resend** |
| `Bad signature.` (400) | Stripe attempts | wrong `whsec_` (test vs live mixed up) | copy the signing secret of **this** endpoint and mode |
| *Printful isn't connected yet: add PRINTFUL_API_TOKEN…* | Studio mockups, Inventory, Orders | no token in the **main** project (`printful-client.ts` L30) | S-4 and S-12 |
| *Printful's mockup limit was hit (2 per minute for new stores, 10 for established)…* | Proof & Export | Printful rate limit (`proof-actions.ts` L97) | wait 60 s |
| *The private 'merch-files' bucket doesn't exist yet - apply migration 0281…* | Proof & Export | migration not applied | owner applies 0281 |
| *Some artwork isn't on this device (n). Open the design on the computer it was made on.* | Publish | art lives in the other browser (§4.6) | publish from the original computer |
| *n variants - Printful allows 100 per product* | Publish issues | too many colour × size combinations | untick some, or split |
| *Another design is already published as "…". Change the product title…* | Publish | handle collision (`merch-inventory-core.ts` L97–98) | new title |
| *The catalog is full (200 products). Remove an old one first.* | Publish | catalog limit (L96) | remove a dead product |
| *A print file didn't arrive in Storage as a PNG. Publish again.* | Publish | upload interrupted (`catalog-actions.ts` L74) | press Publish again |
| *Type the product's web name exactly to confirm removal.* | Inventory | confirm text did not match | type the handle exactly |
| *Printful now says this order is "…", so it can't be confirmed/cancelled from here.* | Order page | status moved on at Printful (`merch-actions.ts` L44) | open it at Printful |
| *Not published: …* | Publish & Ads (ad) | an ad blocker (`ad-actions.ts` L38) | fix the field named |
| Alert: *Order … needs you - NOT sent to Printful* | email / logs | plan problem; the card is **held** | §4.20 the same day |
| Alert: *Order … paid but Printful isn't connected* | email / logs | no token in the **merch** project | S-4/S-9, then resend the Stripe event |
| Alert: *Printful is unreachable / rejected order …* | email / logs | Printful down (Stripe retries) or refused | down: wait and check status (§9.4); rejected: fix it at Printful or refund |
| Alert: *Out-of-state order … cancelled automatically (not charged)* | email | non-WA address | nothing to do |
| Alert: *Out-of-state order … could NOT cancel the card hold* | email | Stripe refused the cancel | cancel it in the Stripe dashboard |
| Alert: *Shipped email NOT sent for …* | email | Resend problem or no customer email | email the tracking link by hand |
| Alert: *Printful: order failed / canceled / put hold - …* | email | Printful problem | open it at Printful; refund if it is cancelled |

## 6. Exceptions & troubleshooting

### 6.1 I published, Merch Inventory shows it Live, but greenwaymerch.com does not show it
1. Wait about 60 s (the shop caches for 60 s).
2. **Today the cause is F-11-1.** The default catalog address redirects to www and the token is dropped. Fix: merch project → add `MERCH_CATALOG_URL` = `https://www.greenwaymarijuana.com/api/merch-catalog` → redeploy.
3. Otherwise, check that Token A is **identical** in both projects and at least 32 characters long, and that both projects were redeployed after the change.
4. Check the product is **Live** and not Hidden.

### 6.2 Checkout says it isn't open
See §5, first row. Check Vercel → merch → Environment Variables for `STRIPE_SECRET_KEY` and `MERCH_SHIP_FLAT_CENTS` (cents, digits only).

### 6.3 Stripe says the webhook is failing
Stripe → Webhooks → endpoint → **Event deliveries**:
- **503** = variables missing;
- **400** = wrong secret;
- **3xx** = wrong URL (www);
- **500** = Printful down or not connected (it retries by itself).

Stripe disables an endpoint that keeps failing for days, so check that it still says **Enabled**.

### 6.4 No "shipped" emails
1. Merch Health → H-5 → **Check what is registered**; it must be the shop address with all 5 events. If not, press **Register / repair** (S-10).
2. Check the Resend domain is Verified and `MERCH_EMAIL_FROM` is set.
3. Search Vercel logs for `[merch-alert] Shipped email NOT sent`.

### 6.5 Printful token expired
Every Printful feature stops at once in **both** sites: mockups, stock, orders, and the webhook's order creation (paid orders alert and Stripe retries for up to 3 days). Make a new token (S-4), paste it in **both** projects, redeploy both, and press **Check what is registered** on Merch Health H-5 (S-10; the webhook registration belongs to the store and normally survives, but check it). Record the new expiry on form 8.1.

### 6.6 I changed computers and my designs are gone
Since D232 M-4 they are on the server (§4.6). Open the Studio on the new computer and wait a moment: the designs and their art come down by themselves. If a design is still missing (it was made before migration 0360 was applied and never opened since), go to the old computer and open the Studio once so it uploads, or use **Design → Drafts → Import design (.json/.zip)** with the Proof & Export ZIP. Art that was on neither computer must be uploaded again.

### 6.7 A hidden product came back
Since D232 M-5 a re-publish keeps Hidden (F-11-7 fixed). If one came back, someone pressed **Show** in Merch Inventory; check the audit log (`merch.product_shown`) and hide it again.

### 6.8 Printful or Stripe is down
- Printful: `https://www.printfulstatus.com`
- Stripe: `https://status.stripe.com`
- Resend: `https://resend-status.com`

Paid orders are safe. Stripe keeps retrying the webhook for up to 3 days, and alerts say *unreachable*. Do nothing until the status page is green, then check Stripe → Webhooks for failed deliveries and **Resend** them.

## 7. Controls: what the app already does well, and what it does not do yet

**What already works well (F-11-C):**
- **Fail closed everywhere.** No Printful token means nothing is sent anywhere (`printful-client.ts` L9–10, L30). No Stripe or shipping settings means checkout stays closed, never a guessed price (`checkout-core.ts` L133). Dollars are refused in money settings (L134).
- **Washington only, without fees.** The card is authorized, then captured only for a WA address, and other states are cancelled free (`checkout-core.ts` L85; webhook L74–104).
- **The browser is never trusted for price.** Checkout and the webhook re-price from a **fresh** catalog read (`checkout/route.ts` L33; webhook L90).
- **Idempotent.** Capture and cancel use idempotency keys (`gm-capture-…`, `gm-cancel-…`), and Printful orders use `update_existing=true` (webhook L75, L104, L113).
- **A hidden, constant-time catalog feed.** 404 for any wrong token, 503 only on a read error (`merch-catalog/route.ts` L20–31). The shop keeps its last good list if the feed fails (`catalog.ts` L38–44).
- **A human Confirm by default** (`MERCH_PRINTFUL_AUTO_CONFIRM` unset).
- **Audits** on publish, re-publish, hide, show, remove, stock sync, confirm and cancel.
- **The store never overwrites a catalog it could not read** (`merch-inventory-store.ts`).
- **Remove is owner/admin only**, with a typed confirmation.
- **Print files are verified PNGs** under the product's own folder (`catalog-actions.ts` L70–75).
- **The ad cannot show prices or product details** on the cannabis site (`merch-ad-core.ts` L211+), checked again on the server.

**What it does not do yet:** see Appendix B (F-11-1 … F-11-18, G-76 … G-93).

## 8. Checklists & forms

### Form 8.1 — Merch setup record (owner, one time; update on every change)

| # | Step (§4.2) | Done ✓ | Date | Notes / expiry |
|---|---|---|---|---|
| S-1 | Tokens A, B, C made and saved in the password manager | ☐ | | |
| S-2 | Printful LLC account; one API/manual store; packing slip | ☐ | | store name: |
| S-3 | Printful legal info; LLC card; WA resale certificate | ☐ | | cert status: |
| S-4 | Printful private token (scopes: orders, webhooks, file_library) | ☐ | | **expires:** |
| S-5 | Stripe LLC account activated (payments + payouts) | ☐ | | |
| S-6 | Stripe secret key (test, then live) | ☐ | | |
| S-7 | Stripe webhook (2 events, apex URL), test **and** live | ☐ | | |
| S-8 | Stripe Tax Washington registration; `MERCH_STRIPE_AUTOMATIC_TAX=true` | ☐ | | |
| S-9 | Merch project variables **incl. `MERCH_CATALOG_URL` (www)**; redeployed | ☐ | | |
| S-10 | Printful webhook registered (5 events, M-6 button); Merch Health H-5 green | ☐ | | |
| S-11 | Resend domain Verified; `RESEND_API_KEY`, `MERCH_EMAIL_FROM`, alert email | ☐ | | |
| S-12 | Main project variables; redeployed | ☐ | | |
| 4.5 | Test order passed (all 9 steps); live order passed | ☐ | | |
| | Vercel analytics token expiry | | | **expires:** |
| | Signed (owner) | | | |

### Form 8.2 — New product sign-off (one per product, before Publish)

- **A. Design**
  - Garment, colour(s) and placements.
  - Studio-default placements checked against the Printful template ☐.
  - 0 ⛔ print checks ☐.
  - ZIP saved to the shared drive (path) ☐.
- **B. Sample**
  - Sample order # / date received.
  - Every sample checklist item passed ☐ (position, size, colour, fit, label, wash, hand).
- **C. Words**
  - Title and description proofread ☐.
  - Ad wording read against WAC 314-55-155 (no appeal to children, no health claims) ☐.
- **D. Money**
  - Printful cost, real shipping cost, flat shipping charged, retail, profit and margin.
- **E. Approval**
  - Approved by (owner/named person), date.
  - Published by, date.
  - Visible on greenwaymerch.com ☐.

### Form 8.3 — Merch routine

| When | Task |
|---|---|
| **Every business day** | Shop desk or Orders: **Confirm** every Draft ☐ · handle every alert email ☐ · Stripe → Payments → **Uncaptured** = 0 ☐ |
| **Daily** | Merch Health H-17 green (stock copied in the last day; automatic since M-6) ☐ · Merch Inventory Needs attention = 0 ☐ |
| **Weekly** | Vercel merch logs → search `[merch-alert]` ☐ · Stripe → Webhooks endpoint **Enabled**, no failed deliveries ☐ · Resend → Emails delivered ☐ |
| **Monthly** | CSV export to the books ☐ · Reports → Merch WA sales tax to the accountant ☐ · Printful token expiry > 30 days away ☐ · Printful status, Stripe status ☐ |
| **Each token change** | update both projects, redeploy both, re-run S-10 if Token C or Printful token changed, update form 8.1 ☐ |

### Form 8.4 — Cancel and refund log

| Date | Order ref | Reason | Printful cancelled (time, by) | Stripe refunded / hold cancelled (time, by) | Customer told |
|---|---|---|---|---|---|

## 9. Quick reference

### 9.1 Card: publish a product (designer)
Garments → Design (0 ⛔) → Proof & Export (ZIP, proof sheet, mockups) → **sample approved in Proof & Export (form 8.2)** → Publish & Ads B → title, colours, sizes, **price**, photos → **Publish to greenwaymerch.com** → Merch Inventory → **Copy Printful stock**.

### 9.2 Card: an order came in (owner/staff)
Alert or desk → **Confirm** the draft the same day. To cancel: **Printful cancel + Stripe refund, both** (form 8.4). If an alert says *"needs you"*, deal with the held card within 7 days (§4.20).

### 9.3 Links
| What | Where |
|---|---|
| Studio | `/admin/merch-studio` |
| Merch Inventory | `/admin/inventory/merch` |
| Merch orders | `/admin/orders` (merch panel) |
| Reports → Merch | `/admin/reports/merch` |
| Shop | `https://greenwaymerch.com` |
| Shop order desk | `https://greenwaymerch.com/admin/orders` (Token B) |
| Printful tokens | `https://developers.printful.com/tokens` |
| Stripe webhooks | `https://dashboard.stripe.com/webhooks` |
| Status pages | printfulstatus.com · status.stripe.com · resend-status.com |
| Long setup guide | `docs/MERCH-SITE-FINISHING-GUIDE.md` (see the correction in §4.4.1) |

### 9.4 Live status snapshot (read-only probes, 2026-11-11 08:36 UTC)

| Probe | Result | Meaning |
|---|---|---|
| `GET https://greenwaymerch.com` | 200 | shop is up |
| `GET https://www.greenwaymerch.com` | 307 → apex | good: the apex is the main address, so the Stripe webhook URL must be the apex |
| `POST /api/checkout` | **503** *Checkout isn't open yet* | Stripe key and/or `MERCH_SHIP_FLAT_CENTS` **not set** |
| `POST /api/stripe/webhook` (unsigned) | **503** | `STRIPE_SECRET_KEY` and/or `STRIPE_WEBHOOK_SECRET` **not set** (set would give 400) |
| `POST /api/printful/webhook/<wrong>` | 404 | expected (Token C guard works) |
| `GET /admin/orders` | asks for the admin key | `MERCH_ADMIN_KEY` is set |
| Shop footer | contact@greenwaymerch.com, phone, address shown | `NEXT_PUBLIC_MERCH_*` set |
| `/tees` and every category | 0 products | consistent with F-11-1 and/or nothing published |
| `GET https://greenwaymarijuana.com/api/merch-catalog` | **308 → www** | **F-11-1**: the token is dropped on that redirect |
| `GET https://www.greenwaymarijuana.com/api/merch-catalog` (no token) | 404 | expected (hidden feed) |
| `GET https://greenwaymarijuana.com/api/merch-content` | 308 → www | works (public), with an extra hop |

Not checkable from outside: whether `MERCH_CATALOG_URL`, `MERCH_CATALOG_TOKEN`, `PRINTFUL_*`, `RESEND_API_KEY` and `MERCH_EMAIL_FROM` are set, whether the Printful webhook is registered, and the token's expiry. **Merch Health** (G-77, built in D232 M-2) shows all of these on one screen, from inside both projects.

## 10. Glossary

| Term | Meaning |
|---|---|
| **Blank** | the plain garment Printful prints on |
| **Placement** | a print area (front, back, sleeve, brim…), with a true size in inches |
| **Studio-default** | a placement size the Studio estimated; confirm it with Printful's template |
| **Print file** | the 300-DPI transparent PNG Printful prints from |
| **Mockup** | Printful's photo-like picture of the design on the garment |
| **Handle** | the product's web name, made from the title (e.g. `greenway-arch-tee`) |
| **Variant** | one colour × size combination, with its own Printful variant id |
| **Listing package** | the product data that Publish writes to the catalog |
| **Catalog** | the list of published products, stored in site settings `merch_catalog` and read by the shop |
| **Token A / B / C** | catalog feed secret / shop order-desk key / Printful webhook secret |
| **Authorize / capture** | hold the card / actually charge it |
| **Draft order** | a Printful order that does nothing until someone presses Confirm |
| **Webhook** | one system calling another to say something happened |
| **Live / Hidden** | shown on the shop / kept in the catalog but not shown |
| **Website mismatch** | Printful's stock and the shop's Shown/Hidden disagree |

---

## Appendix A: Source map and external sources

### A.1 Back office (main app)

| Area | Files (all read for this SOP) |
|---|---|
| Studio page and tabs | `src/app/admin/merch-studio/page.tsx` (L35 permission, L50 helpId, L53–56 seller strip) · `src/lib/merch-studio/studio-tabs-core.ts` L12–18 · `src/components/admin/merch-studio/MerchStudio.tsx` |
| Garments | `CatalogPanel.tsx` · `src/lib/merch-studio/garment-catalog-core.ts` (L31 `DimsSource`, L171–249 blanks, 7× `studio-default`) · `garment-colors-data.ts` · `garment-views-core.ts` |
| Design | `DesignStudio.tsx` (L340–345 sub-tabs, L563 stale storage text) · `AddPanel.tsx` · `ElementPanel.tsx` · `MerchCanvas.tsx` · `IssueList.tsx` · `merch-assets.ts` (L6–9, L15–17 storage) · `src/lib/merch-studio/merch-design-core.ts` · `print-rules-core.ts` |
| Proof & Export | `ProofPanel.tsx` (L34/L90 sample ticks, L208–209, L217, L253, L281) · `print-export.tsx` · `print-export-core.ts` L360–368 · `src/app/admin/merch-studio/proof-actions.ts` (L28, L56, L88, L96–97) · migration `0281_merch_print_files_bucket.sql` |
| Artwork Check | `ArtCheckPanel.tsx` L48–83 |
| Fulfillment | `FulfillmentPanel.tsx` (L39, L68) · `src/lib/merch-studio/fulfillment-core.ts` (L70–88, `SHIPPED_SLICE` L76) |
| Publish & Ads | `PublishPanel.tsx` (L4–16, L31, L181–183, L235–285, L383–402) · `catalog-actions.ts` (L6–7, L29, L38–97) · `ad-actions.ts` (L36–38, L53–59) · `src/lib/merch-studio/listing-package-core.ts` (L42–47, L130–171) · `src/lib/merch/merch-ad-core.ts` L211+ · `src/lib/merch-studio/printful-client.ts` (L9–10, L18, L24–32) |
| Merch Inventory | `src/app/admin/inventory/merch/page.tsx` (L35–37, L47–50, L56, L77, L87, L93) · `actions.ts` (L22–63) · `export/route.ts` · `src/lib/merch/merch-inventory-core.ts` (L28, L90–110, L129–134, L141–143, L160–172, L184, L208–232) · `merch-inventory-store.ts` (L13–20) · `merch-inventory-server.ts` (L11–22) |
| Orders | `src/lib/orders/merch-orders-server.ts` · `merch-orders-core.ts` (L79, L81) · `src/app/admin/orders/merch-actions.ts` (L32–62) · `src/app/admin/orders/merch/[ref]/page.tsx` (L170, L176–186) |
| Reports | `src/app/admin/reports/merch/page.tsx` (L1–11, L67) · `src/lib/merch/merch-reports-core.ts` |
| Shop-look editors | `src/app/admin/merch-site/{header-footer,banners,cards,emails,ad-card}/page.tsx` · `MerchSiteEditor.tsx` |
| Feeds | `src/app/api/merch-catalog/route.ts` (L7–31) · `src/app/api/merch-content/route.ts` |
| Nav, helpers, concierge | `src/components/admin/admin-nav-data.ts` L86, L101, L161–168 · `src/lib/admin/page-helpers-core.ts` (L246–300 merch editors, L323–341 merch-studio, L372 test) · `src/lib/admin/concierge-kb.ts` (L194, L200: the only merch facts) · `src/lib/integrations/integration-guides.ts` (L30–97: leafly, weedmaps, flux, sage50, cultivera; no Printful/Stripe) |
| Health patterns to reuse | `/admin/settings/platform-health` (`page.tsx`, `actions.ts`) + `/api/cron/platform-health` (`vercel.json` L82–83, `25 14 * * *`) · `src/components/admin/registers/IpadSetupPanel.tsx` · `src/components/admin/medical/GuidedIntakeWizard.tsx` · `/admin/settings/banking/bank-setup` |
| Tests | `tests/merch-studio-core.test.ts` · `tests/merch-orders-panel-r73.test.tsx` · `tests/merch-intel-core.test.ts` · pure self-tests in each `*-core.ts` |

### A.2 Shop (`merch-site/`, its own Vercel project, Next 16.4.3, Node 24.x, no database)

| Area | Files |
|---|---|
| Catalog and content | `lib/site.ts` (L19 `siteUrl`, **L30 `MAIN_SITE_URL` non-www**) · `lib/catalog.ts` (L4–44) · `lib/catalog-data.json` · `lib/catalog-core.ts` (L260–268) · `lib/site-content.ts` L6–21 · `lib/site-content-core.ts` |
| Checkout | `app/api/checkout/route.ts` (L10–33) · `lib/checkout-core.ts` (L11–19, L40–48, L79–118, self-tests L133–157) |
| Stripe webhook | `app/api/stripe/webhook/route.ts` (L1–121; L36 events, L41 503, L74–117) · `lib/region-core.ts` (`decidePayment`) |
| Printful | `lib/fulfillment.ts` (L14–23 client, L41–43 email, L55–58 alerts) · `lib/orders-core.ts` (L165–170) · `app/api/printful/webhook/[token]/route.ts` (L7–8, L24, L31–45) |
| Order desk | `app/admin/orders/page.tsx` · `actions.ts` (L24 12-hour cookie, L35–42 confirm) · `lib/admin.ts` L6 |
| Deploy | `vercel.json` (main only; **no crons**) · `README.md` (L45 *"Adding a product (no code)"*, stale) |
| Owner guide | `docs/MERCH-SITE-FINISHING-GUIDE.md` (384 lines; §2.3 L94–104, §3.1/3.2 L114–152, Parts 4–7) |

### A.3 External sources (checked 2026-11-11)

- **Printful API documents** (developers.printful.com/docs):
  - the general rate limit is 120 calls a minute; mockups are 2 a minute for new stores and 10 for established ones (matches `proof-actions.ts` L97);
  - *"Private Tokens have an expiration date… expired tokens cannot be refreshed and must be replaced manually."*
  - the scopes include `orders`, `orders/read`, `sync_products`, `file_library`, `webhooks`, `webhooks/read`, `product_templates` and `stores_list`;
  - health-check endpoints: `GET /oauth/scopes`, `GET /stores`, `GET /webhooks` (current url + types), `GET /orders`;
  - on `POST /webhooks`: *"only one webhook URL can be active for a store, so calling this method disables all existing webhook configuration."*
  - extra events: `stock_updated`, `order_refunded`, `order_remove_hold`, `package_returned`, `order_put_hold_approval`.
- **Printful status:** `https://www.printfulstatus.com/api/v2/status.json`.
- **Stripe documents:**
  - Webhook endpoints: `GET /v1/webhook_endpoints` returns `url`, `status` (enabled/disabled) and `enabled_events`.
  - *"We consider redirect responses to webhook requests as failures."*
  - Live-mode retries last up to 3 days.
  - Place a hold on a payment method: card-not-present authorizations last about 7 days for Visa (customer-initiated), Mastercard, Amex and Discover, after which an uncaptured PaymentIntent is canceled.
  - Status page: `https://status.stripe.com`.
- **Resend status:** `https://resend-status.com/api/v2/status.json`.
- **Local proof of F-11-1:** a Node 24 `fetch` with an `Authorization` header to a host that redirects to a different host arrives **without** the header (the same host keeps it). This is the WHATWG Fetch rule for cross-origin redirects.

---

## Appendix B: Findings, gaps and the roadmap strategy

### B.1 Findings (also in `03-FINDINGS-LEDGER.md`)

| ID | Type · Sev | Finding | Pin | Gap |
|---|---|---|---|---|
| **F-11-1** | BUG · **S1** | The shop's catalog address redirects to www, the token is dropped, and **no Studio product can appear** | `merch-site/lib/site.ts` L30; `catalog.ts` L23, L34–44; `api/merch-catalog/route.ts` L20–27; live probe 308 | **G-76** |
| **F-11-2** | GAP · S2 | Designs and art live in one browser only; no restore from `design.json`; the stale *"Slice 5"* promise | `merch-assets.ts` L6–9; `DesignStudio.tsx` L563; `PublishPanel.tsx` L235, L270; no JSON input | **G-79** **Resolved (D232 M-4):** designs and art on the server; Import design (.json/.zip). |
| **F-11-3** | GAP · S2 | No in-app setup guide or step coach; setup lives in a 384-line Markdown file | `docs/MERCH-SITE-FINISHING-GUIDE.md`; helper L323–341 has no setup steps | **G-78** |
| **F-11-4** | GAP · S2 | No health monitoring for Printful (token, scopes, expiry, webhook, status), Stripe (key, endpoint), Resend, the catalog round-trip or checkout open | no check in `/admin/compliance/health` or platform-health; `merch-site/vercel.json` no crons; `printfulConfigured()` only tests presence (`printful-client.ts` L24–25) | **G-77** **Resolved (D232 M-2):** Merch Health H-1 … H-19, daily. |
| **F-11-5** | GAP · S2 | The back office cannot see Stripe at all; its key lives only in the shop project | `STRIPE_*` read only in `merch-site/` | **G-80** **Resolved (D232 M-2):** the shop reports Stripe to the back office through `/api/health`. |
| **F-11-6** | GAP · S2 | The sample step is owner-driven but not enforced; the ticks are on one device | `fulfillment-core.ts` L83; `ProofPanel.tsx` L34, L90; `publishMerchListingAction` has no sample check | **G-81** **Resolved (D232 M-4):** server-saved approval with a photo; Publish blocked; owner-only override with a reason. |
| **F-11-7** | BUG · S2 | Re-publish makes a **hidden** product Live again and clears the stock-sync time | `merch-inventory-core.ts` L90–110 (`status: "live"`, `stockSyncedAt: ""`) | **G-82** **Resolved (D232 M-5).** |
| **F-11-8** | GAP · S3 | Stock copy is manual only (no cron, no `stock_updated` webhook) | `inventory/merch/actions.ts` L51; `merch-site/vercel.json`; webhook types L7–8 | **G-83** **Resolved (D232 M-6).** |
| **F-11-9** | WEAKNESS · S2 | Owner alerts go only to the logs if Resend is not set up, and there is no place in the app to see them | `merch-site/lib/fulfillment.ts` L41–43, L55–58 | **G-85** (+ G-77 check) **Resolved (D232 M-7).** |
| **F-11-10** | GAP · S3 | Cancel at Printful does not refund in Stripe; it is a manual two-system step | `orders/merch/[ref]/page.tsx` L176–186; `merch-actions.ts` L47 | **G-86** **Resolved (D232 M-7).** |
| **F-11-11** | GAP · S2 | Held cards (*"needs you"*) expire in about 7 days with no reminder | webhook `route.ts` L19–20, L90–95 | **G-84** **Resolved (D232 M-7).** |
| **F-11-12** | WEAKNESS · S3 | Stale copy: *"drop it in merch-site/catalog/"*, *"Slice 5"* shipping rates, *"Slice 5"* server designs, README *"Adding a product (no code)"*, finishing guide *"don't add"* `MERCH_CATALOG_URL` | `fulfillment-core.ts` L73–74, L84; `FulfillmentPanel.tsx` L39, L68; `DesignStudio.tsx` L563; `merch-assets.ts` L7; `merch-design-core.ts` L15; `merch-site/README.md` L45; guide §3.1 | **G-91** |
| **F-11-13** | WEAKNESS · S3 | Retail starts at a hard-coded $35; suggested retail ignores shipping; flat shipping is never compared with Printful's real rate | `PublishPanel.tsx` L250; `FulfillmentPanel.tsx` L68; `checkout-core.ts` L40 | **G-87** **Resolved (D232 M-8).** |
| **F-11-14** | WEAKNESS · S4 | 7 placements are studio estimates, not Printful's measurements (**8**, corrected in v1.9) | `garment-catalog-core.ts` L151, L195, L214, L225–226 (+2) | **G-92** **Resolved in the app (D232 M-8):** marked *awaiting sample measurement* and compared with Printful's print files; the sizes change only after the samples are measured (Q-11-6). |
| **F-11-15** | WEAKNESS · S4 | Every re-publish leaves the previous print PNGs in the public bucket | `catalog-actions.ts` L6–7, L50; Remove cleans only the current set (`actions.ts` L42–45) | **G-93** **Resolved (D232 M-5).** |
| **F-11-16** | WEAKNESS · S3 | Catalog writes have no version check; two quick edits can lose one | `merch-inventory-store.ts` (read → modify → write) | **G-88** **Resolved (D232 M-5).** |
| **F-11-17** | GAP · S3 | Merch Inventory and Reports → Merch have no helper; the concierge has 2 merch facts; there are no Printful or Stripe integration guides | `inventory/merch/page.tsx` L56; `concierge-kb.ts` L194, L200; `integration-guides.ts` L30–97 | **G-90** **Resolved (D232 M-8).** |
| **F-11-18** | WEAKNESS · S3 | The Printful webhook is registered by hand with `curl`; a later registration silently replaces it; nothing checks it is still right | guide §6.3; Printful docs (A.3); webhook route L7–8 | **G-89** **Resolved (D232 M-6).** |
| **F-11-19** | GAP · S1 | The merch project never deployed slices M-1 … M-8: its Ignored Build Step (`git diff --quiet HEAD^ HEAD -- .`) sees only the docs-only last commit of each merge, so the shop has no `/api/health` and answers 404 to every `MERCH_HEALTH_TOKEN` | `merch-site/vercel.json` L9; live probe 2026-11-12: `/api/health` answers the HTML 404 page; the shop still links the bare `greenwaymarijuana.com` (M-1 changed it to www) | **Resolved (D235):** `merch-site/scripts/vercel-ignore.sh` compares with `VERCEL_GIT_PREVIOUS_SHA` and builds when unsure; Merch Health names it. Owner: one manual redeploy. |
| **F-11-C** | STRENGTH | Fail-closed, WA-only free cancel, fresh re-pricing, idempotent, hidden constant-time feed, last-good fallback, human Confirm, audits, owner/admin Remove, verified PNGs, ad price guard | §7 | — |

### B.2 Gaps (also in `05-GAP-REGISTER.md`)

| Gap | What gets built | Sev |
|---|---|---|
| **G-76** | **Catalog feed reaches the back office again.** **Owner, now:** set `MERCH_CATALOG_URL` (and `MERCH_CONTENT_URL`) to www in the merch project. **Code:** change `MAIN_SITE_URL` to `https://www.greenwaymarijuana.com`, **and** have the shop fetch with `redirect: "manual"` so a redirect is reported (*"the feed moved to …"*) and never followed without the token. Add a self-test, and a Merch Health check (G-77) that detects a redirect | S1 |
| **G-77** | **Merch Health panel and daily check** (the owner's *"printful store and stripe health"*). A new card set on `/admin/merch-studio/health` (and a line on platform-health), with a **Run check now** button, a daily cron and an email when anything turns red. The checks are in B.4  **DONE (D232 M-2)** | S2 |
| **G-78** | **Setup & Launch coach** (the owner's *"first step, do this, done great, step two…"*). A guided wizard for §4.2, plus a per-product **Product journey** stepper and **Next step** banners on every tab (B.5) | S2 |
| **G-79** | **Designs saved on the server.** Drafts in a table and art in the private `merch-files` bucket, so any computer works, with **Import design (.json/.zip)**. The browser copy becomes an offline cache | S2 **DONE (D232 M-4)** |
| **G-80** | **Shop health endpoint** `greenwaymerch.com/api/health`, Bearer token, read-only. It reports the Stripe key mode, the webhook endpoint (url, status, events), checkout open/closed with the reason, Resend configured, the catalog fetch result (status, product count, last good age, redirect seen) and the Printful token present. The back office reads it for G-77. Stripe secrets never leave the shop project  **DONE (D232 M-2)** | S2 |
| **G-81** | **Sample gate.** Sample approval saved on the server per design (who, when, the 8 checklist items, a photo), and **Publish is blocked** until it is approved. An owner override needs a typed reason and is audited | S2 **DONE (D232 M-4)** |
| **G-82** | **Re-publish keeps Hidden.** `upsertItem` keeps `prev.status` and `prev.stockSyncedAt` (or runs a stock sync straight after publish), and the message says so | S2 **DONE (D232 M-5)** |
| **G-83** | **Automatic stock.** A cron in the main project copies Printful stock every 6 hours. Optionally, Printful's `stock_updated` event drives it as well (registered through G-89, keeping all the order event types) | S3 **DONE (D232 M-6)** |
| **G-84** | **Held-card monitor.** The daily check lists uncaptured authorizations older than 3 days through the G-80 endpoint. It emails at day 3 and day 5, and the order page gets *"Capture / Cancel in Stripe"* coaching | S2 **DONE (D232 M-7)** |
| **G-85** | **Merch alerts inbox.** The shop POSTs each alert to a token-secured back-office endpoint, stored and shown on Merch Health and Orders with acknowledge. Email stays as a second channel | S2 **DONE (D232 M-7)** |
| **G-86** | **Cancel and refund in one guided step.** *Cancel at Printful* → the page then shows **Refund in Stripe**. This goes through a G-80-style shop endpoint (idempotent, audited) or, if the owner prefers, a deep link plus a confirm-done box. The order page shows both halves' status | S3 **DONE (D232 M-7)** |
| **G-87** | **Pricing guard.** No hard-coded $35 (last price or the calculator's suggestion). Suggested retail includes the real shipping gap. Publish warns when margin < the owner's minimum or flat shipping < Printful's US rate | S3 **DONE (D232 M-8)** |
| **G-88** | **Catalog version check.** Compare-and-set on `site_settings.updated_at` (the pattern used by D230 reopen). The loser gets *"Someone else changed the catalog - reload and try again"* | S3 **DONE (D232 M-5)** |
| **G-89** | **Register the Printful webhook from the app.** A button on Merch Health reads `GET /webhooks` first, shows what is there, then sets the URL with **all** needed types (the 4 order types plus `stock_updated` once G-83 ships). Audited, and re-checked daily by G-77 | S3 **DONE (D232 M-6)** |
| **G-90** | **Help everywhere.** `helpId` and helpers for Merch Inventory and Reports → Merch; **Printful**, **Stripe (merch)** and **Resend (merch)** integration guides on `/admin/integrations`; concierge facts for every §4 section and §5 message | S3 **DONE (D232 M-8)** |
| **G-91** | **Stale copy cleanup** (F-11-12 list), README *"Adding a product"* rewritten to *"Publish in Merch Studio"*, finishing guide §3.1 corrected | S3 |
| **G-92** | **Confirm the 7 studio-default placements** against Printful's file templates (or the `GET /mockup-generator/printfiles/{id}` sizes), then mark the source | S4 **DONE (D232 M-8)**: the compare button and the *awaiting sample measurement* mark are built; the final sizes follow the sample measurements |
| **G-93** | **Print-file cleanup.** On re-publish, delete the previous `<nonce>` folder once the new one is saved (only `merch-print/<handle>/`) | S4 **DONE (D232 M-5)** |

### B.3 The strategy in one paragraph

Fix the one thing that blocks every sale first. That is the www redirect (**M-1**), and the owner can do it today with one variable. Next, make the system **tell you when it is broken** before a customer does (**M-2**): one Merch Health screen and a daily email. It checks Printful, Stripe, Resend, the catalog feed and checkout using real API calls, not just "is a variable present". Then put the **hand-holding** on top of those checks (**M-3**). The setup coach can tick a step green by itself because the health check *proves* it is done: *"Step 4 ✓ Great, Printful accepted your token and it has the right permissions. Next: Step 5, Stripe."* After that, remove the traps that lose work or money: server-saved designs and the sample gate (**M-4**); re-publish keeping Hidden, the version check and cleanup (**M-5**); automatic stock and the in-app webhook button (**M-6**); and held-card, alert and refund follow-through (**M-7**). Finish with pricing, help and placements (**M-8**). Each slice is small, ships on its own and updates this SOP (D41) and the concierge (D42).

### B.4 Merch Health: what is checked, and how (G-77, G-80)

| # | Check | How (real call, not just a variable) | Green | Red tells you |
|---|---|---|---|---|
| H-1 | Printful token works | main: `GET /oauth/scopes` | 200 | *"Printful refused the token (expired or wrong). Make a new one: SOP-11 S-4"* |
| H-2 | Printful permissions | same answer: has `orders`, `webhooks`, `file_library` | all present | names the missing scope |
| H-3 | Printful token expiry | the date the owner typed in the coach (the API may not return it) | > 30 days | amber ≤ 30, red ≤ 7 days, with a countdown email |
| H-4 | Printful store | `GET /stores` (needs `stores_list`) or a store-scoped call | 1 store, the name matches | *"Account token without PRINTFUL_STORE_ID"* |
| H-5 | Printful webhook | `GET /webhooks` | URL = `https://greenwaymerch.com/api/printful/webhook/…` and the 5 events (4 order + `stock_updated`), every catalog garment watched (M-6) | *"Shipped emails are off: register it (button, G-89)"*: **built (M-6)** |
| H-6 | Printful service | `printfulstatus.com/api/v2/status.json` | `none` | Printful's own incident text |
| H-7 | Catalog round-trip | shop `/api/health` reports its last feed fetch | 200, n products, no redirect | **F-11-1 message** if a 3xx was seen |
| H-8 | Main site address | main: `HEAD` of the shop's configured feed URL with `redirect: manual` | 200/404 with no redirect | *"The feed address redirects; set MERCH_CATALOG_URL"* |
| H-9 | Stripe key | shop `/api/health`: `GET /v1/balance` or `/v1/account` | 200 and mode = live (or test, shown) | *"Stripe key missing or revoked"* |
| H-10 | Stripe webhook endpoint | shop `/api/health`: `GET /v1/webhook_endpoints` | apex URL, `enabled`, both events | *"Stripe disabled your webhook after failures"* |
| H-11 | Checkout open | shop `/api/health`: shipping config parses, the key format is valid | open | the exact reason (`MERCH_SHIP_FLAT_CENTS`…) |
| H-12 | Stripe Tax | `MERCH_STRIPE_AUTOMATIC_TAX` = true | on | amber *"No sales tax is charged"* |
| H-13 | Email | shop `/api/health`: `RESEND_API_KEY` and `MERCH_EMAIL_FROM` present (domain check needs a full-access key, so it is optional) | both | *"Alerts only go to logs"* |
| H-14 | Stripe and Resend service | `status.stripe.com`, `resend-status.com` JSON | operational | incident text |
| H-15 | Held cards | shop `/api/health`: PaymentIntents `requires_capture` older than 3 days (G-84) | 0 | names each held order (ref, days); day-3 and day-5 emails; Release on the order page: **built (M-7)** |
| H-16 | Drafts waiting | main: Printful `GET /orders?status=draft` older than 1 business day | 0 | *"n orders waiting for Confirm"* |
| H-17 | Stock fresh | catalog `stockSyncedAt` | < 24 h | *"Copy Printful stock"* |
| H-18 | Storage | the `merch-files` bucket exists (0281) | yes | *"Apply migration 0281"* |
| H-19 | Auto-confirm | `MERCH_PRINTFUL_AUTO_CONFIRM` | off | amber *"Orders go to production with no review"*; says whether it is on from the env or from the switch. **Auto-confirm switch built (M-7)**: owner only, a written reason, and at least 20 clean orders (paid here and delivered) to turn on; owner or admin can turn it off; audited `merch.auto_confirm_on/_off/_refused`; reaches the shop through the catalog feed and fails safe to drafts |

**Schedule and alerts:** the daily cron in the main project runs beside platform-health. It emails only on a **change** (green → red, or red → green) plus a weekly digest. The result history is kept like platform-health's run history. **Run check now** is for owner/admin.

**As built (D232 M-2).**
- **Page:** `/admin/merch-studio/health` (`src/app/admin/merch-studio/health/page.tsx`). Owner & admin (`settings.manage`). It is linked from the **Merch Health** button in the Merch Studio header and from Helpers. The checks run **live every time the page opens**, grouped Printful · Shop & Stripe · Catalog · Email · Services. Each shows Green, Amber, Red or Unknown, what was seen, the **Fix**, and the SOP-11 section. **Run check now** saves a run without sending email. H-3 has the **token expiry date** form (site setting `merch_health_settings`). The last 20 runs are listed.
- **Rules:** H-1 … H-19 come from `buildMerchHealth` (`src/lib/merch/merch-health-core.ts`, pure, 22 self-tests). The calls are made in `src/lib/merch/merch-health-server.ts` (Printful `/oauth/scopes`, `/stores`, `/webhooks`, `/orders?status=draft`; the shop `/api/health` with `redirect: "manual"`; the three status pages; the catalog; and the `media` and `merch-files` buckets).
- **Differences from the plan above:**
  - H-8 reads the shop's own last-feed result; no separate HEAD call is made.
  - H-9 reads the key mode from the key prefix and the Stripe answers to the H-10 and H-15 calls (`merch-site/lib/health.ts`).
  - H-14 uses `www.stripestatus.com`, because `status.stripe.com` has no JSON.
  - H-18 checks both buckets.
- **Shop side:** `merch-site/app/api/health/route.ts` sits behind Token D and answers 404 otherwise. It is built by `merch-site/lib/health.ts` from `health-core.ts` (pure, 10 self-tests). It makes a fresh catalog read and two Stripe reads (webhook endpoints and payment intents), and returns only presence flags.
- **Daily run:** it rides the existing `/api/cron/platform-health` run (vercel.json `25 14 * * *`, so **no new cron**) and runs in parallel with the database check. Each run is one row in `platform_health_runs` (kind `merch_health`). Staff get an email (`ORDER_STAFF_EMAILS`) only when the set of red checks changed since the last run, or on Mondays as a digest. The email is claimed once per Pacific day (`merch-health:daily:<day>` in `compliance_reminder_log`).

### B.5 The step-by-step coach (G-78): what it looks like

**1. Setup & Launch** (`/admin/merch-studio/launch`, owner/admin). One card per step S-1 … S-12 and the §4.5 test order:
- **What to do**: three to six short lines, with exact clicks, copy buttons for values, and links that open in a new tab.
- **How we know it's done**: a health check or an owner tick.
- **Status:** ⬜ not started · 🟡 in progress · ✅ done.

When a check turns green, the card collapses with **"✅ Great, done!"**, and the next card opens with **"Next: Step 5 · Stripe secret key"**. A progress bar reads *"7 of 13 done · about 35 minutes left."* Dates the owner types (token expiry, resale certificate) are saved and feed H-3. **Print setup record** prints form 8.1, already filled in. A step that goes red later (an expired token) re-opens itself, and the Studio header shows *"Setup needs you: Step 4."*

**2. Product journey stepper** (top of the Studio, for the open design):

`Garment ✓ → Design ✓ (0 ⛔) → Print files ✓ → Mockups ✓ → Sample approved ⬜ → Price ✓ → Publish ⬜ → On the shop ⬜ → Stock synced ⬜`

Each pill links to its tab. **"Next step"** names the one thing to do, for example *"Order a sample at Printful; when it arrives, tick the checklist on Proof & Export."* After Publish, it watches the shop until the product appears (through H-7) and then says *"Live on greenwaymerch.com. Next: copy Printful stock."*

**3. Per-tab coaching strips.** A one-line "you are here / do this / then go to" strip at the top of each tab. There is also a first-visit **"Show me around"** that highlights each control in turn, the same pattern as the iPad setup panel and the guided intake wizard.

**4. Order coaching.** On every merch order page, a strip names the next action by status:
- Draft → *"Confirm today"*;
- Held card → *"Capture or cancel within n days"*;
- Cancelled at Printful → *"Now refund in Stripe ▸"*.

**As built (D232 M-3a), item 1.**
- **Page:** `/admin/merch-studio/launch` (`src/app/admin/merch-studio/launch/page.tsx`), owner & admin (`settings.manage`). It runs Merch Health live on every visit and shows 13 cards (S-1 … S-12 and **T**, the test order) with a progress bar (*"n of 13 done · about 2 h 35 min left"* when nothing is done) and a **Next:** line. Each card has What to do, Done when, copy buttons, links, the health checks that prove it (with their fix) and, where the step needs your eyes, a tick box. Dates and notes (store name, resale-certificate status, analytics-token expiry, live date) are saved in site setting `merch_launch_progress`. The Printful token expiry is typed once, on S-4, and is the same value H-3 uses (`merch_health_settings`).
- **Rules:** `src/lib/merch/merch-launch-core.ts` (pure, 19 self-tests). A step is **done** when every proof is green and, if it is a manual step, it is ticked. It is **Needs you** when a proof is red after the step was ticked or partly proven, so an expired token re-opens S-4 and S-12.
- **Studio header:** owners and admins see **Setup & Launch** and **Merch Health** buttons, and a line *"Setup needs you: Step n · …"* (red) or *"Setup: n of 13 done… Next: …"* (amber), read from the **last saved** health run so the Studio stays fast.
- **Form 8.1:** `/admin/merch-studio/launch/record` prints a white page with each step, its status, who ticked it and when, the notes, and a signature line (the signer's name and date are typed on the last card).
- Ticks and notes are audited (`merch.launch_step_ticked`, `merch.launch_step_unticked`, `merch.launch_note_saved`). Items 2 … 4 (journey stepper, tab strips, order coaching) follow in M-3b and M-7.

**As built (D232 M-3b), items 2 and 3.**
- **Product journey** (`src/components/admin/merch-studio/JourneyBar.tsx`) sits above the tabs for everyone who can open the Studio. It shows the nine pills for the open design (the one last opened on Design, in this browser): Garment → Design (n ⛔) → Print files → Mockups (optional) → Sample approved → Price → Publish → On the shop → Stock synced, each ✓ done, ⬜ to do, ⛔ blocked or ○ optional. A tab pill opens its tab; On the shop opens Merch Health and Stock synced opens Merch Inventory. The **Next step** line names the first blocked or unfinished pill, e.g. *"Next step: Order a sample at Printful; when it arrives, tick the checklist on Proof & Export (2 of 6)."* After Publish it reads *"Live on greenwaymerch.com. Next: Copy Printful stock in Inventory → Merch Inventory."*
- **Where the facts come from:** the design, blockers, print files and sample ticks from this browser (the design is also on the server since M-4), and the **sample approval from the server** (`merch_designs`, it wins over the ticks); Publish, Hidden, photos, price and stock date from the merch catalog; On the shop from the **last saved** Merch Health run's H-7 (no live calls). Rules: `src/lib/merch-studio/merch-journey-core.ts` (pure, 14 self-tests).
- **Tab strips:** under the stepper, one line per tab: *"You are here: … Do this: … Then: … →"*, with the Then link opening the next tab. The first-visit "Show me around" tour is not built yet (it stays in G-78).

### B.6 Proposed build order (also in `06-FIX-PHASE-PLAN.md`, all PROPOSED)

| Slice | Contents | Gaps | Needs |
|---|---|---|---|
| **M-1** | Feed address fix in code + redirect self-test; stale copy; README and guide corrections | G-76, G-91 | — (owner sets `MERCH_CATALOG_URL` today) |
| **M-2** | Shop `/api/health` + Merch Health panel + daily cron + change emails | G-80, G-77 | M-1 **BUILT (D232)** |
| **M-3** | Setup & Launch coach, Product journey stepper, tab strips, Print form 8.1 | G-78 | M-2 |
| **M-4** | Server-saved designs + import; sample gate | G-79, G-81 | migration 0360 **BUILT (D232)** |
| **M-5** | Re-publish keeps Hidden; catalog version check; print-file cleanup | G-82, G-88, G-93 | — **BUILT (D232)** |
| **M-6** | Webhook button; automatic stock (cron, then `stock_updated`) | G-89, G-83 | M-2 **BUILT (D232)** |
| **M-7** | Held-card monitor; alerts inbox; cancel-and-refund guidance or action | G-84, G-85, G-86 | M-2 (+ owner answer Q-11-4) **BUILT (D232)** |
| **M-8** | Pricing guard; helpers, integration guides, concierge; placements | G-87, G-90, G-92 | — **BUILT (D232)** |

---

## Appendix C: Owner questions

> **Answered by the owner on 2026-11-11 (D232).** Verbatim: *"Q1: owner/admin. Q2: yes, owner only and reason. Q3: yes. Q4: guidance first, but build the button too please and all that goes with it. Q5: I have these set in vercel already I think, I can’t remember. Q6: yes. Q7: I agree with you. Build the auto confirm too and all that goes along with it so it’s ready. Q8: 35% is fine. Q9: yes."* And: *"I want to build all things, serious to not serious. The big to the small."* Each row's **Decision** column below records it.

| # | Question | Recommendation |
|---|---|---|
| **Q-11-1** | Who may press **Publish to greenwaymerch.com**? Today anyone with `content.edit`. | Owner/admin only, or a new `merch.publish` permission the owner grants **Decision (D232):** owner/admin, built in M-1 as `merch.publish`. |
| **Q-11-2** | Should the **sample gate** (G-81) be a hard block, or a warning the owner can override with a reason? | Hard block, with an owner-only override and a reason **Decision (D232):** hard block, owner-only override with a reason (M-4). |
| **Q-11-3** | May the shop's health endpoint reuse **Token A**, or should it have its own `MERCH_HEALTH_TOKEN`? | Its own token (one leak, one blast radius) **Decision (D232):** its own `MERCH_HEALTH_TOKEN` (M-2). |
| **Q-11-4** | Refunds: should the back office be able to **refund in Stripe** (through the shop endpoint), or only guide you to the Stripe dashboard? | Guided first (no money moves from the back office); a button later if wanted **Decision (D232):** guidance first, **and** build the refund button with everything it needs (M-7). **Built (M-7):** Stripe half on the order page, `merch.refund` (owner, admin), Token E. |
| **Q-11-5** | What flat shipping, extra-item and free-shipping amounts do you want (`MERCH_SHIP_*`, cents)? | Set from Printful's US rates for a tee; e.g. 599 / 200 / 7500, to be decided **Decision (D232):** the owner thinks they are set but is not sure. Merch Health (M-2) shows whether `MERCH_SHIP_FLAT_CENTS` is set and what it parses to. |
| **Q-11-6** | May we order one sample per **studio-default** garment to measure the 7 estimated placements? | Yes, the zip hoodie, windbreaker and hoodie fronts first **Decision (D232):** yes, order the samples (M-8). **Built (M-8):** the 8 placements say *awaiting sample measurement* and can be compared with Printful's print files; send the measured sizes to the developer. |
| **Q-11-7** | Will you ever want `MERCH_PRINTFUL_AUTO_CONFIRM`? | Not until 20+ clean orders; Merch Health shows it amber **Decision (D232):** agreed (leave it off until 20+ clean orders), **and** build the auto-confirm controls so they are ready (M-7). **Built (M-7):** the switch on Merch Health under H-19, locked until 20 clean orders. |
| **Q-11-8** | Minimum margin for the pricing warning (G-87)? | e.g. 35% after Printful, shipping gap and card fee **Decision (D232):** 35% (M-8). **Built (M-8):** `MIN_MARGIN_BPS = 3500`; Publish warns under 35% and when flat shipping is under Printful's rate; the suggestion includes the shipping gap. |
| **Q-11-9** | Is the Creative Studio (banners and ads for the cannabis site) next, as SOP-11 v2.0? | Yes, after M-1–M-3 **Decision (D232):** yes, the Creative Studio is next as SOP-11 v2.0, after the merch roadmap. |

## Appendix D: Revision history

| Version | Date | Change | By |
|---|---|---|---|
| 1.10 | 2026-11-12 | **D235 fix (F-11-19):** the merch project skipped every build since 2026-10-18, because its Ignored Build Step looked only at the last commit of a push (a docs-only "PR number" commit). It now compares with the last successful deploy (`merch-site/scripts/vercel-ignore.sh`). Merch Health tells "the shop has no /api/health" (redeploy) from "wrong token". The main project trims the token like the shop | Greenway Dev |
| 1.9 | 2026-11-11 | **M-8 built:** pricing guard (G-87): no hard-coded $35 (the last published price, or the suggestion); the suggestion covers 35% on every size after Printful, the card fee and the shipping gap; Printful's STANDARD rate to WA (`POST /shipping/rates`) and the shop's flat shipping (from the last Merch Health run) are read in Publish & Ads and Fulfillment & Pricing; Publish warns under 35% and when flat shipping is under Printful's rate. Help (G-90): helpers for Merch Inventory and Reports → Merch, Printful / Stripe (merch) / Resend (merch) guides on Admin → Integrations, a concierge **merch** topic for every §4 part and the §5 messages. Placements (G-92): **8** studio-default placements (not 7) marked *awaiting sample measurement*, with **Compare with Printful's print files**. §4.7, §4.11, §4.12, §4.13, §4.23 updated; F-11-13, F-11-14, F-11-17 resolved. No migration, no new variable | Greenway Dev |
| 1.8 | 2026-11-11 | **M-7 built:** held cards older than 3 days are named on Merch Health H-15 and emailed at day 3 and day 5 (G-84). Shop alerts are also stored in the back office (`merch_alerts`, migration 0361) and shown on Orders, Merch Health and the order page with Acknowledge (G-85). The order page shows the **Stripe half** with **Refund in Stripe** / **Release the card hold** (owner/admin, `merch.refund`, typed ref, idempotent, audited) through the shop's `/api/payments` and a new Token E `MERCH_PAYMENTS_TOKEN` (G-86). The auto-confirm switch (owner, reason, 20+ clean orders) sits under H-19 (Q-11-7). §4.3, §4.4, §4.19, §4.20, §4.21 updated; F-11-9, F-11-10, F-11-11 resolved. **Owner steps:** apply migration 0361; add `MERCH_PAYMENTS_TOKEN` (32+ characters, same value) to both projects; redeploy both | Greenway Dev |
| 1.7 | 2026-11-11 | **M-6 built:** Merch Health → H-5 has **Check what is registered** and **Register / repair the Printful webhook**: it reads Printful first, hides Token C, checks the shop accepts Token C before changing anything, then registers all 5 events (the 4 order events + `stock_updated`) with every catalog garment watched, keeping other types; audited (G-89). Stock is copied automatically every 6 hours (`/api/cron/merch-stock`) and within about a minute of Printful's `stock_updated` notice (shop → `/api/merch-stock`), audited as a system actor (G-83). H-5 now needs all 5 events and every garment watched. S-10, §4.15, §6.4, §6.5, form 8.4 updated; F-11-8, F-11-18 resolved. **Owner step:** add `PRINTFUL_WEBHOOK_TOKEN` (same value as the merch project) to the main project, redeploy both, press Register | Greenway Dev |
| 1.6 | 2026-11-11 | **M-4 built:** designs and their art are saved on the server (`merch_designs`, migration 0360; art in `merch-files`), any computer sees them, two computers can't overwrite each other (the loser keeps a copy), **Import design (.json/.zip)** (G-79); the sample approval is saved on the server with who, when, the checklist and a photo, **Publish is blocked** until the sample is approved for that exact print, and the owner-only override needs a typed reason and is audited (G-81, owner *"Q2: yes, owner only and reason."*). §3 step 4, §4.6, §4.9 item 5, §6.6 updated; F-11-2, F-11-6 resolved | Greenway Dev |
| 1.5 | 2026-11-11 | **M-5 built:** re-publish keeps Hidden and the stock copy, and says so (G-82); catalog writes are compare-and-set on `updated_at`, the loser is told *"Someone else changed the catalog - reload and try again."* (G-88); the previous print PNGs are deleted after a re-publish is saved (G-93). §4.12, §4.14, §6.7 updated; F-11-7, F-11-15, F-11-16 resolved | Greenway Dev |
| 1.4 | 2026-11-11 | **M-3b built:** Product journey stepper (nine pills, Next step line, links to tabs, Merch Health and Merch Inventory) and the per-tab "You are here / Do this / Then" strips (G-78 items 2 and 3; the "Show me around" tour remains) | Greenway Dev |
| 1.3 | 2026-11-11 | **M-3a built:** Setup & Launch coach `/admin/merch-studio/launch` (13 cards S-1 … S-12 + T, proven by Merch Health where it can, owner ticks for the rest, notes, progress, Next line), "Setup needs you" in the Studio header, printable form 8.1 at `/launch/record` (G-78 part; §4.2 points to it) | Greenway Dev |
| 1.2 | 2026-11-11 | **M-2 built:** Merch Health `/admin/merch-studio/health` (H-1 … H-19 live, with fix and SOP section; Run check now; token-expiry date; run history); shop `/api/health` behind its own `MERCH_HEALTH_TOKEN` (Token D, §4.3, both projects); the daily check rides the platform-health cron and emails only on a change of reds or a Monday digest (G-77, G-80 DONE; F-11-4, F-11-5 resolved) | Greenway Dev |
| 1.1 | 2026-11-11 | Owner answers Q-11-1 … Q-11-9 recorded (D232). **M-1 built:** the shop reads the www feed address, moves a bare host to www, never follows a redirect and remembers the last feed result for Merch Health; Publish is owner/admin (`merch.publish`); stale "Slice 5" and "drop it in merch-site/catalog/" copy removed; the README and finishing guide corrected (G-76, G-91 DONE) | Greenway Dev |
| 1.0 | 2026-11-11 | First version (recon and audit only, no code changed). Merch Studio and Merch Inventory first, as the owner asked (D231). It covers the setup walkthrough, every tab and order procedure, live probes, 18 findings (F-11-1 … F-11-18 + F-11-C), 18 gaps (G-76 … G-93) and the roadmap M-1 … M-8 | Greenway Dev |
