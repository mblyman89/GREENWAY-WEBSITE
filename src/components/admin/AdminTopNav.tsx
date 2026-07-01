"use client";

/**
 * AdminTopNav (Slice 65)
 *
 * Replaces the left sidebar with a full-width TOP tab bar. Each nav group is a
 * tab; hovering/clicking a tab opens a dropdown of that group's items. The
 * active group tab is highlighted based on the current path.
 *
 * - Permission gating is unchanged (filter by `can(role, item.permission)`).
 * - Grouping/active logic is delegated to the pure admin-nav-core helpers.
 * - Mobile: the tab bar collapses into a single "Menu" button that expands an
 *   accordion of all groups (no hover on touch), so every destination stays
 *   reachable on a phone (supports the owner's mobile-friendly goal).
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { adminNav, navGroups, type AdminNavItem } from "./admin-nav-data";
import { can, type Permission } from "@/lib/auth/roles";
import type { StaffRole } from "@/lib/supabase/types";
import {
  buildNavGroups,
  isHrefActive,
  initialsFrom,
} from "./admin-nav-core";

type Props = {
  role: StaffRole;
  fullName: string;
  email: string;
};

function Wordmark() {
  return (
    <Link href="/admin" className="flex items-baseline gap-2" aria-label="Greenway Admin home">
      <span className="font-[cursive] text-2xl leading-none text-[var(--admin-accent)]">
        Greenway
      </span>
      <span className="hidden rounded-[var(--admin-radius-sm)] bg-[var(--admin-gold-soft)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.18em] text-[var(--admin-gold)] sm:inline">
        Admin
      </span>
    </Link>
  );
}

export function AdminTopNav({ role, fullName, email }: Props) {
  const pathname = usePathname();
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const barRef = useRef<HTMLDivElement | null>(null);
  // Hover-intent: delay closing so the pointer can travel from the tab to its
  // dropdown without the menu vanishing (the previous bug). A short grace
  // period + no dead-space gap keeps the menu comfortably usable.
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const openGroupNow = (group: string) => {
    cancelClose();
    setOpenGroup(group);
  };
  const scheduleClose = (group: string) => {
    cancelClose();
    closeTimer.current = setTimeout(() => {
      setOpenGroup((cur) => (cur === group ? null : cur));
    }, 220);
  };

  // Clear any pending timer on unmount.
  useEffect(() => () => cancelClose(), []);

  const visible = adminNav.filter((item) => can(role, item.permission as Permission));
  const groups = buildNavGroups<AdminNavItem>(visible, navGroups, pathname);
  const initials = initialsFrom(fullName || email);

  // Close the open dropdown on outside click or Escape.
  useEffect(() => {
    if (!openGroup) return;
    function onDown(e: MouseEvent) {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenGroup(null);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenGroup(null);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openGroup]);

  const closeMenus = () => {
    setOpenGroup(null);
    setMobileOpen(false);
  };

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--admin-border)] bg-[var(--admin-canvas)]/90 backdrop-blur">
      <div className="flex items-center gap-4 px-4 py-2.5 sm:px-6">
        <Wordmark />

        {/* Desktop tab bar */}
        <nav ref={barRef} className="relative ml-2 hidden flex-1 items-center gap-0.5 lg:flex">
          {groups.map((g) => {
            const isOpen = openGroup === g.group;
            return (
              <div
                key={g.group}
                className="relative"
                onMouseEnter={() => openGroupNow(g.group)}
                onMouseLeave={() => scheduleClose(g.group)}
              >
                <button
                  type="button"
                  aria-haspopup="true"
                  aria-expanded={isOpen}
                  onClick={() => setOpenGroup((cur) => (cur === g.group ? null : g.group))}
                  className={`admin-focus flex items-center gap-1.5 rounded-[var(--admin-radius)] px-3 py-2 text-sm font-medium transition ${
                    g.active
                      ? "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]"
                      : "text-[var(--admin-text-muted)] hover:bg-white/5 hover:text-[var(--admin-text)]"
                  }`}
                >
                  {g.group}
                  <span
                    className={`text-[9px] opacity-70 transition-transform ${isOpen ? "rotate-180" : ""}`}
                    aria-hidden="true"
                  >
                    ▾
                  </span>
                </button>

                {isOpen && (
                  <div
                    role="menu"
                    onMouseEnter={() => openGroupNow(g.group)}
                    onMouseLeave={() => scheduleClose(g.group)}
                    /* pt-2 acts as an invisible bridge from the tab to the
                       menu so the pointer never crosses a dead gap. */
                    className="absolute left-0 top-full z-50 min-w-[15rem] pt-2"
                  >
                  <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-1.5 shadow-xl">
                    {g.items.map((item) => {
                      const active = isHrefActive(item.href, pathname);
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          role="menuitem"
                          onClick={closeMenus}
                          className={`flex items-center gap-2.5 rounded-[var(--admin-radius-sm)] px-2.5 py-2 text-sm transition ${
                            active
                              ? "bg-[var(--admin-accent-soft)] font-medium text-[var(--admin-accent)]"
                              : "text-[var(--admin-text-muted)] hover:bg-white/5 hover:text-[var(--admin-text)]"
                          }`}
                        >
                          <span className="w-4 text-center text-xs opacity-80">{item.icon}</span>
                          <span className="flex-1">{item.label}</span>
                          {item.comingSoon && (
                            <span className="rounded bg-white/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-[var(--admin-text-faint)]">
                              Soon
                            </span>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className="flex-1 lg:hidden" />

        {/* Account chip + sign out (desktop) */}
        <div className="hidden items-center gap-3 lg:flex">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--admin-accent-soft)] text-xs font-bold text-[var(--admin-accent)]">
              {initials}
            </span>
            <div className="min-w-0 max-w-[11rem]">
              <p className="truncate text-xs font-medium text-[var(--admin-text)]">
                {fullName || email}
              </p>
              <p className="truncate text-[10px] text-[var(--admin-text-faint)]">{email}</p>
            </div>
          </div>
          <form action="/admin/logout" method="post">
            <button
              type="submit"
              className="admin-focus rounded-[var(--admin-radius)] border border-[var(--admin-border)] px-3 py-1.5 text-xs font-medium text-[var(--admin-text-muted)] transition hover:border-[var(--admin-orange)]/40 hover:text-[var(--admin-orange)]"
            >
              Sign out
            </button>
          </form>
        </div>

        {/* Mobile toggle */}
        <button
          type="button"
          onClick={() => setMobileOpen((v) => !v)}
          className="admin-focus rounded-[var(--admin-radius)] border border-[var(--admin-border-strong)] px-3 py-1.5 text-sm text-[var(--admin-text)] lg:hidden"
          aria-label="Toggle menu"
          aria-expanded={mobileOpen}
        >
          {mobileOpen ? "Close ✕" : "Menu ☰"}
        </button>
      </div>

      {/* Mobile accordion */}
      {mobileOpen && (
        <div className="max-h-[70vh] overflow-y-auto border-t border-[var(--admin-border)] px-3 py-3 lg:hidden">
          <div className="mb-3 flex items-center gap-3 rounded-[var(--admin-radius)] border border-[var(--admin-border)] px-3 py-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--admin-accent-soft)] text-sm font-bold text-[var(--admin-accent)]">
              {initials}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-[var(--admin-text)]">{fullName || email}</p>
              <p className="truncate text-xs text-[var(--admin-text-faint)]">{email}</p>
            </div>
            <form action="/admin/logout" method="post">
              <button
                type="submit"
                className="admin-focus rounded-[var(--admin-radius)] border border-[var(--admin-border)] px-2.5 py-1.5 text-xs font-medium text-[var(--admin-text-muted)] hover:border-[var(--admin-orange)]/40 hover:text-[var(--admin-orange)]"
              >
                Sign out
              </button>
            </form>
          </div>
          <div className="flex flex-col gap-4">
            {groups.map((g) => (
              <div key={g.group}>
                <p className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--admin-text-faint)]">
                  {g.group}
                </p>
                <ul className="flex flex-col gap-0.5">
                  {g.items.map((item) => {
                    const active = isHrefActive(item.href, pathname);
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          onClick={closeMenus}
                          className={`flex items-center gap-2.5 rounded-[var(--admin-radius)] px-2.5 py-2 text-sm transition ${
                            active
                              ? "bg-[var(--admin-accent-soft)] font-medium text-[var(--admin-accent)]"
                              : "text-[var(--admin-text-muted)] hover:bg-white/5 hover:text-[var(--admin-text)]"
                          }`}
                        >
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
                  })}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}
