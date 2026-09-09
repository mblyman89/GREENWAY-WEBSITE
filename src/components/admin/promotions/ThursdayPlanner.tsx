"use client";

/**
 * ThursdayPlanner — PR-P6 client island for the multi-week "Top Shelf Thursday"
 * brand-sale planner.
 *
 * Michael's ask: instead of picking a brand every single week (and risking the
 * same brand lingering on sale because he forgot), queue a DIFFERENT brand for
 * each of the next several Thursdays up front. The system then creates one
 * DATE-WINDOWED draft per week — each runs only on its own Thursday and ends on
 * its own, so next week's brand swaps in automatically. No manual cleanup.
 *
 * This island only collects the plan and calls the server action. The action
 * validates brands against the live menu and creates DRAFTS, so every
 * publish-time CCRS guard stays intact — nothing goes live without review.
 *
 * The list of upcoming Thursdays is computed on the SERVER (passed in as
 * `thursdays`) so the dates are anchored to store time and never drift on the
 * client's clock.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/admin/ui";
import {
  clampGuidedPercent,
  type PlannedWeek,
  type ThursdayPlanResultLike,
} from "./thursday-planner-types";
import { schedulePlannedThursdaysAction } from "@/app/admin/promotions/actions";
// SLICE T1: the brand matcher the ENGINE uses. Imported here so this screen
// warns about exactly the brands the register would leave at full price --
// if the planner used its own comparison, the warning could disagree with
// the till, which is the class of bug T1 exists to remove.
import { findBrandNearMisses } from "@/lib/promotions/brand-match-core";

type WeekOption = {
  /** Pacific YYYY-MM-DD of the Thursday. */
  ymd: string;
  /** Friendly label like "Aug 13". */
  label: string;
};

type Props = {
  /** Upcoming Thursdays (server-computed, store time). */
  thursdays: WeekOption[];
  /** Published-menu brand names (canonical spelling). */
  brands: string[];
};

type WeekState = {
  brands: string[];
  /** Empty string means "use the default percent". */
  percent: string;
};

export function ThursdayPlanner({ thursdays, brands }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [defaultPercent, setDefaultPercent] = useState<number>(20);
  const [query, setQuery] = useState("");
  const [openWeek, setOpenWeek] = useState<string | null>(
    thursdays[0]?.ymd ?? null,
  );
  const [weeks, setWeeks] = useState<Record<string, WeekState>>({});
  const [result, setResult] = useState<ThursdayPlanResultLike | null>(null);

  const cleanDefault = clampGuidedPercent(defaultPercent);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? brands.filter((b) => b.toLowerCase().includes(q)) : brands;
    return list.slice(0, 60);
  }, [brands, query]);

  function weekOf(ymd: string): WeekState {
    return weeks[ymd] ?? { brands: [], percent: "" };
  }

  function toggleBrand(ymd: string, brand: string) {
    setWeeks((prev) => {
      const cur = prev[ymd] ?? { brands: [], percent: "" };
      const has = cur.brands.includes(brand);
      return {
        ...prev,
        [ymd]: {
          ...cur,
          brands: has
            ? cur.brands.filter((b) => b !== brand)
            : [...cur.brands, brand],
        },
      };
    });
  }

  function setWeekPercent(ymd: string, percent: string) {
    setWeeks((prev) => {
      const cur = prev[ymd] ?? { brands: [], percent: "" };
      return { ...prev, [ymd]: { ...cur, percent } };
    });
  }

  function clearWeek(ymd: string) {
    setWeeks((prev) => {
      const next = { ...prev };
      delete next[ymd];
      return next;
    });
  }

  const plannedCount = thursdays.filter(
    (t) => (weeks[t.ymd]?.brands.length ?? 0) > 0,
  ).length;

  /**
   * SLICE T1 -- NEAR MISSES.
   *
   * The matcher is deliberately exact: it will never decide on its own that
   * "Lifted Cannabis" is the same deal as "Lifted", because that is a fact
   * about the vendor agreement and not about the spelling. Measured on the
   * store's live catalogue, four brands sit in that gap and cover 12
   * products, which today ring up at full price while the shelf sign
   * advertises their brand.
   *
   * So instead of guessing, this tells the owner. Picking the extra brand is
   * one click away in the very list below.
   */
  const nearMisses = useMemo(() => {
    const picked = Array.from(
      new Set(Object.values(weeks).flatMap((w) => w.brands)),
    );
    if (picked.length === 0) return [];
    // Only report brands the owner has NOT already selected -- an already
    // scheduled brand is not a missed one.
    const chosen = new Set(picked);
    return findBrandNearMisses(brands, picked).filter((m) => !chosen.has(m.brand));
  }, [brands, weeks]);

  function schedule() {
    const plan: PlannedWeek[] = thursdays
      .map((t) => {
        const w = weekOf(t.ymd);
        const percentNum = w.percent.trim() === "" ? null : Number(w.percent);
        return {
          ymd: t.ymd,
          brands: w.brands,
          percent: Number.isFinite(percentNum as number) ? percentNum : null,
        };
      })
      .filter((w) => w.brands.length > 0);

    if (plan.length === 0) {
      setResult({
        ok: false,
        scheduledCount: 0,
        skippedCount: 0,
        createdIds: [],
        warnings: ["Pick at least one brand for at least one Thursday."],
        error: "Nothing to schedule yet.",
      });
      return;
    }

    startTransition(async () => {
      const res = await schedulePlannedThursdaysAction(plan, cleanDefault);
      setResult(res);
      if (res.ok) {
        // Clear the scheduled weeks so it's obvious what's been saved.
        setWeeks({});
        router.refresh();
      }
    });
  }

  if (brands.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-black/30 p-4">
        <p className="text-sm text-white/70">
          No published menu brands yet. Import and publish a menu to plan Thursday
          brand sales.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Default percent + search */}
      <div className="flex flex-wrap items-end gap-4 rounded-xl border border-[var(--admin-purple)]/30 bg-[var(--admin-purple)]/5 p-4">
        <label className="block">
          <span className="mb-1 block text-xs text-white/50">
            Default percent off (used when a week has no percent of its own)
          </span>
          <input
            type="number"
            min={1}
            max={90}
            value={defaultPercent}
            onChange={(e) => setDefaultPercent(Number(e.target.value))}
            className="w-32 rounded-lg border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[var(--admin-accent)]"
          />
        </label>
        <label className="block flex-1 min-w-[12rem]">
          <span className="mb-1 block text-xs text-white/50">Search brands</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type to filter the brand lists below…"
            className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[var(--admin-accent)]"
          />
        </label>
        <div className="text-xs text-white/55">
          {plannedCount} of {thursdays.length} Thursdays planned
        </div>
      </div>

      {/* Week rows */}
      <div className="space-y-2">
        {thursdays.map((t) => {
          const w = weekOf(t.ymd);
          const isOpen = openWeek === t.ymd;
          const effPercent =
            w.percent.trim() === ""
              ? cleanDefault
              : clampGuidedPercent(Number(w.percent) || cleanDefault);
          return (
            <div
              key={t.ymd}
              className="rounded-xl border border-white/10 bg-black/30"
            >
              <button
                type="button"
                onClick={() => setOpenWeek(isOpen ? null : t.ymd)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
              >
                <span className="flex items-center gap-3">
                  <span className="text-lg" aria-hidden>
                    📅
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-white/90">
                      Thursday {t.label}
                    </span>
                    <span className="block text-xs text-white/50">
                      {w.brands.length === 0
                        ? "No brand yet — this Thursday stays as-is"
                        : `${w.brands.join(", ")} · ${effPercent}% off`}
                    </span>
                  </span>
                </span>
                <span className="text-xs text-white/45">
                  {isOpen ? "Hide ▲" : "Edit ▼"}
                </span>
              </button>

              {isOpen && (
                <div className="grid gap-4 border-t border-white/10 px-4 py-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs text-white/50">
                      Brand(s) on sale this Thursday
                    </label>
                    <div className="grid max-h-40 grid-cols-2 gap-1.5 overflow-y-auto rounded-lg border border-white/10 bg-black/40 p-2">
                      {filtered.map((brand) => (
                        <label
                          key={brand}
                          className="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-white/70 hover:bg-white/5"
                        >
                          <input
                            type="checkbox"
                            checked={w.brands.includes(brand)}
                            onChange={() => toggleBrand(t.ymd, brand)}
                            className="h-3.5 w-3.5 accent-[var(--admin-purple)]"
                          />
                          {brand}
                        </label>
                      ))}
                      {filtered.length === 0 && (
                        <p className="col-span-2 px-1 py-2 text-xs text-white/40">
                          No brands match “{query}”.
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <label className="block">
                      <span className="mb-1 block text-xs text-white/50">
                        Percent off this week (optional — blank uses the default{" "}
                        {cleanDefault}%)
                      </span>
                      <input
                        type="number"
                        min={1}
                        max={90}
                        value={w.percent}
                        placeholder={`${cleanDefault}`}
                        onChange={(e) => setWeekPercent(t.ymd, e.target.value)}
                        className="w-32 rounded-lg border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[var(--admin-accent)]"
                      />
                    </label>
                    {w.brands.length > 0 && (
                      <button
                        type="button"
                        onClick={() => clearWeek(t.ymd)}
                        className="text-xs text-white/45 underline hover:text-white/70"
                      >
                        Clear this Thursday
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* SLICE T1: brands on the live menu that LOOK related to the ones
          picked but do NOT match, and so would ring up at full price. */}
      {nearMisses.length > 0 && (
        <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-4">
          <p className="text-sm font-semibold text-amber-200">
            {nearMisses.length} similar brand
            {nearMisses.length === 1 ? "" : "s"} on your menu {nearMisses.length === 1 ? "is" : "are"} NOT included
          </p>
          <p className="mt-1 text-xs text-amber-100/80">
            These are separate brand names in your menu, so the register will
            charge FULL price for them. If they are the same vendor, tick them
            in the list above as well.
          </p>
          <ul className="mt-3 space-y-1.5">
            {nearMisses.map((m) => (
              <li key={`${m.target}|${m.brand}`} className="text-xs text-white/80">
                <span className="font-medium text-white">{m.brand}</span>
                <span className="text-white/50"> vs your pick </span>
                <span className="font-medium text-white">{m.target}</span>
                {m.kind === "corporate-suffix" ? (
                  <span className="ml-2 rounded bg-amber-400/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-200">
                    likely the same company
                  </span>
                ) : (
                  <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white/60">
                    may be a different line
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Action + result */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="special"
          onClick={schedule}
          disabled={pending || plannedCount === 0}
        >
          {pending
            ? "Scheduling…"
            : `Schedule ${plannedCount || ""} Thursday${plannedCount === 1 ? "" : "s"} →`}
        </Button>
        <span className="text-xs text-white/45">
          Each planned Thursday becomes its own draft you can review &amp; publish.
        </span>
      </div>

      {result && (
        <div
          className={`rounded-xl border p-4 ${
            result.ok
              ? "border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/5"
              : "border-[var(--admin-gold)]/40 bg-[var(--admin-gold)]/5"
          }`}
        >
          {result.ok ? (
            <p className="text-sm text-white/90">
              ✅ Scheduled {result.scheduledCount} Thursday
              {result.scheduledCount === 1 ? "" : "s"} as drafts. Review and
              publish them below.
            </p>
          ) : (
            <p className="text-sm text-white/90">
              {result.error ?? "Nothing was scheduled."}
            </p>
          )}
          {result.warnings.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-white/60">
              {result.warnings.map((wmsg, i) => (
                <li key={i}>{wmsg}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
