"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { adminNav, navGroups, type AdminNavItem } from "./admin-nav-data";
import { can, type Permission } from "@/lib/auth/roles";
import type { StaffRole } from "@/lib/supabase/types";

type Props = {
  role: StaffRole;
  fullName: string;
  email: string;
};

function Wordmark() {
  return (
    <span className="flex items-baseline gap-2">
      <span className="font-[cursive] text-2xl leading-none text-[var(--admin-accent)]">
        Greenway
      </span>
      <span className="rounded-[var(--admin-radius-sm)] bg-[var(--admin-gold-soft)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.18em] text-[var(--admin-gold)]">
        Admin
      </span>
    </span>
  );
}

export function AdminSidebar({ role, fullName, email }: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const visible = adminNav.filter((item) => can(role, item.permission as Permission));

  const isActive = (href: string) =>
    href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);

  const initials =
    (fullName || email)
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("") || "G";

  return (
    <>
      {/* Mobile top bar */}
      <div className="flex items-center justify-between border-b border-[var(--admin-border)] bg-[var(--admin-canvas)]/90 px-4 py-3 backdrop-blur lg:hidden">
        <span className="font-[cursive] text-xl text-[var(--admin-accent)]">
          Greenway
        </span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="admin-focus rounded-[var(--admin-radius)] border border-[var(--admin-border-strong)] px-3 py-1.5 text-sm text-[var(--admin-text)]"
          aria-label="Toggle menu"
        >
          {open ? "Close ✕" : "Menu ☰"}
        </button>
      </div>

      <aside
        className={`${
          open ? "block" : "hidden"
        } w-full shrink-0 border-b border-[var(--admin-border)] bg-[var(--admin-surface)]/70 backdrop-blur lg:flex lg:h-screen lg:w-64 lg:flex-col lg:border-b-0 lg:border-r lg:sticky lg:top-0`}
      >
        <div className="hidden shrink-0 items-center border-b border-[var(--admin-border)] px-5 py-[1.15rem] lg:flex">
          <Wordmark />
        </div>

        {/* Scrollable nav region — grows/shrinks between header + footer so every
            group stays reachable no matter how long the menu gets. */}
        <nav className="flex flex-col gap-5 px-3 py-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          {navGroups.map((group) => {
            const items = visible.filter((i) => i.group === group);
            if (items.length === 0) return null;
            return (
              <div key={group}>
                <p className="px-2.5 pb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--admin-text-faint)]">
                  {group}
                </p>
                <ul className="flex flex-col gap-0.5">
                  {items.map((item) => (
                    <NavRow
                      key={item.href}
                      item={item}
                      active={isActive(item.href)}
                      onNavigate={() => setOpen(false)}
                    />
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>

        <div className="shrink-0 border-t border-[var(--admin-border)] px-4 py-4 lg:w-64">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--admin-accent-soft)] text-sm font-bold text-[var(--admin-accent)]">
              {initials}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-[var(--admin-text)]">
                {fullName || email}
              </p>
              <p className="truncate text-xs text-[var(--admin-text-faint)]">
                {email}
              </p>
            </div>
          </div>
          <form action="/admin/logout" method="post" className="mt-3">
            <button
              type="submit"
              className="admin-focus w-full rounded-[var(--admin-radius)] border border-[var(--admin-border)] px-3 py-1.5 text-xs font-medium text-[var(--admin-text-muted)] transition hover:border-[var(--admin-orange)]/40 hover:text-[var(--admin-orange)]"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}

function NavRow({
  item,
  active,
  onNavigate,
}: {
  item: AdminNavItem;
  active: boolean;
  onNavigate: () => void;
}) {
  return (
    <li>
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={`group relative flex items-center gap-2.5 rounded-[var(--admin-radius)] px-2.5 py-2 text-sm transition ${
          active
            ? "bg-[var(--admin-accent-soft)] font-medium text-[var(--admin-accent)]"
            : "text-[var(--admin-text-muted)] hover:bg-white/5 hover:text-[var(--admin-text)]"
        }`}
      >
        {/* Active accent bar */}
        <span
          className={`absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-[var(--admin-accent)] transition-opacity ${
            active ? "opacity-100" : "opacity-0"
          }`}
          aria-hidden="true"
        />
        <span className="w-4 text-center text-xs opacity-80">{item.icon}</span>
        <span className="flex-1">{item.label}</span>
        {item.comingSoon && (
          <span className="rounded bg-white/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-[var(--admin-text-faint)]">
            Soon
          </span>
        )}
      </Link>
    </li>
  );
}
