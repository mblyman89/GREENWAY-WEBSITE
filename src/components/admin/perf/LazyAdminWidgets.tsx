"use client";

/**
 * PERF-S3: the floating back-office helpers (Help "?", Command palette,
 * Concierge, phone launcher) are not needed for first paint. Loading them with
 * next/dynamic + ssr:false (allowed only inside a Client Component, per the
 * Next 16 lazy-loading guide) splits them, and the 61 KB help FAQ they pull in,
 * out of the shared admin bundle. They hydrate right after the page.
 */
import dynamic from "next/dynamic";
import type { PaletteItem } from "@/components/admin/CommandPalette";

const HelpLauncher = dynamic(() => import("@/components/admin/HelpLauncher").then((m) => m.HelpLauncher), { ssr: false });
const CommandPalette = dynamic(() => import("@/components/admin/CommandPalette").then((m) => m.CommandPalette), { ssr: false });
const ConciergeWidget = dynamic(() => import("@/components/admin/ConciergeWidget").then((m) => m.ConciergeWidget), { ssr: false });
const MobileLauncher = dynamic(() => import("@/components/admin/mobile/MobileLauncher").then((m) => m.MobileLauncher), { ssr: false });

export function LazyAdminWidgets({ paletteItems }: { paletteItems: PaletteItem[] }) {
  return (
    <>
      <HelpLauncher />
      <CommandPalette items={paletteItems} />
      <ConciergeWidget />
      <MobileLauncher />
    </>
  );
}
