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
| Rebuilds (Preview + Production, two projects) | ~162 builds in 5 days; still 10–24 Preview builds/day on `greenway_website` after staging was paused | Largest Vercel line historically; staging paused (rule 13), previews off for non-`main` (Slice 5) |
| Uncached public pages (`/specials`, `/loyalty`, `/medical`, 811 product pages) | `force-dynamic`: one full render + 1–6 DB reads per visitor and crawler | Vercel function time + Supabase reads scale with traffic (Slice 5) |
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

## Slice 3 — remaining pollers and cadence (PR: USAGE-3)

Recon (`grep` of every `setInterval` / `setTimeout` chain / `EventSource` /
`.channel(` under `src/`) found five recurring network pollers still running
regardless of whether anyone could see or use their answer, plus one hidden
write that rode on every register call. Everything below is measured from the
code, not estimated; the per-day figures assume one device or tab left open
24 h.

**a. `pos_devices.last_seen_at` — one UPDATE per register API call.**
`authenticateDevice` (used by all 22 `/api/pos/*` routes) followed every
successful credential check with an unconditional
`update({ last_seen_at })`. The 15 s interrupt poll alone made that ≈ 5,760
writes/day/register; the 45 s pickup badge and every flush added more.
Nothing reads the column below minute resolution (the Devices page shows
`last_synced_at`; no SQL consumes it). New pure
`src/lib/pos/device-heartbeat-core.ts` (60 s throttle, same shape as Slice 1's
printer throttle); the auth SELECT now also returns `last_seen_at` so no
extra read is needed. ≈ 5,760 → ≈ 1,440 writes/day/register from the poll,
and zero once the register is locked (see d).

**b. Orders dashboard poll — ten PostgREST requests every 15 s → one.**
`/api/admin/orders/count` ran seven `count(*) … head:true` (one per status),
one arrivals list and two `max(updated_at)` reads per poll: 10 requests ×
5,760 polls/day = 57,600 requests/day per open Orders tab. Migration
`0233_orders_board_snapshot.sql` adds a read-only, `service_role`-only jsonb
function that answers all four questions in one call (counts come from a
single `group by status` over `orders_status_idx`); the count keys are
derived from the `order_status` enum so every status is always present.
`getOrdersBoardSnapshot()` (orders-store) calls it and falls back to the exact
legacy readers on PostgREST's "function not found" (`rpc-fallback-core`) or a
malformed payload — the JSON the client sees is byte-for-byte the same. The
board page's stat cards and the owner cockpit also go 7 → 1. The visible
cadence stays 15 s (owner's chime requirement, pinned); the hidden-tab
cadence goes 60 s → 120 s (`HIDDEN_POLL_MS`) because a covered tab cannot
show the board and the Pi announcer is the floor alert. Proven on Postgres 15
with all 233 migrations applied plus a committed scenario script
(`scripts/recon/orders-board-snapshot-pg-check.sql`). **The owner must run
0233** (`docs/MIGRATIONS_TO_RUN.md`); until then the code silently uses the
old path.

**c. Client pollers that ran forever.** New pure `src/lib/ui/poll-gate-core.ts`
gives one rule — *done → stop; hidden → pause and poll once on return; else
active/idle cadence* — to three components:
- `OrderConfirmation` (public checkout page): was `/api/orders/<token>` every
  30 s for as long as the tab existed, each one an `orders` + `order_lines`
  read. Now pauses while hidden and **stops for good** once the order is
  completed / cancelled / no-show (terminal set pinned to
  `CLOSED_ORDER_STATUSES`). A transient error still retries.
- `HarvestJobsLive` (KB harvest pages): idle 30 s → 120 s, paused while
  hidden; the 5 s cadence while a job is actually running is unchanged.
- `VendorCrawlStatusChip` (every vendor detail page): idle 30 s → 120 s,
  paused while hidden; still stops outright when the crawl finishes.
Each of those admin polls also paid `requirePermission` (auth `getUser` +
`staff_profiles` read) and an external crawler call.

**d. Register interrupt poll paused while LOCKED.** The L-14 Leafly-cancel
channel polls `/api/pos/interrupts` every 15 s whenever the register has
credentials and is online — including all night on the lock screen, where
`lock()` has already parked any sale and the modal is not rendered at all.
Gate is `screen === "locked"` only; `home`/`saleActive` gating is still
forbidden by test (mutation-checked: removing the gate fails the suite).
Unlocking re-arms with an immediate poll, so an overnight cancel is on
screen sooner than before. Mid-sale behaviour is untouched.

**Left alone, with reasons.** `/api/pos/version` (60 s while locked) is
`force-static` and never touches the database — it is a CDN hit. The 15 s
background flush only POSTs when the queue is non-empty. The 45 s pickup
badge is already gated on the home screen. The announcer cadence is Slice 4.

## Slice 4 — the announcer stops holding a Vercel instance open (PR: USAGE-4)

**What was measured first.** `scripts/recon/announcer-poll-cost-model.mjs`
(read-only, no network) prices one paired speaker per month under each poll
shape from the Fluid pricing above. After Slice 1 the shape was a 25 s hold
followed by a 10 s rest: one 2 GB instance in flight 72 % of every day,
≈ 2,400 polls/day, **≈ $11.06/mo per Pi**, mean order→chime ≈ 3.5 s, worst
≈ 11 s. The roadmap's earlier idea (10 s hold, 25 s rest) models at ≈ $4.61
but triples the mean latency to ≈ 10 s. The hold exists for exactly one
reason: to stop a Pi that reconnects instantly from hammering the site. Agent
v1.2.0 (Slice 1) rests on its own for `idleRestSeconds`, so for that agent the
hold is pure cost — the server is paying to wait for a Pi that would happily
wait by itself.

**Why not Realtime.** The roadmap originally planned Supabase Realtime from
the Pi. Recon against `docs/announcer/00-strategy-and-roadmap.md` §2 found the
design explicitly rejected any second always-on connection to a second system
(MQTT, FCM) as a new failure domain; a Realtime WebSocket from the Pi is the
same trade. It also needs a websocket library the Pi does not have (the agent
uses only `requests`), a reinstall on every speaker, and new reconnection
logic on the one device nobody can open a browser on. The change below gets
≈ 93 % of the saving with zero new dependencies and no reinstall.

**What changed.** `src/lib/announcer/announcer-poll-shape-core.ts` (new,
pure, 47 self-tests, registered in `run-pure-selftests.ts` with a floor of 40,
mirrored in `tests/compliance/announcer-poll-shape.test.ts` including a
route-wiring test that was proven to fail when the route was mutated back to
the constant). `resolvePollShape({ userAgent, requestedHold, enabled })`
decides the shape of each poll from facts the request already carries:

* **agent ≥ 1.2.0** (every agent has sent `user-agent:
  greenway-announcer/<version>` since the first release — verified with
  `git show 1328fa57:pi-agent/greenway_announcer.py`) → **hold 0**: one
  immediate `announcer_claim_work`, answer, agent rests 10 s.
* **agent 1.1.0, or no / foreign user-agent** → the classic 25 s hold,
  unchanged, because that agent does not rest and an instant answer would
  make it poll twice a second (≈ 170,000 requests/day — worse than the
  memory it saved). The safe default is the slow one.
* **disabled speaker** → hold 0 and `idleRestSeconds: 30`, the most the
  agent's clamp (`MAX_IDLE_REST_SECONDS`, pinned by test) accepts. Still
  green: 0 + 30 + 15 < 90 s grace, asserted in the self-tests.

`src/app/api/announcer/poll/route.ts` calls it and uses `shape.holdSeconds`
and `shape.idleRestSeconds`; the claim loop is unchanged (its first check is
at t = 0, so a zero hold is one look, not none). `pollHoldSeconds` in the
response still reports `POLL_HOLD_SECONDS` — it is the protocol ceiling the
agent sizes its 45 s timeout from and the admin "listen for up to 25
seconds" copy reads it; both stay true. `docs/announcer/00-strategy-and-roadmap.md`
§2 now describes the hold as the legacy-agent path.

**Left alone, with reasons.** `POLL_HOLD_SECONDS`, `resolveHoldSeconds` and
every test that pins them: they are still the live path for v1.1.0 and the
ceiling for everyone. `POLL_IDLE_REST_SECONDS = 10`: raising it to 30 would
cut another ≈ $0.50/mo per Pi but triple the mean order→chime to ≈ 16 s,
which the owner did not ask for. The Pi agent (`pi-agent/greenway_announcer.py`
and its byte-identical served copy): no change, no reinstall — a v1.2.0 Pi
simply starts getting instant answers on the next deploy. The 15 s admin
panel refresh (`ADMIN_REFRESH_SECONDS`): one cached read per open Announcer
panel, not always-on.

**Expected effect (from the model).** Per paired v1.2.0 speaker: in-flight
duty 72 % → 5 %, Vercel memory ≈ $10.96 → ≈ $0.73/mo, total Vercel
≈ $11.06 → ≈ $1.05/mo; Supabase calls ≈ 14,600 → ≈ 16,500/day (one claim per
poll instead of five, but more polls — a wash; egress ≈ 0.22 → 0.35 GB/mo,
still under 0.4 GB, and disabled speakers fall to ≈ 5,700/day). Mean
order→chime 3.5 s → ≈ 6 s; worst case unchanged at ≈ 11 s. A speaker still
on v1.1.0 sees no change at all until the installer is re-run.

## Slice 5 — whole-system audit: builds, uncached public pages, wide reads (PR: USAGE-5)

After Slices 1–4 the standing instruction was to go back through everything
not yet looked at and account for the rest of the bleeding. This slice is
that audit. Every number below was measured on 2026-09-27 against the live
production alias `https://greenwaywebsite1.vercel.app` (the same build as the
production deployment; `www.greenwaymarijuana.com` resolves to WP Engine and
is **not** this Vercel project) or read from the GitHub deployments API.
Nothing here was inferred.

**a. Preview builds on every PR push — the largest remaining Vercel line.**
The GitHub deployments API showed Preview builds on `greenway_website` of
12 (9/23), 10 (9/24), 20 (9/25) and 24 (9/26) a day: one per push to any
branch, plus a Production build per merge. Vercel bills builds per
CPU-minute. Fix: `vercel.json` now carries
`"git": {"deploymentEnabled": {"main": true, "**": false}}`. This was
**tested before it was adopted**: a throwaway branch carrying the block
(`2bf9afd8`) produced zero deployments and zero commit statuses, while a
control branch pushed 12 s later with the old file (`4bc60b12`) produced a
Preview deployment within 4 minutes. Both probe branches were deleted.
Consequence, written into AGENTS.md rule 13: there is no `Vercel –
greenway_website` PR check any more; the merge gate is CI
`build`/`compliance`/`migrations`, and the post-merge production status read
is mandatory. `tests/compliance/usage-5-preview-builds-off.test.ts` pins the
block (object form, `main` the only `true`, `**` false) and the rule text.

**b. Four public pages were `force-dynamic` — a full server render per
visitor and per crawler.** Every hit to `/specials`, `/loyalty`, `/medical`
and `/menu/products/[id]` answered `x-vercel-cache: MISS` with
`cache-control: private, no-cache, no-store`: `/specials` 0.43 s (1.3 MB
HTML, four promotions reads + content blocks + banners + the whole live
menu), `/loyalty` 0.37 s (content, banners, `loyalty_config`,
`loyalty_tiers`), `/medical` 0.45 s (content blocks), and all **811**
product URLs in the sitemap at 0.5–0.8 s and 268–314 KB each. `/`, `/menu`,
`/menu/[category]`, `/vendor-delivery` and `/about` were already
PRERENDER/HIT/STALE from SLICE D/E. Fix: the four routes now export
`revalidate = 60` (= `MENU_CACHE_TTL_SECONDS`) so visitors in the same minute
share one render. Freshness is kept by revalidation, not the TTL — the same
argument that made the home page cacheable: `/specials` is in
`PUBLIC_MENU_SURFACES` and is cleared by promotion status / never-discount
actions and the Specials editor; `/medical` is cleared by the hide-flag
publish; `/loyalty` is cleared by the Loyalty-page editor and — **new in this
slice** — by the program editors (`saveLoyaltyConfigAction`,
`saveLoyaltyTierAction`, `deleteLoyaltyTierAction`), which previously only
cleared `/admin/loyalty`. Product pages have a dynamic segment, so
`revalidatePublicMenuSurfaces()` gained `PUBLIC_MENU_PAGE_PATTERNS =
["/menu/products/[id]"]` and calls `revalidatePath(pattern, "page")` (the
form the Next.js docs require for dynamic segments). Draft Mode bypasses the
route cache, so staff preview still sees drafts on demand; unknown product
ids still 404 (`notFound()`, no `generateStaticParams`); the price on a
product page was never trusted — `repriceOrderLines` re-verifies at order
placement. Tests: `usage-5-public-page-revalidate.test.ts` pins the exports
and every writer path; the public-surfaces test pins the pattern list.

**c. Register pickup queue selected every `orders` column.** The register's
45 s home-screen poll (`/api/pos/pickup`) ran `listOrders({status:
"active", limit: 200})` → `select("*")` on `orders` (28 columns, including
`limit_reasons` jsonb, customer email/phone/birthday, loyalty fields) to
build a queue entry that reads 12 of them. Fix: `PICKUP_QUEUE_ORDER_COLUMNS`
/ `PICKUP_QUEUE_ORDER_SELECT` in the pure `pickup-core.ts` (self-tested), a
new `listOrdersColumns(columns, filter)` in `orders-store.ts`, and
`pickup-store.ts` uses it. `listOrders()` itself is unchanged (`select("*")`)
so the Orders board and oversight paths and their pinned tests are
untouched. `usage-5-pickup-queue-columns.test.ts` pins that the column list
covers exactly what `toPickupQueueEntry` and the `staff_note` filter read.

**Audited and deliberately left alone (with the reason).**
*Root layout* (`src/app/layout.tsx`) still does 4–5 uncached PostgREST reads
per render (`getContentValues` for fonts, `loadPublishedRuleSnapshots`):
`getContentValues` calls `draftMode()`, which cannot run inside
`unstable_cache`, so caching it needs a redesign; with every public page now
cached the layout renders once per minute per page instead of per visitor,
so it is a much smaller number than it was. *`/unsubscribe`* is
`force-dynamic` legitimately (per-token). *`/api/estimator`* POSTs only when
the cart is expanded. *The `crawler/` Python worker* deploys on Railway on
each merge (`giving-sparkle / production`) — a separate service, not a
Vercel or Supabase cost, and it only writes `ai_suggestions`. *Register
polls* were handled in Slice 3 (45 s pickup gated to the home screen; 15 s
interrupt poll paused while locked; version check locked-only; flush only
when the queue is non-empty). *NewOrderAlert* is 15 s visible / 120 s hidden
(owner-pinned chime cadence). *Not bleeds:* `staff_profiles select("*")` (8
small columns), Speed Insights (free tier), GA4 (env-gated), `sitemap.xml`
and `robots.txt` (HIT), Supabase storage URLs (none in public menu HTML),
the Leafly crons (`*/15`, `*/2`, rule 12 — not touched).

**Owner, in the Vercel dashboard (not codeable).** Spend Management with a
hard cap; on-demand concurrent builds off; remove Speed Insights only if it
is not being read; confirm `greenway-staging` stays paused (rule 13). The
"disable Preview deployments" item from the earlier version of this section
is now done in code (item a) and needs no dashboard change.

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

**Slice 5.** Builds: Vercel → Project → Deployments — from the USAGE-5 merge
onward, pushing to any PR branch creates **no** Preview entry; only merges to
`main` appear (as Production). From a terminal, a PR head commit shows no
Vercel status at all:
`gh api repos/mblyman89/GREENWAY-WEBSITE/commits/<pr-head-sha>/status --jq '.statuses[].context'`
prints nothing for Vercel, while the merged `main` commit prints
`Vercel – greenway_website` with state `success`. Team → Usage → *Build
Minutes* / *Build Execution* should fall from 10–24 builds a day to roughly
the number of merges. Pages: `curl -sI https://greenwaywebsite1.vercel.app/specials`
(and `/loyalty`, `/medical`, any `/menu/products/<id>` from the sitemap) —
the first hit after a deploy is `x-vercel-cache: MISS`, the second within a
minute is `HIT` (or `STALE` past 60 s), and `cache-control` no longer says
`private, no-cache, no-store`. Vercel → Observability → Functions: the
`/specials`, `/loyalty`, `/medical` and `/menu/products/[id]` rows drop to at
most one invocation a minute each regardless of traffic. Freshness check:
publish a Specials/Loyalty-page edit or change a loyalty tier in the back
office, then reload the public page once — the change is there without
waiting for the TTL. Supabase → Logs Explorer → Top Paths:
`/rest/v1/promotions`, `/rest/v1/content_blocks`, `/rest/v1/loyalty_config`
counts fall to about one per minute per page during traffic;
`/rest/v1/orders` GET from the register shows `select=id,order_number,…`
(twelve named columns) rather than `select=*`, and its per-request
`Content-Length` shrinks accordingly.

**Slice 4.** Vercel → Observability → Functions → `/api/announcer/poll`:
p50 duration should fall from ≈ 25 s to well under one second within minutes
of the deploy (v1.2.0 Pis; a v1.1.0 Pi keeps ≈ 25 s until reinstalled), and
invocations per hour rise from ≈ 100 to ≈ 340 per speaker — that is expected
and cheap ($0.60 per million). Team → Usage → *Provisioned Memory* /
*Function Duration* is the line that should bend hardest, since the speaker
was the largest single contributor. Back office → Orders → Announcer panel:
every speaker's dot stays green; a Test press still chimes well inside the
25 seconds the panel promises (worst case ≈ 11 s). Supabase → Logs Explorer →
Top Paths: `/rest/v1/rpc/announcer_claim_work` count roughly unchanged (one
per poll instead of five per hold); `/rest/v1/announcer_devices` PATCH count
unchanged (the Slice 1 heartbeat throttle still applies). To confirm which
path a Pi is on, `journalctl -u greenway-announcer -n 5` prints
"Greenway announcer v1.2.0 starting" on the first line after a restart.

**Slice 3.** Supabase → Reports → Query Performance → *Most frequent*: the
`update pos_devices set last_seen_at` statement and the seven
`select count(*) from orders where status = $1` statements should drop out of
the top of the list (the counts vanish entirely once 0233 is applied — look
for `orders_board_snapshot` instead, at ≈ 4/min per open Orders tab). Logs
Explorer → Top Paths: `/rest/v1/orders` request count falls roughly ten-fold
during shop hours; `/rest/v1/pos_devices` PATCH count falls by ≈ 75 % and to
zero overnight. Vercel → Observability → Functions: `/api/admin/orders/count`
p50 duration drops (one awaited call instead of ten in parallel);
`/api/pos/interrupts` invocations fall to zero outside opening hours;
`/api/admin/harvest` and `/api/orders/[token]` invocations fall to a
fraction. Nothing on the register or the board should look different.

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
