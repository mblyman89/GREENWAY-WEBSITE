# Nav reorg + enrichment helper box — TODO (DONE)

## Verbatim request (owner)
> thank you, before we move on, please add the green helper box at the top of the page with useful tips to the products enrichment page. next I want to create a new tab drop down at the top of the page called "CRM", that comes before product intake. and in it it will have, customers and loyalty program. I want to move the reports page to have its own top header button. I dont want it to be a drop down, just a button for getting to the reports. this button should come before CRM. please move equipment to the admin dropdown. to the right of the inventory dropdown, I want to be Website. please move media library to the top of the list and then under it put site content. lets stop there with those changes, ill inspect, then we can move on to the next set of reorganizing.

## Slice plan
- [x] 1. Green "Enrichment helpers" section moved to TOP of `/admin/products` (above back-link + stage strip).
- [x] 2. Added `"CRM"` to `AdminNavItem["group"]` union + `navGroups`, before "Product Intake".
- [x] 3. Customers (`/admin/customers`) + Loyalty Program (`/admin/loyalty`) moved into "CRM". "Loyalty" (`/admin/loyalty-signups`) left in Sell.
- [x] 4. "Reports" made a standalone direct-link top-header button (DIRECT_LINK_GROUPS in AdminTopNav), before "CRM". AI Usage stays in "Insights".
- [x] 5. "Equipment" moved from "Inventory" into "Admin".
- [x] 6. `navGroups` reordered so "Website" comes immediately after "Inventory".
- [x] 7. "Media Library" relocated from Marketing into Website at TOP; "Site Content" directly under it.
- [x] 8. Verify: tsc ✓ → eslint ✓ → next build ✓ → rm -rf .next ✓.
- [ ] 9. Ship: branch `feat/nav-crm-reorg`, commit, push, PR, squash-merge --admin, sync main.

## Design decisions (documented, no guessing)
- Reports stays an `adminNav` item in its OWN group `"Reports"`; renderer's `DIRECT_LINK_GROUPS` set makes it a direct `<Link>` tab (desktop + mobile) instead of a dropdown. Keeps data-driven single source of truth.
- AI Usage stays in "Insights" (now single-item). Not moved — user didn't ask; removing Insights would be a guess.
- "top of the page" for green box = first element inside content `<div space-y-6 px-5 py-6>`, above back-link + stage strip.

## Final navGroups order
Sell, Reports (direct link), CRM, Product Intake, Inventory, Website, Compliance, Finance, Marketing, Insights, Admin
