# Nav reorg (round 2) — TODO (DONE)

## Verbatim request (owner)
> thank you. now lets remove the ccrs benchmarks from the product intake dropdown, and decommission it. the reports page and leads page are now fully wired up to give me all the data I need. unless that page is meant for something else I am unaware of. to the right of the website drop down, I want the tab dropdown to be called, "MKTG & ADV". in it will be marketing and advertising, then promotions, then blog and newsletter, then newsletter send (please change name to be email newsletter), then midjourney (rename to image generator). then to the right of mktg and adv, I want the next tab drop down to be, "Employee". in it will be, time clock, then payroll (ACH) (drop the ach part please), then trade samples. to the right of employee drop down, I want the next drop down to be called, "Medical". it will have, medical (rename to patient records), then authorization intake. then, to the right of medical, the next tab button should be "CCRS", it will just be a button linked to compliance health. the "sell" tab, please rename to "Dashboard", in it should be orders (rename to online orders), then loyalty signup. I dont need the dashboard button because I realized that the greenway word mark links to the dashboard. lets stop there when you are done for me to inspect. please use your best judgement, if an old existing tab dropdown no longer has options in it, remove it. please follow the standing rules and dont guess. do not cut corners.

## Owner follow-up decisions
- Sales Limits → **Admin**.
- CCRS Benchmarks (statewide page) → **DO NOT decommission / DO NOT hide**. Leave nav item + page fully intact; owner just wanted to understand its purpose (explained in chat). We may revisit later.
- Getting Started + Register Activity (unnamed) → kept in the new Dashboard dropdown (non-destructive). Flagged for owner to trim if desired.

## What shipped
- [x] Group "Sell" → renamed **"Dashboard"**; removed the standalone Dashboard nav item (wordmark links to /admin). Orders → **"Online Orders"**. Kept Getting Started, Register Activity, Loyalty.
- [x] Group "Marketing" → **"MKTG & ADV"**, placed right of Website. Order: Marketing & Advertising, Promotions, Blog & Newsletter, **Email Newsletter** (was Newsletter Send), **Image Generator** (was Midjourney).
- [x] New group **"Employee"** right of MKTG & ADV: Time Clock, **Payroll** (was Payroll (ACH)), Trade Samples.
- [x] New group **"Medical"** right of Employee: **Patient Records** (was Medical), Authorization Intake.
- [x] New direct-link button **"CCRS"** right of Medical → `/admin/compliance/health` (Compliance Health). Added "CCRS" to AdminTopNav DIRECT_LINK_GROUPS.
- [x] **Sales Limits** → Admin.
- [x] Removed now-empty groups: **Compliance** and **Finance** (removed from type union + navGroups).
- [x] **CCRS Benchmarks nav item + page left untouched** per owner.
- [x] Verify: tsc ✓ → eslint ✓ → next build ✓ (exit 0) → rm -rf .next ✓.
- [ ] Ship: branch `feat/nav-reorg-mktg-employee-medical`, commit, push, PR, squash-merge --admin, sync main.

## Final top-level order
Dashboard → Reports (button) → CRM → Product Intake → Inventory → Website → MKTG & ADV → Employee → Medical → CCRS (button) → Insights → Admin
