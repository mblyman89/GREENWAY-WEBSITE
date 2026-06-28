# Email setup (Resend) — owner reference

Greenway sends transactional email (loyalty signup alerts, order/reservation
notifications, staff invites) through **Resend** (https://resend.com). No SMTP
server to run — the app calls the Resend REST API. Everything is env-gated: if a
variable is unset, that email is simply skipped and the underlying action still
succeeds (e.g. an order still saves even if the email can't send).

## Environment variables

Set these in **Vercel → Project → Settings → Environment Variables** (and in
`.env.local` for local dev — never commit real keys).

| Variable | Purpose | Suggested value |
| --- | --- | --- |
| `RESEND_API_KEY` | Auth key for all sending | (from Resend dashboard) |
| `LOYALTY_SIGNUP_FROM_EMAIL` | "From" on loyalty signup notifications | `Greenway Loyalty <loyalty@greenwaymarijuana.com>` |
| `LOYALTY_SIGNUP_TO_EMAIL` | Inbox that receives loyalty alerts | `loyalty@greenwaymarijuana.com` |
| `ORDER_EMAIL_FROM` | "From" on order/reservation emails | `Greenway Orders <orders@greenwaymarijuana.com>` |
| `ORDER_STAFF_EMAILS` | Comma-separated staff who get order alerts | `orders@greenwaymarijuana.com,michael@greenwaymarijuana.com` |

If a `*_FROM` var is unset, the app falls back to Resend's sandbox sender
(`onboarding@resend.dev`), which only delivers to your own verified Resend
account address — fine for testing, not for production.

## CRITICAL: verify your domain in Resend

Before any `@greenwaymarijuana.com` "From" address will actually deliver, you
must **verify the `greenwaymarijuana.com` domain in Resend** (Resend → Domains →
Add Domain → add the DNS records it gives you to your DNS host). Until then,
Resend rejects custom senders. This is a one-time, ~10-minute step.

## Recommended Google Workspace addresses

Owner uses Google Workspace. Recommended (executive decision, 2026-06): create
two dedicated addresses/aliases so automated mail stays out of personal inboxes
and looks professional to customers:

- `orders@greenwaymarijuana.com` — order/reservation notifications
- `loyalty@greenwaymarijuana.com` — loyalty signup alerts

Keep `michael@` and `contact@` for human correspondence. (Alternative with zero
new accounts: Gmail "+alias" like `michael+orders@greenwaymarijuana.com` routes
to the main inbox — good for testing, less polished for customer-facing "From".)

## Security

- Never paste API keys into chat/issues/commits. If a key is exposed, **rotate
  it** in the Resend dashboard and update Vercel.
- `.env.local` is gitignored; keep it that way.
