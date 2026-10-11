# Moving greenwaymarijuana.com to the new site (Vercel)

Plain-English, step by step. About 30 minutes of clicking, then up to a few
hours of waiting for the internet to catch up. Nothing here needs code: the
code is already ready (R40).

## What is true today (checked live on 2026-10-11, not guessed)

| Address | What it points at now | What you see |
| --- | --- | --- |
| `greenwaymarijuana.com` | A record `35.215.120.45` (Google Cloud, the old WordPress host) | The OLD WordPress site |
| `www.greenwaymarijuana.com` | CNAME `wp.wpenginepowered.com` (an old WP Engine account) | **Broken**: Cloudflare "error code: 1001". WP Engine no longer has your site, so the name points at nothing. |
| DNS is run by | **GoDaddy** (nameservers `ns57.domaincontrol.com`, `ns58.domaincontrol.com`) | You make every change below at GoDaddy. |

So www isn't broken because of the new site. It's broken because of a
leftover record from an old host, and the steps below replace it.

## The decision the code is built around

**`www.greenwaymarijuana.com` is the main address. `greenwaymarijuana.com`
forwards to it.** Both work for the public. Typing either one lands on www.

Why www and not the bare name:
1. Vercel recommends www as the primary domain.
2. The site's Google canonical tags, sitemap and robots file already say www.
3. Passkeys (Face ID / fingerprint login) and the login cookie belong to one
   exact address. If the site answered on both without forwarding, people
   would be logged out at random and passkeys would fail on one of the two.

The code has both halves of the forward. `next.config.ts` sends the bare name
to www with a permanent (308) redirect that keeps the page and any `?query`.
It also forwards the old WordPress pages: `/about-us/`→`/about`,
`/contact-us/`→`/locations`, `/partners/`→`/vendor-delivery`, `/insta/` and
`/facebook/`→your social accounts, `/home/`→`/`, `/wp-admin`→`/admin`.

## DO NOT TOUCH these records at GoDaddy (email depends on them)

| Name | Type | Value (starts with) | What breaks if deleted |
| --- | --- | --- | --- |
| `@` | MX | `aspmx.l.google.com` and the other Google ones | **Google Workspace** mail for all @greenwaymarijuana.com addresses |
| `resend._domainkey` | TXT | `p=MIGfMA0...` | Order, reminder and ACH emails sent by Resend start going to spam |
| `send` | MX | `feedback-smtp.us-east-1.amazonses.com` | Resend bounce handling |
| `send` | TXT | `v=spf1 include:amazonses.com ~all` | Resend sending |
| `_dmarc` | TXT | `v=DMARC1; p=none` | Email reputation reporting |
| `intake` | MX | `inbound-smtp.us-east-1.amazonaws.com` | Vendor invoices emailed to the intake address stop arriving |

## Step by step

### 1. In Vercel: add both addresses
1. Go to vercel.com, open the **greenway_website** project, then **Settings → Domains**.
2. Click **Add Domain** and type `greenwaymarijuana.com`. When Vercel offers to
   add `www.greenwaymarijuana.com` as well, choose the option that **redirects
   greenwaymarijuana.com to www.greenwaymarijuana.com**.
3. Make sure **www.greenwaymarijuana.com** shows as the one connected to
   Production, and **greenwaymarijuana.com** shows "Redirect to
   www.greenwaymarijuana.com (308)".
   **Never** choose it the other way around ("www redirects to the bare
   domain"). Together with the code's own redirect, that would loop forever.
4. Each domain card now shows an "Invalid Configuration" message with the exact
   record to add. **Copy the values from the cards.** Vercel gives each project
   its own values. For the bare domain it's usually an A record such as
   `76.76.21.21` or `216.198.79.1`. For www it's a CNAME ending in
   `vercel-dns-0xx.com`. Don't type a value from this document; use the card.
5. If a card says the domain is used by another Vercel account, it will show a
   TXT record named `_vercel`. Add it at GoDaddy first, then click **Verify**.

### 2. At GoDaddy: swap two records (and only two)
1. Log in to GoDaddy, go to **My Products → greenwaymarijuana.com → DNS**.
2. Find the **A** record named `@` with value `35.215.120.45`. **Edit** it and
   change the value to the A value from Vercel's card. (If there are several
   `@` A records, delete all but one. Also delete any **AAAA** record on `@`.)
3. Find the **CNAME** named `www` with value `wp.wpenginepowered.com`. **Edit**
   it and change the value to the CNAME from Vercel's www card.
4. If GoDaddy has a "Forwarding" rule set up for the domain, remove it. Vercel
   does the forwarding now.
5. Save. Leave every record in the "DO NOT TOUCH" table alone.

### 3. Wait, then check
Vercel's cards turn green, usually within minutes but sometimes after a few
hours. Vercel issues the SSL certificates for you. Then check from your phone
on cellular data (not store Wi-Fi):
- `https://www.greenwaymarijuana.com` shows the new site.
- `greenwaymarijuana.com` lands on `https://www.greenwaymarijuana.com`.
- `https://greenwaymarijuana.com/about-us/` lands on `/about`.

### 4. In Vercel: tell the app its new address
**Settings → Environment Variables → Production**: set
`NEXT_PUBLIC_SITE_URL` = `https://www.greenwaymarijuana.com`, then
**Deployments → ⋯ → Redeploy**. Emails, the Plaid webhook, printer and speaker
setup, and vendor e-sign links all build their links from this value. (If you
type the bare name by mistake, the code upgrades it to www anyway.)

### 5. In Supabase: allow logins from the new address
In the Supabase dashboard, open your project, then **Authentication → URL
Configuration**:
- **Site URL**: `https://www.greenwaymarijuana.com`
- **Redirect URLs**: add `https://www.greenwaymarijuana.com/**`. Keep the
  `vercel.app` entry until you've confirmed everything works.

Without this, password-reset and invite emails would send people back to the
old address.

### 6. Re-register passkeys
Passkeys are tied to the address where they were created, so a passkey made on
the `vercel.app` address won't work on www. Each person signs in once with
their password at `https://www.greenwaymarijuana.com/admin` and adds a new
passkey on their profile. The old ones can be removed.

### 7. Plaid, printers, speakers
- **Plaid**: the webhook address is rebuilt automatically from step 4, so
  there's nothing to change in the Plaid dashboard unless you typed an address
  there by hand. If you did, change it to
  `https://www.greenwaymarijuana.com/api/webhooks/plaid`.
- **Receipt printers and the order announcer Pi**: devices set up with the
  `vercel.app` address keep working, because that address stays alive. New
  devices should use `https://www.greenwaymarijuana.com` once step 3 is green.
  The old live domain answered speaker requests with a CAPTCHA page (that came
  from the old host, not from Vercel). Test one device on the new address and
  confirm it works before you move the rest.

### 8. After a week of everything working
- Cancel the old WordPress hosting (the server at `35.215.120.45`) and any
  WP Engine plan still on the card. **Download a backup first** if you want
  to keep the old blog posts.
- Optional email hardening (not required for the move): the bare domain has no
  SPF TXT record today. Google Workspace recommends
  `v=spf1 include:_spf.google.com ~all`. Ask whoever manages your Google
  Workspace before adding it, and add it as a separate TXT on `@`.

## If something goes wrong
- **"Too many redirects"**: Vercel is set to "www → bare". Flip it to
  "bare → www" (step 1.3).
- **Card stays red after 24 h**: GoDaddy still has an old `@` A/AAAA record or
  a Forwarding rule. Remove it (step 2).
- **Email stopped**: a "DO NOT TOUCH" record was changed. Put it back exactly
  as in the table.
- **Logins bounce back to the login page**: Supabase step 5 isn't done yet.
