"use client";

import { useState } from "react";
import { Button } from "@/components/admin/ui/Button";
import type { KbProductCategoryRow } from "@/lib/ai/kb/store";
import { PRODUCT_CATEGORY_GROUPS } from "@/lib/ai/kb/product-categories-data";
import {
  upsertProductCategoryAction,
  toggleProductCategoryAction,
} from "./actions";

// Add / edit / browse the validated PRODUCT-TYPE taxonomy (edibles, liquids,
// tinctures, topicals, vapes, pre-rolls, concentrates, …). These are genuinely
// different products that are NOT represented by a strain, so they live in their
// own list. Market-factual only — no medical or effect claims (WA I-502).
//
// This mirrors the StrainEditor so the owner can keep growing the taxonomy from
// their own research (or, later, from validated web4ai crawler results).

const GROUP_LABELS: Record<string, string> = Object.fromEntries(
  PRODUCT_CATEGORY_GROUPS.map((g) => [g.key, g.label]),
);

const GROUP_OPTIONS = PRODUCT_CATEGORY_GROUPS.map((g) => ({
  value: g.key,
  label: g.label,
}));

const inputCls =
  "mt-1 w-full rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-bg)] px-3 py-2 text-sm text-[var(--admin-text)]";
const labelCls = "block text-xs font-medium text-[var(--admin-text-muted)]";

type FormState = {
  slug: string;
  name: string;
  group_key: string;
  summary: string;
  aliases: string;
  wa_inventory_types: string;
  sort_order: string;
  active: boolean;
};

const EMPTY: FormState = {
  slug: "",
  name: "",
  group_key: "edible",
  summary: "",
  aliases: "",
  wa_inventory_types: "",
  sort_order: "",
  active: true,
};

function rowToForm(c: KbProductCategoryRow): FormState {
  return {
    slug: c.slug ?? "",
    name: c.name ?? "",
    group_key: c.group_key ?? "edible",
    summary: c.summary ?? "",
    aliases: (c.aliases ?? []).join(", "),
    wa_inventory_types: (c.wa_inventory_types ?? []).join(", "),
    sort_order:
      c.sort_order === null || c.sort_order === undefined
        ? ""
        : String(c.sort_order),
    active: c.active,
  };
}

export function ProductCategoryEditor({
  categories,
  migrated,
}: {
  categories: KbProductCategoryRow[];
  migrated: boolean;
}) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"order" | "name" | "group">("order");

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function startEdit(c: KbProductCategoryRow) {
    setForm(rowToForm(c));
    setEditingId(c.id);
    if (typeof document !== "undefined") {
      document
        .getElementById("product-type-form")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function reset() {
    setForm(EMPTY);
    setEditingId(null);
  }

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
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-[var(--admin-text)]">
          Add or edit a product type
        </h2>
        {editingId ? (
          <span className="rounded-full bg-[var(--admin-accent-soft)] px-3 py-1 text-xs text-[var(--admin-text)]">
            Editing — saving updates this product type
          </span>
        ) : (
          <span className="rounded-full bg-[var(--admin-bg)] px-3 py-1 text-xs text-[var(--admin-text-muted)]">
            New product type
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-[var(--admin-text-muted)]">
        The validated product families the store carries — edibles, liquids,
        tinctures, topicals, vapes, pre-rolls and more. These are genuinely
        different products that aren&apos;t represented by a strain, so they live
        in their own list. Each maps to the Washington (CCRS) inventory type it
        corresponds to. <strong>Factual product info only</strong> — no health or
        effect claims.
      </p>

      {/* Add / edit form (posts to the server action). */}
      <form
        id="product-type-form"
        action={upsertProductCategoryAction}
        className="mt-4 grid gap-3 sm:grid-cols-2"
      >
        <label className="text-sm">
          <span className={labelCls}>Product type name *</span>
          <input
            name="name"
            required
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            className={inputCls}
            placeholder="e.g. Gummies"
          />
        </label>
        <label className="text-sm">
          <span className={labelCls}>
            Slug (leave blank to auto-derive from the name)
          </span>
          <input
            name="slug"
            value={form.slug}
            onChange={(e) => set("slug", e.target.value)}
            className={inputCls}
            placeholder="auto: gummies"
          />
        </label>

        <label className="text-sm">
          <span className={labelCls}>Family / group *</span>
          <select
            name="group_key"
            value={form.group_key}
            onChange={(e) => set("group_key", e.target.value)}
            className={inputCls}
          >
            {GROUP_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className={labelCls}>Sort order (blank = end of list)</span>
          <input
            name="sort_order"
            inputMode="numeric"
            value={form.sort_order}
            onChange={(e) => set("sort_order", e.target.value)}
            className={inputCls}
            placeholder="e.g. 10"
          />
        </label>

        <label className="text-sm sm:col-span-2">
          <span className={labelCls}>
            What it is (1–2 factual sentences, no health/effect claims)
          </span>
          <textarea
            name="summary"
            value={form.summary}
            onChange={(e) => set("summary", e.target.value)}
            className={inputCls}
            rows={2}
            placeholder="e.g. Soft, chewable cannabis-infused candies sold in measured doses."
          />
        </label>

        <label className="text-sm">
          <span className={labelCls}>Aliases (comma-separated)</span>
          <input
            name="aliases"
            value={form.aliases}
            onChange={(e) => set("aliases", e.target.value)}
            className={inputCls}
            placeholder="chews, fruit chews"
          />
        </label>
        <label className="text-sm">
          <span className={labelCls}>
            WA CCRS inventory types (comma-separated)
          </span>
          <input
            name="wa_inventory_types"
            value={form.wa_inventory_types}
            onChange={(e) => set("wa_inventory_types", e.target.value)}
            className={inputCls}
            placeholder="Solid Marijuana Infused Edible"
          />
        </label>

        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            name="active"
            value="true"
            checked={form.active}
            onChange={(e) => set("active", e.target.checked)}
          />
          <span className="text-[var(--admin-text-muted)]">
            Active — the AI is allowed to use this product type (uncheck to hide
            it without deleting).
          </span>
        </label>
        {/* When unchecked, the checkbox sends nothing; send an explicit false. */}
        {!form.active ? (
          <input type="hidden" name="active" value="false" />
        ) : null}

        <div className="flex items-center gap-2 sm:col-span-2">
          <Button type="submit">
            {editingId ? "Save changes" : "Add product type"}
          </Button>
          {editingId ? (
            <button
              type="button"
              onClick={reset}
              className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] px-3 py-2 text-sm text-[var(--admin-text-muted)] hover:bg-[var(--admin-bg)]"
            >
              Cancel edit
            </button>
          ) : null}
        </div>
      </form>

      {/* Divider */}
      <div className="my-5 border-t border-[var(--admin-border)]" />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-[var(--admin-text)]">
          Product types ({categories.length})
        </h3>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-56 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-bg)] px-3 py-1.5 text-sm text-[var(--admin-text)]"
          placeholder="Search type, alias, WA category…"
        />
      </div>

      {!migrated ? (
        <p className="mt-3 rounded-[var(--admin-radius)] border border-dashed border-[var(--admin-border)] bg-[var(--admin-bg)] px-3 py-2 text-sm text-[var(--admin-text-muted)]">
          Product-type taxonomy isn&apos;t seeded yet. Apply migration 0070, then
          press <strong>Seed knowledge base</strong> to populate this list. You
          can also add types by hand with the form above.
        </p>
      ) : null}

      {/* Group filter + sort — up top, matching the strain filters. */}
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
          onChange={(e) =>
            setSortBy(e.target.value as "order" | "name" | "group")
          }
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
            ? "No product types yet. Add one above, or seed the expert starter set."
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
                <th className="py-2 pr-4 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr
                  key={c.id}
                  className="border-t border-[var(--admin-border)] align-top"
                >
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
                  <td className="py-2 pr-4 whitespace-nowrap">
                    <span
                      className={
                        c.active
                          ? "text-[var(--admin-text)]"
                          : "text-[var(--admin-text-muted)]"
                      }
                    >
                      {c.active ? "Active" : "Hidden"}
                    </span>
                    <button
                      type="button"
                      onClick={() => startEdit(c)}
                      className="ml-3 text-[var(--admin-accent)] hover:underline"
                    >
                      Edit
                    </button>
                    <form
                      action={toggleProductCategoryAction}
                      className="ml-3 inline"
                    >
                      <input type="hidden" name="id" value={c.id} />
                      <input
                        type="hidden"
                        name="active"
                        value={c.active ? "false" : "true"}
                      />
                      <button
                        type="submit"
                        className="text-[var(--admin-text-muted)] hover:underline"
                      >
                        {c.active ? "Hide" : "Show"}
                      </button>
                    </form>
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
