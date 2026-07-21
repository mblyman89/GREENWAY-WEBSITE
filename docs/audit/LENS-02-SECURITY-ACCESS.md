# Lens Pass 2 — Security & Access

**Scope:** authentication (login, invites, passkeys, magic links), session
handling, role/permission enforcement (server actions, admin pages, API
routes, middleware), Row-Level Security across every table in every
migration, device/PIN security, webhook & cron authentication, injection
surfaces (PostgREST filters, XSS), secrets handling, and sensitive-data
protection (banking, medical, PII).

**Basis:** every claim below was verified by reading the code at main commit
`184f6fca` (branch `lens-02-security-access`). File:line anchors are as-of
that commit. Standing rule: NEVER GUESS — nothing here is inferred. Claims
that can only be confirmed in the Supabase dashboard (not in the repo) are
marked **UNVERIFIED** and turned into owner action items in §5.

**Fix policy (owner's direction):** ALL fixes are deferred until the full
audit finishes; this pass only documents. New findings are logged in
`FINDINGS.md` as GW-017…GW-022 and ordered below from most severe to least,
ending with the verified-GOOD list and the owner's onboarding guide.

---

## 1. The owner's question first: why "add a new user" fails

**Plain English:** When you invite someone from `/admin/users`, the system
does two things right — it creates their account and emails them a link. But
the link is broken in two independent ways, and it will NOT fix itself when
we deploy. This is **GW-017** (Moderate, but top of the fix queue because it
blocks onboarding).

**Break #1 — the link lands on the wrong page.** The code that sends the
invite (`src/app/admin/users/actions.ts:203`) never tells Supabase where the
link should go. So the email link goes to whatever "Site URL" is configured
in your Supabase dashboard — usually the homepage — instead of the one page
in the app that knows how to turn an email link into a real signed-in
session (`src/app/auth/callback/route.ts`). Worse, invite links use an older
link format (the Supabase SDK itself documents that the modern "PKCE" format
is not supported for invites — `GoTrueAdminApi.d.ts:78`), and the app's
browser client only speaks the modern format
(`createBrowserClient.js:40`), so when the two meet on the wrong page the
sign-in silently fails. That is exactly what you and your invitees
experienced.

**Break #2 — there is nowhere to set a password.** The invite screen
promises "they get an email to set a password"
(`src/app/admin/users/page.tsx:89`), but the app contains **no
set-password page at all** — verified by searching the whole codebase for
`auth.updateUser` (zero matches). Even a perfectly-delivered invite link
would sign the person in once and then leave them with no password for next
time.

**How you "got around it" yourself:** the invite DID create your account, so
when you later used the login page's **"email me a sign-in link"** option,
that email goes through the working `/auth/callback` route
(`LoginForm.tsx:71`) and signs you in. That is the interim workaround for
your team too — see §5.

**Is it code or Supabase config?** Both. The code must (a) point invite
emails at `/auth/callback` and (b) grow a set-password page. And your
Supabase dashboard must have the production domain as the Site URL with
`/auth/callback` on the redirect allowlist — that part can't be verified or
fixed from the repo (UNVERIFIED; owner action in §5).

---

## 2. Moderate findings (all logged in FINDINGS.md)

### GW-017 — Invites broken (no `redirectTo`, no set-password page)
Covered in §1. Fix is one small slice: pass
`redirectTo` to `inviteUserByEmail`, build a set-password page, correct the
UI copy, plus the dashboard settings in §5.

### GW-018 — The public login page can CREATE staff accounts
The "email me a sign-in link" form (`LoginForm.tsx:66–73`) never says
`shouldCreateUser: false`, and Supabase's default for that call is to create
an account for any unknown email. A database trigger then auto-creates a
staff profile for every new auth user
(`0001_slice1_foundation.sql:147–159`) — born **active** with the
**readonly** role (`0001:26–27`), which can see the dashboard and reports
(`roles.ts:70,91`). Unless "allow new users to sign up" is switched OFF in
the Supabase dashboard (**UNVERIFIED** from the repo — owner must check,
§5), a stranger can mint themselves a working reports login. Fix: add
`shouldCreateUser: false`, make auto-created profiles start inactive, and
confirm the dashboard toggle.

### GW-019 — Four tables have no Row-Level Security at all
Scripted sweep of every migration: 159 tables created, 155 protected, and
exactly four not: `kb_product_categories` (0070), `noncannabis_products` and
`noncannabis_sku_sequences` (0076), `noncannabis_adjustments` (0111). In
Supabase, a table without RLS is readable and writable by anyone holding the
public browser key. These hold glassware pricing including wholesale
**cost** (`0076:43`) and inventory adjustments. One migration copying the
neighboring staff-only policy pattern (`0040:134–138`) closes it.

### GW-020 — Any active staff login can read/write the `employees` table
The RLS policy (`0037_staffing_timeclock.sql:144–149`) lets EVERY active
staff account — including readonly — select and update employee rows:
pay-related fields, scrypt-hashed clock PINs, and the bank-account columns
added for payroll (`0057:28–31`). The admin UI never offers this (staffing
is manager-and-up, `roles.ts:94`) but the policy allows going around the UI.
Softeners verified: PINs are hashed, bank numbers are AES-256-GCM encrypted
when `DATA_ENCRYPTION_KEY` is set — but that encryption is opt-in
(`at-rest-crypto.ts:16`). Fix: tighten the policy to manager-and-up (or
admin-only writes, like payroll `0057:130–136`), and add
"confirm `DATA_ENCRYPTION_KEY` set in production" to the Cutover Checklist.

---

## 3. Low + Hardening

- **GW-021 (Low):** two admin search boxes (equipment
  `equipment/store.ts:138–139`, loyalty signups
  `signups-store.ts:166–175`) paste the raw search text into a PostgREST
  filter string without escaping — not SQL injection, just wrong results or
  an error if someone searches text containing `%` or a comma. Three other
  search sites already escape correctly; reuse their helper.
- **GW-022 (Hardening):** the receipt printer's poll token is checked with a
  plain `===` (`api/cloudprnt/route.ts:75`) instead of the constant-time
  compare used everywhere else. Theoretical timing leak; one-line fix.

---

## 4. Verified GOOD — what this lens checked hard and found sound

- **Admin permission walls are essentially complete.** A scripted sweep of
  all 65 admin server-action files and all 143 admin pages found every
  exported action and page guarded by `requirePermission`/`requireStaff`,
  with two benign exceptions: `content/carousel/page.tsx` (a pure redirect)
  and `pendingProductLinks` (`media/actions.ts:783`), a read-only helper
  only invoked from a page that already guards
  (`media/[id]/page.tsx:45`).
- **All 36 API routes have a deliberate auth posture.** POS routes require
  device-key auth (scrypt-verified against `pos_devices.provision_hash`,
  `sync-store.ts:125`); webhooks verify signatures and **fail closed with
  503 in production when their secret is unset** (inbound-email, Resend,
  SendGrid); the cron route requires a `CRON_SECRET` bearer and also fails
  closed. The intentionally-public routes are defensible: the order-status
  page uses an unguessable per-order UUID token (`0007:71`), the loyalty
  signup form has a honeypot field (`signup.ts:65`), website orders are
  fully re-priced server-side, and the passkey endpoints never reveal
  whether an account exists.
- **Passkey (WebAuthn) login is done right:** the challenge is single-use,
  the credential must belong to the account resolved from the typed email
  (`webauthn/authenticate/verify/route.ts:56`), and biometric/PIN user
  verification is required (`:72`).
- **PINs and device keys:** salted scrypt with `timingSafeEqual`
  (`pin-hash.ts`), legacy plaintext PINs upgraded on first successful use,
  durable DB-backed throttle (migration 0123; fallback caveat already logged
  as GW-005).
- **Secrets hygiene:** the service-role client is `import "server-only"`
  (`supabase/admin.ts:4`) so it physically cannot be bundled into browser
  code; no service-role key or other secret value appears in any client
  component; banking and integration credentials support AES-256-GCM
  envelope encryption at rest.
- **Session & deactivation:** middleware refreshes sessions on `/admin/*`
  and every page re-checks permissions server-side; deactivating a user also
  applies an auth-layer ban (`users/actions.ts:148–150`), so their session
  and raw API access die immediately — matching the promise in the UI copy.
- **Injection/XSS:** anonymous order-INSERT policies were removed in
  migration 0096 (orders go through the server only); staff-entered HTML is
  run through a strict allowlist sanitizer that strips `javascript:`/`data:`
  URLs (`html-sanitize.ts:60`); JSON-LD is emitted via `JSON.stringify`;
  loyalty public inserts are constrained to `status='new'` (`0008:92–93`).

---

## 5. Owner's guide: giving employees & helpers access (plain English)

**Right now (workaround, until GW-017/018 are fixed):**

1. Go to **`/admin/users`**, type the person's email, pick a role, and hit
   **Send invite**. Roles: *staff* for budtenders (no reports, no settings),
   *manager* for shift leads (inventory, staffing, reports), *admin* only
   for someone you'd trust with user management, *readonly* for an
   accountant/advisor who should only look. You can only grant roles at or
   below your own, and the last owner can never be locked out.
2. Tell them to **ignore the invite email's link** (that's the broken part).
3. Have them go to **`greenwaymarijuana.com/admin/login`** (or the current
   Vercel URL), click **"email me a sign-in link"**, enter the same email,
   and click the link in THAT email. They'll land signed in on the
   dashboard. They repeat this each time they sign in — passwords can't be
   set until the GW-017 fix ships. (They can also add a Face ID/Touch ID
   passkey from their account page after the first sign-in, which makes
   future logins one tap.)
4. When someone leaves: `/admin/users` → **Deactivate**. That kills their
   access instantly (verified — it bans the account at the auth layer too).

**Three things only YOU can check, in the Supabase dashboard (the code
can't see these settings, so they are UNVERIFIED in this audit):**

1. **Authentication → URL Configuration:** set **Site URL** to your real
   production domain, and add
   `https://<your-domain>/auth/callback` to the **Redirect URLs** list.
   (Also keep the Vercel preview URL there while we're testing.)
2. **Authentication → Sign In / Providers:** make sure **"Allow new users
   to sign up" is OFF**. This is the dashboard half of GW-018 — with it on,
   strangers can create themselves a login.
3. **Authentication → Email Templates:** glance at the *Invite user*
   template — after the GW-017 fix ships we'll confirm its link points
   through `/auth/callback`.

**After the fixes ship** (GW-017 + GW-018, one small slice): the invite
email will land the person directly on a "choose your password" page, and
the login page will stop creating accounts for unknown emails. Then the
onboarding story becomes: invite → click email → set password → done.

---

## 6. Recommended fix order for this lens (when fixes begin)

1. **GW-017 + GW-018 together** (one auth-onboarding slice): `redirectTo`
   on invites, set-password page, `shouldCreateUser: false`, trigger default
   `active=false`, honest UI copy. Unblocks the owner's onboarding.
2. **GW-019** (one migration): enable RLS + staff policies on the four bare
   tables.
3. **GW-020** (one migration): tighten `employees` RLS to manager-and-up;
   add `DATA_ENCRYPTION_KEY` to the Cutover Checklist.
4. **GW-021 + GW-022** (one tiny hardening slice): shared `escapeLike`,
   constant-time CloudPRNT compare.
