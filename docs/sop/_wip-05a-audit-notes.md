# WIP — SOP-05a audit notes (temporary; removed before the PR)

Pushed often because the sandbox is unstable (owner: "commit work often out of the sandbox, it is unstable. protect the work.").

## Inventory list `/admin/inventory` (`src/app/admin/inventory/page.tsx`, 1,297 lines)
- Gate `requirePermission("inventory.manage")` L205.
- Header buttons L433-448: Expiration rules, Tags, Testing labs, "+ Import vendor JSON" (→ /inventory/intake).
- HelpPanel L451-469: step 4 (L459) says "Vendor JSON intake (next slice) drafts lots + COAs" — stale wording (intake shipped; SOP-04). SopSheetLink slug="publish" L467 (the pre-R31 sheet SOP-04 F-04-5 called stale).
- Status tabs L92-102: All, Active, Quarantine, Recalled, Sold out, Destroyed, Leafly. Bare URL opens on Active (withDefaultStatus, L204-209 comment R36 #3).
- KPI cards L487-537: Total lots, Active lots, On-hand cost (orange when lots lack cost), Needs attention = recalled+quarantine+expired+expiringSoon+missingCoa+missingExpiry. Accent ignores expiringSoon (L522-530) — cosmetic.
- Restore result banners L541-554 (`restored` / `restoreError`).
- Page tabs Lots | Issues | Insights L557-564. Issues: IssuesList + RegisterSellabilityBanner + RestoreToSalePanel L566-591. Insights: InventoryIntelPanel L597.
- Vendor filter banner L605-626. Filter panel L661-667. Bulk fill mode L678-703 ("Bulk fill missing fields…").
- Columns L800-846 incl. COA, THC.., Lab, COA expiry, Received, Age, On hand, Sold, Sell-through, Velocity, Days of supply, ABC, Last counted, Unit cost, Ext cost, Price, Margin, Ext retail, Website category, Onboarded, On menu, Expires, Compliance, Disposition, Notes, Updated, Status.

## Lot actions (`src/app/admin/inventory/actions.ts`, 1,260 lines) — all `inventory.manage`
- adjustLotAction L111-140 → store.createAdjustment (store.ts L578-616).
  - **Read-modify-write**: reads on_hand_qty L587-591, writes current+delta L603-608. Does NOT use atomic `applyLotDelta` (atomic-quantity.ts; GW-012) which sale-decrement, cycle-counts, disposition, void-store use. Race with a live sale can lose units. → finding.
  - **No floor at zero**: next = current + delta, no check → on-hand can go negative. → finding.
  - No sold_out flip at zero (applyLotDelta autoStatus does that for sales). → finding (minor).
  - No recordAudit call (the adjustment row itself carries actor_id L595-600). OK-ish.
  - Note optional (form L1488-1490 lot page); reasons "other" and "employee_sample" map to CCRS "Other" (ccrs-inventory-adjustment-core.ts L62-93) which REQUIRES detail (ccrs-preflight-core.ts L271) → row withheld E13 at CCRS build (core L68-72). Form does not warn. → finding.
  - "Destruction" and "Recall removal" reasons exist on the manual form (lot page L59-69) — both export as CCRS Destruction (core L66-67, L80-81). Bypasses SOP-15 disposition flow. → finding.
  - "Theft"/"Seizure" exist in CCRS map (L91-94) but NOT in the form's reason list (lot page L59-69 / actions VALID_REASONS L89-101). Theft must go as Other+note or Shrink(→Lost). → finding.
  - "Receive (add)" reason: not reported to CCRS (isReportableAdjustment L101-105) — adding stock by hand is invisible to CCRS adjustments. → finding.
- setLotStatusAction L142-155 → store.updateLotStatus L836-851: blind update, no audit, no go-live gate (F-04-2 / G-19 carry-over, S1). VALID_STATUSES L103-109.
- Lot page Lifecycle form `[id]/page.tsx` L1496-1512; help text "Recalled / destroyed lots are excluded from sale."
- Adjustment history L1516-1546: date only via toLocaleDateString (browser tz, not Pacific; no actor shown).

## Status / recall / destroyed
- Recall hold (AN-7): `recall-hold-core.ts` HOLD_LOT_STATUS="recalled" (L42-ish); whole product key held while any lot recalled; quarantine never holds (header L17-26). Enforced: POS menu bundle advisory `api/pos/menu/route.ts` L116-121 (fail-open, comment says so); completion gate fail-closed `orders/completion-gate.ts` L95-119 (no override; refusal text "the hold clears only when a manager releases or destroys the recalled lot in Admin → Inventory" recall-hold-core.ts recallHoldRefusal). Restore-to-sale refuses under hold (restore-to-sale-store.ts L125-140, failClosed).
- Recalled status is set ONLY by the lot page Lifecycle form (blind update, no audit, store.ts L836-851). So the recall hold — a statutory sale stop — is placed and released with no audit row and no reason. → finding (pairs with F-04-2).
- **Manual "Destroyed" status with stock left**: updateLotStatus writes status only (store.ts L836-851); on_hand_qty unchanged, no adjustment row. CCRS Inventory.csv reads live lots `.neq("status","destroyed")` (ccrs-batch.ts L1209-1217) and only re-reads destroyed lots NAMED by an event row in the batch (readDestroyedLots L380-411). Hand-destroyed lot with no adjustment → dropped from Inventory.csv with its last QoH still on file at CCRS, no Destruction adjustment. The proper path is SOP-15 disposition (disposition.ts L1087-1094 sets destroyed only when the lot is empty). → S1 finding.
- CCRS: held lots (quarantine/recalled) reported in the Sales Floor area, advisory E45 (ccrs-batch.ts L1006-1010, L1121).
- Status vocab: active | quarantine | recalled | sold_out | destroyed (actions.ts L103-109; lot page L71-77).

## Register "86" + restore to sale
- `/api/pos/stock-flag` route.ts: device-authenticated L28-34, reasons "shelf empty" | "damaged / unsellable" | "wrong listing" (stock-flag-core.ts STOCK_FLAG_REASONS), flips published menu_items.inventory_status → "unavailable" L75-81, audited `pos.stock_flag` L84-100 (flaggedByName is client-asserted L48-51). One-way.
- Menu download self-heals: a flagged card with live active units is restored on the next download (register-availability-core.ts reconcileRegisterAvailability L318-421; route.ts L240). So "86 it" on a product that has stock lasts only until the next menu download unless stock is zero. → finding (86 is not sticky; "damaged / unsellable" reason with stock on hand silently comes back). Need verify statusForUnits L141-145: ≤0 unavailable, ≤3 low-stock.
- Restore button: actions.ts L1174-1206 → restore-to-sale-store; refusal codes not_flagged / recall_hold / hidden_card / no_live_stock (restore-to-sale-core.ts decideRestore). Audit `inventory.restore_to_sale` (store L169-172). UI: Issues tab RestoreToSalePanel (page.tsx L586).
