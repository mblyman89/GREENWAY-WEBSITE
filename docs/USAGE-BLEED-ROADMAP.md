# Usage-bleed remediation roadmap (USAGE series)

**Why this exists.** In late September 2026 Vercel warned that $15 of the $20
monthly Pro credit had been used, and Supabase warned that the Free-plan egress
quota (5 GB) had been exceeded (over 5.5 GB, grace until 24 Oct 2026). The
owner's instruction was to stop the bleeding without crippling the system, in
small, meticulously audited slices. This document is the standing map for that
work. Every slice lands as its own branch and pull request, rebase-merged per
the standing rules in `AGENTS.md`.

**What the money actually goes to (verified from Vercel's Fluid compute
pricing docs, read 2026-09-26).** A Vercel function is billed for its
*provisioned memory* for the entire time a request is in flight, including
while it sleeps waiting on the database, at $0.0106 per GB-hour on the default
2 GB instance. Active CPU is billed only while code executes, and invocations
cost $0.60 per million. The consequence is that a request held open for
twenty-five seconds and immediately reopened by a device that never sleeps
costs about the same as leaving one 2 GB server switched on around the clock.
On Supabase, the metered dimension is *egress*: every byte PostgREST returns,
uncompressed. Rows, columns, and call counts are the only levers.

**Where the bleed was, in order of size (from `scripts/recon` cost models and
the read-only recon report).**

| Source | Before | Monthly cost (est.) |
| --- | --- | --- |
| Speaker Pi long-poll (`/api/announcer/poll`) | 25 s hold, 1 s claim loop (≈86,000 DB calls/day), heartbeat UPDATE on every poll, instant reconnect | ≈ $15 Vercel memory per paired Pi, 24/7 |
| Receipt printer Pi (`/api/cloudprnt`) | 3 s idle poll (≈28,800 polls/day), `select("*")` ×2 + settings UPSERT per poll | ≈ $1.90 Vercel, ≈ 0.3 GB egress |
| Full published menu reads (~5.9 MB, ~4,500 items) | `select("*")` on menu tables; product-image route loads the whole menu for one row; 60 s cache TTL | Largest Supabase egress line |
| Rebuilds (Preview + Production, two projects) | ~162 builds in 5 days | Largest Vercel line historically; staging now paused (rule 13) |
| Admin orders board poll | 10 queries every 15 s per open tab | ≈ $0.29 + 0.24 GB per tab |
| Leafly crons (`*/2`, `*/15`) | idle ticks | ≈ $0.05 total |

---

## Slice 1 — the always-on pollers (this PR)

**Announcer, server side** (`announcer-core.ts`, `announcer-store.ts`,
`api/announcer/poll/route.ts`). The claim loop now looks for work every
`POLL_CHECK_INTERVAL_SECONDS = 5` instead of every second, with the first
check still immediate, so a queued announcement is heard within five seconds
at worst — one fifth of the `announcer_claim_work` traffic. The heartbeat
UPDATE is now written only when the stamp read during authentication is at
least `HEARTBEAT_WRITE_INTERVAL_SECONDS = 40` old (`shouldWriteHeartbeat`,
pure and self-tested). The poll response carries a new field,
`idleRestSeconds` (`POLL_IDLE_REST_SECONDS = 10`), which old agents ignore
harmlessly. The self-tests prove `hold + rest + 15 s < DEVICE_ONLINE_GRACE
(90 s)` and `2 × heartbeat interval < grace`, so the dot in the back office
cannot flicker.

**Announcer, Pi side** (`pi-agent/greenway_announcer.py` v1.2.0, served copy
synced). After an *empty* successful poll the agent rests for the server's
`idleRestSeconds` (clamped 0–30, default 10 when the server does not send it),
sleeping in half-second slices so `stop` is honoured promptly. After a poll
that *did* carry jobs it polls again at once, so a burst of orders drains
without pause. Failure backoff is unchanged. Selftest and end-to-end suites
extended and passing (406 / 66 checks).

**Printer, Pi side** (`pi-agent/greenway_printer.py` v1.1.0, public copy
synced). `IDLE_POLL_SECONDS` 3 → 15. A poll that found a receipt is followed
by another poll immediately (`idle_delay_for`), so back-to-back receipts still
print back to back; only the *empty* case slows down. A receipt therefore
appears within fifteen seconds of the order instead of three — well before
anyone reaches the counter. 156 / 77 checks pass.

**Printer, server side** (`printer-store.ts`, `printer-heartbeat-core.ts`,
`api/cloudprnt/route.ts`). The two hottest reads name their columns instead of
`select("*")`, and the claim candidate read omits `body_text` (the only wide
column) because the claim step never reads it. The heartbeat UPSERT is now
throttled to once per 40 s while MAC and status are unchanged
(`shouldWritePrinterHeartbeat`, pure, registered in the selftest runner and
mirrored in vitest), and the poll handler reuses the settings row it already
read for authentication, so a quiet printer costs one read per poll instead of
one read plus one write. Admin copy and the setup guide now say "every 15
seconds" instead of "every few seconds".

**Deliberately NOT changed in this slice.**

*Leafly crons.* `leafly-ack-sweep` every 2 min and `leafly-menu-sync` every
15 min cost about five cents a month combined (idle tick ≈ 0.3 s, one indexed
read). Slowing the ack-sweep would reduce the number of chances to rescue an
order inside Leafly's fifteen-minute window for no meaningful saving, which is
exactly the "crippling" the owner ruled out. Rule 12's text about cost stands
as written: for *these* routes, cost is not the constraint.

*The 25-second hold itself.* Shortening the hold with a longer rest would save
more Vercel memory (a 10 s hold with a 25 s rest models at ≈ $4.50/mo per Pi
against ≈ $11 with the values shipped here), but it changes announcement latency
and the protocol tests around `POLL_HOLD_SECONDS`. It is a candidate for Slice
3 once the owner has seen the effect of this slice in the Vercel usage
dashboard; the right long-term answer is Realtime push (below).

*Orders board poll.* Consolidating seven `count(*)` queries into one grouped
RPC is worth doing but needs a migration; deferred to Slice 3 so this PR stays
reviewable.

**Expected effect.** Per paired speaker Pi: Vercel memory ≈ $15 → ≈ $11/mo
(hold unchanged; the rest removes the instant reconnect) and Supabase calls
≈ 92,000 → ≈ 17,000/day (auth read + five claims per poll + a heartbeat
every 40 s). Printer: ≈ 26,000 → ≈ 5,600 polls/day, ≈ 78,000 → ≈ 13,000 DB
calls/day, heartbeat writes ≈ 26,000 → ≈ 2,200/day.

**Owner action.** Re-run the installer on each Pi so they pick up agent
v1.2.0 / printer v1.1.0 (`docs/announcer/06-copy-paste-quickstart.md`,
`docs/receipt-printer-setup.md`). Until then the old agents keep working
against the new server — they simply do not rest between polls.

## Slice 2 — full-menu egress

The published menu is ≈ 5.9 MB across ≈ 4,500 items and is the largest single
Supabase egress line. Planned: explicit column lists on `menu_items`,
`menu_variants`, `menu_versions` in `src/lib/pos/menu-version.ts` (dropping
wide columns nobody renders); `/api/pos/product-image` looks up its single row
by id instead of loading the whole menu; cached, tag-invalidated menu reads
where `MENU_READ_SURFACES` policy allows (edited deliberately, with the reason
recorded in the table); `images.minimumCacheTTL` in `next.config.ts` so
optimised images are not re-fetched from Supabase storage on every request.

## Slice 3 — remaining pollers and cadence

Orders board: one grouped-count RPC instead of seven `count(*)` queries, keep
the visible poll ≤ 15 s (pinned by `new-order-watch.test.ts`), lengthen the
hidden-tab poll. Register/cockpit refresh cadence review. Consider a shorter
announcer hold with a longer rest once Slice 1's effect is measured.

## Slice 4 — push instead of poll for the announcer

Replace the long-poll with Supabase Realtime (Postgres Changes on the
announcer jobs table) from the Pi, keeping the poll as a fallback. This
removes the always-open Vercel function entirely; the Pi holds one WebSocket to
Supabase instead. Requires a Realtime-capable client on the Pi and careful
reconnection logic; do this after the cheaper wins are measured.

## Slice 5 — Vercel project settings (owner, in the dashboard)

Spend Management with a hard cap; disable Preview deployments (or Ignored
Build Step for non-`main`); on-demand concurrent builds off; remove Speed
Insights if not used; confirm staging stays paused (rule 13). Build-time
database reads audited so a deploy does not itself pull the menu.

## How to verify each slice

**Vercel.** Team → Usage → filter to `greenway_website`, by meter: *Function
Duration / Provisioned Memory* should fall after Slice 1 (the Pi is no longer
holding an instance 24/7); *Invocations* for `/api/cloudprnt` should fall about
five-fold. Project → Observability → Functions → `/api/announcer/poll` shows
p50 duration ≈ 25 s (unchanged) but far fewer invocations per hour.

**Supabase.** Project → Reports → Usage → *Egress* daily chart should bend
down within a day of the Pis being reinstalled; Reports → Query Performance →
*Most frequent* should no longer show `announcer_claim_work` at ≈ 1/s or the
`receipt_printer_settings` upsert near the top; Logs Explorer → Top Paths
shows `/rest/v1/receipt_printer_settings` and `/rest/v1/rpc/announcer_claim_work`
counts an order of magnitude lower.
