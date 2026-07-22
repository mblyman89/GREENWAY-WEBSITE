# Greenway POS — Operations Guide

*POS Slice B18 (Task AD). Handoff-ready reference for owners, managers, and
budtenders. Every statement in this guide was verified against the code that
ships it — file references are included so a future maintainer can follow the
paper trail.*

**The store:** Greenway Marijuana, Port Orchard — WA I-502 retailer, LCB
license 413541, medically endorsed, **cash only**. The register is an iPad
web app at `/pos` backed by the same Supabase back office as the website;
receipts print on a Star TSP100IIIBi Bluetooth printer through the free Star
PassPRNT iOS app, which also kicks the cash drawer.

---

## 1. One-time setup

### 1.1 Provision the iPad (manager, back office)

1. Back office → **Register Activity → POS devices** (`/admin/registers/devices`).
2. Create a device: name it (e.g. "Front counter iPad") and **bind it to a
   register**. The device key is shown **once** — copy it before closing.
3. On the iPad, open `/pos`. The setup screen asks for the device id + key,
   verifies them against the server with an empty sync, and stores them only
   on that device (`src/app/pos/RegisterShell.tsx`, SetupScreen).

PINs identify **people**; the device key identifies the **iPad**. Every
register action requires both — a stolen PIN is useless without a
provisioned device, and vice versa.

### 1.2 Employees and PINs

Employees live at **Staffing → Employees**. Each active employee gets a 4–6
digit clock PIN (stored salted-scrypt; legacy plaintext PINs upgrade
themselves on first use — `getEmployeeByPin` in `src/lib/staffing/store.ts`).
`job_role` matters at the register: only **manager** or **lead** can approve
a no-sale drawer open (`/api/pos/approve`).

### 1.3 Printer

Install **Star PassPRNT** from the App Store on the register iPad and pair
the TSP100IIIBi over Bluetooth in iOS Settings. The register prints by
opening a `starpassprnt://v1/print/nopreview` URL at `size=3` (576 dots /
72 mm — the printer's full width) with `drawer=after&drawerpulse=200`, so
the drawer pops **after** the paper prints (`buildPassPrntUrl` in
`src/lib/pos/receipt-core.ts`, parameters verified from the PassPRNT
manual). If PassPRNT is missing, every print screen offers **Browser
print** — the identical HTML in a print window, so paper never differs
between the two paths.

### 1.4 Receipt design (owner)

**Register Activity → Receipt design** (`/admin/registers/receipt`) is the
customization studio: header text, address/contact lines (street, phone,
license number…), footer text, and toggles for **Served by**, the **You
saved** row, and the **loyalty block**. The live preview is rendered by the
*same* pure builder the register uses, in a sandboxed iframe — what you see
is byte-for-byte what prints. Settings ride to the iPad inside the menu
bundle; a register that hasn't refreshed its menu prints the previous
design until it does.

---

## 2. Daily operations

### 2.1 Opening

1. **Open a drawer** — back office → Register Activity → cash controls:
   count the opening float in by denomination. The register's home screen
   shows "No open drawer" and disables **Start sale** until this happens.
2. On the iPad: **clock in** from the lock screen (PIN → "Clock in / out
   instead") or the home screen button. Punches queue offline like
   everything else.
3. Tap **Refresh menu** once while online. Sales work offline afterwards
   from the cached bundle.

**Sales hours:** the register and the server both enforce the sales window
(WAC 314-55-147; statutory bounds 8:00 AM–midnight Pacific, owner-narrowable
in settings — `src/lib/compliance/sales-hours-core.ts`). Outside the window
the sale flow refuses to start, and the server's completion gate re-checks
with its own clock at sync.

### 2.2 Ringing a sale

The flow is a guided rail: **ID gate → cart → cash tender → done**
(`src/app/pos/SaleFlow.tsx`). Nothing enters the cart before the ID gate
passes.

- **ID gate.** Scan the license barcode (PDF417) or use the manual path,
  which requires a typed birthdate + attestation and enqueues its own audit
  event. Under-21 is refused with no override.
- **Medical path.** For a carded patient, capture the recognition card
  (UPID, effective/expiry dates, holder type) and attest to the MCR check.
  The card — not a toggle — is what makes the sale medical: it switches
  pricing to tax-exempt (DOH), raises the possession limits to the medical
  profile, and unlocks High-THC products (chapter 246-70 WAC; non-carded
  buyers are hard-blocked from those, no override).
- **Cart.** Tap products to add; promotions price through the same engine
  as the website. The live limit meter enforces WAC 314-55-095
  single-transaction limits per bucket.
- **Loyalty member.** Search by name/phone/email in the cart's member panel
  (online only — the customer book is never cached on an iPad). Attaching a
  member is what makes a future **return** possible, and earns points
  automatically at server completion (idempotent per order, auto-enrolls).
- **Tender.** Cash only. Quick-amount chips or exact entry; change is
  computed and shown huge. The receipt is frozen at the exact moment the
  sale is enqueued, so paper always matches the payload.
- **Print.** "Print receipt" goes through PassPRNT and pops the drawer.
  Tapping again reprints (the snapshot is immutable).

**The register locks after every sale** (owner rule) and after 2 minutes
idle, so every sale is PIN-attributed to whoever actually rang it.

### 2.3 Hold / resume (B17)

Customer forgot their wallet? **Hold** (next to Cash tender) parks the cart
and frees the register. One hold at a time. The snapshot is minimal —
variant ids + counts, never prices — and resume rebuilds it against the
**current** menu, so prices are always fresh and anything that went out of
stock is dropped and named in a banner. **The ID check always re-runs on
resume**; a held cart never inherits the previous customer's age
verification, medical card, or member. Completing the resumed sale consumes
the hold; cancelling leaves it parked; Discard clears it.

### 2.4 Reprint last receipt (B17)

The home screen's **Reprint last receipt** card survives the post-sale
auto-lock (and app restarts): the frozen snapshot persists on the device and
is validated on load — a corrupted blob yields nothing rather than a garbage
print. Reprints **never** open the drawer.

### 2.5 No sale — opening the drawer without a sale (B17)

Two ways in, same audited flow: the **💵 Open drawer** button in the home
screen's Cash drawer panel (next to Cash drop / Close), or MORE ▾ →
**No sale — open drawer**. When the button is unavailable the register says
why right next to it (no drawer counted in, or offline — the manager PIN is
verified server-side). Two humans go on the hook:

1. The session owner picks a reason (presets: change for a large bill,
   change-fund swap, stuck bill, drawer count check) or types one
   (3–500 characters).
2. A **manager or lead** approves with *their* PIN — verified server-side
   with the same scrypt + throttle as the lock screen (`/api/pos/approve`).
   Online only: an unverifiable approval would be theater.
3. A **NO SALE audit slip** prints (reason, "Opened by", "Approved by"),
   and the drawer kick fires *after* the print — the drawer physically
   cannot open without the paper record.

The event syncs as `no_sale`, is validated (`validateNoSalePayload`) and
audited (`register.no_sale`) with both employee ids. The approver's PIN
never rides in any payload.

### 2.6 Closing

1. Clock out on the iPad.
2. Back office cash controls: **drop** excess to the safe during the day;
   **blind-close** the drawer at night (counter enters the count without
   seeing the expected number), then a manager **reconciles** the closed
   drawer and **verifies** the till. History lives under Register Activity →
   Cash drawer reports.

---

## 3. Returns desk (B15/B16)

**Back office → Register Activity → Returns desk**
(`/admin/registers/returns`, requires `inventory.manage`). Store policy,
deliberately stricter than the WAC minimum:

- The buyer must have been a **loyalty member on the original sale** (that
  is how we look the sale up and how we claw points back).
- They must present the **original receipt** — the 8-character receipt
  number is the lookup key.
- **15 days** from the purchase date (Pacific calendar days; purchase day
  is day 0).

The flow (`CounterReturnDesk`): type the receipt number → the desk finds the
sale and shows every policy verdict at once (completed, member attached,
inside the window, with days remaining) → pick the line and quantity
(previous partial returns reduce what's returnable) → the refund is computed
from the **stored final tax-inclusive paid price** — staff never type an
amount, and medical tax exemption carries through automatically → attest to
WAC 314-55-079(12) (original packaging, fully legible lot/batch ID), choose
**restock** or **destroy**, pick a reason (defective, wrong item, adverse
reaction, quality, mislabeled, other) → submit.

The server re-verifies everything (screen verdicts are advisory), then runs
the same machinery as the inventory return wizard: CCRS Sale-row snapshot,
a **Sale Delete/Update correction** queued for CCRS, a **positive inventory
add-back**, and a destruction event when the product isn't restockable.
Loyalty points are clawed back proportionally (floored, clamped to what the
order actually earned, cumulative-safe across repeated partial returns). A
**refund receipt** prints from the result panel: REFUND banner, the original
receipt number, exact cash to hand back, and the points adjustment.

**Regulatory note (verified):** WAC 314-55-079(12) allows returns of open
cannabis products for **all** product types — not just vape products — but
only in the original packaging with a fully legible lot/batch identifier.
The CCRS FAQ requires a valid customer return to be reported as a Sale
identifier **Deleted** (or **Updated** for a partial) plus the inventory
identifier on a **positive InventoryAdjustment** with details — exactly what
the desk queues. The 15-day window and the loyalty-member requirement are
**store policy** layered on top; policy may be stricter than rule, never
looser.

---

## 4. Loyalty program

Configured at **Admin → Loyalty**: points per pre-tax dollar, signup bonus,
tiers. Mechanics that matter at the counter:

- Points accrue **server-side at order completion** (never on-device),
  idempotently per order, auto-enrolling the customer on first earn. The
  receipt's "points earned" line is a device estimate; the ledger is
  authoritative.
- The register's member panel is online-only by design (privacy: no
  customer book on iPads) and shows a lean label — first name, last
  initial, points, tier.
- Returns claw back points via a negative ledger adjustment tied to the
  order (§3).

---

## 5. Offline behavior & the exception queue

Every register fact — sales, punches, ID audits, card captures, no-sales —
is enqueued locally with a client UUID and a per-device monotonic sequence,
then flushed to `/api/pos/sync` every 15 seconds while online (and
immediately on reconnect). Durable ACKs clear queue rows; **duplicates are
idempotent** (a retried sale can never double-charge or double-count).

The server re-runs the **entire compliance gate** on every synced sale — an
offline sale that fails there (limits, hours, pricing, a member that no
longer exists, a medical/loyalty mismatch) never silently completes; it
lands in **Register Activity → Exceptions** (`/admin/registers/exceptions`)
for a manager to resolve. Rows the server outright rejects stay on the
device flagged with the reason, surfaced in a banner.

Offline limits to know: member lookup and the no-sale manager approval need
a connection (PIN checks can't be verified offline); first-time device
setup and menu refresh need one too. Everything else — the whole sale flow
included — works offline from the cached menu bundle.

---

## 6. Troubleshooting

| Symptom | Cause & fix |
| --- | --- |
| "Device credentials rejected — see a manager." | The device was revoked or re-keyed. Re-provision from Register Activity → POS devices. |
| PIN pad says try later | Brute-force throttle: 5 failed PINs across the store within 60 s locks PIN entry briefly (shared by unlock, clock, and approvals). Wait a minute. |
| **Start sale** disabled | Home screen tooltip names the blocker: no open drawer, not clocked in, or menu never downloaded (connect once and Refresh menu). |
| Sale refused before the cart | Outside the sales-hours window — the register won't start a sale the server would reject at sync. |
| "Print receipt" does nothing | PassPRNT not installed or the printer isn't paired. Use **Browser print** (identical paper) and fix pairing in iOS Settings. |
| Browser print pop-up blocked | Allow pop-ups for the site in iPad Safari settings; the screen shows this hint. |
| Member search fails | Offline — ring the sale without the member (points can't be attached retroactively at the register) or reconnect first. |
| "N corrupted queue row(s) were dropped" banner at boot | Local storage was damaged; recoverable rows were kept. Check recent activity in the back office against the drawer. |
| "N event(s) were rejected by the server" | The rows are kept on-device with the reason. Read the banner, fix the cause, and see Exceptions in the back office. |
| Return lookup can't find a receipt | Wrong number (8 characters, letters/digits from the receipt), the sale is older than the lookup window, it synced as an exception, or no loyalty member was attached — the desk explains which gate failed. |
| Held sale vanished after Resume | Everything in it became unsellable; the hold self-clears with a banner. |
| Register locked mid-conversation | 2-minute idle auto-lock. Any employee PIN resumes; the hold and last receipt survive the lock. |

---

## 7. Compliance map (what enforces what)

| Rule | Where it lives |
| --- | --- |
| Age 21+ / ID check (WAC 314-55-079) | ID gate on-device; manual path audited; server re-check at sync |
| Single-transaction limits (WAC 314-55-095) | Live cart meter on-device + server completion gate |
| Sales hours (WAC 314-55-147) | Device check at sale start + server clock at sync |
| Medical tax exemption / High-THC (RCW 69.50.375, ch. 246-70 WAC) | Card capture + MCR attestation; pricing + hard product locks |
| Returns (WAC 314-55-079(12)) | Returns desk attestations; all products, original packaging, legible lot ID |
| CCRS reporting (Sale Delete/Update + positive InventoryAdjustment) | Task Q correction queue, fed automatically by the returns desk |
| Drawer accountability | PIN-owned sessions, post-sale auto-lock, audited no-sale with manager approval, blind close + reconcile |

*Companion docs: `docs/ROADMAP_BACKOFFICE_FIXES.md` (shipped-note history for
every POS slice), `docs/CCRS_SELF_REPORTING_GUIDE.md`, and the in-app Help
panels on each admin page, which mirror this guide.*
