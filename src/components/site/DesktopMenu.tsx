import { NavLink } from "@/components/site/NavLink";
import { primaryNavigationItems } from "@/components/site/navigation-data";

export function DesktopMenu({ hideMedical = false }: { hideMedical?: boolean }) {
  // SLICE 107: drop the Medical link when the page is hidden. Matched by href
  // so a label rename never breaks the filter. Defaults to showing the link.
  const items = hideMedical
    ? primaryNavigationItems.filter((item) => item.href !== "/medical")
    : primaryNavigationItems;

  return (
    <nav className="hidden items-center gap-7 md:flex" aria-label="Primary navigation">
      {items.map((item) => (
        <NavLink key={item.label} item={item} />
      ))}
    </nav>
  );
}
