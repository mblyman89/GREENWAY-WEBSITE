# Cutover weekend: one page (10/30 - 11/01)

<!-- Generated from src/lib/pos/cutover-weekend-core.ts (renderWeekendMarkdown). Do not edit by hand. -->

All times Pacific. In the app: Admin -> Menu Imports -> Cultivera cutover runbook (/admin/menu-imports/cutover).
Tick each box yourself; the app cannot see what you have done.

## Before Fri 10/30 (week of 10/26)

| Done | Time | Step | Check |
|---|---|---|---|
| [ ] |  | **Rehearsal #3 in Test mode.** Press Fetch, stop it halfway, press Resume. Stage it with Test mode on, look it over, then Clean Slate. (/admin/menu-imports) | The resumed run says GO and Clean Slate says real data was untouched. |
| [ ] |  | **Test every scanner and the workbook.** Scan 3 items per scanner into the test box, and open one downloaded workbook in Excel on a store PC (U-47, U-53). (/admin/menu-imports/count) | Every scan lands on its own line; the Scan sheet works in Excel. |
| [ ] |  | **Ring one test sale and one return in Cultivera.** Note the Pacific time you ring them. The rehearsal's sales read must show them at that time (U-48, U-49). | The sale and the return show up with the time you noted. |
| [ ] |  | **Send a test alert to the phone you will carry.** Below on this page. If it says alerts cannot reach you, set the email and push settings it names first. (/admin/menu-imports/cutover#cutover-alerts) | The email and the phone notification both arrive. |

## Fri 10/30: the shelf count

| Done | Time | Step | Check |
|---|---|---|---|
| [ ] |  | **Download one scan workbook per counter.** Each counter gets their own file. Never copy one. Do it before counting starts. (/admin/menu-imports/count) | One file per counter, each with its counter's name. |
| [ ] | 18:00 | **Back stock counted by 18:00, then close.** Count the back room while open. Nothing is pulled from it during the count. Close at 18:00. | The back room is finished before 18:00. |
| [ ] |  | **Count the sales floor after the close.** Scan each unit once. Items without a barcode go on the Hand Count sheet. Save every workbook; you upload them on 11/01. | Every counter's workbook is saved somewhere safe. |

## Sat 10/31: last Cultivera day

| Done | Time | Step | Check |
|---|---|---|---|
| [ ] |  | **Sell on Cultivera as normal.** Its 10/31 sales are taken off your count on 11/01. Do not approve anything on Product Onboarding today. | Nothing is approved on Onboarding. |
| [ ] |  | **After the close: dress rehearsal #4, Test mode.** Fetch with the count date 10/30, read GO, stage with Test mode ON, then Clean Slate. (The units check skips test imports.) Finish before 01:00. (/admin/menu-imports) | GO on every check, Sales done; Clean Slate done. |

## Sun 11/01: cutover, before the 08:00 open

| Done | Time | Step | Check |
|---|---|---|---|
| [ ] | 02:00 | **Clocks fall back (02:00 becomes 01:00).** 01:00 to 01:59 happens twice tonight. Run nothing between 01:00 and 03:00: Cultivera stamps sales in Pacific wall time. | Nothing is running. |
| [ ] | 06:00 | **Fetch, with the count date set to 10/30.** Menu Imports: set the count date to 2026-10-30, TICK Start fresh, press Fetch It All. About 8 minutes. If it stops, press Resume on its run page. (/admin/menu-imports#fetch-cultivera) | Every stage is done, Sales too. A partial Sales read means the count is refused. |
| [ ] | 06:10 | **Read the go / no-go.** On the run page. A NO-GO names what is wrong; a control-total mismatch means fetch again. Never accept a mismatch. (/admin/menu-imports) | GO on every check. |
| [ ] | 06:15 | **Stage it with Test mode OFF.** Within 90 minutes of the harvest finishing, or the app refuses and you fetch again. | The import is staged as real, not test. |
| [ ] | 06:20 | **Fact review, then Publish.** On the import's page. Its counts must match the run page: lots, items, variants, units, value at cost. (/admin/menu-imports) | The Cultivera menu is live. |
| [ ] | 06:40 | **Do the units balance?.** Every unit in Cultivera's file must be a unit on a lot. Red lines say what to do. (/admin/menu-imports/reconcile) | Green. |
| [ ] | 06:50 | **Upload the count workbooks and apply.** Pick this morning's import, upload every workbook at once, read the preview, apply. Before 08:00: a lot sold first is left alone. (/admin/menu-imports/count) | Applied, with nothing refused. |
| [ ] | 07:30 | **Nothing waiting, menu and register checked.** Still to rebuild says none. Publish Menu shows nothing waiting. Check the public menu and ring a few items on the register. (/admin/publish) | The menu and the register look right. |
| [ ] | 08:00 | **Open. Receiving is the only door now.** Your first receiving approval is the point of no return: after it, fixes go forward through receiving only. (/admin/inventory/intake) | - |
| [ ] |  | **During the day: manifests and onboarding.** Rebuild the Cultivera manifests (preview first), attach vendor lab results, then work Product Onboarding. (/admin/inventory/drafts) | Nothing here can take a product off the menu. |
| [ ] |  | **Change your Cultivera password.** When the day's work no longer needs Cultivera. The crawler's login stops working, as intended. | The old password no longer logs in. |

## Mon 11/02 to Sun 11/08

| Done | Time | Step | Check |
|---|---|---|---|
| [ ] |  | **Daily: compare against Cultivera's last numbers.** Once a day through 11/08: on hand must equal Cultivera's units plus every count, adjustment, sale and void. Press I ran today's check. (/admin/menu-imports/drift) | Green, or every red product counted and fixed. |

## If something goes wrong

- **Before Publish:** Nothing changed. Stop. Cultivera keeps working; fetch again later or use the manual upload.
- **After Publish, before the first receiving approval:** Fetch again, stage and publish the corrected harvest. A real re-import is still allowed.
- **After the first receiving approval:** Forward-fix only: re-approve from receiving. A second real Cultivera upload is refused.

Long form, with the reasons and the evidence: docs/CULTIVERA_CUTOVER_RUNBOOK.md.
