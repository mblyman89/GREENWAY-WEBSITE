# Owner Task List — everything YOU need to do (as of Lens Pass 3)

> Written for the owner in plain English. Every claim below was verified
> against the repo at main commit `00ebb3dd` — nothing is guessed. Items
> marked ⏳ LATER are forward-looking (deployment/go-live) and are safe to
> defer; items marked ✅ NOW are worth doing as soon as convenient.
>
> Reminder of the big picture: the audit is still in "document, don't fix"
> mode. Nothing in this list is a code fix — these are the settings,
> dashboard clicks, and SQL runs that only YOU can do.

---

## 1. Migrations — the "which files changed after I ran them?" answer ✅ NOW

You said you ran every SQL file exactly once and want to re-run any that
were edited afterward. I checked the git history of **all 126 migration
files, one by one**. Here is the honest, verified answer:

**Only TWO migration files were truly edited after they were created:**

1. **`0038_registers_drawers.sql`** — edited by PR #238. The change: the
   seeded default drawer float for "Sales Register 1/2" was corrected from
   $200.00 to **$167.50** (16750 cents). **BUT: re-running this file on your
   database does NOTHING**, because its seed block only inserts when the
   `registers` table is empty (`where not exists … from public.registers`,
   line 186) — and yours isn't. **You don't need to worry either way**,
   because migration `0077_drawer_counts_extra_denoms.sql` (lines 44–46)
   explicitly corrects the float to 16750 on EXISTING rows. If you ran 0077,
   your registers are already right.
   → **Action: none required.** (Re-running is harmless if you want to.)

2. **`0061_seed_owner_hardware.sql`** — edited by PR #209 (July 1, 2026).
   The change: the seed was rewritten to a safer "insert only if this asset
   tag doesn't exist" style for the four hardware rows (LAMINATOR-01,
   PRN-LABEL-01, PRN-RECEIPT-01, SCAN-MEDICAL-01). The rows themselves are
   the same. If you ran this file AFTER July 1, 2026, you ran the current
   version already.
   → **Action: re-run `0061` once.** It is idempotent — it will insert any
   of the four hardware rows that are missing and skip ones that exist.
   Takes seconds, cannot hurt.

3. **`0097_reset_retention_guard.sql`** — this one LOOKED like it had two
   commits, but I dug in: that was a **file RENAME** (it used to be numbered
   0069). The content was created once and never edited. → **Action: none.**

**Everything else:** created once, never touched. No other re-runs needed.

Also: `docs/MIGRATIONS_TO_RUN.md` is your standing checklist of migrations
from 0054 onward with a description of what breaks until each is run. If
you haven't checked off through **0127** (the current last file — 0127 is the
GW-018 fix: auto-created staff profiles are born inactive), do that
sweep — in particular **0123 (pin_throttle)** matters for security (GW-005)
and **0120–0122** are the POS foundation the registers depend on.

---

## 2. Supabase dashboard settings ✅ NOW

> **☑️ QUICK CHECKLIST — the GW-017/GW-018 auth items (added at the owner's
> request so they don't get forgotten). Tick these off as you do them:**
>
> - [ ] **Site URL** = your real production URL (Authentication → URL
>   Configuration), e.g. `https://greenwaymarijuana.com` — not localhost.
> - [ ] **Redirect URLs** include `https://<your-domain>/auth/callback`
>   (login magic links).
> - [ ] **Redirect URLs** include
>   `https://<your-domain>/admin/account/set-password` (staff invite
>   emails land here — required by the GW-017 fix, PR #632).
> - [ ] **"Allow new users to sign up" is OFF** (Authentication → Sign In /
>   Providers) — the dashboard half of GW-018.
> - [ ] **Send yourself a test invite** from Admin → Users to a personal
>   email and walk it through: click link → set password → land in admin
>   (this is TEST-PLAN T-012).
> - [ ] **Run migration `0127_staff_profiles_inactive_by_default.sql`** in
>   the Supabase SQL editor (GW-018 database half — auto-created staff
>   profiles are born inactive; idempotent, safe to re-run). Then run the
>   read-only review query at the bottom of that file once and confirm every
>   ACTIVE profile is someone you actually invited.

Do these in your Supabase project dashboard (they cannot be set from code):

1. **Authentication → URL Configuration → Site URL:** set to your real
   production URL (e.g. `https://greenwaymarijuana.com`). Note: the older
   `docs/BACK_OFFICE_SETUP.md` says to point things at `/admin` — that
   guidance is outdated; the app's real landing pad for email links is
   `/auth/callback` (see next item).
2. **Authentication → URL Configuration → Redirect URLs:** add BOTH
   `https://<your-domain>/auth/callback` (login magic links) and
   `https://<your-domain>/admin/account/set-password` (staff invite emails —
   the GW-017 fix points invites there). Add your Vercel preview domain
   versions too if you test from previews.
3. **Authentication → Sign In / Up → disable public sign-ups** (finding
   GW-018: until the code fix lands, the login page's magic-link form can
   create brand-new active read-only staff accounts for ANY email; turning
   off sign-ups in the dashboard closes that today).
4. **Authentication → Email:** production email needs real SMTP (Supabase's
   built-in sender is rate-limited to a few emails/hour). Easiest: use your
   Resend account's SMTP credentials here so invite/magic-link emails
   actually deliver.
5. **Database → Backups:** confirm scheduled backups are on; strongly
   consider **PITR (point-in-time recovery)** on your paid plan. There is
   currently NO documented restore runbook (flagged in the audit) — knowing
   backups exist is your safety net.
6. **Settings → API:** copy the Project URL, anon key, and service-role key
   into Vercel (next section). The service-role key is server-only secret —
   never paste it anywhere public.

Staff onboarding: GW-017 is FIXED (PR #632) — invite the person from
`/admin/users`; the email lands them on a set-password page and then in the
back office. This needs items 1–2 above done first (Site URL + BOTH redirect
URLs). Until GW-018's code fix lands, keep public sign-ups disabled (item 3).

---

## 3. Vercel settings (environment variables) ✅ NOW / at deploy

Set these in Vercel → your project → Settings → Environment Variables.
This is the complete list the code actually reads (verified by grep), in
priority order. `.env.example` in the repo documents most of these inline.

**Required for the app to function:**
| Variable | What it is |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon (public) key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key (SECRET) |
| `ADMIN_BOOTSTRAP_EMAILS` | your email — auto-promoted to owner on first login |
| `NEXT_PUBLIC_SITE_URL` | your public https:// URL — the receipt printer's Poll URL and reminder-email links are built from it |

**Security / secrets:**
| Variable | What it is |
|---|---|
| `DATA_ENCRYPTION_KEY` | any long random string (32+ chars). Encrypts employee bank numbers, ACH details, integration API secrets at rest. Back it up like a database password — losing it makes encrypted values unreadable |
| `CRON_SECRET` | any long random string. Vercel Cron sends it as a bearer token to the daily compliance-reminders job; unset = the job refuses to run in production |

**Email (Resend):**
| Variable | What it is |
|---|---|
| `RESEND_API_KEY` | your Resend API key |
| `ORDER_EMAIL_FROM` | verified from-address for order emails |
| `ORDER_STAFF_EMAILS` | comma-separated staff addresses alerted on every pickup order |
| `LOYALTY_FROM_EMAIL` | from-address for loyalty sign-up confirmations |
| `RESEND_WEBHOOK_SECRET` | signing secret from the Resend webhook you create (§4) |
| `RESEND_INBOUND_SECRET` | signing secret for the vendor-intake inbound mailbox (falls back to RESEND_WEBHOOK_SECRET) |
| `INBOUND_EMAIL_PROVIDER` | `resend` (default) |
| `VENDOR_INTAKE_MAILBOX` | `vendor_intake` (default) |
| (optional alternates) | `SENDGRID_API_KEY`, `SENDGRID_WEBHOOK_PUBLIC_KEY`, `SENDGRID_INBOUND_TOKEN`, `NEWSLETTER_FROM_EMAIL`, `LOYALTY_SIGNUP_FROM_EMAIL`, `LOYALTY_SIGNUP_TO_EMAIL` |

**Push notifications (compliance reminders):**
| Variable | What it is |
|---|---|
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | generate ONCE with `npx web-push generate-vapid-keys` |
| `VAPID_SUBJECT` | `mailto:you@greenwaymarijuana.com` (optional) |

**Crawler worker (§5):**
| Variable | What it is |
|---|---|
| `CRAWLER_BASE_URL` | e.g. `https://crawler.your-host.com` (no trailing slash) |
| `CRAWLER_SHARED_SECRET` | must EXACTLY match the worker's own secret |

**AI (optional — features hide when unset):**
`OPENAI_API_KEY` (or `AI_API_KEY`), and optional overrides `AI_MODEL`,
`AI_MODEL_HEAVY`, `AI_VISION_MODEL`, `AI_BASE_URL`, `AI_MODE` (OPENAI_*
equivalents also work). Image generation: `BFL_API_KEY`/`FLUX_API_KEY` +
`BFL_BASE_URL`/`FLUX_BASE_URL`/`FLUX_ENDPOINT`.

**Menu syndication (⏳ LATER, when Leafly/Weedmaps approve you — §7):**
`LEAFLY_CLIENT_ID`, `LEAFLY_CLIENT_SECRET`, `LEAFLY_MENU_INTEGRATION_KEY`,
`LEAFLY_ENVIRONMENT` (`sandbox` unless set to `production` — safe default),
`LEAFLY_API_BASE_URL`, `LEAFLY_API_KEY`; `WEEDMAPS_CLIENT_ID`,
`WEEDMAPS_CLIENT_SECRET`, `WEEDMAPS_ACCESS_TOKEN`, `WEEDMAPS_WM_ID`,
`WEEDMAPS_MENU_ID`, `WEEDMAPS_SCOPE`, `WEEDMAPS_TOKEN_URL`,
`WEEDMAPS_ENVIRONMENT` (`sandbox` default). Note: these can ALSO be stored
in the back office under Integrations — a saved credential row in the
database wins over the env var, so pick one home for them.

**Analytics (optional):** `NEXT_PUBLIC_GA_ID` — unset means GA is fully off.

**Also in Vercel:** confirm the Cron Job (`/api/cron/compliance-reminders`,
daily 16:00 UTC = 8/9am Pacific) shows in the Crons tab after deploy — it
is declared in `vercel.json` and needs `CRON_SECRET` set to work.

---

## 4. Resend settings ✅ NOW

In resend.com:
1. **Verify your sending domain** (DNS records) so `ORDER_EMAIL_FROM` and
   the loyalty/newsletter senders aren't rejected.
2. **Create a webhook** pointing at `https://<your-domain>/api/webhooks/resend`
   for engagement events (delivered/opened/bounced…) and paste its signing
   secret (starts with `whsec_`) into `RESEND_WEBHOOK_SECRET`. In production
   the endpoint refuses traffic without it (fail-closed by design).
3. **Inbound mail (vendor intake):** if you use the vendor_intake@ mailbox
   feature, set up Resend Inbound to forward to
   `https://<your-domain>/api/webhooks/inbound-email` and put its signing
   secret in `RESEND_INBOUND_SECRET`.
4. Consider using Resend's SMTP credentials as Supabase's SMTP sender (§2.4)
   so ALL auth email flows through one provider you can monitor.

---

## 5. Crawler worker settings ⏳ LATER (before you want "Research" buttons live)

The crawler is a separate Python service in `/crawler`. Its own docs are
good — start with `crawler/docs/WHERE_TO_RUN.md`, whose recommendation for
you is: **run it on your shop's VM host, exposed through a free Cloudflare
Tunnel** (no ports opened, no public IP). `IT_DEPLOYMENT_GUIDE.md` and
`RUNBOOK.md` walk through it step-by-step; there's a systemd service file
included.

The two ends must agree: set `CRAWLER_SHARED_SECRET` (a long random string)
in the worker's `.env` AND the identical value in Vercel, plus
`CRAWLER_BASE_URL` in Vercel pointing at the tunnel URL. When unset, the
crawler buttons simply hide — nothing else breaks.

---

## 6. Receipt printer (Star CloudPRNT) ⏳ at store setup

1. Set `NEXT_PUBLIC_SITE_URL` first — without it the printer settings page
   cannot show a full Poll URL (the printer can't use a relative address;
   the app's own diagnostics tell you this too).
2. In Admin → Equipment → Receipt printer: set a **poll token** (any long
   random string). In production the CloudPRNT endpoint refuses printers
   without it.
3. In the printer's own CloudPRNT config, enter the full Poll URL
   (`https://<your-domain>/api/cloudprnt`) with the token, per the
   equipment page's built-in instructions.

---

## 7. Deployment roadmap — where everything lives and how we test it ⏳ LATER

You asked for the strategy now, execution later. Here it is, with my
professional recommendation for each piece.

### Where the system lives
Three homes, all already reflected in the code and docs:
- **The web app (public site + back office + POS sync API): Vercel.**
  It's already built for it (vercel.json cron, serverless-safe patterns).
- **The database + auth: Supabase** (managed Postgres). Turn on PITR.
- **The crawler: your shop VM** behind a Cloudflare Tunnel (§5). It's the
  only piece that can't live on Vercel (long-running Python + a real
  browser).
No servers for you to patch beyond the one VM you already run.

### How the iPad app gets in the store
**Phase 1 (opening day): PWA.** Safari on the iPad → your site → `/pos` →
"Add to Home Screen." Full-screen, offline queue works (it's localStorage-
based). Put each iPad in **iOS Guided Access / single-app mode** — that's
also the operational mitigation for the device-key finding (GW-006).
Known Phase-1 limits (already in the findings): no offline PIN unlock
(GW-007) and localStorage fragility (GW-001).
**Phase 2: Capacitor app.** Wrap the same code in a native shell for the
App Store or Apple Business Manager distribution; that unlocks the iOS
Keychain for the device key and the offline PIN cache the UI already
promises. This is on the fix roadmap, not a blocker for opening.

### How to test uploading to CCRS
Key verified fact: **CCRS has NO API and no sandbox — it's CSV files
uploaded by a human in the portal** (details in
`docs/CCRS_SELF_REPORTING_GUIDE.md`). So the test IS the real workflow,
done small:
1. Ring a handful of real (or one-cent test-day) sales.
2. Back office → generate the CCRS Sale CSV for that date range. The
   export hard-gate blocks malformed files before you can download.
3. Log into CCRS with your SAW account, upload the file with a clear name.
4. Check the **Processing Status (PST)** for that filename; if rows
   reject, fix and re-upload. That round-trip — export → upload → PST
   clean — is a complete, valid test.
⚠️ One thing MUST land before your first real upload: **GW-010 (the
critical tax-math finding)** — the export currently overstates tax on
cannabis lines. It is top of the fix queue for exactly this reason.

### How to test pushing to Leafly and Weedmaps
Both integrations default to **sandbox** (verified in code:
`api-sandbox.leafly.io`, and `WEEDMAPS_ENVIRONMENT` defaults to sandbox) —
you cannot accidentally push to a live menu.
1. Apply for API credentials with each (Leafly menu-integration key;
   Weedmaps OAuth client for your WM listing).
2. Put the sandbox credentials in (env or the Integrations page — one
   home, not both, since the database row wins).
3. Run a **preview/dry-run** from the back office — the sync engine builds
   the exact payload and logs it without sending.
4. Push to **sandbox**, check each platform's sandbox dashboard.
5. Only then flip `*_ENVIRONMENT=production` and do a small live push.
The clients already retry rate limits with backoff and log every attempt
with payload + response, so each test leaves an audit trail you can read.

### Backup/restore (fold into go-live)
Enable Supabase PITR, then do ONE practice restore to a scratch project so
the steps are written down before you need them. A CUTOVER-CHECKLIST.md
(coming after the last lens pass) will make this a checkbox.

---

## 8. What's left in the audit after this pass

1. **Lens Pass 4 — code quality, UX & operability** (final lens, lighter).
2. **TEST-PLAN.md** — your hands-on pre-opening test script.
3. **CUTOVER-CHECKLIST.md** — the ordered go-live checklist (this document
   is its first draft input).
4. **Then fixes begin**, most severe first: GW-010 (compliance tax math),
   then the moderates (invites GW-017, signup hole GW-018, sync stranding
   GW-023, order notifications GW-024, races GW-011/012, …), then lows,
   hardening, and enhancements — one small reviewed PR per fix, same
   verification discipline as every slice so far.
