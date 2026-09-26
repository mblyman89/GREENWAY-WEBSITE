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

## Slice 2 — full-menu egress (PR: USAGE-2)

The published menu is ≈ 5.9 MB across ≈ 4,500 items and is the largest single
Supabase egress line. Every full-menu read used `select("*")`, so two jsonb
columns nobody renders rode along on every read: `menu_items.fact_provenance`
(per-fact audit trail, admin-only) and `menu_versions.summary_json`
(the import's diff summary, admin-only). Recon (recorded in the PR)
listed every caller of `loadLiveMenuAll` / `getVersionItems`: the public
site's cached path (hits the DB only on a cache miss, once a minute at most),
`/api/pos/menu` (boot-only register download, no timer), order repricing
(the money — deliberately unchanged), the opt-in Leafly cron (off by default,
skips when the menu is unchanged), the admin pages, and — the real leak —
`/api/pos/product-image`, which loaded the WHOLE menu on every info-card
open and `.find()`ed one item.

**What changed.**

`src/lib/pos/menu-columns-core.ts` (new, pure, self-tested and mirrored in
`tests/compliance/menu-columns-core.test.ts`) renders explicit column lists
typed against `MenuItemRow` / `MenuVariantRow` / `MenuVersion`, so adding a
column to the type without adding it to the list is a compile error, and
records exactly which columns are dropped (`fact_provenance`,
`summary_json`). `src/lib/pos/menu-version.ts` uses them in
`getPublishedVersion` (`MENU_VERSION_LIGHT_COLUMNS`, returning
`summary_json: null` — every caller reads only `id` and the count/date
columns), `getVersionItems` and `getItemBySourceKey` (`MENU_ITEM_COLUMNS`,
`MENU_VARIANT_COLUMNS`). The admin-only reads that DO render `summary_json`
(`getVersion`, `listVersions`, `listIntakeStagedVersions`, `pos_imports`,
`pos_import_diagnostics`) are untouched.

`src/lib/pos/live-menu.ts` gains `getLiveMenuItemByIdDirect(id)`: published
version → one `menu_items` row → its variants → `menuRowToGreenwayItem` →
`withCardIdentity`, i.e. the same conversion the list path applies, so the
result is field-for-field identical. Hidden rows resolve to `undefined`
exactly as before. `/api/pos/product-image` now calls it; the endpoint stays
read-through (`MENU_READ_SURFACES` entry updated with the reason). The old
`getLiveMenuItemById` stays for the public path.

`src/lib/media/store.ts` `uploadMedia` now uploads with
`cacheControl: "31536000"` (one year) instead of storage-js's default one
hour. Storage keys embed the first 16 hex of the content sha256, so a URL
never changes its bytes; a new image is a new key. This applies to NEW
uploads only — existing objects keep their 1 h header until re-uploaded.

**Deliberately not changed, and why.** `MENU_CACHE_TTL_SECONDS` stays 60 —
the owner pinned it (`slice-d-menu-performance.test.ts`) and the cached path
is already gzip-enveloped (≈ 204 KB per miss), so the remaining cost is one
DB read a minute, not a leak. `images.minimumCacheTTL` in `next.config.ts` is
skipped because the public cards render raw `<img>` tags straight from
Supabase Storage, so `next/image` optimisation is not on the egress path —
the storage Cache-Control above is the lever that matters. The Leafly cron
cadence is pinned by rule 12 and already short-circuits when the menu hash is
unchanged. `/api/pos/menu` is a boot-only download by design (the register
caches the bundle on-device) and is not a recurring cost.

**Expected effect.** Each `/api/pos/product-image` call falls from a ≈ 6 MB
Supabase read (plus ≈ 1–2 s of Vercel function time spent parsing it) to two
sub-kilobyte queries. Every remaining full-menu read is smaller by the size
of `fact_provenance` across ≈ 4,500 rows. Storage image egress falls as the
CDN starts holding new uploads for a year.

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

**Slice 2.** Vercel → Observability → Functions → `/api/pos/product-image`:
p50 duration should drop from seconds to well under one second, and its
share of *Function Duration* on the Usage page should fall accordingly.
Supabase → Reports → Query Performance → *Most time consuming* / *Most
frequent*: the `menu_items` `select` with `menu_version_id = … ` filter
returning thousands of rows should disappear from the frequent list (only
cache-miss reads remain, at most one a minute); Logs Explorer → Top Paths:
`/rest/v1/menu_items` request count falls and, per request, the response
size shrinks (check `Content-Length` in a sampled log line — it should no
longer be in the megabytes for the product-image path). Storage: Reports →
Storage → egress bends down over the following weeks as newly uploaded
photos are served from the CDN edge (existing objects keep 1 h until they are
re-uploaded).
