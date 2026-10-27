# WIP — SOP-05a audit notes (temporary; removed before the PR)

Pushed often because the sandbox is unstable (owner: "commit work often out of the sandbox, it is unstable. protect the work.").

## Inventory list `/admin/inventory` (`src/app/admin/inventory/page.tsx`, 1,297 lines)
- Gate `requirePermission("inventory.manage")` L203.
- Header buttons L433-448: Expiration rules, Tags, Testing labs, "+ Import vendor JSON" (→ /inventory/intake).
- HelpPanel L451-468: step 4 says "Vendor JSON intake (next slice) drafts lots + COAs" — stale wording (intake shipped; SOP-04). SopSheetLink slug="publish" L466 (the pre-R31 sheet SOP-04 F-04-5 called stale).
- Status tabs L91-101: All, Active, Quarantine, Recalled, Sold out, Destroyed, Leafly. Bare URL opens on Active (withDefaultStatus, L204-209 comment R36 #3).
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
