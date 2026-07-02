"use client";

import { useState } from "react";
import type { KbProductCategoryRow } from "@/lib/ai/kb/store";
import { PRODUCT_CATEGORY_GROUPS } from "@/lib/ai/kb/product-categories-data";

// Read-only browser for the verified customer-facing product-category taxonomy
// (edibles, liquids, concentrates, topicals, pre-rolls, vapes, …). This is the
// KB reference the AI uses to describe product TYPES; it complements the strain
// library. Sort/filter make the taxonomy easy to scan. Market-factual only —
// no medical or effect claims (WA I-502).

const GROUP_LABELS: Record<string, string> = Object.fromEntries(
  PRODUCT_CATEGORY_GROUPS.map((g) => [g.key, g.label]),
);

export function ProductCategoryBrowser({
  categories,
  migrated,
}: {
  categories: KbProductCategoryRow[];
  migrated: boolean;
}) {
  const [group, setGroup] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<"order" | "name" | "group">("order");

  const q = query.trim().toLowerCase();
  const filtered = categories
    .filter((c) => {
      if (group !== "all" && c.group_key !== group) return false;
      if (q) {
        const hit =
          c.name.toLowerCase().includes(q) ||
          c.slug.toLowerCase().includes(q) ||
          (c.aliases ?? []).some((a) => a.toLowerCase().includes(q)) ||
          (c.wa_inventory_types ?? []).some((w) => w.toLowerCase().includes(q));
        if (!hit) return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      if (sortBy === "group") {
        const g = a.group_key.localeCompare(b.group_key);
        return g !== 0 ? g : a.sort_order - b.sort_order;
      }
      return a.sort_order - b.sort_order;
    });

  return (
    <section className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-[var(--admin-text)]">
          Product types ({categories.length})
        </h2>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-56 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-bg)] px-3 py-1.5 text-sm text-[var(--admin-text)]"
          placeholder="Search type, alias, WA category…"
        />
      </div>
      <p className="mt-1 text-sm text-[var(--admin-text-muted)]">
        The validated product families the store carries — edibles, concentrates,
        vapes, liquids, topicals, pre-rolls and more. Each maps to the Washington
        (CCRS) inventory type it corresponds to, so descriptions stay aligned with
        state categories. <strong>Factual product info only</strong> — no health or
        effect claims.
      </p>

      {!migrated ? (
        <p className="mt-3 rounded-[var(--admin-radius)] border border-dashed border-[var(--admin-border)] bg-[var(--admin-bg)] px-3 py-2 text-sm text-[var(--admin-text-muted)]">
          Product-category taxonomy isn&apos;t seeded yet. Apply migration 0070 and
          run the product-category seed to populate this list.
        </p>
      ) : null}

      {/* Group filter + sort */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap overflow-hidden rounded-[var(--admin-radius)] border border-[var(--admin-border)] text-xs">
          <button
            type="button"
            onClick={() => setGroup("all")}
            className={
              "px-3 py-1.5 " +
              (group === "all"
                ? "bg-[var(--admin-accent-soft)] text-[var(--admin-text)]"
                : "text-[var(--admin-text-muted)] hover:bg-[var(--admin-bg)]")
            }
          >
            All
          </button>
          {PRODUCT_CATEGORY_GROUPS.map((g) => (
            <button
              key={g.key}
              type="button"
              onClick={() => setGroup(g.key)}
              className={
                "px-3 py-1.5 " +
                (group === g.key
                  ? "bg-[var(--admin-accent-soft)] text-[var(--admin-text)]"
                  : "text-[var(--admin-text-muted)] hover:bg-[var(--admin-bg)]")
              }
            >
              {g.label}
            </button>
          ))}
        </div>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as "order" | "name" | "group")}
          className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-bg)] px-2 py-1.5 text-xs text-[var(--admin-text)]"
          aria-label="Sort product types"
        >
          <option value="order">Sort: Default order</option>
          <option value="name">Sort: Name (A–Z)</option>
          <option value="group">Sort: Group</option>
        </select>
        <span className="text-xs text-[var(--admin-text-muted)]">
          {filtered.length} shown
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--admin-text-muted)]">
          {categories.length === 0
            ? "No product types to show yet."
            : "No product types match your filters."}
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--admin-text-muted)]">
                <th className="py-2 pr-4 font-medium">Product type</th>
                <th className="py-2 pr-4 font-medium">Group</th>
                <th className="py-2 pr-4 font-medium">What it is</th>
                <th className="py-2 pr-4 font-medium">WA categories</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-t border-[var(--admin-border)] align-top">
                  <td className="py-2 pr-4 text-[var(--admin-text)]">
                    <span className="font-medium">{c.name}</span>
                    {(c.aliases ?? []).length > 0 ? (
                      <span className="block text-xs text-[var(--admin-text-muted)]">
                        {(c.aliases ?? []).join(", ")}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2 pr-4 text-[var(--admin-text-muted)]">
                    {GROUP_LABELS[c.group_key] ?? c.group_key}
                  </td>
                  <td className="py-2 pr-4 text-[var(--admin-text-muted)] max-w-md">
                    {c.summary ?? "—"}
                  </td>
                  <td className="py-2 pr-4 text-xs text-[var(--admin-text-muted)]">
                    {(c.wa_inventory_types ?? []).join(", ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
