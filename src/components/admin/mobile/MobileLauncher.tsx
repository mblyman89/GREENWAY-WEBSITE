"use client";

/**
 * MobileLauncher — a phone-only floating shortcut to the curated "/admin/mobile"
 * On-the-Go view.
 *
 * Constraints honored:
 *  - DESKTOP UNCHANGED: hidden at lg+ (lg:hidden), so it never appears on the
 *    desktop back office.
 *  - Doesn't collide with the existing bottom-right Concierge (🤖) or the
 *    bottom-left Help (?) / quick-search: this sits bottom-CENTER, above the
 *    thumb zone, only on phones.
 *  - Hides itself while already on /admin/mobile to avoid redundancy.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";

export function MobileLauncher() {
  const pathname = usePathname();

  // Don't show on the mobile view itself, or on the login/logout chrome-less pages.
  if (pathname?.startsWith("/admin/mobile")) return null;
  if (pathname === "/admin/login" || pathname === "/admin/logout") return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[90] flex justify-center lg:hidden">
      <Link
        href="/admin/mobile"
        className="pointer-events-auto flex items-center gap-2 rounded-full border border-[var(--admin-border-strong)] bg-[var(--admin-surface)] px-4 py-2 text-sm font-semibold text-[var(--admin-text)] shadow-[var(--admin-shadow-lg)] active:opacity-80"
        aria-label="Open the on-the-go mobile view"
      >
        <span aria-hidden>📱</span>
        On the Go
      </Link>
    </div>
  );
}
