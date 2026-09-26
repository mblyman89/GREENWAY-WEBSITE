# Online Orders report — how it works and what was fixed

Page: **Admin → Reports → Online Orders** (`/admin/reports/online-orders`)

## What was wrong (audit findings)

The old page showed, for example, **23 orders** but **$33,700.00** order value, "avg $3,744.44 over 9". Three separate defects combined to produce that:

1. **Leafly money was 100× too high.** Leafly's Order API sends every amount (`total`, `subtotal`, `tip`, `totalDiscounts`, `taxes[].amountCents`) as whole **cents**. The report ran those numbers through a parser meant for dollar amounts, so 3370 ($33.70) became $3,370.00. $33,700 over 9 orders is really about **$337 over 9**, an average of about $37.44. The report also preferred `totalWithTip`. The register collects `total`; the tip goes to Leafly, not the till. The report now reads `total` and shows tips on a separate line.
2. **Only Leafly orders were counted.** The page read `leafly_orders` only, so our own website orders were missing entirely.
3. **Only 9 of 23 Leafly orders had a total. This was a data-loss bug in the webhook.** Every Leafly webhook (submit, status change, cancel) wrote its body into `leafly_orders.raw_order`. A status or cancel message is a small envelope with no money, so it overwrote the full order we had collected. Leafly only serves an order for 24 hours after it finishes, so that stored copy is the only one we have. **Fix:** only `order_submit` can write `raw_order` now (`webhookMayWriteRawOrder`). Status changes are still recorded in their own columns.

**Historical rows cannot be repaired from Leafly**, because they are older than 24h. For those orders the report uses the total of the copy that was rung up at the register. If neither exists, the total is **left out and counted as "unknown"**, never guessed. The page shows how many Leafly totals came from each source.

## What the page shows now

**All online orders (website + Leafly)**
- Totals and money: order count, known order value ("X of Y orders have a known total"), average, median and largest order, value picked up.
- Outcomes: pickup rate, cancellations, no-shows.
- Customers and baskets: unique customers, repeat customers, customers who used both channels, items per order.

**Other sections**
- **What stands out:** plain-English findings. They only appear when both channels have data.
- **Per-channel cards:** Website and Leafly side by side.
- **Head-to-head table:** 17 measures, with the better channel highlighted ▲.
- **Charts:**
  - orders per day (stacked by channel);
  - value per day;
  - channel share donuts;
  - outcomes per channel;
  - orders by hour of day and by weekday (Pacific time).
- **Top products** for each channel.
- **Discounts, loyalty, tips and tax**, plus where the Leafly totals came from.
- **Leafly integration health:** the earlier contract sections (15-minute clock, acknowledgement speed, whether the customer heard back, announce/print, outbound calls). They are now labelled "Leafly…". Each lifecycle rate says what it is out of ("of N acknowledged").

## Definitions

- **Website order:** a row in `orders` with origin `greenway` that is **not** a register sale. Register sales are identified by `pos_client_uuid`, or by a staff note starting "POS sale —". Leafly's local copies (origin `leafly`) are not counted here, because Leafly orders are counted from `leafly_orders`. Counting them in both places would double them.
- **Picked up:** website `completed`, or an online order closed at the register. Those are stored as "cancelled" with a "PICKED UP AT THE REGISTER" event, and they count as picked up, not lost. For Leafly: `picked_up`, or its local copy was completed or picked up at the register.
- **Lost to the 15-min clock:** Leafly auto-cancelled it (`order_api_unacknowledged`). It is counted separately from customer cancellations.
- **No-show:** website `no_show`, or Leafly cancel reason `not_picked_up`.
- **Rates** (picked up, cancelled, no-show) are out of **finished** orders. Open orders are left out until they finish.
- **Known value** means money is summed only over orders whose total we know, and averages divide by that same count.
- **Customers** are matched by phone (last 10 digits) or email, then **hashed** on the server. No contact details reach the page.

## Code map

| Piece | File |
|---|---|
| Both-channel math (pure) | `src/lib/reports/online-orders-channels-core.ts` |
| Leafly contract math (pure) | `src/lib/leafly/online-orders-report-core.ts` |
| Database reads (paged) | `src/lib/leafly/online-orders-report-server.ts` |
| Charts | `src/components/admin/reports/OnlineOrdersChannelCharts.tsx` |
| Page | `src/app/admin/reports/online-orders/page.tsx` |
| Webhook gate | `webhookMayWriteRawOrder` in `src/lib/leafly/webhook-parse-core.ts` |
| Tests | `tests/compliance/online-orders-all-channels.test.ts` |
| Mutation check | `scripts/recon/online-orders-all-channels-mutation-check.sh` (26/26 killed) |
