# Slice 17 — One door out: a pickup is handed over through a real sale, or not at all

**Requested by:** Michael Lyman, Greenway Marijuana, Port Orchard WA.

> "I also want to change how register treats online orders. Right now I open the
> order, and it gives me the option to complete the sale right there in that
> screen, or add the order to the register cart to add more items. I want this
> to be the only option. The latter requires going through the age gate scan id
> feature. The former is just a check box. I don't like that. Please remove that
> option."

The instinct behind that request is exactly right, and the code confirms it in
detail. There were two ways to hand a customer their online order, and the two
ways did not check the same things. One of them ran the real age gate. The
other one asked the budtender to tick a box. This slice removes the box.

Everything below was established by reading the code in this repository. There
are no database credentials in the environment this work was done in, so
nothing here rests on a live query, and nothing here rests on a guess. Every
claim carries the file and line that supports it, and every fix carries the
test that fails when the fix is removed.

## The two doors, and the exact difference between them

The pickup modal in `src/app/pos/RegisterShell.tsx` rendered two actions side by
side. The first was a button reading "Complete pickup — $X cash". It was enabled
by a condition that included `idConfirmed`, and `idConfirmed` was a plain React
checkbox in that same modal. Nothing else stood behind it. The second was a
button reading "Load into a sale", which called `loadIntoSale()`.

On the server, the completion route's entire age check was one line. In
`src/lib/pos/pickup-core.ts:164` it read:

    if (!input.idConfirmed) errors.push(…)

That is the whole of it. A boolean arrived in a JSON body and the server
believed it. The value was produced by a checkbox, and a checkbox is a claim,
not a check. It carries no birthdate, no expiry date, no document type and no
record of what was actually looked at. If it was ticked out of habit at the end
of a long shift, nothing in the system could tell afterwards.

The other door is a different thing entirely. `src/lib/pos/id-scan-core.ts` is
the real gate. It parses the AAMVA PDF417 barcode on the back of the licence,
computes age with `ageOn` against `MINIMUM_AGE_YEARS = 21` (RCW 69.50.357),
rejects expired documents through `isExpired`, restricts the document to
`ACCEPTABLE_ID_TYPES` (WAC 314-55-150), keeps an audited manual-entry path for
the cases where a barcode genuinely will not read, and layers the house rules on
top: anyone who looks under 40 is always scanned, and a vertical licence is
always scanned. That is a verification. The checkbox was an attestation.

## Why loading into a sale really does force the gate

This is the part worth proving rather than assuming, because the owner's whole
request depends on it being true.

When an order is loaded, `onLoaded` in `RegisterShell.tsx` (around line 1758)
sets `setResumeSnapshot(null)` and then `setSaleActive(true)`. The sale screen
is rendered with `initialVerdict` supplied at `RegisterShell.tsx:1131`, and that
prop is only ever `resumeSnapshot?.verdict ?? undefined`. Because the snapshot
was just cleared, a freshly loaded order always arrives with `initialVerdict`
undefined. `src/app/pos/SaleFlow.tsx:453` then decides the opening step:

    const [step, setStep] = useState<Step>(initialVerdict ? "cart" : "idgate");

With no verdict, the sale opens on `idgate`. There is no path around it. So the
route the owner wants to keep is, structurally and not merely by convention, the
route that runs the scan.

It also loses nothing. `loadOrderIntoRegister` in `src/lib/pos/pickup-store.ts`
carries the same order-status checks and the same POS-materialisation gates the
completion path had. Removing the completion path removed a bypass, not a
protection.

## What was actually done, and why it went further than the button

Deleting the button would have satisfied the letter of the request while leaving
the hole open. The completion route was an HTTP endpoint. Anything holding
device credentials could have gone on calling it long after the button was gone,
and the next person to build a screen against that API would have found a
sale-completing endpoint sitting there looking supported. The capability had to
close, not just the control that reached it.

So `POST /api/pos/pickup` no longer completes anything. A request carrying a
`complete` payload is answered `410 Gone` with a message that names the route
that replaced it. The refusal is decided by the new pure module
`src/lib/pos/pickup-handover-core.ts`, and it keys on the **shape** of the
request rather than the value inside it — `"complete" in body`. That detail
matters: a guard written as `if (body.complete.idConfirmed !== true)` would have
let a request through by sending `idConfirmed: false` and would have refused for
the wrong reason. The refusal happens before employee, drawer or money
validation, so the endpoint never does any of the work that would imply the
route still exists.

The message the customer-facing side shows and the message the API returns are
the same exported constant, `CHECKBOX_HANDOVER_RETIRED_MESSAGE`, so the two can
never drift into telling a budtender two different stories.

`completePickupAtRegister` was then deleted from `src/lib/pos/pickup-store.ts`
outright rather than left unused. An unused export that completes sales is a
bypass waiting for a future caller.

In the modal itself, the checkbox, the cash-tendered input, the change and
count-back display and the "Complete pickup" button are gone. What remains is a
short warning that the customer's ID is scanned next, and a single button:
**Start handover — scan ID**.

## One consequence worth stating plainly: the drawer

The old completion path printed its own receipt and popped its own cash drawer
from inside `RegisterShell`. That call is gone with it. The drawer still opens
on a completed sale — it always did, from `src/app/pos/SaleFlow.tsx:1090-1091`,
which prints with `{ html, openDrawer: true, jobKind: "sale" }`. A pickup now
finishes through the same tender path as every other sale in the building, which
means one receipt, one drawer pop, and one place where cash is recorded.

The printer compliance test in `tests/compliance/pos-star-printer.test.ts` used
to assert the pickup modal's duplicate pop by name. It now asserts the surviving
call site in `SaleFlow`, which is strictly stronger, because that is the one
every cash sale actually goes through. That new assertion was checked by turning
`openDrawer` off and confirming the test goes red.

## How this was verified

`src/lib/pos/pickup-handover-core.ts` is pure and self-testing: 21 assertions,
run in CI by `scripts/compliance/run-pure-selftests.ts`.

`tests/compliance/pickup-one-door.test.ts` holds 12 tests that drive the **real**
route handler through `vi.resetModules()` and a dynamic import. Its mock of
`pickup-store` deliberately omits `completePickupAtRegister`, so if anything ever
reintroduces that call the suite fails on a missing function rather than passing
against a convenient fake. One test asserts through `vi.importActual` that
`"completePickupAtRegister" in store === false` — the deletion itself is now a
tested property.

The tests were then proven capable of failing. Six mutations were applied to the
shipped source, one at a time, and every one was caught: keying the guard on
`idConfirmed`'s value instead of the request shape (3 failed), removing the guard
(4 failed), moving it after body validation (2 failed), stripping the
instruction out of the message (11 failed), breaking the load route (2 failed),
and sanctioning a second handover route (2 failed). The source was restored and
confirmed byte-identical afterwards.

Type-check is clean, ESLint reports zero problems on every touched file, and the
full suite passes at 568 files and 14,342 tests.

## What a budtender sees now

Open the pickup queue, open the order, and there is one button. Press it and the
order loads into a sale that opens on the ID gate. Scan the customer's licence.
Add anything else they want while you are there. Take payment through the normal
tender screen. The order stays open until that sale completes, so an abandoned
handover leaves the order where it was rather than marking it collected.

One door. It is the one with the scanner on it.
