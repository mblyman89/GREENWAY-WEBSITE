# Recon — register transaction history search (owner bug report)

**Reported:** "On the register, when I open transaction history, I am unable to use the search bar. I tried typing in it and pressing enter, that did not do anything. I also tried scanning a receipt, that also did not do anything."

**Method:** traced the full path — UI (`src/app/pos/RegisterShell.tsx`, `ReturnsModal`), API (`src/app/api/pos/transactions/route.ts`), store (`src/lib/pos/transaction-history-store.ts`), pure core (`src/lib/pos/transaction-history-core.ts`). No guesses; every claim below cites a line.

---

## Headline

The two symptoms have **two different causes**. They are not one bug.

Critically, the pure search function `searchTransactions` is **correct and well tested** — 10 assertions pass in the existing self-tests. The defect is entirely in the wiring around it. This is why the feature looked fine in review and fails at the counter.

---

## Defect 1 — the receipt box has NO Enter key handler (this is the "pressing enter did nothing")

`RegisterShell.tsx:3525-3540` — the "Receipt number" input:

```tsx
<input
  value={receipt}
  maxLength={8}
  onChange={(e) => { setReceipt(e.target.value.toUpperCase()); ... }}
/>
```

There is `onChange`. There is **no `onKeyDown`**. There is no wrapping `<form>` anywhere in the file (`grep -c "<form" = 0`), so there is no implicit submit-on-Enter either.

Pressing Enter in that box does **literally nothing**. The only way to trigger a lookup is tapping the "Find" button beside it.

## Defect 2 — the same missing handler is why SCANNING does nothing

This is the important one, and it is not obvious.

A hardware receipt scanner is a **keyboard wedge**: it "types" the barcode and then sends **Enter**. That is its entire contract.

So a scan into the focused receipt box does this:
1. Types the 8 characters → `onChange` fires → state fills correctly.
2. Sends Enter → **nothing is listening** → no lookup.

The characters actually land in the box. Nothing happens next. From the counter this looks like "scanning is broken", but the scan worked perfectly — the system simply never acted on it.

Worse, the two document-level wedge listeners that *would* have caught it deliberately stand down over form fields, and correctly so:

- `SaleFlow.tsx:1636` — `if (tag === "INPUT" || ...) return;`
- `SaleFlow.tsx:2702` — `if (tag === "INPUT" || ...) return;`

That guard is right (manual typing must keep working). But it means **no other code will rescue the Enter**. The handler has to be on the input itself.

## Defect 3 — the search box cannot find a product, despite advertising that it can

Placeholder (`RegisterShell.tsx:3402`): `"Search name, receipt, item or staff"`.

`searchTransactions` (`transaction-history-core.ts:268`) does search product names:

```ts
return r.items.some((i) => i.toLowerCase().includes(q));
```

But `shapeTransaction` (`transaction-history-core.ts:241`) truncates that array **before it ever reaches the client**:

```ts
items: names.slice(0, HISTORY_ITEMS_PREVIEW),   // HISTORY_ITEMS_PREVIEW = 3
moreCount: Math.max(0, names.length - HISTORY_ITEMS_PREVIEW),
```

`HISTORY_ITEMS_PREVIEW` is 3 (`:68`). The truncation is intentional and correct **for display**, but the same field is the only thing search can see. On a 7-item basket, items 4-7 are unsearchable. Searching for a product that is genuinely on the receipt returns "Nothing matches" — which reads as a broken search bar.

Note the existing self-test at `:461` passes only because its fixture has ≤3 items. The test is right; the fixture never exercises the boundary.

## Defect 4 — search only ever covers 50 rows, and the user is not told

Three separate caps compound (`transaction-history-store.ts`):

| cap | value | line |
|---|---:|---|
| `LOOKUP_WINDOW_DAYS` | `RETURN_WINDOW_DAYS + 2` = **17 days** | `:55` |
| `EVENT_SCAN_LIMIT` | **400** events scanned | `:62` |
| `TRANSACTION_HISTORY_LIMIT` | **50** rows returned | `:233` |

The API takes **no query parameter at all** (`route.ts:47` — `listRecentTransactions()` with no arguments). All searching happens **client-side, over those 50 rows only**.

At Greenway's volume 50 rows is roughly half a day. So searching a customer who came in yesterday returns "Nothing matches" even though the sale is well inside the 15-day return window and is perfectly returnable.

This is the most damaging one for the owner's actual use case, and it is invisible: the UI gives no hint that it only looked at 50 records.

---

## What this means for the fix

- Defects 1 and 2 are one missing `onKeyDown` on the receipt input — small, high value, fixes scanning.
- Defect 3 is a shape problem: search must see all item names while display keeps the 3-item preview. Add a separate searchable field rather than widening the preview (widening it would change the UI and leak more product data onto a counter-facing screen).
- Defect 4 needs server-side search: pass the query to the API so the database filters across the whole 17-day window instead of the client filtering 50 rows.

The privacy budget (`route.ts:22-26` — "Jane D.", no contact details) and the single-refund-path rule (`route.ts:14-20` — this endpoint is a *finder*, never a money mover) must both survive the fix.
