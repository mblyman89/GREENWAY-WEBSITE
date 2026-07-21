# Greenway POS — Resilience, Security & Regulation-Watch Strategy

> **What this is:** the owner asked five questions before the fix phase begins:
> (1) can we stay online and selling if Supabase or Vercel goes down, (2) how do
> Cloudflare, backups and guard rails fit, (3) how do we ship the register as a
> real App Store app before deploying, (4) how do we defend like Dutchie/Blaze/
> Cultivera would against outages AND attackers, and (5) how do we build a
> pipeline that turns the LCB's newsletter emails into researched implementation
> strategies automatically. This document answers all five with a strategy,
> a roadmap, and a task list with stable IDs (`H-###`) folded into the existing
> fix queue.
>
> **Standing rules apply:** every claim about OUR system below was verified
> against the code or the audit documents (anchors cited). Claims about the
> outside world (Cloudflare features, competitors, Apple) are marked
> **[EXTERNAL]** and carry a source or an explicit UNVERIFIED tag. Nothing is
> guessed. No code was changed in this slice — strategy only, as requested.

---

## Part 1 — The honest starting point: what happens TODAY when things die

Before adding anything, here is the verified truth about each failure, from the
audit's Bible chapters and the code. This is the foundation the strategy builds
on — and it is already much stronger than the owner may fear.

### 1.1 Supabase (database) goes down mid-day

**What keeps working (verified, Bible ch. 04):**
- **Selling continues.** Every sale/punch/no-sale/manual-ID/medical-capture is
  written as a sealed envelope into a queue ON the iPad (`register-client-core.ts`),
  with a one-time UUID idempotency key and a per-device sequence. When the
  server returns, envelopes are accepted EXACTLY ONCE (DB-level UNIQUE key) and
  replayed in order with full server-side re-checking. "Nothing is ever
  silently dropped" is the chapter's verified promise.
- **The register boots with no internet.** The service worker serves the `/pos`
  shell network-first-with-cache-fallback (`sw-core` — ch. 04 §3.3), and the
  menu prices from the cached bundle (`gw-pos-menu`).
- **ID checking, limits, hours** are all evaluated on-device from the cached
  bundle; the server re-checks everything at sync (ch. 02, ch. 04).

**What breaks (verified):**
- **PIN unlock is ONLINE-ONLY in this build** (ch. 01: "Offline — unlock
  requires a connection in this build. (Offline PIN cache ships with the
  Capacitor app.)"). A LOCKED register cannot be unlocked during the outage —
  an UNLOCKED one keeps selling. With the 2-minute idle lock
  (`RegisterShell.tsx:105`), this is the single biggest real-world outage gap:
  a register locks two minutes after the budtender pauses, and stays locked
  until connectivity returns.
- **Till operations** (count-in, drops, blind close) are online-only by nature
  (ch. 01 — PIN verification and cash events live server-side).
- **Back office and website are down** (they are server-rendered against the DB).
- **Website orders** can't be placed; **holds/pickups** can't be looked up.

### 1.2 Vercel (hosting) goes down

Same shape as 1.1 from the register's point of view (the iPad talks to Supabase
only through Vercel API routes — there is no direct client→Supabase path in the
POS): queue buffers everything, selling continues on an unlocked register,
locked registers stay locked, website/back office are down. Receipt printing
also stops: the Star printer POLLS `/api/cloudprnt` on our domain
(`src/app/api/cloudprnt/route.ts` — the printer is configured to poll; this is
CloudPRNT's design), so no Vercel = no receipts from the Star. (Cash sales can
still complete — the receipt job queues.)

### 1.3 The iPad itself dies / Safari clears storage

This is findings GW-001 (localStorage fragility) and GW-006 (device key in
plaintext localStorage): the queue lives in localStorage; a cleared browser
loses any UNSENT queue. Mitigations today are operational (Guided Access,
frequent flushes); the real fix is the Capacitor app (§4).

### 1.4 Both down for a long time (regional outage)

The queue has no size problem for a realistic outage (envelopes are small), but
three time-based rules eventually bite, all verified: holds expire at 30
minutes (ch. 05), the server re-checks sales HOURS at sync with its own clock
(ch. 02 §9.8 — late-night sales queued near close could be flagged as
exceptions when synced after 11pm), and clock drift beyond tolerance routes
envelopes to the exception queue rather than rejecting them (ch. 04 — by
design: accepted + preserved + human review).

### 1.5 The bottom line

**The architecture is already offline-first where it counts — the sale path.**
That is the same fundamental design the big cannabis POS vendors advertise for
outages, and it is already built and tested (T-060 is the money test).
The gaps are specific and finite: locked-register unlock, till ops, receipts
during a Vercel outage, website/back office availability, and localStorage
durability. The strategy below closes them in priority order.

---

## Part 2 — Strategy pillar A: STAY SELLING, NO MATTER WHAT

Goal in one sentence: **an unlocked register must never stop selling, and a
locked register must be unlockable, through ANY outage of Supabase, Vercel,
the store's internet, or all three.**

### A1. The Capacitor app is the keystone (owner is right to insist)

The owner's instinct — don't deploy until the front end is a real installed
app — is correct, and the audit already recommends it (`OWNER-TASKLIST.md` §7
"Phase 2: Capacitor"). What the native shell buys, verified against the
findings it closes:

1. **Offline PIN unlock** (GW-007) — the lock screen already promises it "ships
   with the Capacitor app" (ch. 01). A scrypt-hashed PIN cache on-device,
   protected by the iOS Keychain, lets a locked register unlock with no server.
   This single feature converts "outage = frozen register in 2 minutes" into
   "outage = business as usual."
2. **Device key in the iOS Keychain instead of plaintext localStorage**
   (GW-006) — hardware-backed secret storage.
3. **Durable storage instead of localStorage** (GW-001) — native SQLite/file
   storage for the queue; Safari's storage-eviction rules stop being a threat
   to unsent sales.
4. **App Store / Apple Business Manager distribution** — managed devices,
   version pinning, no "Safari updated and broke something" surprises.
   [EXTERNAL] Apple's enterprise distribution options (App Store, custom apps
   via ABM) are standard practice; the specifics of Greenway's Apple Developer
   enrollment are an owner task (H-101).
5. **On the owner's "sockets app mode / star printer webhooks" question — a
   correction so we plan on facts:** the Star TSP143IV uses **CloudPRNT**, and
   CloudPRNT is a **polling** protocol — the PRINTER calls OUR server every few
   seconds asking "anything to print?" (verified in our own
   `src/app/api/cloudprnt/route.ts` header comment and the printer-side
   configuration it describes). It is not a webhook we push to, and no app
   mode changes that. What the native app CAN add is a **local fallback print
   path**: apps can talk to the printer directly over the LAN (Star's SDK /
   raw ESC-POS over TCP), so receipts keep printing even when Vercel is down.
   [EXTERNAL] Star's iOS SDK capability is vendor-documented; the integration
   itself is a roadmap item (H-105), not a promise about current code.

**Decision this implies for the cutover plan:** the CUTOVER-CHECKLIST's Stage 4
currently describes the PWA path as "Phase 1 (opening day)". Per the owner's
new directive, the Capacitor app moves from "post-cutover project" to a
**pre-launch requirement**, and the fix queue below reflects that. The PWA
remains as the instant-fallback distribution (it's the same code) if Apple
review timing ever threatens the store's schedule — a fallback, not the plan.

### A2. Close the remaining sale-path gaps (now in the fix queue)

- **Offline PIN unlock + durable queue storage + Keychain device key** — the
  Capacitor trio above (GW-007, GW-001, GW-006) — become fix-queue items
  H-102/H-103/H-104 rather than "later."
- **The sync-stranding and duplicate-risk moderates** already in FINDINGS are
  part of this pillar and were always going to be fixed first:
  GW-023 (stranded `pending` sale + no sweeper = silent sale loss on a
  serverless crash), GW-011/GW-012 (completion races / lost inventory updates),
  GW-002 (stale register id after restart), GW-003 (duplicate rejected-rows).
  Nothing new to add — the audit already caught them; this pillar is WHY they
  are top-of-queue.
- **Exception-queue visibility** (GW-027 — rejected rows have no back-office
  page) matters more under this pillar: after a long outage, the exception
  queue is where flagged envelopes land, and the manager must be able to see
  them.

### A3. Store-side network redundancy (cheap, owner-actionable, no code)

The most likely outage is not Supabase or Vercel — it's the store's own
internet. Two owner tasks, no code needed:
- **H-110: a second WAN path.** An LTE/5G failover router (or even a phone
  hotspot documented as the manual fallback) so the iPads and the Star printer
  have a second way out. The system tolerates flapping by design (ch. 04 —
  T-063 tests it), so a rough failover is fine.
- **H-111: UPS on the router/switch/printer.** A power blip that kills the LAN
  mid-rush is the same as an internet outage, for cheaper.

### A4. What we deliberately do NOT build (professional opinion)

- **No second database that accepts writes** (multi-master). Two sources of
  truth for regulated inventory/sales is how you get unexplainable CCRS
  numbers. The queue-on-device model already IS the second copy of unsent
  truth; keep exactly one authoritative ledger (Supabase) and make the queue
  durable (A1). This is the same trade-off the audit made everywhere:
  correctness over availability for the LEDGER, availability over everything
  for the SALE PATH.
- **No self-hosted Postgres "just in case."** It doubles the operational
  surface the owner (a novice) must run, for a failure mode (prolonged total
  Supabase loss) that the queue already covers on the selling side.
  What we DO instead is make leaving possible: backups we own (§B).

---

## Part 3 — Strategy pillar B: DATA WE OWN — backups, restore, exit routes

Supabase already does scheduled backups, and the cutover checklist requires
PITR + one practice restore (C-044/C-045). This pillar adds ownership and
independence — protecting against the provider itself, not just against bugs.

- **H-120: Nightly off-platform export.** A scheduled job (Vercel cron or the
  crawler VM, which is already always-on) runs `pg_dump` against the Supabase
  connection string and ships the encrypted dump to a SECOND provider's object
  storage (e.g., Cloudflare R2 — we'll already have a Cloudflare account for
  the tunnel; any S3-compatible bucket works). Retention: 30 daily + 12
  monthly. This is the "if Supabase vanished tomorrow" insurance: our data, on
  infrastructure we control, restorable to any Postgres.
- **H-121: The compliance archive is append-only and off-platform.** Every
  generated CCRS CSV, every PST confirmation, every LIQ-1295 — already required
  by the cutover checklist to be kept (C-105/C-123) — gets a home in the same
  R2/S3 bucket with object versioning, not just a laptop folder. WAC record
  retention obligations live here (5-year records: ch. 03 / migration 0060 for
  medical; CCTV 45-day per ch. 11 §7 is store-side).
- **H-122: Restore runbook, written by doing.** C-045 already schedules the
  practice restore; H-122 extends it: restore the H-120 dump to a scratch
  Postgres OUTSIDE Supabase once, so the exit route is proven, then write both
  procedures into `docs/RESTORE-RUNBOOK.md`.
- **H-123: `DATA_ENCRYPTION_KEY` + VAPID keys + device keys escrow.** The
  OWNER-TASKLIST already warns losing `DATA_ENCRYPTION_KEY` makes encrypted
  values unreadable (§3). Owner task: a sealed offline copy (password manager +
  printed envelope in the safe) of the handful of unrecoverable secrets.

---

## Part 4 — Strategy pillar C: THE FRONT DOOR — Cloudflare, guard rails, attack posture

The owner asked to "attack this thing like it's being hacked." The audit's
security lens already did the code-level pass (GW-004/005/006, GW-018/019/020,
GW-021/022 — PIN throttling, RLS gaps, injection, timing). This pillar is the
INFRASTRUCTURE layer on top.

### C1. Cloudflare in front of the domain (we'll have the account anyway)

Putting the public domain behind Cloudflare's proxy adds, at zero or trivial
cost: [EXTERNAL — standard, vendor-documented Cloudflare capabilities; exact
plan features to be confirmed at setup, H-130]
- **DDoS absorption and a WAF** in front of the website, checkout, and admin.
- **Rate limiting at the edge** for the endpoints that matter (login,
  magic-link, `/api/pos/*`), UPSTREAM of Vercel — cheaper and earlier than
  app-level throttles (which we also have: migration 0123's durable PIN
  throttle).
- **A static "we're still open" fallback page**: if Vercel is unreachable,
  Cloudflare can serve a maintenance page with the store's hours/phone/address
  instead of a browser error. The MENU can degrade gracefully too: a
  periodically-snapshotted read-only menu page served from the edge is a
  post-cutover enhancement (H-133) — read-only, clearly marked, never checkout.
- **Cloudflare Tunnel** for the crawler VM (already the plan —
  `OWNER-TASKLIST.md` §5) and for any future store-side service, with no open
  ports.
- **What Cloudflare does NOT do:** it cannot keep the dynamic app alive when
  Vercel/Supabase are down (it fronts them, it doesn't replace them), and it
  must NOT cache authenticated pages. The register path gains nothing from it
  (the iPads talk to our API; the offline queue is the real protection) — so
  we exclude `/pos` and `/api/pos/*` from any edge caching rules explicitly.

### C2. Guard rails already in the codebase, promoted to policy

Verified, already built, and worth naming as the pattern all new code follows:
fail-closed webhooks (inbound-email route: unset secret = 503 in production,
never silently accepts — S-9), CRON_SECRET-gated cron, poll-token-gated
CloudPRNT (503 until set), the AI budget guard with hard monthly caps
(`src/lib/ai/router.ts` — refuses to spend past the cap), drafts-only inbound
intake (nothing from email touches stock without a human), and the statutory
clamp pattern (owner settings can only TIGHTEN legal limits, never widen —
`sales-limits-core.ts` AN-2). **Policy: every new integration ships fail-closed
with a hard budget/rate cap and a human in the loop for anything that touches
money, stock, or compliance.**

### C3. Detection and drills

- **H-140: Uptime monitoring from OUTSIDE** (any reputable external monitor —
  even a free tier) on: the website, `/api/cloudprnt` reachability, and the
  Supabase health endpoint. Alerts to the owner's phone. You cannot fail over
  to a plan you don't know you need.
- **H-141: A quarterly outage DRILL** (after cutover): pull the store's WAN
  plug for 30 minutes mid-morning, sell through it, watch the queue drain when
  it returns. TEST-PLAN Phase 4 (T-060…T-066) is the script; the drill keeps
  the muscle warm. Attackers and outages are rehearsed the same way.
- **H-142: An incident one-pager** taped inside the office cabinet: what to do
  when (a) internet dies, (b) a register is stolen (revoke device key —
  ch. 01 already supports revocation), (c) the website is defaced/hacked
  (Cloudflare "under attack" mode + Vercel rollback + rotate secrets), (d) LCB
  emails an error (triage panel, ch. 11 §8).

---

## Part 5 — Strategy pillar D: THE REGULATION-WATCH PIPELINE (the owner's centerpiece)

The ask: LCB newsletter emails flow INTO the back office; the AI reads them,
researches the change, drafts an implementation strategy; the owner reviews it
and hands it to the engineering AI. Verified building blocks that make this a
NATURAL extension, not a new system:

- **The inbound-email spine already exists.** `POST /api/webhooks/inbound-email`
  is a provider-agnostic, Svix-signature-verified, fail-closed endpoint that
  logs every arrival to `inbound_email_log` and routes by mailbox
  (`isForIntakeMailbox` — the vendor_intake@ pattern). A second mailbox
  (`lcb_watch@` or similar) is a routing rule, not a new endpoint.
- **The AI plumbing already exists with cost guard rails.** `src/lib/ai/router.ts`
  routes tasks to light/heavy models under HARD monthly token/$ caps and
  refuses to overspend. A "regulation analysis" task type slots straight in.
- **The compliance calendar already models obligations with authorities cited**
  (`compliance-calendar-core.ts`, ch. 11 §7) — the natural place where an
  adopted rule's new obligation lands as a trackable task.
- **The statutory-clamp pattern** (AN-2) means many rule changes (limits,
  hours) are CONFIGURATION changes with the statute as a hard ceiling — the
  system was built expecting rules to move.
- **[EXTERNAL, verified by search]** the LCB's newsletter/bulletins are sent
  via **GovDelivery** (`content.govdelivery.com/accounts/WALCB/...`), i.e.,
  well-structured HTML emails from a consistent sender — ideal for automated
  ingestion. The LCB also maintains a "Current Rulemaking Activity" page
  (lcb.wa.gov/laws/current-rulemaking-activity) the crawler can watch as a
  second source (H-155). Example of why this matters, from the search itself:
  "Cannabis Advertising (ESB 5206) — Final Rules Adopted — Effective July 4,
  2026" — exactly the kind of change the store must absorb on a deadline.

### D1. The pipeline, stage by stage (design — build is H-150…H-156)

```
LCB GovDelivery email ──► owner's mailbox rule forwards to lcb-watch@ ─┐
LCB rulemaking page  ──► crawler watcher (diff detection) ─────────────┤
                                                                       ▼
                     /api/webhooks/inbound-email (existing, fail-closed)
                                                                       ▼
                REGULATION INBOX (new admin page under /admin/compliance)
                  every item logged, deduplicated, nothing auto-acted
                                                                       ▼
                AI STAGE 1 — TRIAGE (light model, budget-guarded):
                  classify: rulemaking notice / adopted rule / hearing /
                  newsletter fluff; extract: WAC sections cited, effective
                  dates, comment deadlines; score store impact 0–3 against
                  a checklist of OUR feature areas (limits, hours, labels,
                  advertising, medical, CCRS format, taxes…)
                                                                       ▼
                AI STAGE 2 — BRIEF (heavy model, only for impact ≥ 2):
                  plain-English summary; what changes for Greenway;
                  which system settings/features are touched (mapped to
                  Bible chapters); proposed implementation strategy;
                  proposed compliance-calendar entries; confidence notes
                  with UNVERIFIED flags where the AI is unsure
                                                                       ▼
                OWNER REVIEW (the human gate — nothing skips it):
                  approve → the brief becomes (a) calendar entries and
                  (b) a hand-off document for the engineering AI session
                  reject/edit → logged, model feedback recorded
```

**Non-negotiable design rules (matching the system's DNA):** drafts-only —
the pipeline NEVER changes a setting, limit, price, or export format by
itself; every AI output carries its sources and an UNVERIFIED flag where it
extrapolates; hard budget caps via the existing router; the owner's approval
is the only path from "brief" to "action"; and the engineering hand-off
document must cite the exact rule text so the build session can verify
against the primary source — never the AI's summary alone (standing rule:
never guess, even for the machine).

### D2. Why this is genuinely valuable (professional opinion)

Cannabis rules in WA move constantly (the owner has lived this). Every
incumbent vendor handles it with humans reading bulletins and quarterly release
notes. A store whose OWN system ingests the bulletin the hour it lands, maps it
to the exact features it touches (we have the Bible — a machine-readable map of
every behavior to its statute), and produces an implementation brief the same
day, is ahead of every competitor's update cycle. The Bible is the unfair
advantage here: no vendor has a per-store, per-feature, statute-anchored
behavior map. This pipeline is the first feature that makes the audit
documentation itself generate operational value.

---

## Part 6 — The roadmap: how this folds into the fix phase

Stable IDs `H-###`. Severity/order discipline is unchanged: audit findings fix
first (GW-010 before anything), and hardening items interleave where they are
prerequisites for launch. Three tracks that can run in parallel because they
need different hands (mirroring the cutover checklist's 👤/🤝 split).

### Track 1 — code (🤝 fix-phase slices, in order)

| # | Item | Closes / enables | When |
|---|---|---|---|
| (existing queue) | GW-010 critical tax fix, then the moderates per FINDINGS order | — | first, unchanged |
| H-102 | Capacitor shell for `/pos` (same code, native wrapper) | GW-006 (Keychain), GW-001 (durable storage) | with the fix phase — pre-launch |
| H-103 | Offline PIN unlock (scrypt cache in Keychain-protected storage) | GW-007; pillar A keystone | right after H-102 |
| H-104 | Queue storage migration localStorage → native SQLite/file (Capacitor) with one-time migration of any pending queue | GW-001 fully | with H-102 |
| H-105 | LAN fallback receipt printing via Star SDK from the native app | receipts survive Vercel outage | pre-launch if time allows; else first post-launch |
| H-120 | Nightly `pg_dump` → encrypted → R2/S3 (cron on crawler VM or Vercel) | provider-independence | before cutover Stage 6 |
| H-150 | `lcb_watch` mailbox routing + Regulation Inbox admin page (drafts-only, logs to existing inbound spine) | pillar D stage 1 | post-GW-fixes, pre-launch nice-to-have |
| H-151 | AI triage task type in the router (light model, hard caps) | pillar D | with H-150 |
| H-152 | AI brief generation + owner review/approve flow + calendar-entry creation on approval | pillar D | after H-150/151 |
| H-153 | Engineering hand-off document generator (rule text + affected Bible chapters + proposed slice list) | pillar D | after H-152 |
| H-155 | Crawler watcher for lcb.wa.gov rulemaking page (diff → same inbox) | pillar D second source | post-launch |
| H-133 | Edge-cached read-only menu snapshot fallback page | website degrades gracefully | post-launch enhancement |

### Track 2 — owner infrastructure (👤 no code, start anytime)

| # | Item | When |
|---|---|---|
| H-101 | Apple Developer enrollment (+ Apple Business Manager if managed distribution) — start NOW, approval takes time [EXTERNAL: timing varies] | now |
| H-110 | LTE/5G failover WAN at the store | before test Phase 4 |
| H-111 | UPS on router/switch/printer | with H-110 |
| H-123 | Secrets escrow (DATA_ENCRYPTION_KEY, VAPID, recovery codes) — sealed copy in the safe | with cutover Stage 3 |
| H-130 | Move DNS to Cloudflare; enable proxy/WAF/rate-limit on the public domain; explicit no-cache rules for `/pos` + `/api/*`; static outage page | with cutover Stage 3 |
| H-131 | Cloudflare Tunnel for the crawler VM (already planned — OWNER-TASKLIST §5) | unchanged |
| H-140 | External uptime monitoring with phone alerts | with cutover Stage 3 |
| H-160 | Create the lcb-watch@ mailbox + forwarding rule from the owner's newsletter subscription | when H-150 lands |

### Track 3 — process (👤/🤝 recurring)

| # | Item | Cadence |
|---|---|---|
| H-122 | Restore drill: Supabase PITR restore (C-045) + off-platform dump restore, runbook written | once pre-cutover, then annually |
| H-141 | Outage drill (pull the WAN, sell through it, watch the queue drain) | quarterly post-cutover |
| H-142 | Incident one-pager in the office | write once, review quarterly |
| H-143 | Secret rotation sweep (poll token, CRON_SECRET, webhook secrets, device keys) | every 6 months |

### What changes in the existing plans (explicit, so nothing is silently edited)

1. **CUTOVER-CHECKLIST Stage 4:** the register distribution path upgrades from
   "PWA now, Capacitor later" to "Capacitor before launch, PWA as standby."
   The checklist document itself will be amended in a future slice ONLY after
   H-102/H-103 actually land (per the never-guess rule, the checklist keeps
   describing reality, not intentions). The calendar consequence is honest:
   App Store review and native testing add schedule risk to the Sep 7 test
   window — H-101 (Apple enrollment) starting NOW is what protects the date,
   and the PWA standby is the schedule escape valve.
2. **The fix queue** (tracking log "NEXT") gains the Track-1 items above,
   interleaved: GW-010 and the money/security moderates stay first; the
   Capacitor trio (H-102/103/104) runs as its own mini-phase right after the
   moderates, since GW-001/006/007 are all "fixed by Capacitor" findings;
   pillar-D items follow.
3. **TEST-PLAN:** when H-102/H-103 land, Phase 2's known-limits notes (offline
   unlock refusal T-021 expectation) flip, and new tests get appended at the
   end of their phases (per the plan's own rule: stable IDs, add at the end).

---

## Part 7 — Direct answers to the owner's questions (plain English)

1. **"Can we survive a Supabase/Vercel outage?"** Selling — yes, already,
   that's the queue design and it's tested (T-060). The real gaps are: a
   register that LOCKS during the outage stays locked (fixed by H-103), and
   receipts/back-office/website pause (mitigated by H-105/H-130/H-133). After
   the Capacitor trio, a full cloud outage means: registers sell all day,
   receipts print over the LAN, the website shows a friendly fallback, and
   everything reconciles exactly-once when the cloud returns.
2. **"Cloudflare?"** Yes — for the public domain (WAF, rate limits, DDoS,
   outage page) and the crawler tunnel. It is armor for the front door, not a
   substitute engine: it cannot keep the dynamic app alive when its origin is
   down, and it deliberately never touches the register path.
3. **"App Store app first?"** Agreed — it's the keystone of the whole outage
   strategy, not just packaging. One correction: the Star printer uses a
   polling protocol (CloudPRNT), not webhooks; the native app's real printer
   win is direct LAN printing as a fallback. Start Apple enrollment now
   (H-101); keep the PWA as the schedule safety valve.
4. **"Protect like Dutchie/Blaze/Cultivera?"** Their playbook is: offline-first
   sale path, one authoritative ledger, edge protection, monitoring, drills,
   and boring backups. We have the first two BUILT and audited; the rest is
   Tracks 2–3 — owner-actionable, mostly free, none of it exotic.
5. **"Regulation watch?"** The best part: 80% of the plumbing exists (fail-closed
   inbound email, budget-guarded AI router, compliance calendar, the Bible as a
   statute-to-feature map). The pipeline is drafts-only with you as the only
   gate, exactly like every other automation in this system. It turns your
   newsletter subscription into same-day implementation briefs — and the LCB's
   GovDelivery format is machine-friendly, which we verified.

---

## Appendix — fact anchors

| Claim | Verified in |
| --- | --- |
| Offline queue exactly-once, envelopes, four verdicts, nothing dropped | `docs/audit/bible/04-offline-sync.md` §1–2 |
| Register boots offline; menu cached (`gw-pos-menu`); SW network-first `/pos` | ch. 04 §3.2–3.3 |
| PIN unlock ONLINE-ONLY; offline cache "ships with the Capacitor app"; till ops online-only | `docs/audit/bible/01-register-lifecycle.md` (lock/till sections) |
| Idle lock 2 minutes | `src/app/pos/RegisterShell.tsx:105` |
| Hours re-checked at sync with server clock; drift → exceptions | ch. 02 §9.8; ch. 04 watchlist |
| GW-001/006/007 (localStorage, device key, offline unlock) | `docs/audit/FINDINGS.md` |
| GW-023/011/012/002/003/027 in the outage-integrity family | `docs/audit/FINDINGS.md` |
| CloudPRNT is printer-POLLS-server; poll token fail-closed 503 | `src/app/api/cloudprnt/route.ts` header + `:58` |
| Inbound email endpoint: provider-agnostic, Svix-verified, fail-closed, drafts-only, logs to `inbound_email_log`, mailbox routing | `src/app/api/webhooks/inbound-email/route.ts` header |
| AI router: modes, hard monthly token/$ caps, refuses overspend | `src/lib/ai/router.ts` header |
| Compliance calendar with cited authorities | `docs/audit/bible/11-ccrs-compliance.md` §7 |
| Statutory clamp (tighten-only) AN-2 | `src/lib/compliance/sales-limits-core.ts:231` |
| Tax rates configurable in DB (excise 3700 bps, state 650, local 280) | `supabase/migrations/0030_pos_tax_settings.sql:20–27` |
| PWA-then-Capacitor guidance; Guided Access mitigation; crawler tunnel | `docs/audit/OWNER-TASKLIST.md` §5, §7 |
| PITR + practice restore already required | `docs/audit/CUTOVER-CHECKLIST.md` C-044/C-045 |
| T-060 exactly-once money test; Phase 4 outage tests | `docs/audit/TEST-PLAN.md` |
| LCB bulletins via GovDelivery (`content.govdelivery.com/accounts/WALCB`); rulemaking page exists | web search 2026-07-21 (bulletin: "Cannabis Advertising (ESB 5206) — Final Rules Adopted — Effective July 4, 2026"; lcb.wa.gov/laws/current-rulemaking-activity) |
| Cloudflare WAF/rate-limit/tunnel/static-fallback capabilities | [EXTERNAL] vendor-documented, to be confirmed at H-130 setup |
| Star iOS SDK direct LAN printing | [EXTERNAL] vendor-documented, to be verified in the H-105 slice |
| Apple Developer / ABM distribution | [EXTERNAL] standard practice; enrollment timing UNVERIFIED — owner task H-101 |

*Document status: v1, written against main `a7c26b57` (2026-07-21). H-### IDs
are stable — never renumber. No code was changed in this slice. The fix-phase
tracking log's NEXT section now interleaves Track 1 into the GW queue.*
