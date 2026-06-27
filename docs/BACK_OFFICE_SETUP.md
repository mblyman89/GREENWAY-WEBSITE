# Greenway Back Office — Supabase Setup (Slice 1)

This guide connects the back office to Supabase. ~10 minutes, one-time.

## 1. Create the Supabase project
1. Go to **supabase.com** → New project (free tier is fine to start).
2. Pick a strong database password and a region close to you (US West).

## 2. Run the database migration
1. In Supabase, open **SQL Editor → New query**.
2. Paste the entire contents of `supabase/migrations/0001_slice1_foundation.sql`.
3. Click **Run**. This creates the staff/roles, audit log, media, and settings
   tables, the security policies (RLS), the auto-profile trigger, and the
   private `media` storage bucket.
4. Open **SQL Editor → New query** again, paste the entire contents of
   `supabase/migrations/0002_slice2_pos_import.sql`, and click **Run**. This adds
   the POS import + menu-version tables (`pos_imports`, `pos_import_diagnostics`,
   `menu_versions`, `menu_items`, `menu_variants`), their RLS policies, the
   private `pos-raw` upload bucket, and the atomic `publish_menu_version()`
   function that powers the Menu Imports screen.

> Run migrations in numeric order (0001 before 0002). Each is safe to re-run.

## 3. Get your keys
In Supabase: **Settings → API**. Copy:
- **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
- **anon public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- **service_role** key → `SUPABASE_SERVICE_ROLE_KEY` (⚠️ server-only secret)

## 4. Configure email auth
In Supabase: **Authentication → Providers → Email** — make sure Email is
enabled. For invites/magic links to send, confirm the built-in email is on (or
later connect a custom SMTP / Resend sender).

Add your admin URL to **Authentication → URL Configuration → Redirect URLs**:
`https://<your-domain>/admin` (and `http://localhost:3000/admin` for local dev).

## 5. Set environment variables
Locally, copy `.env.example` → `.env.local` and fill in the four Supabase
values plus:

```
ADMIN_BOOTSTRAP_EMAILS=you@greenwaymarijuana.com
```

On **Vercel**: Project → Settings → Environment Variables — add the same five.
Then redeploy.

## 6. First login (become the Owner)
1. Visit `/admin/login`.
2. Use **"Email me a sign-in link"** with your bootstrap email.
3. Click the link → you land in the dashboard as **Owner** automatically
   (because your email is in `ADMIN_BOOTSTRAP_EMAILS`).

## 7. Invite your team
Go to **/admin/users → Invite a staff member**, enter their email, pick a role,
and send. They receive an email invite to set a password.

---

### Roles at a glance
| Role | What they can do |
|---|---|
| **Owner** | Everything + user management + settings + publish approvals |
| **Admin** | Everything + user management + settings |
| **Manager** | Menu imports, promotions, orders, content, vendors, reports |
| **Content Editor** | Blog, banners, page text, media, vendors, product enrichment |
| **Budtender / Staff** | Orders dashboard, loyalty review, limited reporting |
| **Read-only / Analyst** | Reports + exports only |

### Security notes
- All `/admin` routes are `noindex` and require an active staff account.
- Every write action is recorded in the **Audit Log** (`/admin/audit`).
- The last active Owner cannot be demoted or deactivated (lockout protection).
- The `service_role` key must never be exposed to the browser — it is only used
  in server code.
- Row-Level Security is enforced at the database level, not just in the app.
