"use client";

import { useState } from "react";
import { Button, labelClassName } from "@/components/admin/ui";
import {
  HOME_CARD_COUNT_OPTIONS,
  clampHomeCardCount,
} from "@/lib/cms/home-section-settings-core";

/**
 * SLICE 112 — the "Home page display" card at the top of the Home page editor's
 * Sections tab. It controls homepage display settings that aren't tied to a
 * single visible banner — right now, how many product cards show in the
 * "Today's Deal" highlights grid (<HomeDailyDeals>). Saves to the locked
 * home.settings config section via saveHomeSettingsAction.
 */
export function HomeDisplaySettingsCard({
  dailyDealsCount,
  saveAction,
}: {
  dailyDealsCount: number;
  saveAction: (formData: FormData) => void | Promise<void>;
}) {
  const initial = clampHomeCardCount(dailyDealsCount);
  const [count, setCount] = useState<number>(initial);
  const unsaved = count !== initial;

  return (
    <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-base">⚙️</span>
        <h3 className="text-sm font-semibold text-white">Home page display</h3>
        {unsaved ? (
          <span className="rounded-full bg-[var(--admin-gold)]/15 px-2 py-0.5 text-[0.65rem] font-semibold text-[var(--admin-gold)]">
            ● unsaved edits
          </span>
        ) : null}
      </div>

      <form action={saveAction} className="space-y-3">
        <input type="hidden" name="daily_deals_count" value={count} />
        <div>
          <span className={labelClassName}>
            &ldquo;Today&rsquo;s Deal&rdquo; highlights — cards shown
          </span>
          <p className="mb-2 text-xs text-white/50">
            How many product cards appear in the daily-deal highlights grid at
            the very top of the homepage (under the hero carousel). Fewer cards
            = a shorter, snappier top section.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {HOME_CARD_COUNT_OPTIONS.map((opt) => {
              const active = count === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setCount(opt.value)}
                  className={
                    active
                      ? "rounded-[var(--admin-radius-sm)] bg-[var(--admin-accent-soft)] px-3 py-1.5 text-sm font-semibold text-[var(--admin-accent)] ring-1 ring-[var(--admin-accent)]/40"
                      : "rounded-[var(--admin-radius-sm)] px-3 py-1.5 text-sm text-[var(--admin-text-muted)] transition hover:bg-[var(--admin-surface-hover)] hover:text-[var(--admin-text)]"
                  }
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex justify-end border-t border-white/10 pt-3">
          <Button type="submit" variant={unsaved ? "save" : "neutral"}>
            {unsaved ? "Save & publish ●" : "Save & publish"}
          </Button>
        </div>
      </form>
    </div>
  );
}
