# Greenway POS — The Cutover Checklist

> **What this is:** the ordered, checkbox-by-checkbox countdown from today to the day
> Greenway stops paying Cultivera and runs entirely on its own system. It is the fourth
> and final audit deliverable (see `README.md` deliverables table).
>
> **Who it's for:** the owner. Plain English, one tiny step at a time, nothing assumed.
> Where a step needs a technical hand, it says so and names the companion document.
>
> **The hard deadline:** Cultivera renews **October 31, 2026** (verified:
> `docs/audit/README.md`, "Why this exists"). October 31, 2026 is a **Saturday** — which
> is convenient, because a CCRS reporting week runs **Sunday through Saturday**
> (verified: `docs/CCRS_SELF_REPORTING_GUIDE.md`, Step A4). Every date in this plan is
> anchored to real 2026 Sundays, computed — not guessed.
>
> **The golden rule of this document:** you do NOT cut over because the calendar says
> so. You cut over because every GATE below is green. If a gate is red on its date,
> the plan slips — and this checklist tells you exactly how far it can slip before
> you must renew Cultivera for a short bridge instead of gambling.

---

## How to read this document

- Every step has a stable ID (`C-###`). Never renumber. When you report progress,
  say the ID: "C-041 done, C-042 blocked."
- Steps are grouped into **Stages 1–10**, in calendar order. Do stages in order;
  inside a stage, items are ordered too unless marked "(any order)".
- **⛔ GATE** items are the go/no-go tests. A gate is either **GREEN** (all its
  conditions met, with evidence) or **RED**. You never "sort of" pass a gate.
- Items marked **🤝 with your AI** are ones to do in a session with the assistant.
  Items marked **👤 only you** are dashboard logins, phone calls, and physical tasks
  only you can do.
- Companion documents this checklist leans on (all in the repo):
  - `docs/audit/TEST-PLAN.md` + `docs/audit/test-manual/index.html` — the 129-test manual.
  - `docs/audit/OWNER-TASKLIST.md` — the verified settings list (Supabase §2, Vercel §3,
    Resend §4, crawler §5, printer §6, deployment roadmap §7).
  - `docs/CCRS_SELF_REPORTING_GUIDE.md` — how self-reporting to the LCB works,
    including the dual-run plan this checklist schedules (its Part B).
  - `docs/MIGRATIONS_TO_RUN.md` — the manual migration checklist (files 0054 → 0139).
  - `docs/audit/FINDINGS.md` — all 35 findings (GW-001…GW-035) and their statuses.
- **NEVER GUESS applies to you too:** if a screen doesn't match what a step says,
  stop, photograph it, and bring it to a session. Don't improvise on the live system.

---

## The calendar at a glance (all dates verified against a real 2026 calendar)

```
TODAY                     ~July 21, 2026        (~14½ weeks of runway)
Stage 1  Fix slices       July → August         all fixes land, most severe first
Stage 2  Paperwork        start NOW, done by    Sun Aug 30
Stage 3  Infrastructure   done by               Sun Sep 6
Stage 4  Hardware         done by               Sun Sep 6
Stage 5  Full test plan   Mon Sep 7 → Sat Sep 19  (two weeks, incl. re-tests)
GATE A   Test gate        Sun Sep 20
Stage 6  Parallel run     Sun Sep 20 → Sat Oct 17  (4 CCRS weeks, Cultivera still live)
GATE B   Parallel gate    Sun Oct 18
Stage 7  Go/no-go meeting Sun Oct 18
Stage 8  CUTOVER          Sun Oct 18: first self-submitted CCRS upload
Stage 9  Solo weeks       Oct 18 → Oct 31: two full self-reported weeks BEFORE renewal
Oct 31   Cultivera renewal date — you decline it with proof in hand
Stage 10 First month solo November: first LIQ-1295 filed fully on the new system
```

**Why cutover on Sunday, October 18 and not October 25:** cutting over Oct 18 gives
you TWO complete self-reported CCRS weeks (Oct 18–24 and Oct 25–31) confirmed clean
before the renewal decision — with Oct 25 as a built-in one-week slip buffer. Cutting
over Oct 25 leaves zero buffer. The 2026 Sundays available are Sep 6, 13, 20, 27 and
Oct 4, 11, 18, 25 (computed, not guessed).

**The slip rule:** each gate can slip one week at a time. If GATE B cannot go green
by **Sunday, October 25**, you do NOT cut over — you contact Cultivera about the
shortest renewal/bridge they offer and cut over mid-contract when ready. Losing a few
weeks of subscription money is nothing next to a bad first upload to the LCB.
(⚠️ What your Cultivera contract's notice/renewal terms actually say is something
only YOU can verify — that's step C-020. This document does not guess them.)

---

<a id="stage-1"></a>
## Stage 1 — The fix gate: no cutover work until the software is fixed

The audit found 35 issues (`FINDINGS.md`). They are graded: 🔴 Critical (1),
🟠 Moderate (16), 🟡 Low (11), 🔵 Hardening (6), 🟢 Enhancement (1). The fix phase
runs most-severe-first, one small reviewed PR per fix, same discipline as the audit.

- [ ] **C-001 🤝 GW-010 is FIXED and merged.** The one 🔴 Critical: compliance
  exports currently compute tax on the tax-inclusive price, overstating CCRS/Sage
  tax ~46% on cannabis lines. **Absolutely no real CCRS upload happens before this
  is fixed** — it is the first fix in the queue for exactly this reason
  (`FINDINGS.md` GW-010; `OWNER-TASKLIST.md` §7).
- [ ] **C-002 🤝 Every 🟠 Moderate finding is either FIXED or formally
  ACCEPTED-RISK.** The moderates include things that can lose a sale record
  (GW-023), let strangers create staff accounts (GW-018), leave staff pay data
  readable by every employee (GW-020), and double-count inventory (GW-011/012).
  "Accepted-risk" is allowed only with your written sign-off recorded in
  `FINDINGS.md` (status convention in `README.md`).
- [ ] **C-003 🤝 The 🟡 Low / 🔵 Hardening list is reviewed line-by-line** and each
  item is marked fixed, accepted, or scheduled post-cutover. None of these blocks
  cutover by default, but the decision must be recorded, not implied.
- [ ] **C-004 🤝 Every fix PR names the TEST-PLAN test IDs that prove it** (the
  test plan's footer requires this), so Stage 5 knows exactly what to re-test.
- [ ] **C-005 ⛔ GATE: FINDINGS.md shows zero OPEN 🔴 and zero OPEN 🟠.** Evidence:
  the findings log itself — every Critical/Moderate carries `FIXED (PR #n)` or
  `ACCEPTED-RISK (owner sign-off, date)`.

---

<a id="stage-2"></a>
## Stage 2 — Paperwork & accounts (start NOW — some of this has government lead time)

Target: everything below done by **Sunday, August 30, 2026**.

### Your LCB / CCRS identity

- [ ] **C-010 👤 Log into CCRS today** at https://cannabisreporting.lcb.wa.gov/ with
  your SAW (SecureAccess Washington) account, just to prove the login works. Don't
  wait until you need it (`CCRS_SELF_REPORTING_GUIDE.md` Step A1).
- [ ] **C-011 👤 Create a WA.gov account** at https://manage.login.wa.gov —
  Washington is moving CCRS sign-in to WA.gov single sign-on **around October 2026**,
  i.e., possibly during your cutover window. Having the account ready means the
  state's login switch can't lock you out mid-cutover (Step A1, verified).
- [ ] **C-012 👤 Confirm your CCRS profile is linked to license 413541 and that you
  (or a trusted staffer) are the active administrator** on the license (Step A2).
- [ ] **C-013 👤 Put the two compliance clocks on your real calendar now:** CCRS
  weekly (week = Sunday–Saturday, due no later than the following Sunday; nothing to
  file if nothing changed) and **LIQ-1295 monthly — filed EVERY month even at zero
  sales**; missing it is grounds for suspension/revocation under WAC 314-55-092(2)
  (Step A4). The back office also tracks these in the Compliance Calendar with the
  same authorities cited (Bible ch. 11 §7) — but your paper calendar is the backup.

### Cultivera (the incumbent)

- [ ] **C-020 👤 Read your Cultivera contract and write down three facts:** the
  renewal date (expected Oct 31, 2026), the cancellation notice period, and whether
  a month-to-month bridge exists. This checklist's slip rule depends on these —
  and only you can verify them.
- [ ] **C-021 👤 Export/collect from Cultivera everything you'll want after it's
  gone:** historical sales reports, inventory snapshots, and copies of what it
  submitted to CCRS on your behalf. Remember the verified hard fact: **you cannot
  pull your data back out of CCRS** — a Public Records request is the only way —
  so your own copies are the record (`CCRS_SELF_REPORTING_GUIDE.md` Step A3).
- [ ] **C-022 👤 Do NOT give Cultivera notice yet.** Notice is a Stage 8 step,
  after the first clean self-submitted upload. Write the notice deadline from
  C-020 into Stage 8 so it's waiting there.

### Medical endorsement (only if you plan to open with medical sales)

- [ ] **C-030 👤 Decide: launching WITH medical sales or adding them later?** The
  system supports launching without — the endorsement flag is a hard AND on every
  medical exemption; until you hold the DOH endorsement and the config row is set,
  the excise exemption can never fire (Bible ch. 03 §1–2). If "later," skip to
  C-033 and run all medical testing in TEST MODE only.
- [ ] **C-031 👤 (medical path) Obtain the DOH medical endorsement** and your
  MCAD access; only then set the endorsement configuration in the back office.
- [ ] **C-032 👤 (medical path) Confirm the consultant/DOH 608-048 workflow** with
  whoever will run it — the system enforces the checkboxes and the 5-year record
  (Bible ch. 03; migration 0060 stores the scanned form).
- [ ] **C-033 👤 Either way: keep medical TEST MODE for rehearsal** — loud banner,
  never touches the server (Bible ch. 03 §10; TEST-PLAN Phase 6 uses it throughout).

---

<a id="stage-3"></a>
## Stage 3 — Infrastructure: the accounts and switches behind the app

Target: done by **Sunday, September 6, 2026**. Source of truth for every item:
`OWNER-TASKLIST.md` (section numbers cited). Most are one-time dashboard clicks.

### Database (Supabase)

- [ ] **C-040 👤 Migration sweep:** open `docs/MIGRATIONS_TO_RUN.md` and confirm
  every box through **0139** (the current last file; 0139 = golden-record fact-review queue (decision log for the import Fact Review screen: approve/fix/reject flagged products, corrections carry provenance "reviewer"), 0138 = structured product facts (golden-record boxes: strain type in its own column, servings/mg-per-serving/package-total mg, ratio, net weight/volume, fact provenance + strain-name cleanup), 0137 = regulatory watch (rule-change radar: WSLCB bulletin tracking, AI briefings, compliance roadmap), 0136 = handbook acknowledgments (staff must read the employee handbook and check the box before back-office or register access; owner exempt), 0135 = store safe (twice-daily manager counts + register change swaps, $1,000 target), 0134 = tips-at-close on drawer sessions (employee money, kept out of over/short math), 0133 = special discount programs (employee/industry/veteran settings + use tracking), 0132 = GW-027 rejected-rows visibility columns, 0131 = GW-009 Pacific-day medical ledger default, 0130 = GW-019/GW-020 RLS + insider-threat hardening, 0129 = GW-011/GW-012 concurrency guards, 0128 = GW-023 stranded-sale recovery, 0127 = GW-018 inactive-by-default staff profiles) is checked as run. Special
  attention (verified in the task list §1): **0123** (pin_throttle — the durable
  PIN rate-limit behind GW-005), **0120–0122** (the POS foundation), and re-run
  **0061** once (it was rewritten to an idempotent form; re-running is safe and
  takes seconds). 0038 needs nothing — 0077 already corrected the drawer float.
- [ ] **C-041 👤 Supabase Auth URL configuration** (§2): Site URL = your real
  production URL; Redirect URLs include BOTH `https://<your-domain>/auth/callback`
  and `https://<your-domain>/admin/account/set-password` (staff invites land
  there — GW-017 fix).
- [ ] **C-042 👤 Disable public sign-ups** in Supabase Auth (§2 item 3) — this is
  the dashboard-side seal on GW-018 and stays off permanently even after the code
  fix lands.
- [ ] **C-043 👤 Production SMTP for auth email** (§2 item 4): plug your Resend
  SMTP credentials into Supabase so invite/magic-link emails actually deliver
  (the built-in sender is rate-limited to a few emails per hour).
- [ ] **C-044 👤 Backups: confirm scheduled backups are ON and enable PITR**
  (point-in-time recovery) on your paid plan (§2 item 5).
- [ ] **C-045 👤🤝 The practice restore.** Do ONE rehearsal restore to a scratch
  Supabase project and write down the steps as you go. The audit flagged that no
  restore runbook exists (§2 item 5, §7) — this checkbox is where that gap closes.
  You never want your first restore to be the real one.

### Hosting (Vercel)

- [ ] **C-050 👤 Set every environment variable** from the verified table in
  `OWNER-TASKLIST.md` §3. The required-five first: `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
  `ADMIN_BOOTSTRAP_EMAILS` (your email — auto-promoted to owner on first login),
  `NEXT_PUBLIC_SITE_URL` (the printer's poll URL is built from it).
- [ ] **C-051 👤 Secrets:** `DATA_ENCRYPTION_KEY` (32+ random chars — encrypts bank
  numbers and integration secrets at rest; **back it up like a database password**,
  losing it makes encrypted values unreadable) and `CRON_SECRET` (the daily
  compliance-reminders cron refuses to run in production without it).
- [ ] **C-052 👤 Email variables:** `RESEND_API_KEY`, `ORDER_EMAIL_FROM`,
  `ORDER_STAFF_EMAILS`, `LOYALTY_FROM_EMAIL`, `RESEND_WEBHOOK_SECRET`,
  `RESEND_INBOUND_SECRET` (§3 table).
- [ ] **C-053 👤 Push notifications:** generate VAPID keys ONCE
  (`npx web-push generate-vapid-keys`) and set `VAPID_PUBLIC_KEY` /
  `VAPID_PRIVATE_KEY` (§3).
- [ ] **C-054 👤 After the production deploy, open Vercel → Crons and confirm
  `/api/cron/compliance-reminders` appears** (declared in `vercel.json`, daily
  16:00 UTC = 8/9am Pacific) and shows successful runs once `CRON_SECRET` is set.

### Email (Resend)

- [ ] **C-060 👤 Verify your sending domain** (DNS records) so order/loyalty email
  isn't rejected (`OWNER-TASKLIST.md` §4).
- [ ] **C-061 👤 Create the engagement webhook** pointing at
  `https://<your-domain>/api/webhooks/resend` and paste its `whsec_…` signing
  secret into `RESEND_WEBHOOK_SECRET` — in production the endpoint refuses
  traffic without it, by design (§4).
- [ ] **C-062 👤 (if using vendor-intake email)** set up Resend Inbound to
  `https://<your-domain>/api/webhooks/inbound-email` with its secret in
  `RESEND_INBOUND_SECRET` (§4).

### Optional services (safe to defer — features hide when unset)

- [ ] **C-070 👤 Crawler worker** on your shop VM behind a Cloudflare Tunnel, with
  `CRAWLER_SHARED_SECRET` identical on both ends and `CRAWLER_BASE_URL` in Vercel
  (§5; the worker's own `WHERE_TO_RUN.md` / `RUNBOOK.md` walk it through). Unset =
  research buttons simply hide; nothing else breaks.
- [ ] **C-071 👤 Leafly/Weedmaps:** apply for API credentials now (approval takes
  time), but leave both integrations in their default **sandbox** mode until after
  cutover — verified: sandbox is the code default; you cannot accidentally push a
  live menu (§7). Live syndication is a post-cutover project, not a launch gate.

---

<a id="stage-4"></a>
## Stage 4 — Hardware & the store floor

Target: done by **Sunday, September 6, 2026** (same weekend as Stage 3 — different
hands, so they can run in parallel).

- [ ] **C-080 👤 iPads become registers (PWA path):** on each iPad, Safari → your
  site → `/pos` → Add to Home Screen. Then put each iPad in **iOS Guided Access /
  single-app mode** — that is also the operational mitigation for the device-key
  finding GW-006 (`OWNER-TASKLIST.md` §7; `FINDINGS.md` GW-006). Known launch
  limits, already in findings: no offline PIN unlock (GW-007) and localStorage
  fragility (GW-001) — the Capacitor native app removes both post-cutover.
- [ ] **C-081 👤 Provision each register** following TEST-PLAN Phase 2: the 32-char
  device key is shown ONCE at provisioning — store it like a key, and remember
  provisioning/setup is online-only by design.
- [ ] **C-082 👤 Receipt printer (Star CloudPRNT):** `NEXT_PUBLIC_SITE_URL` must be
  set first, then set a poll token in Admin → Equipment → Receipt printer (in
  production the endpoint refuses printers without it), then enter the full poll
  URL + token in the printer's own CloudPRNT config (§6, with the equipment page's
  built-in instructions).
- [ ] **C-083 👤 Label printer, scanner, laminator:** confirm they appear on
  `/admin/equipment` (seeded by migration 0061) and physically work.
- [ ] **C-084 👤 Network & the dead-spot map:** know your store's WiFi coverage at
  each register position. The system is built to sell through outages (offline
  queue), but you want to KNOW where the weak spots are before Phase 4 testing
  makes them matter.
- [ ] **C-085 👤 Cash handling:** drawers, float procedure ($167.50 default float —
  corrected by migration 0077), and the witnessed-drop / blind-close routine that
  TEST-PLAN Phase 2 rehearses. Launch is **cash-only** (Bible ch. 02) — make sure
  your change stock and cash-drop safe routine reflect that.
- [ ] **C-086 👤 The store compliance basics the system reminds you about** (Bible
  ch. 11 §7 calendar): CCTV covering registers with 45-day retention
  (WAC 314-55-105), employee badges, scale calibration/WSDA registration if you
  weigh anything (RCW 19.94).

---

<a id="stage-5"></a>
## Stage 5 — Run the full test plan (the two-week burn-in)

Window: **Monday, September 7 → Saturday, September 19, 2026.**
Your manual: `docs/audit/TEST-PLAN.md` — interactive edition at
`docs/audit/test-manual/index.html` (Pass/Fail/Blocked buttons, Bug Cards,
export). 129 tests, Phases 0–13.

- [ ] **C-090 👤 Week 1: Phases 0–11 in order.** Phase 0 proves setup (it will
  catch any Stage 3/4 miss), then one feature area per session. Send the export
  log after each phase; fixes for anything found ride back to you within days.
- [ ] **C-091 👤 Verify every former KNOWN-BROKEN test now PASSES.** Each ⚠️ tag in
  the manual (GW-010, GW-017, GW-018, GW-025, GW-027, GW-028, and the rest) maps to
  a Stage-1 fix; this is where those fixes are proven on the real system.
- [ ] **C-092 👤 Week 2: Phase 12 (BREAK-IT DAY) and Phase 13 (the dress
  rehearsal).** Phase 13 is graded A/B/C/F; the finish line requires all A's and
  B's (TEST-PLAN Part B3).
- [ ] **C-093 👤🤝 Re-test cycle:** anything that failed gets fixed, and you re-run
  ONLY the tests the fix notes name — plus T-060 (the offline exactly-once test)
  after ANY register-touching fix, because it guards your money (Part B2).
- [ ] **C-094 ⛔ GATE A (Sunday, September 20): the TEST-PLAN finish line, verbatim
  from Part B3.** Every phase PASS (or BLOCKED with an owner-accepted reason in
  FINDINGS.md); every KNOWN-BROKEN test flipped to PASS; Phase 13 all A/B.
  (Part B3's remaining two bullets — the real CCRS round-trip and this checklist —
  are satisfied by Stage 6 and by finishing this document.) **RED = slip one week
  and shift every later date. GREEN = enter the parallel run.**

---

<a id="stage-6"></a>
## Stage 6 — The parallel run: four weeks of shadowing Cultivera

Window: **Sunday, September 20 → Saturday, October 17, 2026** (four full CCRS
weeks). This stage is `CCRS_SELF_REPORTING_GUIDE.md` Part B steps 1–3, put on the
calendar. **Cultivera stays live and keeps submitting; you shadow it.**

- [ ] **C-100 👤 Clean the slate before week 1:** purge all Stage-5 test data with
  the Clean Slate reset (Admin → Settings → Reset — typed confirmation phrase,
  recorded in the audit log; TEST-PLAN §A4). Validated real records stay; test
  junk goes. From this Sunday forward, the new system carries only real data.
- [ ] **C-101 👤 Reconcile inventory to reality:** verify the back office's live
  inventory matches CCRS/Cultivera reality BEFORE you ever take over submission
  (guide Part B step 3). Use the menu-import/reconciliation tooling; walk the
  shelves for the categories that matter most.
- [ ] **C-102 👤 Every week, for four weeks:** generate the week's CCRS Sale CSV
  from the back office (the export hard-gate blocks malformed files before you
  can download — Bible ch. 11), and set it side-by-side with what Cultivera
  submitted for the same Sunday–Saturday week. Row counts, totals, tax figures.
  **Only Cultivera actually submits during this period.**
- [ ] **C-103 🤝 Bring every discrepancy to a session.** A diff between the two
  files is either a Cultivera quirk, a data mismatch, or a bug — and per the
  standing rule we verify which, never guess. Log each one and its resolution;
  by week 4 the diff list should be empty or fully explained.
- [ ] **C-104 👤 The one-time REAL upload test (T-136):** once during this stage —
  after C-001 (GW-010 fixed) and ideally in week 3 or 4 — do the tiny real
  round-trip exactly as TEST-PLAN T-136 describes: a handful of small real sales →
  Sale CSV → upload to CCRS under your own SAW login with a clear filename →
  watch the Processing Status (PST) until it processes clean. There is no LCB
  sandbox; this small, controlled real upload IS the test (`OWNER-TASKLIST.md` §7).
  ⚠️ Coordinate the date range so it doesn't collide with what Cultivera submits —
  raise this in a session first (C-103) so the overlap question is answered
  against the actual files, not assumed.
- [ ] **C-105 👤 Keep copies of EVERYTHING:** every generated CSV, every Cultivera
  file you can see, every PST confirmation. Verified fact worth repeating: CCRS
  cannot give your data back (Public Records request only) — your archive is the
  record (guide Step A3).
- [ ] **C-106 👤 Run the store's daily routine on the new system all four weeks:**
  day close, drawer counts, the compliance calendar checkboxes. By cutover day the
  new system should already FEEL like the normal one, with Cultivera as the shadow.
- [ ] **C-107 ⛔ GATE B (Sunday, October 18):** all four parallel weeks reconciled
  with zero unexplained differences; the T-136 real round-trip processed clean in
  the portal; the weekly export-generate-compare routine takes you under an hour
  and needs no help. **RED = slip to Oct 25 (the last slip — see the slip rule).
  GREEN = go/no-go meeting, same day.**

---

<a id="stage-7"></a>
## Stage 7 — The go/no-go decision (Sunday, October 18)

One sitting, with this document open. Every box below must already be checked —
this stage adds no new work; it is the formal look-back.

- [ ] **C-110 ⛔ FINAL GATE — read each aloud and check it:**
  - Stage 1: C-005 green (zero open Critical/Moderate findings).
  - Stage 2: CCRS + WA.gov logins proven; compliance calendar entries live;
    Cultivera contract facts written down (C-020); medical decision recorded.
  - Stage 3: migrations swept through 0139; Supabase auth/backups/PITR set;
    practice restore DONE and written down (C-045); env vars complete; cron
    visible and running; Resend verified.
  - Stage 4: registers provisioned and in Guided Access; printer polling;
    cash routine rehearsed.
  - Stage 5: GATE A green (the TEST-PLAN finish line, Part B3).
  - Stage 6: GATE B green (four clean parallel weeks + real round-trip).
- [ ] **C-111 👤 The rollback plan is written and understood** (it's short): if
  self-reporting fails in the solo weeks, Cultivera is still under contract until
  Oct 31 — resume its submission for the affected week, reconcile, and re-attempt
  the next Sunday. After Oct 31 the fallback is the bridge/renewal option from
  C-020. The store NEVER stops selling in either case — registers and the offline
  queue don't depend on CCRS at all; reporting is the only thing that rolls back.
- [ ] **C-112 👤 Say the decision out loud and write it in the tracking log:**
  "GO — cutover begins today" or "NO-GO — slip to October 25, re-run Stage 7
  then." Dated, in writing. If it's NO-GO on October 25 too: activate the C-020
  bridge conversation with Cultivera that week.

---

<a id="stage-8"></a>
## Stage 8 — Cutover week (October 18–24): you become the reporting entity

- [ ] **C-120 👤 Sunday, October 18: submit the FIRST self-reported upload** — the
  file for the week of Oct 11–17 (the prior completed CCRS week), generated from
  the back office, uploaded under your SAW login. This is guide Part B step 4,
  on the chosen Sunday.
- [ ] **C-121 👤 Watch the PST until that file processes clean.** If any rows
  reject: save the exact error text (it names the row and column), bring it to a
  session, fix the data, re-upload the corrected file the same week. The back
  office has a paste-the-email triage panel for LCB error emails (Bible ch. 11 §8).
- [ ] **C-122 👤 Only after the clean confirmation: tell Cultivera to stop
  submitting for your license** — and give formal notice per the terms you wrote
  down in C-020. Not before the confirmation. (Guide Part B step 4: stop Cultivera
  "once you've confirmed a successful, clean upload cycle.")
- [ ] **C-123 👤 Archive the cutover artifacts:** the uploaded CSV, the PST
  confirmation, your notice to Cultivera, and the date — one folder, kept forever.
- [ ] **C-124 👤 Run the week normally otherwise.** Nothing about day-to-day
  selling changes at cutover — the registers were already the real system.

---

<a id="stage-9"></a>
## Stage 9 — The solo weeks (October 18–31): prove it twice before renewal day

- [ ] **C-130 👤 Sunday, October 25: second self-reported upload** (week of
  Oct 18–24). Same routine: generate → upload → PST clean → archive.
- [ ] **C-131 👤 Confirm the compliance calendar in the back office shows both
  weeks resolved** (Bible ch. 11 §7 — completed weeks must show submitted or
  nothing-to-report, or they nag daily; that nagging is your friend now).
- [ ] **C-132 👤 Saturday, October 31 — renewal day:** with two clean solo weeks
  archived, decline the Cultivera renewal per your C-020 terms. If anything went
  wrong in the solo weeks, you already executed C-111's rollback and are on the
  bridge plan instead — that's not failure, that's the plan working.
- [ ] **C-133 👤 Sunday, November 1: third upload** (week of Oct 25–31) — the
  first one filed with no safety net. By now it's routine.

---

<a id="stage-10"></a>
## Stage 10 — The first solo month (November) & the watch list

- [ ] **C-140 👤 File the October LIQ-1295 by its due date** — the monthly excise
  return never paused during any of this (guide Part B step 6; historically due
  the 20th of the following month — confirm the current date on the form itself,
  per the guide). ⚠️ Note the October wrinkle: part of October was reported by
  Cultivera, part by you — reconcile the month's totals from your Stage 6/9
  archives BEFORE filing, in a session if anything doesn't tie out.
- [ ] **C-141 👤 Weekly rhythm, permanently:** every Sunday — generate, upload,
  PST-check, archive. Every month — LIQ-1295. The in-app compliance calendar
  tracks both with authorities cited; keep your paper calendar as the backup.
- [ ] **C-142 👤 Watch the first month for the things the audit says to watch:**
  the Exceptions queue on the registers (anything the server rejected), the
  day-close variance numbers, the receipt-print queue, and every LCB email —
  triage each through the panel the day it arrives.
- [ ] **C-143 🤝 The post-cutover project list** (already recorded, none block
  anything): the Capacitor native POS app (fixes GW-006/GW-007 properly),
  Leafly/Weedmaps live syndication after sandbox proof (C-071), the crawler if
  deferred, and any Enhancement-grade findings you want. Schedule them at leisure.
- [ ] **C-144 👤🤝 The retrospective:** one session, 30 minutes, updating this
  document's actual dates and lessons learned — so the paper trail ends with what
  really happened, not just what was planned.

---

## Appendix — Fact anchors (for the future auditor)

Every load-bearing claim above and where it was verified. Nothing in this document
is guessed; calendar dates were computed against the real 2026 calendar.

| Claim | Verified in |
| --- | --- |
| Cultivera renews Oct 31, 2026; ~3.5 months runway from mid-July | `docs/audit/README.md` ("Why this exists") |
| Oct 31, 2026 is a Saturday; Sundays Sep 6→Nov 1 as listed | computed (calendar arithmetic, this repo's audit session log) |
| CCRS week = Sunday–Saturday, due the following Sunday; no zero-change filing | `docs/CCRS_SELF_REPORTING_GUIDE.md` Step A4 |
| LIQ-1295 monthly even at zero sales; WAC 314-55-092(2) suspension risk | same, Step A4 |
| CCRS = CSV upload only, NO API, no sandbox; data not retrievable (Public Records only); PST per filename | same, Step A3; `docs/audit/OWNER-TASKLIST.md` §7 |
| WA.gov single sign-on migration ~Oct 2026; pre-create account | same, Step A1 |
| Dual-run 2–4 weeks, Sunday boundary, only Cultivera submits; reconcile KB; stop Cultivera only after clean cycle; LIQ-1295 never pauses | same, Part B |
| GW-010 (tax overstatement ~46%) must be fixed before ANY real upload | `docs/audit/FINDINGS.md` GW-010; `OWNER-TASKLIST.md` §7 |
| 35 findings; severity/status conventions; ACCEPTED-RISK requires owner sign-off | `docs/audit/FINDINGS.md`; `docs/audit/README.md` |
| Migrations manual, 139 files, only 0061 re-run needed; 0123/0120–0122 critical | `docs/audit/OWNER-TASKLIST.md` §1; `docs/MIGRATIONS_TO_RUN.md`; `supabase/migrations/` (last file 0139) |
| Supabase/Vercel/Resend settings incl. sign-ups off (GW-018 seal), PITR, env-var table, cron 16:00 UTC | `OWNER-TASKLIST.md` §2–4; `vercel.json` (cron declared) |
| PWA + Guided Access launch path; GW-006/007/001 limits; Capacitor later | `OWNER-TASKLIST.md` §7; `FINDINGS.md` |
| Printer needs `NEXT_PUBLIC_SITE_URL` + poll token (refused without in prod) | `OWNER-TASKLIST.md` §6 |
| Drawer float $167.50 corrected by migration 0077 | `OWNER-TASKLIST.md` §1 |
| Cash-only launch | `docs/audit/bible/02-sale-flow.md` §5 (cash tender) |
| Medical endorsement = hard AND; TEST MODE never touches server | `docs/audit/bible/03-medical-sales.md` §1–2, §10 |
| Clean Slate reset (typed phrase, audit-logged) | TEST-PLAN §A4; `src/app/admin/settings/reset/page.tsx` |
| TEST-PLAN finish line (Part B3): all phases pass, KNOWN-BROKEN flipped, Phase 13 A/B, T-136 clean, this checklist done | `docs/audit/TEST-PLAN.md` Part B3 |
| T-060 re-run after any register fix; T-136 real round-trip procedure | TEST-PLAN Part B2, T-136 |
| Compliance calendar authorities (CCRS weekly, LIQ-1295, CCTV 45-day WAC 314-55-105, scales RCW 19.94, badges) | `docs/audit/bible/11-ccrs-compliance.md` §7 |
| LCB error-email triage panel | same, §8 |
| Leafly/Weedmaps sandbox-by-default (cannot accidentally push live) | `OWNER-TASKLIST.md` §7 (verified in code) |
| Crawler optional; buttons hide when unset | `OWNER-TASKLIST.md` §5 |
| Registers/selling never depend on CCRS (reporting-only rollback) | `docs/audit/bible/04-offline-sync.md` (offline queue); ch. 11 (CCRS is export/upload, not in the sale path) |

**Deliberately NOT claimed (owner must verify):** Cultivera's cancellation-notice
terms and bridge options (C-020); the current LIQ-1295 due date (C-140); DOH
endorsement processing time (C-031). These are outside the repo and were not
verifiable — per the standing rule they are assigned to you rather than guessed.

---

*Document status: v1, written against main `6e920708` (2026-07-21). Step IDs
(`C-###`) are stable — never renumber; add new steps at the end of their stage.
Companion to `TEST-PLAN.md` (which its Part B3 finish line references). When a
stage completes, check its boxes in place and note the real date — this document
is meant to end up as the historical record of the cutover.*
