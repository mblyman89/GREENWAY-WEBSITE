# Social Setup — Instagram Business Discovery (the sanctioned, clean way)

This is the **legitimate** way to read your vendors' **public** Instagram content:
you authenticate as **Greenway** (your own accounts) and use Meta's official
**Instagram Business Discovery** API to read another business/creator account's
**public** profile + posts. No fake accounts. No logging in as the vendor. No
password ever leaves your hands — you generate **access tokens**, and those go
into the crawler's `.env` on your server only.

> Everything the connector returns is still a **draft**: it's verified against
> the source and run through the WA I‑502 compliance gate, and an employee must
> Accept it before anything reaches the public site.

---

## What you'll end up with
Two values in the crawler's `.env`:

```
META_GRAPH_TOKEN=EAAG...        # a long-lived Page access token (NOT a password)
META_IG_BUSINESS_ID=178414...   # your Greenway IG business account's numeric id
```

When those are set, the **📸 Pull from Instagram** buttons light up on every
vendor and brand in the back office.

---

## One-time setup (~30 minutes, all free)

### 1. Make sure you have the accounts (you said you do)
- A **Facebook Page** for Greenway (not just a personal profile).
- An **Instagram Business** (or Creator) account for Greenway.
- **Link them:** on the Facebook Page → *Settings → Linked accounts → Instagram*
  → connect your Greenway IG account. (Or in the IG app: *Settings → Account type
  and tools → switch to Business → connect the Greenway Facebook Page*.)

> The link is what makes Business Discovery work. You only need **your** accounts
> linked — you do **not** touch the vendors' accounts at all.

### 2. Create a Meta developer app
1. Go to **developers.facebook.com → My Apps → Create App**.
2. Choose **"Business"** as the type. Name it e.g. *Greenway Internal Tools*.
3. In the app dashboard, **add the "Instagram Graph API"** product (and
   "Facebook Login" if prompted — used only to mint your own token).

### 3. Get a token tied to your Page + IG business account
The quickest path for an internal tool:
1. Open the **Graph API Explorer** (developers.facebook.com/tools/explorer).
2. Select your app, then **"Get User Access Token"** and grant these permissions:
   `instagram_basic`, `pages_show_list`, `pages_read_engagement`,
   `business_management`.
3. Call `GET /me/accounts` — copy your Greenway **Page**'s `access_token` and `id`.
4. Exchange the short-lived token for a **long-lived** one (lasts ~60 days, and a
   Page token derived from a long-lived user token effectively doesn't expire):
   `GET /oauth/access_token?grant_type=fb_exchange_token&client_id=APP_ID&client_secret=APP_SECRET&fb_exchange_token=SHORT_TOKEN`
5. Find your **IG business account id**:
   `GET /{PAGE_ID}?fields=instagram_business_account` → copy the returned id.

Put the long-lived Page token in `META_GRAPH_TOKEN` and the IG id in
`META_IG_BUSINESS_ID`.

### 4. (Optional) App Review
For internal use against your own token you generally don't need full App Review
to call Business Discovery. If Meta prompts you to submit the app for advanced
access later, the permissions above are the ones to request. Keep the app in the
same Business Manager as your Page.

---

## Test it
With the worker running (see `RUNBOOK.md`):

```bash
curl -s localhost:8200/health | jq .social_configured   # should be true

curl -s -X POST localhost:8200/research-social \
  -H "X-Crawler-Secret: $CRAWLER_SHARED_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"handle":"some_public_brand","entity_type":"brand","entity_id":"<uuid>","write":false}' | jq .
```

`write:false` is a dry run (nothing saved). Drop it (or set true) to write drafts
into the review queue.

---

## What it can and can't see (be realistic)
- ✅ **Public** business/creator accounts: bio, website, follower count, recent
  posts' captions + image URLs + permalinks.
- ❌ **Private** accounts, personal (non-business) accounts, Stories, DMs — not
  available, by design. That's the line we don't cross.
- If a vendor isn't a discoverable business account, the connector returns a
  clear "not a discoverable business/creator account" message, and you can fall
  back to their **link-in-bio / Linktree / linked store** (the normal 🔎 crawler
  reads those directly) or their public website.

---

## Token hygiene
- The token is a **secret** — it lives only in the worker's `.env` (gitignored)
  or your host's secret store. Never commit it; never paste it in chat.
- Rotate it if it ever leaks (regenerate in the Graph API Explorer / app
  dashboard). The worker reads it from the environment, so rotating = update the
  env var + restart.
