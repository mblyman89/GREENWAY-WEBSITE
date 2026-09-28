# Leafly: fixing "Change items" (L-49, L-50) and daily-sync honesty (AS-1)

Michael — this covers the three slices built together to close out the Leafly branch.

## What your SQL showed

All five "Change items" attempts on 2026-09-28 came back from Leafly as **HTTP 400** with the body `{"error":"Bad Request","status":400}`. Each one was a single-line **substitution**: the same cart line, switched to a different product size. On order 64dc8d35, for example, the original size was `62784764934810737-onboarded` at $25.00, and the new ones were mostly `pos-…` sizes.

Leafly's order specification says a cart change is refused when the new size isn't in Leafly's catalog for your store, or is out of stock there. Leafly's 400 reply gave no reason at all; it only said "Bad Request". Our screen then blamed the problem on our own request. Two things were wrong:

1. The screen didn't tell you what Leafly actually said, or that it said nothing.
2. The size picker offered sizes Leafly never received. It built its list from our own menu feed, without running it through the menu builder that decides what is sent to Leafly. That builder leaves some sizes out, for example when no weight can be read from a label such as "Each" on a flower product.

## L-49: honesty, call history, and a check before sending

- **Plain-English 400.** A refused cart change now says Leafly refused it, gives the spec's reasons (product/size not in Leafly's catalog for this store, out of stock, or quantity/price below 1), and warns that retrying sends the same refused cart. If Leafly sent no reason, the screen says so ("Leafly returned only its generic error phrase and no reason").
- **"What we sent Leafly, and what Leafly said (last 5)".** A fold-out on each Leafly order page (both the order page and the Leafly order page). It shows each call's time (Pacific), what we sent and, for errors, what Leafly replied. Customer details are never shown: a reply containing names, phones, emails, addresses or birthdates is hidden. Successful replies are hidden too, because they contain the customer.
- **Evidence download.** The evidence spreadsheet gains an "Order API calls" sheet (up to 500 calls) under the same privacy rules. The privacy audit now also checks inside saved JSON text.
- **Live cart when the editor opens.** Opening "Change items" first re-reads the order from Leafly (up to 8 seconds). After a substitution, Leafly gives the line a new id, and an old id would be refused. If Leafly can't be reached, the editor says it is showing our last copy.
- **Check against Leafly's own catalog (sandbox).** Just before sending, we read Leafly's copy of your menu (up to 6 seconds). If the new size isn't there, or shows 0 in stock, **nothing is sent**, and the screen names the product and says: *Send your menu to Leafly (Leafly page → Send now), wait about 3 minutes, then try again, or choose a different product.* The attempt is still recorded in the call history. If the read fails or times out, the check steps aside and never blocks you.

## L-50: the picker only offers sizes Leafly can have

The "Change items" picker, on the dashboard and at the register, now lists and accepts **only sizes that are in the menu we actually send to Leafly**. It works that out with the same build the automatic sync and "Send my whole menu, hold back only the bad ones" use: the same pickup and medical settings, the same held-back products, and your saved automatic size-repair choice. If that build can't run, it falls back to the plain menu builder. A size the builder leaves out is no longer offered. If one is chosen some other way, it is refused *before* sending, with "not on the menu we publish to Leafly". A small note says how many sizes were left out for this reason.

## AS-1: the daily full send always goes out, and the labels tell the truth

- **Daily send.** The daily full sync no longer skips on "nothing changed". It now sends your whole passing menu every day: as a full replacement when nothing is held back, and as an update when something is, so held-back products are never deleted from Leafly. This keeps Leafly's catalog fresh, which means fewer cart refusals. The between-times updates still skip when nothing changed. A day only skips if nothing on the menu can be sent at all.
- **Connection health card (Leafly page).**
  - "Last successful sync" now reads **"Last menu sent to Leafly"**.
  - A new **"Last automatic check"** line shows when the schedule last ran, whatever it decided.
  - If automatic syncing is on and Leafly hasn't received your menu in over 26 hours, an amber line says *"Leafly hasn't received your menu in over a day"*.
  - The Weedmaps card is unchanged.

## How to pass the "Change items" test

1. On the Leafly page, press **Send now** (or wait for the daily send), then wait about 3 minutes.
2. Open an acknowledged, pending pickup order and choose **Change items**. The editor loads Leafly's live cart.
3. Either **remove one line from a two-line order** (the simplest; removals don't depend on the catalog), or **swap to a size from the picker**. The picker only offers sizes Leafly has been sent. If Leafly's copy is behind, the pre-send check will tell you to send the menu first.
4. If Leafly still refuses, open the **"What we sent Leafly, and what Leafly said"** fold-out. It shows exactly what was sent and Leafly's reply, ready for Ben.

No database migrations were needed.
