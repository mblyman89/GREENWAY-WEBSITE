# Recon, research and strategy — receiving sweep + online-order receipt printing

**Michael — this is a recon/report slice. No code was changed.** Two scripts were
added under `scripts/recon/` because they are the evidence behind the numbers
below and you should be able to re-run them yourself.

Everything here was measured or read out of the repo, or read off Star
Micronics' own manual. Where I could not prove something, I say so and I tell
you exactly what to do to find out.

**There is one big finding in Part 2 that changes the printer plan. Please read
Part 2 before you buy anything.**

---

# PART 1 — THE RECEIVING PIPELINE SWEEP

## 1.1 The short version

The receiving pipeline is in good shape. The brand bug we fixed last slice was
the serious one. I swept every remaining resolver and normalizer on the intake
path and found **three things worth your attention**, in this order:

| # | What | Severity | Writes or reads? |
|---|---|---|---|
| **A** | Auto-receive can book stock against the **wrong PO line** | **HIGH — it writes** | writes |
| **B** | Auto-receive misses on ordinary spacing (`1g` vs `1 g`) | LOW | falls back to a human |
| **C** | PO suggestions miss on `&` vs `and` | LOW | suggestion only |

Only **A** can cost you money without anyone noticing. **B** and **C** both
degrade to "a person does it by hand", which is annoying but honest.

Also worth saying plainly: **the vendor resolver is excellent.** It already does
everything we just taught the brand resolver to do — complete paging, a refusal
to create a duplicate when a read was incomplete, alias fallback. It is the
model the rest of the pipeline should copy. That is a good-news finding and I
want it on the record alongside the defects.

## 1.2 What I actually swept

I enumerated every resolver and every `normalize*` / `collapse*` / `*Key`
function on the intake path across `src/lib/inventory`, `src/lib/pos`,
`src/lib/products` and `src/lib/promotions`, then read each one and traced who
calls it. There are **four** vendor-name normalizers and **one** product-name
normalizer in play:

| Tag | Function | Where | Live? |
|---|---|---|---|
| A | `vendorKey()` | `vendor-resolve-core.ts` | yes — canonical |
| B | `normalizeVendorName()` | `po-match-core.ts:59` | yes — `po-link-store.ts:115` |
| C | unified-search normalizer | `unified-search-core.ts` | yes — search only |
| D | `normalizeProductName()` | `po-receive-core.ts:74` | yes — `po-receive-store.ts:115` |

Measured against the **105 real vendors** in the back-office database
(`scripts/recon/receiving-sweep-measure.py`):

- **A vs B: 0 disagreements** on realistic spellings — except the `&` case below.
- **A vs C: 197 disagreements.** Unified search keeps punctuation, so
  `AGRO-COUTURE` and `AGRO COUTURE.` do not link **in the search box**. This is
  a search-quality issue, not a receiving-correctness issue, so it is not on
  this list. Noting it so it is not lost.
- **Collisions: 0.** Under all three normalizers, 105 vendors produce 105
  distinct keys. **No normalizer wrongly merges two of your vendors.** This was
  the thing I most wanted to rule out, and it is ruled out.
- **posAliases: 105 checked, 0 mismatches** against `displayName`.
- **Apostrophe vendors: 0** in the real data, so that divergence between A and B
  is currently theoretical. I am not going to ask you to fix a hypothetical.

## 1.3 Defect A — auto-receive can book stock against the wrong PO line

**This is the one that matters.** Here is the exact code, at
`po-receive-core.ts:112-118`:

```
// 2) Fallback: normalized product-name match (flagged for human review).
if (candidates.length === 0) {
  const name = normalizeProductName(lot.product_name);
  if (name) {
    candidates = lines.filter((l) => normalizeProductName(l.product_name) === name);
  }
  matchedBy = "name";
}
```

Then, five lines later:

```
const target = candidates.find((l) => remaining(l) > 0) ?? candidates[0];
```

**When two PO lines normalize to the same name, this picks one and moves on.**
It does not refuse. And `po-receive-store.ts:115-118` then calls
`receivePoLine(receipt.lineId, receipt.qty)` **for real** — this path writes to
the database with no human in the loop.

Compare that to what we just did for brands, where an ambiguous squeeze is
**refused** rather than guessed. Receiving deliberately holds that line. This
code does not.

**Is it reachable?** Measured against your 1,707 real strain names
(`scripts/recon/receiving-sweep-part3.py`):

- Raw strain names that normalize to the same key: **4**
  - `Blueberry Dream*` = `blueberry dream`
  - `GG # 4` = `GG#4`
  - `Kush Mints.` = `kush mints`
  - **`Orange & Cream` = `Orange Cream`** ← two genuinely different products
- Expanded into full SKUs (strain + size), keys covering more than one distinct
  SKU: **12**
- Size suffixes merging into a different size (`1g` vs `3.5g`): **0** — good,
  that half is correct.

So yes, it is reachable, on your real catalogue, today. It needs two lines on
one PO whose names collapse together, and then it silently books the delivery
against whichever one it happened to pick first.

**What it would cost you:** the wrong line shows received, the right line shows
short. Your PO reconciliation is wrong, your variance report is wrong, and the
timeline note says "Auto-received" as though everything was fine. Nobody gets an
error.

**The fix (next slice, your call):** make the name fallback refuse ambiguity,
exactly like `resolveBrandDecision` does. If `candidates.length > 1` on the
**name** path, do not pick — push the lot to `unmatchedLots` and say why in the
note. A human receives it in thirty seconds. The `pos_product_key` path
(`candidates` from step 1) should keep its current behaviour, because the key
**is** the identity and two lines sharing a key is a different problem.

This is a small, well-contained change with an obvious test. I would like to do
it as the next code slice.

## 1.4 Defect B — spacing misses on auto-receive

`normalizeProductName` collapses punctuation to a space but then treats spacing
as significant. Measured:

```
MISS   'Blue Dream 1g'    vs 'Blue Dream 1 g'    -> 'blue dream 1g' / 'blue dream 1 g'
MISS   'Blue Dream 3.5g'  vs 'Blue Dream 3.5 g'  -> 'blue dream 3 5g' / 'blue dream 3 5 g'
MISS   'Dawg Walker 7g'   vs 'Dawg Walker 7 G'   -> 'dawg walker 7g' / 'dawg walker 7 g'
match  'Blue Dream (1g)'  vs 'Blue Dream 1g'
match  'Blue Dream - 1g'  vs 'Blue Dream 1g'
match  'Blue Dream 1g'    vs 'BLUE DREAM 1G'
```

Also, of the 156 real strain names containing punctuation, **104** fail to link
against the same name with the punctuation dropped (`Ac/Dc` vs `AcDc`,
`Astro Hi-Chew` vs `Astro HiChew`, `1:1 Blue Raspberry` vs `11 Blue Raspberry`).

**Severity is LOW and I want to be careful here.** A miss sends the lot to
`unmatchedLots` and a human receives it on the PO page. That is safe. And I
specifically do **not** recommend copying `brandKey` (which strips all spaces)
into this function, because that is what makes `1g` and `3.5g` stay correctly
apart — measured, 0 size merges. Squeezing spaces out here would trade a safe
miss for a dangerous merge. **Fix A first; B is optional and lower value.**

## 1.5 Defect C — `&` vs `and` on PO suggestions

Two of your vendors have `&` in the name: **`GREEN BEARD & CO`** and
**`R&B GROUP`**. The canonical normalizer maps `&` → ` and `; `po-match-core`'s
does not. So when a manifest says `GREEN BEARD AND CO` and the PO says
`GREEN BEARD & CO`, `suggestPoMatches` does not offer that PO.

**Severity LOW.** Nothing is mislinked — `po_id` is only ever set by a human
pressing Link. It is a missed suggestion, so someone scrolls a list instead of
clicking the top result. Worth fixing when we are next in that file, mostly
because it is a second copy of a rule that already has a canonical home.

## 1.6 What I checked and found CLEAN

I want to report the negatives too, so you know the sweep was real:

- **Strain type: one canonical parser.** `normalizeStrainTypeWord` /
  `splitStrainField` in `strain-fields-core.ts`, used by `intake-parser.ts` at
  lines 379 and 577. It handles the WA manifest bracket convention (`H`/`I`/`S`).
  **No duplicate strain-type parser on the receiving path.** The 70-odd files
  that mention "indica" are KB seed data, menu feeds and display formatters, not
  competing parsers. I checked rather than assumed.
- **Vendor resolution: no silent-null bug.** Steps 1–4 page completely via
  `pagedAllChecked`, and `decideVendorCreate` **refuses to auto-create** a
  vendor when any search was incomplete, because "not found" after a truncated
  read is not a fact. This is exactly right and it is the pattern the brand
  resolver now copies.
- **No other bare-`ILIKE`-and-hope on the intake path.** The only remaining
  `.ilike(...).limit(1)` calls are deliberate **fast paths** that fall through to
  a complete paged scan on a miss.
- **`resolveBrandId` has exactly two callers**: intake (`intake-store.ts:648`)
  and the one-time importer. Rule 11 holds.

---

# PART 2 — THE PRINTER: WHAT I FOUND BEFORE PLANNING ANYTHING

## 2.1 The headline, and I am sorry to be the bearer

**The Pi-to-Star-over-USB plan cannot work with the printer you own.** Not
"probably not" — Star's own manual says so, in two places.

Your counter printer is a **Star TSP143IIIBi** (Bluetooth model, serial
`2550923021300119`, asset tag `PRN-COUNTER-01` — from
`docs/MICHAEL-slice10-receipt-printer-and-app-store.md:57`).

From Star's official TSP100IIIBI manual, *Set External Devices → USB Port*:

> **"Communication with the printer via a USB port (1.0A) is not possible."**

And from the same manual's FAQ, under *USB peripheral does not work*:

> **"The USB port on the back of the printer only supports power supply."**

**The USB-A port on a TSP143IIIBi is a charging port for your iPad. It is not a
data port.** There is no cable you can buy that changes this. A Pi plugged into
it will charge, and nothing else will happen.

The Bluetooth model is Bluetooth-only for data. The TSP100III family is sold as
*separate* models — WLAN **or** LAN **or** Bluetooth **or** USB — and you have
the Bluetooth one.

**I would rather tell you this now than after you have spent a weekend on it.**

## 2.2 The second problem, even if USB had worked

The same manual, FAQ, *Cannot connect the tablet*:

> "Check that the Bluetooth is not connected to another iOS device. If
> connected, then remove the connection to the connected iOS device, and then
> try to connect to the Bluetooth from another host device."

And the *Auto Connection Function* page recommends turning auto-connect **OFF**
when more than one tablet uses the printer — because they contend.

So the "Star printers handle dual connections properly" idea does not hold for
this model over Bluetooth either. **One host at a time.** If the Pi took the
Bluetooth link, your iPad register would lose it — and the register printing a
customer's receipt at the counter outranks an online-order ticket, every time.
I am not willing to put that at risk for a $10/month saving.

## 2.3 THE GOOD NEWS — and this is genuinely good

**You have already built and shipped the entire online-order printing system.
It is in the repo right now. It has been there since Slice 37, and it is wired
into the orders page.**

Here is what exists:

| Piece | File | What it does |
|---|---|---|
| Database | `supabase/migrations/0047_receipt_printing.sql` | `receipt_printer_settings` (singleton) + `receipt_print_jobs` queue with a real status enum |
| Receipt rendering | `src/lib/printing/receipt-core.ts` | PURE, 48-column receipt, money in minor units, **Pacific wall clock** |
| Server store | `src/lib/printing/printer-store.ts` | queue, claim, confirm, retry cap |
| The endpoint | `src/app/api/cloudprnt/route.ts` | POST poll / GET body / DELETE confirm — the full CloudPRNT protocol |
| Auto-queue on order | `src/app/api/orders/route.ts:224` | `queueOrderReceipt(...)` when an online order lands |
| Retry policy | `src/lib/printing/print-retry-core.ts` | attempt cap, honest note |
| Diagnostics | `src/lib/printing/printer-diagnostics-core.ts` | status decoding |
| **Orders-page UI** | `src/app/admin/orders/page.tsx:189-264` | **live printer chip + one-tap test print, already on the page you asked for** |
| Settings UI | `src/app/admin/equipment/` | token, label, paper width, auto-print switch |

Your own comment at `orders/page.tsx:242` says it out loud:

> *"SLICE 113 — Receipt-printer status at a glance + one-tap test print… without
> leaving the page."*

**So the answer to "the online orders page is probably the better home for the
printer" is: you already decided that, and you already built it there.** The
chip only nags when it matters (`printerNeedsAttention` requires configured AND
auto-print on AND offline AND live orders waiting). That is exactly the
"clean UI that is not overwhelming" you asked for. It needs nothing added.

**The only thing missing is the printer.** The software was written for a
**TSP143IV** (asset tag `PRN-RECEIPT-01`, listed in `MIGRATIONS_TO_RUN.md`), and
as far as I can tell from the repo, that printer was specified but **never
bought**. I cannot prove a purchase from a git repo — please confirm.

## 2.4 What CloudPRNT actually costs: nothing

This matters, because it is the thing that makes Eatabit and Star's cloud
unnecessary.

**CloudPRNT is a protocol, not a subscription.** The printer polls a URL you
choose, over plain HTTPS, every 5 seconds by default (Star CloudPRNT Protocol
Guide v2.5.2, *Client Settings* — TSP100IV default polling time: 5 seconds, and
the Server URL is a field **you type in**).

You point it at `https://your-site.com/api/cloudprnt`. That route already
exists. **No Star cloud account. No Eatabit. No $10/month. No middleman at all.**
Star Cloud Services is an optional extra you simply do not enable.

And note the direction of travel: **the printer dials out to you.** No port
forwarding, no static IP, no firewall holes — the same property that makes your
Pi announcer robust. It works on the shop's ordinary internet connection.

## 2.5 The three honest options

**Option 1 — Buy the TSP143IVUE. Recommended.**

- Part **39473010** (gray). Measured today: **$316.55** at Barcode Factory
  (MSRP $384.00). Includes Ethernet cable, USB cable, internal power supply.
- Interfaces: **LAN + USB-C**, native CloudPRNT.
- **Zero code to write.** Plug it in, type your URL into it, paste the token.
- Two printers, two jobs, no contention: the Bluetooth TSP143IIIBi keeps serving
  the iPad register at the counter; the TSP143IV prints online-order tickets.
  That separation is already how the code is written.
- Ongoing cost: **$0/month**.
- Against the Eatabit $10/month, it pays for itself in about 32 months — but
  that is the wrong way to look at it. The real argument is that it removes a
  third party from a critical path and it needs **no new software**, which means
  no new bugs, no new thing to maintain, and nothing else to learn.

**Option 2 — Pi + a USB ESC/POS printer. Not recommended.**

Technically fine (`python-escpos` is mature, the Pi agent pattern is proven),
and hardware is ~$100–150. But it means writing and maintaining a second print
path, a second queue consumer, and a second thing that can break at 7pm on a
Saturday — to save roughly $200 once. It also throws away the working CloudPRNT
route. **You would be buying complexity to save capital.**

**Option 3 — Keep paying Eatabit $10/month.** Works today, costs $120/year
forever, and keeps a third party between you and a customer's ticket. It is the
thing you were trying to get away from.

**My recommendation: Option 1.** It is the cheapest total cost, the least code,
the least to learn, and it is the only one where the software is already
finished and already tested.

## 2.6 One thing I could not verify, and will not guess

I could not confirm from the repo whether migration `0047` has been **applied**
to your live database, or whether a TSP143IV was ever purchased. `printer-store`
degrades safely if the tables are absent, so the page will not crash either way.
Before ordering anything, check `docs/MIGRATIONS_TO_RUN.md` and tell me what you
find, and I will confirm from there.

---

# PART 3 — THE PI ANNOUNCER RECON

You asked me to recon the announcer so the printer could tie into it. Having
found that the printer does not need the Pi, the announcer recon is still worth
reporting — partly because it is the **template** for how we would do a Pi print
agent if you ever choose Option 2, and partly because you should know how good
this thing is.

## 3.1 What is there

| Layer | Location |
|---|---|
| Schema | `supabase/migrations/0222_order_announcer.sql` (333 lines) |
| Pure cores | `src/lib/announcer/` — 10 modules (admin, core, enqueue, fanout, library, protocol, sounds, stores) |
| Device API | `src/app/api/announcer/{pair,poll,ack,heartbeat,sound}/route.ts` |
| Back office | `src/components/admin/orders/AnnouncerPanel.tsx` (on the orders page) |
| **The Pi agent** | `pi-agent/greenway_announcer.py` (972 lines) |
| Installer | `pi-agent/install.sh` (290 lines), one-liner, `--uninstall` reverses it |
| systemd | `pi-agent/systemd/greenway-announcer.service` |
| Tests | `pi-agent/tests/` — e2e, install/systemd, **two mutation harnesses** |
| Manuals | `docs/announcer/` — strategy, 469-line field manual, shopping list, wall card |

## 3.2 The mechanics — and why they are the right mechanics

- **Auth:** `x-announcer-device-id` + `x-announcer-device-key` headers, key
  stored as a **scrypt hash**, mirroring the register's existing pattern. The
  plaintext key exists exactly once, on the Pi, mode 600.
- **Transport:** the Pi **long-polls outward** (held ~25s). Nothing connects
  into the shop. No port forwarding, no static IP, survives an ISP address
  change, works on Wi-Fi/Ethernet/hotspot alike.
- **Queue:** fan-out at **write** time, one row per (event, device), so each
  Pi's poll is a trivial indexed lookup and two Pis can never contend.
- **Claiming:** `announcer_claim_work()` uses `FOR UPDATE SKIP LOCKED` with a
  **lease**, not a delete — a Pi that dies mid-play cannot swallow the job.
- **Delivery proof:** only an `ack` sets `delivered_at`. Nothing else retires a row.
- **Backoff:** capped at 30s, deliberately. An hour-long outage still recovers
  on its own.
- **systemd:** `StartLimitIntervalSec=0` / `StartLimitBurst=0` in `[Unit]` — with
  a comment noting systemd *silently ignores* these in `[Service]`, verified
  with `systemd-analyze verify`. That is the difference between a speaker that
  restarts forever and one that is dead all weekend.
- **Safety:** enqueue is wrapped so it "never throws, for any input, in any
  failure mode" — a doorbell can never fail a customer's sale.

## 3.3 The honest assessment

This is the best-engineered subsystem I have read in the repo. The pattern —
pure core + thin I/O shell + outbound long-poll + lease-based claim + a Python
agent that never exits — is precisely what an enterprise-grade Pi print agent
would look like. **If you ever pick Option 2, we copy this file and change
`play_file()` to `write_to_printer()`.** That is close to the whole job.

But the printer does not need it, and adding a job to the announcer queue would
mean a speaker and a printer sharing one lane. Two jobs, two lanes.

---

# PART 4 — YOUR BABY-STEP SETUP WALKTHROUGH (Option 1)

Assuming you go with the TSP143IVUE. **You will not touch a terminal once.**

### Before you start
- The printer, its power cable, and the Ethernet cable in the box.
- A spare port on your shop router or switch.
- A laptop on the same shop Wi-Fi.
- About 20 minutes.

### Step 1 — Buy it
Star **TSP143IVUE**, part **39473010** (gray) or **39473110** (white).
About **$316** (Barcode Factory, measured today; shop around, MSRP is $384).
Do **not** buy the WLAN module — you do not need it, and a cable is more
reliable than Wi-Fi for a device that must never miss a ticket.

### Step 2 — Physically install it
1. Put it where the online-order tickets should come out — **not** at the
   register. Somewhere the person making up orders can reach.
2. Power cable into the printer, then into the wall.
3. Ethernet cable from the printer into your router or switch.
4. Drop the paper roll in and close the lid. Print side faces the head; if a
   blank slip comes out, the roll is in backwards — flip it.
5. Turn it on. Wait for a steady Ready light.

### Step 3 — Find out its address
Hold the **FEED** button while switching the printer on. It prints a self-test
slip with its **IP address** and MAC. Keep that slip.

### Step 4 — Get your token from the back office
1. On your laptop, open **Admin → Equipment**.
2. Find the receipt printer section.
3. Press **Generate token**. Copy the token exactly.
4. Set **Paper columns** to **48** (80mm paper).
5. Turn **Auto-print online orders** ON.
6. Save.

### Step 5 — Point the printer at your website
1. In a browser, go to `http://<the-IP-from-step-3>/`.
2. Find the **CloudPRNT** settings page.
3. **Server URL:** `https://your-site.com/api/cloudprnt`
4. **Polling interval:** `5` seconds.
5. **Password / token:** paste the token from step 4.
6. Save and let it restart.

### Step 6 — Prove it works
1. Back to **Admin → Orders**.
2. Within about 10 seconds the printer chip at the top should go **green**.
3. Press **Test print**. A slip comes out.
4. **If a slip comes out, you are done.** Place a real test order and watch the
   ticket print by itself.

### Step 7 — Write the card
Tape an index card to the wall behind the printer:
- Printer IP: `________`
- Server URL: `https://your-site.com/api/cloudprnt`
- Token lives in: Admin → Equipment
- Green chip on the Orders page = healthy

Your announcer already has a wall card (`docs/announcer/30-wall-card.md`). Same
idea, same reason: the fix should be readable by whoever is standing there.

---

# PART 5 — WHEN IT BREAKS: THE DECISION TREE

**The chip on the Orders page is grey — "not set up".**
The token was never generated or never saved. Redo steps 4 and 5.

**The chip is red — "offline".**
The printer is not reaching your site. In order:
1. Is the Ready light on? No → power.
2. Is the Ethernet cable in, with a link light at both ends? No → cable.
3. Feed-button self-test: does it still show the same IP? Different → your
   router handed it a new address; re-check the CloudPRNT page loads.
4. Can you open `http://<printer-IP>/` from your laptop? No → it is a network
   problem, not a printer problem.
5. Yes, but still red → the Server URL or token is wrong. Retype both. The
   token is case-sensitive.

**Chip is green but no paper comes out.**
The printer is talking to us and choosing not to print.
1. Out of paper, or the lid is not latched. Latch it hard until it clicks.
2. Paper roll in backwards — a blank slip is the tell.
3. Press **Test print**. If the test prints but real orders do not, then
   **Auto-print online orders** is switched off in Admin → Equipment.

**Tickets print twice.**
The printer confirmed with a GET instead of a DELETE. The route already handles
both. If it persists, tell me — it is a firmware quirk worth pinning down.

**Everything is fine but nobody hears the order.**
That is the announcer, not the printer. `docs/announcer/10-field-manual.md`,
Part 2, has the decision tree.

**The golden rule, which is already true in the code:**
*A printer can never fail a sale or an order.* `queueOrderReceipt` is
best-effort, exactly like the announcer. If the printer is on fire, orders still
come through. Paper is a courtesy; the record is the truth.

---

# PART 6 — WHAT I RECOMMEND, IN ORDER

1. **Confirm two facts for me** — was a TSP143IV ever bought, and has migration
   `0047` been applied? I will not guess at either.
2. **Fix Defect A** (auto-receive ambiguous name match) as the next code slice.
   It writes, it is reachable on your real catalogue, and it is a small change
   with an obvious test. This is the only thing on this page that can quietly
   cost you money.
3. **Buy the TSP143IVUE** (~$316, part 39473010) and follow Part 4. Kill the
   Eatabit subscription once a real order has printed by itself.
4. **Defects B and C** whenever we are next in those files. Low value, low risk,
   no rush.
5. **Leave the announcer alone.** It is the best thing in the repo.

---

## Appendix — how to reproduce every number here

```
python3 -u scripts/recon/receiving-sweep-measure.py   # 105 vendors, 4 normalizers
python3 -u scripts/recon/receiving-sweep-part2.py     # defects 1-3, blast radius
python3 -u scripts/recon/receiving-sweep-part3.py     # 1,707 strains, merge risk
```

Sources for the hardware findings, so you can check me:

- Star TSP100IIIBI manual, *Set External Devices → USB Port* —
  "Communication with the printer via a USB port (1.0A) is not possible."
  <https://www.star-m.jp/products/s_print/tsp100iiibi/manual/en/installing/installingExternalDevices.htm>
- Star TSP100IIIBI manual, FAQ → *USB peripheral does not work* —
  "The USB port on the back of the printer only supports power supply."
  <https://star-m.jp/products/s_print/tsp100iiibi/manual/en/troubleshooting/faq.htm>
- Star TSP100IIIBI manual, *Auto Connection Function* — recommends OFF for
  multiple hosts.
  <https://www.star-m.jp/products/s_print/tsp100iiibi/manual/en/settings/autoConnection.htm>
- Star CloudPRNT Protocol Guide v2.5.2, *Client Settings* — TSP100IV default
  poll 5s; Server URL is user-configured.
  <https://star-m.jp/products/s_print/sdk/StarCloudPRNT/manual/en/client.html>
- TSP143IVUE part 39473010, $316.55, MSRP $384.00, LAN + USB-C, CloudPRNT.
  <https://www.barcodefactory.com/star-micronics/pos-printers/tsp143iv/39473010>

Your printer's identity is from your own repo:
`docs/MICHAEL-slice10-receipt-printer-and-app-store.md:57` —
`PRN-COUNTER-01 | TSP143IIIBi, Bluetooth, serial 2550923021300119`.
