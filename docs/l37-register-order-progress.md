# L-37 — Moving online orders along from the register (and never going to the office)

**For:** Michael and the counter team
**What changed:** the iPad register can now **Confirm** an online order and **Mark it ready for pickup**. When the customer pays at the register, the order is **marked picked up automatically**. The back-office **Online Orders** dashboard now **refreshes itself** whenever anything happens at the register. All of this works the same for Greenway website orders and Leafly orders.

---

## 1. Update the register from your MacBook Pro (do this once for this change)

This change includes new buttons on the register screen, so the iPad app has to be rebuilt once. Server-side changes (the dashboard, Leafly and the automatic pick-up) go live on their own through Vercel.

1. Open **Terminal** and go to the project:
   `cd ~/greenway`
2. Pull the latest code:
   `git pull`
3. Build the register app:
   `REGISTER_API_BASE="https://greenwaywebsite1.vercel.app" npm run register:build:ios`
4. Open it in Xcode:
   `open ~/greenway/ios/App/App.xcworkspace`
5. Plug in the iPad and unlock it (tap **Trust** if it asks). At the top centre of Xcode, pick the iPad, then press **▶** (Run).

**If something goes wrong**

- `command not found: cap` → run `npm install`, then repeat step 3.
- **"Build stopped"** → read the message just above it. The pre-flight check tells you exactly what is missing (usually the `REGISTER_API_BASE` line was left off).
- You only need to rebuild when the **register screen itself** changes. Everything else deploys automatically.

---

## 2. What the counter sees

Open the **Online orders** queue on the register and tap an order. Above the ID check there is now a **progress bar** with four steps:

| Step | How it happens |
|---|---|
| **Placed** | Automatically, when the customer orders |
| **Confirmed** | Tap **Confirm order** |
| **Ready for pickup** | Tap **Mark ready for pickup** once it's bagged |
| **Picked up** | **Automatic** when the register sale completes |

- Only the next sensible button is active. On a new order, you can tap **Confirm order** or skip straight to **Mark ready for pickup**. On a confirmed order, only **Mark ready** is active.
- Orders only move **forward**. The register can't send an order backwards. If you really need to go back, a manager can do it from the back office.
- Any budtender can use these buttons (no manager PIN). They don't move money or release product. They're the same one-click step the back office already has, and they're recorded under the budtender's name and the iPad's name.

### Why there is no "Picked up" button

Slice 17 made the **register sale** the only way to hand over an order, because that's where the real ID scan happens (21+, expiry, acceptable ID). A "Picked up" button would reopen the checkbox shortcut we removed. So picked up happens by itself when you **Start handover — scan ID → take payment → complete the sale**.

---

## 3. What happens automatically when the sale completes

When a register sale that was loaded from an online order finishes:

1. **The register sale is the sale of record.** Revenue, excise, sales tax, CCRS, the day ledger, inventory and loyalty points are all counted **once**, on the register sale.
2. **The online order closes itself** and shows **"Picked up (register)"** on the Orders dashboard and the order page. The customer's own confirmation page shows **"Picked up"**.
3. **Leafly orders:** Leafly is told the customer has the order (`picked_up`). If Leafly was still at "confirmed", the system sends "ready" first, because Leafly doesn't allow skipping steps. This happens in the background, so it never slows down the register.

### Why the online order doesn't also say "Completed" in the database (the double-count guard)

Every report (revenue, excise, CCRS, WA sales tax, the ledger, loyalty, inventory) counts orders with the status **completed**. The register sale is already a completed order. If the online order were *also* marked completed, the same bag of product would be counted **twice**: double revenue, double excise, double CCRS and double points.

So the online order is closed with the **non-revenue** status underneath, plus a clear note that starts with **"PICKED UP AT THE REGISTER"** and names the iPad, the budtender and the register sale number. Every screen reads that note and says **"Picked up"**, never "Cancelled". This is the same non-revenue close the system has always used for register pickups; the difference now is that it's labelled honestly.

For Leafly, the order of operations matters and is enforced. **Our copy is closed first, then Leafly is told.** When Leafly confirms "picked up", its own sync would normally mark our copy "completed". Because ours is already closed as a register pickup, the sync recognises the note and leaves it alone. You get no second sale and no false alarm.

---

## 4. The Online Orders dashboard keeps itself fresh

The back-office **Orders** page already checked for new orders every few seconds to ring the chime. It now also checks whether **any** order changed: confirmed, marked ready or picked up at the register, a Leafly update, a cancellation, and so on. When something changes, the page **reloads its data automatically**.

- The little status line now reads **"Watching for new orders and register updates…"**.
- If you're **typing** (a note, a search box), it waits until you're done, so it never wipes what you're entering.
- You no longer need to refresh the page to see what the counter did.

---

## 5. Leafly behaviour, in detail

| At the register | What Leafly is told |
|---|---|
| **Confirm order** | `confirmed` |
| **Mark ready for pickup** (from new) | `confirmed`, then `ready` (one step at a time) |
| **Mark ready for pickup** (from confirmed) | `ready` |
| **Sale completes** | `ready` if needed, then `picked_up` (in the background) |

- **Leafly is told first; ours moves second.** If Leafly refuses a step, nothing local changes and the register says why.
- If Leafly accepts "confirmed" but refuses "ready", our order moves to **confirmed only** (exactly as far as Leafly got), and the register says where it stopped.
- If Leafly hasn't **acknowledged** the order yet (normally automatic within a minute or two), the register asks you to wait or acknowledge it on the back-office board. Leafly rejects status changes before that.
- If telling Leafly "picked up" fails after a sale, the sale is still complete and paid. A loud audit entry is left so a manager can finish it from the back-office Leafly board.

---

## 6. Audit trail (back office → Audit log, `/admin/audit`)

| Action | Meaning |
|---|---|
| `order.advanced_at_register` | Confirm / Mark ready from the register succeeded (who, which iPad, from → to, what Leafly said) |
| `order.register_advance_failed` | It was refused, with the reason |
| `order.picked_up_at_register` | The register sale completed and closed the online order |
| `order.leafly_picked_up_pushed` | Leafly was told `picked_up` (and any steps walked on the way) |
| `order.leafly_picked_up_failed` | Leafly couldn't be told. Finish it from the back-office Leafly board |
| `order.supersede_on_complete_failed` | (unchanged) the online order couldn't be closed after the sale |

---

## 7. How it was tested

- **Pure logic** (`src/lib/pos/pickup-progress-core.ts`): 51 self-test assertions (forward-only rules, Leafly step-walking, labels, the picked-up note). Dashboard refresh logic: 72 assertions in `new-order-watch-core`.
- **Real route and store with fakes at the edges** (`tests/compliance/pickup-register-progress.test.ts`, 21 tests):
  - Only "confirm" and "ready" are accepted; picked-up and completed are refused.
  - The retired checkbox route still answers 410.
  - Website orders move with one step.
  - Leafly is walked `confirmed → ready`, and a partial Leafly refusal moves ours only as far as Leafly went.
  - Unacknowledged, unlinked and final Leafly orders are refused before anything is sent.
  - The picked-up push walks `ready` first and never throws.
  - The sync closes the order before telling Leafly, and screens say "Picked up".
- **Mutation checks:** 10 bugs were planted deliberately (for example "allow backwards moves", "refresh while typing", "jump straight to picked_up", "move ours past where Leafly stopped", "drop the picked-up note", "customer page says Cancelled"). **All 10 were caught.**
- Existing register and Leafly suites (pickup one-door, L-36 cancel, bridge wiring, L-31 lifecycle and others) still pass.
