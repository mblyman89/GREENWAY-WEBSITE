# Nav reorg (round 3) + Receipt Printer → Equipment tab — TODO

## Verbatim requests (owner)
1) "now I want to move ai usage to admin and get rid of insights. I want you to also add receipt printer to the equipment page in a manageable way so it does not cause clutter and such. for the admin drop down, the order I want is, users, integrations, equipment, sales limits, ai usage, audit log, settings, help and faq, then finally menu imports (move from website drop down). let me know if I missed any pages."
2) "types and categories should go in Inventory. I want the inventory drop down to be organize like this, inventory, non-cannabis (rename to Other Inventory), vendors and brands, types and categories, cycle count, returns and destructions. please remove the standalone receipt printer page. also one more thing, please rename loyalty to be loyalty signups."
3) "instead of delete it, can the entire page be moved to the equipment page, but in its own tab page so that everything equipment related is in one location? if so please proceed that way as well as the other requests."

## Plan
### Nav (admin-nav-data.ts)
- [x] Inventory order: Inventory, Other Inventory (rename Non-Cannabis), Vendors & Brands, Types & Categories (moved from Admin), Cycle Counts, Returns & Destruction.
- [x] Move AI Usage → Admin. Delete "Insights" group (type union + navGroups).
- [x] Move Menu Imports from Website → Admin (bottom).
- [x] Remove "Receipt Printer" item from Admin (folded into Equipment tab).
- [x] Admin order: Users, Integrations, Equipment, Sales Limits, AI Usage, Audit Log, Settings, Types & Categories(NO — moved to Inventory), Help & FAQ, Menu Imports.
      FINAL Admin order (Types&Cat now in Inventory): Users, Integrations, Equipment, Sales Limits, AI Usage, Audit Log, Settings, Help & FAQ, Menu Imports.
- [x] Rename Dashboard item "Loyalty" (/admin/loyalty-signups) → "Loyalty signups".

### Receipt Printer → Equipment tab (no functionality lost)
- [x] Extract printer page body into reusable server component `ReceiptPrinterPanel` (src/components/admin/equipment/ReceiptPrinterPanel.tsx).
- [x] Move server actions from src/app/admin/settings/receipt-printer/{actions,assistant-actions}.ts into src/app/admin/equipment/receipt-printer-actions.ts (+assistant) OR keep and re-point imports. Decide: move into equipment domain, update PrinterDiagnosticChat import + panel imports.
- [x] Add tabs to /admin/equipment: ?tab=equipment (default) | ?tab=printer. Tab strip links.
- [x] Delete route src/app/admin/settings/receipt-printer/page.tsx (route gone). Remove leftover folder if empty of routes.
- [x] Re-point all references: settings/page.tsx tile → /admin/equipment?tab=printer; help-content.ts (3) → /admin/equipment?tab=printer; equipment/store.ts INTEGRATED_DEVICES receipt_printer href → /admin/equipment?tab=printer, hrefLabel → "Manage receipt printer".
- [x] Verify no dangling /admin/settings/receipt-printer refs remain.

### Verify + ship
- [x] tsc → eslint → next build → rm -rf .next.
- [x] branch feat/nav-reorg-3-printer-tab, PR, squash-merge --admin, sync main.

## Final top-level order (unchanged groups minus Insights)
Dashboard → Reports → CRM → Product Intake → Inventory → Website → MKTG & ADV → Employee → Medical → CCRS → Admin
