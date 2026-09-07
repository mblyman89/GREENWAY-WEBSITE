# Online Order Announcer — Strategy and Roadmap

**Owner:** Michael Lyman — Greenway Marijuana, Port Orchard WA
**Goal:** when an online order lands, a speaker in the office, a speaker on the
sales floor, and a speaker in storage all say so, reliably, forever, with no
babysitting.

This document is the plan. It is written before any of the shipping code so
that every decision below can be checked against the code that follows. Nothing
in it is guessed. Every claim about the existing system was read out of the
repository first, and the file and line are cited so you can check me.

---

## 1. What was found in the code before anything was designed

Before choosing an architecture I read the parts of the system this feature has
to live inside. These are facts, not assumptions, and each one changed the
design.

The site runs on Vercel serverless functions. `vercel.json` declares three cron
entries and nothing else. The single longest function timeout anywhere in the
repository is sixty seconds, declared as `maxDuration` in
`src/app/api/pos/sync/route.ts`. A grep across `src/app` for
`text/event-stream` and for `ReadableStream` returns nothing at all, which
means there is not one streaming endpoint in the product today. There is no
WebSocket server, no Server-Sent Events channel, and no persistent socket of
any kind. That single fact is the hinge the whole design turns on: whatever the
Raspberry Pi talks to, the conversation has to finish inside sixty seconds and
then start over.

The back office already knows how to notice a new order. `src/app/admin/orders/page.tsx`
renders a `NewOrderAlert` component, and that component polls
`src/app/api/admin/orders/count/route.ts`, which is guarded by
`requirePermission("orders.view")` and returns a counts object, an active list,
an arrivals list from `getRecentOrderArrivals(20)`, and a server timestamp. The
watch logic behind it lives in `src/lib/orders/new-order-watch-core.ts` and uses
a high-water-mark on `placed_at`: remember the newest timestamp you have already
seen, and treat anything strictly newer as new. That pattern is correct, it is
already proven in production here, and the announcer reuses the same idea rather
than inventing a second way to answer the same question.

The system already authenticates non-browser devices. `src/lib/pos/sync-store.ts`
has `authenticateDevice(deviceId, deviceKey)`, which looks the device up in
`pos_devices` and checks the presented key against a stored scrypt hash using
`verifyPin(deviceKey, provision_hash)`. The register hardware already logs in
this way. A Raspberry Pi is the same kind of thing as a register: a box in the
building with a long-lived secret. It gets the same treatment, mirrored, not a
new invention.

Permissions are centralized in `src/lib/auth/roles.ts`. `orders.view` and
`orders.manage` are granted to owner, admin, manager, and staff.
`settings.manage` is granted to owner and admin only. The announcer follows
that split exactly: any staff member can see whether the speakers are alive and
press Test, but only an owner or admin can pair a new device, change quiet
hours, or delete a sound.

Private file storage has an established shape. `supabase/migrations/0142_intake_docs_archive.sql`
creates a bucket with `public` set to false and then attaches read and write
policies on `storage.objects` that require `public.is_staff()`. Custom uploaded
audio uses that same shape. The newest migration in the tree is 0221, so this
feature starts at 0222.

---

## 2. The architecture, and the four alternatives that were rejected

The requirement is that the shop's speakers hear about an order within a couple
of seconds, that the connection be "nigh unbreakable," and that adding a fourth
or fifth speaker later be trivial.

**Rejected: port forwarding to the Pi.** This is the obvious answer and it is
the wrong one. It requires opening a hole in the shop router, it breaks the
first time the ISP rotates the WAN address, it breaks again the first time the
router reboots and hands out a different DHCP lease, and it puts a small Linux
box directly on the public internet. It also means every new speaker is a new
router rule. Michael has to be able to fix this himself at nine on a Saturday;
a design whose failure mode is "log into the router" fails that test.

**Rejected: Server-Sent Events or WebSockets from Vercel.** A held-open
connection is the textbook answer for push, and on a normal long-lived server it
would be right. It is not available here. Sixty seconds is the ceiling, proven
by `src/app/api/pos/sync/route.ts`, and no streaming endpoint exists to build
on. A connection that is guaranteed to be killed every sixty seconds is a
polling loop wearing a costume, and a costume adds failure modes without adding
reliability.

**Rejected: a third-party MQTT broker.** MQTT is genuinely the right protocol
for this class of problem and in a different deployment I would use it. Here it
means a paid hosted broker or a self-hosted one, either way a second system that
can be down independently of the website, with its own credentials, its own
billing, its own outage page, and its own thing to learn. The shop would gain a
new way to fail silently. The value is not worth the new failure domain.

**Rejected: Firebase Cloud Messaging or similar push.** Same objection, plus it
is designed for phones, plus it is best-effort by contract, which is exactly the
guarantee this feature must not have.

**Chosen: outbound long-poll against a database claim queue.** The Pi opens an
ordinary HTTPS request to the site and the server holds it for up to
twenty-five seconds waiting for work. If work appears, the server answers
immediately; if nothing appears, the server answers "nothing" and the Pi asks
again at once. Twenty-five seconds sits at better than a two-times margin under
the sixty-second ceiling, so the request finishes well before anything upstream
would cut it. The connection is always initiated from inside the shop, which
means it traverses the router the same way a browser does — no inbound rule, no
static address, no dependence on the ISP. If the internet drops, the Pi retries
on a backoff and heals itself the moment service returns; nobody has to touch
it.

Work lives in a Postgres table and is handed out with `FOR UPDATE SKIP LOCKED`
under a short lease. That one detail is what makes multiple speakers easy: when
an order arrives, one row is written per enabled device, and each Pi claims only
its own rows. Three speakers is three rows. A fourth speaker is a fourth row and
zero code changes. Because a claim is a lease rather than a delete, a Pi that
takes a job and then loses power does not swallow the announcement — the lease
expires and the work becomes claimable again.

The queue is deliberately forgetful. An announcement older than fifteen minutes
is dead and will not play. A speaker that was unplugged over lunch must not come
back and shout eleven stale orders at the sales floor. Stale news is worse than
no news.

---

## 3. The rules the pure core enforces

Every decision the announcer makes is a pure function with embedded self-tests,
per house rule 5, so the rules can be proven without a database, a network, or a
Raspberry Pi.

A device is **online** if it has checked in within ninety seconds. It is
**stale**, meaning probably-broken rather than definitely-broken, between ninety
seconds and ten minutes. Past ten minutes it is **offline**. Those three states
map to a green, amber, and red dot on the page and, more importantly, to a
specific next action in plain English, because a red dot that does not tell you
what to do is decoration.

Quiet hours may wrap past midnight, so a window of 21:00 to 08:00 has to be
understood as two intervals and not one impossible one. A window whose start
equals its end means quiet hours are off, not that the shop is silent forever —
the friendlier reading of an ambiguous input is the correct one when the failure
mode is silence. If a quiet-hours value cannot be parsed at all, the system
**fails open and announces**. A missed order costs the shop money. An
unexpected chime costs it nothing.

Sound resolution never returns silence. If a device is configured to play a
custom upload and that upload has been deleted, the resolver falls back to a
built-in sound rather than playing nothing, because a speaker that has gone
quiet is indistinguishable from a speaker that is broken, and a shop cannot tell
those apart from across the room.

Pairing codes are eight characters drawn from an alphabet with zero, capital O,
one, capital I, and lowercase L removed, because these codes get read aloud
across a room and typed by someone holding a Pi in the other hand. They live for
sixty minutes and are single-use.

---

## 4. The slices

**Slice 27 — Pure core and schema.** All announcer decision logic as pure,
mutation-tested modules — device health, queue claiming, quiet hours, sound
resolution, pairing codes, poll timing — plus migration 0222 creating the
tables, the private sound bucket, the RLS policies, and the claim function.

**Slice 28 — Device protocol API.** The four endpoints a Pi speaks: pair, poll,
ack, heartbeat. Device authentication mirrors the register's scrypt pattern.

**Slice 29 — Enqueue on order placement.** When an online order is placed, fan
out one queue row per enabled device. Best-effort by construction: the
announcer must never be able to fail a customer's order.

**Slice 30 — Back-office page.** The Announcer surface on the orders page —
device cards with live health, per-device volume and sound, quiet hours, the
pairing flow, a Test button per device, and an activity log.

**Slice 31 — Sound library and uploads.** Built-in sounds plus custom audio
uploaded to the private bucket, with validation and preview.

**Slice 32 — The Pi agent.** A Python agent, a one-line installer, systemd units
for auto-start and auto-restart, and an on-device self-test.

**Slice 33 — Manuals and bill of materials.** The field manual, troubleshooting
flowcharts, printable checklists, a first-day walkthrough, and the shopping
list.
