import { NavLink } from "@/components/site/NavLink";
import { primaryNavigationItems } from "@/components/site/navigation-data";

export function DesktopMenu() {
  return (
    <nav className="hidden items-center gap-7 md:flex" aria-label="Primary navigation">
      {primaryNavigationItems.map((item) => (
        <NavLink key={item.label} item={item} />
      ))}
    </nav>
  );
}
