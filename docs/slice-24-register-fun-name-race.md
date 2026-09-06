# Slice 24 — the register's fun receipt name lost a race, and now it doesn't

## What the owner saw

Slice 23 put the fun receipt name on both channels. Michael tried it once, in
the order a real shift would: he placed a website order first, and the
confirmation screen and the emailed receipt both showed the fun name, exactly as
intended. Then he walked to the register, rang up a walk-in sale, and printed the
receipt. The printed slip showed the real receipt number.

Reported verbatim: *"the printed receipt did not print the fun overlay, it used
the real receipt number instead."*

No error appeared anywhere. That silence is the second half of the defect and is
dealt with below.

## Ruling things out, from evidence

The first plausible story was a deployment gap. Michael had pulled and rebuilt
the iPad app before Vercel had finished promoting the production build, so the
new `POST /api/pos/order-name` route might simply not have existed yet on the
server the app calls. That story was wrong, and one observation killed it: the
printed receipt carried a **QR code**. The QR renderer, `src/lib/printing/qr-core.ts`,
is new in the same commit as the fun-name work and renders entirely on the
device — `receipt-core.ts` performs no `fetch` and has no `async` in it at all.
A printed QR therefore proves the iPad was running the new bundle.

The server side was proved healthy the same way. Migration 0221 was applied by
hand and confirmed. The website's fun names were working, and those come from
`orders-store.ts` calling `assignNextPoolName()` — the same `assign_order_name()`
function, against the same `order_name_pool` table, through the same store
module the register endpoint uses. A broken migration, a missing function, a bad
grant or an empty pool would have taken the website down with it.

New client plus healthy server plus one broken feature leaves exactly one
suspect: the single thing the register does that the website does not.

## The actual cause

The website claims its name **server-side, inside the request that inserts the
order**. By the time the confirmation page renders, `display_name` is already a
column on the row. Nothing can race it.

The register cannot do that. It is a separate device, so it has to ask over
HTTP. Slice 23 asked at the wrong moment:

- `SaleFlow.tsx` fired `requestFunName()` when the **tender screen opened**.
- It read the answer out of a ref a moment later, when the sale was **paid**.

Nothing waits in between, and on real hardware that gap is tiny:

1. A quick-tender chip (`onClick={() => onTender(c.amountMinor)}`) carries the
   cash amount straight into the tender screen, so the budtender's very next tap
   is *Pay*. Two taps, not two seconds.
2. The packaged iPad app is served from `capacitor://localhost` and calls an
   `https://` origin, so every request is cross-origin. The browser must
   complete a **CORS preflight `OPTIONS` round-trip before the `POST` is even
   sent** — two round-trips, not one.
3. `/api/pos/order-name` is `force-dynamic` and performs a scrypt device
   verification plus an advisory-locked database function before it can answer.

When the ref was still `null` at payment, `receipt-core.ts` did what it was
written to do — `const codeCaption = funName || receiptNo` — and printed the real
number. That fallback is correct and deliberate for the offline case the owner
asked for, which is precisely why it produced no error and no clue.

## The fix

**Ask early.** The draw now happens when the **first line lands in the cart**,
not at tender. That converts a sub-second budget into however long it takes to
ring up a sale. The rule lives in a pure module rather than inline in a
five-thousand-line component, because a decision buried in a component cannot be
tested and quietly rots:

`src/lib/pos/order-name-prefetch-core.ts` — `shouldRequestName()`,
`normalizePrefetchedName()`, `canFillLateName()`, `prefetchStatusNote()`,
36 self-tests.

`shouldRequestName()` tests `cartLineCount > 0` rather than `=== 1` on purpose.
A resumed hold and a loaded website order both seed a multi-line cart in a single
step, and an `=== 1` test would silently never fire for either — the same class
of bug this module exists to end.

**Ask once.** Every draw permanently consumes a name from the rotation and pulls
the next repeat closer, so emptying and refilling the cart, stepping back from
tender, or a re-render must never draw a second name. The existing
`funNameRequestedRef` guard is now enforced through `shouldRequestName` and
pinned by tests.

**Say something when it fails.** The Slice 23 defect cost a live shift precisely
because it failed silently. The "Sale complete" screen now shows a quiet line
when the pool could not be reached, so the cause is a glance rather than an
investigation. Being *offline* deliberately stays silent: it is the documented,
expected fallback, the register already shows a prominent offline indicator, and
a second complaint about a known state trains staff to ignore the footer.

**`onPaid` stays synchronous.** No network round-trip was added between the
customer handing over cash and the drawer opening, and none ever should be.

## The late-arrival trap, and why the guard is so narrow

The obvious extra safety net is to paste a late-arriving name onto the frozen
receipt just before printing. Writing that revealed why it is mostly wrong.

`onEnqueue("sale", payload)` runs **before** the receipt is frozen, and the
register's offline queue is **append-only until the server durably ACKs**. There
is no amend API, by design — an append-only ledger is what makes offline sales
trustworthy. A reprint months later rebuilds from that stored payload via
`receipt-reprint-core.rebuildReceiptFromPayload`.

So a name pasted onto the receipt after the enqueue would print on the customer's
slip while the recorded sale carried no name at all, and the reprint would show
the real receipt number instead. Two different receipts for one sale is a
traceability defect, and strictly worse than the cosmetic problem it was solving.

`canFillLateName()` therefore refuses unless the **same name already went into
the queued payload** (`payloadCarriedName`), the receipt has not been printed or
emailed, and it is not overwriting a name already present. Printing *and*
emailing both latch the snapshot closed, because an emailed receipt is committed
to a customer just as firmly as a printed one. The real fix is asking early; this
guard is an honest narrow backstop, not a rescue.

## Verification

Three mutations were applied and each was caught, which is the only way to prove
the tests actually run rather than trusting a silent pass:

| Mutation | Result |
| --- | --- |
| `cartLineCount > 0` → `> 1` | 2 failures, including the Slice 24 trigger pin |
| `if (state.alreadyPrinted) return false;` → disabled | 1 failure — "a printed receipt is closed forever" |
| `return state.payloadCarriedName;` → `return true;` | 2 failures — the append-only queue pins |

All three were reverted and the suite re-confirmed green.

- `tsc --noEmit` — 0 errors
- `eslint` — 0 problems
- Pure self-tests — `ALL PURE SELF-TESTS PASSED`
- Full suite — **573 files, 14,548 tests passed**

## What Michael needs to do

Rebuild and reinstall the iPad app once this is merged and Vercel has finished
promoting the production build. The fix is entirely in the register bundle plus
the shared pure module; no migration and no configuration change is involved, and
there is no setting to switch on.
