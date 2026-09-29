/**
 * src/components/admin/inventory/ReceivingTabs.tsx
 *
 * Slice H15d — the two-tab switcher for the Receiving page:
 * "Incoming (email)" (the hero, default) vs "Manual tools" (the drawer with
 * the four import forms + KB backfill).
 *
 * S27: now a thin wrapper over the shared PageTabs primitive. The markup is
 * byte-identical (pinned by tests/compliance/page-tabs.test.tsx), RECEIVING_TABS
 * is unchanged, and the active tab is still resolved on the server
 * (resolveReceivingTab) so a manual-form error redirect auto-opens Manual tools.
 */

import { PageTabs } from "@/components/admin/ui/PageTabs";
import { RECEIVING_TABS, type ReceivingTab } from "@/lib/inventory/receiving-tabs-core";

export const RECEIVING_TABS_BASE = "/admin/inventory/intake";

export function ReceivingTabs({ active }: { active: ReceivingTab }) {
  return <PageTabs base={RECEIVING_TABS_BASE} tabs={RECEIVING_TABS} active={active} ariaLabel="Receiving views" />;
}
