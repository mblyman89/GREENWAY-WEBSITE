# Slice: customers-table-enterprise

## The request (verbatim)

> Thank you. All customer data has now landed in our customer table. I would like you to expand the table so it shows more details, every important piece of data should be shown on the table. I want the contact column to be phone and email separated. I want this table to be very useful and powerful. Please enhance the table to be of enterprise grade quality. Push and merge the work. Follow the standing rules. Thank you!

## What was there before

`/admin/customers` showed seven columns: Name (with the old Customer ID), **Contact** (the email, or the phone when there was no email, so one of the two was always hidden), Medical, Group, Visits, Total spent and Last purchase. It had a search, three yes/no filters (medical, consent, do not contact), a Sort menu with eight orders and a fixed 100 rows per page. There was no way to download the list.

## What changed

1. **Phone and email are separate columns.** Phone is formatted `(360) 555-0123` and taps to call; email taps to write. Both sort from their headings.
2. **Every important field is in the table** (21 columns in seven groups; the default view shows 16, the rest are one click away under **Columns**):

   | Group | Columns |
   | --- | --- |
   | Who | Name (opens the profile; *Do not contact* tag), Customer ID (old POS), Birthday / age (age today on the Pacific calendar; **under 21 in red**; 🎂 when the birthday is this week) |
   | Contact | Phone, Email, Marketing (consent + do not contact) |
   | Medical | Medical (🩺 plus the best recognition card on file: valid to / expires in N days / expired / revoked), Tax designation (e.g. Veteran) |
   | Loyalty & groups | Loyalty (points balance, tier from lifetime points, inactive accounts marked; "Not enrolled" otherwise), Group (RFM segment) |
   | Spend | Total spent (Greenway + old POS, with the split), Spent here, Old POS spent |
   | Visits & dates | Visits, First visit, Last purchase (here or old POS), Customer since (old POS Date Created, else the day added here) |
   | Record | Source (Old POS import / Website loyalty signup / Register signup / Added by staff), Staff note (shortened, full text on hover), Added here, Last updated |

3. **Click any sortable heading to sort; click again to reverse.** The arrow and `aria-sort` show the active order. The Sort menu grew from 8 to 26 orders (existing links keep working), including *Longest since last visit*, *Age: oldest first*, *Customer since*, *Recently updated*.
4. **More filters:** has phone / no phone, has email / no email, tax designation, where the record came from, and birthday month (for birthday promotions), on top of medical, consent and do not contact. A badge says how many filters are on; **Clear search & filters** resets them.
5. **Table controls:** rows per page (25 / 50 / 100 / 250), Comfortable / Compact density, a column picker grouped by topic (Default columns / Show all), a sticky header row, a sticky Name column and horizontal scroll so wide views stay readable.
6. **Six at-a-glance tiles:** total customers, loyalty members, medical patients, marketing consent, how many have a phone / an email (with the share), do not contact. The tiles link to the matching filtered list.
7. **CSV / Excel download of exactly what is on screen** (same search, filters and sort; every column; all pages; up to 50,000 rows), at `GET /admin/customers/export`. Money is real currency in Excel and dollars in CSV; dates are Pacific days.

Everything is in the URL (`?q=&sort=&medical=&consent=&dnc=&phone=&email=&tax=&source=&bmonth=&size=&density=&col=&page=`), so any view can be bookmarked or shared, and the page needs no client JavaScript.

## Rules it follows

- **Untrusted URL in, validated state out.** `parseCustomerTableParams` whitelists every sort key, filter value, page size, density and column; garbage means "off", never an exception. Filters reach the database only as pure ops over a fixed set of columns (`customerFilterOps`).
- **PII stays in the building unless a manager takes it.** Viewing needs `customers.manage` (unchanged). Downloading also needs manager, admin or owner (`canExportCustomers`; the route answers 403 otherwise and the buttons are hidden). Every download is written to the audit log as `customers.exported` with the format, row count, sort, the filters that were on and whether a search was used. The search text, names, phones and emails are never logged.
- **Deliberate database reads.** The loyalty and card reads name their columns (`customer_id, balance_points, lifetime_points, is_active`; `customer_id, status, expires_on`), are chunked (150 ids per request), and read every `{error}`: a failed side read shows a plain-English warning above the table instead of silent blanks. The list itself now reads its `{error}` too: a sort on a column whose migration has not run (42703 / PGRST204) says so in plain English, anything else goes through `dbErrorForStaff` (42501 included). No new tables or functions, so the DB contract is unchanged and **no migration is needed**.
- **One figures rule.** Visits, spend and last purchase (G-75, Slice 3) come from `tableFigures` in the core, used by both the screen and the download, so the file always matches the table.
- **Money in cents** until display; **Pacific time** for every day shown or exported; birthdays are calendar labels (no time-zone shift).

## Files

| Area | File |
| --- | --- |
| Pure rules + self-tests | `src/lib/customers/customer-table-core.ts` (`__runCustomerTableCoreTests`, floor 150 in `scripts/compliance/run-pure-selftests.ts`) |
| Sort menu | `src/lib/admin/list-filter-core.ts` (`CUSTOMER_SORTS`, new orders appended) |
| List read | `src/lib/customers/store.ts` (`listCustomersPaged` / `searchCustomers` take the filter ops and report errors) |
| Side reads, tiles, download | `src/lib/customers/customer-table-store.ts` |
| Page | `src/app/admin/customers/page.tsx` |
| Download route | `src/app/admin/customers/export/route.ts` |
| Tests | `tests/compliance/customer-table-core.test.ts`, `tests/compliance/list-filter-core.test.ts`, `tests/compliance/g75-customer-search.test.ts` |

## How it is tested

1. **Pure core:** 163 embedded assertions (column registry, every heading sort exists in `CUSTOMER_SORTS`, URL round-trip and garbage fallback, filter ops, phone / age / leap-day / birthday-week, card status including "active past its expiry counts as expired", source labels, export row in cents and Pacific days, PII-free audit, the manager-only rule, the shared figures rule).
2. **Vitest:** the core again plus wiring pins (phone and email cases on the page, no `email || phone`, the route's role check + 403 + audit, explicit side-table columns and error reads).
3. **Typecheck, lint and the build** on the changed files; CI runs the full suite.
