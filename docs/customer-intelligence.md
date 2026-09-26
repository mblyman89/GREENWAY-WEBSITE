# Customer intelligence (Slice 3)

This document explains what the customer tracking feature measures, where every number comes from, and how it is tested. It is written for the owner first and for developers second.

## 1. The bug this slice fixed

Every customer showed **0 visits and $0 spend** even when they clearly had purchases. The cause was simple: nothing in the system ever updated `customers.visit_count`, `customers.lifetime_spend_minor_units` or `customers.last_visit_at`. On top of that, the Cultivera import had written each customer's lifetime spend from the *old* POS into `lifetime_spend_minor_units`, so the few non-zero numbers were not ours.

Migration `0232_customer_rollups.sql` fixes this at the database level, so there is exactly one definition of a visit and of spend:

- A **visit** is an order linked to the customer (`orders.customer_id`) whose status is `completed`. This is the same revenue basis every report uses (`src/lib/reports/revenue-basis.ts`).
- **Spend** is the sum of those orders' totals minus refunds recorded in `customer_returns`, never below zero.
- **Last visit / first visit** use `coalesce(completed_at, placed_at)`.
- A voided sale ends `cancelled`, so it drops out automatically. An online order collected at the register ends `cancelled` too, and the register sale becomes the sale of record, so nothing is counted twice.
- Triggers on `orders` (insert, delete, and updates to status, customer, total or dates) and on `customer_returns` keep the figures current. A register loyalty attach, which sets `customer_id` after the sale is inserted, is caught by the update trigger.
- The old-POS figure moves to `customers.imported_spend_minor_units`. It is copied exactly once, in the run that creates the column, so a re-run can never overwrite it. The importer now writes to that column.
- `select * from customer_rollup_audit();` returns any customer whose stored figures disagree with a fresh recompute. Zero rows means all is well.

Until the owner runs 0232, every page calculates the same four facts directly from orders (`rollupsFromRows`) and shows a note saying the migration is pending.

## 2. Connecting history that was never linked

Online orders placed by a customer before they were linked, or placed with the same phone or email without being logged in, are invisible to their profile. The profile now lists **possible matches**: unlinked website and Leafly orders whose phone (last ten digits) or email matches the customer exactly after normalization. When such an order was collected at the register, the register sale that replaced it is what gets linked, because that is the sale of record. Nothing is linked until a staff member with both `customers.manage` and `orders.manage` ticks it. The link only fills an empty `customer_id` (it can never take an order away from another customer), refuses to run if any read was incomplete, writes an order event and an audit entry, and the trigger updates the figures immediately.

## 3. What the customer profile shows

Research into what major cannabis and retail CRM platforms track (Alpine IQ, Sweed, Headset, Springbig, Klaviyo) shows the same core: recency, frequency and monetary value; preferences by category, brand and product; purchase rhythm; and a clear next step. The profile page follows that pattern and adds a few things those tools do not do from the shop floor.

**Headline numbers.** Visits, net spend (with refunds shown), average order and items per visit, and last visit with days since. The customer's group (for example *Champions* or *At risk*), their spend rank (for example *Top 5%*), age verification, medical status and marketing consent appear as badges. Old-POS spend is shown for reference but never mixed into our numbers.

**Next best action.** One recommended action chosen from a fixed priority order: restock a staple they are due for that is out of stock, win back a lapsing regular, birthday, loyalty enrolment, unredeemed points, an expected visit, or connecting unlinked orders.

**What we know.** Plain-English observations, each tagged Good, Watch, Risk or Note. Examples: spend trend against the previous 90 days, brand loyalty, deal sensitivity, typical potency, and basket habits such as "often buys Edibles + Flower together".

**Visit rhythm and next visit.** The median number of days between their visit days, a confidence level (low below 3 gaps, medium from 3, high from 6), the expected next visit date, and a status: on track, due now (from 80% of their usual gap), overdue (past 125%), or lapsed (past 250%, or 180 days). Customers with one visit use the shop's typical gap, clearly labelled.

**Favourites.** Top categories, brands, vendors, products and strain types, ranked by share of their spend, with units and number of visits. Register lines carry no brand, so brand, vendor, strain and THC come from the published menu. Keypad "custom" lines count toward money but never toward favourites.

**Shopping style.** Price level compared with the category median on the menu, share of items bought on a deal, median THC, and categories per visit.

**Their staples.** Products bought on two or more different days, the usual gap between purchases, when they are next due, and current stock status.

**Suggest next.** Up to six in-stock menu items that match their favourite categories, brands and strain types, each with the reason it was chosen.

**Trends and habits.** Monthly spend and visits, favourite weekday and time of day, how they buy (in store, website or Leafly, including online orders collected at the register), every online order's outcome, returns and reasons, and a loyalty summary.

**Recent purchases.** The latest twelve completed purchases, each linking to the order.

## 4. What the customer insights dashboard shows

`/admin/customers/insights` (CRM → Customer Insights) looks at the whole customer base.

**How much of the business we can see.** The share of completed sales in the last 90 days that were tied to a customer. Every insight depends on this, so the page says plainly what to do when it is low.

**Base numbers.** Buyers, repeat rate, customers active in the last 90 days, typical time between visits, spend per customer, total linked spend, and the share of spend coming from the top 20% of customers.

**Customer groups (RFM).** Every buyer gets a score of 1 to 5 for recency, frequency and spend relative to other customers (mid-rank quintiles, so ties are handled fairly). The scores place them in one of ten groups (Champions, Loyal, Can't lose, At risk, New, Potential loyalist, Big spender, Needs attention, About to sleep, Lost). Each group has a one-line meaning, a recommended action, and a list of members by spend.

**Due back this week.** Repeat customers whose own rhythm says they are expected within seven days.

**Win-back list.** Regulars who are more than 25% late against their own rhythm but not yet 2.5 times their usual gap (and within 180 days), which is the window where outreach works best. Each row shows whether the customer may be contacted: *Do not contact* and missing consent are clearly marked.

**Stock watch.** Products that regulars buy repeatedly over the last year, how many regulars rely on each, how many of those are the most valuable customers, how many are due to want it within 14 days, and stock status. Sold-out or low-stock staples that valuable or due customers rely on are flagged **Reorder now**.

**What the best customers love.** For the best group (Champions, Loyal and Can't lose, or the top 20% by spend when that group is empty), each brand's and category's share of their spend against everyone's share. A lift above 1.2 means the best customers buy notably more of it; protect that shelf space.

**Top customers by spend.** The 15 most valuable relationships.

## 5. How confident the numbers are

RFM groups are relative, so they are unstable in a small base. The dashboard labels its confidence: early below 50 buyers, building from 50, solid from 200. The profile explains that favourites firm up after about five visits and that the rhythm prediction needs at least three visits of the customer's own. Any read that stops early is named on screen, so a short list never poses as the whole truth.

## 6. Files

| Area | File |
| --- | --- |
| Migration | `supabase/migrations/0232_customer_rollups.sql` |
| Database scenario check | `scripts/recon/customer-rollups-pg-check.sql` |
| One customer (pure) | `src/lib/customers/customer-insights-core.ts` |
| Whole base (pure) | `src/lib/customers/customer-segments-core.ts` |
| Server loaders | `src/lib/customers/customer-insights-server.ts` |
| Charts | `src/components/admin/customers/CustomerCharts.tsx` |
| Display blocks | `src/components/admin/customers/InsightBlocks.tsx` |
| Profile page | `src/app/admin/customers/[id]/page.tsx` |
| List page | `src/app/admin/customers/page.tsx` |
| Dashboard | `src/app/admin/customers/insights/page.tsx` |
| Link action | `src/app/admin/customers/actions.ts` (`linkCustomerOrdersAction`) |
| Tests | `tests/compliance/customer-intelligence.test.ts` |
| Mutation check | `scripts/recon/customer-intelligence-mutation-check.sh` |

## 7. How it is tested

1. **Database.** All 232 migrations apply to a clean PostgreSQL 15 database and 0232 re-applies cleanly. `customer-rollups-pg-check.sql` runs 20 scenarios inside a rolled-back transaction: a ready order not counting, completion, the placed-at fallback, first visit, unlinked and late-linked sales, relinking and unlinking, a refund being added, edited and deleted, a void, a total change, the zero floor, a deleted order, audit drift and repair, and function privileges. A separate run confirmed the Cultivera figure is preserved exactly once and survives a re-run.
2. **Pure cores.** 130 embedded assertions for one customer and 109 for the whole base run in the pure self-test runner with floors of 125 and 105.
3. **Vitest.** `customer-intelligence.test.ts` re-checks the cores with numbers worked out by hand, checks that the fallback fold matches the migration's rules, pins the migration text and importer behaviour, and checks that each page, action, nav entry and runner registration is wired.
4. **Mutation check.** `customer-intelligence-mutation-check.sh` makes deliberate mistakes in the fold, migration, importer, cores, pages, action, nav and runner, and requires the tests to fail for every one.
