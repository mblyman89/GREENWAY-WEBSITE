# L-40: Greenway orders and Leafly orders, two identical panels

## What you asked for

> "I want the leafly section to look identical to our section above it. our
> orders section should be labeled greenway orders, and the leafly section
> remains labeled leafly orders. but the search bar and sort and filters
> should look and behave identically … our system auto acknowledges leafly
> orders, so there is no 15 minute limit we need to obey … so I want to
> remove the leafly section moving above our section."

## What you will see now

The Orders page shows two boxed panels, always in the same order.

1. **Greenway orders**: orders placed on our website.
2. **Leafly orders**: orders placed on Leafly.

Both panels are drawn by **the same piece of code**. They can't drift apart,
because there is no second copy to drift. Each panel has:

- a header with its name and a short line underneath;
- its own four number cards: **New, Preparing, Ready, Active total**. Each
  number counts only the orders in that panel;
- the same status tabs: **Active, New, Acknowledged, Preparing, Ready,
  Completed, Cancelled, No-show, All**. Each tab shows a small count of how
  many orders it holds (this is new);
- the same filter row: **Search** ("Name, phone, order #"), **Placed from**,
  **Placed to**, **Total min $**, **Total max $**, **Sort by**, **Apply**,
  and **Clear** (Clear appears once a filter is on);
- the same order count and page arrows at the top, and again at the bottom
  when there is more than one page;
- the same "No orders match this view" message when nothing matches.

Each Leafly order row looks like one of ours. It has the same status pill
(Preparing, Ready…), the same step bar along the bottom, the customer and
items line, and a **Details** link to the Leafly details page. The details
pages are unchanged.

## What was removed

- **Leafly no longer jumps above our orders.** The old rule moved the Leafly
  section to the top, with a gold banner, whenever a Leafly order hadn't been
  accepted yet. That rule and its banner are gone. Greenway is always first
  and Leafly always second.
- **No more "15 minutes" wording** on the Leafly panel, in the page's help
  box, or in the "took too long to load" message. The Leafly panel now says
  *"Each one is accepted automatically the moment it arrives."*
- The old Leafly-only controls (Show / Sort / Find, and the "Accept now / To
  build …" groups) were replaced by the shared controls above.
- The page no longer runs a separate database count of "Leafly orders waiting
  to be accepted". Its only job was deciding whether to move the panel. That
  is one less database read every time the page loads.

## Safety nets that were kept on purpose

- **If automatic acceptance ever fails**, that Leafly row itself shows
  *"Not accepted automatically"* with its timer. You see it on the order,
  where you are already looking.
- **If someone switches automatic acceptance off** (the
  `LEAFLY_AUTO_ACKNOWLEDGE` setting), the panel says so in its header
  instead of still claiming orders are accepted automatically.
- **If your filters would hide a Leafly order that needs a person**, a line
  above the list says so. This is the same guarantee as before, now working
  with the new tabs.
- The warnings for "never announced / never printed / never reached the
  register", register cancellations, load failures and button outcomes are
  all still shown in the Leafly panel.
- **"Picked up (register)"** now also shows on a Leafly order that was
  collected at the register. The same single lookup covers both panels.
- If the shop ever has more than 200 recent Leafly orders, the panel says it
  is showing the most recent 200. It won't present them as everything.

## How the two panels stay out of each other's way

- Each panel remembers its own view in the web address. Ours uses the
  addresses it always has (`status`, `q`, `sort` …), so old bookmarks still
  work. Leafly's use the same names with an `l` in front (`lstatus`, `lq`,
  `lsort` …).
- Pressing a tab, **Apply**, **Clear** or a page arrow in one panel leaves the
  other panel's filters exactly as they were. The page also scrolls back to
  the panel you were using.
- A status word typed wrongly into the address now simply means **Active**.
  Before, it could produce an empty list.

## How it was checked

- **One shared rule book** (`order-panels-core`) holds the tabs, the web
  address format, how a Leafly order maps onto our status words, searching,
  sorting, paging and counting. It has **94 self-checks**, which run in the
  compliance pipeline on every deploy with a floor of 88.
- **A new test file** (`orders-panels-l40.test.tsx`, 27 checks) renders both
  real panels and compares them field by field: labels, tabs, placeholder,
  sort options, the Apply button, the cards and Clear. It also checks that
  the Leafly tabs and search really filter, that one panel's links keep the
  other panel's view, that there is no "15 minutes" wording, and that the page
  renders Greenway then Leafly, once each.
- **The tests were tested.** I deliberately broke the real code in 13
  realistic ways and confirmed each break turned the tests red. Examples:
  swapping the panel order, renaming a panel, letting the Leafly search box
  clash with ours, putting the 15-minute wording back, showing unfiltered
  Leafly rows, and dropping the other panel's view from a form. A harmless
  "control" edit to a comment was correctly *not* flagged. The code was
  restored after every break.
- **Nine older tests** described the old layout (the promotion, the old
  Leafly controls, the page-level cards). Each was updated to state the new
  rule, with a note saying why. None was simply deleted. The retired
  promotion logic took 22 of its own self-checks with it. The board-order
  self-check floor was lowered from 48 to 32 (measured 35), with the reason
  written next to it. An old mutation script that only tested the removed
  promotion was retired.
- Type check, lint, all pure self-tests and the full test suite pass.

## What did not change

- Leafly's own rules, the webhook, automatic acceptance, the sweeper, the
  register and both details pages.
- No database migration.
