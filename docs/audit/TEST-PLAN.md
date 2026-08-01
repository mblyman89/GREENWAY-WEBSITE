# Greenway POS — The Owner's Testing Manual (TEST-PLAN.md)

> **Who this is for:** the owner — an expert in cannabis retail and the LCB,
> and a self-described beginner at software. This manual assumes ZERO
> technical knowledge. Every test is spoon-fed: what to click, what you
> should see, what it means if you see something else, and exactly what to
> write down when it breaks.
>
> **Interactive version:** open `docs/audit/test-manual/index.html` in any
> browser — same content, with a clickable sidebar, checkboxes that remember
> your progress, and a search box. Print it if you like paper.
>
> **Basis:** every "Expected" in this plan comes from the System Behavior
> Bible (`docs/audit/bible/`), which was verified line-by-line against the
> code. Standing rule: NEVER GUESS — nothing here is invented. Each phase
> names its Bible chapter so a future auditor can trace any claim.
>
> **When to run this:** AFTER the fix slices land. Tests marked
> **⚠️ KNOWN-BROKEN (GW-###)** describe behavior that is currently broken by
> an open finding — do not report those as new bugs; they are already in
> `FINDINGS.md` and will be fixed first. Once a finding is FIXED, its test
> becomes a normal test (and proves the fix).

---

## Table of contents

- [Part A — Read me first](#part-a--read-me-first)
  - [A1. The golden rules of testing](#a1-the-golden-rules-of-testing)
  - [A2. The Bug Card — what to write down when something breaks](#a2-the-bug-card)
  - [A3. Your testing toolkit](#a3-your-testing-toolkit)
  - [A4. Test data vs real data](#a4-test-data-vs-real-data)
  - [A5. How the phases fit together](#a5-how-the-phases-fit-together)
- [Phase 0 — Before you test anything (setup verification)](#phase-0)
- [Phase 1 — Logging in, roles & permissions](#phase-1) *(Bible ch. 14)*
- [Phase 2 — The register itself: setup, lock, PIN, till](#phase-2) *(Bible ch. 01)*
- [Phase 3 — Ringing a sale, start to finish](#phase-3) *(Bible ch. 02)*
- [Phase 4 — Offline mode & the sync queue](#phase-4) *(Bible ch. 04)*
- [Phase 5 — Returns, voids, holds & pickups](#phase-5) *(Bible ch. 05)*
- [Phase 6 — Medical sales](#phase-6) *(Bible ch. 03)*
- [Phase 7 — Loyalty](#phase-7) *(Bible ch. 06)*
- [Phase 8 — The menu pipeline & website orders](#phase-8) *(Bible ch. 07 & 12)*
- [Phase 9 — Inventory: intake, counts, dispositions](#phase-9) *(Bible ch. 09)*
- [Phase 10 — Staffing & payroll](#phase-10) *(Bible ch. 08 & 13)*
- [Phase 11 — Reports & CCRS compliance](#phase-11) *(Bible ch. 10 & 11)*
- [Phase 12 — BREAK-IT DAY: stress, chaos & edge cases](#phase-12)
- [Phase 13 — The dress rehearsal: a full simulated store day](#phase-13)
- [Part B — The results log & reporting back](#part-b--the-results-log)

---

## Part A — Read me first

### A1. The golden rules of testing

1. **One test at a time.** Finish a test completely — including writing down
   the result — before starting the next. Mixing tests is how you end up
   unable to say what caused what.
2. **Write down EVERYTHING weird, even if it "worked."** A button that took
   8 seconds, a flash of wrong text, a number that looked off for a second —
   all of it goes in the log. Small weirdness is how big bugs announce
   themselves early.
3. **Never assume you mis-clicked.** If something surprising happened,
   record it FIRST, then try again. If it happens twice, it's real. If it
   doesn't, the first one still goes in the log with the note "could not
   reproduce."
4. **A test you skipped is a test that failed.** If you can't run a test
   (missing hardware, missing data), log it as BLOCKED with the reason —
   don't quietly move on.
5. **The Expected column is the law.** These expectations were traced from
   the code and the Bible. If reality differs from Expected — even in a way
   that seems better — log it. "Better than expected" sometimes means a
   safety check isn't running.
6. **Time matters.** Note the clock time of every failure. Many of the
   trickiest bugs in this system involve time zones (Pacific vs UTC),
   midnight boundaries, and expiry windows — the exact minute often tells
   us which one bit you.
7. **Don't fix, don't retry-until-it-works.** Your job is to OBSERVE and
   RECORD. Retrying five times until it goes through destroys the evidence.
   One retry to confirm, then log and move on.
8. **Test like a bored employee AND like a thief.** Half these tests are
   "does the happy path work"; the other half are "can I cheat it." Both
   mindsets are required. When in doubt, try to break it — this manual will
   tell you exactly how.

### A2. The Bug Card

When ANYTHING doesn't match Expected, fill out one of these. Copy-paste the
template into your results log (Part B) — or use the interactive manual,
which generates one for you.

```
BUG CARD ————————————————————————————————————————
Test ID:        (e.g. T-042)
Date & time:    (e.g. 2026-08-14, 3:22 PM)
Where:          (register name / back-office page URL / website page)
Who:            (which login / which employee PIN was in use)
What I did:     (the exact steps, numbered — copy from the test, note
                 where you deviated, if anywhere)
What I expected:(copy the Expected line from the test)
What happened:  (describe EXACTLY what you saw — quote on-screen text
                 word for word; "an error" is not enough, "a red banner
                 saying 'Device key rejected'" is perfect)
Screen photo:   (take one with your phone if it's still on screen)
Can I repeat it? (yes / no / sometimes — try exactly once more)
Impact:         (blocked me / worked around it / cosmetic)
—————————————————————————————————————————————————
```

**Why each line matters:** the Test ID tells the AI exactly which code path
was running; date & time catches timezone bugs; the exact on-screen words
usually identify the precise line of code that fired; "can I repeat it"
separates hard bugs from flaky ones (both matter, they're fixed
differently).

### A3. Your testing toolkit

Gather these before Phase 0:

- **An iPad** (the register hardware) with Safari.
- **A laptop or desktop** for the back office (any modern browser).
- **A phone** — for taking photos of failures, and for testing the public
  website like a customer would.
- **Your phone's camera** aimed at anything weird. Screenshots on the iPad:
  press Top Button + Volume Up together.
- **A paper notepad or the interactive manual** for the results log.
- **The store's Wi-Fi details** — and a way to turn Wi-Fi OFF on the iPad
  (Settings → Wi-Fi) for the offline tests. Airplane Mode works too.
- **The receipt printer** (Star CloudPRNT) — needed from Phase 3 onward;
  earlier phases work without it.
- **A barcode scanner** if you have one (wedge type) — optional; there is a
  manual path for everything.
- **Two test "employees"** created in Staffing with PINs you know — one
  with a manager role, one budtender. You'll act as both.
- **Patience.** Some tests deliberately make you wait (2-minute idle lock,
  30-minute hold expiry). The manual tells you when to start a timer.

### A4. Test data vs real data

- The system has a **"Clean Slate" reset** (Admin → Settings → Reset) that
  clears day-to-day TEST data while keeping settings and the knowledge
  base. It requires typing a confirmation phrase and is recorded in the
  audit log. Use it between major test rounds so old test junk doesn't
  confuse new tests.
- **Medical has a dedicated TEST MODE** (Bible ch. 03 §10) that shows a loud
  banner and never touches the server — use it for all medical rehearsals
  until you hold the DOH endorsement.
- **Before the store opens for real:** run your tests freely. **After** the
  store opens, never mix test sales into a live day — the reports and CCRS
  exports would include them. If you must test on a live system, do it
  after close, log every test sale's receipt number, and void them the same
  day (voids are same-day only — Bible ch. 05).
- **CCRS testing uses REAL uploads** — there is no LCB sandbox. Phase 11
  walks you through the safe way (tiny file, checked in the portal's
  Processing Status before anything bigger).

### A5. How the phases fit together

```
Phase 0   Is the system even set up right?          (30 min, once)
Phase 1   Can the right people get in — and ONLY    (45 min)
          the right people?
Phase 2   Does the register itself behave?          (1.5 hrs)
Phase 3   Can I ring a legal sale?                  (2 hrs — the heart)
Phase 4   Does it survive bad internet?             (1.5 hrs)
Phase 5   Returns, voids, holds, pickups            (2 hrs)
Phase 6   Medical                                   (1.5 hrs, test mode)
Phase 7   Loyalty                                   (1 hr)
Phase 8   Menu updates & website orders             (1.5 hrs)
Phase 9   Inventory                                 (2 hrs)
Phase 10  Staffing & payroll                        (1 hr)
Phase 11  Reports & CCRS                            (2 hrs + portal time)
Phase 12  BREAK-IT DAY — you become the villain     (a full fun day)
Phase 13  Dress rehearsal — a fake store day        (a full day, 2 people)
```

Run them **in order** the first time — later phases assume earlier ones
passed. After fixes land, you only re-run the phases the fix touched
(each fix PR will name them) plus Phase 12's relevant scenario.

---

<a id="phase-0"></a>
## Phase 0 — Before you test anything (setup verification)

*Goal: prove the foundations are in place so later failures mean real bugs,
not setup gaps. Reference: `docs/audit/OWNER-TASKLIST.md` §§1–4.*

#### T-001 — Migrations are applied
- **Do:** Open your Supabase dashboard → SQL editor. The owner task list
  (§1) says which migration files matter; you have been applying them
  manually all along. Confirm your own checklist shows every migration file
  number applied, especially **0061** (the one flagged for re-run), **0117**
  (staffing lifecycle), **0120** (sale idempotency), and **0123** (PIN
  throttle).
- **Expect:** your checklist is complete; no migration file exists in the
  repo's `supabase/migrations/` folder that you haven't run.
- **If not:** STOP. Do not test further — half the tests below will fail in
  confusing ways. Apply the missing ones first.

#### T-002 — Environment variables are set
- **Do:** In Vercel → your project → Settings → Environment Variables,
  compare against the inventory in `OWNER-TASKLIST.md` §3.
- **Expect:** every required variable present; no obvious blanks.
- **If not:** set them, redeploy, then start Phase 0 again.

#### T-003 — The public website loads
- **Do:** On your phone (not the store network — use cellular), open your
  site's home page, then the Menu page.
- **Expect:** pages load in a few seconds; menu shows products with prices;
  no error screens.
- **If broken, record:** which page, exact error text, phone vs laptop,
  cellular vs Wi-Fi.

#### T-004 — The back office loads and requires login
- **Do:** On the laptop, go to `/admin` while logged OUT (use a private/
  incognito window to be sure).
- **Expect:** you are sent to the login page — never straight into the
  dashboard.
- **This must NEVER happen:** seeing any admin data while logged out. That
  would be a critical security failure — photograph it and stop testing.

#### T-005 — The register page loads on the iPad
- **Do:** On the iPad in Safari, go to `/pos`.
- **Expect:** the register loads to its setup screen (first time) or lock
  screen (already provisioned). No blank white page.

#### T-006 — Email sending works (Resend)
- **Do:** trigger any email the system sends (easiest: place a tiny test
  website order in Phase 8 — or just note this test and confirm it there).
- **Expect:** the email arrives within ~2 minutes, from your store's
  address, not spam-foldered.
- **✅ FIXED (GW-024 + GW-025, PR #635):** the system now checks whether the
  email provider accepted every send, and the post-order email work can no
  longer be dropped when the serverless function freezes. If a send FAILS,
  a plain-English warning is written onto that order's timeline in Admin →
  Orders (from "system · email monitor") — so if a test email doesn't
  arrive, open the order in the back office and look at its timeline: it
  will tell you what went wrong.

#### T-007 — The receipt printer answers
- **Do:** power the Star printer, confirm it's on the store network per
  `OWNER-TASKLIST.md` §6.
- **Expect:** its status page/light shows connected. Real print tests come
  in Phase 3.

#### T-008 — Two test employees exist
- **Do:** Admin → Staffing → Employees. Create (or confirm) two ACTIVE test
  employees: "Test Manager" (manager role, a 4+ digit PIN you know) and
  "Test Budtender" (staff role, different PIN).
- **Expect:** both save cleanly and appear in the roster with the right
  roles.
- **Note their PINs** in your log — you'll use them constantly.

---

<a id="phase-1"></a>
## Phase 1 — Logging in, roles & permissions *(Bible ch. 14)*

*Goal: only the right people get in, and each role sees only what it
should. You'll act as several different people.*

#### T-010 — Owner login works
- **Do:** log in with your owner account (magic link or passkey — whichever
  you've set up).
- **Expect:** you land on the admin dashboard; your name/role appears in
  the top nav.

#### T-011 — A wrong email gets nothing
- **Do:** log out. Request a magic link for a made-up email like
  `nobody@example.com`.
- **Expect:** the screen shows the SAME neutral "if this email belongs to a
  staff account, a link is on its way" message you'd see for a real staff
  email; **no** staff account is created for that address. Check Admin →
  Users afterwards from your owner login: there must be NO new account.
- **✅ GW-018 FIXED:** the login form now refuses to create accounts
  (`shouldCreateUser: false`) and answers unknown emails with the same
  neutral screen as known ones, so the form can't be used to probe which
  emails have accounts. Migration **0127** additionally makes any
  auto-created profile inactive by default (defense in depth).
- **If broken, record:** if a new account appears in Users — that's a
  critical bug, photograph the Users page. Also note if the screen wording
  DIFFERS between a real staff email and a made-up one (that difference is
  itself a leak).

#### T-012 — Staff invite end-to-end
- **Do:** Admin → Users → invite a real email address you control (a
  personal one). Open the invite email on another device and follow it.
- **Expect:** the link takes you to a "Welcome to the team — set your
  password" page, you choose a password (8+ characters, typed twice), and
  you land in the admin with the role you assigned. Later, sign in with
  that email + password from the login page — it works.
- **✅ GW-017 FIXED:** invites now point at `/admin/account/set-password`,
  which finishes the sign-in and lets the invitee choose a password.
  Requires the Supabase dashboard Redirect URLs to include
  `https://<your-domain>/admin/account/set-password` — if the email link
  still lands on the homepage, that allowlist entry is missing.
- **If broken, record:** where the email link landed (exact URL) and any
  error shown on the set-password page.

#### T-013 — A readonly analyst can look but not touch
- **Do:** set your test personal account (from T-012) to the
  **Read-only / Analyst** role. Log in as them. Try to: view Reports
  (should work), then try to edit anything — a product price, an order
  status, a promotion.
- **Expect:** reports visible; every edit attempt is refused or the
  controls simply aren't there. Trying to open a page above your rank
  should bounce you back to the dashboard with a "denied" notice.
- **If broken, record:** which page let readonly change what — exact URL
  and field.

#### T-014 — A budtender-role login can't see money settings
- **Do:** switch the test account to **Budtender/Staff** role. Log in.
  Try to open: Settings, Users, Payroll, Vendor Payments, Reports →
  Accounting.
- **Expect:** all refused/bounced. Orders dashboard and loyalty review
  ARE visible (that's the role's purpose).

#### T-015 — Nobody can promote themselves
- **Do:** as a test **admin**-role account, open Admin → Users and try to
  change YOUR OWN role to owner, and try to create a new user with the
  owner role.
- **Expect:** both are refused with a clear message. The rule: you can't
  change your own role, and you can't grant a role above your own.

#### T-016 — Deactivation kills access immediately
- **Do:** as owner, deactivate the test account (Users → set inactive).
  Then, as the test account (still logged in in its other browser
  window!), click anything.
- **Expect:** their very next action fails / they're logged out. A
  deactivated person must not keep working just because their browser tab
  was already open.

#### T-017 — The last owner is protected
- **Do:** as owner, try to deactivate yourself / demote yourself (assuming
  you are the only active owner).
- **Expect:** refused with a clear explanation. The system must never let
  the last active owner lock everyone out.

#### T-018 — The audit trail is watching
- **Do:** after T-013…T-017, open the admin audit/activity page. 
- **Expect:** rows for every role change, activation flip, and refused
  attempt you just made — each naming who did what and when.
- **Why you care:** the LCB and your accountant will one day ask "who
  changed this?" — this page is your answer. If actions you just took are
  missing here, that's a finding.

---

<a id="phase-2"></a>
## Phase 2 — The register itself: setup, lock, PIN, till *(Bible ch. 01)*

*Goal: the iPad register boots, locks, unlocks, and handles cash-drawer
bookkeeping exactly as designed — before a single sale is rung.*

#### T-020 — Provision a register (the one-time setup)
- **Do:** Back office → Admin → Registers → POS devices → provision a new
  device. You'll be shown a **Device ID** and a **Device Key** — the key is
  shown ONCE, copy both. On the iPad at `/pos`, paste them into the setup
  screen.
- **Expect:** setup succeeds; the screen tells you the device's name and
  register; you land on the LOCK screen (PIN pad), never straight into an
  unlocked register.
- **Nice detail to verify:** paste the id and key into each other's fields
  on purpose — the screen should detect the mix-up and swap them back for
  you with a notice.
- **If broken, record:** the exact error text. "Device key rejected" vs
  "Could not reach the server" mean totally different problems.

#### T-021 — Setup refuses to work offline
- **Do:** on a NOT-yet-provisioned iPad (or after T-029's revoke), turn off
  Wi-Fi, try setup.
- **Expect:** a clear "connect to the internet for first-time setup"
  message. First-time setup is online-only by design.

#### T-022 — PIN unlock works, wrong PIN doesn't
- **Do:** at the lock screen, enter the Test Budtender PIN.
- **Expect:** register unlocks showing that employee's name. Lock it again
  (there's an explicit lock control). Now enter a WRONG pin.
- **Expect:** refused, count shown or not — but definitely no unlock.

#### T-023 — PIN guessing gets you locked out
- **Do:** enter a wrong PIN **5 times fast** (within a minute).
- **Expect:** the PIN pad locks for about **60 seconds** and says so.
  During the lockout, even the CORRECT pin must be refused. After ~60s,
  the correct PIN works again.
- **Why you care:** this is the anti-thief throttle. If 5 fast wrong
  guesses do NOT lock the pad, stop and photograph — that's a security
  hole (the throttle depends on migration 0123 — see GW-005).

#### T-024 — The 2-minute idle lock
- **Do:** unlock the register. Don't touch it. Start a 2-minute timer.
- **Expect:** at ~2 minutes untouched, the register locks itself back to
  the PIN pad.
- **Then:** unlock, tap around a little before 2 minutes — the timer should
  reset with activity (it should NOT lock mid-use at exactly 2 minutes
  from unlock).

#### T-025 — A restart always lands on the lock screen
- **Do:** unlock the register, then kill the app/tab completely (swipe it
  away) and reopen `/pos`.
- **Expect:** LOCK screen. An employee session must never survive a
  restart. **This must NEVER happen:** reopening straight into an unlocked
  register.

#### T-026 — Clock in / clock out from the lock screen
- **Do:** use the lock screen's clock-in with the Test Budtender PIN. Then
  clock out.
- **Expect:** both actions confirm on screen; back office → Staffing →
  time clock shows the punch pair with correct times.
- **Edge to try:** clock in twice in a row without clocking out — the
  second attempt should toggle (clock you OUT), never create two open
  punches.

#### T-027 — Till: count-in, safe drop, blind close
- **Do:** open a drawer session (count in a float, e.g. $200.00). Ring
  nothing yet. Do a **safe drop** of $50 — it should demand a **witness**:
  a SECOND employee's PIN (use Test Manager).
- **Expect:** the drop records with both names. Try to witness a drop with
  the SAME pin as the dropper — must be refused ("a drop cannot witness
  itself").
- **Try:** a $0 or negative drop — refused.
- **Then:** blind-close the drawer: count the cash and enter your count.
- **Expect:** the register accepts your count and says thanks — it must
  NOT show you the expected total or the over/short. (That reveal happens
  only in the back office, by a manager — that's what "blind" means.)

#### T-028 — Two drawers can't be open at once
- **Do:** with a drawer session open, try to open another one on the same
  register.
- **Expect:** refused.

#### T-029 — Revoking a device cuts it off
- **Do:** back office → Registers → devices → revoke the test iPad. On the
  iPad, try to unlock / do anything that talks to the server.
- **Expect:** its next server call fails with an "unknown or revoked
  device" style message. Re-provision it (new key) to continue testing.
- **Why you care:** this is what you'll do if an iPad is ever stolen.

#### T-030 — The update banner never interrupts a sale
- **Do:** this one is opportunistic — when a new deploy ships mid-testing,
  have a sale in progress on the register.
- **Expect:** the update NEVER applies mid-sale. It waits and applies at
  the lock screen, or offers a banner on the home screen. Record the
  moment an update applied and what screen you were on.

#### T-031 — Open drawer from the home screen (audited no-sale)
- **Do:** with a drawer counted in and the register online, tap the
  **💵 Open drawer** button in the home screen's Cash drawer panel (next
  to Cash drop / Close).
- **Expect:** the SAME no-sale modal as MORE ▾ → "No sale — open drawer":
  reason (preset or typed), then a manager/lead PIN. On approval a NO SALE
  slip prints and the drawer pops AFTER the print. Back office audit shows
  `register.no_sale` with both employee ids.
- **Edge to try:** turn Wi-Fi off — both open-drawer buttons must disable
  and show the offline reason next to them ("manager approval needs a
  connection"). Close the drawer session — both buttons must disable with
  the count-in-a-drawer-first reason. **This must NEVER happen:** the
  drawer opening without a reason + manager PIN + printed slip.

---

<a id="phase-3"></a>
## Phase 3 — Ringing a sale, start to finish *(Bible ch. 02)*

*Goal: the heart of the system. A sale has four steps — **ID check → cart
→ cash tender → done** — wrapped by two gates (store hours, and the ID
gate). You will walk the happy path first, then rattle every gate.*

### 3.1 The ID gate

#### T-040 — The gate comes first, always
- **Do:** unlock the register and start a sale.
- **Expect:** the FIRST screen is the ID check. There is no way to reach
  the cart without an ID verdict. Look for the house-policy banner
  (vertical ID always scans; under-40 always scans; clearly-40+ gets a
  visual check + DOB entry).

#### T-041 — Scan a valid ID (if you have a scanner)
- **Do:** scan a real, unexpired WA license of someone 21+.
- **Expect:** verdict allowed; you land in the cart; the person's age was
  computed correctly.

#### T-042 — An expired ID is refused, every path
- **Do:** scan (or manually enter) an ID with an expiration date in the
  past.
- **Expect:** refused with a clear reason. Per WAC 314-55-150 an expired
  ID is not acceptable — the register must hold that line even if the
  person is obviously 50.

#### T-043 — Underage is refused, both thresholds
- **Do:** manually enter a DOB that makes the person 20 (no medical card).
  Then one that makes them 17.
- **Expect:** both refused. 18–20 is ONLY allowed with a valid medical
  card (Phase 6); under 18 is refused always — "no medical exception
  exists at retail."
- **Sneaky check:** try a DOB that makes them turn 21 TOMORROW. Refused —
  age math must not round up.

#### T-044 — The over-40 visual path can't be abused
- **Do:** use the visual/over-40 path but enter a DOB that computes to 35.
- **Expect:** refused — the visual path re-checks that the DOB actually
  proves 40+, it is not an honor system.

#### T-045 — Manual entry is audited
- **Do:** complete a manual ID verification (passport-style path), finish
  the sale (any item, cash).
- **Expect:** the sale completes; later, in the back office, that sale's
  record shows a manual-ID-verification audit event attached. A manual
  verify with no audit trail is a compliance failure.

### 3.2 The cart

#### T-046 — Add, change, remove
- **Do:** add 3 different products; change a quantity; remove a line.
- **Expect:** totals update instantly and correctly every time. Prices
  shown match the menu.

#### T-047 — The statutory limit wall (the big one)
- **Background you already know:** WA per-sale limits — 1 oz usable
  flower (28 g), 16 oz solid edibles, 72 oz liquid, 7 g concentrates
  (3× each for medical cardholders).
- **Do:** add flower until the cart passes 28 g equivalent.
- **Expect:** the register shows the limit violation clearly and the
  **Pay button refuses to enable** while over. Reduce quantity → the
  block clears.
- **Try each bucket:** repeat with concentrates past 7 g, edibles past
  16 oz.
- **Sneaky check:** try mixing (e.g., 20 g flower + concentrates) — the
  buckets are separate; one bucket at its cap must not block another
  bucket that's under.
- **This must NEVER happen:** completing an over-limit sale through ANY
  path — there is no override for statutory limits at the register.

#### T-048 — Owner limits can only TIGHTEN
- **Do:** in the back office (Settings → sales limits), set an owner limit
  BELOW the statutory cap (e.g., 14 g flower). Ring a 20 g flower sale.
- **Expect:** blocked at your 14 g. Now try to set an owner limit ABOVE
  statutory (e.g., 56 g).
- **Expect:** the statutory ceiling still wins — owner settings can
  tighten, never loosen.

#### T-049 — Price override needs a manager, and it's picky
- **Do:** as budtender, attempt a price override on a line.
- **Expect:** it demands a manager PIN (Test Manager). Approve it.
- **Sneaky check 1:** try to override a cannabis item to $0.00 or a penny
  below its cost. Refused — the statutory minimum (1¢ floor) and the
  acquisition-cost floor bind EVERYONE, including managers.
- **Sneaky check 2 (the stale-approval trap):** get a manager approval,
  then change the cart (add an item) before applying. The approval must
  drop as stale — an override may only apply at the exact price the
  manager saw.
- **Sneaky check 3:** turn Wi-Fi off and try an override. Refused —
  approvals never work offline.

#### T-050 — Sales hours gate
- **Do:** in Settings → sales hours, set closing time to 5 minutes from
  now. Wait for it to pass, then try to start a sale.
- **Expect:** a friendly "sales are closed" screen that re-checks every 15
  seconds. A sale mid-tender when hours close should still be able to
  finish its receipt (the done step is deliberately not blocked).
- **Restore your real hours after.**

### 3.3 Tender & done

#### T-051 — Cash tender math
- **Do:** ring a $27.43 sale. Tender $40.
- **Expect:** change $12.57, computed instantly. Try tendering LESS than
  due — Pay must refuse.
- **If cash rounding is configured:** verify the amount DUE follows your
  rounding policy and the receipt matches the screen to the penny.

#### T-052 — The receipt tells the truth
- **Do:** complete the sale, print the receipt.
- **Expect:** every line, discount, tax figure, and total on the paper
  matches the screen exactly. Cannabis tax handling should match your
  configured display (tax-inclusive pricing).
- **Also check:** printing a receipt must NOT pop the cash drawer a second
  time.

#### T-053 — The sale landed in the back office
- **Do:** on the laptop, find the sale you just rang (Orders / register
  activity).
- **Expect:** it appears within a minute or two with the same total, the
  right register, the right employee, and inventory decremented by
  exactly the units sold (spot-check one product's count before/after).
- **✅ GW-011/GW-012 FIXED (PR #636):** "exactly once" is now enforced by
  the database itself — the decrement claims a unique latch row first
  (migration 0129), and quantity changes are applied as locked atomic
  deltas, so two overlapping completions can no longer decrement twice
  or overwrite each other's counts. See T-118 for the concurrency drill.

#### T-054 — Cancel paths are clean
- **Do:** start a sale, pass the gate, add items — then cancel out
  entirely.
- **Expect:** no order appears anywhere, no inventory moves, and (if
  loyalty was attached) any reserved points come back (Phase 7 re-checks
  this properly).

#### T-055 — Infused products obey the 7 g concentrate wall (added with the mix-infused fix)
- **Background:** infused flower, infused prerolls, infused blunts, and
  infused preroll packs are "cannabis mix infused" — flower combined with
  concentrate (WAC 314-55-010(8)). They count against the **7 g
  concentrate** limit (WAC 314-55-095), NOT the 28 g flower limit.
- **Do:** add 8 × 1 g infused prerolls to a recreational cart.
- **Expect:** the limit meter shows the CONCENTRATE bucket over (8 g > 7 g)
  and Pay refuses — even though 8 g is far below the 28 g flower wall.
- **Also try:** 5 infused blunts (1.5 g each = 7.5 g) → blocked. 7 × 1 g
  infused prerolls → allowed (exactly at the limit).
- **The share check:** 5 g of dabs/carts + 3 infused prerolls (3 g) →
  blocked together — infused shares the same 7 g bucket as concentrates.
- **The independence check:** a full 28 g of regular flower PLUS 6 g of
  infused prerolls → allowed. Infused no longer eats the flower allowance.
- **Medical:** a carded patient gets 21 g for the concentrate bucket —
  21 infused prerolls pass, 22 block.
- **This must NEVER happen:** an infused product sliding under the flower
  limit — 10+ grams of infused prerolls completing as a recreational sale.

---

<a id="phase-4"></a>
## Phase 4 — Offline mode & the sync queue *(Bible ch. 04)*

*Goal: the register's superpower — selling through an internet outage —
and its most dangerous failure modes. You will deliberately cut the
internet. That is the test.*

**How it works, in one paragraph:** every sale/punch/audit event goes into
a queue ON the iPad first, then syncs to the server when it can. Each
event carries a unique fingerprint so the server can never double-count a
retry. Rows leave the iPad's queue ONLY when the server durably confirms
them.

#### T-060 — Sell through an outage
- **Do:** unlock the register. Turn the iPad's Wi-Fi OFF. Ring TWO
  complete cash sales (gate → cart → tender → done).
- **Expect:** both sales complete normally — receipts print math on
  screen even if the printer (network) can't print. A queue indicator
  shows events waiting.
- **Then:** Wi-Fi back ON. Within a minute or two, the queue drains.
- **Verify:** BOTH sales appear in the back office exactly once each.
- **This must NEVER happen:** a sale appearing twice, or not at all.
  Count carefully — this is the single most important test in this manual.

#### T-061 — The register boots offline
- **Do:** with Wi-Fi off, kill and reopen `/pos`.
- **Expect:** the register loads (from its cached copy) to the lock
  screen. Note the known limitation: **unlocking needs the network**
  (GW-007, enhancement planned) — so pre-unlock before an expected
  outage. Record what you see either way.

#### T-062 — Offline menu is yesterday's menu, never a blank one
- **Do:** offline, browse the product grid.
- **Expect:** the last cached menu with real prices. NEVER a $0 or empty
  menu.

#### T-063 — Flaky, not just dead
- **Do:** ring a sale while toggling Wi-Fi off/on every ~10 seconds
  (simulate the worst café Wi-Fi on earth).
- **Expect:** the sale completes; the queue eventually drains; the back
  office shows exactly one copy. Retries must be invisible to the
  customer.

#### T-064 — The rejected-row banner
- **Do:** this is hard to trigger honestly — it happens when the server
  refuses an event as invalid. If you ever see a red "rejected" banner
  on the register during any test: STOP, photograph it, and log every
  detail. Rejected rows are kept on the iPad for manager review.
- **FIXED (GW-027):** the register now reports its rejected-row count and a
  short summary with every sync, and the back office shows it (Register
  Activity page + POS devices page). The rows themselves still live only on
  that iPad — see T-173 for the full check.

#### T-065 — Clock drift protection
- **Do:** set the iPad's clock 10 minutes FAST (Settings → General → Date
  & Time, turn off auto). Ring a sale. Restore auto-time after.
- **Expect:** the server flags future-timestamped events (≥5 min drift)
  into its exception queue rather than processing them as normal. Check
  Admin → Registers → exceptions for the flagged event.
- **Why you care:** a wrong clock could otherwise file sales on the wrong
  compliance day.

#### T-066 — The exception queue is a manager's inbox
- **Do:** with the T-065 exception (or any other) present, open Admin →
  Registers → exceptions. Review/approve it with the manager flow.
- **Expect:** clear explanation of why it was flagged; approving requires
  a manager; the event then processes; the queue row resolves.
- **This must NEVER happen:** an exception silently disappearing without
  a manager decision.

#### T-067 — A sale stranded mid-sync heals itself (GW-023 recovery)
- **✅ GW-023 FIXED (PR #634):** a server crash mid-processing used to
  strand the sale as "pending" forever while telling the register
  "duplicate" — the register then deleted its only copy. Now a stale
  pending sale is automatically re-processed on the register's next
  flush, swept by the daily cron if the register never returns, and
  escalated to the exception queue (with a written reason) whenever a
  blind re-run wouldn't be provably safe.
- **Do:** this is hard to trigger honestly. The observable proxy: after
  any heavy offline session (T-060/T-063), open the day report and check
  the "Still processing" line. If it shows a count, wait 2+ minutes and
  sync the register again (or wait for the daily cron), then re-check.
- **Expect:** "Still processing" returns to zero — every event ends as
  either a completed sale or a written-up exception in Admin →
  Registers → exceptions. Migration `0128` must be applied for the full
  protection (attempts cap + the database-level double-order guarantee).
- **This must NEVER happen:** a sale that was rung on the register but
  appears NOWHERE in the back office (no order, no exception) — that is
  the exact silent-loss bug this fix closed. If you ever see money in
  the drawer with no matching order or exception, stop and investigate.
- **If broken, record:** the register's queue banner, the day report's
  "Still processing" count over time, and the
  `select * from pos_sale_events where status = 'pending'` result.

---

<a id="phase-5"></a>
## Phase 5 — Returns, voids, holds & pickups *(Bible ch. 05)*

*Store policy is deliberately STRICTER than the law here — the tests
enforce your own rules.*

#### T-070 — A clean return
- **Do:** ring a sale (Phase 3 style) and keep the receipt. Return one
  item at the counter flow with the receipt number.
- **Expect:** the refund equals EXACTLY what was paid for that line (it's
  echoed from the stored sale — no manual typing of amounts, ever). The
  two WAC 314-55-079(12) attestations (packaging intact, lot ID legible)
  are required — try refusing one: the return must hard-stop.

#### T-071 — No receipt, no return
- **Do:** attempt a return with a made-up receipt number (right length,
  wrong number), then a malformed one.
- **Expect:** both refused. The number must match exactly.

#### T-072 — The 15-day window, and day 16
- **Do:** (long-game test — plant a sale now, return to it later.) A
  return on day 15 works; day 16 is refused. Purchase day counts as day
  0, in PACIFIC days.
- **Watch for:** a purchase made late evening — it must not gain or lose
  a day at midnight UTC (4/5 pm Pacific). If a day-15 return gets
  refused, note the exact purchase time and return time — that's a
  timezone bug pattern.

#### T-073 — You can't return the same thing twice
- **Do:** return 1 of 2 identical units on a receipt. Then try to return
  2 more.
- **Expect:** only 1 remains returnable; the attempt to exceed is capped.
  Then void-after-return / repeat-return attempts must all be blocked.

#### T-074 — Voids are same-day and manager-only
- **Do:** ring a small sale. As budtender, attempt a void — it must
  demand a manager PIN and a reason (3+ characters). Complete it.
- **Expect:** inventory restocks (check the count), loyalty claws back,
  and the sale is marked voided — never deleted. Tomorrow, try to void
  today's other sale: refused — the answer for yesterday is a RETURN.
- **Note (GW-011/GW-012 fix, PR #636):** the restock is now latched by a
  unique claim row (migration 0129) and applied as an atomic delta, so a
  double-submitted void can never restock the same sale twice.

#### T-075 — Holds park the cart, not the rules
- **Do:** build a cart, put it on hold. Resume it 5 minutes later.
- **Expect:** the cart rebuilds at CURRENT prices (it stores what-and-how-
  many, never prices), and the ID gate result carries over within the
  window.
- **The 30-minute rule:** park a sale and wait 31+ minutes (set a timer).
- **Expect:** resume is refused / forces a fresh ID check. A parked sale
  must never skip re-verification after the TTL.

#### T-076 — Pickups: website order → register handover
- **Do:** place a website pickup order (Phase 8 shows how). At the
  register, load the pickup.
- **Expect:** handover REQUIRES the explicit ID attestation checkbox —
  there is no way around it. Complete the pickup; the order flips to
  completed; the website order and the register sale must never BOTH
  count (no double revenue, no double inventory decrement).
- **Sneaky check:** load a pickup order, then abandon it (don't complete).
  The order must NOT be cancelled or superseded just because it was
  loaded.

#### T-077 — Recalled product stops selling NOW
- **Do:** in the back office, place a recall hold on a test product's lot.
  Try to sell it at the register; try to complete a website pickup
  containing it.
- **Expect:** every path refuses. Then release the hold — selling resumes.
- **This must NEVER happen:** a recalled product completing through ANY
  path. This is your product-safety kill switch; test it seriously.

#### T-078 — A saved sale never blocks selling the same product
- **Why you care:** this is the Cultivera pain the system was built to
  kill — a saved cart must NEVER take a unit out of sellable inventory.
- **Do:** pick a product the menu shows exactly 1 left of. Build a cart
  with it and **Hold** the sale. Start a NEW sale and scan/add the same
  product.
- **Expect:** it adds normally — no "zero quantity" refusal. An info
  panel appears in the cart rail: "A saved sale is holding stock this
  cart needs", naming who saved it, when, its contents, and per-line
  facts ("menu shows 1 left and the saved sale is holding 1 — not
  enough for both carts"), plus a **"Delete the saved sale — free its
  items for this customer"** button.
- **Then:** tap the release button — the saved sale clears (gone from
  the home screen too) and the panel disappears. Complete the sale
  normally.
- **Also check:** resume a held sale and confirm NO conflict panel shows
  against its own held items (a hold must never conflict with itself).
  And with plenty of stock (held 1, menu shows 5), no panel — it only
  speaks when the count can't cover both carts.
- **This must NEVER happen:** a sale BLOCKED because the unit sits in a
  saved cart, or the panel deleting the hold without the cashier tapping
  the release button.

---

<a id="phase-6"></a>
## Phase 6 — Medical sales *(Bible ch. 03)*

*Run this whole phase in **TEST MODE** until your DOH endorsement is
active. Test mode shows a loud banner and never touches the server — if
the banner is missing while test mode is on, that itself is a bug.*

#### T-080 — No endorsement, no exemption
- **Do:** with the endorsement flag OFF (your real current state), attach
  a valid card to a sale outside test mode.
- **Expect:** NO tax exemption applies. The endorsement is a hard AND —
  a card alone changes nothing.

#### T-081 — Card intake (issuing a recognition card)
- **Do:** in test mode, run the guided intake wizard for a fake patient.
  Try to finish with one of the DOH 608-048 checkboxes unchecked.
- **Expect:** refused. Try an expiry beyond the statutory ceiling (+1 yr,
  or +6 months for a minor): refused. Complete a valid intake: card
  issued with correct dates.

#### T-082 — The 18–20 door opens ONLY with a card
- **Do:** in test mode, at the ID gate: DOB age 19 + valid card.
- **Expect:** allowed (medical). Same DOB, no card: refused. DOB age 17
  + valid card: refused (under 18 is never allowed at retail).

#### T-083 — Exemption requires a COMPLIANT product
- **Do:** in test mode, ring a carded patient buying (a) a
  DOH-compliant-registered product and (b) a regular product.
- **Expect:** sales tax drops on (a) only. Compliance registry membership
  is required per-product — a card is not a blanket discount.

#### T-084 — Card validity is checked on the DAY of completion
- **Do:** in test mode, attach a card that expires today/tomorrow if you
  can craft one; otherwise verify the refusal text by attaching an
  expired card.
- **Expect:** expired, revoked, or not-in-registry cards refuse the
  exempt sale with a clear explanation — never a silent downgrade to
  taxed.
- **⚠️ KNOWN-EDGE (GW-009):** validity currently uses the UTC day, so
  between 4–5 pm Pacific and midnight, a card expiring "today" may be
  treated as expired a few hours early (fail-SAFE direction). Note the
  time if you see it.

#### T-085 — The medical ledger
- **Do:** complete a test-mode exempt sale preview; then (post-
  endorsement, in production) re-run and check Admin → Medical ledger.
- **Expect:** every real exempt sale writes a ledger row (date, UPID,
  card dates, product, price). The rule is write-or-block: if the ledger
  can't be written, the sale must refuse rather than complete
  unrecorded. Voiding a medical sale must remove its ledger rows.

#### T-086 — High-THC products are card-only
- **Do:** try to sell a high-THC-flagged product to a recreational (no
  card) customer — register, and website pickup.
- **Expect:** refused on every path. There is NO manager override for
  this.

---

<a id="phase-7"></a>
## Phase 7 — Loyalty *(Bible ch. 06)*

#### T-090 — Signup and points earn
- **Do:** sign up a test member (website form or in-store). Ring a sale
  attached to them.
- **Expect:** points appear after completion — whole points only, earned
  on the pre-tax amount (never on tax), exactly once per order.
- **✅ GW-011 FIXED (PR #636):** "exactly once per order" is now a
  database guarantee — migration 0129 adds a unique index so a second
  earn row for the same order is physically impossible, and the code
  treats that refusal as "already earned" (no error, no double points).

#### T-091 — Redemption at the register
- **Do:** attach the member, redeem points against a cart.
- **Expect:** the discount applies; the member's balance drops by
  exactly the redeemed amount. Cancel a redemption mid-sale: points come
  back.

#### T-092 — The legal floors bind loyalty too
- **Do:** build a cart of one cheap cannabis item and try to redeem
  enough points to zero it out.
- **Expect:** REFUSED (with the absorbable amount shown) — a loyalty
  discount may never make cannabis free or below acquisition cost. It
  refuses whole, never partially applies.

#### T-093 — One discount per order, best-deal-wins
- **Do:** attach a member with tier pricing to a cart that also has a
  promotion running.
- **Expect:** per line, the BETTER of tier vs promo price applies —
  never both stacked.

#### T-094 — A code can't be spent twice
- **Do:** issue a redemption code; redeem it; try to redeem it again (at
  the register, then in the back office).
- **Expect:** the second attempt says it was just used. If you have two
  registers, try both at the same moment — exactly one wins.

#### T-095 — Cart drift drops the discount
- **Do:** apply a loyalty discount, then ADD an item before paying.
- **Expect:** the discount drops (the cart no longer matches what was
  priced) and any points-backed code releases its points back. Points
  burned with no discount given is a must-never.

#### T-096 — Reversals claw back
- **Do:** void a loyalty sale (T-074 style); separately, return one line
  of another loyalty sale.
- **Expect:** the void claws back the FULL earn; the return claws back
  proportionally. A member must never keep points from money you gave
  back.

#### T-097 — Privacy at the register
- **Do:** attach a member and look at everything the register shows.
- **Expect:** label, points, tier — and nothing else. No DOB, no phone,
  no email, no notes on the register, ever.

#### T-098 — Offline degrades gracefully
- **Do:** Wi-Fi off; try to redeem points.
- **Expect:** redemption refuses (it needs the live balance); the sale
  can still be rung WITHOUT the discount. Loyalty never blocks a legal
  sale.

---

<a id="phase-8"></a>
## Phase 8 — The menu pipeline & website orders *(Bible ch. 07 & 12)*

### 8.1 Menu updates

#### T-100 — Publish a menu version
- **Do:** Admin → Menu Imports. Stage a menu update (Cultivera export
  upload while you still have it, or via intake auto-carry), review it,
  publish.
- **Expect:** exactly ONE published version at any moment. The website
  menu and the register bundle both reflect the new version (the register
  picks it up on its next poll — give it a couple of minutes).
- **This must NEVER happen:** two live versions, or zero after a publish.

#### T-101 — Errors block publishing
- **Do:** if a staged version shows blocking transform errors, try to
  publish it anyway.
- **Expect:** refused server-side. Items with problems are HIDDEN with a
  reason (e.g., "no inventory"), counted in the summary — never silently
  dropped.

#### T-102 — Hidden means hidden EVERYWHERE
- **Do:** hide a product (or mark unavailable). Check the website menu
  AND the register grid after the next bundle refresh.
- **Expect:** gone from both. Then 86 an item from the register
  (stock-flag): the flag is one-way from the register — bringing it back
  is a back-office action only.

#### T-103 — Register and website price identically
- **Do:** with a promotion active, compare one product's price on the
  website menu vs the register grid vs a rung sale.
- **Expect:** identical to the penny — all three run the same pricing
  engine.

### 8.2 Website orders

#### T-104 — Place a guest pickup order
- **Do:** on your phone (as a customer), add items and check out with
  just a first name.
- **Expect:** confirmation page with an order status link; a staff
  notification email; the order appears in Admin → Orders as **new**.
- **Note:** the customer's status link is private to that order — try
  opening it in a different browser: it should show only that order's
  customer-safe view.
- **Note (GW-024/GW-025 fix, PR #635):** if the staff notification email
  does NOT arrive, open the order in Admin → Orders and check its timeline
  — a failed send now leaves a visible warning note there instead of
  vanishing silently.

#### T-105 — The status flow is one-way with reasons
- **Do:** walk the order forward: new → acknowledged → preparing → ready.
  Then try to drag a COMPLETED order backward.
- **Expect:** forward moves are one click; skipping ahead is allowed;
  moving a completed/cancelled order requires a REVERSAL with a written
  reason (5+ characters) and lands only on its designated target
  (completed→ready, cancelled→new). The order's timeline must show the
  reversal note honestly.

#### T-106 — Tampered carts bounce
- **Do:** (needs no hacking skill) leave a cart open in a tab overnight
  while prices change (or change a price in the back office mid-cart),
  then hit Place Order.
- **Expect:** a polite refusal telling the cart to refresh — the server
  reprices everything and never trusts the browser's totals.

#### T-107 — Over-limit online orders get flagged, not blocked
- **Do:** as a website guest, order over a statutory limit (e.g., 2 oz
  flower).
- **Expect:** the order is ACCEPTED as a reservation with a polite
  "we'll adjust at pickup" note, and it arrives in the back office
  FLAGGED. At pickup/completion, the hard gate refuses until the
  quantity is fixed. (Placement is soft; completion is hard — by
  design.)

#### T-108 — Completion is gated everywhere
- **Do:** try to complete (in the back office) an order containing a
  recalled item / outside sales hours / over-limit.
- **Expect:** refused each time with the reason. The same gate runs for
  admin completion, register pickup, and sync — there is no soft path.
- **FIXED (GW-028):** the 24-hour "reservation window" is now enforced —
  the daily cron auto-closes never-acknowledged orders as no-show with a
  timeline note. See T-174 for the full drill.

#### T-109 — No-show and cancel bookkeeping
- **Do:** mark one order no_show, cancel another (with reasons).
- **Expect:** both close cleanly; loyalty points reserved by those orders
  come back; neither appears in completed-sales reports.
- **⚠️ KNOWN-BROKEN (GW-015):** some internal dashboards currently count
  never-completed orders as revenue — that overstatement is a known open
  finding being fixed; the LCB-facing exports are on the correct basis.

---

<a id="phase-9"></a>
## Phase 9 — Inventory: intake, counts, dispositions *(Bible ch. 09)*

#### T-110 — Intake from the truck
- **Do:** Admin → Inventory → Intake. Stage a (test) vendor manifest;
  walk a lot through receiving.
- **Expect:** the lot sits in QUARANTINE until the activation gate passes
  (COA attached and not failed, required fields present). Only then does
  it go active/sellable.
- **This must NEVER happen:** a failed-COA lot reaching the sales floor.

#### T-111 — The same manifest can't intake twice
- **Do:** try to accept the same manifest again.
- **Expect:** deduped — refused or merged, never double stock.

#### T-112 — Price floor on onboarding
- **Do:** in product onboarding/drafts, try to approve a draft priced
  below the floor (≥ 2× cost is the owner setting).
- **Expect:** refused with the floor named.

#### T-113 — Cycle counts are blind and resume-safe
- **Do:** start a cycle count session; count a few products (enter
  honest-but-wrong numbers for one).
- **Expect:** the sheet never shows you the expected quantity while
  counting (blind). Apply the count: stock corrects, each applied line
  is latched — applying the session again must NOT double-apply.
- **Note (GW-012 fix, PR #636):** the variance posting now applies as an
  atomic delta, so a count landing at the same instant as a sale can no
  longer overwrite the sale's decrement (or vice versa).

#### T-114 — Every adjustment has a reason and a name
- **Do:** make a manual adjustment (damage, sample, etc.). Then open the
  product's ledger.
- **Expect:** the adjustment row shows quantity, reason, and who. The
  running math must reconcile: received + adjustments − sales = on hand.
  Any unexplained gap is a finding.

#### T-115 — Sales never write "adjustments"
- **Do:** after a test sale, check the adjustments ledger.
- **Expect:** NO adjustment row for the sale — sales decrement through
  their own path. A "sale" showing up as an adjustment means the
  two-ledger design broke.

#### T-116 — Vendor-sample caps
- **Do:** record vendor samples up to the cap for the quarter; try one
  more.
- **Expect:** hard-blocked before activation. (Sample acknowledgements
  are owner-gated — a mere admin shouldn't be able to bypass.)

#### T-117 — Destruction waiting period
- **Do:** schedule a destruction disposition.
- **Expect:** it cannot COMPLETE before the required hold window passes
  (the earliest-destroy date is enforced).

#### T-118 — Two hands on the same order (concurrency guards)
- **Why this exists:** GW-011/GW-012 (fixed in PR #636) found that two
  people completing the SAME order at the same instant could decrement
  inventory twice and pay loyalty points twice, and that two overlapping
  sales of the same product could silently lose a quantity update.
- **Do (needs two devices):** bring one order to "ready". On the laptop
  AND a second device, open it and click Complete as close to
  simultaneously as you can manage. Repeat a few times if the timing
  feels off.
- **Expect:** the order completes exactly ONCE. One click wins; the
  other either quietly agrees ("already completed") or refuses naming
  the current status — never an error page, never a second completion.
  Inventory moves by exactly the units sold (check the count) and the
  member earns points exactly once.
- **Also (after running migration 0129):** run the three review queries
  at the bottom of `supabase/migrations/0129_concurrency_guards.sql` in
  the Supabase SQL editor — A confirms the safety indexes exist, B must
  return zero double-earn rows, C must return zero negative lots.
- **Also:** try a manual stock reduction (disposition) LARGER than what's
  on hand — it must be refused naming the shortfall, and no adjustment
  row may be left behind. Stock can never go negative; the database now
  refuses it outright.

---

<a id="phase-10"></a>
## Phase 10 — Staffing & payroll *(Bible ch. 08 & 13)*

#### T-120 — Hire in the legal order
- **Do:** walk a fake hire through onboarding. Try to record the
  background check BEFORE the conditional offer.
- **Expect:** refused — RCW 49.94.010 ordering is enforced. Try to
  activate with critical onboarding tasks unchecked: refused.

#### T-121 — Termination is total
- **Do:** terminate the fake employee.
- **Expect:** they go inactive AND their PIN dies at the same moment —
  the register must refuse their PIN immediately. If their PIN still
  unlocks anything, photograph it: that's a security failure.

#### T-122 — Hour adjustments need reasons
- **Do:** as manager, edit a time punch.
- **Expect:** a reason (3+ chars) is mandatory; the punch's note keeps
  the history; an audit event exists for the edit.

#### T-123 — Payroll drafts, never money
- **Do:** run a payroll generation for a test period (with a source
  document attached).
- **Expect:** the output is a downloadable NACHA FILE only — the app
  never transmits money. Try generating with NO source document:
  hard-blocked, not overridable. Try paying the same employee twice in
  14 days: blocked. Bank account numbers must appear MASKED everywhere
  on screen.

#### T-124 — Who can see banking
- **Do:** as a manager (not admin/owner), try to reach employee banking
  or payroll pages.
- **Expect:** refused — payroll requires settings-level permission;
  banking columns have exactly one read path.
- **✅ GW-019 + GW-020 FIXED (PR #638):** "one read path" is now enforced
  by the DATABASE, not just the app. Migration `0130` (run it, then run
  its five review queries A–E — all must come back healthy) makes the
  roster manager+-read with NO direct write path, hides the PIN hash and
  all three bank columns from every login's API token (column privileges),
  arms a database-level audit trigger on the roster (redacted snapshots —
  values never logged, changed sensitive column NAMES are), makes
  `audit_logs` admin-read and append-only even against the service key,
  and closes the four RLS-less tables GW-019 found (glassware costs,
  inventory counts, SKU counters). A CI tripwire
  (`tests/compliance/rls-coverage.test.ts`) now fails any future PR that
  creates a table without RLS.
- **Also:** after running migration 0130, sign in as a low-privilege test
  account and confirm the staffing pages still load through the app while
  the account can no longer see other employees' data anywhere.

---

<a id="phase-11"></a>
## Phase 11 — Reports & CCRS compliance *(Bible ch. 10 & 11)*

#### T-130 — The day report (X/Z) at close
- **Do:** at day's end (after your test sales), run the register day
  report with a manager PIN.
- **Expect:** sales totals match what you rang, in Pacific time. Only
  PROCESSED sales are summed as money (anything pending/exception is
  counted separately, never added to cash). The slip must not pop the
  drawer.

#### T-131 — Blind close reconciliation
- **Do:** in the back office, reconcile the drawer you blind-closed in
  T-027/today.
- **Expect:** over/short is revealed HERE, for the first time, to the
  manager. The register never saw it.

#### T-132 — Screen and export agree
- **Do:** open Reports → Sales for today. Export CSV/XLSX. Compare 5
  numbers.
- **Expect:** identical. An export that disagrees with its screen is a
  finding.

#### T-133 — Midnight is Pacific midnight
- **Do:** if any test sale happened after 4–5 pm Pacific, check it lands
  on TODAY's report, not tomorrow's.
- **Expect:** all day-bucketing is Pacific. (The UTC-vs-Pacific class of
  bug is the most common in this system's history — evening sales are
  where it shows.)
- **Note (GW-013 fix, PR #637):** the LIQ-1295 excise return's month
  window — the last UTC holdout among the filing artifacts — now uses
  Pacific month bounds too, and the excise page's "previous month"
  default follows the store's clock instead of UTC.

#### T-134 — The LIQ-1295 excise return
- **Do:** generate the excise return for a month with test data.
- **Expect:** the math to review with your accountant.
- **✅ GW-013 + GW-014 FIXED (PR #637):** the month window is now the
  PACIFIC calendar month (a sale rung at 9 PM on the month's last day
  stays in that month's return — previously it slid into the next one),
  and Box 1 now sums ONLY cannabis lines at their pre-tax value (a
  t-shirt or lighter on a receipt no longer inflates the 37% excise).
  Verify: ring a mixed sale (one cannabis item + one merch item),
  generate the return, and confirm (a) Box 1 shows only the cannabis
  item's pre-tax amount, (b) the page notes the excluded non-cannabis
  dollars, and (c) Box 1 matches the WA tax report's "cannabis base"
  for the same month to the cent — that's the cross-check an auditor
  runs.

#### T-135 — CCRS CSV generation
- **Do:** Admin → Compliance → CCRS. Generate the Sale CSV for your
  test-sale date range.
- **Expect:** the export gate validates BEFORE download — malformed rows
  block the file with named errors. Spot-check: row count matches the
  file's own header count; no negative money; every lot's CCRS
  identifier is the same one it had at intake.
- **✅ GW-010 FIXED:** the export previously overstated tax on cannabis
  lines (~46%) by taxing the tax-inclusive stored price. All compliance
  and accounting consumers now derive the pre-tax line base through the
  shared `tax-base-core.ts` back-out (verify: a $10.00 cannabis line
  must report SalesTax $0.64 and OtherTax $2.53, and UnitPrice must be
  the PRE-TAX shelf price). Safe to proceed to T-136.

#### T-136 — The real CCRS round-trip (after GW-010 is fixed)
- **Do:** exactly per `OWNER-TASKLIST.md` §7: ring a handful of tiny real
  sales → generate the Sale CSV → log into CCRS with your SAW account →
  upload with a clear filename → watch the Processing Status (PST) for
  that file.
- **Expect:** the file processes clean. If rows reject, save the PST
  error text word-for-word into a Bug Card — the row-level reasons tell
  us exactly which column to fix.

#### T-137 — The weekly cadence never slips
- **Do:** check Admin → Compliance → calendar/weeks around a reporting
  deadline.
- **Expect:** completed weeks older than the lookback either show
  submitted / nothing-to-report, or they NAG daily. A week must never
  be resolvable while still in progress.

#### T-138 — Returns file corrections
- **Do:** after the T-070 return, check the CCRS corrections queue.
- **Expect:** the return generated a pending correction row; a full-line
  return files a Delete (not an Update); exporting it flips its status
  so it can never export twice.

---

<a id="phase-12"></a>
## Phase 12 — BREAK-IT DAY: stress, chaos & edge cases

*Today you are the villain. Everything in this phase is an attempt to
cheat, confuse, overload, or damage the system. Nothing here can hurt
anything permanently (you're on test data) — be ruthless. Log every
attempt, even the ones the system wins.*

### 12.1 The thief

- **T-140:** try 5 fast wrong PINs → lockout (re-verify under pressure).
  Then try the SAME wrong-PIN storm on the till screen and the manager-
  approve screen — the throttle is shared per device; all surfaces must
  lock together.
- **T-141:** grab the iPad mid-someone-else's-session (simulate): walk
  away with it unlocked; confirm the 2-minute idle lock strands the
  thief.
- **T-142:** as budtender, hunt for money: try every path to see
  expected drawer cash before a blind close. You must never find it on
  the register.
- **T-143:** try to sell to your 19-year-old test identity through every
  door: scan path, manual path, over-40 path, website pickup, resumed
  held sale. Every door must refuse.
- **T-144:** open the browser's address bar on the back office as
  readonly/budtender and type URLs directly (`/admin/settings`,
  `/admin/payroll`, `/admin/users`) — routes must bounce you, not just
  hide their links.

### 12.2 The clumsy employee

- **T-145 (double-tap everything):** on every confirm button you meet
  today — Pay, Complete, Void, Apply count, Publish — tap TWICE, fast.
  Nothing may happen twice: no double sale, no double refund, no double
  count application, no two menu versions.
- **T-146 (mid-action abandonment):** start a sale to the tender screen
  and just… walk away. Idle lock parks it. Resume: everything intact.
  Then abandon a return halfway, an intake halfway, a cycle count
  halfway — resume each; nothing should be half-applied.
- **T-147 (the fat-finger cart):** quantity 999 of something. The limit
  wall must catch cannabis; for non-cannabis, totals must stay sane and
  nothing overflows.
- **T-148 (paste garbage):** into every search box you meet: a very long
  string (hold a key), emojis 🌿🔥, quotes `"';--`, angle brackets
  `<b>hi</b>`. Expect: sane behavior, no crash, no weird page
  distortion, and definitely no error page with code in it.
  (Two search boxes had an injection-shaped finding — GW-021 — verify
  its fix here.)

### 12.3 The awful network

- **T-149 (the dead spot):** Wi-Fi off mid-TENDER (after Pay is
  pressed). The sale must either complete into the queue or fail loudly
  — never a mystery state. Check the back office later: exactly one or
  exactly zero copies, matching what the register told you.
- **T-150 (the flap storm):** toggle Wi-Fi every 10 seconds for 5
  straight minutes while ringing 3 sales. All 3 sync exactly once.
- **T-151 (the long outage):** Wi-Fi off; ring 10 sales over 30 minutes;
  keep an eye on the queue counter growing; then reconnect. All 10
  drain, exactly once each, in order.
- **T-152 (offline + restart):** Wi-Fi off, ring 2 sales, KILL the app,
  reopen (still offline). The queue must survive the restart (it's
  persisted). Reconnect: both sync.
- **T-153 (printer dead):** unplug the printer, complete a sale. The
  sale must complete fine (printing is queued, never blocking). Plug
  the printer back in: queued receipts print.
  **⚠️ KNOWN-EDGE (GW-026):** a job that can NEVER print currently
  retries forever — if the print queue looks stuck on one job, that's
  the known finding.

### 12.4 The time traveler

- **T-154:** iPad clock 10 minutes fast → sale → exception queue (rerun
  of T-065, now under load with other events queued).
- **T-155:** ring a sale at 11:58 pm Pacific and another at 12:02 am
  (or simulate near your configured closing time). Each must land on
  its correct Pacific day and respect sales hours.
- **T-156:** park a sale at 11:50 pm, resume after midnight. The resumed
  sale must re-validate against the NEW day (ID still valid today, card
  still valid today).

### 12.5 The volume day (stress)

- **T-157 (the rush):** with 2 people and 2 registers (or one register
  and the back office completing pickups), run 20 sales in 30 minutes
  mixed with 2 returns, 1 void, 2 pickups, 1 recall-hold flip. Then
  reconcile: order count, inventory spot-checks on 3 products, drawer
  math, loyalty balances. Everything must add up to the penny.
- **T-158 (the big lists):** seed enough test orders/customers to pass
  200 orders and 500 customers.
  **⚠️ KNOWN-BROKEN (GW-033):** lists currently truncate silently at
  200–500 rows — until the fix lands, confirm the LIMITATION (oldest
  rows missing with no notice); after the fix, confirm the "Showing X
  of Y" line and pagination.
- **T-159 (the giant import):** import your largest realistic Cultivera
  export / vendor menu. Time it. Note anything over ~60 seconds, any
  timeout, any partial import (partials are worse than failures — count
  the products).

### 12.6 The auditor

- **T-160:** pick 3 random actions you took today (a void, a role
  change, a price override) and find each in the audit/activity log
  within 2 minutes. If you can't find one, that's a finding — the LCB
  version of this test is not optional.
- **T-161:** pick one product and manually reconcile its whole day:
  starting stock + received − sold − adjusted = ending stock. To the
  unit.
- **T-162:** pick one register drawer and reconcile its whole day: float
  + cash sales − drops − refunds = counted close. To the penny.

### 12.7 The queue worker (added with the GW-029 back-link fix)

- **T-163 (filters survive the round trip):** in the back office, go to
  Orders and set a status filter plus a search term (e.g. status "New",
  search "sarah"). Open any order from the filtered list, then click
  "Back to orders". **Expect:** the list comes back with your filter AND
  search still applied — the address bar shows them. Repeat the same
  round trip on Products (pick a category filter), Vendors (any filter →
  "Combine duplicates" → "← All vendors"), Menu imports (open a version →
  back), and Product Discovery (set a category → "Import leads (CSV)" →
  back). **Also expect:** after an action that shows a green "Saved." or
  similar banner, going back must NOT re-show the stale banner. If any
  page loses your filters or resurrects an old banner, that's a finding.

### 12.8 The brand inspector (added with the GW-030 button sweep)

- **T-164 (every button speaks the brand language):** walk five back-office
  pages of your choice — a good spread is Orders (open one order), a product
  detail page, a vendor detail page, Users & roles, and the Knowledge Base
  harvest settings page. On each page look at every button and check it
  against the button grammar: real action buttons are **pill-shaped** with
  **bold uppercase-style labels** and **black ink on a solid brand color**
  (orange = the page's main action, green = confirm/publish, gold = save
  a draft, red = destructive, **purple = the machine does something for
  you** — AI drafts, the crawler, GrowFlow sync, "Ask/Analyze/Suggest/
  Generate" buttons), while quiet secondary actions are subtle outlined
  chips. Small in-row/in-table actions (like "★ Set as logo" or a row's
  "Save") may be compact chips instead of full pills — that's correct.
  **Red flags to report:** a button with white text sitting on solid green
  or gold (unreadable in bright light), a sky-blue or pink button (retired
  colors), an AI/automation button that is NOT purple, two buttons on the
  same page doing the same kind of job but dressed differently, or a raw
  square-cornered button that clearly ignores the house style. **Exempt:**
  the top navigation bar's chips (nav chrome, not actions), text-only
  links, pin pads, calendar cells, and on/off toggles. If every page
  passes, this test passes; any red flag is a finding with a screenshot.
- **T-165 (the bright-light readability check):** do this one in the worst
  lighting you have — the front counter at midday, or turn your screen
  brightness to max. Visit the Medical hub, the Integrations page, a
  customer's medical panel, Inventory → Drafts (click a status pill), and
  Inventory → Intake (look at the PDF file-picker button). **Expect:**
  every green (and gold) button or pill shows BLACK text you can read at
  arm's length without squinting. **Red flag:** any white text sitting on
  a solid green or gold fill — that combination measures 1.76:1 contrast,
  far below the 4.5:1 a human needs, and it is exactly the "washed out in
  bright light" problem this test exists to catch. Also spot-check any
  page you use daily: if a button label disappears when the sun hits your
  screen, report the page and button as a finding with a photo.
- **T-166 (weird characters in every search box):** type `50%,off` into
  each of these back-office search boxes: Equipment, Loyalty signups,
  Customers, Inventory lots, Non-cannabis products, Vendors, the Medical
  product registry, and the Returns "find the original sale" lookup.
  **Expect:** every one calmly returns "no results" (or only items whose
  name literally contains that text) — no error message, no page crash,
  and definitely not a list that suddenly shows EVERYTHING. Then search
  Customers for a real name that contains an apostrophe (like O'Neil) and
  confirm it still finds them. **Red flag:** any search box that errors,
  or that treats `%` or `_` as a "match anything" wildcard instead of the
  literal character you typed.
- **T-167 (printer token still guards the door):** with your receipt
  printer working normally, go to Admin → Equipment → Receipt printer and
  confirm the poll token is set. Print a test receipt — it should print
  exactly as before (the security change is invisible when the token
  matches). Then, from a browser, visit your site's `/api/cloudprnt`
  address with no token: **expect** an "unauthorized" answer, not a
  receipt payload. **Red flag:** printing stopped working after this
  update, or the endpoint answers without a valid token.
- **T-168 (the evening medical sale stays on today's ledger):** this one
  matters most in the evening — any time after 5 PM works. Ring a
  test-mode exempt medical sale (T-084 style) after 5 PM, then check the
  medical ledger (Admin → Medical). **Expect:** the ledger row is stamped
  with TODAY'S date, not tomorrow's. Also check a card that expires
  today: it must still be honored for the whole business evening, and
  refused starting tomorrow morning. **Red flag:** an evening sale dated
  tomorrow, or a card expiring today refused at 6 PM. (Migration `0131`
  is the database-side backstop for this — run it if you haven't.)
- **T-169 (the purchase-limit numbers didn't move):** in the back office
  open the purchase-limits display (and the public limits page if you
  use it). **Expect:** the same numbers as before this update —
  recreational 1 oz / 28 g usable, 7 g concentrate; medical 3 oz usable
  (displayed as 3 oz), 21 g concentrate. Then at a register, confirm a
  cart at exactly the recreational flower limit still completes and one
  gram over still refuses. **Red flag:** any limit number changed —
  this update only NAMED the conversion constants, it must not have
  changed a single enforced or displayed value.
- **T-170 (the poison receipt gives up instead of jamming the queue):**
  with the printer set up (T-007), unplug its Ethernet cable, then queue a
  test print AND place one online order (so two jobs stack up). Plug the
  printer back in but immediately open its lid so every print attempt
  errors. Wait ~10–12 minutes (the queue retries a stuck job every 2
  minutes, up to 5 tries). **Expect:** Equipment \u2192 Receipt Printer shows
  the stuck job flip to a red **failed** badge with a plain-English note
  ("Gave up after 5 print attempts\u2026"), the **Failed** stat card lights
  up, Live diagnostics flags it — and the NEXT job behind it prints once
  you close the lid. **Red flag:** the same job retrying forever while
  everything behind it waits.
- **T-171 (a failed receipt can be revived):** continuing from T-170, fix
  the printer (lid closed, paper in), then press **Re-queue** on the
  failed job. **Expect:** it flips back to queued with a fresh attempt
  counter and prints within a few polls; the audit log records who
  re-queued it. Press **Cancel** on a different failed job and confirm it
  flips to cancelled instead. **Red flag:** Re-queue does nothing, or it
  resurrects a job that had already printed or been cancelled.
- **T-172 (a no-show never counts as money):** place a website test order,
  let it sit (or mark it **No-show** from Admin → Orders), then open the
  Reports overview, Sales, COGS, and Customers tabs for today.
  **Expect:** that order appears in the order-status counts (it happened)
  but contributes $0 to gross revenue, AOV, COGS revenue, and customer
  spend — the gross tile now reads "Gross (completed orders)". Complete a
  different test order and confirm THAT one shows up in revenue
  immediately. **Red flag:** the no-show's total included in any revenue
  figure, or the dashboard gross disagreeing with the Tax tab's completed
  basis by more than the day-boundary difference.
- **T-173 (the back office knows about rejected rows):** rejected rows are
  hard to trigger honestly (see T-064) — so test the plumbing with the
  status copy and the admin panels. On the register, the queue line in the
  status bar must read "N rejected — kept on this register; back office has
  been notified" whenever the red banner is up. Within about 15 seconds of
  the next sync, open Admin → Register Activity: a "Rejected events on
  registers" card must appear naming the device, the count, and a short
  note about the oldest row; the POS devices page must show the same
  red panel on that device. Review and clear the rows at the register,
  then confirm the card disappears after the next sync. **Red flag:** the
  register claims the back office was notified but no card ever appears,
  or a stale card lingers after the device reports zero.
- **T-174 (an abandoned website order closes itself after 24 hours):**
  place a website test order and do NOT touch it in the back office (it
  must stay at "new" — do not acknowledge it). To avoid waiting a day,
  shrink its window in the Supabase SQL editor:
  `update orders set reservation_expires_at = now() - interval '1 minute'
  where order_number = 'GWY-...';` then trigger the daily cron (Admin →
  Command Center "run reminders now", or wait for the 8–9am Pacific run).
  **Expect:** the order flips to **No-show** by itself; its timeline shows
  a status change by "system — reservation window sweep" with a note
  naming the 24-hour window; any loyalty code it consumed is returned;
  revenue reports ignore it (T-172). Now acknowledge a DIFFERENT test
  order, shrink its window the same way, run the cron again, and confirm
  it is NOT touched — the sweep only closes orders nobody has claimed.
  **Red flag:** an acknowledged/preparing/ready order auto-closing, stock
  levels changing when the sweep runs, or the no-show missing its
  plain-English timeline note.
- **T-175 (no dropdown list is ever white-on-white):** open each of these
  and pop the dropdown open — the option list must show dark rows with
  readable light text (or, on the light register theme, white rows with
  dark text). Check: the public menu’s SORT BY control, Admin → Media
  upload “Why / purpose”, Admin → Knowledge Base → FAQs category, Admin
  → Reports → Excise month/year, Admin → Payroll account type, and the
  register’s ID-type list on Start Sale (both dark and light themes).
  **Expect:** every option row is readable at a glance without hovering.
  **Red flag:** a white popup where the rows only become readable when
  the mouse highlights them blue — that is the exact bug this test
  guards against.
- **T-176 (the selected filter is unmissable and secondary buttons look
  clickable):** open Admin → Orders, Loyalty Signups, Reports, and
  Reports → Forecast. Click through the filter chips (status, range,
  horizon) and the report tabs. **Expect:** the ACTIVE chip/tab is a
  solid green (gold on Forecast) pill with black text — readable from
  across the room; inactive chips stay muted. Then look at any
  secondary/back/cancel button and the small row-action chips in tables:
  they carry a soft orange or gold tint with a colored ring, and turn
  solid on hover — nothing looks like a flat grey patch of the page.
  **Red flag:** an active filter you have to squint at to find, or a
  button you only discover by mousing over it.
- **T-177 (one color knob moves the whole back office):** this is a
  spot-check that the brand colors live in ONE place. In the deployed
  app, open Admin → Reports, Vendors, Staffing, Promotions, and the
  error screen (visit a bogus admin URL) — every green/gold/orange
  accent should look identical across pages. For the strong version of
  the test (a developer drill): change `--greenway` in `globals.css`
  `:root` to a test color, rebuild, and confirm buttons, chips, meters,
  and badges ALL move together — only the report charts keep their own
  matched copy (documented in `charts/theme.ts`). Revert afterwards.
  **Red flag:** any button or badge that keeps the OLD green after the
  knob turns — that means a hard-coded hex crept back in.
- **T-178 (long lists page instead of silently clipping):** open Admin →
  Orders, Inventory, and Customers. Under the filters on each page you
  should see an exact count line — "Showing 1–100 of N orders" (or
  "Showing all N" when everything fits on one page). If the store has
  more than 100 rows, Prev/Next pager buttons appear (top and bottom);
  click Next and confirm the URL gains `?page=2`, the count line updates
  to "Showing 101–200 of N", and the browser Back button returns to page
  1. Change a status filter or run a search while on page 2 — the list
  must reset to page 1 of the new results, never a blank screen. Then
  hand-edit the URL to an absurd page (`?page=999`) — the page must show
  the real last page of rows, not an empty table. **Expect:** you can
  reach EVERY order, lot, and customer by paging, and the count line
  always tells the truth. **Red flag:** a list that ends at a few
  hundred rows with no count and no pager — records past the cutoff
  would be invisible, which is the exact bug this test guards against.
- **T-179 (filters combine and the URL tells the truth):** open Admin →
  Orders. Set a date range, a total range (e.g. min 20, max 100), pick a
  sort like "Total: high → low", click a status chip, and hit Apply —
  ALL filters must apply together (an order outside any one of them
  disappears), the sort order must visibly change, and clicking a status
  chip must KEEP your date/total/sort choices. Copy the URL into a new
  tab: the exact same filtered view must load. Repeat on Inventory (COA
  / sample / medical dropdowns, expiry window, sort by expiring soonest)
  and Customers (medical / consent / do-not-contact dropdowns, sort by
  lifetime spend). Then try to break it: type garbage in a date box,
  paste `?sort=DROP%20TABLE` into the URL — the page must load normally
  with that knob simply off, never an error screen. Finally, click Clear
  — everything resets, and the pager still works on the filtered view
  (filter first, then page; the count line reflects the FILTERED total).
  **Expect:** total control — every knob combinable, shareable by URL,
  and impossible to crash. **Red flag:** a filter that quietly ignores
  another filter, a chip click that drops your date range, or garbage
  input producing an error page.
- **T-180 (special discounts — admin-only dials, and the rules hold):**
  sign in as ADMIN and open Admin → Settings → Special discounts (the
  card sits in the Store group; it must NOT appear anywhere on the
  Promotions page — these are person-based courtesy discounts, not
  promotions). You should see three programs with your starting rates:
  Employee 35% on, Veterans 15% on, Industry off at 0%. Change the
  veteran rate to 12.5 and Save — the green banner must echo "12.5%"
  and the card badge must update. Now try to break it: enter 101, then
  -5, then "abc" as a percent — each must be politely refused with a
  plain-English error and NOTHING saved (reload to confirm the old rate
  survives). Sign in as a MANAGER (not admin) and paste the page URL —
  you must be turned away, not shown the dials. **Expect:** only
  owner/admin can see or change the rates, every save lands in the audit
  log, and a discount can never make cannabis free (at least 1¢ always
  remains). **Red flag:** a special-discount control visible on the
  Promotions page, a manager reaching the dials, or a garbage percent
  slipping through.

- **T-181 (special discounts at the register — the money and the safety rules):**
  refresh a register's menu (Sync now, or re-unlock while online) so it
  picks up the discount programs, then ring three test sales. FIRST —
  veteran: add an item, tap Veteran discount in the checkout rail; the
  Apply button must stay dead until you tick "I checked a military ID".
  Apply it and watch a separate "Veteran discount (15%)" line reduce the
  TOTAL; now change the item's quantity — the discount must silently
  drop (re-apply it on the fixed cart; a stale discount must never
  survive a cart change). SECOND — industry: the Apply button must stay
  dead until a company name is typed; after the sale syncs, the company
  must appear on the recorded use. THIRD — employee, the strict one: the
  buying employee enters their OWN PIN first; if it's the PIN of the
  cashier logged into THIS register the panel must refuse with "ring it
  on another register". Then a SECOND employee witnesses with their PIN
  — typing the buyer's PIN again must be refused ("someone OTHER than
  the buyer"). With a real buyer + witness pair the 35% comes off and
  the sale tenders normally. **Expect:** the sync completes all three
  sales, each writes one row in the use ledger (who gave it, who got it,
  cents saved) plus an audit entry, and heavily-promoted items discount
  LESS (legal price floors always win — an item can never sell below
  cost or for free). **Red flag:** a discount surviving a cart change,
  an employee self-witnessing or buying on their own register, applying
  a loyalty redemption AND a special discount to the same sale, or a
  synced sale with no ledger row.

- **T-182 (the special-discounts report — who, to whom, how often):**
  after running T-181's three test sales (and letting them sync), open
  Reports → Special Discounts and set the date range to today. The
  headline cards must count all three uses and total the exact cents
  given away. Check each question: WHO — the "Who gives them" chart and
  Cashier detail table must show the cashier(s) who rang the sales; TO
  WHOM — the buying employee must appear under "who bought", the witness
  under "who approved", and the industry visitor's company in the
  companies table (type the company differently-cased on a second sale —
  "ACME FARMS" and "Acme Farms" must roll up to ONE row); HOW OFTEN —
  today's bar appears in the per-day chart and every sale is listed
  newest-first under Recent uses with register, approver, and cents
  saved. Download both CSV and Excel and confirm the same numbers. Then
  the doors: sign in as a MANAGER — the report must open (managers may
  READ); the link at the bottom back to Settings → Special discounts
  must still turn a manager away. **Expect:** every number on the page
  traces to a ledger row from T-181 — nothing invented, nothing missing,
  and the export matches the screen to the cent. **Red flag:** a use
  missing from the report, the same company split across two rows over
  casing, sums that disagree with the receipts, or a date window that
  drops a sale rung late in the evening (days must bucket in Pacific
  time, not UTC).

- **T-183 (tips in the end-of-shift count-out — employee money, never drawer math):**
  first make sure migration `0134_drawer_tips.sql` has been run. On the
  register iPad, open a drawer with a known float, ring one small cash
  sale, then choose Close drawer (blind count). The close screen must
  now show a “Tips (counted separately)” box under the denomination
  grid with guidance that the tip jar is the cashier's own money and
  must stay OUT of the drawer count. Count the drawer honestly, type
  42.50 in the tips box, enter your PIN, and close — the confirmation
  must mention $42.50 in tips, and the screen must still never show the
  expected amount (the count stays blind). In the back office, the
  reconcile card on Register Activity must show “$42.50 tips at close”
  marked as employee money, and reconciling with the true cash sales
  must come out BALANCED — the tips must not move expected close or
  over/short by a cent. Cash drawer reports must show a Tips column
  with $42.50 on that session, a dash on old sessions from before this
  feature, and a “Tips at close” card totaling across sessions. Now the
  edges: close another drawer typing 0 in the tips box (must record
  $0.00, not a dash), close a third leaving the box blank (must show a
  dash — not recorded), and try garbage like “abc” or a negative — the
  close button must refuse until the box is fixed or cleared.
  **Expect:** tips ride along with the blind close for visibility only;
  drawer math is identical with or without them. **Red flag:** tips
  changing expected/over-short, a blank box blocking the close, “0”
  and “blank” collapsing into the same thing, or the close screen
  revealing expected cash.

- **T-184 (the store safe — $1,000 target, twice-daily counts, change swaps):**
  first make sure migration `0135_safe_counts_swaps.sql` has been run. In
  the back office, open Register Activity and click the new Safe
  button. The safe page must show the $1,000.00 target, AM and PM
  “Today's count” cards, an open counting grid whose variance against
  the target updates live as you type, and tables of recent counts and
  recent change swaps. Count exactly $1,000.00 as the AM window — the
  banner must say balanced and the AM card must flip to Done. Count
  $980.00 as the PM window — the banner must say short by $20.00 and
  the table row must show the variance in red. Now the register side:
  on the iPad with a drawer open, choose Change swap (it appears in
  both the More menu and the drawer panel), enter $100.00, your PIN,
  and a manager or lead's PIN in the approval box — the confirmation
  must say the swap was recorded, and the swap must appear on the safe
  page with both names. The drawer's expected close must NOT move — a
  swap is the same value both ways. Now the refusals: try approving a
  swap with a plain cashier's PIN (rejected — not a manager or lead),
  try using your own PIN as the approval (rejected — no self-approval),
  try $0 and garbage amounts (button stays off), and if migration 0135
  has not been run, the swap must refuse loudly with a message naming
  the migration — never silently skip. **Expect:** every trip into the
  safe leaves a PIN-attributed, manager-approved record, and the twice-
  daily counts keep the $1,000 fund honest. **Red flag:** a swap
  changing drawer expected cash, a cashier approving their own swap, a
  swap recording without the safe tables, or the safe count hiding the
  live variance (safe counts are open, not blind).

- **T-185 (printable physical records — till summary + end-of-day report):**
  in the back office, open Register Activity and click the new
  End-of-day report button (it is also on the Cash drawer reports
  page). The report must show the business day, a PRELIMINARY banner
  while any drawer is still open (flipping to FINAL once every drawer
  is closed), the store-wide sales summary from server-verified
  facts (sales count, subtotal, tax, gross, no-sales), a till table
  with one row per register that worked today (opening float, drops,
  blind close count, over/short, tips) plus a store-total row, and a
  safe section (AM/PM counts with variances, change swap count and
  total). The blind rules must hold on paper too: over/short shows a
  dash until a manager has reconciled that session, and tips are
  labeled employee money. Click Print — the print preview must be
  crisp black-on-white with no admin chrome (no sidebar, no buttons)
  and must end with signature and date lines. Now the till summary:
  on Cash drawer reports, every session row must have a Till summary
  link opening a one-page sheet for that drawer — register, day,
  status, who opened/closed and when, opening float, each safe drop
  (time, window, who, witness, amount), the blind close count,
  expected close and over/short ONLY if the session has been
  reconciled, tips if recorded, and any change swaps with both names.
  Print it — same clean black-on-white sheet with signature lines.
  **Expect:** two printable physical records — a store-wide
  end-of-day summary and a per-drawer till sheet — that respect the
  blind-count discipline. **Red flag:** over/short printing for an
  unreconciled session, tips mixed into drawer math, admin chrome on
  the printed page, or an open drawer being reported as FINAL.

- **T-186 (receipt customization — one design, every print path):**
  in the back office open Admin → Registers → Receipt design. Change
  the header to a test name, put three lines in the address block
  (street, phone, license number), add a recognizable word to the end
  of the footer AFTER the intoxicating-effects warning, and watch the
  live preview update as you type — the preview runs the identical
  receipt builder the register hands to the Star printer, so what you
  see is what prints. Save, then flip each of the three toggles off
  one at a time and confirm the preview drops exactly that line: the
  Served-by line, the You-saved line, and the loyalty points block.
  Turn them back on and save. On a register, refresh the menu (or
  just wait for the next automatic refresh) and ring a small sale
  with a discounted item and a loyalty member attached — the paper
  receipt must show your new header, all three address lines, your
  footer word, Served by, You saved, and the points block. Now
  verify the design travels EVERYWHERE: print a refund receipt, a
  no-sale slip, and an X day report — each must carry the same
  header and address block. Ask for an email receipt — same design
  in the inbox. Finally try to save an empty header and an empty
  footer: both must quietly come back as the safe defaults (the
  store name and the compliance warning) — the warning text can
  never be blanked away. **Expect:** one owner-designed receipt that
  shows up identically on the preview, the paper sale receipt, the
  refund receipt, the no-sale slip, the day-report slip, and the
  email copy — with the compliance footer impossible to remove.
  **Red flag:** preview and paper differing, a toggle that does
  nothing, a print path still showing the old design after a menu
  refresh, or a blank footer saving without the warning.

- **T-187 (flow furniture — pinned save bars and friendly confirms):**
  open a long editor and scroll: the vendor profile, an employee
  file, a promotion, a blog post, and an intake review. On each, the
  main action (Save profile / Save basics / the promotion save /
  Save changes / Finalize intake) must ride along in a pinned bar at
  the bottom of the screen with a small status note — you should
  never have to scroll to find the button. The purchase-order
  builder already has its own pinned order bar with the running
  total — confirm it still works. Then the confirms: try deleting
  a homepage section, a carousel slide, and an FAQ Q&A; retiring a
  loyalty tier; removing a scheduled shift; and deleting a
  marketing idea. Every one must open a styled in-app dialog that
  explains the consequence in plain language with an obvious Cancel
  — never the browser's grey popup. Cancel each one first and
  confirm nothing happened, then confirm one for real and check it
  worked. Finally the big one: in Settings, set the cannabis excise
  to anything other than 37% and save — the dialog must warn you
  about RCW 69.50.535 and refuse until you type CONFIRM.
  **Expect:** save buttons always in reach on long forms, and every
  destructive click challenged by a friendly dialog — with a typed
  gate on the excise-rate deviation. **Red flag:** a browser-native
  confirm popup anywhere in the admin, a long form whose save
  button scrolls away, or the excise deviation saving without the
  typed CONFIRM.
- **T-188 (your own visual walk — does it all LOOK right?):** with real
  data loaded, walk the whole system with your eyes only — no clicking
  through tasks, just looking. Public site first on a laptop: home,
  menu, specials, about, locations, loyalty, medical, blog, FAQ,
  vendor page, checkout, and the three policy pages. Then the back
  office: the dashboard, one list page and one editor from each area
  you use daily (catalog, inventory, purchasing, promotions, staffing,
  reports, settings), and finally the register. On every screen ask
  three questions: is anything unreadable (light text on light, dark
  on dark, text overflowing its box)? is anything misaligned or
  overlapping (buttons off the edge, cards of wildly different
  heights, a table spilling out of its card)? and does it still look
  like YOUR store (black canvas, Greenway green, gold and orange —
  nothing suddenly white or off-brand)? A companion automated pass of
  every public page plus a token-accurate sheet of all the admin
  furniture is recorded in `docs/audit/VISUAL-SIGNOFF.md` — your walk
  covers the data-filled admin screens that pass could not reach.
  **Expect:** every screen readable, aligned, and on-brand; the
  sign-off doc matches what you see. **Red flag:** unreadable text
  anywhere, overlapping or clipped controls, a native-white control
  breaking the dark theme, or any screen that makes you squint.

- **T-189 (store-favorable discounts — the deal never favors the
  priciest item):** on a Sunday (or with the Sunday seed active in the
  simulator), build a cart of three items priced roughly $150, $20 and
  $15. The 3-for-2 deal must save AT MOST the price of the cheapest
  item (about $15), spread as the same percent across all three lines
  — the $150 item must never carry a bigger percent than the others.
  Then switch to Saturday: in the same cart the 30% headline must land
  on the CHEAPEST item and everything else gets 15% — never 30% off
  the $150 item. Now attach a loyalty member with the 25% tier: on any
  line where the daily deal saved less than 25%, the price should drop
  to exactly 25% off the regular price (replaced, not added); on any
  line where the deal already saved 30%, the price must NOT change.
  Finally, set one item's cost close to its price and confirm the
  discounted price refuses to fall below the cost floor. **Expect:**
  savings capped by the cheapest item on Sunday; Saturday headline on
  the cheapest line; loyalty replaces smaller deals and never stacks;
  no price ever below cost. **Red flag:** the priciest item getting
  the biggest percent, combined loyalty-plus-deal savings exceeding
  the better of the two, or any unit priced below its cost floor.

- **T-190 (employee handbook — read it and check the box before any access):** sign in to the back office as a NON-owner staff account that has not yet acknowledged handbook version 2.0. **Expect:** every admin page is replaced by the full handbook with an acknowledgment form at the bottom — you cannot reach the dashboard, products, or any other page until you type your full name, check the “I have read … and agree” box, and submit; after submitting, the back office opens normally and the roster (Employees → Roster) shows a green “handbook v2.0 ✓” badge on your row. At the register, try a PIN unlock for an employee who has NOT acknowledged (no digital acknowledgment and the paper handbook not marked “signed” in their employee file): the unlock must be refused with a message explaining the handbook requirement. Mark their paper handbook “Read & signed” in the employee file and try again — the unlock now succeeds. Sign in as the OWNER with no acknowledgment recorded: the owner is never blocked. **Red flag:** any admin page reachable before the box is checked, a register unlocking for an unacknowledged employee, the checkbox recording without a typed name, or the owner getting locked out.
- **T-191 (regulatory watch — rule-change radar with AI briefings):** open CCRS — the command center — and click the “Regulatory Watch” header link (or press ⌘K/Ctrl+K and search “Regulatory Watch”). **Expect:** a dedicated page with a pulse row (new bulletins, open comment windows, upcoming deadlines, open roadmap tasks), a deadline timeline, a bulletin inbox, a roadmap board, and a manual intake section. Click “Check now”: the page polls the LCB’s GovDelivery bulletin feed and any new bulletins appear in the inbox with a stage badge (preproposal, proposed, adopted, EMERGENCY) and official WAC/RCW citation links that open the legislature’s site. In manual intake, paste the text of a real LCB bulletin that mentions a WAC section and a comment deadline, then submit: the item appears with its citations and the deadline shows on the timeline. If AI is configured, click “Analyze” on an item: a plain-English briefing appears with impact, affected areas of the store, strategy, and proposed roadmap tasks; accept a task and move it through Start — Done. **Red flag:** a citation link that goes anywhere other than app.leg.wa.gov, a deadline on the timeline that never appears in the bulletin text, an AI briefing inventing WAC sections not present in the item, the page crashing when migration 0137 has not been applied (it must show a friendly setup notice instead), or any button changing store settings automatically — the page is advisory only.
- **T-192 (product enrichment — powerhouse command center):** open Back Office → Product Intake → Product Enrichment. **Expect:** the worklist now has an enrichment-status filter (never enriched / draft / published / archived), an “Any gap” filter, and a sort control that defaults to “most gaps first” so the most broken products lead the list. Open a product that is missing an image. **Expect:** an “On the menu right now” card showing exactly what the public menu renders for this product (its own photo, a labeled fallback image with its ladder source, or a note that a generic mockup shows), a numbered “How to finish enriching this product” checklist (harvest the vendor menu, ask the brand rep, photograph in store, use the approved fallback, draft an AI description), and a “Knowledge base” panel labeled with which KB rung matched (kb-exact, kb-draft, enrichment, strain, or no match). When the KB, media library, or a saved Cultivera/GrowFlow vendor menu holds a plausible match, a “Suggested matches” section lists each candidate with a percent score and the plain-English reasons it matched (name-word overlap, brand agreement); click “Use image” / “Attach image” / “Import image” / “Use description” and the asset or text lands on the enrichment draft after one click. **Red flag:** any suggestion applying itself without a click, a “Use description” apply going through with copy that makes a medical claim (the compliance gate must refuse it), a suggested match with no reasons shown, the editor overriding POS price or stock, or the page crashing when the vendor-menu tables or KB tables are not yet migrated — every panel must simply show its empty state.

- **T-193 (connectivity audit — review flags, AI mechanics drafter, help coverage):** open Back Office → Product Intake → Receiving and open a staged (pending) manifest. **Expect:** a “Review flags” panel below the intake checklist listing per-line compliance flags — a missing vendor license or a FAILED lab result shows as a red Blocker; a missing lot code, missing COA, sample line, or zero quantity shows as Confirm; a missing unit cost shows as a Note. A fully clean manifest shows NO panel at all. Next, open Promotions → New promotion, pick a discount type (e.g. Multi-item tier), and open “Draft the mechanics with AI” in the Mechanics section. Type “buy 2 get 15% off, 4 or more get 25%” and click Draft it. **Expect:** a draft recap listing the tiers in plain English; clicking “Use it” fills the tier inputs below (buy 2 → 15, buy 4 → 25) and saves NOTHING until you submit the form. Finally, open Help & FAQ. **Expect:** entries now exist for Employee samples (assign + history), the CCRS command center, Compliance health, Regulatory Watch, the Compliance calendar, Website Sync, every page builder (Home/Menu/Specials/Vendors/About/Locations), Banking settings, the Schedule builder, the Employee handbook, Payroll, and Non-cannabis inventory — each with a working “Go there” link. **Red flag:** a failed-lab manifest showing no Blocker, the flags panel rendering on a clean manifest, the AI draft writing into the form without a click on “Use it”, spend tiers filled in cents instead of dollars, or any of the listed Help links 404ing.
- **T-194 (product cards — strain-type badge, ascending sizes, weekend discount policy):** open the customer site on a weekday like Tuesday and look at the shop page product cards. **Expect:** every cannabis card's small badge shows the STRAIN type (Indica / Sativa / Hybrid / Indica-Hybrid / Sativa-Hybrid) — not the product category (“Flower”, “Pre-Roll”); only true CBD/no-strain items may show a category word. On any card with multiple sizes, open the size dropdown. **Expect:** the SMALLEST size is selected first and the list ascends (1g → 3.5g → 7g → 14g → 1oz); “each”/pack options come after weighted sizes, cheapest first. On a Tuesday/Wednesday/Thursday, cards for items covered by that day's deal show the struck-through price plus sale price (Thursday: the brands you hand-picked in Promotions show the 25% price on their cards). Now check on a Friday, Saturday or Sunday. **Expect:** NO discounted prices on any product card — regular price only — but adding qualifying items to the CART still applies the day's deal at the correct discounted total. Finally, on the shop page, find a card with a long sale price row. **Expect:** the struck price, sale price and unit label all fit on the card without overlapping each other or sliding under the dropdown chevron. **Red flag:** a flower card labeled “Flower” instead of its strain type, a size list starting at 1oz, a Saturday card showing a slashed price, a Friday cart that FAILS to discount (the deal must still apply in the cart), or overlapping price text on the shop grid.
- **T-195 (intake intelligence — provider-agnostic transfers, PDF transport prefill, Pacific timestamps):** forward a vendor transfer email from a provider the system has NEVER seen (any email whose body links “WCIA Transfer Data Link” or attaches a transfer JSON, plus one or more PDFs) to vendor_intake@. **Expect:** within a minute the Receiving page's Incoming (email) table shows ONE new row per transfer — no provider needs to be on a hard-coded list; the link is recognized by its label and by its URL shape, and junk links/attachments still never create a manifest (a random newsletter email logs as “no manifest”). Open the staged manifest's review screen and scroll to Transport & chain of custody. **Expect:** driver, vehicle, plate, VIN, carrier and departure/ETA fields are pre-filled from the transport PDF that rode the email (the fields the JSON leaves null); Arrived stays EMPTY — it is never taken from a document. Now check the times: with your laptop on Pacific time in the evening (after 5 PM), the “Pulled in” column, the transport panel's “last updated” stamp, and the manifest timeline must all show TODAY's Pacific date and time, never tomorrow's; an ETA due today shows the Today badge, not Overdue. **Red flag:** a new provider's transfer logging “no manifest”, transport fields still blank when a transportation-manifest PDF was in the email, an Arrived timestamp filled in automatically, or any timestamp on Receiving showing tomorrow's date in the evening.

---

<a id="phase-13"></a>
## Phase 13 — The dress rehearsal: a full simulated store day

*The final exam. Two people minimum (you + one trusted helper). Run a
complete fictional business day at full speed, beginning to end, using
ONLY the system — no side spreadsheets, no mental notes. The goal is not
to find one bug; it's to feel whether the whole day FLOWS.*

**The script:**

1. **8:45 am — open.** Clock in both staff. Count in the drawer float.
   Check the menu published last night is live.
2. **9:00–11:00 — morning trade.** 8 recreational sales (mix of scan and
   manual ID), 1 loyalty signup, 2 loyalty redemptions, 1 website order
   placed (by the helper's phone) and picked up.
3. **11:00 — the incident.** A customer returns yesterday's item
   (receipt in hand). Mid-return, the internet "goes down" (Wi-Fi off).
   Finish the return offline if it allows, or note the refusal; ring 2
   more sales offline; internet returns 20 minutes later.
4. **12:00 — lunch rush.** 10 sales in 45 minutes, including: 1 price
   override (manager), 1 attempted over-limit (refused, adjusted,
   completed), 1 attempted underage (refused, logged).
5. **2:00 — operations hour.** A vendor manifest arrives: intake it,
   quarantine, COA, activate. A recall notice arrives (fictional): place
   the hold, verify the register refuses the product, release it.
   Publish a small menu price change; verify it reaches the register.
6. **4:00 — the mistake.** A budtender rang the wrong item an hour ago:
   manager void with reason, re-ring correctly.
7. **5:00 — the safe drop.** Drawer's heavy: witnessed drop.
8. **7:55 pm — last call.** One sale just inside closing; attempt one
   just after (refused by hours gate).
9. **8:05 — close.** Blind-close the drawer. Clock out both staff. Run
   the day report with a manager PIN.
10. **8:15 — the desk.** In the back office: reconcile the drawer
    (over/short revealed here), review the day's report vs your paper
    tally of every transaction (keep one all day!), check the audit log
    tells today's story, check every website order reached a terminal
    status, generate (don't upload) the CCRS Sale CSV for today and eye
    it.

**Scoring the rehearsal:** for each numbered beat, grade A (smooth), B
(worked but clunky — describe the clunk), C (needed a workaround), F
(broken). Anything C or F gets a Bug Card. The "lazy river" goal: a full
day of A's and B's, where every B has a note.

---

<a id="part-b--the-results-log"></a>
## Part B — The results log & reporting back

### B1. The log format

For every test, one line in this exact format (the interactive manual
does this for you):

```
T-047 | 2026-08-14 15:22 | PASS
T-049 | 2026-08-14 15:40 | FAIL — see Bug Card #3
T-072 | 2026-08-14       | BLOCKED — need a 15-day-old sale, planted one today, retest 8/29
```

Three verdicts only: **PASS**, **FAIL** (with a Bug Card), **BLOCKED**
(with a reason and a retest date). "Mostly worked" is a FAIL with a
gentle Bug Card.

### B2. What to send back to the AI

After each phase (don't save it all for the end), paste back:

1. The phase's log lines (all of them, PASSes included — a PASS is
   evidence too).
2. Every Bug Card in full.
3. Your gut, one paragraph: what felt slow, confusing, or fragile even
   where nothing technically failed. (These paragraphs drive the
   UX-fix priorities — your "this felt clunky" is data.)

From that, you'll get back: which failures are new findings vs known
ones, what got fixed, and exactly which tests to re-run to prove the
fixes. Re-test ONLY what the fix notes name — plus T-060 (the offline
double-count test) after ANY fix that touches the register, because it
is the test that guards your money.

### B3. The finish line

The system is cutover-ready when:

- Every phase's tests are PASS (or BLOCKED with an owner-accepted
  reason recorded in `FINDINGS.md`).
- Every ⚠️ KNOWN-BROKEN test in this manual has flipped to PASS after
  its fix.
- The Phase 13 dress rehearsal scores all A's and B's.
- The CCRS round-trip (T-136) has processed clean in the real portal.
- `CUTOVER-CHECKLIST.md` (the companion document) is fully checked.
- **T-196 (product cards — validated-data info boxes, total cannabinoids, mobile one-per-row, dropdown order):** open the shop, home, and specials pages. Pick a FLOWER product with a known strain. **Expect:** the strain box shows Indica/Sativa/Hybrid (never the word “Flower” or any category), and exactly ONE THC box showing the lab TOTAL (THC + THC-A combined — no separate THCA box). Pick an EDIBLE with CBN or CBG on its label. **Expect:** the minor cannabinoid gets its own full white box (same style as THC/CBD), and every number is the package TOTAL, never a per-serving amount. Pick a product with NO assigned strain type (e.g. a topical). **Expect:** NO strain box at all — nothing that repeats the product category — while the card itself is colored like a hybrid card; a product with no validated potency shows NO potency boxes and never “THC: --” placeholders or “~” estimates. On a PHONE, open the home page and the specials page. **Expect:** ONE full-width product card per row (matching the shop page), not two cramped columns. Finally, on any multi-size flower card, tap the price selector. **Expect:** the smallest size (1g) is selected on the card and the panel that opens ABOVE it reads ascending upward — 3.5g directly above 1g, then 7g, 14g, 1oz at the top. **Red flag:** a category name inside a strain box anywhere, separate THC and THCA boxes, a “--” placeholder box, a per-serving mg value, two-column cards on a phone's home/specials page, or 1oz sitting directly above 1g in the size list.
- **T-197 (menu import — real potency values only, intake-parity naming):** upload a fresh Cultivera POS export under Menu Imports (as a TEST import). Open the staged version's review screen. **Expect:** every product's THC/CBD value is a real lab number from the spreadsheet — no “~” tilde estimates and no “N/A” placeholders appear anywhere in the review rows; products whose spreadsheet rows carry no potency are listed under a “cannabinoid_missing” info diagnostic (your enrichment worklist) instead of being given an invented average. Then find a multi-pack product whose name carries a pack token (e.g. “Blue Dream 5pk”). **Expect:** the cleaned display name drops the pack token (“Blue Dream”) — identical to how the intake system names the same product — so a future intake restock merges onto the imported card instead of duplicating it. **Red flag:** any potency value starting with “~”, any “N/A” potency in the review spreadsheet, or a “5pk”/“3 pack” token left inside a cleaned product name.
- **T-198 (menu import — compliance inventory lots created at publish):** upload a fresh Cultivera POS export under Menu Imports and open the staged version's review screen. **Expect:** a “Compliance inventory lots” panel shows lots planned, units covered, COA-to-attach and expiry-to-set counts, and the diagnostics list carries an “import_lots_planned” summary — this is your worklist BEFORE anything is created. Publish the version (as a real, non-test import). **Expect:** every spreadsheet row becomes an ACTIVE inventory lot under a synthetic “POS-IMPORT-…” manifest labeled as the Cultivera migration — the spreadsheet Barcode becomes the lot code and CCRS identifier, Cost becomes the unit cost in cents, and the Received date backdates the lot so older stock sells first (FIFO); vendors from the spreadsheet are matched to existing vendors or auto-created as drafts. Then ring up one imported product at the register and finish the sale. **Expect:** the imported lot's on-hand count drops by the quantity sold, and the next CCRS Sale.csv upload carries that barcode as the inventory identifier with no quarantine warnings. Re-publish the same import. **Expect:** an “import_lots_already_created” notice and NO duplicate lots — on-hand totals stay exactly the same. Finally, publish a TEST-mode import. **Expect:** zero lots created. **Red flag:** a published real import with zero lots, doubled on-hand after a re-publish, lots minted by a test-mode import, or a register sale that leaves the imported lot's on-hand count untouched.
- **T-199 (website cards — brand-else-vendor label, clipped display names):** on the public website menu, find a product whose card shows a brand above the picture (e.g. “Fairwinds”). **Expect:** the label above the picture is the BRAND, and if the product name in the back office starts with that brand (“Ooowee Marker”), the card shows the name WITHOUT the brand prefix (“Marker”) — the brand never reads twice. Open that product's detail page. **Expect:** the same label + clipped title; the “More from” section heading matches the label, and clicking the brand label filters the menu by that brand. Now find a product whose brand contains the name mid-word or mid-phrase (e.g. “Soda Baja Blaze” by brand “Blaze”). **Expect:** the name is left completely intact — clipping is prefix-only. If a product has NO brand, the vendor shows above the picture instead (plain text, no filter link); with neither, the space above the picture is simply empty and the card grid stays aligned. Finally check the back office (register, products, carts, receipts). **Expect:** the FULL original product name everywhere outside the public website — this is display-only clipping. **Red flag:** a card reading “Fairwinds — Fairwinds Healing Balm”, a mid-name brand chopped out (“Soda Baja”), a clipped name shorter than 3 characters, or a register/receipt showing a clipped name.
- **T-200 (static snapshot retirement — live-only menu and vendor directory):** with a published menu live, open the public website menu and the “Vendors & Partners” page. **Expect:** every product card and every vendor tile reflects the CURRENT published back-office menu — the vendor tiles list exactly the vendors whose products are visible on the menu right now, each with a live product count, sorted by most products first. Publish a menu change in the back office (hide a vendor's only product, or publish an import that adds a new vendor), then reload the vendor page. **Expect:** the directory updates to match — vendors with zero visible products disappear and newly stocked vendors appear; nothing comes from a frozen file. Now unpublish everything (or check a build with no database configured). **Expect:** the menu shows its normal empty state and the vendor page shows a friendly “directory is being refreshed” note — NEVER year-old snapshot products or stale vendor names. **Red flag:** a product or vendor on the website that does not exist in the published back-office menu, a vendor tile with a stale product count, or any page still rendering data from the retired static snapshot files.
- **T-201 (product type line on cards + dose kept in edible/topical names):** open the public website menu. **Expect:** every product card now shows a small product TYPE line (like “Live Resin”, “Gummies”, or “Flower”) directly under the brand/vendor label at the top of the card, and the type is NO LONGER glued onto the end of the product name itself. Open any product's detail page. **Expect:** the same type line appears above the product title. Now find an edible, drink, topical, or RSO product whose source name carries a dose or ratio (for example a “100mg” shot or a “1:1” chew). **Expect:** the customer-facing name KEEPS that dose/ratio — “Const Moonshot Grape 100mg” stays “Const Moonshot Grape 100mg”, never a bare “Const Moonshot Grape” — on the website card, the product page, AND the register. Flower and preroll names are unchanged (package sizes like “3.5g” still stay out of the name and live on the size chips). In the back office, receive two lots of the same edible at DIFFERENT doses (say 10mg and 100mg). **Expect:** they become two separate cards, one per dose — never one card with a single misleading dose in its name. **Red flag:** an edible/drink/topical/RSO card whose name lost its mg dose or ratio, a card with the type still appended to the name, a missing type line, or two different doses merged into one card.
- **T-202 (inventory table: Received / Type / Size / Sold / Strain columns):** open Back Office → Inventory. **Expect:** the lot table now shows five additional columns beside the ones you already had: Type (the product type like “Live Resin” or “Gummies”, falling back to the LCB inventory type when no category is stored), Strain, Size (the stored unit weight like “3.5 g” or “100 mg”), Received (the calendar date the lot arrived — for imported lots this is the POS export's own Received date, not the day you clicked publish), and Sold (received minus on hand, in the lot's unit). Pick a lot you know has sold units. **Expect:** Sold = what came in minus what is left, and it NEVER shows a negative number even after an upward count adjustment. Pick a lot with no stored size or strain. **Expect:** a simple — dash, never an invented value. **Red flag:** a Received date that doesn't match the lot's real arrival, a negative or nonsense Sold figure, or Type/Size/Strain values that don't match the lot's detail page.
- **T-203 (legacy LCB inventory-type vocabulary accepted and translated):** the state renamed its product types in 2023 (“Usable Marijuana” became “Usable Cannabis”, “Marijuana Mix” became “Cannabis Mix”, and inhalation concentrates moved from the Intermediate Product bucket to End Product), but vendor paperwork still arrives in BOTH dialects. Build a CCRS product batch containing a product whose stored LCB type uses the OLD vocabulary (for example “Usable Marijuana”, “Marijuana Mix Packaged”, or “Concentrate for Inhalation” filed under IntermediateProduct). **Expect:** the batch does NOT raise a blocking error for these — the value is translated to the current official spelling (“Usable Cannabis”, “Cannabis Mix Packaged”, End Product) and an advisory note tells you what was translated. Products already using the CURRENT vocabulary pass through untouched with no note. Now try a genuinely invalid type (like “Vape Juice”). **Expect:** still a blocking ERROR — the translation only covers the documented state rename, it never guesses. **Red flag:** a legacy “Marijuana”-era value blocking a submission, a translated value silently missing its advisory note, or an unknown made-up type slipping through as valid.
- **T-204 (vendor short names in composed compliance names):** the owner rule is that long vendor names go in SHORT when composed into a product name (“Downtown Cannabis Company” becomes just “Downtown”). Compose a compliance name (the CCRS naming convention builder) for a product from a vendor whose name ends in legal or generic words — for example “Downtown Cannabis Company”, “Klaritie Farms Inc”, or “Alpha Crux, LLC”. **Expect:** the composed name leads with the SHORT vendor (“Downtown …”, “Klaritie …”, “Alpha Crux …”) — trailing words like Cannabis / Company / Farms / Inc / LLC / Group / & Co are removed, and a dangling “&” is never left behind. Now check the guard rails: a vendor whose whole identity would be destroyed by shortening keeps its full name (“1937 Farms” stays “1937 Farms” because only digits would remain; a vendor named just “Farms” is untouched; “Northwest Cannabis Solutions” is untouched because “Cannabis” sits mid-name, and stripping is trailing-only). Also confirm the brand-drop rule still works: when the brand equals the vendor — in either its full or shortened form — the brand token is dropped so the name never reads “Downtown Downtown …”. **Red flag:** a composed name starting with the long legal vendor name, a dangling “&” or connector at the end of the vendor part, or a shortened vendor that no longer identifies the vendor.
- **T-205 (two-layer CCRS product names auto-composed from stored fields):** the owner-approved design keeps the clean display name everywhere humans look and auto-composes the CCRS Product.csv name from existing data fields — short vendor + brand + display name + measured cannabinoid tag + type + size (e.g. display “Space OG” → CCRS “Downtown Space OG Flower 1g”). Build a CCRS product batch from a published menu. **Expect:** every Product.csv Name follows the ONE convention — it starts with the SHORT vendor, never repeats the brand when the display name already carries it (“Wana Sour Gummies” never becomes “Wana Wana …”), never repeats the type (“Blue Dream Preroll” does not gain a second “Preroll”), never appends a grams size to a name that already carries a dose (“Rainbow Chews 100mg” gets no “3g”), never doubles a ratio that is already in the name, and never exceeds 75 characters. When two DIFFERENT products compose to the same name — the CCRS join is by exact string — the second product gets a short, stable suffix taken from its own external identifier, and an advisory warning explains the suffix. The website, register, and receipts still show the untouched display name. **Red flag:** a CCRS name with a doubled brand/type/ratio, a composed name over 75 characters, two different products sharing one CCRS name with no suffix, or a display name on the website that suddenly shows the long compliance form.
- **T-206 (strain type in its own box — golden-record groundwork):** vendor data often stuffs the strain TYPE into the strain NAME (“Chocolate Turtle Sativa”, “Cinnamon (Sativa)”, or a strain field that just says “Hybrid”) — the Grow Op Farms invoice did exactly this. Per docs/data-governance.md Rule 1.4 (right box, right fact), the intake door now splits the type word out of the strain name into the dedicated strain_type column (migration 0138), the WA PDF-manifest [H]/[I]/[S] token lands in strain_type instead of the WRONG inventory_type box, imported Cultivera lots carry their card's strain type, and the back-office inventory table shows a new sortable Strain Type column. Receive a manifest whose lines carry type words in the strain field, then open the inventory table. **Expect:** the Strain column shows the CLEAN name (“Chocolate Turtle”), the new Strain Type column shows the type (“Sativa”), a bare type-only strain value leaves the Strain column em-dashed with the type captured, and names that legitimately carry “CBD” (“Xtra Dragon CBD”) are NOT stripped (CBD is a cannabinoid, not a strain type, and stripping it would corrupt real names). **Red flag:** a strain name still carrying Indica/Sativa/Hybrid words after receiving, a strain type shown in the LCB inventory-type box, “CBD” vanishing from a strain name, or word-fragment mangling (“Sativai Kush” losing letters).
- **T-207 (word-by-word extraction engine — every fact cross-examined):** Cultivera crammed potency facts into product names (“Moxey Balance 3:1 Peppermints (300mg CBG/100mg THC)”, “Gummy - Rainbow - 10 x 10mg - 100mg THC”) and its Total column is KNOWN-INCONSISTENT — sometimes per-serving, sometimes per-package, sometimes zero. The new pure engine (src/lib/inventory/fact-extraction-core.ts, registered in the self-test runner) tokenizes every name word by word (SKU codes, ratios like 3:1 or CBD:CBC:CBG, mg doses, “N x Mmg” statements, pack counts, package sizes, (I)/(S)/(H) markers, minor-cannabinoid mentions) and then CROSS-EXAMINES the name against the Thc/Cbd potency columns: a fact is “verified” only when independent arithmetic corroborates it (serving × pack count = package total, ratio math agrees, or WA's 10mg-per-serving cap pins the semantics), otherwise it is “single-source” or “conflict” and the row is flagged for human review with a plain-English reason. Flower and concentrates (including RSO) stay in percent mode and are never given invented mg figures. This is engine groundwork; nothing changes on screens yet. Run the pure self-test battery (node_modules/.bin/tsx scripts/compliance/run-pure-selftests.ts). **Expect:** “fact-extraction-core: 73 assertions passed” among the results, with pinned real rows (Moxey, Const HRG, Cantina, A.C. topical, Moonshot, Kelly's, Journeyman, Sungaze, CannaSol RSO) all reconciling exactly as documented in the module. **Red flag:** any FAIL line, a ratio-derived THC figure accepted without column confirmation, an RSO or flower row growing mg facts, or a zero-potency row (Kelly's) passing without a review flag.
- **T-208 (transformer fills the fact boxes — verified facts only):** the import transformer now runs every mg-dosed row (Solid Edible, Liquid Edible, Tincture, and — new — Topical Ointment) through the word-by-word extraction engine and fills the structured fact columns from migration 0138: servings per pack, mg per serving, package-total THC/CBD mg, ratio label, minor cannabinoids (CBG/CBN/CBC — these live ONLY in Cultivera names, no columns exist), net weight in grams / net volume in ml, and per-fact provenance. Policy changes: (1) PACKAGE-TOTAL-FIRST THC — a verified package total from cross-examined arithmetic outranks the KNOWN-INCONSISTENT Total column, with a diagnostic recording every override; (2) topicals join the mg display group (“A.C. Topical Drops - 1000mg THC” now shows a 1000mg THC box and, because its unit is mg, the net-weight line) with a 5000mg sanity cap; (3) package-size sanity — a Package Size column carrying an absurd milligram figure (“25000.00 Milligrams”, 22 real rows) is flagged as garbage and yields NO net measure. Only VERIFIED facts reach the fields and customer display; anything uncertain stays null and emits a fact_extraction_review diagnostic for the coming exception queue. Import the Cultivera workbooks on a fresh menu version and open a Const HRG gummy card and an A.C. topical card. **Expect:** the gummy shows 100mg THC (package total — not the Total column's per-serving 10), a CBN box from the name, ratio 1:1:1 stored as a field; the topical shows its mg THC box (hidden before this slice) plus a net-weight line; menu_items rows carry servings_per_pack / mg_per_serving / package_thc_mg / ratio_label / fact_provenance. **Red flag:** a per-serving figure displayed as the package THC, a topical still missing its THC box, minor cannabinoids silently dropped, an unverified (single-source) figure reaching a fact column, or a 25000mg “package size” flowing into net weight.
- **T-209 (dry-run buckets + fact-review exception queue):** the import review screen now links to a dedicated Fact Review page (Menu Imports → open an import → “Open fact review”) that partitions EVERY staged row into exactly one of three buckets — auto-accepted (no open flags; “verified” when at least one fact was cross-checked by independent arithmetic, otherwise “single-source”), needs-review (the exception queue: every row the cross-examiner could not fully verify, each with its plain-English reasons), and rejected (hidden rows, each with its documented reason) — so the totals always reconcile: rows in = auto-accepted + needs-review + rejected. Review flags that match no staged card surface as standalone queue rows (never silently lost). Each pending exception offers three decisions: approve as-is, inline fix (only the fields you type are changed, each written to the staged item with provenance “reviewer”), or reject (hides the item with reason “reviewer_rejected”; a later approve/fix restores ONLY a reviewer-made hide, never a transformer hide). Decisions persist in pos_fact_reviews (migration 0139, one decision per import+row, latest wins) and are audit-logged. The whole report exports as a CSV spreadsheet (Bucket / Status / Product / facts / Confidence / Sources / Notes). Run a Cultivera import, open Fact Review, and work one row of each kind. **Expect:** the four stat cards reconcile (rows in equals the bucket sum); a Moxey-style mint sits in needs-review with the cross-examiner's exact sentence; approving moves it to the Decided list; fixing package THC writes the value and shows provenance “reviewer”; rejecting hides the item from the staged menu; the CSV downloads with one line per product across all three buckets and pending/decided status on review rows. **Red flag:** a row in two buckets or none, bucket totals that do not sum to rows in, a flag that vanishes without a standalone row, an inline fix changing fields you left blank, a reviewer reject that survives as hidden after a later approve, or a decision saving without menu.import permission.
- **T-210 (commit gate + reconciliation — one door, never guess):** publishing an import now runs a commit gate built on the fact-review buckets. Rule 3.1: while ANY fact-review row still awaits a human decision, the Publish section refuses with a plain-English message (“Cannot publish: N fact-review row(s) still await a human decision… this import never guesses.”) and offers the Open fact review button instead of the publish button; the server re-evaluates the same gate on fresh reads, so a stale page cannot sneak an uncertain row live. Rule 3.3: once every exception is decided the gate shows the balanced equation — rows in = going live + documented rejects + resolved flags — and publishing persists that exact equation as an import_commit_reconciled diagnostic for the audit trail. One door: the migration manifest created at publish now carries accepted_at and a manifest_events timeline entry, the same lifecycle fingerprint a natively accepted delivery gets, and every lot still resolves its vendor/brand through the native intake ladder. Run an import with open fact flags and try to publish. **Expect:** publish refused with the pending count and a link to Fact Review; decide every row (approve/fix/reject), return, and see the balanced equation in green above the publish button; after publishing, Diagnostics contains import_commit_reconciled with the same numbers, and the migration manifest shows status accepted with an accepted timestamp and an “accepted” timeline event like any native delivery. **Red flag:** a publish that succeeds while a fact-review row is pending, an equation whose sides do not match, a preview verdict that differs from the server verdict, or a migration manifest missing accepted_at / its timeline event.
- **T-211 (public pages refresh after publish AND reset — no ghost vendors):** every public page derived from the published menu — home, /menu, /specials, and /vendor-delivery (the Vendors & Partners directory is BUILT from the live menu’s vendor names) — now refreshes through one canonical helper whenever the menu changes: manual import publish, intake auto-publish, and Reset operational data. This closes the owner-reported ghost-vendors bug where a reset wiped the menu but the public vendors page kept showing pre-reset vendors until the next delivery happened to refresh it. Publish an import (or accept a delivery) and check all four public pages; then run Reset operational data and check them again. **Expect:** after a publish, the new vendor appears on Vendors & Partners without any other action; after a reset, home, menu, specials, and Vendors & Partners all show their EMPTY states immediately — no stale products, prices, or vendor cards anywhere. **Red flag:** any public page still showing pre-reset products or vendors after the reset confirmation appears, or a publish that updates /menu but not the vendor directory.
- **T-212 (reset coverage sweep — the wipe wipes everything operational):** migration 0140 extends “Reset operational data” to the newer operational tables the old version missed: register sale events, receipt print jobs, safe counts & swaps, special-discount uses, customer returns, non-cannabis invoices/lines/adjustments, CCRS week submissions & the compliance reminder log, sample JSON imports, payroll source documents, and the fact-review decision log. The Danger Zone page’s “This will DELETE” list now names them, and the KEEP list still promises your curated world: settings, knowledge base, media, site content, product masters/enrichments, brands & vendors, non-cannabis products, promotions, people/hardware, and the audit log. Generate some of each kind of activity (ring a register sale, record a safe count, log a special discount, upload a payroll file, decide a fact review), export your records, then run the reset. **Expect:** the success banner’s row count includes the newer tables; every operational screen shows its empty state; vendors, brands, media, KB, and settings are untouched; the S-6 retention guard still refuses without the WAC 314-55-087 attestation when completed orders or CCRS batches exist. **Red flag:** any register sale, safe count, discount use, return, invoice, or fact-review decision surviving the reset — or anything from the KEEP list disappearing.
- **T-213 (mg-aware potency at intake — no more 3000% topicals):** receive a JSON transfer manifest that includes an mg-dosed item (a 100mg drink, a gummy pack, a tincture, or a topical) alongside a normal flower or concentrate line, approve the drafts, and publish to the menu. **Expect:** the mg items show doses like “100mg” or “3000mg” on their cards and in the back office — never a percent sign — while flower and concentrates (including RSO) keep honest percents like “21.66%”; the admin inventory list THC column and the lot detail COA panel show “3000 mg” for a 3000-dose topical instead of “3000%”; a flower line whose lab data claims an impossible number over 100 gets clamped to 100% and the receive report notes the potency was capped. **Red flag:** any percent sign over 100 anywhere, an edible or topical showing “%” instead of “mg”, or an mg dose above the safety ceiling for its category (2000mg solid edibles, 1000mg drinks, 5000mg tinctures/topicals) surviving uncapped.
- **T-214 (word-by-word intelligence at intake — facts read from manifest names):** receive a JSON transfer manifest carrying an mg-dosed product whose name states its facts (e.g. “Const HRG CBN 1:1:1 Blueberry 10 Pack 300mg”) plus one whose lab numbers are missing or zero, approve the drafts, and let the intake menu update run. **Expect:** the fully-reconciled product publishes with the verified package total (100mg THC — not the raw per-serving column), its servings, per-serving dose, ratio, and minor cannabinoids stored on both the menu item and the inventory lot (check the lot detail and the receive report’s “package total” note); the UNVERIFIABLE product holds the whole menu update in STAGED instead of auto-publishing — the manifest timeline notes it was held for fact review, and you publish manually from Menu Imports after checking the flagged reasons. **Red flag:** an unverified mg figure published to customers, a verified package total ignored in favor of a garbage column value, facts missing from the inventory lot, or the menu auto-publishing while an extraction flag is open.
- **T-215 (house product types with confidence — OUR labels on screen, CCRS under the hood):** receive a JSON transfer manifest whose lines carry raw CCRS classifications (category “EndProduct”, inventory type “Concentrate for Inhalation”) including a vape cart (e.g. “2727 - Live Resin Cart - GG4 1g”) and an edible (“Cantina Gummies - Guava 10 Pack 400mg”), approve the drafts, and let the intake menu update run. **Expect:** the back-office inventory table's TYPE column shows OUR product types (“Live Resin Cartridge”, “Gummies”) — never the raw “EndProduct”/“IntermediateProduct” blobs; the lot detail page shows the same Type row WITH the untouched LCB classification directly beneath it; the website cards show the specific type line (“Live Resin Cartridge”, not a generic “CONCENTRATE”) and the cart files under the Cartridge section, not Concentrate; the import diagnostics disclose each auto-assigned type with its confidence, and any line the labeler could not type at 90% or better gets NO type (an honest fallback label plus a warning telling you to set it manually). **Red flag:** a CCRS blob in the TYPE column, a vape cart in the Concentrate section, a type invented for a plain strain name, the LCB classification altered or hidden on the detail page, or an auto-assignment below 90% confidence.
- **T-216 (manual classification at draft approval — the human picks when the machine is unsure):** receive a JSON transfer manifest containing (a) a product whose LCB inventory type has no website-category mapping and (b) a product the type labeler cannot classify at 90% confidence (e.g. a plain strain name like “Blue Dream 3.5g” under “Usable Marijuana”), then open Product Onboarding. **Expect:** the drafts table shows OUR category and type labels with the confidence percentage (never the raw CCRS blob — the LCB values appear only as fine print under the labels); rows the system could not classify show “Needs category”/“Needs type” and their approve form gains the matching dropdown(s) filled from OUR own taxonomy (the labeler's best read preselected when it has one); approving without a required pick is refused with a plain-English banner and nothing is saved; approving WITH picks saves them, and the menu update files the product under YOUR chosen category/type with an import diagnostic disclosing it was chosen by the approver; a fully confident product (≥90%) shows no pickers and approves exactly as before, price-only. **Red flag:** an approved product silently missing from the staged menu because its category was unmapped, a picker offering anything outside our own category/type lists, a required pick that can be skipped, the human's choice losing to the machine's, or the raw CCRS category/inventory-type values being overwritten by the pick.
- **T-217 (short customer names built at intake — raw manifest name stays under the hood):** receive a JSON transfer manifest whose product names carry integrator noise (vendor codes, underscores, a trailing size like “… - 1.5g”, pack words), approve the drafts, and publish the staged menu update. **Expect:** Product Onboarding shows the short built name (strain for flower/prerolls/carts/concentrates; cleaned product wording for edibles/topicals with the mg dose KEPT, e.g. “Rainbow Chews 100mg”) with the raw manifest string as “Manifest:” fine print underneath; the website card and the register show the same short name with no trailing size token (the size lives on the price/variant chip); the import diagnostics disclose each rename (“will appear on the menu as …”); a product whose name cannot be read confidently keeps its raw manifest name everywhere — never a guessed rename; restocking the same product later still merges onto the same card (the built name and the grouping identity are the same derivation). **Red flag:** a card name still carrying a size token or vendor code, an edible losing its mg dose, the raw manifest name gone from the draft row's fine print or from the lot/compliance records, a rename with no diagnostic, or a restock spawning a duplicate card after the rename.
- **T-218 (honest card labels — enrichment brand wins, short vendor, no license numbers, no redundant THC pill):** on a product whose menu row has no brand, open its Product Enrichment page, link a brand, and publish the enrichment; also receive a manifest whose sender header carries a license number (e.g. “CERES - 435011”) and check a THC-only product plus a 1:1 THC:CBD product on the public menu. **Expect:** the published enrichment's brand name replaces the vendor as the label above the product picture (and clips from the front of the display name); vendor labels show the short doing-business-as name when one is on the vendor card and NEVER show a trailing license number (“CERES”, not “CERES - 435011”) — including vendors created before this fix; the newly auto-created vendor row itself is born with the clean display name and the digits stored as its license number; the small cannabinoid-profile pill appears ONLY when it adds information (“1:1 THC:CBD”, “THC:CBD:CBN”, “CBD”) and a lone redundant “THC” pill never renders on cards or the product detail page. **Red flag:** a linked published brand still ignored on the card, any label reading “Name - 123456”, a vendor named just a number after stripping, an all-digit brand like “2727” emptied, admin/receipts/CCRS exports showing the shortened names (the overlay must be website-display only), or a THC-only card still showing the lone THC pill.
- **T-219 (re-run intelligence — existing lots and the live menu gain verified facts without re-importing):** with lots and published menu items that were received BEFORE the intake-intelligence slices shipped (e.g. an edible showing a per-serving “10mg” as its THC, a lot with empty servings/package-total columns, a card still wearing its raw manifest name), open Receiving → Manual tools and press “Re-run intelligence now”; then press it a second time. **Expect:** a banner reporting how many lots and live menu items were improved; on the improved rows the structured fact columns (servings per pack, mg per serving, package THC/CBD mg, ratio) fill with arithmetic-verified values only, mg-dosed items whose displayed THC disagreed with a verified package total now show the package total, empty product types fill only when the labeler is ≥90% confident, raw manifest names rebuild into clean display names ONLY where the raw name was still showing (the raw name always stays in the under-the-hood product name), and strain type fills only from an explicit (I)/(S)/(H) marker written in the name; the SECOND run reports zero improvements (fill-only, idempotent). **Red flag:** any single-source or conflicting number written as fact, a value a reviewer fixed being overwritten, a flower/concentrate row gaining mg facts, a human-edited or engine-built display name being renamed again, the under-the-hood product name changing, the second run patching rows again, or the pass failing silently with no banner.
- **T-220 (exhaustive email harvest — checklist, second pass, archived downloads, transport from every document):** forward a real vendor intake email to the receiving address — ideally one that carries only SOME documents as attachments and offers the rest as download links in the body. Open Back Office → Inventory → Intake and expand the email's log entry. **Expect:** the log note ends with a harvest checklist line (“harvest checklist: transfer JSON OK, manifest PDF OK, invoice PDF OK, COA OK, body text OK — everything found”) — and when a document was NOT attached but WAS linked, the note carries a “second-pass fetched … PDF from link” line showing the fetcher went back and pulled it; anything genuinely absent from the whole email is named explicitly (“still missing after full harvest: …”), never silently skipped. In the email intake table, EVERY staged manifest row's Docs cell now offers download buttons (⬇ Manifest / ⬇ Invoice / ⬇ COA / ⬇ JSON) served from OUR OWN archive (the private intake-docs bucket) — not from the vendor's expiring links — and clicking each one downloads the document; rows staged before this slice may still show only the old vendor links as a fallback. Open the staged draft's intake form. **Expect:** the transport boxes (transporter, driver, vehicle, plate, departure) are FILLED whenever any document in the email — the JSON, the transportation manifest PDF, the invoice header, an extra unnamed PDF, or even the email body text — stated them; the arrived-at box stays empty (arrival is always recorded by staff at the door, never copied from paperwork). Send the same email again. **Expect:** byte-identical duplicate attachments are stored once (no doubled documents in the Docs cell), and the duplicate re-send repairs transport on the existing draft instead of staging a twin. **Red flag:** a checklist note missing from a processed vendor email, a linked document the second pass never tried, a Docs cell empty on a NEWLY staged manifest, an archived download that 404s, transport boxes empty while any of the email's documents plainly prints the driver/vehicle/plate, an arrived-at date filled from paperwork, or duplicate documents after a re-send.
- **T-221 (restock rollup — same product, same vendor, NEW lot number):** with a product already live on the menu (and, ideally, enriched with a published description/image), receive a NEW manifest from the SAME vendor carrying the SAME product under a NEW lot number (a different manifest number — a re-send of the same manifest number is correctly blocked as a duplicate), approve the draft's price, and let the intake menu update publish. **Expect:** NO duplicate product card appears — the manifest timeline notes "restock/size option(s) merged into existing cards" and the new lot joins the EXISTING card as a size option that keeps its own lot identity (sales, CCRS, costs, and recalls stay lot-accurate); the card's stock now reflects the TOTAL of both lots (a sold-out card wakes up the moment the restock lands); the published enrichment (description, images, linked brand, tags) applies to the restocked card automatically with NO re-enrichment work, because enrichment is keyed to the card's stable identity, not the lot; on the WEBSITE, when the restock's size and price match an existing option (another "3.5g @ $40.00"), the size dropdown shows ONE row — never the same size/price listed twice — and that row sells the oldest lot that still has units first (FIFO), rolling to the newer lot when the old one drains; a restock with a DIFFERENT price or size honestly shows as its own option; the live card's name and price are untouched by the merge. **Red flag:** a duplicate card for a restocked product, quantities that show only the new lot instead of the total, enrichment lost or needing to be redone after a restock, the same size+price printed twice in the website dropdown, add-to-cart dead on a size while a fresh lot of it sits in stock, a restock silently changing the live card's price/name, or two DIFFERENT-priced lots collapsed into one row.

- **T-222 (enrichment gallery management — remove, cover, reorder):** open a product's enrichment editor (`/admin/products/[key]`) with at least two images attached. **Expect:** each gallery image shows a control strip — ✕ Remove takes the image off THIS product only (the file stays in the media library and can be re-attached later); the ★ Cover button promotes any non-cover image to the cover (the "Cover" badge moves, and the live menu card switches to that photo); the ←/→ buttons nudge an image one slot in the curated order (edges are greyed out); removing the CURRENT cover automatically promotes the next remaining image so the card never loses its photo mid-gallery; removing the LAST image clears the cover entirely and the live menu falls back to the category/mockup image — the first image you ever attached is no longer stuck forever; every remove/cover/reorder is written to the audit log and the menu updates without a re-publish. **Red flag:** a Remove click deleting the file from the media library, a removed cover leaving the card pointing at a ghost image, the Cover button accepting an image that is not in the gallery, reorder buttons scrambling the gallery or changing the cover, an unknown/double-click edit writing a change anyway, or gallery edits missing from the audit trail.

- **T-223 (enrichment worklist — smart priority, brand/stock filters, richer table):** open Product Enrichment (`/admin/products`). **Expect:** the filter bar now offers a Brand dropdown (real brands from the live menu), a Stock dropdown (In stock / Low stock / Sold out), a "Missing tags" gap option, and new sorts — "Smart priority (sellable + broken first)" plus price high→low and low→high; smart priority puts an IN-STOCK product with no image/description at the very top (image gaps weigh heaviest, then description, brand link, tags; sold-out products sink because fixing a card nobody can buy helps nobody today; pricier items get a small nudge); an honest "Showing X of Y matching products" count updates with every filter; a "✕ Clear filters" link appears only when a filter is active and resets everything while keeping your grid/table view; the table view gains Price, Stock (green/gold/grey dot), and Tags columns; an empty filter result shows a friendly empty state in BOTH views; existing filters (search, category, gap, status) and the default most-gaps-first sort still work; combined filters stack (e.g. brand + in-stock + missing image). **Red flag:** the smart sort ranking a sold-out product above an in-stock one with equal gaps, a brand appearing in the dropdown that is not on the live menu, the stock filter matching the wrong products, the result count lying, Clear filters losing your view choice, filter combinations silently ignoring one filter, or the grid view rendering nothing (not even the empty state) when zero products match.
- **T-224 (enrichment detail — jump-to buttons for missing details):** open Product Enrichment (`/admin/products`) and click a product that is missing an image and/or description. **Expect:** the gold "How to finish enriching this product" panel now ends with a row of jump-to buttons, one per next step, each with a plain-English tooltip on hover — "Review suggested matches" (scrolls to the Suggested matches panel, only when matches exist), "Harvest vendor menus" (→ Purchasing → Vendor Menus, only when no vendor match was found), "Search the media library" (→ Media with the search box pre-filled with this product's name), "Run the KB harvest" (→ Knowledge Base → Harvest Console), "Upload a photo" (scrolls to the Add image field), "Manage fallback images" (→ KB → Images, only when an approved category fallback exists), "Draft an AI description" (scrolls to the AI panel, only when the description is missing), and "Link the brand" (scrolls to the Brand link panel, only when no brand is linked); in-page jumps land with comfortable headroom (nothing hidden under the sticky header); a fully enriched product keeps the panel (it is permanent as of SLICE 75) but shows the all-✓ scorecard and a green "Fully enriched" line instead of any buttons; the numbered plain-English checklist is unchanged while gaps remain. **Red flag:** a button pointing at a dead route or 404, the media-library search arriving empty instead of pre-filled, "Harvest vendor menus" showing even though vendor matches exist, a brand/AI/fallback button appearing when that detail is already satisfied, in-page anchors jumping to the wrong panel or hiding it under the header, or jump-to buttons rendering on a fully enriched product.
- **T-225 (enrichment detail — deep product web research, drafts only):** open a product in Product Enrichment (`/admin/products` → click a product). **Expect:** a gold "Web research" panel sits above the AI panel with (1) a "Search the web for this product ↗" link that opens a DuckDuckGo search pre-filled with the brand + product name in a new tab, and (2) a URL field + "Research this page" button (when the crawler worker is configured; otherwise the panel shows which env vars to set and the search link still works); pasting a product page's URL and clicking Research makes the crawler read that ONE page politely, GPT extracts a description verified against the real page text, the compliance scan runs, and the result arrives as a PENDING draft in the AI panel below (source shows `crawl:<url>`) — an honest banner reports exactly what was found ("2 drafts written and 5 image candidates found…", or "nothing usable" when the page was empty, or the real error when it failed); any product photos the page showed appear in a "Researched image candidates" grid (each thumbnail opens the original in a new tab) with a one-click "Import" per image (downloads into the media library with provenance + license review, attaches to this product's gallery, audited) and a "Dismiss these candidates" button that clears the whole list; a bad URL (no https://, not a web page) is refused with a plain-English message and nothing runs; NOTHING is ever applied to the product automatically — the description draft still needs Accept (with its compliance re-scan) and images still need Import. **Red flag:** research writing straight into the enrichment without review, the Accept path skipping the compliance gate for crawled drafts, an invalid or non-http(s) URL reaching the crawler, image import working without the media-library provenance/license trail, the banner claiming success when the crawler returned an error, the search link arriving empty instead of pre-filled, or the panel's Research button rendering when the crawler isn't configured.
- **T-226 (enrichment pages — image controls fixed, permanent scorecard, working helper buttons):** open a product with two or more gallery images (`/admin/products` → click a product). **Expect:** the ✕ Remove, ★ Cover and ←/→ reorder buttons now WORK — no more "Missing media id" error (each button binds its image's id straight to the server action; React drops a submit button's own name/value when the button carries its own formAction, which is what broke SLICE 71); the gold "How to finish enriching this product" panel is now PERMANENT — it always opens with a ✓/○ scorecard (Photo, Description, Brand link, Tags — each row with a plain-English status), shows the numbered how-to checklist and jump-to buttons only while something is missing (a new "Pick tags" button jumps to the tags picker when tags are the gap), and flips to an all-✓ scorecard with a green "Fully enriched" line once everything is done — the panel never disappears; on the main enrichment page (`/admin/products`) the top helper buttons ("Fix missing descriptions/images/brand links" — previously they looked dead because they only re-filtered the page invisibly, several screens above the list) now jump straight to the filtered worklist with the filter dropdowns visibly set to match, a fourth "Fix missing tags" button (with its live count) joins the row, and the same jump applies to the Missing description/image/brand-link stat cards and the "What's missing" panel rows. **Red flag:** any gallery control still erroring "Missing media id", a remove/cover/reorder click acting on the WRONG image, the gold panel disappearing on a fully enriched product, the scorecard showing ✓ for a detail that is actually missing, a helper button landing at the top of the page instead of the filtered worklist, the filter dropdowns still showing "All products" after a gap link was clicked, or the tags helper button missing its count when products lack tags.
- **T-227 (Publish Menu command center — one obvious place to publish, impossible-to-miss shrink warning):** open Admin → Publish Menu (`/admin/publish` — it's also the Publish stage on the pipeline strip and a card on the Catalog hub; Menu Imports stays where it was for uploads and history). **Expect:** the command center shows what's LIVE right now (when it was published and how many items) and ONE clear list of publishable drafts — the newest carries a green "Latest" badge and every older one a gray "Outdated" badge, so there is exactly one obvious choice; each draft shows a plain-English safety verdict computed against the live menu (green "safe — only adds/updates", amber "caution", red "DANGER — this is an older draft that would REMOVE N live products") plus a "Review & publish" link into its detail page; the same Latest/Outdated badges now appear on the Menu Imports staged list, and the pipeline strip gained an Inventory stage between Master and Pay that opens `/admin/inventory`. Open the OLDEST draft's review page. **Expect:** the verdict banner sits at the top, a red open-by-default "Will be REMOVED from the live menu (N)" list names every product that would vanish, the diagnostics section is retitled "Things to fix (and how)" with each code explained in plain English plus a "How to fix it" sentence and a fix-it button that jumps to the right admin page (FYI-only notes are tucked into a collapsed details block), and the Publish button is guarded by a red confirmation checkbox spelling out that publishing REPLACES the whole live menu. Try to publish it WITHOUT ticking the box. **Expect:** the publish is refused with a plain-English error telling you how many products it would remove and suggesting the newest draft instead — the live menu is untouched. Now publish the NEWEST draft. **Expect:** it goes live normally, and afterwards the older intake drafts are auto-archived so the landmines disappear from the publishable list. **Red flag:** an outdated draft publishing without the removal confirmation, the verdict saying "safe" on a draft that removes live products, two drafts both badged "Latest", a fix-it link landing on the wrong page, stale drafts still publishable after a newer publish, the Publish stage on the strip still pointing at the inventory page, or the Menu Imports page having been absorbed or moved.
- **T-228 (Fix lot details legally + vendors ⇄ inventory ⇄ enrichment cross-links):** open Admin → Inventory and click into any lot. **Expect:** a new “Correct lot details” panel lets you fix EXACTLY four things — vendor (picked from your real vendors list, license numbers shown), brand, strain name, and strain type — with a note explaining that quantities, lot codes, costs, categories, dates, and COA links are locked because they come from manifests and audited adjustments (WA traceability). Pick a brand that belongs to a DIFFERENT vendor than the one selected and save. **Expect:** the save is refused with a plain-English error saying the brand belongs to a different vendor — nothing changes. Now make a real correction and save. **Expect:** a green “saved” banner, the new values on the page, and an audit-trail entry recording old → new for each changed field. Still on the lot page: the vendor name in the details box is now a real link that opens that vendor’s page, and a new “On the menu (enrichment)” panel shows the product’s menu photo, display name, description and tags with an “Open in Product Enrichment” button (or “Start enriching” if no enrichment exists yet). Open the vendor’s page. **Expect:** a new “Inventory from this vendor” panel lists recent lots (name, on-hand, status) each opening its lot page, plus a “View all in Inventory” link that opens the Inventory list filtered to that vendor — with a banner naming the vendor, an “Open vendor page” link back, and a “Clear filter” link; changing other filters (search, COA, sort) keeps the vendor filter, and page links carry it too. Finally open any enriched product in Product Enrichment. **Expect:** an “Inventory lots for this product” panel lists the real lots behind that menu item (lot code, vendor, on-hand, status), each opening its lot detail page, plus a “Search in Inventory” link. **Red flag:** any quantity, lot code, cost, category, date or COA field being hand-editable on a lot; a mismatched vendor/brand pair saving; a junk vendor id in the URL crashing the inventory list instead of just showing all lots; the vendor filter dropping off when you search or change pages; a lot edit saving with no audit entry; or the enrichment panel showing a different product than the lot’s POS key.
- **T-229 (Types & Categories connected to the whole back office):** open Admin → Settings → Types & Categories. **Expect:** each website category now shows a real “N in use” badge, and expanding a category shows a plain-English breakdown of exactly where it’s used (live menu, staged drafts, onboarding picks, inventory-type mappings). Rename a category’s label and save, then open the public menu. **Expect:** the new name appears on the customer site immediately — section headings, the category filter list, and filter tags all show the owner’s label (reports — Sales, COGS, Tax — show it too). Add a brand-new category and assign a product to it (via the bulk-move tool or onboarding). **Expect:** the new category gets its own section on the customer menu and is filterable — no code change needed. Now use the new “Move products between categories” tool: pick a source and a target. **Expect:** the source dropdown shows how many records each category has; after moving, a green banner says how many records moved, the customer menu updates immediately, and the audit trail records the move (moving into a hidden category is refused with a plain-English error). Next, onboard a product whose type has no category mapping (Admin → Inventory → Product Onboarding). **Expect:** the “Pick a category…” dropdown lists YOUR live categories (including ones you just created) plus a “➕ Create a new category…” choice — picking it and typing a name in the box creates the category (validated: blank or duplicate names are refused), records it in the audit trail, and approves the product straight into it. Finally, delete an unused category. **Expect:** it’s permanently removed only when the page shows zero usage; categories with ANY usage (or built-ins) are hidden instead, with the guard text explaining why — and if the live menu ever carries a category value missing from your list, a “Heads up” panel names those orphan values with a fix path. **Red flag:** renaming a category and the public menu/reports still showing the old hardcoded name; a brand-new category’s products vanishing from the menu instead of getting a section; the bulk move touching archived menu versions or sales history; onboarding’s create-new accepting a blank/duplicate name or skipping the audit trail; or a “clean delete” succeeding while staged drafts or onboarding picks still reference the category.
- **T-230 (Vendors list opens on current vendors only):** open Admin → Vendors & Brands with product already received into inventory. **Expect:** the list opens showing ONLY your current vendors — suppliers with at least one inventory lot — not the ~1,775-vendor statewide directory; the “Current vendors” stat card matches the count shown, and the scope dropdown reads “Current vendors (in inventory)”. Switch the scope filter to “All vendors (statewide directory)” and press Filter. **Expect:** the full directory appears with working pagination, and paging keeps the scope (page 2 still shows all vendors). Switch to “Unused (directory only)”. **Expect:** only vendors you’ve NEVER stocked appear — none carry the “Mine” badge. Now open an old bookmark ending in `?scope=mine`. **Expect:** it still works and shows current vendors (the legacy value maps to the new default). Search for a vendor you don’t stock while scope is on the default. **Expect:** the “No vendors match” message explains the scope is “Current vendors” and tells you to switch to “All vendors” to search the whole directory. Finally, on a fresh database with zero inventory lots. **Expect:** the page shows the full directory with a gold banner explaining there are no current vendors yet — never a silent empty list. **Red flag:** the default view dumping all ~1,775 statewide vendors on the owner; `scope=mine` bookmarks breaking; “Unused” showing a vendor that has inventory; pagination or the Clear link dropping you into a different scope than the dropdown shows; or a zero-inventory store opening on a blank page with no explanation.
- **T-231 (payee banking vault — admin-only bank details, tamper-proof payments):** run migration `0143_payee_banking_vault.sql` first. As the owner, open Settings → Payee banking. **Expect:** a two-tab page (Vendors / Employees) reachable only by owner/admin — a manager or budtender who types the URL is refused. On the Vendors tab, add a vendor's bank details (bank name, routing, account, checking/savings). **Expect:** a bad routing number is refused with a plain-English message about the ABA check digit; a good save shows a reminder to verify the numbers with the vendor BY PHONE at a number you already have; the table shows the record with routing and account MASKED (••••1234) and a “not yet verified” chip; typing a name and clicking “Mark verified” stamps it. Put the record ON HOLD, then open Vendor payments and try to pay one of that vendor's invoices. **Expect:** the ACH form shows the banking read-only “from vault” with an ON HOLD warning and NO routing/account boxes to type into; generating the file is refused with an explanation about phone verification. Release the hold and pay again. **Expect:** the file generates using the vault's numbers — there is no way to type different ones; a vendor with NO vault record is refused with a pointer to Settings → Payee Banking. On the Employees tab, enter an employee's direct deposit, then open a draft payroll run. **Expect:** the run's banking column is READ-ONLY (masked, “from vault”) — the old editable routing/account boxes are gone — and saving lines pulls banking from the employee's saved record; an employee with no banking shows “No banking on file — add it in Settings → Payee Banking”. Finally check the audit trail. **Expect:** every add/change/hold/release/verify/delete is logged with masked “old → new” tails — full account numbers NEVER appear in the log — and any attempt to submit bank numbers that differ from the vault during a payment is blocked AND logged as `payee_banking.tamper_attempt`. Before migration 0143 the Vendors tab shows a friendly banner naming the migration and vendor payments keep the old manual fields. **Red flag:** a non-admin reaching the vault page or reading a bank number; an editable bank field anywhere on the payment or payroll screens once the vault is live; a full unmasked account number in any audit entry or on any screen; an on-hold vendor getting paid; a tamper attempt that is silently ignored; or a pre-migration visit crashing instead of showing the banner.
- **T-232 (Greenway-branded PO document, verify-and-send, paper trail):** open any purchase order in Purchasing. **Expect:** the page header shows the PO number plus a witty codename like “Operation Amber Caravan” — the same PO always shows the same codename (it is derived from the PO number, never random). Press “Preview document”. **Expect:** a professional, print-ready Greenway purchase order opens in a new tab — dark-green and gold branding, our license 413541 and the vendor's license number, date / PO number / reference / requested-delivery boxes, vendor + ship-to + bill-to blocks, an item table with cents-accurate money, special instructions, a totals box, an authorized-by signature line, and an I-502 compliance footer about licensed transport and the three-way match; a Print / Save-as-PDF button sits at the top and disappears when printing. Press “Download”. **Expect:** the same document saves as an HTML file named after the PO, and the download is recorded in the audit log. On a draft or submitted PO, find the “Send to vendor” card. **Expect:** a send-to email box prefilled from the vendor record (editable), a “Verify & send” button, and a Download button beside it; a garbage address like “not-an-email” is refused with a plain-English message; a valid send emails the Greenway-branded HTML order (when email is configured) and the audit entry records exactly which address it went to. Scroll to “Paper trail (procure-to-pay)”. **Expect:** four steps — Purchase order, Delivery manifest, Invoice payment, Paid stamp — each honestly marked done / partial / missing with plain-English notes: no linked manifest says to link it from the manifest page; linked manifests appear as chips that open the intake review page; partial payment shows “$X of $Y owed” with a link to Vendor payments; the paid stamp explains it fires automatically when every linked invoice settles; before migration 0102 the manifest step says the hop cannot be traced yet. **Red flag:** a codename that changes between visits or anything crude on a vendor-facing document; vendor-supplied text rendering as live HTML in the document; the preview differing from the downloaded file; “Verify & send” accepting an invalid address or sending to an address the audit log doesn't record; money off by a cent anywhere; or a missing manifest/payment shown as complete instead of an honest gap.
- **T-233 (Purchasing command center - insights, filters, past orders):** open Purchasing (Product Intake → Purchasing). **Expect:** five KPI cards computed from real purchase orders - Open POs, Open PO value (committed but not yet received), Awaiting delivery, Avg cycle time (with the late-arrival percentage when there is history), and Ordered this month with a plain-English month-over-month hint like “up 42% vs last month” or “no orders last month to compare”; cancelled POs never count as spend. Below the KPIs, **expect** a “Top vendors by open value” panel ranking where committed dollars are concentrated (POs without a vendor group under “(no vendor set)”) and - whenever a PO is received but not yet paid - a “Received but not paid” exceptions panel listing those POs oldest-first with a link to Vendor payments. In the past-orders table, **expect** each row to show the PO number with its witty codename underneath, vendor, status badge (plus a green “paid” badge once Accounts Payable settles it), a three-dot procure-to-pay trail (PO → Received → Paid - hover a dot for a plain-English explanation such as “received but not paid yet - settle it in Vendor payments”), line count, subtotal, and created date. Use the filter bar: pick a status, pick a vendor, or type into search - a PO number, a vendor name, or a codename word like “mellow” all find the right orders; press Filter. **Expect:** the URL carries your choices (shareable/bookmarkable), a “Clear filters” link appears, and a no-match search shows a friendly empty state instead of a blank table. With more than 25 matching POs, **expect** Prev/Next paging that keeps your filters, never lands on an out-of-range blank page, and shows “Showing X of Y POs”. **Red flag:** KPI money that disagrees with the table it summarizes; cancelled POs inflating spend; a received-but-unpaid PO missing from the exceptions panel (that is the three-way-match alarm); trace dots showing Paid before Accounts Payable stamped it; filters that reset when paging; or codename search finding nothing while the codename is plainly visible in the row.
- **T-234 (Emailed vendor menus - vendor_menu@ fetcher, snapshot browser, PO hand-off):** open Vendor Menus (Purchasing -> Vendor Menus) and scroll to the new “Emailed vendor menus” table. Have a vendor (or yourself) send a menu to the vendor_menu@ address - as body text, an HTML table, a CSV/TXT price sheet, or a PDF. **Expect:** within a minute of delivery the email appears as a row showing the sender (name + address), subject, a “Parsed from” badge naming the sources used (Body, Attachment, PDF - with “AI-assisted” only when the deterministic parser needed help), a status badge, an item count, and how long ago it arrived. Send an obvious spam email to the same address. **Expect:** it NEVER appears in the table (it is still recorded in the inbound email log with its junk classification). Click a menu row. **Expect:** a professional snapshot browser - the same card grid as Cultivera/GrowFlow with name, brand, category, size, strain and potency badges, the vendor's own description line, availability, and the wholesale price formatted from integer cents; photos attached to the email are saved to the media library and shown on the matching card; a provenance bar shows the subject, receive time, and whether the sender matched a vendor on file. Use the search box and category filter. **Expect:** the URL carries the filters and Clear resets them. Tick a few items and press “Add selected to purchase order”. **Expect:** the PO builder opens with a banner like “Started from an emailed menu: 2 items from Acme Farms…”, the ticked items pre-added as draft lines at qty 1 with the emailed wholesale price, and the vendor pre-selected only when the sender's address matches a real vendor on file; the URL carries only row ids - names and prices are reloaded from OUR saved snapshot, never from the URL. **Red flag:** spam creating a snapshot row; an item with an invented price the email never contained (the parser must skip unpriced lines, and AI transcription is re-validated by the same deterministic money rules); prices shown as floats instead of formatted cents; editing the URL's item ids changing prices (they must resolve against our stored rows); or an emailed photo attached to the wrong product card.
- **T-235 (LeafLink vendor menus - third marketplace in the unified search, snapshot browser, media saves, PO hand-off):** open Vendor Menus (Purchasing -> Vendor Menus). **Expect:** the search box now says it searches Cultivera + GrowFlow + LeafLink, and the help panel names all three platform badges. Search for a brand you know is on LeafLink (e.g. one of your wholesale brands). **Expect:** results with an ORANGE "LeafLink" badge alongside any green Cultivera / gold GrowFlow hits; each LeafLink hit shows the brand name (with the selling company appended when it differs) and a product count. Click "Fetch menu" on a LeafLink hit. **Expect:** the live brand menu is fetched through the crawler worker with your own LeafLink buyer login (politely paced) and saved as a snapshot; you land on its browse page - the same card grid as the other platforms with name, brand, category, size, product-line badge, strain and potency badges (potency only when LeafLink supplies a real percentage - milligram numbers like "100 mg" must NEVER be shown as a percent), the vendor's description converted from HTML to clean text, availability, MSRP, and the wholesale price formatted from integer cents. Use the search box and category filter. **Expect:** the URL carries the filters and Clear resets them. Press "Save image"/"Save COA" on a card and the snapshot-wide "Save all". **Expect:** photos/COAs land in the media library as drafts tagged "leaflink" + the brand, license pending review; saved cards flip to "image in library"/"COA in library" badges; re-saves reuse the existing asset. Tick a few items and press "Add selected to purchase order". **Expect:** the PO builder opens with a banner like "Started from a LeafLink menu: 2 items from Wyld…", the ticked items pre-added as draft lines at qty 1 with the listed wholesale price; the URL carries only row ids - names and prices are reloaded from OUR saved snapshot, never from the URL. Back on Vendor Menus, the new snapshot appears in the unified table with the orange badge, and searching that vendor again hits LeafLink FIRST (smart platform memory). If the crawler worker has no LEAFLINK_EMAIL/LEAFLINK_PASSWORD set, or migration 0145 hasn't been run. **Expect:** a friendly setup note - never a crash. **Red flag:** a milligram potency rendered as a percent; prices shown as floats instead of formatted cents; a search term that matches nothing returning the ENTIRE 4,600-item LeafLink catalog as "hits" (the worker must filter the platform's silent full-catalog fallback); editing the URL's item ids changing prices; or the search crashing when LeafLink credentials are missing.
- **T-236 (Vendor menu descriptions to KB - own description first, category fallback with badge):** open a Cultivera product from Vendor Menus and click into its sizes page. **Expect:** a size that carries its own description (e.g. a lineage note) shows it plainly with NO badge; a size with no description of its own shows the product-line description instead with a gold “category description” badge (hover it for the plain-English explanation) - exactly like the gold “placeholder image” badge works for photos. Open a LeafLink brand menu. **Expect:** a card whose product has no description but whose LeafLink category does shows the category text with the same gold “category description” badge; a card with its own description shows it unbadged. Press “Save to KB” / “Save image” on such items. **Expect:** the resolved description is saved into the product knowledge base gap-fill only - it fills an EMPTY description and never overwrites prose already curated in the KB; the audit log records honesty counters (descriptionFallbacks on Cultivera strain saves, descriptionWasFallback on LeafLink media saves) so you can see when a stand-in was used. GrowFlow items keep saving their own per-product description as before (GrowFlow's menu API has no category-level description, so there is nothing to fall back to). **Red flag:** a category stand-in overwriting a curated KB description; a stand-in shown WITHOUT the gold badge; the badge appearing on a product's own description; or the badge text/tooltip differing between the Cultivera sizes page and LeafLink cards.
- **T-237 (Resumable crawls - continue exactly where the page budget stopped, never re-fetching):** open a vendor's detail page (a vendor with a large website) and press "Research with AI". When the crawl finishes, check the research coverage draft in the AI suggestions. **Expect:** if the site had more pages than the budget (default 25), the verdict reads "BUDGET REACHED" and now tells you the fix in plain English - press "Continue crawl" - and the Harvest Console's "Incomplete sites" list shows the same site with "N read, M left queued". Go back to the vendor page. **Expect:** a gold "⏩ Continue crawl - M pages left (N read so far)" button now appears next to the research button; hovering it explains that already-read pages are never re-fetched; the button survives leaving and returning to the page (the leftover queue is remembered on the crawler worker for 30 days). Press it. **Expect:** a new harvest job starts labeled "Continue crawl: <vendor>"; when it completes, the coverage draft says "Continued crawl: run #2 - X page(s) read across all runs", and the Harvest Console incomplete-sites row shows "run #2 (X total read)" plus a "Continue on vendor page →" link. Keep continuing until the site is exhausted. **Expect:** the verdict flips to COMPLETE, the gold button disappears from the vendor page (nothing left to resume), and re-running "Research with AI" fresh starts over from scratch as before. **Red flag:** a continued crawl re-fetching pages a previous run already read (wasting time or credits - watch the pages count vs. the "total read" number); the Continue button appearing when nothing is left; the button surviving after the site is exhausted; `https://site.com` and `https://www.site.com` keeping separate resume states (they must continue the SAME crawl); or a corrupt/stale saved state crashing the crawl instead of quietly starting fresh.
- **T-238 (Harvested image previews - never an empty black box):** research a vendor whose site hosts photos on a hotlink-protected CDN (many Shopify/WooCommerce themes 403 images requested from another site). Open the vendor page's harvested-image grid. **Expect:** thumbnails paint normally - the browser first tries the image directly WITHOUT telling the CDN what page asked (no-referrer); if the CDN still blocks it, the thumbnail quietly reloads through our own admin-only preview relay, which asks again the way the vendor's own site would and converts formats browsers can't paint (TIFF, and AVIF when needed) to PNG on the fly. If BOTH paths fail, the box is NEVER a silent black/empty rectangle - it shows an honest "🚫🖼️ Preview blocked - open original" chip whose tooltip explains why, and clicking the tile still opens the original URL in a new tab. Try to abuse the relay: paste `/api/admin/image-preview?url=http://169.254.169.254/` or a `localhost` URL into the browser. **Expect:** refused (the relay enforces the same private-network guard as image imports, and requires the vendors permission - a logged-out visitor gets 401). Now press "💾 Save" on an AVIF or TIFF image. **Expect:** the import converts it to PNG and it lands in the Media Library as a normal draft; a HEIC (iPhone) or BMP image is refused with a plain-English message telling you to re-save it as JPEG/PNG - never a cryptic error; an image behind hotlink protection saves fine (the server retries with the site's own origin, exactly what the vendor's page sends). **Red flag:** an empty solid black/blank tile with no explanation anywhere; the relay fetching localhost/private addresses or working without login; a saved "image" that's actually an HTML page (magic bytes must win over the CDN's declared type); an AVIF/TIFF import failing when sharp is installed; or the no-referrer/proxy dance leaking OUR admin URL to the vendor's CDN as a referrer.
- **T-239 (Smarter text - edit drafts on the page, best-prose reference draft, fit advisories):** research a vendor with the crawler (or draft with AI), then look at the pending drafts on the vendor page. **Expect:** every writable profile draft (Mission statement, About, Product philosophy - vendor AND brand cards) now shows an "✎ Edit before accepting" button under the text; clicking it swaps the paragraph for a textarea where you can rewrite the draft, with a live character count, a "↺ Reset to original" button, and a note that your edit will be compliance-checked when you accept; pressing "✓ Accept & save" saves YOUR text (not the original draft), the suggestion is recorded with status "edited", and the audit log notes edited: true. Reference drafts (product lineup, images, coverage) and social handles show NO edit button - they never write a profile field. Now try to abuse it: clear the textarea completely and accept. **Expect:** the ORIGINAL draft is saved (an accidental select-all-delete never blanks a profile field); paste a novel past 20,000 characters and accept - refused with a plain-English "too long" message and nothing saved. Edit a draft to include a medical claim ("cures anxiety") and accept. **Expect:** the accept is REFUSED by the same WA I-502 compliance re-scan that guards unedited drafts - the edit can fix a blocked draft but can never sneak past the gate. Next, crawl a vendor site with real written pages. **Expect:** a new reference draft "Text found on their site - best paragraph per page" listing each crawled page's most substantial written paragraph with a FROM <url> line crediting its source - navigation link lists, cookie banners, price grids and copyright lines never appear; a paragraph repeated on every page (a footer blurb) appears once, credited to the first page; you can copy any of it into a profile field and edit it there before accepting. Finally, look at a crawled draft whose text is obviously wrong for its field (a link list or price sheet captured as "about"). **Expect:** advisory gold "fit:" flags on the card explaining what looks off (contains links/URLs, looks like a product/price list, no complete sentences, boilerplate, very short) - advisory ONLY: the draft is still accept-able after your edit, and clean prose gets no fit flags. **Red flag:** an edited accept saving the ORIGINAL text instead of yours; an empty edit box accepting an empty profile field; edited text skipping the compliance re-scan; an edit button on a reference/image/social draft; the research_text draft quoting navigation junk or missing its FROM source lines; fit flags BLOCKING an accept (they must never block); or the audit log not distinguishing an edited accept from a plain one.
- **T-240 (Seamless hub ↔ vendor flow - live crawl chip + light-up back-to-vendor buttons):** start a crawl from a vendor's page (🔎 Research) and land on the Harvest Console. **Expect:** the job card's old "Jump to vendor" links are now "Back to vendor" buttons that show the crawl's LIVE lifecycle - a dim gold ⏳ button while the site is queued, a pulsing purple ⛏ button while the crawler is reading it, and the moment the crawler finishes the button LIGHTS UP green (✅, soft glow) with the draft count (e.g. "✅ Acme Farms · 6 drafts") and now deep-links straight to the vendor page's AI-drafts section; a failed site shows a red ⚠ button that is still clickable so you can retry from the vendor page. Leave the console entirely (visit any other admin page, or close the tab) and come back. **Expect:** the buttons show exactly the same state - lit stays lit - because the state lives on the crawler worker's job list, not in the browser. Now open the vendor's own page while a crawl for it is queued or running. **Expect:** a live status chip under the "Research with AI" heading - "Crawl queued - waiting for the worker" (gold) or "Crawler is reading this vendor's site now - N pages so far" (pulsing purple), updating every few seconds without reloading; when the crawl finishes the chip flips green and glows: "Crawl finished - N drafts ready below (M pages read)" with a "Refresh to see the drafts ↻" link (a full reload, so the freshly written drafts actually appear) and a "Harvest Console →" link for hopping back; if the crawl found nothing the chip honestly says "no new drafts"; a failed crawl shows the plain-English error. Leave the vendor page and return. **Expect:** the chip still shows the same state (worker memory, not browser memory). A vendor that has NEVER been crawled shows no chip at all - the page looks exactly as before. **Red flag:** a back-to-vendor button lighting up green while its site is still queued/running; the lit state forgotten after leaving the console (it must be remembered); the chip polling forever after the crawl finished (it should stop once the final state is shown); the "Refresh" link doing a soft navigation that does NOT reveal the new drafts; discovery leads (no vendor page yet) getting a button; the chip appearing on vendors that were never crawled; or the chip breaking the page when the crawler worker is unreachable (it must just keep the last known state).
- **T-241 ("Save all assets" - the description saves are no longer silent):** open a Cultivera vendor menu (Purchasing → Vendor menus), click into a product line's detail page (the one that lists strains as size variants). **Expect:** the button that used to say "Save all N strain images to KB" now says "Save all assets to KB (N strains)" - because it has always saved each strain's DESCRIPTION into the Knowledge Base alongside the image, and now it says so. Click it. **Expect:** the summary under the button now includes a Descriptions sentence, e.g. "Descriptions: 3 saved to the Knowledge Base, 2 kept (already curated - never overwritten)." - "saved" means the prose landed in an empty KB slot, "kept" means the KB row already had a curated description and gap-fill preserved it; when a strain had no prose of its own the sentence adds "N used the product-line description as a flagged stand-in."; when nothing was available it honestly says "Descriptions: none were available to save." Now open a LeafLink or GrowFlow menu snapshot. **Expect:** each product's image button says "Save assets" (was "Save image") while the COA button still says "Save COA" (COA saves never touch descriptions, so their message says nothing about them). Click "Save assets" on an item WITH a description. **Expect:** the success message ends with "The vendor's description was saved to the Knowledge Base with it." (or "...already has a description for this product - your existing text was kept (never overwritten)." when you'd curated one; LeafLink items without their own prose say the category description was saved "as a flagged stand-in"). Click one on an item with NO description anywhere. **Expect:** "This menu item has no description, so there was nothing to add to the Knowledge Base." A description that trips the compliance blocklist reports "did not pass the compliance check, so it was not saved." - the image still saves. The single-product "save to KB" flow on the Cultivera detail page reports the same description outcomes after its image+KB sentence. **Red flag:** any save-image flow that writes a description staying silent about it; the message claiming "saved" when the KB row already had prose (it must say kept/never overwritten); a stand-in save not being flagged; COA saves mentioning descriptions; the button label still reading "Save image"/"strain images" on the KB-binding flows; or a compliance-blocked description being written to the KB anyway.
- **T-242 (Product Onboarding - category and type are editable on EVERY draft):** open Inventory → Product Onboarding with at least one draft the machine classified confidently (its row shows a category label and a type with a “N% confident” note) and, if you have one, a draft that still says “Needs category” / “Needs type”. **Expect:** every draft row's approve form now shows BOTH dropdowns - the category picker and the product-type picker - not just the rows below 90% confidence. On a confidently-classified row the pickers' first option reads “Keep auto: Cartridge” / “Keep auto: Gummies (95% confident)” and is pre-selected; approving without touching them keeps the machine's verdict exactly as before (the audit trail still credits the labeler, not a human). On a “Needs category/type” row the first option still reads “Pick a category…” / “Pick a product type…”, is disabled, and the browser refuses to submit until you choose - the 90% gate is unchanged. Now OVERRIDE a confident row: pick a different category or type and approve. **Expect:** the row's Category & Type column shows your pick with the “· your pick” note, and the product lands on the menu under YOUR pick (the injection log says “chosen by the approver”). The “➕ Create a new category…” option and its name box are also on every row now. **Red flag:** pickers still hidden on confident rows; a “Keep auto” approval being recorded as a human pick (it must submit no override); a required pick becoming skippable (empty option selectable on a Needs-category/type row); an off-list value being accepted; or the approve form losing the price box/floor guard.
- **T-243 (Product Onboarding - create a NEW product type inline, wired to Types & Categories):** open Inventory → Product Onboarding with any draft in the queue. **Expect:** the product-type dropdown now ends with “➕ Create a new product type…” and a “New type name (only if creating one)” box sits under it, on EVERY row; owner-created types you've added at Settings → Types & Categories already appear in the dropdown, grouped under their mapped website category (unmapped ones under “Other types”). Pick “Create a new product type…”, type a brand-new name a vendor invented (e.g. “Moon Sauce”), set the price and approve. **Expect:** the approval succeeds; the row shows Moon Sauce · your pick; Settings → Types & Categories → Inventory Types now lists Moon Sauce (active, not built-in, notes “Created during product onboarding.”) mapped to the website category the approval filed under; the audit log records inventory_type.created with created_during: draft_onboarding; and the very next draft's dropdown already offers Moon Sauce as a normal pick. Now try creating a DUPLICATE - pick “Create a new product type…” and enter an existing name (“Gummies”, any case). **Expect:** a friendly refusal banner - “A product type named “Gummies” already exists - pick it from the list instead.” - and nothing is created. Leaving the name box empty while “Create a new…” is picked also refuses with “A type name is required…”. **Red flag:** the new type NOT appearing on the settings page (the two surfaces must share one registry); a duplicate or blank name slipping through; the created type missing its category mapping when the approval had one; built-in catalog types appearing twice in the dropdown; or “Create a new product type…” submitting as a literal type named __new_type__.
- **T-244 (Product Onboarding - strain type: smart auto-read, always editable, saves to the strain library):** open Inventory → Product Onboarding with drafts in the queue. **Expect:** every draft row's approve form now has a “Strain type” dropdown (Indica / Sativa / Hybrid / Indica-Hybrid / Sativa-Hybrid / CBD) under the product-type picker. When the strain is already in the Knowledge Base, or the manifest stated it (the [H]/[I]/[S] intake split), or the product NAME carries it - full words (“Grape Ape Indica”), bracketed codes (“Moonbow 1g (H)”, “Gelato 41 (IH)”), or standalone tokens (“GG4 - sat 1g”, “Blue Dream S”, “Green Crack sh”) - the empty option reads “Keep auto: {Type} ({source}, N% confident)” at ≥90% and submitting it records NO override. A below-90% signal (e.g. “Indica Sativa Blend”) reads “Name hints … - pick to confirm” and is NEVER auto-assigned; no signal reads “Set strain type… (optional)”. Approve a draft whose name carries a clear code with “Keep auto”. **Expect:** the published menu card shows that strain type, and Knowledge Base → Strains now has the strain with the type filled (a missing row is created; a blank/unknown type is gap-filled; the audit log records kb.strain.type_from_onboarding). Now approve another draft and PICK a type that contradicts the KB. **Expect:** your pick wins on the card (the injection diagnostics disclose “chosen by the approver”) and the KB row flips to your pick with a before/after audit - a human pick is the only thing allowed to flip a curated value; a machine reading never overwrites an existing KB type. Word-boundary safety: names like “Sunset Sherbet”, “Indoor Grown OG”, “Watermelon CBD” must show “Set strain type…” (no false reads - Sherbet is not SH, Indoor is not IND, and CBD is deliberately never parsed from a name). Strain type is OPTIONAL - approving without touching it never blocks. On a database without migration 0146, making a pick shows a friendly banner naming 0146 instead of saving. **Red flag:** a below-90% hint auto-assigning; the machine flipping an existing KB type; “Sherbet/Indoor/CBD” misread as a type; a junk value sneaking past the dropdown; or the pick not persisting to the KB/menu card.
- **T-245 (Banking vault door: one tabbed page, badges on the files, old links keep working):** as the owner, open Admin → Banking from the top menu. **Expect:** ONE tabbed page - the vault door - opening on the Vendors tab (the vendor banking vault: masked table, add/edit form, verify + hold/release controls), with an Employees tab (direct-deposit table, masked) and a “My banking” tab (your company ACH origination settings, funding account masked). A security-posture strip across the top shows five controls (encrypted at rest, database lock/RLS, masked everywhere, audited, segregation of duties) - each chip is HONEST: if DATA_ENCRYPTION_KEY or migration 0143 is missing it goes amber and names exactly what to fix, never claiming protection that isn't live. Coverage lines under the tabs report real counts (“N of M vendors have banking on file”). Vendor and employee names in the vault tables link to their detail pages. Save your ACH settings on the “My banking” tab. **Expect:** you land back on that same tab with the confirmation. Now open a vendor's detail page. **Expect:** a “Banking (vault)” card in the right column with a status badge - grey “No banking on file”, gold “not yet verified”, green “verified”, or orange “ON HOLD” - showing at most the bank name and masked tail (••••1234), plus a link that jumps straight into the vault (pre-filled on that vendor when a record exists). An employee's file page shows the same style “Direct deposit (vault)” card. Sign in as a MANAGER and open the same pages. **Expect:** the badges are completely absent (managers run vendors and staffing but never learn whether/where anyone gets paid), and Admin → Banking itself refuses them. Finally, visit the old bookmark /admin/settings/payees (with or without ?tab=employees). **Expect:** it forwards to the Banking page on the right tab - nothing 404s - and the Settings hub now shows a single “Banking” card. **Red flag:** a full routing/account number anywhere outside the vault's edit form; a badge visible to a manager; the posture strip showing green while the key or migration is missing; the old payees URL breaking; or edits possible from the detail pages instead of the vault.
- **T-246 (Product detail “More from” rail: vendor-pure, enticement-ranked, equal-height cards):** open any product's detail page and scroll to the “More from” section at the bottom. **Expect:** every card in the rail belongs to the SAME brand-or-vendor named in the heading — when the viewed product has a brand, the rail shows only that brand; when it has only a vendor (blank brand, common for intake-created items), the rail shows only that vendor's products (their own sub-brands count) — another vendor's product NEVER leaks in (the original bug: a CERES topical under “More from 2727”). The rail is ranked to entice add-ons: in-stock first, then the same category as the viewed item (closest companion), then the closest price, deterministic order on every refresh; sold-out items sort last. When the brand/vendor has NO other products, the heading changes to “More” + the CATEGORY name and shows same-category products instead — the heading never advertises a brand the cards don't match, and “View All” only appears when the rail truly shows the brand. Now compare card heights in the rail AND on the shop grid, home daily-deals row, and specials grid. **Expect:** every product card in a row is exactly the same height — tall names, extra cannabinoid boxes, or a deal badge stretch the whole row, never just one card. **Red flag:** any off-vendor card under a vendor heading; the heading naming a brand while showing category fallback; ragged card heights in any row; the rail order shuffling between refreshes; or a sold-out card ranked ahead of purchasable ones.
- **T-247 (Deal badges on every relevant product card, all seven days):** visit the shop page, home page daily-deals row, specials page, any product detail page, and its “More from” rail. **Expect:** a rounded green deal badge (like “Doobie Tuesday · 20% off · or 4 for 3”) appears on EVERY card the day's published deals are relevant for — Monday: edibles, drinks, RSO, tinctures; Tuesday: prerolls, blunts, packs incl. all infused variants; Wednesday: carts/concentrates; Thursday: only the featured sale brands; Friday: all flower; Saturday and Sunday: ALL cannabis cards (storewide) — merch never badges. The badge text comes from the back office's PUBLISHED promotions, so editing a deal or publishing a flash sale (date-window promo) updates the badges automatically. The product detail page shows the same badge above the price. SLICE 40 stays intact: Friday/Saturday/Sunday cards still show the REGULAR price (no struck-through discount) while the badge advertises the deal — the cart reveals the real savings; Monday–Thursday keep both the struck price AND the badge. **Red flag:** a badge missing from a relevant card on any surface; a badge on an irrelevant item (e.g. flower on Monday, edibles on Tuesday, non-featured brands on Thursday); a badge on merch during storewide days; a struck price appearing Fri/Sat/Sun; or badge text differing between the shop card and the More-from rail card for the same item.
- **T-248 (Vendor logo + description: back office → public vendors page):** in the back office open Admin → Vendors, pick a vendor that appears on the public “Vendors & Partners” page (it must have published menu items), upload a logo on its detail page, fill in the About (or Mission statement) field, and save. Then open the public vendors page (/vendor-delivery). **Expect:** that vendor's card now shows the uploaded logo (both the collapsed card and the expanded overlay) and, on desktop expand, the vendor's own About/Mission text instead of the generic placeholder paragraph — without redeploying (the profile save revalidates the public page). Matching tolerates name drift: the menu vendor name matches the profile by exact name, by a vendor alias, or by normalized name (“Fair-Winds, LLC.” matches “Fair Winds LLC”). Vendors with NO uploaded logo or written copy keep the placeholder art/copy exactly as before, and the “placeholders pending final vendor assets” footnote only appears while at least one card still falls back. Assigning a harvested logo (“Save & assign as logo”) refreshes the public page the same way. **Red flag:** a saved logo not appearing on the public page; a broken image on any card; the placeholder paragraph showing for a vendor with About text; enrichment changing product counts or card order; or the footnote claiming placeholders when every card shows real assets.
- **T-249 (Topicals, edibles and liquids show OUNCES, not grams - flower stays grams):** on the customer website, open the menu and filter to Topicals. **Expect:** the price unit on every topical card reads in ounces (e.g. “$26.00/3.4 oz” instead of “/96.4 g”), agreeing with the net-weight line on the same card (“3.4 oz (96.4 g)”). Open a topical's detail page. **Expect:** the package-size buttons read in ounces too. Now check Edible (Solid), Edible (Liquid) and Tincture products. **Expect:** solid-edible gram labels show as ounces and liquid milliliter labels show as fluid ounces (e.g. “12 fl oz” for a 355ml beverage); dose-only labels like “100mg” and pack labels like “10pk” are untouched. Add a converted item to the cart and walk it through checkout to the confirmation page. **Expect:** the cart drawer line, the order-summary line and the confirmation receipt all show the ounce label. Now open any FLOWER, preroll, concentrate or cartridge product. **Expect:** grams everywhere, exactly as before (“/3.5g”, “/1oz” etc.) - only topicals, edibles, liquids and tinctures converted. Finally, as staff, ring a converted product at the register and check the back office. **Expect:** the register, order lines in the dashboard, purchase-limit math and daily-deal pricing all still key off the original POS label - the ounce text is customer display only. **Red flag:** a flower card showing ounces for a gram size; a “100mg” dose label converted; the cart failing to match a line after the change; limit math or ounce-tier deals misbehaving on converted categories; or the ounce figure disagreeing with the card's own net-weight line.
- **T-250 (Vendors page — vendor-relations contact channels + editable outreach copy):** on the customer website, open Vendors & Partners. **Expect:** under the “Let's Work Together” section, five contact-channel cards appear: Sample Drops, Promotions & Deals, Vendor Days, Send Us Your Menu, and Transfer Manifests. Check the addresses printed on the cards. **Expect:** Sample Drops, Promotions & Deals, Vendor Days and Transfer Manifests all show vendor_intake@greenwaymarijuana.com; Send Us Your Menu shows vendor_menu@greenwaymarijuana.com; ONLY the menu and manifest cards carry the “Parsed automatically” note. Click each card. **Expect:** your mail app opens a draft addressed to the printed mailbox with a prefilled subject naming the channel (e.g. “Sample drop — [your brand]”) and a completely BLANK body — same rule as the existing “Email Our Buying Team” button, which must still be present and unchanged above the cards. Now email a menu to vendor_menu@greenwaymarijuana.com and confirm it appears under Purchasing → Vendor Menus in the back office; email a transfer to vendor_intake@greenwaymarijuana.com and confirm it stages under Inventory → Receiving. Finally, as staff, open Website → Content and find “Vendor outreach — paragraph”. **Expect:** editing and publishing it changes the paragraph under the outreach heading on the public vendors page (the default text matches the previous hardcoded wording exactly); the heading block still works as before. **Red flag:** a card addressed to a mailbox other than the two real accounts; a mailto draft with a prefilled body; “Parsed automatically” shown on a human-conversation card; the buying-team button missing; or the paragraph edit not reaching the public page.
- **T-251 (Receiving — Invoice # column key-term scan + manifest-number fallback):** open Inventory → Receiving and look at the Invoice # column of the Incoming (email) table. **Expect:** a row staged from a Cultivera/GrowFlow WCIA transfer still shows the vendor's order/invoice number (e.g. 0000020830 or 29127); a row staged from an OpenTHC combined invoice-manifest PDF shows the full invoice ULID (e.g. 01KQ7GS6EXA3DV5M); a row whose paperwork prints the number in another form — “Invoice #:”, “Invoice No.”, “Order Number”, “PO #”, or the Cultivera layout where the order number rides directly in front of its own “Order #:” label — shows that number. Now find a row whose documents carry NO invoice or order number in any form (an LCB Internal Shipping Document or a CCRS CSV import). **Expect:** the Invoice # cell shows the manifest number instead of a dash — the column is never blank when a manifest number exists. Hover the Invoice # column header. **Expect:** the tooltip explains the manifest-number fallback. **Red flag:** a dash in the Invoice # cell while the row has a manifest number; an invoice cell showing a label word (like “Order” or “Date”) instead of a real number; or a PO Box address line mistaken for a purchase-order number.
- **T-252 (Receiving — intake table filter + partial acceptance with mandatory why-partial note):** open Inventory → Receiving. **Expect:** the Incoming (email) table shows a Needs attention / All toggle; the default Needs attention view HIDES manifests already accepted or partially accepted while pending, in-transit, received and rejected rows all stay visible; the All view shows everything with the open rows FIRST, then the processed ones, and its label counts how many processed rows the default view is hiding. Now open a pending manifest, refuse at least one line (Reject with a reason) while accepting the rest, and click Finalize intake WITHOUT filling the note next to the button. **Expect:** the browser requires the note field (and if it somehow submits, the server bounces back with a “Note required” banner and NOTHING is changed — no lot activated, no status stamped). Fill in a short reason (e.g. “two cases crushed in transit”) and finalize again. **Expect:** the manifest lands as “Partially accepted” with the 🟠 badge (distinct from the green 🟢 Accepted badge) in the table, no return-manifest or quarantine paperwork is demanded, and the manifest timeline's Finalized entry includes “Why partial:” followed by your note. A fully-accepted manifest must finalize WITHOUT requiring any note. **Red flag:** a partial finalize going through with no note; the note missing from the timeline; accepted/partially-accepted rows still showing in the Needs attention view; rejected rows hidden by the default view; or the partial badge rendering as plain “Accepted”.
- **T-253 (Receiving — vendor gold miner: profile gap-fill from the manifest's own documents):** pick (or create) a vendor whose profile is missing its email, phone, WA license number or shipping address, then forward that vendor's real intake email (manifest PDF and/or invoice PDF and/or transport manifest attached) to the intake mailbox and let it stage. **Expect:** the staged manifest's timeline gains a “Vendor gold-miner” entry naming exactly which fields were filled and which document each value came from (e.g. “phone … (from the transport manifest)”), and the vendor's profile page now shows those values in the matching boxes. Columns that already had a value must be UNTOUCHED — the miner fills empty boxes only, never overwrites. The mined details must belong to the VENDOR: never Greenway's own license 413541, phone or @greenwaymarijuana.com address (every document also prints our destination block), never the transport CARRIER's license, and never a lab's contact from a COA. A no-reply / platform sender (Cultivera, GrowFlow, LeafLink) must never land as the vendor's email. If the vendor's profile already carries a DIFFERENT license number than the paperwork, **expect** the timeline to show a SKIPPED note about the license conflict and the profile left completely unchanged. Older manifests staged before this feature get the same enrichment when finalized (the KB write-back runs the miner over the stored document text). **Red flag:** an existing profile value overwritten; our own store's details landing on a vendor; a carrier or lab contact proposed as the vendor's; or a fill with no timeline entry naming its source.
- **T-254 (Receiving — faster finalize + honest progress bar):** open a staged manifest with a good number of line items (the bigger the better), accept the lots and press “Finalize”. **Expect:** the finalize completes noticeably faster than before (the lot activations now land as batched database writes and the six follow-up chores — onboarding drafts, COA archiving, knowledge-base write-back, usual-transport memory, sample ledger, PO auto-receive — run at the same time instead of one after another), and the slim green progress bar at the top of the page stays visible the WHOLE time the save is running instead of giving up after 20 seconds. If the save runs longer than about 10 seconds, **expect** a small “Still working — Ns. Big saves (like finalizing a manifest) can take a while; leave this page open.” pill under the bar counting the elapsed seconds. The moment the save lands the bar and the pill both disappear and the page shows the finalized manifest exactly as before: correct activated/refused counts on the timeline, per-lot received quantities on the inventory adjustments, onboarding drafts created, COAs archived, and the PO auto-receive note when a purchase order is linked. Plain link clicks around the back office must still clear their bar quickly (the long leash is only for form saves). **Red flag:** the bar vanishing while the finalize is still running; the “Still working” pill appearing on ordinary page navigation; wrong received quantities after the batched writes; or any follow-up chore (drafts, COAs, PO receive) silently missing after finalize.
- **T-255 (Website — Header & Footer editor + editable footer links):** in the back office open **Website → Header & Footer**. **Expect:** a focused editor listing the footer links and the friendly “not connected yet” message, with a TALL live preview of the site (defaulting to the homepage where the footer lives) and page buttons across the top for EVERY public page (Homepage, Shop, Specials, About, Location, Price Match, Loyalty, Medical, Vendors, Blog, FAQ, and the three legal pages). Before you touch anything, scroll to the footer on the live site — the five “Follow Greenway” social icons (Facebook, Instagram, Google, Yelp, Leafly) must look and behave EXACTLY as before (each opens the right page in a new tab). Now click one of the two App download icons (Apple / Google Play): **expect** a small, tidy pop-up with a gold “Coming soon” heading and your editable message (“This isn’t available just yet — check back soon…”), NOT a jump to a broken “#” link. The pop-up must close when you press Escape, click the “Got it” button, or click away, and keyboard focus returns to the icon. Back in the editor, change the “not connected yet” message, Publish, and confirm the App icons now show your new wording. Paste a real web address into one of the Follow Greenway link boxes, Publish, and confirm that social icon opens your new destination. Leave a Follow Greenway box blank, Publish, and confirm THAT icon now shows the friendly pop-up instead of navigating. Every edit is a draft-then-publish with History/rollback, just like Site Content. Finally, open **Website → Site Content** and confirm its live preview is now much TALLER and also lists every public page. **Red flag:** the footer looking different before you edit anything; a social icon that used to work now showing the pop-up; the App icons jumping to “#” instead of showing the message; the pop-up not closing on Escape/click-away; a published link not taking effect on the live footer; or the Header & Footer / Site Content preview being short or missing pages.
- **T-256 (Website — bigger store-hours text + editable phone overlay in the top green bar):** in the back office open **Website → Header & Footer**. **Expect:** among the editable items you now see a **Store hours text size** picker (a simple dropdown: Normal, Large, Extra large, Huge) and a **Phone button text** box. First, before changing anything, look at the top green bar on the live site (the strip UNDER the page menu that shows your address on the left, the store hours in the middle, and the phone button on the right): the hours must read exactly as before (“Mon-Sun 8am-11pm” on desktop, stacked on phones) and the phone button must still say “360-BUY-WEED” — pixel-identical to today. Now set the hours size to **Large** (or Extra large / Huge), Publish, and reload the live site: **expect** the hours text in the middle of the green bar to get noticeably BIGGER while the address and phone stay put and nothing wraps or overlaps on phone, tablet, and desktop. Set it back to **Normal** and confirm it returns to the original size. Next, change the **Phone button text** to something like “Call 360-BUY-WEED”, Publish, and reload: **expect** the phone button to show your new wording — BUT tapping it on a phone must STILL dial the real number (+1 360-443-6988); only the visible text changed, never the number that gets dialed. Every edit is a draft-then-publish with History/rollback, exactly like Site Content. **Red flag:** the top bar looking any different before you edit; the hours size picker or phone box missing; changing the size not affecting the hours (or making the bar wrap/overlap); the phone button not updating to your text; or — most important — tapping the phone button dialing the WRONG number or not dialing at all.
- **T-257 (Website — edit the Privacy Policy, Terms of Use & Consumer Health Data pages):** in the back office open the new **Website → Legal Policies** page. **Expect:** three tabs — **Privacy Policy**, **Terms of Use**, and **Consumer Health Data** — each showing that policy’s text as a simple, editable list of rows, where every row is marked either a **Heading** or a **Paragraph**, plus a live “as customers see it” preview and a clear caution banner reminding you this is legal wording. First, before changing anything, open each of the three live pages (Privacy Policy, Terms of Use, Consumer Health Data) and confirm they read EXACTLY as before — same headings, same paragraphs, same order, and the cross-reference links between the policies (and the WA Attorney General link on the Consumer Health Data page) still work. Now, on one tab, edit a paragraph’s wording, use the ↑/↓ buttons to reorder a couple rows, add a new row, flip a row between Heading and Paragraph, then click **Save draft** and **Publish**. Reload that live page: **expect** your changes to appear exactly as you arranged them, headings still look like headings and paragraphs like paragraphs, and the links still work. Open **History** and **restore** an earlier version, then Publish again: **expect** the page to return to the older wording. Every edit is a draft-then-publish with History/rollback, exactly like Site Content, and it also updates the hero title at the top of each policy page. **Red flag:** any of the three pages reading differently BEFORE you edit; a page going blank or losing headings; the Heading/Paragraph, reorder, add, Save draft, Publish, or History/restore controls missing or not working; the cross-reference or WA AG links breaking; or a published edit not showing up on the live page.
- **T-258 (Website — control how the weekly deals are shown on the Specials page):** in the back office open the new **Website → Specials** page. **Expect:** controls for HOW the weekly deals are PRESENTED — a switch for the weekly-deals grid, a switch for the “Today’s Deals” products grid, an offer-badge style picker, and one row per weekday with a **Show** checkbox, ↑/↓ reorder buttons, and optional boxes to override that day’s title, offer line, and description — plus a live “as customers see it” preview and a clear gold banner reminding you this controls PRESENTATION ONLY, not the prices (with links to **Promotions** and the discount **simulator**). First, before changing anything, open the live **/specials** page and confirm the weekly deal cards read EXACTLY as before — same days, same order, same offer chips — and that today’s products grid still shows. Now hide one weekday, reorder a couple of days, switch the badge style, and type a title override on one day, then click **Save draft** and **Publish**. Reload /specials: **expect** the hidden day’s card to be gone, the days in your new order, the offer chips restyled, and your override wording showing — while the actual prices/percentages are unchanged. Open the back-office **Promotions** page: **expect** a “where this shows up” panel and a heads-up listing any published weekday deal whose card you just hid (it still applies at the register and on the menu). Open **History** and **restore** an earlier version, then Publish: **expect** the Specials page to return to how it was. **Red flag:** the /specials cards reading differently BEFORE you edit; the price or percentage of any deal changing when you only changed presentation; the Show/reorder/badge/override, Save draft, Publish, or History/restore controls missing or not working; a published presentation change not showing on /specials; or the Promotions “where this shows up” / hidden-deal heads-up missing.
- **T-259 (Website — show/hide the Medical page and edit its copy):** in the back office open the new **Website → Medical page** editor (this is NOT the staff **Medical** patient-intake tool). **Expect:** a red “keep it honest” compliance caution, a **Visible / Hidden** switch for the whole page, and one editable field per section heading and per info line (What to bring / What your card gets you), each with **Save draft**, **Publish**, and **History**. First, before changing anything, open the live **/medical** page and confirm every heading and info line reads EXACTLY as before, the purchase-limit **table** shows, and the **Medical** link appears in both the desktop top menu and the mobile menu. Now edit one heading and one info line, click **Save draft** then **Publish**, and reload /medical: **expect** your new wording to show while the tax/limit fine print and the limits table are unchanged. Next set the page to **Hidden** and **Publish**: **expect** /medical to show a “not found” page and the **Medical** link to disappear from BOTH menus. Set it back to **Visible** and Publish: **expect** the page and its menu link to return. Open **History** on any field and **restore** an earlier version, then Publish: **expect** that field to return to how it was. **Red flag:** the /medical page reading differently BEFORE you edit; any tax figure, purchase limit, or the limits table changing (those must be locked); the Visible/Hidden switch, Save draft, Publish, or History/restore not working; a hidden page still reachable or its link still showing in a menu; or the public editor being confused with the staff patient-intake Medical tool.
- **T-260 (Website — edit the Loyalty page wording):** in the back office open the new **Website → Loyalty page** editor (this is NOT **CRM → Loyalty Program**, where the actual points/tiers are set, and NOT the **Loyalty signups** inbox). **Expect:** a gold “what you can and can’t change” caution, a read-only panel showing the LIVE program numbers (points, dollar value, member tiers) with a link to CRM → Loyalty Program, and one editable field for the signup button, the birthday note, the thank-you message, and each “Program terms” heading — each with **Save draft**, **Publish**, and **History**. First, before changing anything, open the live **/loyalty** page and confirm the signup button, birthday note, and the “Program terms”/“Member tiers” headings read EXACTLY as before, and the program numbers + the marketing-consent paragraph show as usual. Now edit the button label and a heading, click **Save draft** then **Publish**, and reload /loyalty: **expect** your new wording to show while the consent paragraph and every program number are unchanged. Open **History** on any field and **restore** an earlier version, then Publish: **expect** that field to return to how it was. **Red flag:** the /loyalty page reading differently BEFORE you edit; the marketing-consent paragraph or any program number/tier becoming editable or changing here (those must be locked/live); Save draft, Publish, or History/restore not working; or this editor being confused with CRM → Loyalty Program or the Loyalty signups inbox.
- **T-261 (Public — no competitor names in the consent + price-match copy):** open the public **/loyalty** page and read the marketing-consent paragraph under the signup form. **Expect:** it names **Greenway Marijuana** (“I am allowing Greenway Marijuana to retain my personal contact details…”) and it must NOT contain “Uncle Ike’s”, “AIQ”, or any third-party “technology provider” clause, while still keeping the STOP opt-out, standard-rates, legal-age, and “Consent is not a condition of purchase” sentences. Then open the **FAQ** page and find the price-match question (“Does Greenway Marijuana Offer a Price Match?”): **expect** the answer to say Greenway Marijuana will price match — NOT “Uncle Ike’s.” **Red flag:** the words “Uncle Ike’s” or “AIQ” appearing anywhere on the public site; or the consent paragraph losing any of its required legal sentences.
- **T-262 (Admin + Public — Legal Policies dark theme + Medical high-CBD CTA):** in the back office open **Website → Legal Policies** and look at the editor. **Expect:** it now matches the dark admin theme — the warning strip at the top is a **GOLD** caution bar (not amber/white), the text boxes are dark (not white), the per-section **Delete** button is the standard red danger button (same style as elsewhere), and the up/down + Restore buttons highlight in the dark hover color. Nothing about editing/publishing behavior changes. Then open the public **/medical** page: click the in-text “menu” link in the CBD tax-savings paragraph AND the “Shop the menu” button on the “See your savings before you visit” card. **Expect:** both land on the menu with the **CBD filter already applied** (URL ends **/menu?strains=cbd**, the “CBD” strain chip is on, and only high-CBD items show). **Red flag:** any white/amber box left in the Legal Policies editor; a Delete button that looks different from the app’s other danger buttons; or a Medical link that goes to the plain **/menu** with no CBD filter.
- **T-263 (Admin — Specials editor upgrade: tabs + banner image + count + text position):** in the back office open **Website → Specials**. **Expect:** the page now has two **tabs** near the top — **“Weekly deal cards”** and **“Today’s Deal banner & products”** — and every text box is **dark** (no white boxes). On the **Weekly deal cards** tab, the 7 day cards, their show/reorder, the badge-style picker, and the copy overrides work exactly as before. Switch to the **Today’s Deal banner & products** tab: **Expect** a **Show today’s live products** toggle with a **Products to show** number box right next to it (allowed **1–24**, default **16**); a **Today’s Deal banner image** picker with the same helpers everything else has (**paste a URL** OR **Choose from Media Library** + a **Canva size hint**); and **Banner text position** buttons — **Left / Center / Right** and **Top / Middle / Bottom** — with a live banner preview that shifts the title/subtitle as you click. Leave the image blank to keep the built-in art. Set an image, pick a position, change the count, then **Save draft** → **Publish** and open **/specials**: **Expect** the new banner image, the title/subtitle (still coming from **Promotions**) positioned where you chose, and the live-products grid capped at your count. Also open **Creative Studio** and confirm a **“Specials banner”** preset and a **“Specials — Today’s Deal banner”** destination now exist. **Red flag:** any white input left in the Specials editor; the count box missing or accepting values outside 1–24; the banner image/position not showing on /specials after Publish; or the banner’s wording changing (it must still come from Promotions).
- **T-264 (Admin — Home page editor superpowers: card counts + banner art):** in the back office open **Website → Pages → Home** and click the **Sections** tab. **Expect:** a new **“Home page display”** card at the very top with a **“Today’s Deal highlights — cards shown”** row of buttons (**4 / 8 / 12 / 16 / 20 / 24**, with **16** marked default). Pick a different number and click **Save & publish**, then open the home page **/**: **Expect** the daily-deal highlights grid (the products right under the hero) now shows exactly that many cards. Back in the editor, open the **“Shop by Brand”** section: **Expect** a **“Grid — cards shown”** control with the same choices; change it, **Save draft → Publish**, and confirm the brand grid on **/** shows that many tiles. Also confirm the **Category** and **Brand** banner image pickers still have the full helpers (**paste a URL** OR **Choose from Media Library** + a **Canva size hint** that names the exact wide band size). Finally open **Creative Studio** and confirm a **“Homepage banner band”** preset now exists (16:9, textless) for generating replacement art for the category/brand background bands. **Red flag:** the count controls missing; the home page ignoring your chosen count after Publish; a count outside 4–24 being accepted; the banner image pickers losing their Media-Library/Canva helpers; or the “Homepage banner band” preset not appearing in Creative Studio.
- **T-265 (Admin — Order name pool + printer status/test on the Orders page):** in the back office open **Orders**. **Expect** at the top a **printer status** strip showing the printer label with a **Connected / Not seen recently / Not set up** chip and a **Send test print** button; click **Send test print** and **Expect** a green “test print queued” note (and, if the printer is on + connected, a sample receipt prints). Below that find the **“Order name pool”** card; click **Manage**. **Expect** a **“Next few orders will be named…”** preview row of chips. Add a fun name (e.g. **High Life**) and click **Add name**: **Expect** it appears in the list and in the preview. Try adding the SAME name again (any capitalization/spacing): **Expect** a friendly “already in the pool” message (no duplicate). Type a name like **Nugs4Thugs**: **Expect** a NON-BLOCKING ⚠️ compliance heads-up that still lets you add it. Use the **▲/▼** arrows to reorder, **Disable** a name (it stays in the list, struck through, and drops out of the preview), **Edit** to rename, and **Remove** to delete. Then place a test **online order** and open it under **Orders**: **Expect** the friendly name shown as the order’s title (with the small **#GWY-XXXXXX** number still visible), the same friendly name on the **pickup ticket** and the confirmation email/page, and a **“🎲 Reroll name”** button on the order that swaps in the next pooled name. **Red flag:** duplicates slipping in; the compliance nudge BLOCKING a save; the friendly name not reaching the ticket/email; the GWY number disappearing from search; the printer chip or test-print button missing; or (most important) checkout breaking / orders losing their GWY number when the pool is empty or migration 0147 isn’t applied.
- **T-266 (Vendors page — redesigned partner cards + fully editable page body/emails):** visit the public **Vendors & Partners** page (**/vendor-delivery**). **Expect** the partner grid to show **dark cards with a glowing side-lit border** (like the product cards) — NOT a solid colored background — each with a **slim vendor-name bar at the top**, the **logo filling nearly the whole card**, and a **product-count** line at the bottom. **Tap** a card: **Expect** a clean overlay with the vendor name + a short blurb (and “Tap to close”), with nothing overlapping the logo. The blurb prefers the vendor’s **mission statement**, then **about**, then **product philosophy**. Next, turn on **Preview** (back office) and open the page: click the **✎ Edit** hotspot on the outreach heading/paragraph, and in **Site Content** find the **Vendors** page group — **Expect** editable blocks for the outreach **heading**, **paragraph**, **email subject** for the “Email Our Buying Team” button, and — for each of the five channels (**Sample Drops, Promotions & Deals, Vendor Days, Send Us Your Menu, Transfer Manifests**) — the **title**, **description**, **email** (a mailbox you can set manually), and **subject**. Edit an email/subject, **Publish**, reload the page and click that channel: **Expect** the mailto opens with your new address + subject (and a BLANK body). **Red flag:** cards showing solid colored backgrounds again; the logo cropped or tiny; the blurb overlay overlapping the name/logo; a channel email/subject not editable or not taking effect after publish; the email body no longer blank; or the page looking different from today BEFORE anything is edited.
- **T-267 (Blog page editor + Canva jump + connections):** visit the public **Blog** page (**/blog**). **Expect** it to look EXACTLY like today (the “The Blog” eyebrow, the **Stories / Culture / Newsletters** heading, the intro line, and orange **Read article** buttons on each card) BEFORE anything is edited. Open a post: **Expect** the **← Back to blog** link at the top. Now turn on **Preview** (back office) and open **/blog**: click a **✎ Edit** hotspot on the eyebrow / a heading word / the intro, and in **Site Content** find the **Blog** page group — **Expect** editable blocks for the **eyebrow**, the three **heading words**, the **intro**, the **Read article** button label, and the **Back to blog** label. Change one (e.g. the button label), **Publish**, reload **/blog** — **Expect** every card now shows your new label; and note your actual blog POSTS were untouched (still managed only under **Blog & posts**). In the back office open **Blog & posts** and **Email Newsletter**: **Expect** an **Open Canva** button on both (opens **canva.com** in a NEW TAB using your already-signed-in Canva session — it does NOT log you in from a link, and no password is ever stored), plus quick-links tying Blog ↔ Newsletter ↔ Site Content (Blog) ↔ the live **/blog**. To point the button at your own Canva team/brand link, set **NEXT_PUBLIC_CANVA_URL** in **Vercel → Settings → Environment Variables** and redeploy. **Red flag:** /blog looking different from today BEFORE editing; a blog block not editable or not taking effect after publish; editing the page chrome changing/erasing a real post; the Open Canva button missing, opening a non-canva.com site, or claiming to auto-login; or the sitemap missing published posts.
- **T-268 (Shop page layout — filters hug left, wider 4-up cards; + Legal title input themed):** open the public **Shop** page (**/menu**) on a wide monitor (ideally **1440px** and **1920px**). **Expect** the **filters** panel to **hug the left edge** (only a small page gutter, not a big empty margin), the hero banner + the product area to **fill to the right edge**, and **still four product cards per row** — just **wider** than before. **Expect** the **category heading** (e.g. “All Products” / “Flower”) to sit on the **left**, aligned with the cards, and the **search box + SORT BY** on the **right**; and the **HOME / SHOP** breadcrumb to line up flush-left with the hero. Shrink the window to a **tablet** (~820px) and a **phone** (~390px): **Expect** NO change from before — two cards per row on tablet, one on phone, with the search/sort row and the **Filters & Categories** dropdown intact. Separately, open **Back office → Website → Legal Policies**: **Expect** the **Page title** input to be a **dark themed** box (matching every other admin field), NOT a white box. **Red flag:** big empty margins still on the left/right at 1440/1920; more or fewer than four cards per row on desktop; the heading/search/sort no longer aligned to the cards; ANY change to the tablet/phone layout; or the Legal Policies title box still white.
- **T-269 (Specials deal cards now glow like product/vendor cards; + Today’s Deal banner text no longer moves the image):** open the public **Specials** page (**/specials**) on a wide monitor (**1440px** and **1920px**). **Expect** the seven **Weekly Cannabis Deals** cards (Munchie Monday … Ice Cream Sunday) to **GLOW** exactly like the **product cards** on the Shop page and the **vendor cards** on the Vendors page — a **dark tile** with a **soft side-lit colored glow** and **thin glowing edges** (a bright line down the left, one down the right, and a soft line along the bottom). Each card keeps its own accent color. **Expect** everything else on the cards to be **unchanged**: the day label, the big headline, the **offer chip** (e.g. “20% OFF”), the product artwork mockup, the details lines, and the orange **SHOP NOW** button. Shrink to a **tablet** (~820px) and a **phone** (~390px): **Expect** the same glow, with **two cards per row** on tablet and **one per row** on phone. Next, scroll to the **TODAY’S DEAL** wide banner (the strip above the live product grid). It should look **exactly as it does today** — the text on the **left**, the photo on the **right**. Then in **Back office → Website → Specials**, open the **Today’s Deal banner** tab and change the banner text alignment to **center** and then **right**, and **Publish**. Reload **/specials**: **Expect** the **text** to move as you chose but the **background photo to STAY PUT** — it must NOT slide to the opposite side the way it used to. **Red flag:** the deal cards look flat / no glow / no edge strips, or the glow does not match the product & vendor cards; any deal-card text, chip, artwork, details, or button moved or disappeared; the tablet/phone card counts changed; or moving the banner text still drags the banner photo with it.
- **T-270 (Specials TOP hero banner can now show your own image; + Open Canva in the editor + new Creative Studio preset):** first, WITHOUT changing anything, open the public **Specials** page (**/specials**). **Expect** the big **CANNABIS SPECIALS** hero at the top to look **exactly as it does today** — the dark gradient banner with the eyebrow, title, and subtitle on the **left** and **no photo**. Now go to **Back office → Website → Pages → Specials** (the page builder), find the **top hero** section, set its **image** (paste a URL or pick one from the Media Library) and choose an **image focus** of **right**, then **Publish**. Reload **/specials**: **Expect** your image to now appear **behind** the hero, with the eyebrow/title/subtitle **still clearly readable** over a dark fade, and the art sitting toward the **right**. Change the focus to **left** and Publish again: **Expect** the visible part of the image to shift accordingly. Check a **tablet** (~820px) and a **phone** (~390px): **Expect** the image + readable text on both. Clear the image back to blank and Publish: **Expect** the hero to return to the **gradient-only** look. Next, open **Back office → Website → Specials** (the presentation editor) and in the header **Expect** an **Open Canva** button (it opens Canva in a new tab). In the **Today’s Deal banner** tab **Expect** a **“Top hero banner image”** note that links to the Specials page builder. Finally open **Back office → Marketing → Creative Studio**: **Expect** a new **“Specials — top hero banner”** website preset. **Red flag:** with no image set the hero looks different from today; a set image does not appear, or covers/obscures the title so it is hard to read; the focus control has no effect; the image is missing on tablet/phone; the Open Canva button, the hero-image note, or the new Creative Studio preset is missing.
- **T-271 (Each weekday Specials deal card can now show your own PHOTO; + new Creative Studio preset):** first, WITHOUT changing anything, open the public **Specials** page (**/specials**) and scroll to **WEEKLY CANNABIS DEALS**. **Expect** each weekday card (Munchie Monday, Doobie Tuesday, Wax Wednesday, …) to look **exactly as it does today** — the built-in white **package graphic** with the initials circle and category chip. Now go to **Back office → Website → Specials** (the presentation editor), find the **Weekday cards** column, pick a day (say **Monday**) and use its new **Card photo (optional)** picker to set an image (paste a URL or pick one from the Media Library), then **Publish**. Reload **/specials**: **Expect** the **Monday** card’s white panel to now show **your photo** (same size/shape as the graphic it replaced), with the small category chip still in the **top-left corner**, and the title, offer, and **SHOP NOW** button unchanged around it. Every OTHER day you did **not** set a photo for **Expect** to still show the built-in graphic. Check a **tablet** (~820px) and a **phone** (~390px): **Expect** the photo to fill the panel cleanly on both. Clear the Monday photo back to blank and **Publish**: **Expect** the Monday card to return to the **built-in graphic**. Finally open **Back office → Marketing → Creative Studio**: **Expect** a new **“Specials — weekday deal card photo”** website preset (a portrait-ish, slightly-taller-than-wide size). **Red flag:** a day with no photo looks different from today; a set photo does not appear, spills outside the panel, or hides the category chip / title / SHOP NOW button; the photo is missing on tablet/phone; the discount or offer text changes when you add a photo; the new Creative Studio preset is missing.
- **T-272 (Specials TOP hero can now be MOVED — text position + image focus wiring; unchanged today):** open the public **Specials** page (**/specials**) and look at the big **TOP hero** strip (the one that says **DEALS EVERY DAY / CANNABIS SPECIALS**). **Expect** it to look **exactly as it does today**: the eyebrow, title, and subtitle sit on the **left**, vertically **centered**, with the dark fade heaviest on the left so the words stay readable, and any hero photo shows on the **right**. Check a **tablet** (~820px) and a **phone** (~390px): **Expect** the same left-aligned, centered hero on both, byte-for-byte as before. This slice adds the plumbing so the hero’s **text position** (left / center / right + top / center / bottom) and **image focus** can be moved just like the other banners; the on-screen controls for it arrive with the new 3-tab Specials editor. **Red flag:** the hero text or photo has shifted from where it is today; the fade no longer keeps the words readable; the hero looks different on tablet or phone; the title/subtitle/eyebrow copy or any hero button changed.
- **T-273 (Specials “Today’s Deal” banner — new Image focus control moves the photo on its own):** in the back office open **Specials** → the **Today’s Deal banner & products** tab. Below the **Banner text position** buttons you will see a new **Image focus** row with **Center / Top / Bottom / Left / Right**. Set the **text position** to the **Left**, then click **Image focus → Right**: **Expect** the live **Banner preview** on the right to show the words on the left and the picture’s subject slid to the right, with NO overlap. Now flip it (text **Right**, focus **Left**) and try **Top / Bottom / Center**: **Expect** the photo to slide to match each choice while the text stays exactly where you put it. Leave everything untouched and open the public **/specials** page: **Expect** the Today’s Deal banner to look **exactly as it does today** (focus **Right**) until you edit and **Publish**. **Red flag:** the Image focus buttons are missing; the preview photo does not move when you change focus; moving the text also drags the photo; the live banner changed before you published.
- **T-274 (Specials editor finished — three tabs in page order, the top hero image now lives inside it):** in the back office open **Specials**. **Expect** THREE tabs across the top in the same order as the public page: **Top hero**, **Weekly deal cards**, and **Today’s Deal banner & products**, opening on **Top hero**. On the **Top hero** tab **expect** to see the big hero **image** field (paste a URL or pick from the Media Library), a **Hero text position** row (Left/Center/Right + Top/Center/Bottom), an **Image focus** row, and a live **Hero preview** that moves the words and the picture to match your choices. Set a hero image and slide the text/photo around: **Expect** the preview to mirror it instantly. Now try to open the OLD builder at **/admin/pages/specials**: **Expect** it to send you away (it is retired) — the Specials link in the menu already points at this editor. Leave everything untouched and open the public **/specials** page: **Expect** it to look **exactly as it does today** until you edit and **Publish**. **Red flag:** fewer than three tabs or the wrong order; no hero image field/preview on the first tab; /admin/pages/specials still opens the old builder; the live page changed before you published.
- **T-275 (Loyalty hero is now a full, live-preview banner editor — twin retired):** in the back office open **Loyalty** (left nav). It now opens **one** page — the old **Pages → Loyalty** entry is gone (visiting **/admin/pages/loyalty** should show a **404 / not found**). At the top you will see a new **Loyalty hero banner** editor. **Expect** the same controls as the other banner editors — a desktop image picker AND a separate mobile image picker (each with the **Creative Studio** helper), **Text position** (Left / Center / Right), **Vertical position** (Top / Middle / Bottom), and **Image focus** (Center / Top / Bottom / Left / Right) for desktop and mobile — PLUS three text blocks: **Eyebrow** (“A Smoking Deal!”), a **stacked Title** (“Greenway / Loyalty / Points” — press **Enter** to break the line), and a cursive **Subtitle** (“Earn Points With Every Purchase”). For each block try the **Font** menu (bold display, clean sans, and **cursive/script** options like Great Vibes / Dancing Script / Pacifico), a **color** swatch (white / gold / green / orange / muted), the **Show** checkbox, and — for a script font — the **Script size** slider. **Expect** the **live preview** to update instantly and match the public page exactly (leaf art on the left, your text on the right by default). Click **Save draft**, then **Publish**, then open the public **/loyalty** page: **Expect** the new textless-art hero with your overlay words, and the signup form / points terms below it **unchanged**. **Red flag:** /admin/pages/loyalty still opens; the hero editor is missing any control the other banner editors have; the cursive fonts, colors, stacked title, or script-size slider do nothing; the preview does not match the published page; the signup form or points terms changed.
- **T-276 (Shop page top banner is now a live-preview carousel editor):** in the back office open **Website → Shop Banner** (left nav, or go to **/admin/content/shop-banner**). **Expect** a banner editor that works like the **Loyalty hero** editor but for the **Shop page (/menu)** banner — you can have **up to 10 slides** that rotate as a carousel. If it is empty, click **Create the first slide** (or the seed button). For a slide try the three text blocks — an **Eyebrow**, a **stacked Title** (press **Enter** to break the line), and a cursive **Subtitle** — each with its own **Font** menu (bold display, clean sans, and **cursive/script** options like Great Vibes / Dancing Script / Pacifico), a **color** swatch (white / gold / green / orange / muted), a **Show** checkbox, and — for a script font — the **Script size** slider. Also try **Text position** (Left / Center / Right), **Vertical position** (Top / Middle / Bottom), a separate **desktop** and **mobile** image picker (each with the **Creative Studio** helper and its own **Image focus**: Center / Top / Bottom / Left / Right), up to **two call-to-action buttons** (label + link + solid/outline), and the optional **Schedule** (Starts / Ends date-time) so a one-off sale slide can auto show and hide itself. **Expect** the **live preview** to update instantly and match the public page. Add a second slide, reorder with the **up / down** arrows, **Save draft**, then **Publish**, then open the public **/menu** page: **Expect** the banner to rotate through your published slides (with prev / next arrows and dots when there is more than one), and everything below the banner (filters, product cards) **unchanged**. **Note:** before the owner applies migration 0148 the editor shows a “not set up yet” note and **/menu** keeps showing the same banner it shows today — that is expected. **Red flag:** the Shop Banner nav entry is missing; the editor cannot save or publish; the cursive fonts, colors, stacked title, script-size slider, CTA buttons, or schedule do nothing; the preview does not match the published page; /menu shows a broken or empty banner; the filters or product cards changed.
- **T-277 (Link a Shop carousel slide to a one-off sale + name its sidebar filter):** in the back office open **Website → Shop Banner** (or **/admin/content/shop-banner**) and pick a slide. **Expect** a new **Link a sale (optional)** card. Open the **promotion menu**: **Expect** your live one-off promotions / daily deals listed (each with a small hint like the weekday + discount type); choose **— No sale linked —** to unlink. Pick a sale: **Expect** a **Show a filter for this sale in the Shop sidebar** checkbox to appear. Turn it on: **Expect** a **Filter name** box (limited to 40 characters) whose placeholder is the sale's own title, plus a live **“Shoppers will see: …”** preview that updates as you type (leave the box blank and the preview falls back to the sale's title). **Save draft**, then **Publish**, then reopen the editor: **Expect** the linked sale, the checkbox, and the filter name to all come back exactly as you left them. **Note:** this slice wires the link end-to-end; the actual sidebar sale-filter checkboxes on the public **/menu** page arrive in the next slice, so for now the public page is unchanged and a slide with no linked sale simply shows the empty-state note — that is expected. **Red flag:** the Link a sale card is missing; the promotion menu is empty when you do have promotions/daily deals; the checkbox or Filter name box do not appear after picking a sale; the “Shoppers will see” preview does not update or does not fall back to the sale title; the link, checkbox, or name are lost after Save/Publish; the editor errors.
- **T-278 (Dynamic Shop “Specials” sidebar filters):** open the public **Shop / full menu** page (**/menu**) and expand the **SPECIALS** filter section in the sidebar. **Expect** the two built-in checkboxes **50% Off** and **Daily Deals** (they are no longer hardcoded placeholders — **50% Off** now means “any item whose best active deal is at least 50% off” and **Daily Deals** means “any item with an active deal today”). If you have LINKED a carousel slide to a one-off sale and turned on its “show a filter” toggle (T-277), **Expect** that sale’s own named checkbox to appear here too, below the two built-ins, using the filter name you gave it. Tick a Specials checkbox: **Expect** the product grid to narrow to just the items that qualify for that special, and a removable filter **pill** to appear at the top; the Specials choices are single-select (ticking a second one replaces the first), and **CLEAR** or the pill’s **×** removes it. **Note:** a linked sale that is out of window / wrong weekday is honestly empty (it matches nothing) rather than showing stale items — that is expected. **Red flag:** the SPECIALS section is missing or empty; 50% Off / Daily Deals do nothing or always show the same items; a linked sale’s checkbox never appears; ticking a special does not narrow the grid; no pill appears; the Specials choices are not single-select; CLEAR does not reset them; the page errors.
- **T-279 (DOH-compliant flag threaded onto the public menu):** this step is back-end plumbing for the coming DOH filter and badge, so there is no new button to click yet. **Expect** the public **Shop / full menu** page (**/menu**) to keep loading and filtering exactly as before — nothing on screen changes in this step. Under the hood, each menu item now carries whether the product is **DOH-compliant** and, when it is, its **DOH category** (**General Use**, **High THC**, or **High CBD**), read from the SAME medical registry the register uses to zero medical tax — so the Shop page and the register agree. If you want to confirm the plumbing: add a product to the **medical registry** in the back office (the DOH registry screen), then — once the next step (the DOH filter) is live — **Expect** that product to read as DOH-compliant on the menu; a product NOT in the registry reads as not compliant. **Note:** with an empty registry (or before the medical migration is applied) nothing reads as compliant, which is the correct, safe default. **Red flag:** the Shop page errors or stops loading after this change; the menu behaves differently than before in any visible way; the page hangs.
- **T-280 (DOH Compliant filter in the Shop sidebar):** on the public **Shop / full menu** page (**/menu**), open the filter sidebar and look **just below the Strain Type section** for a new **DOH Compliant** section. **Note:** this section only appears when at least one product on the menu is DOH-compliant (i.e. it has been added to the medical registry) — with an empty registry (or before the medical migration is applied) the section is hidden, which is correct. When it appears, **Expect** a **DOH Compliant** choice at the top; if the compliant products span more than one DOH category you also see per-category choices — **General Use**, **High THC**, and/or **High CBD** — each showing a count on the right. Tick **DOH Compliant** and **Expect** the product grid to narrow to only DOH-compliant products and a removable **DOH** pill to appear in the active-filters row; the choice is also saved in the web address (**?doh=...**) so a refresh keeps it. Tick a category instead (say **High THC**) and **Expect** the grid to show only that category. Tick the same choice again (or click the pill's **×**, or **Reset**) and **Expect** the filter to clear and the full grid to return. **Red flag:** the DOH section shows when nothing is compliant; ticking it does not narrow the grid; the pill or **?doh=** does not appear/clear; the Shop page errors, double-counts, or behaves differently than before in any other way.
- **T-281 (DOH pill on the product card):** on any card for a **DOH-compliant** product — on the **Shop / full menu** (**/menu**), the home rails, the Specials page, and the product page — **Expect** a small **blue “DOH” pill** in the same area as the other pills (the **1:1** / **CBD** profile pill, the strain and THC/CBD boxes). **Expect** it to sit neatly beside/under those pills and stay readable when a profile pill is also showing. **Note:** the pill appears ONLY when the product is DOH-compliant (i.e. it is in the medical registry) — a product that is NOT compliant shows no pill, and with an empty registry (or before the medical migration is applied) no card shows the pill, which is correct. Tick the sidebar **DOH Compliant** filter and **Expect** every card left on screen to carry the blue DOH pill. **Red flag:** the pill shows on a product that is not compliant; it is missing from a compliant product; it overlaps or crowds the other pills; the Shop page errors or looks different in any other way.
- **T-282 (content reachability guard — migration safety net):** a behind-the-scenes check only, **nothing on the website or the admin changes**. **Expect** the public site (home, menu, FAQ, specials, loyalty, vendors, every page) to look and work EXACTLY as before, and every existing editor to behave the same. Under the hood a new safety test now confirms that all editable page pieces have a proper home and that the pieces we already know are “homeless” (the 17 orphans found in the audit) are tracked on a list so none can be forgotten. **Expect** the developer test suite to report the reachability check passing. **Red flag:** any visible change to a page or editor; the test suite reports a NEW homeless (orphan) block; the reachability check fails to run.
- **T-283 (Vendors page grows its own “Page wording” editor):** open the back-office **Pages → Vendors** screen. **Expect** a new **Page wording** card near the top (above the tabs) listing every editable word and image on the Vendors page — all 23 pieces (the outreach heading and paragraph, plus each vendor channel’s title and email). **Expect** each row to show a plain-English label, the block key, and its current text, with a green **Published** chip; a small “Editable wording slots” / “Pending drafts” stat pair; and a **Publish all drafts** bar that reads “Everything is published” when there are no drafts. Edit one row’s draft, open the preview, then Publish — **Expect** it to save, preview, and publish exactly like the Header & Footer editor (same snapshots/rollback). **Note:** in THIS step these same words are STILL editable under Site Content too (nothing was taken away yet — that happens in the next mini-slice); editing in either place is harmless because they are the same blocks. **Expect** the public **Vendor Delivery** page (**/vendor-delivery**) and every other page to look and work EXACTLY as before until you choose to edit and publish. **Red flag:** the Page wording card is missing on Vendors, shows the wrong count (not 23), lists blocks from another page, fails to save/preview/publish, changes the public site before you publish, or the Vendors page errors.
- **T-284 (Vendors wording leaves the Site Content “junk drawer”):** open the back-office **Site Content** editor. **Expect** it to no longer list the Vendors page pieces (the outreach heading/paragraph and the five channel cards’ title/email) — those 23 pieces now live ONLY in the Vendors page’s own **Page wording** card (**Pages → Vendors**, added in the previous step). The Site Content “Editable blocks” count drops by 23 and the Vendors rows are gone from its list. **Expect** the Vendors page’s **Page wording** card to still show and edit all 23 pieces exactly as before (nothing was lost — they were editable in BOTH places since the last step, and this step just removes the duplicate Site Content copy). **Expect** the public **Vendor Delivery** page (**/vendor-delivery**) and every other page to look and work EXACTLY as before. **Note:** you can still PREVIEW the Vendors page from Site Content’s page picker (previewing the whole site is fine) — you just edit its wording on the Vendors page now. **Red flag:** the Vendors pieces still appear in the Site Content list; the Page wording card loses any of the 23 pieces; the count doesn’t drop by 23; the public site changes; or either editor errors.
- **T-285 (About page gets its own “Page wording” card):** open the back-office **Pages → About** editor. **Expect** a new **Page wording** card that lists and edits the About page’s 2 wording pieces (the hero **title** and **subtitle**), each with its own Save/Publish, exactly like the Vendors page card added earlier. Edit the title, **Publish**, then open the public **About** page (**/about**) and confirm your change shows. **Expect** those same 2 pieces to STILL appear in the **Site Content** editor for now (this step only ADDS the new About editor — it does not yet remove the Site Content copy, so the pieces are editable in BOTH places; a later step removes the duplicate). **Expect** every other page to look and work EXACTLY as before, and the public /about page to be byte-identical until you actually edit+publish. **Red flag:** the About Page wording card is missing or shows the wrong pieces; editing there doesn’t change /about; the Site Content editor lost the About pieces (that removal is a later step); or any editor errors.
- **T-286 (Locations page gets its own “Page wording” card — first image piece):** open the back-office **Pages → Locations** editor. **Expect** a new **Page wording** card that lists and edits the Locations page’s 2 pieces: the hero **title** (currently “Geiger Rd”) and the wide **storefront photo**. The photo piece shows a **Media Library** picker (choose an image), each with its own Save/Publish — exactly like the About/Vendors cards. Change the title and/or pick a different photo, **Publish**, then open the public **Locations** page (**/locations**) and confirm your change shows. **Expect** those same 2 pieces to STILL appear in the **Site Content** editor for now (this step only ADDS the new Locations editor — it does not yet remove the Site Content copy, so the pieces are editable in BOTH places; a later step removes the duplicate). **Expect** every other page to look and work EXACTLY as before, and the public /locations page (including the storefront photo) to be byte-identical until you actually edit+publish. **Red flag:** the Locations Page wording card is missing or shows the wrong pieces; the photo piece has no image picker; editing there doesn’t change /locations; the Site Content editor lost the Locations pieces (that removal is a later step); or any editor errors.
- **T-287 (Price Match page gets its own “Page wording” card):** open the back-office **Pages → Price Match** editor. **Expect** a new **Page wording** card that lists and edits the Price Match page’s 2 wording pieces: the big centered **title** (currently “Price Match”) and the orange **promise headline** inside the card (currently “Our Price Match Promise”), each with its own Save/Publish — exactly like the About/Locations/Vendors cards. Edit the title, **Publish**, then open the public **Price Match** page (**/price-match**) and confirm your change shows. **Expect** those same 2 pieces to STILL appear in the **Site Content** editor for now (this step only ADDS the new Price Match editor — it does not yet remove the Site Content copy, so the pieces are editable in BOTH places; a later step removes the duplicate). **Expect** every other page to look and work EXACTLY as before, and the public /price-match page to be byte-identical until you actually edit+publish. **Red flag:** the Price Match Page wording card is missing or shows the wrong pieces; editing there doesn’t change /price-match; the Site Content editor lost the Price Match pieces (that removal is a later step); or any editor errors.
- **T-288 (About + Locations + Price Match leave the Site Content junk drawer):** open the back-office **Site Content** editor. **Expect** it to NO LONGER list the About, Locations, or Price Match wording pieces (the About headline/subtitle, the Locations “Geiger Rd” title + storefront image, and the Price Match title + orange promise headline) — those now live ONLY in their own **Pages → About / Locations / Price Match** “Page wording” cards. Open each of those three Page wording cards and confirm every piece is still there and still edits its public page (edit one, **Publish**, and see the change on the matching public page). **Expect** the public **About** (**/about**), **Locations** (**/locations**), and **Price Match** (**/price-match**) pages to be byte-identical until you actually edit+publish, and every other page to look and work EXACTLY as before. **Red flag:** any of those pieces is still shown in Site Content (the duplicate should be gone); a piece disappeared from its Page wording card (nothing should ever become un-editable); editing a Page wording card no longer changes its public page; or any editor errors.
- **T-289 (Header &amp; Footer editor gains the footer compliance warning + store hours):** open the back-office **Website → Header &amp; Footer** editor. **Expect** it to now ALSO list three new editable pieces that appear in your site footer: the required **WA compliance warning**, the **store-hours image** (the “OPEN / hours” graphic), and the plain-text **store hours** (currently “Open Daily 8:00 AM – 11:00 PM”) — each with its own draft → preview → Publish, exactly like the social/app-link blocks already there. Edit the store-hours text, **Publish**, then load any public page and confirm the footer shows your change. **Expect** those same three pieces to STILL appear in the **Site Content** editor for now (this step only ADDS the Header &amp; Footer copy — it does not yet remove the Site Content one, so they’re editable in BOTH places; the MS-3.3 step removes the duplicate). **Expect** every other page to look and work EXACTLY as before, and the public footer to be byte-identical until you actually edit+publish. **Red flag:** the three footer pieces are missing from Header &amp; Footer; the font settings got pulled in here (they belong in the Branding editor, a later step); editing there doesn’t change the footer; the Site Content editor lost those pieces (that removal is a later step); or any editor errors.
- **T-290 (Website Sync “edit hours” shortcut now opens Header &amp; Footer):** open the back-office **Website Sync** page and find the **Medical surface &amp; hours** section. Under the **Hours** card there is a small note that the footer hours copy is the <code>business.hours.display</code> block, with a shortcut link. **Expect** that shortcut to now open the **Header &amp; Footer** editor (where MS-3.1 moved the hours copy), NOT the old Site Content editor — click it and confirm you land on Header &amp; Footer with the store-hours text right there. **Expect** the separate **Medical** card’s “Page copy lives in Site Content” shortcut to STILL open Site Content (the medical copy moves in a later chapter, not now). **Expect** every other page and the public site to look and work EXACTLY as before. **Red flag:** the hours shortcut still opens Site Content; the medical shortcut got changed; either link is broken; or any page error.
- **T-291 (Site Content no longer duplicates the footer compliance/hours copy):** open the back-office **Site Content** editor. **Expect** it to NO LONGER list the **WA compliance warning**, the **store-hours image**, or the plain-text **store hours** — those three now live ONLY in the **Header &amp; Footer** editor (they were added there in MS-3.1, and this step removes the old Site Content duplicate). **Expect** the two **site font** settings (heading &amp; body) to STILL appear in Site Content for now (they move to the Branding editor in a later chapter). Edit the store-hours text in **Header &amp; Footer**, **Publish**, and confirm the public footer updates — exactly as before, just from its new single home. **Expect** every other page and the public site to look and work EXACTLY as before, byte-identical until you edit+publish. **Red flag:** the three footer pieces still appear in Site Content; the site fonts vanished from Site Content (they should stay); the hours can no longer be edited anywhere; or any editor/page error.
- **T-292 (New Branding editor lets you set your site fonts in one place):** in the back-office sidebar under **Website**, find the new **Branding** item (just below **Header & Footer**) and open it. **Expect** a simple editor with your two site-wide font settings — the **Heading font** (big titles) and the **Body font** (paragraphs) — each a curated picker with a live preview, plus the same draft → preview → Publish flow you use elsewhere. Pick a new Heading font, preview it, **Publish**, and confirm the public site’s titles update everywhere. **Expect** these same two font settings to STILL also appear in **Site Content** for now (this step only ADDS the new home; a later step removes the old duplicate) — and editing in either place changes the exact same setting. **Expect** every other page and the public site to look and work EXACTLY as before, byte-identical until you pick a new font and publish. **Red flag:** the Branding item is missing from the sidebar; it doesn’t show both font pickers; a font change doesn’t apply to the site after Publish; or any editor/page error.
- **T-293 (Site fonts now live ONLY in Branding, no longer in Site Content):** open the back-office **Site Content** editor. **Expect** the two **site font** settings (heading &amp; body) to NO LONGER appear here — they now live ONLY in the new **Branding** editor (they were added there in MS-4.1, and this step removes the old Site Content duplicate). **Expect** Site Content to still list your simple text pages (About, Locations, Price Match). Now open **Branding**, change the **Heading font**, **Publish**, and confirm the public site’s titles update everywhere — exactly as before, just from its new single home. **Expect** every other page and the public site to look and work EXACTLY as before, byte-identical until you pick a new font and publish. **Red flag:** the fonts still appear in Site Content; the fonts can no longer be edited anywhere; a published font change doesn’t apply to the site; or any editor/page error.

---

*Document status: v1, written against main `322f367b`, grounded in Bible
chapters 01–14 and FINDINGS.md GW-001…GW-035. Test IDs are stable — never
renumber; add new tests at the end of their phase. When a fix PR lands, it
must name the test IDs that verify it.*
