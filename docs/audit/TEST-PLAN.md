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
- **⚠️ KNOWN-BROKEN (GW-027):** the promised back-office review page for
  rejected rows doesn't exist yet; the rows live only on that iPad. Until
  the fix lands, treat the banner itself as the alarm.

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
- **⚠️ KNOWN-EDGE (GW-028):** the 24-hour "reservation window" on orders
  is currently written but nothing expires it — an abandoned order stays
  active until staff closes it. Watch for stale orders piling up; the
  fix will add expiry.

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

#### T-134 — The LIQ-1295 excise return
- **Do:** generate the excise return for a month with test data.
- **Expect:** the math to review with your accountant.
- **⚠️ KNOWN-BROKEN (GW-013, GW-014):** month bounds are currently UTC
  (not Pacific), and Box 1 currently includes non-cannabis sales. Both
  are open findings queued for fixing — verify the fix by re-running
  this test after it lands.

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

---

*Document status: v1, written against main `322f367b`, grounded in Bible
chapters 01–14 and FINDINGS.md GW-001…GW-035. Test IDs are stable — never
renumber; add new tests at the end of their phase. When a fix PR lands, it
must name the test IDs that verify it.*
