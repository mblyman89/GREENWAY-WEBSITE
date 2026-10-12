import { NavLink } from "@/components/site/NavLink";
import { primaryNavigationItems } from "@/components/site/navigation-data";
import { PriorityNav } from "@/components/site/PriorityNav";

export function DesktopMenu({ hideMedical = false }: { hideMedical?: boolean }) {
  // SLICE 107: drop the Medical link when the page is hidden. Matched by href
  // so a label rename never breaks the filter. Defaults to showing the link.
  const items = hideMedical
    ? primaryNavigationItems.filter((item) => item.href !== "/medical")
    : primaryNavigationItems;

  return (
    // R49 S4: Priority+ nav. It takes only the space left between the logo and
    // the Search / Cart / Menu cluster (min-w-0 flex-1) and hides the links
    // that don't fit — they stay reachable from the ☰ Menu (visible at every
    // width) — so it can never push the Cart button off-screen again.
    <PriorityNav className="hidden min-w-0 flex-1 items-center justify-center gap-5 overflow-x-clip md:flex lg:gap-6 xl:gap-7 data-[fitted=true]:overflow-x-visible [&>*]:shrink-0 [&>*]:whitespace-nowrap">
      {items.map((item) => (
        <NavLink key={item.label} item={item} />
      ))}
    </PriorityNav>
  );
}
