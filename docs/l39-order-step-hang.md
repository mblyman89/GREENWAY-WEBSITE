# L-39 — Order step button "hangs" between steps (fixed)

## What you saw

On one of **our own online orders** you press the button that moves the order
to its next step (for example **Mark Preparing**). The order does move, but
the thin progress bar at the top keeps spinning until the 5-minute limit, and
the button won't respond again until the bar resets.

## Why it happened

The back office has a helper called the *pending keeper*. It shows the
progress bar while a form is saving, and it blocks double presses so the same
action can't fire twice. It stops the bar in one of three situations:

1. the page moves to a new address,
2. the button that was pressed disappears from the page, or
3. the button turns itself off (disables itself) while it saves.

If none of these happens, it waits for the 5-minute safety limit.

The order-status buttons save and then refresh the **same page, at the same
address, in place**. The same button stays on screen with a new label (for
example "Mark Preparing" becomes "Mark Ready"). They were plain buttons that
never disabled themselves. So none of the three situations happened: the bar
spun for the full five minutes, and the form stayed marked "busy", which made
the keeper's double-press guard swallow your next press.

We reproduced this in a real Chrome browser with real clicks before we
changed anything (`scripts/recon/l39-status-hang-probe.mjs`). The "before"
run showed the bar still spinning, the form still marked busy, and the second
press ignored. The "after" run showed all three fixed.

## What changed

Every button on the order page that saves in place is now the same
**SaveButton** we already use on the Announcer settings. It is the existing
pattern, not a new one. While its own save is running, the button:

- turns itself off (so a second press can't fire the action twice),
- shows a small spinner and a "…ing" label (**Saving…**, **Cancelling…**,
  **Completing…**, **Reopening…**), and
- turns itself back on the moment the save finishes. That is situation 3
  above, so the top bar stops at the same moment.

This covers the forward step button, **Complete with logged override**,
**Cancel**, **No-show**, **Reopen as …**, and **Save note**. The buttons look
the same as before: same colours and same sizes.

**Extra value:** we found the same hidden trap on the **Detach card** button in
the medical section. When a detach fails, it also refreshes in place. That
button now uses SaveButton too (it shows **Detaching…**).

We checked the other buttons on the page and did **not** change them, because
they already stop the bar correctly: **Reroll name** and the loyalty and
customer buttons move to a new address with a confirmation message, and
**Attach card** always either moves to a new address or disappears.

## How it's protected

`tests/compliance/order-detail-pending.test.ts` has 17 checks. They pin:

- the keeper behaviour the fix relies on,
- that these actions really do refresh in place,
- that no plain submit button remains on the order page (only Reroll name,
  whose action is checked to redirect),
- that all six forms use SaveButton with a busy label, and that the sizes are
  unchanged, and
- the medical Detach button.

To confirm the checks work, we deliberately broke the code 11 ways: removing
the disable, the busy flag and the ellipsis, putting a plain button back,
changing the size, adding redirects, and dropping the `.gitignore` entry.
Every one was caught.
