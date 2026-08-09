"use client";

import { useMemo, useState } from "react";
import { mapCcrsTypeToKbCategoryAction } from "./actions";
import type {
  UnmappedCcrsItem,
  UnmappedCcrsSummary,
} from "@/lib/ai/kb/unmapped-ccrs-core";

/**
 * SLICE 3 — the self-growth review panel. Shows the CCRS inventory types intake
 * has SEEN but the KB doesn't map yet, newest/most-common first, each with a
 * one-click map to a KB product type. Computed ONCE server-side and rendered
 * here in BOTH the KB Product-types area and the settings Types & Categories
 * page (same data, same component), so everyone is on the same page.
 *
 * NEVER GUESSES: a target is pre-selected only when the server proved it (the
 * canonical CCRS name is already mapped to exactly one category). Otherwise the
 * operator picks. Mapping preserves every other field on the category.
 */

type Target = { id: string; slug: string; name: string; group_key: string };

const GROUP_LABELS: Record<string, string> = {
  flower: "Flower",
  concentrate: "Concentrate",
  vape: "Vape",
  edible: "Edible",
  liquid: "Liquid",
  topical: "Topical",
};

function StatusChip({ status }: { status: UnmappedCcrsItem["status"] }) {
  const map = {
    known: {
      label: "Current CCRS type",
      cls: "bg-[var(--admin-accent-soft)] text-[var(--admin-text,#e5e7eb)]",
    },
    legacy: {
      label: "Legacy spelling",
      cls: "border border-[var(--admin-warning,#a16207)] text-[var(--admin-warning,#a16207)]",
    },
    unrecognized: {
      label: "Older / unrecognized",
      cls: "border border-[var(--admin-gold,#a16207)] text-[var(--admin-gold,#a16207)]",
    },
  } as const;
  const s = map[status];
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] ${s.cls}`}>
      {s.label}
    </span>
  );
}

function MapRow({
  item,
  targets,
  returnTo,
}: {
  item: UnmappedCcrsItem;
  targets: Target[];
  returnTo: string;
}) {
  const [slug, setSlug] = useState<string>(item.suggestedCategorySlug ?? "");

  // Group the target dropdown by product family for scannability.
  const grouped = useMemo(() => {
    const byGroup = new Map<string, Target[]>();
    for (const t of targets) {
      const g = t.group_key || "other";
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g)!.push(t);
    }
    return [...byGroup.entries()].map(([g, list]) => ({
      group: g,
      label: GROUP_LABELS[g] ?? g,
      list: list.sort((a, b) => a.name.localeCompare(b.name)),
    }));
  }, [targets]);

  return (
    <tr className="border-t border-[var(--admin-border)] align-top">
      <td className="py-2 pr-4 text-[var(--admin-text,#e5e7eb)]">
        <span className="font-medium" title={item.rawType}>
          {item.rawType}
        </span>
        {item.canonical && item.canonical !== item.rawType ? (
          <span className="block text-xs text-[var(--admin-text-muted,#9ca3af)]">
            → stores as <strong>{item.canonical}</strong>
          </span>
        ) : null}
        <span className="mt-1 block">
          <StatusChip status={item.status} />
        </span>
      </td>
      <td className="py-2 pr-4 text-[var(--admin-text-muted,#9ca3af)] whitespace-nowrap">
        {item.count} {item.count === 1 ? "lot" : "lots"}
      </td>
      <td className="py-2 pr-4">
        <form action={mapCcrsTypeToKbCategoryAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="ccrs_type" value={item.rawType} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <select
            name="category_slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            required
            className="min-w-[12rem] rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-bg)] px-2 py-1.5 text-sm text-[var(--admin-text,#e5e7eb)]"
            aria-label={`Map ${item.rawType} to a product type`}
          >
            <option value="">Choose a product type…</option>
            {grouped.map((g) => (
              <optgroup key={g.group} label={g.label}>
                {g.list.map((t) => (
                  <option key={t.slug} value={t.slug}>
                    {t.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <button
            type="submit"
            disabled={!slug}
            className="rounded-[var(--admin-radius)] bg-[var(--admin-accent,#16a34a)] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
          >
            Map
          </button>
          {item.suggestedCategorySlug ? (
            <span className="text-[11px] text-[var(--admin-text-muted,#9ca3af)]">
              suggested (same CCRS type is mapped here)
            </span>
          ) : null}
        </form>
      </td>
    </tr>
  );
}

export function UnmappedCcrsPanel({
  items,
  summary,
  targets,
  returnTo,
}: {
  items: UnmappedCcrsItem[];
  summary: UnmappedCcrsSummary;
  targets: Target[];
  returnTo: string;
}) {
  if (items.length === 0) {
    return (
      <section className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
        <h2 className="text-base font-semibold text-[var(--admin-text,#e5e7eb)]">
          CCRS types to map
        </h2>
        <p className="mt-1 text-sm text-[var(--admin-text-muted,#9ca3af)]">
          Every CCRS inventory type your intake has seen is already mapped to a
          product type. The KB is fully connected — nice work. New types will
          appear here automatically as they arrive.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-gold,#a16207)]/40 bg-[var(--admin-surface)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-[var(--admin-text,#e5e7eb)]">
          CCRS types to map ({summary.total})
        </h2>
        <span className="text-xs text-[var(--admin-text-muted,#9ca3af)]">
          {summary.affectedLots} {summary.affectedLots === 1 ? "lot" : "lots"} affected
          {summary.legacy > 0 ? ` · ${summary.legacy} legacy` : ""}
          {summary.unrecognized > 0 ? ` · ${summary.unrecognized} older/unrecognized` : ""}
        </span>
      </div>
      <p className="mt-1 text-sm text-[var(--admin-text-muted,#9ca3af)]">
        These Washington CCRS inventory types have arrived through receiving but
        aren&apos;t connected to a product type yet, so the intake→KB link
        can&apos;t place them. Map each one to the product type it belongs to —
        that&apos;s all it takes to teach the system. Most-common first. Nothing
        is guessed; you choose.
      </p>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--admin-text-muted,#9ca3af)]">
              <th className="py-2 pr-4 font-medium">CCRS inventory type</th>
              <th className="py-2 pr-4 font-medium">Seen</th>
              <th className="py-2 pr-4 font-medium">Map to product type</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <MapRow
                key={item.normalized}
                item={item}
                targets={targets}
                returnTo={returnTo}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
