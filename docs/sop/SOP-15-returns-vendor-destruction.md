# SOP-15 — Returns to Vendor, Customer-Return Disposition and Product Destruction

| | |
|---|---|
| **Version** | 1.5 (Phase 1.5 fix G-42 built: a vendor return reserves its units, the app builds Manifest.CSV, and on-hand comes off only at departure; Phase 1.4 fix G-44 built: a Destroy return is held, never sellable, and saved in one step; Phase 1.3 fix G-28 built: destruction keeps held lots held; owner answers Q-15-1…Q-15-6 applied; Phase 0.2 fix G-51 + G-47 built; draft for owner review) |
| **Effective** | On owner approval |
| **Owner** | Michael Lyman |
| **Applies to** | **Inventory → Returns & Destruction** (`/admin/inventory/disposition`) and the **Returns desk** (`/admin/registers/returns`): owner, admin and manager (`inventory.manage`). The register's **Return an item** (SOP-01 §4.23): any budtender starts it, a manager or lead approves with a PIN. Destruction day: the person who renders the product unusable **and** a witness. Recalled product: the **admin** (recall coordinator, D37) and the owner. |
| **Verified against** | `main@b8101abb` (2026-10-28). Every label, button, message, number and rule below was read from the code, quoted from `docs/RETURNS_DESTRUCTION_COMPLIANCE.md`, or quoted from the owner. Nothing was written from memory. Where the code and a help panel, comment or explainer disagree, this SOP follows the code and records a finding. Where the code cannot do something the law or the owner needs, this SOP says so plainly and gives the safe interim. |
| **Program records** | Findings `F-15-*` in `docs/sop-program/03-FINDINGS-LEDGER.md` · Gaps `G-42`…`G-51` (and the earlier G-22, G-23, G-25, G-28) in `docs/sop-program/05-GAP-REGISTER.md` · Owner decisions D37 (recall coordinator), D39 (destruction belongs here), D41 (living SOPs), D42 (concierge covers every feature), **D62 (this SOP)**, **D63–D68 (owner answers, v1.1)** in `docs/sop-program/00-OWNER-REQUEST-VERBATIM.md` · Compliance basis `docs/RETURNS_DESTRUCTION_COMPLIANCE.md` · Scope in `docs/sop-program/02-SOP-CATALOG-AND-ROADMAP.md` (SOP-15) |

> **This SOP is a living document (owner decision D41).** The owner said: *"We will eventually build and fix everything, so leave a reminder that I want to update the sop when necessary."* When any gap named here (Appendix B) is built, this SOP is updated in the same piece of work: the sections the gap names, Appendix B, Appendix D (a new revision row), the finding marked FIXED, and the concierge entry (charter §3 rules 9–10). Until then, the interim procedures in this SOP are the rule.

> **Why this SOP is strict although we rarely use it (D62).** The owner: *"We will rarely use these features, but they are necessary for our industry so we must have them and do them properly and accurately."* A vendor return, a destruction or a recall may happen a few times a year. Nobody will remember the steps, so this SOP is written to be followed line by line, with a paper form for every event (§8).

> **How to use this document.** Part 1 (§4.1–§4.3) explains the screens and what each action does to the shelf, to CCRS and to the money. Part 2 (§4.4–§4.8) is **customer returns** after the sale: which screen to use, restock or destroy, and the CCRS Sale correction. Part 3 (§4.9–§4.13) is **returning product to a vendor** with a CCRS manifest. Part 4 (§4.14–§4.22) is **destruction**: scheduling, the hold, rendering unusable, the waste record, cancelling, and recalled or held lots. Part 5 (§4.23–§4.27) covers theft and loss, money and taxes, the AI advisor, the sample-pricing panel and the hold setting. Section 5 lists every message. Section 8 holds the paper forms. Section 9 has three one-page cards. Words in **bold** are the exact labels you will see on the screen.

> **v1.1 owner answers (D63–D68).** Vendor returns follow the state's CCRS manifest method (D63). **Anyone** may witness a destruction, and every destruction is done **on camera** (D64). A recall is handled as a **transfer back to the vendor** (D65). The back-office **Customer return wizard is to be removed** and is not used (D66). The destruction hold is set to the **legal minimum, 0 hours** (D67). **Samples are never sold or put on the menu**; the app does not yet stop it, so §4.26 has an interim check (D68; F-15-20, **S1**).

> **The one thing to know before anything else.** Three things on this screen do **not** work the way their labels suggest, and each has an interim rule in this SOP:
> 1. **A vendor return now follows the state's steps (since Phase 1.5, G-42).** **Log return (reserves the units)** holds the units on the lot: out of sale, still on hand and in CCRS (`disposition.ts` L976–1043, migration 0309 `reserve_vendor_return`). The app builds **Manifest.CSV** with Greenway as the origin; the owner uploads it and records the LCB's success email. On-hand comes off, and the CCRS **Other** adjustment posts, only when **Record departure** is pressed (`depart_vendor_return`, `disposition.ts` L1170). Steps go in order and the server refuses a skip (F-15-1, F-15-2, F-15-3 and F-15-19 FIXED). **Until the owner applies migration 0309** the app refuses to log a vendor return and says so; follow §4.11 on paper.
> 2. **A customer return marked "Destroy" is held by the app (since Phase 1.4, G-44).** The unit is added back to the lot as **Held for destruction**: it counts on hand and in CCRS, but the register, the website and the menu never sell it (`held-stock-core.ts` L43; `sale-lot-read.ts` L65–71; `sale-decrement.ts` L194). The return, the add-back and the destruction event are saved in one database step, or not at all (migration 0308, `disposition.ts` L779). The unit still goes straight into the **sealed destroy bin** (§4.7; F-15-6 and F-15-7 FIXED). **Until the owner applies migration 0308** the app says so and the bin is the only control.
> 3. **Recalled product is never destroyed by us; it goes back to the vendor (D65).** When the state has the vendor ask for it back, the admin tells the LCB officer and Greenway starts a vendor return with reason **Recall** (§4.21). Since Phase 1.3 (G-28) the app refuses it: a Recalled lot is not in the destruction list, the **Recall** reason is gone from **Schedule a destruction**, and **Complete destruction** is refused while the lot is Recalled (F-05a-18 FIXED).

---

## Table of contents

1. Purpose & scope
2. Roles & permissions
3. Before you start
4. Procedures

   **Part 1: The screens and what each action does**
   - 4.1 Where returns and destructions live
   - 4.2 What each action does to the shelf, CCRS and the money
   - 4.3 Lot statuses, the hold and quarantine

   **Part 2: Customer returns (after the sale)**
   - 4.4 Which screen to use
   - 4.5 The register and the Returns desk (the normal path)
   - 4.6 The back-office Customer return wizard (do not use; to be removed, D66)
   - 4.7 Restock or Destroy: the sealed destroy bin
   - 4.8 The CCRS Sale correction: CSV download or the weekly file

   **Part 3: Returning product to a vendor**
   - 4.9 Before anything moves: the processor's RMA
   - 4.10 The CCRS transport manifest (Greenway files it as the origin)
   - 4.11 Logging the vendor return in the app (reserves the units)
   - 4.12 The steps: upload, LCB email, departure
   - 4.13 Pickup and the vendor-return packet

   **Part 4: Destruction**
   - 4.14 When product is destroyed (reasons)
   - 4.15 Scheduling a destruction
   - 4.16 The hold and the quarantine
   - 4.17 Rendering the product unusable (WAC 314-55-097)
   - 4.18 Completing the destruction record
   - 4.19 Cancelling a scheduled destruction
   - 4.20 Destroying part of a lot
   - 4.21 Recalled product: a transfer back to the vendor (D65)
   - 4.22 Lots already in Quarantine

   **Part 5: Related matters**
   - 4.23 Theft, loss and seizure (pointers)
   - 4.24 Money, excise and the books
   - 4.25 The AI advisor
   - 4.26 Samples: never on the menu or at the register
   - 4.27 The destruction hold policy setting

5. Messages: "If you see this message"
6. Exceptions & escalation
7. Controls & compliance (why the rules exist)
8. Checklists & forms
9. Quick reference cards
10. Glossary

Appendix A: Source map · Appendix B: Not built yet · Appendix C: Open questions · Appendix D: Revision history

---

## 1. Purpose & scope

**Purpose.** This SOP covers everything that takes cannabis out of saleable stock other than a sale: product a customer brings back, product sent back to the processor that made it, and product destroyed on our premises. Each of these is a reportable event to the state's traceability system (CCRS), each has a record the LCB can ask to see for five years (WAC 314-55-087), and two of them (destruction and recalls) carry rules where a mistake is a violation. The catalog entry records what the owner asked for: *"transferring product back to the vendor, sop for destroying products."*

**In scope.**
- The **Returns & Destruction** page: every section, button and setting on it.
- The **Returns desk** (`/admin/registers/returns`) and how it shares the same return machinery.
- What happens after a customer return: **Restock** or **Destroy**, and the CCRS **Sale correction**.
- Vendor returns with a CCRS transport manifest.
- Destruction: scheduling, the store's hold, quarantine, rendering unusable, the waste record, cancelling, partial destruction.
- Recalled and quarantined lots, at the level needed here (the recall itself is SOP-05a §4.10 and §4.13).
- The money, excise and books effects of returns.
- The AI advisor on this page, and how the app keeps samples off the menu (§4.26).

**Out of scope (pointers).**
- Ringing up the return at the register, the store's return policy and the cash refund: **SOP-01 §4.23**.
- Placing and releasing a recall hold, the recall plan: **SOP-05a §4.10, §4.13**, forms 8.4–8.5.
- Manual adjustments on the lot page, and why **Destroyed** must never be set by hand: **SOP-05a §4.6–§4.9**.
- Theft, robbery and other incidents: **SOP-20**.
- The weekly CCRS upload itself: **SOP-16 CCRS Uploads** (deferred by the owner, D69).
- Giving trade samples to employees (`/admin/compliance/samples`, the Employee Samples hub): a separate screen. This SOP covers only keeping samples off the menu and register (§4.26).

## 2. Roles & permissions

| Action | Who the app allows | Where the rule lives |
|---|---|---|
| See **Returns & Destruction** in the Inventory menu, open the page, log a customer return in the wizard, log a vendor return, update a manifest, schedule, complete or cancel a destruction, download the Sale correction CSV, ask the advisor | **Owner, admin, manager** (`inventory.manage`) | `roles.ts` L106; nav `admin-nav-data.ts` L90; page gate `disposition/page.tsx` L97; every action in `disposition/actions.ts` (L68, L117, L147, L173, L197, L246, L316); CSV route `sale-correction-export/route.ts` L46 |
| Change the **Destruction hold policy** and the (legacy) **Sample-pricing rules** | **Owner, admin** (`settings.manage`) | `disposition/page.tsx` L98, L531; `actions.ts` L263–266, L283–286 |
| Open the **Returns desk** and process a counter return there | Owner, admin, manager (`inventory.manage`) | `registers/returns/page.tsx` L27; actions L35, L51 |
| Start **Return an item** at the register | Any signed-in budtender (`orders.manage` includes staff, `roles.ts` L90) | SOP-01 §4.23 |
| Approve a register return (PIN) | **Manager or lead** | `/api/pos/returns/route.ts` L49 (`APPROVER_ROLES`) |
| Read-only, content-editor and budtender logins | Cannot open Returns & Destruction or the Returns desk | `roles.ts` L106 (not listed) |

A login without the permission is sent back to the back-office home with a "denied" notice.

**Store rules on top of the app.**
1. **Customer returns go through the register or the Returns desk only** (§4.4). The back-office **Customer return** wizard is **not used**: the owner decided to remove it (D66: *"Q4- remove it."*; G-45 **APPROVED**).
2. **A manager may schedule a destruction. Completing one needs two people**: the person who grinds and mixes, and a **witness, who may be anyone** on staff (D64: *"anyone may witness the destruction."*), never the person doing it. The destruction is done **in view of a security camera** (D64: *"It has to be done on camera as well."*; WAC 314-55-083(3)(a)). Both names go in **Witnessed by** and on form 8.3 with the camera and time. The app does not require a witness or a camera reference (F-15-4, F-15-21); this SOP does.
3. **Only the owner cancels a scheduled destruction** (§4.19). Since Phase 1.3 the app enforces it (`inventory.destruction.cancel`, owner only, `roles.ts` L161), asks a written reason, and puts the lot back to the status it had before scheduling (F-05a-19, F-15-9 FIXED).
4. **Recalled product is handled by the admin, the recall coordinator (D37), with the owner, and goes back to the vendor as a vendor return (D65).** Nobody schedules a destruction for a recalled lot (§4.21).
5. **A vendor return is logged when the RMA is in hand; the product leaves only with the LCB's manifest PDF**, and **Record departure** is pressed at that moment (§4.11–§4.12, D63). **Only the owner cancels a vendor return** (`inventory.vendor_return.cancel`, `roles.ts` L166).
6. **The owner alone approves anything in the books** (books-23: *"Anything accounting, bookkeeping, taxes, finance, should be hard gated to me only."*). Refunds and write-offs are reviewed by the owner monthly (form 8.6).

## 3. Before you start

**Everyone who handles a return or destruction:**
- Know where the **sealed destroy bin** is (in the vault, labelled "DESTROY — NOT FOR SALE", lid taped and initialled), and where the **vendor-return tote** is (same, labelled "VENDOR RETURN — HOLD").
- Have printed copies of forms 8.1 (destroy-bin log), 8.2 (vendor-return packet), 8.3 (destruction waste record), 8.4 (recall destruction coordination) and 8.5 (cancel and status-restore log).

**Before a vendor return:** the processor's name, license number and contact; their written acceptance (RMA); the owner or admin CCRS login (Greenway uploads the manifest as the origin); the store's contact phone and email in license settings and the processor's phone and email in Vendors & Brands (the app's **Download Manifest.CSV** needs them); who will drive (our employee 21+, the processor's driver, or a transport licensee) with the vehicle's plate, VIN, make, model and colour; the agreed departure and arrival times. The LCB sets no minimum lead time (D63); allow enough time to fix a rejected upload.

**Before a destruction:** the grinder or other tool, the mixing material (compostable: food waste, yard waste, vegetable grease; non-compostable: paper, cardboard, plastic), enough of it to make the result at least half non-cannabis by volume, a container, and a second person to witness. Know the final destination (for example the dumpster serviced by the hauler, or a compost facility) and the hauler's or facility's name.

**Before any recall step:** read SOP-05a §4.10 and §4.13 and have the recall event worksheet (SOP-05a form 8.5).

## 4. Procedures

# Part 1: The screens and what each action does

### 4.1 Where returns and destructions live

| Screen | Where | What it is for |
|---|---|---|
| **Returns & Destruction** | Inventory menu → **Returns & Destruction** (`/admin/inventory/disposition`) | The command center: stat cards, the Sale correction banner, the **Customer return** wizard, **Log a vendor return**, **Schedule a destruction**, **Destruction events**, **Vendor returns & manifests**, **Recent customer returns**, the AI advisor, **Destruction hold policy**, **Sample-pricing rules** |
| **Returns desk** | Register Activity → **Returns desk** (`/admin/registers/returns`; button on `registers/page.tsx` L84–86) | Receipt-first counter returns in the back office, with the store policy checks and the refund worked out for you |
| **Return an item** | Register → **MORE ▾ → Return an item** | The same receipt-first return on the register, approved by a manager or lead PIN (SOP-01 §4.23) |

**The top of the Returns & Destruction page** shows five stat cards (`disposition/page.tsx` L136–146): **Customer returns (30d)**, **Vendor returns (30d)**, **CCRS corrections pending**, **Destructions pending**, **Destroyed (30d)**. When corrections are pending, a gold banner appears with **Download Sale correction CSV** (L151–166; §4.8). Below it, the help panel **How disposition works (the compliant way)** gives five steps (L168–178). Two of them need a note:
- The step *"Everything posts to the CCRS InventoryAdjustment.csv on the Compliance tab"* is true for the inventory adjustments. The customer-return **Sale** correction is a separate file (§4.8).
- The step *"the completion form enforces this"* (for recalls) is true for the tick box and the officer's name, but not for the contact date (§4.18) and not for the recall hold, which scheduling removes (§4.21).

### 4.2 What each action does to the shelf, CCRS and the money

| Action | On hand | Lot status | CCRS | Money | Audit row |
|---|---|---|---|---|---|
| Customer return, **Restock** | **+qty** on the lot (`disposition.ts` L710); the online menu stock goes up too (L330) | Unchanged | Inventory adjustment **Other** (internal reason `return`, `ccrs-inventory-adjustment-core.ts` L62–90) with a note *"Customer return — ADD … back to inventory (WAC 314-55-079(12))"* (`disposition-core.ts` L167); a **Sale correction** (Delete for the whole line, Update for part) queued as **pending** | Refund recorded on the return (`refund_minor_units`); counted in the day's refunds (`refunds-store.ts` L11, L48) | `customer_return.create` (wizard, `actions.ts` L105) or `customer_return.counter` (Returns desk, `registers/returns/actions.ts` L78) |
| Customer return, **Destroy** | **+qty** on the lot, and the same units are **held** (`held_qty`, migration 0308): on hand but never sellable; the menu stock is **not** raised. Saved with the return and the destruction event in one step (`record_customer_return`, `disposition.ts` L779) | **Unchanged (stays Active)**; only the held units are out of sale | As above, plus a destruction event is opened (reason **Other**, detail *"Customer return (…) — sale …"*) that carries the held units | As above | As above, with `held` (true once 0308 is applied) |
| **Log a vendor return** | None; the units are **reserved** (`held_qty`, migration 0309): on hand but out of sale; the menu stock goes down (`disposition.ts` L976–1043) | Unchanged (a Recalled lot stays Recalled) | Nothing yet | None in the app (any credit from the processor is outside the app) | `vendor_return.create` (`actions.ts` L162) |
| **Save step** (upload, LCB email) | None | None | None | None | `vendor_return.manifest` (`actions.ts` L240) |
| **Record departure** | **−reserved qty** and the reserve released, in one step (`depart_vendor_return`, `disposition.ts` L1170) | Unchanged | Inventory adjustment **Other**, note *"Vendor return to (processor) license …, manifest …, RMA …, reason …: detail"* (`vendor-return-core.ts` L208) | None | `vendor_return.depart` (`actions.ts` L240) |
| **Cancel return** (owner) | None; the reserve is released and the menu stock goes back up (`release_vendor_return`, `disposition.ts` L1215) | Unchanged | Nothing | None | `vendor_return.cancel` (`actions.ts` L290) |
| **Schedule** a destruction | None yet | **Active** → **Quarantine**; a lot already in **Quarantine** stays; **Recalled**, Sold out and Destroyed lots are refused (`disposition.ts` L975, rules `destruction-lot-status-core.ts` L85). The status before is kept on the event | None yet | None | `destruction.schedule` |
| **Complete destruction** | **−qty** in one safe step that refuses to go below zero (L1050; L233–282). A customer-return event removes exactly its held units (`postHeldReduction` L281, `consume_lot_hold`); any other reduction (vendor return, ordinary destruction, manual adjustment) can never take held units (`evaluateReductionAgainstHold`, `held-stock-core.ts` L68) | **Destroyed** only if the lot is now at zero (L1087–1095); otherwise it **stays Quarantine** | Inventory adjustment **Destruction** with the method and destination in the note (`disposition-core.ts` L274–298) | Cost written off through the inventory adjustments export (`sage-exports.ts` L644–698: debit cost of goods, credit inventory) | `destruction.complete` (L228) |
| **Cancel destruction (owner)** | None | Put back to the status before scheduling: **Quarantine → Active** only if it was Active, nothing else holds it and nobody changed it since; otherwise left alone and the page says why. A customer-return event never touches the lot status; it **releases the held units**, which become sellable again, and the page says so (`disposition.ts` L1380–1399) | None | None | `destruction.cancel` with the reason, the lot status before and after, and `held_released`; a refused try writes `destruction.cancel_refused` |

**Records the app keeps** (database, `supabase/migrations/0042_*.sql` and `0115_*.sql`): `customer_returns` (0115 L38), `vendor_returns` (0042 L22–36, manifest columns 0115 L104–109), `destruction_events` (0042 L47–66, waste-record columns 0115 L94–101), `disposition_settings` (hold hours) and `sample_settings`.

### 4.3 Lot statuses, the hold and quarantine

- **Active**: sellable. The register draws only from Active lots with stock, oldest first, and only the units that are not **held** (sellable = on hand − held; `sale-lot-read.ts` L43–71, `held-stock-core.ts` L43).
- **Held for destruction** (since Phase 1.4, G-44; not a status): units of a customer return marked Destroy. They stay on hand and in CCRS, are shown on the lot page (*"Held for destruction"*), and are never sold, never on the menu and never counted as register stock. They leave only by completing their destruction, or the owner cancels it.
- **Quarantine**: not sellable. Scheduling a destruction puts an **Active** lot here (the whole lot), except for a customer-return destruction, which leaves the lot Active and holds only the returned units. A lot already in Quarantine stays there.
- **Recalled**: not sellable; the register's recall hold reads only this status (SOP-05a §4.11).
- **Destroyed**: set only by **Complete destruction** when the lot reaches zero. Never set it by hand (SOP-05a §4.9).

**The hold.** Scheduling stamps an **earliest destroy** time: now plus the store's hold hours (code default **72**, allowed **0–336**; store setting **0**, the legal minimum, D67, `disposition-core.ts` L32–34). **Complete destruction** stays greyed out as **Hold not elapsed** until that time (`page.tsx` L386). The hold is **store policy, not law**: the old 72-hour LCB notice was removed from the rule (WSR 22-14-111; compliance doc §5.1; the page says so at L511–531). It exists to catch mistakes, to arrange a witness, and to give the owner time to stop a destruction.

> **Control: product waiting for destruction or return is never on the sales floor.** A scheduled lot is in Quarantine, and since Phase 1.4 a customer-returned unit marked Destroy is held by the app (G-44 BUILT, once migration 0308 is applied). A vendor return waiting for pickup is still Active until it is logged (F-15-1). The physical bins and forms 8.1–8.2 stay in use; for vendor returns they are the control until G-42 is built.

# Part 2: Customer returns (after the sale)

### 4.4 Which screen to use

| Situation | Use | Why |
|---|---|---|
| Customer at the counter with the receipt, same day or later, within the policy | **Register: MORE ▾ → Return an item** (SOP-01 §4.23) | Checks the policy, works out the refund, needs a manager or lead PIN, prints the refund receipt |
| The register is offline, or the manager is working in the back office | **Returns desk** (`/admin/registers/returns`) | The same checks and refund maths (`returns-store.ts` L252–360) |
| Anything else (no receipt, outside 15 days, no loyalty member, a goodwill exception) | **Stop. Ask the owner.** If the owner approves an exception, the owner or the admin uses the back-office wizard (§4.6) | The wizard has none of the policy checks (F-15-8) |

The store policy is stricter than the state rule (SOP-01 §4.23): loyalty member on the sale, original receipt, within **15 days** (purchase day is day 0, Pacific time), original packaging with a fully legible lot label, cash refund. The Returns desk help panel says the same (*"Store policy: loyalty members only, receipt in hand, within 15 days of purchase — the lookup verifies all three at once."*, `registers/returns/page.tsx` L58).

### 4.5 The register and the Returns desk (the normal path)

The register steps are in SOP-01 §4.23. The Returns desk works the same way:
1. **Returns desk**: type the 8-character receipt number into the box (*"8-character code under the store name, e.g. 14174000"*) and press **Look up**.
2. If the sale fails the policy, every reason is shown (for example *"Outside the 15-day return window — this sale was N days ago (store policy). Refuse the return."*, `returns-core.ts` L153). Refuse the return.
3. Pick the line and the **Quantity** (it shows the maximum). **Refund (auto)** shows *"Exactly what they paid"*: you never type an amount.
4. Pick the **Reason**: Defective product, Wrong item sold, Adverse reaction, Quality complaint, Mislabeled, Other. For **Other**, and for **Adverse reaction**, write a sentence in **Detail** (*"Why it was returned — this goes on the CCRS adjustment record."*). An adverse reaction also starts the product-complaint process with the manager.
5. Inspect the product. Tick both attestations: original packaging, and a fully legible lot / batch ID. If either fails, refuse (*"Both WAC 314-55-079(12) checks are required — original packaging AND a fully legible lot ID. If either fails, refuse the return."*, `CounterReturnDesk.tsx` L108).
6. **What happens to it**: **Restock (sellable)** only if the package is sealed and unharmed and you would sell it to the next customer without a second thought. Otherwise **Destroy (opens hold)**. Opened product is always **Destroy**.
7. Press **Log return & refund**. You see *"Return logged. Refund $X in cash."* Press **Print refund receipt**, count out the cash, and have the customer sign the receipt copy.
8. If you chose **Destroy**, go straight to §4.7.

The app adds the units back to inventory, queues the CCRS Sale correction (§4.8) and takes back the loyalty points in proportion (`returns-store.ts` L276 onward).

### 4.6 The back-office Customer return wizard (do not use; to be removed, D66)

The **Customer return** section on Returns & Destruction (*"Guided intake for a valid customer return — inventory add-back, CCRS Sale correction, and (optionally) a destruction event, all in one step."*, `page.tsx` L182–188) uses the same machinery, but it is **not** the same control (F-15-8):
- It does **not** check the 15-day window or the loyalty member. It checks only that the sale was completed (`disposition.ts` L514) and the attestations.
- **Refund ($)** is typed by hand and starts at **0.00** (`CustomerReturnWizard.tsx` L173–174). The app caps it at what the customer paid (`disposition-core.ts` L139–140), but a typo below that is accepted. The amount is counted in the day's refunds (`refunds-store.ts` L48) even though no register drawer handed it out.
- **What happens to it** starts on **Destroy** (L185–188).
- It has **no lot box**. The app picks the newest lot of that product that is not in Quarantine (`disposition.ts` L610). If none matches, it stops with *"No inventory lot matches this product — pick the lot manually…"* (L617), but there is nowhere to pick it (F-15-8).

**Do not use it.** The owner decided to remove it (D66: *"Q4- remove it."*; G-45 **APPROVED**). Every customer return goes through the register or the Returns desk (§4.5). Until it is removed, the steps below are kept only so that a return someone logged by mistake can be understood and checked; never start a new one:
1. **Step 1**: search by order number, customer name or phone (at least 2 characters). Only completed sales are found.
2. **Step 2 · Pick the exact item being returned.**
3. **Step 3 · Verify, attest, and log the return.** Tick both attestations, enter **Quantity**, enter the **Refund ($)** the owner approved (check it twice), pick the **Reason**, choose **What happens to it**, write the owner's approval in **Detail** (for example "Owner exception 10/28: no receipt, goodwill").
4. Press **Log customer return**. You see *"Customer return logged — inventory adjusted, CCRS Sale correction queued. Download the correction CSV before your next upload."*
5. Pay the refund from the safe or the till as the owner directs, with a form 8.1 line, so the cash and the record agree.
6. Check **Recent customer returns** shows the return, with the badge **Sale Delete pending** or **Sale Update pending**.

### 4.7 Restock or Destroy: the sealed destroy bin

**Restock.** Put the package back on the shelf or in back stock the same day. The unit is sellable at once, in the app and online.

**Destroy.** Since Phase 1.4 (G-44) the app **holds** the returned unit: it counts on hand and in CCRS but is never sold, never on the menu and never counted as register stock. The return, the add-back, the hold and the destruction event are saved in one database step (`record_customer_return`, migration 0308), so either all of them are saved or nothing is. The Returns desk says *"Returned unit: Held for destruction: counted on hand (and in CCRS) but never sellable until the destruction is completed. Put it in the sealed destroy bin now (SOP-15 §4.7)."* (`CounterReturnDesk.tsx` L157–159). The register still says *"Product goes to the quarantine bin."* (SOP-01 §4.23).
1. Put the unit in the **sealed destroy bin** in the vault at once. Never leave it at the counter.
2. Write it on **form 8.1** (date, receipt number, product, lot, quantity, reason, who, witness initials).
3. On **Returns & Destruction → Destruction events**, check that a new row exists for that lot with the detail *"Customer return (…) — sale …"* and status **pending quarantine**. Since Phase 1.4 the return is not saved without it (F-15-7 FIXED). The lot page shows the units under **Held for destruction**.
4. **If there is no row**, tell the owner (it should not happen; the return and the event are saved together).
5. Complete the destruction once the hold ends, with the next destruction day (§4.15–§4.18). Completing it removes exactly the held units. Nothing else can remove them: a vendor return, another destruction or a manual adjustment that would need them is refused with *"… unit(s) are held for a customer-return destruction and cannot be used for anything else."*
6. If the owner cancels the destruction, the units are released and become sellable again. The page says *"N returned unit(s) released from hold; they now count as sellable stock. Put them back on the shelf only if the package is sealed and unharmed; otherwise schedule a new destruction."*

**Before migration 0308 is applied** the app cannot hold the unit. It still saves the return all or nothing (it undoes the add-back if any later step fails) and says *"Migration 0308 is not applied yet, so the app could not hold the returned unit: keep it in the sealed destroy bin (SOP-15 §4.7)."* Until then the unit counts as sellable stock and the **sealed bin is the only control**; tell the owner.

If **Log customer return** or **Log return & refund** shows *"The return was not saved and nothing was changed: …"*, *"Apply migration 0115 first (customer_returns table missing). Nothing was changed (the add-back was undone)."* or *"The return was not saved and the add-back was undone: …"*, nothing was recorded and the stock is unchanged. Keep the unit and the cash aside, and tell the owner before trying again.

### 4.8 The CCRS Sale correction: CSV download or the weekly file

A valid customer return must also correct the **sale** in CCRS: the sale line is **deleted** (whole line returned) or **updated** (part returned), per the LCB's CCRS FAQ (help panel, `page.tsx` L172). The app queues this as **pending** on every return.

There are two ways to send it:
- **The weekly CCRS batch (preferred).** The weekly file reads every pending customer return (`ccrs-batch.ts` L440–470) and records the file it sent. This is SOP-16.
- **Download Sale correction CSV** (gold banner, `page.tsx` L151–166). The download includes up to 500 pending returns (`sale-correction-export/route.ts` L62), skips rows that cannot be built and names them, withholds rows CCRS would reject (L91–93), **marks the included returns as exported**, and writes an audit row `ccrs.sale_correction_export` (L104). Its own header warns: *"Prefer the weekly batch once the ledger is loaded: it checks each line is held by CCRS and records the file in the outbox. This download does not."* (L18–19; finding F-15-10).

**Rule.** Do **not** press **Download Sale correction CSV** unless the owner or admin is doing the CCRS upload that day by hand and will upload that exact file. Once downloaded, the returns are marked exported, and the weekly batch will treat them as sent. If you download it by mistake, keep the file, write it on form 8.6 and give it to the owner the same day.

# Part 3: Returning product to a vendor

A retailer may return product to the processor that made it (WAC 314-55-079(11): *"A cannabis retailer may transport product … to return product to a cannabis processor as outlined in WAC 314-55-085."*). The owner asked that this follow the state exactly (D63: *"I want to follow the states requirements."*). What the state requires, read on 2026-10-28:
- **Greenway is the origin and files the manifest.** *"Transportation of product in the state of Washington requires submission of the official transportation manifest provided by the LCB."* The upload is named `manifest_LicenseNumber_YYYYMMDDHHMMSS`, and *"LicenseNumber in the file name must match OriginLicenseNumber"* (CCRS Manifest User Guide, 10-27-2025). It names the driver, the vehicle, and the estimated departure and arrival times, and lists inventory already reported to CCRS.
- **The LCB's answer is an automatic email with the manifest PDF**, to Greenway and to the processor: *"Upon upload of a successful manifest file, an email will be generated with an attached PDF of the Manifest Report."* The LCB text sets **no lead time** and no Monday/Wednesday/Friday review.
- **The printed PDF travels with the product** (WAC 314-55-085(3)). Only Greenway, our employee or a transport licensee carries it; the driver is 21 or older; the product is sealed, unopened, in a locked compartment, on a direct route (085(5)); it stays tagged (085(7)). Contingency manifests are discontinued.
- **Records**: transport records three years (085(4)); all records five years (WAC 314-55-087).

The screen's **The state's steps** list under **Log a vendor return** (`vendor-return-core.ts` L77–84, shown at `page.tsx` L330) says:
1. *"Get the processor's written acceptance (RMA number or an email naming the product, lot and quantity) before anything moves."*
2. *"Log the return here: the units are reserved (out of sale) but stay on hand and in CCRS until they leave."*
3. *"Fill in the transport details and download Manifest.CSV (Greenway is the origin). Upload it at cannabisreporting.lcb.wa.gov."*
4. *"Wait for the LCB's automatic email. A success email has the manifest PDF attached; an error email means fix the file and upload again."*
5. *"Print the PDF. It travels with the product (WAC 314-55-085(3)). At departure, record the pickup time and driver: on-hand comes off and the CCRS Other adjustment posts then."*
6. *"Keep the RMA, the LCB email and PDF, and the printed packet for five years (WAC 314-55-087)."*

The old checklist line *"Submit the manifest 48–72 hours before pickup; LCB confirms manifests Mon/Wed/Fri"* was not LCB text and is gone (F-15-19 FIXED; the activation guard keeps it out).

### 4.9 Before anything moves: the processor's RMA

1. The manager or owner decides the product should go back (defective, mislabeled, overstock by agreement, expired by agreement, or a processor recall).
2. Contact the processor. Get their **written acceptance**: an RMA number, or an email that names the product, lot and quantity. No acceptance, no return.
3. Pull the units, count them twice, and put them in the **vendor-return tote** in the vault. Start **form 8.2**: processor, license number, contact, RMA, product, lot, quantity, reason, who pulled them.
4. **If the whole product (every lot) is going back**, 86 it at the register (SOP-05a §4.12) so the website does not keep selling it.
5. **If the reason is a recall** (the state had the processor ask for the product back), the admin first tells the LCB enforcement officer (WAC 314-55-225) and records it on form 8.4; then continue with this part, reason **Recall** (D65; §4.21).

### 4.10 The CCRS transport manifest (Greenway files it as the origin)

Since Phase 1.5 the app builds the outgoing **Manifest.CSV** (G-42). Log the return first (§4.11); then, on the return's row in **Vendor returns & manifests**, open **Transport details and Manifest.CSV (Greenway is the origin)** (`page.tsx` L560–627). The owner or admin:
1. Fills in **Transportation type** (*Regular*: our employee drives; *Pick-up*: the processor collects; *Transporter Licensee*: a licensed transporter, whose number goes in **Transporter license #**; the app refuses a transporter number for Regular or Pick-up, as the state's guide does), **Driver name**, **VIN #**, **Plate**, **Make**, **Model**, **Color**, **Estimated departure (Pacific)** and **Estimated arrival (Pacific)**. **Weight per unit (g)** and **Servings per unit** are asked only when the lot itself has no unit weight or servings per pack; the app never guesses them. Press **Save transport details** (*"Transport details saved. Download Manifest.CSV and upload it to CCRS."*).
2. Presses **Download Manifest.CSV** (`vendor-return-manifest/route.ts`). The file is the LCB template's shape: 21 header rows, the 13 item columns, one item row for the lot's CCRS **InventoryExternalIdentifier**, Greenway's license as **OriginLicenseNumber**, the processor as **Destination**, named `manifest_413541_YYYYMMDDHHMMSS.csv` (Pacific time; `vendor-return-core.ts` L447–504). If anything is missing the download is refused with a list (*"Manifest.CSV was not built. Fix these, then download again:"*), for example the store's contact phone or email (Settings → license settings), the vendor's phone or email (Vendors & Brands), or a lot never reported to CCRS. Each download is in the Security Log (`vendor_return.manifest_csv`).
3. Uploads it at cannabisreporting.lcb.wa.gov without changing the name.
4. Waits for the LCB's email. An error email means the upload was refused: fix it and upload again. A success email has the **manifest PDF** attached; the processor gets the same email.
5. Prints the PDF (it travels with the product), and files the email with form 8.2.
6. If the departure time, driver or vehicle changes, edit the transport details, download again (after the upload the file says **Update** instead of **Insert**) and upload the corrected manifest before the product moves. The PDF must match what actually happens.

### 4.11 Logging the vendor return in the app (reserves the units)

Log the return as soon as the processor's written acceptance (RMA) is in hand and the units are in the vendor-return tote. Logging **reserves** the units: they leave the register, the website and the menu at once, but stay on hand and in CCRS until they depart (`disposition.ts` L976–1043; F-15-1 FIXED).
1. Open **Log a vendor return**.
2. **Lot**: pick the lot. The list shows **Active**, **Quarantine** and **Recalled** lots with their status (`page.tsx` L145, L156, L268; D65). A Recalled lot stays Recalled until it departs.
3. **Quantity**: the number on form 8.2. Units already held (for example a customer return waiting for destruction) cannot be returned.
4. **Reason**: Defective product, Recall (coordinate with LCB first), Overstock, Mislabeled, Expired, or Other (describe in detail). A Recalled lot must use **Recall**.
5. **Vendor (processor)**: leave it on the lot's vendor, or choose another. **RMA #** is required. **Processor license #**: leave blank to use the vendor's license from Vendors & Brands; it must be numbers only.
6. **Detail** (required): who agreed, the condition, the agreement. It becomes the CCRS **Other** adjustment detail at departure, with the processor, the manifest number and the RMA (`vendorReturnAdjustmentNote`, `vendor-return-core.ts` L208; F-15-2 FIXED).
7. **Recall only**: **Recall: LCB officer told** and **Recall: date the officer was told** (not in the future) are required (WAC 314-55-225; D65).
8. Press **Log return (reserves the units)**. You see *"Vendor return logged. The units are reserved (out of sale) and still on hand; nothing goes to CCRS until they depart."* The row shows how many units are reserved.
9. If the app says *"Quantity (x) exceeds what is free on this lot (y). Held units cannot be returned."*, stop. Recount, and tell the owner (a cycle count difference, SOP-06).

**Before migration 0309 is applied** the button is refused with *"Apply migration 0309 first: until then a vendor return cannot be logged in the app (it would take the units off on-hand before they leave). Follow SOP-15 §4.11 on paper."* Then keep everything on form 8.2, keep the units in the tote, and log the return the day 0309 is applied. The app never falls back to the old reduce-at-logging method.

### 4.12 The steps: upload, LCB email, departure

Each vendor return shows in **Vendor returns & manifests** with a status badge (`vendor-return-core.ts` L36–43): **Processor agreed (RMA); units reserved**, **Manifest uploaded**, **LCB success email and PDF received**, **Departed (on-hand reduced, CCRS Other posted)**, or **Cancelled (units released)**. The row offers only the **Next step**, and the server refuses any other (`evaluateVendorReturnStep`, `vendor-return-core.ts` L159; F-15-3 FIXED):
1. **Manifest uploaded**: enter **Manifest # uploaded** and press **Save step** (*"Manifest step saved."*).
2. **LCB success email and PDF received**: enter **Date of the LCB success email** (not in the future, not before the upload) and press **Save step**.
3. **Departed**: at the moment the product leaves, enter **Pickup date (Pacific)**, **Pickup time (Pacific)** and **Driver name**, and press **Record departure (reduces on-hand)**. You see *"Departure recorded: on-hand reduced and the CCRS Other adjustment posted."* The reduction, the release of the reserve and the CCRS adjustment are one database step (`depart_vendor_return`, migration 0309). A pickup time more than 15 minutes in the future is refused.

Each step stamps who and when on the return itself (`*_by` / `*_at`, migration 0309) and in the Security Log (`vendor_return.manifest`, `vendor_return.depart`). All times are shown and entered in Pacific time.

**Cancelling (owner only).** If the processor withdraws or the return will not happen, the owner writes a **Cancel reason (owner)** and presses **Cancel return (release units)** (`inventory.vendor_return.cancel`, `roles.ts` L166). The reserved units go back to sale (*"Vendor return cancelled."*), and the cancel is in the Security Log (`vendor_return.cancel`; a refused try is logged as `vendor_return.cancel_refused`). A departed return cannot be cancelled.

**Returns logged before Phase 1.5** already took the units off on-hand at logging; their row says *"Logged before Phase 1.5: on-hand already came off at logging."* Their steps can still be recorded (departure then posts nothing more), but they cannot be cancelled here: the owner corrects one with a manual adjustment (SOP-05a).

### 4.13 Pickup and the vendor-return packet

1. Check the driver's identity (21 or older), the vehicle and the printed manifest PDF against form 8.2. Count the units out with the driver. The product is sealed and goes in a locked compartment (WAC 314-55-085(5)).
2. The driver signs form 8.2. Press **Record departure (reduces on-hand)** with the real pickup time and the driver (§4.12 step 3).
3. Hand the driver the **printed manifest PDF**; it stays with the product (WAC 314-55-085(3)). Keep a copy. File the **vendor-return packet** (form 8.2, the RMA email, the LCB email and PDF) by month for **five years** (WAC 314-55-087).
4. The processor reports the receipt on their side in CCRS. Greenway's side is the **Other** adjustment posted at departure with the detail (§4.11 step 6), sent in that week's file. Whether the LCB wants exactly this encoding for a retailer is still an open examiner question (U-72 in `docs/ccrs-bible/12-unverified-register.md`; the "Returned to seller → Other" line the compliance doc cites is from the producers' plant file, F-15-18). Any credit is settled with the processor outside the app; give the credit memo to the owner for the books.

# Part 4: Destruction

Destruction is governed by the current WAC 314-55-097 (compliance doc §5). Cannabis waste must be **rendered unusable before it leaves the licensed premises**, by grinding it and mixing it with other ground material so the result is **at least 50 percent non-cannabis waste by volume**. Any other method needs **prior LCB approval**. The records (what, when, how, where it went) are kept five years. CCRS receives a **Destruction** adjustment in that week's file.

**What the law does not require** (checked 2026-10-28, D64, D67): no waiting period, no notice to the LCB before destroying (the old 72-hour notice was removed by WSR 22-14-111), and no witness. **What it does require besides the method**: the destruction area is covered by the security cameras (WAC 314-55-083(3)(a): areas where cannabis waste is *"moved within, processed, stored, or destroyed"*; recorded 24 hours, kept 45 days). The owner adds two store controls: a witness (anyone) and the camera (D64).

**Does the app match the state's rule?** Yes for the method and record: **Complete destruction** refuses to finish without a rendering method, what it was mixed with, the 50% attestation (unless the method is **Other method (requires PRIOR LCB approval)**) and a final destination or facility (`disposition-core.ts` `validateDestructionCompletion`). It does not ask for a camera reference or require the witness (F-15-21, G-43), so form 8.3 carries both.

### 4.14 When product is destroyed (reasons)

**Schedule a destruction** offers these reasons (`disposition-reasons.ts` L36–54): **Expired**, **Failed quality assurance**, **Recall (LCB coordination required)**, **Damaged**, **Contaminated**, **Other (describe in detail)**. All of them reach CCRS as **Destruction** (`ccrs-inventory-adjustment-core.ts` L62–90).

| Situation | Reason | First |
|---|---|---|
| Past its expiry and not returnable to the processor | **Expired** | Check the processor will not take it back (§4.9); expired edibles must not be sold (SOP-05a §4.16) |
| A lab or LCB failure notice | **Failed quality assurance** | Owner decides; ask the processor about a return first |
| Recall | **Never destroyed by us: vendor return (D65)** | §4.21 |
| Crushed, leaking, broken seal | **Damaged** | Photograph it; owner decides |
| Mould, pests, foreign matter | **Contaminated** | Isolate it at once; owner decides |
| Customer-returned unit | The app opens it automatically as **Other** | §4.7 |
| Anything else | **Other** with a sentence | Owner approves |

**Who decides.** The owner approves every destruction except a customer-returned unit marked Destroy. The manager writes the owner's approval on form 8.3.

### 4.15 Scheduling a destruction

1. Pull the units and count them twice. Put them in the **sealed destroy bin**.
2. Open **Schedule a destruction** (*"Opens a {hours}h hold and quarantines the lot. Complete it below once the hold elapses."*).
3. **Lot**: pick the lot. **Active** and **Quarantine** lots are listed, each with its status (since Phase 1.3, F-05a-17 FIXED). **Recalled** lots are never listed: they go back to the vendor (§4.21). The **Recall** reason is no longer offered.
4. **Quantity**: the counted number. The app does **not** check it against on-hand now; a wrong number is caught only at completion (F-15-12). Look at the on-hand shown in the lot list and make sure your number is not larger.
5. **Reason** (default **Expired**) and **Detail** (*"What & why…"*): always write a sentence, including the owner's approval.
6. Press **Schedule (opens {hours}h hold)** (with the store setting at 0 it reads *"opens 0h hold"*, D67). You see *"Destruction scheduled — the hold timer is running and the lot is quarantined."*
7. An Active lot is now in Quarantine as a whole, not just the units you scheduled (a Quarantine lot simply stays there). The app keeps the status it had, so a cancel or a partial destruction can put it back. If you are destroying only part of a lot and the rest is sellable, see §4.20.
8. Start **form 8.3** with the event: date scheduled, lot, quantity, reason, who scheduled, the owner's approval.

If you see the bare word *"qty"* or *"reason"* in a red box, the Lot, Quantity or Reason was missing or invalid (`actions.ts` L179–180 redirect with a code; the same happens on the vendor return, L126–127, and the wizard, L83–84, which the page prints as is; F-15-13). Fill the form again.

### 4.16 The hold and the quarantine

The event appears under **Destruction events** with the product, lot, quantity, reason, *"hold ends …"* and a status badge (**pending quarantine** while the hold runs). The hold end is shown in the browser's own clock (`page.tsx` L321); on a store computer that is Pacific time.

During the hold (with the hold at 0, there is none: complete the destruction as soon as it is done, the same day):
- The units stay in the sealed bin. Nobody opens it except to add more product for destruction (with a form 8.1 line) or on destruction day.
- The owner may stop the destruction (§4.19).
- Arrange the witness (anyone, D64), the camera-covered spot and the mixing material for destruction day.

**Complete destruction** stays greyed out as **Hold not elapsed** until the hold ends. If the server is asked to complete early, it refuses with *"Hold policy not elapsed — earliest destroy at …"* (`disposition-core.ts` L229). That time is written in the **server's** clock and format, which may not be Pacific (F-15-5).

### 4.17 Rendering the product unusable (WAC 314-55-097)

Do this on the licensed premises, **in view of a security camera** (D64; WAC 314-55-083(3)(a)), with the witness watching the whole time. Before starting, check the camera covering that spot is recording and note its name and the start time on form 8.3, so the footage can be found (it is kept 45 days).
1. Take the units out of the sealed bin and check them against form 8.3 (product, lot, quantity).
2. Remove the product from packaging that would stop it being ground (glass, metal, vape hardware). The packaging goes in the normal trash only after the product is out of it and the label is defaced. Vape cartridges and batteries: the oil is the cannabis waste; the hardware goes to e-waste or battery recycling as the owner directs.
3. Grind the cannabis waste.
4. Mix it with **at least an equal volume** of other ground material, so the result is **at least 50% non-cannabis waste by volume**:
   - **Compostable**: food waste, yard waste, vegetable-based grease or oils (for example coffee grounds). Goes to a compost facility or the compost stream.
   - **Non-compostable**: paper, cardboard, plastic waste (for example shredded cardboard). Goes to a permitted solid waste facility (the dumpster serviced by the hauler).
5. Any other method (for example a licensed waste contractor): **only with prior LCB approval in writing**, filed with form 8.3. The app accepts **Other method (requires PRIOR LCB approval)** without asking for that approval (F-15-4); this SOP requires it.
6. Put the mixture in the final destination (the dumpster or compost bin). Photograph the mixture before it goes. The witness watches it go. Note the end time for the camera reference.

### 4.18 Completing the destruction record

Right after §4.17, on the event under **Destruction events**:
1. **Rendering method** (*"How it's made unusable (WAC 314-55-097)"*): **Grind + mix ≥50% compostable waste (food/yard waste, vegetable grease)**, **Grind + mix ≥50% non-compostable waste (paper, cardboard, plastic)**, or **Other method (requires PRIOR LCB approval)**. The default is the compostable one; change it if you used cardboard or plastic.
2. **Mixed with**: what you used (for example "coffee grounds" or "shredded cardboard").
3. Tick **The mixture is at least 50% non-cannabis waste by volume** only if it is true.
4. **Final destination** (*"Where the waste goes"*) and **Disposal facility** (*"Hauler or facility name"*): fill **both** (the app needs only one).
5. **Witnessed by**: both names, the person who did it and the witness (anyone, D64), then the camera, for example "J. Smith (did) / A. Lee (witness) · cam 4 vault 14:05–14:20". The app accepts it blank and has no camera field (F-15-4, F-15-21); this SOP requires both.
6. The gold recall box appears only for a **Recall** event. There should be none: recalled product goes back to the vendor (D65, §4.21). If you see it, stop and call the admin.
7. Press **Complete destruction**. You see *"Destruction completed and the CCRS 'Destruction' adjustment posted."* The row then reads *"Destroyed … · witnessed by …"*.
8. Finish **form 8.3**: time rendered unusable, method, mix, 50% check, final destination, facility, both signatures, camera and times, photo reference. File it by month for five years.

**If it refuses**, see §5. The common ones: *"Record what the ground cannabis waste was mixed with (WAC 314-55-097)."*, *"Confirm the mixed result is at least 50% non-cannabis waste by volume (WAC 314-55-097)."*, *"Record the final destination / disposal facility for the waste — WAC 314-55-097 requires it in your records (kept 5 years)."*, and *"Quantity (x) exceeds on-hand (y)."* The last one means the lot holds less than the event says, often because some of it sold before scheduling (F-15-12). Stop and call the owner; do not destroy more than the app will record without the owner.

**What the app keeps.** The method, mix, destination, facility, witness, LCB fields, the time and the person who completed it, and the adjustment (`disposition.ts` L1053–1080). The audit row does not include the witness's contact date or the LCB contact date, and the app has no printable destruction log (F-15-4; G-43). Form 8.3 is the record the LCB will read.

### 4.19 Cancelling a scheduled destruction

**Since Phase 1.3 (G-28).** Under an open event the owner sees **Why cancel? (required)** and **Cancel destruction (owner)**. Everyone else sees *"Only the owner can cancel a scheduled destruction (SOP-15 §2 rule 3)."* (`disposition/page.tsx` L417). The server checks it again (`cancelDestructionAction`, `actions.ts` L265): without the owner or without a reason it refuses, with every reason at once, and writes `destruction.cancel_refused`.

On a cancel the event is closed (only if it is still open), the reason, who and when are kept on it, and the lot goes back to the status it had before scheduling (`restoreLotAfterEventCloses`, `disposition.ts` L934). The page says what happened to the lot:
- *"The lot was put back to Active, the status it had before the destruction was scheduled."*
- *"The lot stays in Quarantine, the status it had before the destruction was scheduled."*
- *"The lot stays in Quarantine because another destruction for it is still open."*
- *"The lot status was not changed: someone changed it after the destruction was scheduled."*
- *"The lot status was not changed (this destruction never moved the lot)."* (a customer-returned unit)
- *"The lot stays as it is: this destruction was scheduled before the app kept the earlier status. Set the status on the lot page (Lifecycle status) if it should change."*

The app only ever moves Quarantine → Active, and only for a lot that was Active (go-live checked) when it was scheduled. It never touches a Recalled lot.

**Rule: only the owner cancels.** Then:
1. Write it on **form 8.5**: event, lot, status before and status now (both shown in the message and the Security Log), why, owner's initials.
2. If the event was a **customer-returned unit**, decide with the owner what happens to the unit in the bin (restock only if it is sealed and the owner agrees).
3. If the destruction was cancelled because the product will now go back to the vendor, continue with Part 3.

### 4.20 Destroying part of a lot

Scheduling quarantines a whole Active lot. **Since Phase 1.3** (G-28, F-15-11 FIXED), after **Complete destruction**, if units remain, the app puts the lot back to the status it had before scheduling by the same rule as a cancel (§4.19): an Active lot goes back to **Active** unless another destruction for it is still open or someone changed it since; a Quarantine lot stays in Quarantine.
1. Before scheduling part of a lot, decide with the owner whether the remaining units are sellable. If they are not, schedule all of them.
2. After completion, look at the lot's status and write the line on form 8.5.

### 4.21 Recalled product: a transfer back to the vendor (D65)

The law (WAC 314-55-225; compliance doc §4): the licensee is **prohibited from destroying any affected cannabis product until the LCB has been notified and destruction has been coordinated with the enforcement officer**. An exempt market withdrawal is reported to the officer within 48 hours; a consumer-safety recall is reported immediately.

The app has a guard: a **Recall** event shows the badge **recall — coordinate with LCB** and the gold box *"Recall destruction — LCB coordination is REQUIRED first (WAC 314-55-225)."* Completion is refused without the tick box *"The LCB has been notified and destruction was coordinated with our officer."* (*"RECALL product: destruction is prohibited until LCB has been notified and destruction is coordinated with your enforcement officer (WAC 314-55-225). Confirm coordination first."*) and without the officer's name (*"Record the LCB enforcement officer you coordinated with."*). But:
- Since Phase 1.3 a **Recalled** lot cannot be scheduled or completed, and **Recall** is not offered as a destruction reason (F-05a-18 FIXED). The old recall box remains only for an event scheduled before the fix.
- The **Contact date** is not required (F-15-4).
- Since Phase 1.5 a vendor return with reason **Recall** needs the LCB officer and the contact date, and a Recalled lot can only go back with reason Recall (F-15-2 FIXED).

**The owner's rule (D65):** *"Let's treat recalls like a transfer back to the vendor for now."* In practice the state has the vendor contact us and ask for the product back. So:
1. Keep the lot **Recalled** (SOP-05a §4.10) and the product in the **vendor-return tote**, out of sale.
2. The **admin** (recall coordinator, D37) records the vendor's request and tells the LCB enforcement officer at once (WAC 314-55-225 still applies: *"Immediately notify the local LCB enforcement officer"*). Record every contact on **form 8.4** and SOP-05a form 8.5.
3. Return it to the vendor under Part 3 (§4.9–§4.13), reason **Recall (coordinate with LCB first)**. **Never schedule a destruction** for it, and never destroy it ourselves: the law prohibits destruction before the officer has coordinated it, and the owner has chosen the return route.
4. **Log a vendor return** lists Recalled lots (since Phase 1.5, G-42). Log the return straight from the Recalled lot with reason **Recall**, the officer and the contact date (§4.11 step 7). The lot stays **Recalled** until **Record departure**; do not set it to Active first. Note the return on form 8.4 and SOP-05a form 8.5.
5. If the officer directs something other than a return (for example destruction under LCB oversight), stop and call the owner; that is outside this SOP until the owner decides.

### 4.22 Lots already in Quarantine

Since Phase 1.3 (G-28) a lot in **Quarantine** (damaged, expired, under investigation) is listed in **Schedule a destruction** with its status, and stays in Quarantine when scheduled. A cancel or a partial destruction leaves it in Quarantine (§4.19, §4.20). The owner still decides before it is scheduled.

# Part 5: Related matters

### 4.23 Theft, loss and seizure (pointers)

These are not destructions. CCRS has its own reasons: **Theft** (a detail is required), **Lost**, **Seizure** (compliance doc §5.5). Returns & Destruction has no form for them.
- **Theft or seizure**: SOP-20 incident; the owner decides how it is recorded. Until G-23 is built, the lot page's only path is **Other** with a note starting "THEFT:" or "SEIZURE:" and the report number (SOP-05a §4.7).
- **Lost or unexplained shrink** found in a count: SOP-06 (reason on the audit).
- Never use **Schedule a destruction** for product that is missing; you cannot destroy what you do not have.

### 4.24 Money, excise and the books

- **Refunds.** A customer-return refund is stored on the return and counted in the store's daily refunds (`refunds-store.ts` L11, L48). The register and Returns desk refunds are what the customer paid. The wizard's refund is typed (§4.6).
- **Books.** No journal entry is drafted for a customer refund. The account **50910 Returns & Refunds** exists but nothing posts to it (`ledger-census-data.ts` L252–268: *"50910 Returns & Refunds is seeded and unused."*; F-15-14). Until G-48 is built, the owner reviews the month's returns on form 8.6 with the bookkeeping help.
- **Destruction and vendor-return cost.** The inventory adjustments export writes off the cost (debit cost of goods, credit inventory, `sage-exports.ts` L644–698). The owner approves it in the books (SOP for the books).
- **Excise (LIQ-1295).** The monthly excise figure is built from **completed orders** (`excise-return.ts` L140–158) and, as far as the code shows, does not read `customer_returns`. A returned sale may therefore still be counted in the month's cannabis sales (F-15-15; not confirmed against a live return). Until G-48 is built, the owner checks the month's returns on form 8.6 before filing, and uses the manual override on the excise screen if a correction is due (`excise-return.ts` L111).
- **Vendor credits** are outside the app (§4.13).

### 4.25 The AI advisor

**Ask the advisor** (the advisor panel, `page.tsx` L507) gives a short briefing: **Needs attention**, **Compliant**, **Next steps**. You may type a question (*"Optional question — e.g. “A customer wants to return an opened vape from last week, what do I do?”"*). It sees **only counts**, never customer details. Its instructions forbid it to claim the 72-hour notice is law and forbid legal advice (`disposition-advisor.ts` L19–31). It appears only when the AI key is set; otherwise *"The advisor turns on once an AI_API_KEY is set."*

Rules: the advisor is **advisory only** (*"Advisory only…"*); this SOP and the owner decide. Its count of vendor returns "awaiting manifest" includes every return that is not **Picked up / in transit** (`actions.ts` L330–333), so a return logged at departure (§4.11) appears there until you set **Picked up / in transit**.

### 4.26 Samples: never on the menu or at the register

**The owner's samples rules (D68):** *"Samples go through receiving, are for employees only, have maximum amounts we can take in and give out. They have a .01 cost. They can not be sold at the register, they cannot be found on the menu. They go directly to the employee samples hub where they are distributed there. At that time they are reduced from inventory."* The law agrees: *"Trade samples may not be sold"* (WAC 314-55-096(1)(i)).

**Built in Fix Phase 0.2 (G-51 and G-47, owner D76).** The app now enforces the rule by itself:

| Rule | How the app enforces it |
|---|---|
| Through receiving | A sample line becomes a lot marked **Sample** (`intake-parser.ts`; a $0 line counts as a sample). The manifest review shows *"Trade SAMPLE → Employee Samples hub…"* as information (`intake-review-core.ts`) |
| No menu draft | Product Onboarding never seeds a draft for a sample lot (`catalog-drafts.ts` `seedDraftsForManifest`, `.eq("is_sample", false)`) |
| Never approved onto the menu | An older draft made from a sample lot is refused at **Approve**: *"This product comes from a trade SAMPLE lot. Trade samples may not be sold…"* (`approveDraftWithPrice`) |
| Never staged on a menu version | Intake staging and draft injection drop any approved draft whose lot is a sample (`intake-menu-staging.ts`, `draft-injection.ts`) |
| Never drawn by a sale | The register's lot draw skips sample lots, even when they share the product's SKU (`sale-lot-read.ts`) |
| Not register stock, no barcode | The POS menu's lot read and barcode index skip sample lots (`api/pos/menu/route.ts`); the register-sellability report does too |
| Never moves website stock | A change to a sample lot never changes menu stock (`lot-menu-stock.ts`); a void never restocks onto a sample lot (`void-store.ts`) |
| Intake cap (120 per processor per quarter) | Finalize is refused if passed (`intake-store.ts`) |
| Give-out cap (30 per employee per quarter) | Enforced on the Employee Samples hub (`trade-samples.ts`) |
| $0.01 cost | CCRS TotalCost for samples (`ccrs-preflight-core.ts`) |
| Hub reduces inventory at distribution | A negative **employee_sample** adjustment, CCRS **Other** (`trade-samples.ts`) |

The one rule lives in `src/lib/inventory/sample-lot-core.ts`. The old **Sample-pricing rules** panel was legacy and did nothing (F-15-16). It has been **removed** from this page, together with its save action and `sample-guardrails.ts` (G-47, D68).

**What staff still do:** nothing special. Give samples out only on the Employee Samples hub. As a spot check, once a month open **Inventory**, set the **Sample** filter to **Samples only**, and confirm that sample lots went down only through the hub (Sample History). Report anything else to the owner.

### 4.27 The destruction hold policy setting

**Destruction hold policy** (*"How long a scheduled destruction is held before it can be completed. This is a STORE POLICY safety window — the old 72-hour LCB notice was removed from WAC 314-55-097 (WSR 22-14-111). 72h remains a sensible default."*). **Hold (hours)**, 0–336; **Save hold policy** (*"Hold policy saved."*). Owner and admin only (*"Changing the hold policy requires the “Change settings” permission."*).

**Store rule (D67):** set it to **0 hours**, the legal minimum. The owner: *"Q5- reduce it to the minimum required by law. Look it up in CCRS please."* The current WAC 314-55-097 has no waiting period, and CCRS asks only that the **Destruction** adjustment be reported in that week's file (WAC 314-55-083(4)). The owner or admin types **0** in **Hold (hours)** and presses **Save hold policy**. A change applies to destructions scheduled afterwards; an event already on hold keeps its time. The panel text (*"72h remains a sensible default"*) and the code default of 72 change under **G-50**. A stale database comment still calls the 72 hours a WSLCB rule (`0042_*.sql` L44, L55; F-15-17); it is not.

## 5. Messages: "If you see this message"

### 5.1 Customer returns

| Message | What it means | Do this |
|---|---|---|
| *"Customer return logged — inventory adjusted, CCRS Sale correction queued. Download the correction CSV before your next upload."* | The wizard saved the return | Do **not** download the CSV unless the owner is uploading by hand that day (§4.8); go to §4.7 if Destroy |
| *"Return logged. Refund $X in cash."* | The Returns desk saved the return | Print the refund receipt, pay, §4.7 if Destroy |
| *"Return processed — hand back $X cash; N points reversed. Product goes to the quarantine bin."* | The register saved the return (SOP-01 §4.23) | Hand back the cash; destroy bin (§4.7) |
| *"Pick a completed sale line first."* | Wizard step 2 skipped | Pick the line |
| *"Type at least 2 characters."* / *"Type at least 2 characters (order #, name, or phone)."* | Search too short | Type more |
| *"No completed sales matched. Only completed orders can be returned."* | No match | Check the receipt; open orders cannot be returned |
| *"Type the receipt number first — it's on the customer's original receipt."* | Returns desk lookup empty | Type the 8 characters |
| *"Outside the 15-day return window — this sale was N days ago (store policy). Refuse the return."* | Policy | Refuse; owner exception only (§4.4) |
| *"No loyalty member is attached to this sale — store policy requires the product to have been purchased by a loyalty customer. Refuse the return."* | Policy | Refuse; owner exception only |
| *"Only COMPLETED sales can be returned."* | The order is not completed | Do not return it; ask the manager |
| *"Cannot accept: product must be in its ORIGINAL packaging (WAC 314-55-079(12)). Refuse the return."* | Attestation missing | Refuse unless it really is in the original packaging |
| *"Cannot accept: the lot/batch/inventory ID on the package must be FULLY LEGIBLE (WAC 314-55-079(12)). Refuse the return."* | Attestation missing | Refuse unless legible |
| *"Both WAC 314-55-079(12) checks are required — original packaging AND a fully legible lot ID. If either fails, refuse the return."* | Returns desk attestations | As above |
| *"Return quantity (x) exceeds the quantity sold on this line (y)."* / *"Return quantity (x) exceeds what is still returnable on this line (y)."* | Too many | Lower the quantity |
| *"Nothing left to return on this line — it has already been fully returned."* | Already returned | Stop; check Recent customer returns |
| *"Refund exceeds what the customer paid for the returned quantity (max X). Reduce the refund."* | Wizard refund too high | Enter the owner-approved amount, at most X |
| *"No inventory lot matches this product — pick the lot manually so the add-back lands on the correct CCRS inventory identifier."* | The wizard cannot find a lot and has no lot box (F-15-8) | Stop; owner. Use the Returns desk if the sale qualifies |
| *"The return was not saved and nothing was changed: …"* | The one-step save was refused; nothing was recorded (F-15-7 FIXED) | Keep the unit and cash aside; owner (§4.7) |
| *"Apply migration 0115 first (customer_returns table missing). Nothing was changed (the add-back was undone)."* | Database not up to date; nothing kept | Owner (§4.7) |
| *"Migration 0308 is not applied yet, so the app could not hold the returned unit: keep it in the sealed destroy bin (SOP-15 §4.7)."* | Return saved, but the app counts the unit as sellable | Sealed bin; tell the owner to apply 0308 |
| *"… unit(s) are held for a customer-return destruction and cannot be used for anything else."* | A vendor return, destruction or adjustment would take held units | Use the free units only, or complete that destruction first |
| *"N returned unit(s) released from hold; they now count as sellable stock. …"* | The owner cancelled a customer-return destruction | Restock only if sealed and unharmed; otherwise schedule a new destruction |
| Badge **Sale Delete pending** / **Sale Update pending** | The CCRS correction waits for the weekly file | Nothing; SOP-16 |
| Badge **Sale … exported** | Sent (by CSV or the weekly file) | Nothing |

### 5.2 Vendor returns

| Message | What it means | Do this |
|---|---|---|
| *"Vendor return logged. The units are reserved (out of sale) and still on hand; nothing goes to CCRS until they depart."* | Units held on the lot | Fill in transport details, download Manifest.CSV (§4.10) |
| *"Transport details saved. Download Manifest.CSV and upload it to CCRS."* | Saved | Download and upload |
| *"Manifest.CSV was not built. Fix these, then download again:"* (with a list) | Something the state requires is missing | Fix each line (license settings, Vendors & Brands, the transport details), then download again |
| *"Manifest step saved."* | Upload or LCB email recorded | Next step |
| *"Departure recorded: on-hand reduced and the CCRS Other adjustment posted."* | The product has left; the reduction is in this week's file | File the packet (§4.13) |
| *"Vendor return cancelled."* | Owner cancel; reserved units are back in sale | Put the units back on the shelf |
| *"Quantity (x) exceeds what is free on this lot (y). Held units cannot be returned."* | Fewer free units than the tote | Stop; recount; owner |
| *"Enter the processor's RMA number (their written acceptance comes first, D63)."* | No RMA | Get the RMA first (§4.9) |
| *"Enter the processor's license number (numbers only, up to 10 digits)."* | Missing or not a number | Fix it, or fix the vendor in Vendors & Brands |
| *"Write a detail sentence (who agreed, the condition, the agreement); it goes into the CCRS Other detail."* | Detail too short | Write the sentence |
| *"This lot is Recalled: it goes back to the vendor with reason Recall (D65; SOP-15 §4.21)."* | Wrong reason for a Recalled lot | Choose **Recall** |
| *"Recall: record the LCB enforcement officer the admin told (WAC 314-55-225; D65)."* | Recall without the officer | Admin tells the officer first (form 8.4) |
| *"Steps go in order: the next step is \"…\"."* | A step was skipped | Do the named step |
| *"Enter the date of the LCB's success email (with the manifest PDF)."* | No date | Enter it; no success email = no release |
| *"Record departure when the product actually leaves; the pickup time is in the future."* | Departure pressed early | Press it when the driver leaves |
| *"Only the owner cancels a vendor return."* | Not the owner | Ask the owner |
| *"This return was logged before Phase 1.5 and already took the units off on-hand; it cannot be cancelled here. The owner corrects it with a manual adjustment (SOP-05a)."* | Old return | Owner: SOP-05a manual adjustment |
| *"Someone changed this return a moment ago. Refresh and check its step."* | Two people at once | Refresh |
| *"Apply migration 0309 first: until then a vendor return cannot be logged in the app (it would take the units off on-hand before they leave). Follow SOP-15 §4.11 on paper."* | Database not up to date | Owner applies 0309; keep form 8.2 |

### 5.3 Destruction

| Message | What it means | Do this |
|---|---|---|
| *"Destruction scheduled — the hold timer is running and the lot is quarantined."* | Event opened; the lot is in Quarantine | Form 8.3; §4.20 if partial |
| *"Recalled product is never destroyed by us (owner decision D65). It goes back to the vendor…"* | A Recalled lot or the Recall reason (schedule or complete) | §4.21: admin, vendor return |
| *"The lot's status changed while you were scheduling. Nothing was scheduled; reload and try again."* | Someone changed the lot a moment earlier | Reload; check the status |
| *"This lot is Sold out; there is nothing on hand to destroy."* / *"This lot is already Destroyed…"* | Nothing to destroy | Nothing |
| *"Only the owner can cancel a scheduled destruction (SOP-15 §2 rule 3)."* / *"Write why the destruction is being cancelled."* | Cancel refused | Owner, with a reason |
| **Hold not elapsed** (greyed button) | The hold is running | Wait |
| *"Hold policy not elapsed — earliest destroy at …"* | Too early; the time is in the server's clock (F-15-5) | Wait until the time shown on the event |
| *"RECALL product: destruction is prohibited until LCB has been notified and destruction is coordinated with your enforcement officer (WAC 314-55-225). Confirm coordination first."* | Recall guard | Stop; admin; §4.21 |
| *"Record the LCB enforcement officer you coordinated with."* | Officer name missing | Admin enters it |
| *"Choose how the product was rendered unusable (WAC 314-55-097)."* | Method missing | Pick the method |
| *"Record what the ground cannabis waste was mixed with (WAC 314-55-097)."* | Mix missing | Enter it |
| *"Confirm the mixed result is at least 50% non-cannabis waste by volume (WAC 314-55-097)."* | 50% box not ticked | Tick only if true; otherwise add more material |
| *"Record the final destination / disposal facility for the waste — WAC 314-55-097 requires it in your records (kept 5 years)."* | Both blank | Fill both |
| *"Destruction completed and the CCRS 'Destruction' adjustment posted."* | Done | Finish form 8.3; §4.20 if units remain |
| *"Already completed."* / *"This event was cancelled."* / *"Completed events cannot be cancelled."* | Event already closed | Nothing |
| *"Destruction event not found."* / *"Lot not found."* | Stale page | Reload |
| *"Destruction cancelled."* followed by what happened to the lot | Cancelled; the lot is back to its earlier status or left as it was (§4.19) | Form 8.5 |
| *"This event was completed or cancelled by someone else just now. Nothing was changed."* | Two people at once | Reload |
| **qty** or **reason** alone in a red box | A field was missing (F-15-13) | Fill the form again |
| **No destruction events** / *"Scheduled destructions appear here."* | None yet | Nothing |

### 5.4 Settings and advisor

| Message | What it means | Do this |
|---|---|---|
| *"Hold policy saved."* / *"Sample rules saved."* | Saved | Note the change on form 8.6 |
| *"Changing the hold policy requires admin."* | A manager tried | Ask the owner |
| *"AI is not configured (set AI_API_KEY)."* | No AI key | Use this SOP |
| *"Supabase service role not configured."* | Database not connected | Owner; paper forms only |

## 6. Exceptions & escalation

| Situation | Do this | Who |
|---|---|---|
| Customer wants a return outside the policy | Refuse politely; owner decides; never the back-office wizard (D66, §4.6) | Manager → owner |
| A destroy-return unit is not in the bin | Find it; check the shelf and the counter. The app holds it (never sold, since Phase 1.4), so a missing unit is a loss: tell the owner | Manager → owner |
| No destruction event appeared for a destroy return | §4.7 step 4 | Manager → owner |
| Return saved with an error message | Stop; do not retry; owner (§4.7) | Manager → owner |
| Sale correction CSV downloaded by mistake | Keep the file; form 8.6; owner the same day (§4.8) | Anyone → owner |
| Processor will not give an RMA | No return; consider destruction (owner) | Manager → owner |
| No LCB success email and PDF by the departure time, or an error email | Do not release; fix and upload again; move the departure (§4.10) | Owner / admin |
| Driver, vehicle or time differs from the manifest | Do not release; upload a corrected manifest first (§4.10 step 5) | Owner / admin |
| Vendor return will not happen after all | Owner presses **Cancel return (release units)** with a reason (§4.12) | Manager → owner |
| Departure recorded by mistake before the product left | Tell the owner at once; the owner adds the units back with a manual adjustment (SOP-05a §4.6) and notes it on form 8.2 | Manager → owner |
| Vendor asks for recalled product back | §4.21: admin tells the officer, then a vendor return (D65); never destroy it | Admin + owner |
| Recalled lot not in the destruction list | Correct: §4.21 (vendor return) | Admin + owner |
| Destruction quantity larger than on-hand | Stop; owner; count the lot | Manager → owner |
| A destruction was cancelled | Read what the page says happened to the lot; form 8.5 (§4.19) | Owner |
| Part of a lot destroyed; rest sellable | §4.20 | Manager |
| No second person available, or the camera is not recording | Do not destroy; wait until both are in place (D64) | Manager |
| A sample lot went down other than on the Employee Samples hub, or Approve refuses a draft as a trade sample | Dismiss the draft; tell the owner the same day (§4.26) | Anyone → owner |
| Contractor or other method proposed | Prior written LCB approval first (§4.17) | Owner |
| Product missing (theft, loss) | SOP-20; not a destruction (§4.23) | Owner |

## 7. Controls & compliance (why the rules exist)

| Rule in this SOP | Why (authority) | Where the app enforces it today |
|---|---|---|
| Returns only in original packaging with a legible lot ID | WAC 314-55-079(12) | Attestations on every path (`disposition-core.ts` L102–150) |
| Returned sale corrected in CCRS (Delete or Update) | LCB CCRS FAQ (help panel `page.tsx` L172) | Queued on every return; the CSV download skips the ledger check (F-15-10) |
| Store return policy (loyalty, receipt, 15 days) | Owner policy, SOP-01 §4.23 | Register and Returns desk only; the wizard skips it (F-15-8) and is to be removed (D66) |
| Product returned to a processor only with Greenway's CCRS manifest (origin), the LCB's success email and PDF, the printed PDF with the product, an employee 21+ / transport licensee, sealed and locked | WAC 314-55-079(11), WAC 314-55-085(1), (3), (5); CCRS Manifest User Guide 10-27-2025 (D63) | **Enforced** (Phase 1.5, G-42 BUILT): units reserved at logging, reduction at departure; RMA, numeric license and detail required; steps in order on the server; Manifest.CSV built with Greenway as origin; Pacific times (F-15-1, F-15-2, F-15-3, F-15-19 FIXED) |
| Vendor return reported as InventoryAdjustment **Other** with a detail | Best-supported encoding: Other is the only InventoryAdjustment reason that fits (CCRS Upload User Guide Table 5); not confirmed by the LCB (U-72). The "Returned to seller → Other" line cited in the compliance doc is from the plant file's Table 4 (F-15-18) | Note always starts *"Vendor return to …"* and names the processor, license, manifest and RMA (`vendor-return-core.ts` L208) |
| Waste rendered unusable on premises, ≥50% non-cannabis, other methods with prior LCB approval | WAC 314-55-097 | Method, mix and 50% tick required (`disposition-core.ts` L245–255); no approval reference for Other (F-15-4) |
| Waste records (what, when, method, destination) kept five years | WAC 314-55-097(7)(e), WAC 314-55-087 | Stored on the event; witness optional, no printable log (F-15-4) |
| Destruction reported in that week's CCRS file | WAC 314-55-083(4); LCB PS21-10 (weekly) | **Destruction** adjustment on completion |
| Recalled product: officer told at once; never destroyed by us; returned to the vendor | WAC 314-55-225; owner D65 | Recall destruction has a tick box and officer field; scheduling lifts the recall status (F-05a-18); a vendor return with reason Recall needs the officer and contact date (Phase 1.5, F-15-2 FIXED) |
| Reductions documented, or they count as sales | WAC 314-55-089(4)(c) | Every action posts a noted adjustment; cancel has no reason (F-05a-19) |
| No legal hold; store hold set to 0 | WAC 314-55-097 (current); WSR 22-14-111; owner D67 | Setting allows 0; code default and panel text still 72 (G-50); stale migration comment (F-15-17) |
| Destruction area on camera | WAC 314-55-083(3)(a); owner D64 | No camera field (F-15-21) |
| Samples never sold, never on the menu | WAC 314-55-096(1)(i); owner D68 | **Enforced** (Phase 0.2: F-15-20 FIXED, G-51 BUILT; legacy panel removed, G-47 BUILT) |
| Owner approves anything financial | books-23 (*"Anything accounting, bookkeeping, taxes, finance, should be hard gated to me only."*) | Refund journal missing (F-15-14); excise not reduced by returns (F-15-15) |
| Two-person destruction; the witness may be anyone | Store control (owner D64) | Not enforced (F-15-4) |

## 8. Checklists & forms

Print on letter paper. Initials in every box. File by month in the compliance binder for five years (WAC 314-55-087).

### 8.1 Destroy-bin log (one line per unit or batch put in the sealed bin)

```
DESTROY-BIN LOG                                   Month: ________  Page ___
Bin sealed by (initials) ____  Seal / tape number ________

Date | Time | Source (customer return receipt # / count / damage) | Product | Lot | Qty | Reason | Put in by | Witness | Destruction event seen in app (Y/N) | Completed date
-----|------|------|------|------|------|------|------|------|------|------
     |      |      |      |      |      |      |      |      |      |
     |      |      |      |      |      |      |      |      |      |
     |      |      |      |      |      |      |      |      |      |
     |      |      |      |      |      |      |      |      |      |

Owner exception returns (back-office wizard, §4.6): approval written here
Date | Receipt | Exception approved | Refund approved $ | Paid from (till / safe) | Owner initials
-----|------|------|------|------|------
     |      |      |      |      |
```

### 8.2 Vendor-return packet (one per return; staple the RMA, manifest and LCB email to it)

```
VENDOR-RETURN PACKET                               Return # ________
Processor name ______________________  License # ______________  Contact ______________
Reason:  [ ] Defective  [ ] Recall (admin told LCB officer first, form 8.4)  [ ] Overstock
         [ ] Mislabeled  [ ] Expired  [ ] Other: ____________________
Owner approval (initials / date) ________

STEP 1  Processor's written acceptance   RMA # ____________  Date received ________
STEP 2  Units pulled to the vendor-return tote; logged in the app (units reserved, §4.11)
        Product ______________________  Lot __________  Qty counted ____ / recount ____
        Product ______________________  Lot __________  Qty counted ____ / recount ____
        Pulled by ______  Second count by ______   Whole product 86'd? [ ] Yes [ ] N/A
STEP 3  Manifest.CSV uploaded to CCRS by Greenway (origin 413541)  Manifest # ________  by ______
        Uploaded (date/time) ____________  Departure (est.) ________  Arrival (est.) ________
        Transport: [ ] Regular (our driver)  [ ] Pick-up (processor)  [ ] Transporter lic # ______
        Driver ______________ (21+)  Plate ________  VIN ________________  Make/model/colour ________
STEP 4  LCB SUCCESS email with manifest PDF received  Date/time ________  PDF printed [ ]  filed [ ]
        (error email? fix + re-upload; no success email = no release)
STEP 5  Departure — press Record departure NOW, not before (§4.12)
        App: logged (reserved) [ ]  Manifest uploaded [ ]  LCB email recorded [ ]  Departure recorded [ ]
        Driver matches manifest [ ]  Vehicle matches [ ]  ID checked (21+) [ ]  Sealed + locked [ ]
        Printed manifest PDF handed to driver [ ]
        Units counted out with driver: ____     Time ________ (Pacific)
        Driver signature ______________     Our signature ______________
STEP 6  Credit memo from processor received (date / amount) ____________ → owner [ ]
Filed (month) ________   Keep 5 years
```

### 8.3 Destruction waste record (one per destruction event; the record the LCB will read)

```
DESTRUCTION WASTE RECORD                           App event (lot / date) ____________
Reason: [ ] Expired [ ] Failed QA [ ] Damaged [ ] Contaminated [ ] Customer return [ ] Other
        [ ] RECALL — STOP: never destroyed by us; vendor return (§4.21, D65)
Owner approval (initials / date) ________   Scheduled by ______  on ________
Product ______________________  Lot __________  Qty ____  Unit ____
Hold ends (from the event; 0 h store setting) ____________

DESTRUCTION DAY  Date ________  Start time ______  End time ______ (Pacific)
Camera covering the spot ____________  recording checked [ ]  (footage kept 45 days)
Units checked against this record [ ]   Packaging removed / labels defaced [ ]
Method:  [ ] Grind + mix ≥50% COMPOSTABLE  (food / yard waste, vegetable grease)
         [ ] Grind + mix ≥50% NON-COMPOSTABLE  (paper, cardboard, plastic)
         [ ] Other method — PRIOR LCB approval attached (ref ________)
Mixed with ______________________  Approx. volume cannabis ____  / mix ____
Result at least 50% non-cannabis by volume  [ ] Yes (both initial) ____ ____
Final destination ______________________  Disposal facility / hauler ______________
Photo taken [ ]  photo reference ________
Hardware (vape / battery) to: ______________________
App: Complete destruction pressed [ ]  "Witnessed by" filled with both names + camera [ ]
Remaining units in lot? ____  → if sellable, lot set back to Active (§4.20) [ ] form 8.5 line [ ]

Performed by (print / sign) ______________________
Witness (anyone on staff, not the performer) (print / sign) ______________________
Filed (month) ________   Keep 5 years (WAC 314-55-097(7)(e), WAC 314-55-087)
```

### 8.4 Recall destruction coordination record (admin; with SOP-05a form 8.5)

```
RECALL DESTRUCTION / RETURN COORDINATION           Recall / withdrawal # ________
Type: [ ] Consumer-safety recall (notify LCB officer IMMEDIATELY)
      [ ] Exempt market withdrawal (notify officer within 48 hours)
Product(s) / lot(s) ______________________________  Qty ____
Lot status is RECALLED in the app and stays Recalled [ ]  Product in sealed bin [ ]

LCB enforcement officer ______________________  Phone / email ______________
Contact 1  date/time ________  by ______  summary ______________________________
Contact 2  date/time ________  by ______  summary ______________________________
Vendor's request received (date / who) ________________  Officer told (date/time) ________
Officer's direction:  [ ] Return to processor (our rule, D65)  [ ] Other → STOP, call owner ________
Agreed date / method ______________________   Officer present?  [ ] Yes [ ] No

Done on ________  Form 8.3 (destruction) # ____ or form 8.2 (return) # ____ attached [ ]
Officer informed of completion (date) ________
Lot set Active and vendor return logged in the same minute at departure (§4.21 step 4) [ ]
Admin signature ______________   Owner signature ______________
```

### 8.5 Cancel and status-restore log (owner; one line per cancel or status put back)

```
CANCEL / STATUS-RESTORE LOG                        Month: ________

Date | Time | Event or lot | Action (cancel / partial-destroy restore / unit re-scheduled) | Status BEFORE | Status set now | Why | Done by | Owner initials
-----|------|------|------|------|------|------|------|------
     |      |      |      |      |      |      |      |
     |      |      |      |      |      |      |      |
     |      |      |      |      |      |      |      |
```

### 8.6 Monthly returns & disposition review (owner, first week of the month)

```
MONTHLY RETURNS & DISPOSITION REVIEW               Month reviewed: ________
[ ] Customer returns this month: count ____  refunds $ ________
    (Returns & Destruction → Recent customer returns; Returns desk receipts)
[ ] Every destroy return has a bin line (8.1) and a completed event, or is still on hold
[ ] No back-office wizard returns this month (D66)  [ ] any found → owner
[ ] Sale corrections: none left pending after the weekly upload (SOP-16)
[ ] Any Sale correction CSV downloaded by hand?  [ ] No  [ ] Yes — uploaded on ________
[ ] Vendor returns: every one has a complete packet (8.2) and status Picked up / in transit
[ ] Destructions: every completed event has a waste record (8.3) with two signatures and a camera reference
[ ] Cancels and status restores (8.5) reviewed
[ ] Hold policy is 0 h (D67)  [ ] Samples: monthly spot check done (§4.26)
[ ] Books: customer refunds total $ ________ given to bookkeeping help (no journal, F-15-14)
[ ] Excise (LIQ-1295): returned sales checked against Box 1 before filing; override used? [ ] Y [ ] N
Owner signature ______________   Date ________
```

## 9. Quick reference cards

### 9.1 Card: customer return (manager)

```
CUSTOMER RETURN — MANAGER CARD
1. Register "Return an item" or Returns desk. Never the back-office
   wizard (owner: remove it).
2. Policy: loyalty member · receipt · within 15 days · original packaging ·
   lot label legible. Any "Refuse the return" message → refuse.
3. Refund is automatic. Cash. Print the refund receipt.
4. Restock only if sealed and perfect. Opened = Destroy.
5. DESTROY → sealed destroy bin NOW → form 8.1 → check a Destruction event
   appeared. The app holds the unit (never sellable) until destroyed.
6. Do NOT press "Download Sale correction CSV" (the weekly file sends it).
7. Any error after pressing the button → STOP, do not retry, call the owner.
```

### 9.2 Card: vendor return (owner / admin / manager)

```
VENDOR RETURN — CARD
1. Owner approves. Processor's written RMA FIRST.
2. Pull units → vendor-return tote → form 8.2 (count twice).
3. Recall? → admin tells the LCB officer first (form 8.4). Never destroy it.
4. App: "Log a vendor return" (RMA #, Detail; Recall: officer + date).
   Units are RESERVED: out of sale, still on hand.
5. Transport details → Download Manifest.CSV → upload to CCRS.
   WE are the origin. No fixed lead time.
6. LCB SUCCESS email + PDF? → Save step. No PDF = no release.
   Print it; it rides with the product.
7. AT DEPARTURE: Record departure (pickup time + driver).
   On-hand comes off and CCRS Other posts NOW.
8. Driver signs 8.2. File the packet 5 years. Cancel = owner only.
```

### 9.3 Card: destruction (two people, on camera)

```
DESTRUCTION — CARD
1. Owner approves. Recall? STOP → never destroyed; vendor return (§4.21).
2. Schedule a destruction (an Active lot goes to Quarantine) → form 8.3.
3. Hold is 0 h (law has none). Product stays in the sealed bin until done.
4. ON CAMERA (check it records; note cam + time). TWO people, the witness
   can be anyone: grind → mix with ≥ equal volume of
   coffee grounds / food / yard waste (compostable) or
   cardboard / paper / plastic (non-compostable). ≥50% non-cannabis.
   Other method only with PRIOR written LCB approval.
5. Into the final destination. Photo. Witness watches.
6. Complete destruction: method · mixed with · 50% tick · final destination
   AND facility · BOTH names + camera in Witnessed by.
7. Units left? The app puts the lot back to its earlier status → form 8.5.
8. Only the owner cancels, with a reason; the app restores the status.
```

## 10. Glossary

| Term | Meaning |
|---|---|
| **CCRS** | Cannabis Central Reporting System, the LCB's traceability system. Greenway uploads weekly files (SOP-16) |
| **InventoryAdjustment** | The CCRS file for changes to stock other than sales: Destruction, Other, Theft, Lost, Seizure, Reconciliation |
| **Sale correction** | The CCRS change to a sale after a return: Delete (whole line) or Update (part) |
| **Disposition** | What happens to product leaving saleable stock other than by sale: restock, vendor return, destruction |
| **RMA** | Return merchandise authorization: the processor's written acceptance of a return |
| **Transport manifest** | The LCB's official document that lets product travel between licensees. The origin (for a vendor return, Greenway) uploads Manifest.CSV to CCRS; the LCB emails back the manifest PDF, which travels with the product |
| **Hold** | The store's waiting time between scheduling and completing a destruction (policy, not law; set to 0 hours, D67) |
| **Quarantine** | Lot status meaning "not for sale, kept aside". Set when a destruction is scheduled |
| **Recalled** | Lot status set by a recall hold; the register refuses it (SOP-05a §4.11) |
| **Rendered unusable** | Ground and mixed so the result is at least 50% non-cannabis waste by volume (WAC 314-55-097) |
| **Compostable mix** | Food waste, yard waste, vegetable-based grease or oils |
| **Non-compostable mix** | Paper, cardboard, plastic waste |
| **Final destination** | Where the rendered waste goes (dumpster, compost) |
| **Disposal facility** | The hauler or facility that takes it (a permitted solid waste or compost facility) |
| **Sealed destroy bin** | The labelled, taped bin in the vault for product waiting to be destroyed |
| **Vendor-return tote** | The labelled bin in the vault for product waiting for a vendor pickup |
| **Market withdrawal** | A recall with no consumer-safety risk; LCB officer told within 48 hours |
| **Advisor** | The AI briefing on this page; advisory only |
| **Trade sample** | Product a processor gives the store for employees only; never sold (WAC 314-55-096(1)(i)); marked **Sample** on the lot; given out on the Employee Samples hub |
| **LIQ-1295** | The monthly cannabis excise tax return to the LCB |

## Appendix A: Source map

| Topic | Source (verified at `main@b8101abb`) |
|---|---|
| Roles | `src/lib/auth/roles.ts` L90, L106, L248; nav `src/components/admin/admin-nav-data.ts` L90 |
| Page | `src/app/admin/inventory/disposition/page.tsx` L61–71 (messages), L97–103 (gates, Active lots only), L124–133 (error and ok boxes), L136–146 (stat cards), L151–166 (correction banner), L168–178 (help), L182–188 (wizard), L193–246 (vendor return), L254–293 (schedule), L301–397 (events), L413–463 (manifests), L476 (recent returns), L507 (advisor), L511–531 (hold), L538 (samples) |
| Actions | `src/app/admin/inventory/disposition/actions.ts` L56–59, L68–105, L117–140, L147–162, L173–187, L197–242, L246–253, L263–274, L283–301, L316–346 |
| Rules | `src/lib/inventory/disposition-core.ts` L32–34, L102–150, L157–174, L180–191, L226–271, L274–298, L304–349 |
| Reasons | `src/lib/inventory/disposition-reasons.ts` L9–10, L16–54 |
| Store | `src/lib/inventory/disposition.ts` L233–282, L289–333, L360, L514, L537–557, L610–617, L700–770, L777, L809–876, L879–904, L939–989, L999–1098, L1100–1116, L1126 |
| Wizard | `src/components/admin/inventory/CustomerReturnWizard.tsx` L24–31, L48, L60, L148–158, L173–174, L185–188, L203 |
| Returns desk | `src/app/admin/registers/returns/page.tsx` L27, L50–64; `registers/returns/actions.ts` L35, L51, L78; `src/components/admin/registers/CounterReturnDesk.tsx` L82, L108, L133, L327, L339–366; `src/app/admin/registers/page.tsx` L84–86 |
| Register | `src/app/(site)/pos/RegisterShell.tsx` L3793, L4210; `src/app/api/pos/returns/route.ts` L49 |
| Return policy | `src/lib/pos/returns-core.ts` L49, L68–71, L146–196, L231–250; `src/lib/pos/returns-store.ts` L252–360 |
| Register lot draw | `src/lib/inventory/sale-lot-read.ts` L44–47 |
| CSV | `src/app/admin/inventory/disposition/sale-correction-export/route.ts` L18–19, L46, L62, L80, L91–93, L104 |
| CCRS | `src/lib/compliance/ccrs-inventory-adjustment-core.ts` L62–90, L201–212; `src/lib/compliance/ccrs-batch.ts` L387, L415, L440–470 |
| Advisor | `src/lib/inventory/disposition-advisor.ts` L19–31; `src/components/admin/inventory/DispositionAdvisorPanel.tsx` L81, L97, L105, L117 |
| Samples | Rule: `src/lib/inventory/sample-lot-core.ts` (Phase 0.2). Samples branch: `src/lib/inventory/intake-parser.ts` L438, L448; `src/lib/inventory/intake-store.ts` L876, L1100, L1368–1388, L1843; `src/lib/compliance/trade-samples.ts` L335–340, L391–395; `src/app/admin/compliance/samples/actions.ts` L37–38; `src/lib/compliance/ccrs-preflight-core.ts` L182. Not filtered: `src/lib/inventory/catalog-drafts.ts` L239, L370–373; `src/lib/inventory/sale-lot-read.ts` L41–47; `src/app/api/pos/menu/route.ts` L179–181, L405–409. Filter: `src/components/admin/inventory/InventoryFilterPanel.tsx` L369–376 |
| Money and books | `src/lib/pos/refunds-store.ts` L11, L48; `src/lib/accounting/ledger-census-data.ts` L252–268; `src/lib/compliance/excise-return.ts` L111, L140–158; `src/lib/accounting/sage-exports.ts` L644–698 |
| Database | `supabase/migrations/0042_*.sql` L22–36, L44, L47–66, L100–120; `0115_*.sql` L38, L94–101, L104–109 |
| Compliance basis | `docs/RETURNS_DESTRUCTION_COMPLIANCE.md` §3 (L99–127; L120–124 miscites the plant table, F-15-18), §4 (L131–142), §5 (L146–216). State texts read 2026-10-28 (v1.1): WAC 314-55-079, -083, -085, -087, -096, -097, -225 (app.leg.wa.gov); CCRS Upload User Guide 2-26 (Tables 4 and 5); CCRS Manifest User Guide 10-27-2025; LCB CCRS FAQ. CCRS register U-72, U-73 (`docs/ccrs-bible/12-unverified-register.md` L74–75) |
| Concierge / help | `src/lib/admin/concierge-kb.ts` L66, L176; `src/lib/admin/help-content.ts` L465–467 |
| Related SOPs | SOP-01 §4.23; SOP-05a §4.6–§4.13, forms 8.1, 8.4, 8.5; SOP-06; SOP-16 (deferred, D69); SOP-20 |

## Appendix B: Not built yet (interim procedures)

> **Living SOP reminder (D41).** The owner: *"We will eventually build and fix everything, so leave a reminder that I want to update the sop when necessary."* When a gap below is built, update this SOP in the same piece of work: the named sections, this table, Appendix D, the findings ledger (FIXED) and the concierge entry (D42: *"I want to upgrade the concierge to use all features including future ones we will build after the sop is finished."*).

| Gap | What is missing | Findings | Interim procedure | Sections to update when built | Status |
|---|---|---|---|---|---|
| **G-42** | State-exact vendor return (D63): **Log** reserves the units (status *awaiting departure*, out of sale) without reducing on-hand; the reduction and the CCRS **Other** adjustment (detail: processor, manifest, RMA) post only at **departure**; RMA, manifest number, processor license and detail required; vendor linked; an **outgoing Manifest.CSV builder** (Greenway as origin: driver, vehicle, departure/arrival, lot rows) for the owner to upload; step labels "Manifest uploaded" and "LCB success email and PDF received"; checklist without the 48–72 h and Mon/Wed/Fri lines; server-checked step order with who and when; Pacific times; reason Recall needs the officer contact recorded | F-15-1 (**S1**), F-15-2, F-15-3, F-15-19 | Log only at departure (§4.10–§4.11), form 8.2 | §2, §3, §4.2, §4.9–§4.13, §4.21, §8.2, §9.2 | **BUILT** (Phase 1.5; migration 0309 to apply) |
| **G-43** | Hardened destruction record: witness required (any second person, not the one completing; D64), a **camera reference** (camera name and start/end time; D64), approval reference for **Other method**, on-hand checked at scheduling, Pacific times in messages, printable destruction log (form 8.3 in the app). The recall contact-date part is dropped (recalls are not destroyed, D65) | F-15-4, F-15-5, F-15-12, F-15-21 | Form 8.3 with two signatures and the camera (§4.17–§4.18) | §2, §4.15–§4.18, §5.3, §8.3, §9.3 | **APPROVED** (D64) |
| **G-44** | Customer-return segregation: a destroy-return unit goes to a **returned / quarantine** bucket that is never sellable (a separate quarantine lot or a held quantity); the return, the add-back and the destruction event saved together or not at all | F-15-6 (**S1**), F-15-7 | Sealed destroy bin, form 8.1 (§4.7) | §1 box, §4.2, §4.3, §4.7, §5.1 | **BUILT** (Phase 1.4; migration 0308 to apply) |
| **G-45** | **Remove** the back-office Customer return wizard (D66); the CSV download checks the ledger like the weekly batch or is removed | F-15-8, F-15-10 | Register / Returns desk only (§4.4–§4.6); no CSV (§4.8) | §1, §2, §4.1, §4.4–§4.8, §5.1, §8.6, §9.1 | **APPROVED** (D66) |
| **G-28** (extended) | Returns & Destruction handles held lots: lists Quarantine lots for destruction; lists **Recalled** lots for a **vendor return** (not destruction, D65) and keeps them Recalled until departure; **Cancel** restores the earlier status and requires a reason (owner only); a partial destruction restores the lot's earlier status | F-05a-17, F-05a-18 (**S1**), F-05a-19, F-15-9, F-15-11 | §4.19–§4.22, form 8.5 | §2, §4.15, §4.19–§4.22, §5.3 | **BUILT** (Phase 1.3); Recalled lots listed for a vendor return in Phase 1.5 (G-42) |
| **G-25** | Recall plan and event log in the app, linked to the destruction or vendor return of the recalled lots | F-05a-15, F-05a-16 | Form 8.4 + SOP-05a form 8.5 | §4.21, §8.4 | OPEN |
| **G-23** | Theft and Seizure as adjustment reasons | F-05a-6 | SOP-05a §4.7 "THEFT:" / "SEIZURE:" note | §4.23 | **APPROVED** (D39) |
| **G-22** | No manual **Destroyed** on the lot page | F-05a-1 (**S1**) | SOP-05a §4.9 | §4.3 | OPEN |
| **G-46** | Error codes shown as words: the page shows *"qty"* / *"reason"* instead of a sentence | F-15-13 | §4.15 last paragraph | §5.3 | PROPOSED |
| **G-47** | Remove the legacy **Sample-pricing rules** panel and its `sample_settings` code (dead; D68), in the same piece of work as G-51 | F-15-16 | Do not rely on it (§4.26) | §2, §4.26 | **BUILT** (Phase 0.2) |
| **G-50** | Destruction hold default 0 (D67): `HOLD_HOURS_DEFAULT` 0, the panel text says the law has no hold, the stale migration comment corrected (with G-49) | F-15-17 | Owner/admin sets **Hold (hours)** to 0 (§4.27) | §4.3, §4.16, §4.27, §9.3 | **APPROVED** (D67) |
| **G-51** | **Samples never reach the menu or the register** (D68): no product draft is seeded for a lot marked Sample; the register menu, barcode index and lot draw skip sample lots; the website never lists them; a test for each; the intake review shows "Sample — goes to the Employee Samples hub" | F-15-20 (**S1**) | Dismiss sample drafts; weekly Sample check (§4.26) | §4.26, §6, §7, §8.6 | **BUILT** (Phase 0.2) |
| **G-48** | Returns in the books and taxes: draft a journal for each refund day to 50910 Returns & Refunds for owner approval; excise Box 1 reduced by returned sales in the month | F-15-14, F-15-15 | Form 8.6; excise override (§4.24) | §4.24, §8.6 | PROPOSED |
| **G-49** | Housekeeping: correct the migration comment and the reasons-file header; the help panel says which file carries the Sale correction | F-15-17 | Read this SOP | §4.1, §4.27 | PROPOSED |

## Appendix C: Open questions for the owner

**All six were answered by the owner after v1.0** (recorded verbatim in `00-OWNER-REQUEST-VERBATIM.md`, decisions D63–D68). Kept below for the record, with the answer.

| # | Question | Why it matters | Recommendation (v1.0) → **Answer** |
|---|---|---|---|
| Q-15-1 | **Vendor returns: may we change the app so logging a return only reserves the units, and the stock comes off at pickup?** (G-42) | Today the stock comes off the moment it is logged, before the LCB confirms the manifest | Yes → **D63**: follow the state's method; Greenway files the manifest as origin; stock comes off at departure |
| Q-15-2 | **Who may witness a destruction?** This SOP says the manager, the admin or the owner, never the person doing it. Is a budtender acceptable as the second person when only one manager is on? | The law asks for records, not a witness; the witness is a store control (§2 rule 2) | Manager, admin or owner only → **D64**: anyone may witness; always on camera |
| Q-15-3 | **Recalled lots: when G-28 is built, should a recall destruction be possible in the app only after the admin records the officer, the contact date and the officer's direction?** | Today we keep recalls out of the app (§4.21) | → **D65**: treat a recall as a transfer back to the vendor |
| Q-15-4 | **Should the back-office Customer return wizard be removed, or kept as an owner-only exception tool?** (G-45) | It bypasses the store policy and takes a typed refund | → **D66**: remove it |
| Q-15-5 | **Keep the destruction hold at 72 hours?** | It is policy, not law; it gives time to catch mistakes | Keep 72 hours → **D67**: the legal minimum, 0 hours |
| Q-15-6 | **Sample-pricing rules: enforce them at the register and online, or remove the panel?** (G-47) | Today they do nothing | → **D68**: the panel is dead legacy, remove it; build the real register and menu exclusion (G-51) |

## Appendix D: Revision history

| Version | Date | Change | By |
|---|---|---|---|
| 1.5 | Fix phase | Phase 1.5 (owner D76, D63, D65). G-42 BUILT: **Log a vendor return** reserves the units (`held_qty`, migration 0309 `reserve_vendor_return`) instead of reducing on-hand; RMA, vendor, numeric processor license and detail are required; Recalled lots are listed and need reason Recall with the LCB officer and contact date. The app builds **Manifest.CSV** (Greenway as origin, the LCB template's 21 header rows and 13 item columns, `manifest_413541_YYYYMMDDHHMMSS.csv`). Steps go one at a time on the server (Manifest uploaded → LCB success email and PDF received → Departed), each stamped with who and when, Pacific times; **Record departure** reduces on-hand, releases the reserve and posts the CCRS Other adjustment (processor, license, manifest, RMA) in one step (`depart_vendor_return`). Owner-only **Cancel return** (`inventory.vendor_return.cancel`) releases the units. The 48–72 h / Mon-Wed-Fri checklist line is removed (activation guard step 7). F-15-1, F-15-2, F-15-3, F-15-19 FIXED. One thing to know item 1, Part 3, §2, §3, §4.2, §4.10–§4.13, §4.21, §5.2, §6, §7, form 8.2, card 9.2 and Appendix B updated. | Fix program |
| 1.4 | Fix phase | Phase 1.4 (owner D76, D62). G-44 BUILT: a customer return marked Destroy holds its units on the lot (`inventory_lots.held_qty`, migration 0308): on hand and in CCRS, never sellable (register draw, register menu, register stock, manual adjustment, vendor return and other destructions all respect the hold). The return, the add-back, the hold and the destruction event are one database step (`record_customer_return`); before 0308 the old writes are undone on any failure. Completion consumes the held units; an owner cancel releases them and says so. F-15-6 and F-15-7 FIXED. §1 item 2, §4.2, §4.3, §4.7, §5, §6, card 9.1 and Appendix B updated. | Fix program |
| 1.3 | Fix phase | Phase 1.3 (owner D76). G-28 BUILT with D65: **Schedule a destruction** lists Active and Quarantine lots with their status and never Recalled; the Recall reason is gone; scheduling refuses Recalled, Sold out and Destroyed lots, moves only Active to Quarantine (compare-and-set) and keeps the earlier status on the event (migration 0307); **Complete destruction** is refused while the lot is Recalled; a partial destruction puts the lot back to its earlier status; **Cancel** is owner-only (`inventory.destruction.cancel`), needs a reason, restores the earlier status only Quarantine → Active and only if it was Active, never touches a customer-return lot, and is audited with before/after; the activation guard checks every lot-status write on this page is compare-and-set. Summary, §2, §4.2, §4.3, §4.15, §4.19–§4.22, §5.3, §6, card 9.3 and Appendix B updated. F-05a-17, F-05a-18, F-05a-19, F-15-9, F-15-11 FIXED. | Fix program |
| 1.2 | Fix phase | Phase 0.2 (owner D76). G-51 BUILT: samples never get a draft, cannot be approved or staged, are never drawn by a sale, never count as register stock or barcodes, never move menu stock, and a void never restocks onto them (`sample-lot-core.ts` and callers). G-47 BUILT: the legacy Sample-pricing panel, its action, `get/updateSampleSettings` in `disposition.ts` and `sample-guardrails.ts` removed; concierge line corrected. §4.26 rewritten; §6, §7 and checklist updated. F-15-16 and F-15-20 FIXED. | Fix program |
| 1.1 | 2026-10-28 | Owner answers D63–D68 applied after the state texts were read (WAC 314-55-079, -083, -085, -096, -097, -225; CCRS Upload and Manifest User Guides) and the samples branch was audited end to end: vendor returns follow the CCRS manifest method with Greenway as origin, logged at departure (§3, §4.9–§4.13, form 8.2, card 9.2); witness anyone, on camera (§2, §4.17–§4.18, form 8.3, card 9.3); recalls returned to the vendor, never destroyed by us (§4.21, form 8.4); wizard not used, to be removed (§4.6); hold 0 h (§4.3, §4.27); samples section rewritten with the audit and an interim check (§4.26). New findings F-15-18…F-15-21; G-42, G-43, G-45, G-47 APPROVED; new G-50, G-51 | SOP program |
| 1.0 | 2026-10-28 | First draft, verified against `main@b8101abb`. Owner decision D62 applied (with D37, D39, D41, D42). Findings F-15-1…F-15-17 and F-15-C; gaps G-42…G-49 proposed and G-28 extended; questions Q-15-1…Q-15-6. Paper forms 8.1–8.6 | SOP program |
