import Link from "next/link";
import { WORKSPACES } from "@/lib/admin/workspaces";
import { can, type Permission } from "@/lib/auth/roles";
import type { StaffRole } from "@/lib/supabase/types";

/**
 * WorkspaceTour — a data-driven grid that introduces every major area of the
 * back office (the 11 nav "workspaces"). Used in compact form on the Dashboard
 * as the "Explore your back office" quick navigation.
 *
 * It reads WORKSPACES (grounded in docs/PROJECT_GUIDE.md) so it always matches
 * the real product scope, and it filters by the signed-in role's permissions
 * exactly like the top nav — a Read-only user won't see areas they can't use.
 *
 * `variant="full"` shows the summary + the concrete tasks (onboarding tour).
 * `variant="compact"` shows just the summary (dashboard quick links).
 */
export function WorkspaceTour({
  role,
  variant = "full",
}: {
  role: StaffRole;
  variant?: "full" | "compact";
}) {
  const visible = WORKSPACES.filter((w) => can(role, w.permission as Permission));
  if (visible.length === 0) return null;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {visible.map((w) => (
        <Link
          key={w.group}
          href={w.href}
          className="admin-card-interactive group flex flex-col rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4"
        >
          <div className="flex items-center gap-2.5">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--admin-radius)] bg-[var(--admin-surface-2)] text-lg"
              aria-hidden="true"
            >
              {w.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-[var(--admin-text)]">
                {w.title}
              </span>
            </span>
            <span
              className="shrink-0 text-[var(--admin-text-faint)] transition group-hover:translate-x-0.5 group-hover:text-[var(--admin-accent)]"
              aria-hidden="true"
            >
              →
            </span>
          </div>

          <p className="mt-2.5 text-[13px] leading-relaxed text-[var(--admin-text-muted)]">
            {w.summary}
          </p>

          {variant === "full" && (
            <ul className="mt-3 space-y-1">
              {w.does.map((d) => (
                <li
                  key={d}
                  className="flex items-start gap-1.5 text-xs text-[var(--admin-text-faint)]"
                >
                  <span className="mt-[3px] text-[var(--admin-accent)]" aria-hidden="true">
                    •
                  </span>
                  <span>{d}</span>
                </li>
              ))}
            </ul>
          )}
        </Link>
      ))}
    </div>
  );
}
