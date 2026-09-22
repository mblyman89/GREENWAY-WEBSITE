/**
 * src/components/admin/ui/DisclosurePanel.tsx
 *
 * SLICE L-20 — the green collapsible bar, as one component.
 *
 * The owner asked for the Leafly setup panel to collapse behind a green bar
 * "identical" to the speaker guide's. This is that bar. Both screens render
 * this component, so "identical" is structural rather than remembered — see
 * the reasoning in `src/lib/admin/disclosure-core.ts`.
 *
 * Deliberately a SERVER component with no "use client": it is a native
 * <details>, so it collapses and expands with no JavaScript at all. On the
 * orders board — a tablet screen left open all day — a panel that cannot be
 * opened until React hydrates is a panel that is stuck during exactly the
 * slow first paint when somebody is in a hurry.
 *
 * It decides nothing. Class strings, the label grammar and the
 * open-by-default rule all come from the pure core.
 */
import type { ReactNode } from "react";
import {
  DISCLOSURE_SHELL_CLASS,
  DISCLOSURE_SUMMARY_CLASS,
  disclosureLabel,
} from "@/lib/admin/disclosure-core";

export function DisclosurePanel({
  icon,
  title,
  subtitle,
  /**
   * Collapsed is the default, because that is what was asked for.
   *
   * Callers pass `shouldStartOpen(...)` when hiding the contents could hide a
   * problem — a setup panel that explains an empty screen must not be
   * collapsed, or the empty screen goes back to being unexplained.
   */
  defaultOpen = false,
  /**
   * Optional trailing content for the bar itself — a step count, a "ready"
   * pill. It sits INSIDE the <summary> so it is visible while collapsed,
   * which is the entire point: the owner should be able to tell whether he
   * needs to open the panel without opening the panel.
   */
  badge,
  id,
  children,
}: {
  icon: string;
  title: string;
  subtitle?: string | null;
  defaultOpen?: boolean;
  badge?: ReactNode;
  id?: string;
  children: ReactNode;
}) {
  return (
    <details className={DISCLOSURE_SHELL_CLASS} id={id} open={defaultOpen}>
      <summary className={DISCLOSURE_SUMMARY_CLASS}>
        {badge ? (
          <span className="inline-flex w-[calc(100%-1.5rem)] items-center gap-2">
            <span className="min-w-0 flex-1">{disclosureLabel(icon, title, subtitle)}</span>
            {badge}
          </span>
        ) : (
          disclosureLabel(icon, title, subtitle)
        )}
      </summary>
      {children}
    </details>
  );
}
