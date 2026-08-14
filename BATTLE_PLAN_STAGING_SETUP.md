# 13 — HOW TO BUILD A STAGING SITE FOR BATTLE TESTING

> **WHERE THIS LIVES:** repository root, `BATTLE_PLAN_STAGING_SETUP.md`.
> **Read this FIRST**, then `BATTLE_PLAN.md` — this file builds the staging site,
> that file explains what to do once it exists.

---


**Written for Michael, who asked for baby steps and his hand held.**

Everything below was verified against the actual repository, not assumed:
the app is Next.js deployed on Vercel (`vercel.json` present), authentication and
data are Supabase (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`),
admin rights come from `public.staff_profiles.role in ('owner','admin')`
(defined in migration `0001_slice1_foundation.sql`), and the first login is
promoted to Owner via the `ADMIN_BOOTSTRAP_EMAILS` environment variable
(`src/lib/supabase/env.ts`).

---

## 0. THE ONE RULE

**Nothing in this document touches your live site or your live database.**

A staging site is a complete second copy of everything: its own database, its own
web address, its own login. It shares nothing with production. That is the entire
point — it means the answer to *"what happens if I break this?"* is "nothing,"
which is the only condition under which real testing is possible.

If any step ever seems to be pointing at your real data, stop and ask.

---

## 1. WHAT YOU ARE BUILDING

Three things, in this order:

1. **A second Supabase project** — the staging database. Empty, then given the
   same structure as production by running your migrations.
2. **A second Vercel deployment** — the staging website, built from the same
   GitHub repository, but pointed at the staging database.
3. **A test admin login** — an account on staging with owner rights, which I use.

Roughly 45 minutes, most of it waiting. Both Supabase and Vercel have free tiers
that comfortably cover this.

---

## 2. STEP ONE — THE STAGING DATABASE

1. Go to **supabase.com** and sign in.
2. Click **New project**.
3. Organisation: the same one your live project is in.
4. **Name it something impossible to confuse with production.** Use
   `greenway-STAGING`. Not "greenway-2", not "greenway-test" — when you are tired
   at 11pm, `STAGING` in capitals is what saves you.
5. **Database password**: click Generate, then save it in your password manager.
   You will not need it often, but you will need it eventually.
6. **Region**: the same as your live project (probably West US). Only affects speed.
7. Click **Create new project** and wait ~2 minutes.

### Then give it the same structure as production

Open the new project's **SQL Editor**. You are going to run your migration files
in numerical order — the same ones you have been pasting in all along, from
`supabase/migrations/` in the repository.

Start with `0001_slice1_foundation.sql` and work upward to `0174`. For each one:
paste the whole file, press **Run**, confirm it says Success, move to the next.

> Two notes so this is not alarming: several of these files print nothing at all
> on success — that is deliberate, so a real error cannot be buried in a wall of
> output. And every one of them is idempotent, meaning running the same file
> twice is harmless. If you lose your place, re-running is safe.

This is the tedious part. It is also the last time you will ever have to do it,
because once staging exists we can test there first and you will paste into
production already knowing the script works.

---

## 3. STEP TWO — THE STAGING WEBSITE

1. Go to **vercel.com** → your dashboard.
2. **Add New → Project**.
3. Import the **same** `mblyman89/GREENWAY-WEBSITE` repository. (Yes, the same
   one. Two deployments from one repository is normal and expected.)
4. Name it `greenway-staging`.
5. **Before clicking Deploy**, open **Environment Variables**. This is the step
   that matters most.

Copy every variable from your production project, **except** the four below,
which must point at the new staging database:

| Variable | Where to find it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Staging Supabase → Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Staging Supabase → Settings → API → anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Staging Supabase → Settings → API → service_role key |
| `ADMIN_BOOTSTRAP_EMAILS` | Set to the test email from §4 below |

> **This is the step where a mistake would actually matter.** If
> `NEXT_PUBLIC_SUPABASE_URL` still points at production, the "staging" site is
> just your real site with a different address, and I would be attacking your real
> books. **Please check those three Supabase values twice.** If you would rather I
> checked them with you before I begin, I am glad to.

For the remaining variables, the safe approach for anything that reaches the
outside world — `RESEND_API_KEY`, `OPENAI_API_KEY`, the Leafly keys, the VAPID
push keys — is to paste the literal text `disabled-on-staging` instead of the
real key. Those features will simply not work on staging, which is correct: I do
not want to send real email or spend your API credits while trying to break
things.

6. Click **Deploy**. Wait ~5 minutes.
7. You get a URL like `greenway-staging.vercel.app`. **That URL is what you send
   me.**

---

## 4. STEP THREE — THE TEST LOGIN

1. Pick an email you control that is **not** your main one. A free Gmail
   like `greenway.staging.test@gmail.com` is ideal.
2. Set `ADMIN_BOOTSTRAP_EMAILS` in the **staging** Vercel project to that address
   (§3 above). This is what promotes the first login to Owner.
3. Visit your staging URL and sign in with that email.
4. Confirm you land in the back office with full admin rights.

Then send me:

- the staging URL,
- the test email address,
- the password (or the magic-link method, if that is how login works).

**Do not send me production credentials.** If you ever find yourself about to,
that is the moment to stop and ask me instead.

---

## 5. GIVING STAGING SOME REALISTIC DATA

Empty databases hide bugs. The most dangerous defects appear only when real
volume and real messiness exist.

**The safe version:** load your Sage CSV exports and your historical POS exports
into staging. That is real data, real messiness, real volume — and staging is
disposable, so nothing is at risk.

**What I would avoid:** copying live customer records into staging. You are an
I-502 retailer; customer data carries obligations, and there is no reason to
duplicate it into a system whose entire purpose is being attacked. Transactions
and accounting data, yes. Personal customer information, no.

---

## 6. WHAT I WILL DO ONCE I HAVE ACCESS

Not clicking around looking for typos. Specifically:

**Authorisation.** ~170 admin pages, 41 API routes and 98 server actions exist.
I will check whether each actually verifies who you are, or merely assumes that
because the link was hidden nobody will find it. Then I will call them directly
without logging in and see which ones answer.

**Trusting the browser.** Anything the browser sends can be changed by whoever
owns the browser. If a page sends "price: 45.00" and the server believes it, that
is a real hole. I will look for every case where the server trusts a number it
should have looked up itself.

**The money paths.** Everything from F1–F3 gets attacked through the actual
screens: submit the same sale twice, backdate an entry, post to a closed period,
approve my own large entry, reverse something twice. The database refuses all of
this today — I want to confirm the *screens* refuse it too, and that they explain
why in English rather than showing a red box with a stack trace.

**The boring catastrophic things.** What happens when the connection dies
mid-save. What happens when two tabs edit the same record. What a decimal point
in the wrong place does. Whether an error message leaks a key.

**Then you get a written report**, ordered by how much it could cost you, each
item with what I did, what happened, what it means in plain terms, and what to
change — the same format as the F3 evidence file.

---

## 7. WHAT WE ARE NOT DOING, AND WHY

You offered production access. I declined it deliberately, and I want the reason
on the record rather than buried in a chat message.

The purpose of this work is to *try to break things*. Trying to break a live
I-502 point-of-sale system risks real orders, real traceability obligations, and
real customer records. Your grandfather audits these books. A gap I find on
staging costs an afternoon; a mistake I make on production could cost far more
than that, and the person who has to explain it would be you.

Staging costs one extra evening of setup and removes that entire category of
risk. That is a trade worth making every time.

---

## 8. THE FOURTH OPTION, WHICH COSTS NOTHING AND STARTS NOW

You also approved the **code audit**, which needs no access at all. I can read
every admin route and server action directly and find missing authorisation
checks, trusted client input, and unguarded database writes — right now, while
staging is being set up.

It does not find everything a live test finds. But it finds a real share of it,
it starts immediately, and it costs nothing.

---

## 8b. WHAT WE TEST ONCE STAGING EXISTS — SEE FILE 14

This document covers BUILDING the staging site. **File 14
(`14-FULL-SYSTEM-BATTLE-PLAN.md`) covers what we DO with it**: the five branches
tested separately (website, website editor, POS, financial, bookkeeping/tax),
then the full end-to-end dry run from vendor email all the way to a tax form.

File 14 also answers the CCRS test-submission question: **the LCB operates an
official PREproduction environment at `https://precannabisreporting.lcb.wa.gov`
that is open to all licensees, with published test scenarios.** Read §8 of file
14 before touching it — production and test differ by three letters in the URL,
and that is the one genuinely dangerous step in this whole project.

---

## 9. IF ANYTHING GOES WRONG

Tell me what you see and I will walk you through it. Nothing in this document can
harm your live site: every step creates something new alongside production and
never modifies it.

If you get stuck, the honest fallback is that you can delete the staging Supabase
project and the staging Vercel project entirely and start over. They are
disposable by design. That is the whole reason we are building them.
