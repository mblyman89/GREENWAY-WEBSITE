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

export function AdminSidebar({ role, fullName, email }: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const visible = adminNav.filter((item) => can(role, item.permission as Permission));

  const isActive = (href: string) =>
    href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);

  return (
    <>
      {/* Mobile top bar */}
      <div className="flex items-center justify-between border-b border-white/10 bg-black px-4 py-3 lg:hidden">
        <span className="font-[cursive] text-xl text-[#7ed957]">Greenway</span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-md border border-white/15 px-3 py-1.5 text-sm text-white"
          aria-label="Toggle menu"
        >
          {open ? "Close ✕" : "Menu ☰"}
        </button>
      </div>

      <aside
        className={`${
          open ? "block" : "hidden"
        } w-full shrink-0 border-b border-white/10 bg-[#0a0a0a] lg:block lg:h-screen lg:w-64 lg:border-b-0 lg:border-r lg:sticky lg:top-0`}
      >
        <div className="hidden items-center gap-2 border-b border-white/10 px-5 py-5 lg:flex">
          <span className="font-[cursive] text-2xl text-[#7ed957]">Greenway</span>
          <span className="text-xs uppercase tracking-widest text-[#ffd700]">Admin</span>
        </div>

        <nav className="flex flex-col gap-4 px-3 py-4">
          {navGroups.map((group) => {
            const items = visible.filter((i) => i.group === group);
            if (items.length === 0) return null;
            return (
              <div key={group}>
                <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">
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

        <div className="border-t border-white/10 px-5 py-4 text-xs lg:absolute lg:bottom-0 lg:w-64">
          <p className="truncate font-medium text-white">{fullName || email}</p>
          <p className="truncate text-white/40">{email}</p>
          <form action="/admin/logout" method="post" className="mt-2">
            <button
              type="submit"
              className="text-[#ff7f00] underline-offset-2 hover:underline"
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
        className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition ${
          active
            ? "bg-[#7ed957]/15 text-[#7ed957]"
            : "text-white/70 hover:bg-white/5 hover:text-white"
        }`}
      >
        <span className="w-4 text-center text-xs opacity-80">{item.icon}</span>
        <span className="flex-1">{item.label}</span>
        {item.comingSoon && (
          <span className="rounded bg-white/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-white/45">
            Soon
          </span>
        )}
      </Link>
    </li>
  );
}
