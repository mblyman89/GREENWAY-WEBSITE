"use client";

/**
 * KbProductsViewer — PR-D1 read-only viewer for the per-SKU kb_products
 * backbone. Until now the KB Library only showed strains + product categories,
 * so a Cultivera description saved into kb_products.description had NOWHERE to
 * be seen — you couldn't validate a save worked. This screen lists those rows
 * with their saved description, image thumbnail, provenance, and last-changed
 * time, plus a client-side search + a "missing description" filter so gaps are
 * obvious.
 *
 * Purely presentational: the server does all reads (KbProductRow[] + a
 * media-id→URL map). No writes happen here.
 */

import { useMemo, useState } from "react";
import type { KbProductRow } from "@/lib/ai/kb/store";

type Filter = "all" | "has_description" | "missing_description";

export function KbProductsViewer({
  products,
  imageUrls,
}: {
  products: KbProductRow[];
  /** media_asset id → public URL (resolved server-side for thumbnails). */
  imageUrls: Record<string, string>;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const hasDesc = (p: KbProductRow) => !!(p.description ?? "").trim();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      if (filter === "has_description" && !hasDesc(p)) return false;
      if (filter === "missing_description" && hasDesc(p)) return false;
      if (!q) return true;
      const hay = [
        p.display_name,
        p.brand_slug,
        p.product_slug,
        p.category ?? "",
        p.description ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [products, query, filter]);

  const tabCls = (active: boolean) =>
    "rounded-full px-3.5 py-1.5 text-xs font-semibold transition " +
    (active
      ? "bg-[var(--admin-accent)] text-black"
      : "bg-[var(--admin-surface-2)] text-[var(--admin-text-muted)] hover:bg-[var(--admin-bg)]");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by product, brand, category, or description text…"
          className="min-w-[16rem] flex-1 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-bg)] px-3 py-2 text-sm text-[var(--admin-text)] outline-none focus:border-[var(--admin-accent)]"
        />
        <div className="flex items-center gap-1.5">
          <button type="button" className={tabCls(filter === "all")} onClick={() => setFilter("all")}>
            All ({products.length})
          </button>
          <button
            type="button"
            className={tabCls(filter === "has_description")}
            onClick={() => setFilter("has_description")}
          >
            Has description
          </button>
          <button
            type="button"
            className={tabCls(filter === "missing_description")}
            onClick={() => setFilter("missing_description")}
          >
            Missing description
          </button>
        </div>
      </div>

      <p className="text-xs text-[var(--admin-text-faint)]">
        Showing {filtered.length} of {products.length} product records. This is the
        durable per-product backbone every menu fetch and enrichment writes into —
        when you save a Cultivera description, this is where it lands.
      </p>

      {filtered.length === 0 ? (
        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-8 text-center text-sm text-[var(--admin-text-muted)]">
          {products.length === 0
            ? "No product records yet. Save a Cultivera product's assets to the KB and it will appear here."
            : "No products match your search / filter."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)]">
          <table className="w-full min-w-[52rem] text-sm">
            <thead>
              <tr className="border-b border-[var(--admin-border)] bg-[var(--admin-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-muted)]">
                <th className="px-3 py-2.5 font-semibold">Product</th>
                <th className="px-3 py-2.5 font-semibold">Category</th>
                <th className="px-3 py-2.5 font-semibold">Description</th>
                <th className="px-3 py-2.5 font-semibold">Source</th>
                <th className="px-3 py-2.5 font-semibold">Status</th>
                <th className="px-3 py-2.5 font-semibold">Last changed</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const url = p.primary_media_id ? imageUrls[p.primary_media_id] : undefined;
                const desc = (p.description ?? "").trim();
                return (
                  <tr key={p.id} className="border-b border-[var(--admin-border)] align-top last:border-b-0">
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-black/20">
                          {url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={url} alt={p.display_name} className="h-full w-full object-contain" />
                          ) : (
                            <span className="text-base opacity-40">🌿</span>
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="font-semibold text-[var(--admin-text)]">{p.display_name}</div>
                          <div className="text-xs text-[var(--admin-text-faint)]">
                            {p.brand_slug}
                            {p.variant_label ? ` · ${p.variant_label}` : ""}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-[var(--admin-text-muted)]">
                      {p.category ?? "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      {desc ? (
                        <span className="text-[var(--admin-text-muted)]">{desc}</span>
                      ) : (
                        <span className="rounded bg-[var(--admin-gold-soft)] px-2 py-0.5 text-[0.7rem] font-semibold text-[var(--admin-gold)]">
                          no description saved
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-xs text-[var(--admin-text-faint)]">
                      {p.source ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-xs">
                      <span
                        className={
                          p.status === "published"
                            ? "text-[var(--admin-accent)]"
                            : "text-[var(--admin-text-muted)]"
                        }
                      >
                        {p.status}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-xs text-[var(--admin-text-faint)]">
                      {formatWhen(p.updated_at)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Compact, locale-stable date label; blank when unknown. */
function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "—";
  return t.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
