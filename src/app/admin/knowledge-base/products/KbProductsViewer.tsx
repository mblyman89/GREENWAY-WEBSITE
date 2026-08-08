"use client";

/**
 * KbProductsViewer — the per-SKU kb_products backbone viewer.
 *
 * PR-D1 gave this screen a read-only list so a Cultivera description saved into
 * kb_products.description finally had somewhere to be seen. PR-D4 turns it into
 * a menu-readiness workbench: every row is graded (photo + description matter
 * most; category / aroma / flavor add the colorful pills that make the item
 * page shine) with a live meter, a strict "improve this description" nudge, and
 * a smart "Fix →" button that routes to the exact enrichment worklist gap.
 *
 * The scoring itself is done server-side by the pure menu-readiness core (see
 * page.tsx); this component only presents the result and links out. No writes
 * happen here.
 */

import { useMemo, useState } from "react";
import type { KbProductRow } from "@/lib/ai/kb/store";
import type {
  MenuReadinessResult,
  MenuReadinessItem,
  MenuReadinessFixKind,
} from "@/lib/purchasing/menu-readiness-core";

/** One product's precomputed readiness, keyed to its kb_products row id. */
export type KbProductReadinessRow = {
  id: string;
  result: MenuReadinessResult;
};

type Filter =
  | "all"
  | "menu_ready"
  | "needs_photo"
  | "needs_description"
  | "needs_details";

/**
 * Map a fix kind to the enrichment worklist deep-link. The per-product editor
 * 404s for kb rows that aren't published POS products and kb_products has no
 * durable vendor-menu backlink, so the always-safe destination is the worklist
 * gap filter (it works regardless of a row's POS status).
 */
function fixHrefForKind(kind: MenuReadinessFixKind): string {
  switch (kind) {
    case "image":
      return "/admin/products?gap=image#worklist";
    case "description":
      return "/admin/products?gap=description#worklist";
    case "details":
    default:
      return "/admin/products?gap=any#worklist";
  }
}

/** Plain-English hint for where a fix leads. */
function fixHint(kind: MenuReadinessFixKind): string {
  switch (kind) {
    case "image":
      return "Find & attach a product photo";
    case "description":
      return "Write / improve the description";
    case "details":
    default:
      return "Add category, aroma & flavor notes";
  }
}

export function KbProductsViewer({
  products,
  imageUrls,
  readiness,
}: {
  products: KbProductRow[];
  /** media_asset id → public URL (resolved server-side for thumbnails). */
  imageUrls: Record<string, string>;
  /** Precomputed menu-readiness per product row (from the pure core). */
  readiness: KbProductReadinessRow[];
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Fast id → readiness lookup so the render loop stays O(1) per row.
  const readinessById = useMemo(() => {
    const m = new Map<string, MenuReadinessResult>();
    for (const r of readiness) m.set(r.id, r.result);
    return m;
  }, [readiness]);

  // A row "needs X" when that specific item is not done.
  const itemDone = (r: MenuReadinessResult | undefined, key: MenuReadinessItem["key"]) =>
    !!r && r.items.some((it) => it.key === key && it.done);

  const counts = useMemo(() => {
    let menuReady = 0;
    let needsPhoto = 0;
    let needsDescription = 0;
    let needsDetails = 0;
    for (const p of products) {
      const r = readinessById.get(p.id);
      if (!r) continue;
      // menu-ready mirrors isMenuReady: photo done AND description good.
      const photoOk = itemDone(r, "photo");
      const descGood = r.descriptionState === "good";
      if (photoOk && descGood) menuReady += 1;
      if (!photoOk) needsPhoto += 1;
      if (!descGood) needsDescription += 1;
      if (!itemDone(r, "category") || !itemDone(r, "aroma") || !itemDone(r, "flavor"))
        needsDetails += 1;
    }
    return { menuReady, needsPhoto, needsDescription, needsDetails };
  }, [products, readinessById]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = products.filter((p) => {
      const r = readinessById.get(p.id);
      const photoOk = itemDone(r, "photo");
      const descGood = r?.descriptionState === "good";
      if (filter === "menu_ready" && !(photoOk && descGood)) return false;
      if (filter === "needs_photo" && photoOk) return false;
      if (filter === "needs_description" && descGood) return false;
      if (
        filter === "needs_details" &&
        itemDone(r, "category") &&
        itemDone(r, "aroma") &&
        itemDone(r, "flavor")
      )
        return false;
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

    // Worst-first when a "needs" filter is active OR always show the lowest
    // scores first so gaps float to the top (menu-ready last).
    const scoreOf = (p: KbProductRow) => readinessById.get(p.id)?.percent ?? 0;
    return [...rows].sort((a, b) => {
      const sa = scoreOf(a);
      const sb = scoreOf(b);
      if (sa !== sb) return sa - sb; // ascending: least-ready first
      return a.display_name.localeCompare(b.display_name);
    });
  }, [products, query, filter, readinessById]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" className={tabCls(filter === "all")} onClick={() => setFilter("all")}>
            All ({products.length})
          </button>
          <button
            type="button"
            className={tabCls(filter === "menu_ready")}
            onClick={() => setFilter("menu_ready")}
          >
            Menu-ready ({counts.menuReady})
          </button>
          <button
            type="button"
            className={tabCls(filter === "needs_photo")}
            onClick={() => setFilter("needs_photo")}
          >
            Needs photo ({counts.needsPhoto})
          </button>
          <button
            type="button"
            className={tabCls(filter === "needs_description")}
            onClick={() => setFilter("needs_description")}
          >
            Needs description ({counts.needsDescription})
          </button>
          <button
            type="button"
            className={tabCls(filter === "needs_details")}
            onClick={() => setFilter("needs_details")}
          >
            Needs details ({counts.needsDetails})
          </button>
        </div>
      </div>

      <p className="text-xs text-[var(--admin-text-faint)]">
        Showing {filtered.length} of {products.length} product records, least
        menu-ready first. A product is <strong>menu-ready</strong> when it has a
        photo and a genuinely good description; category, aroma and flavor notes
        add the colorful pills that make the item page shine. Use{" "}
        <strong>Fix →</strong> to jump straight to the enrichment worklist for
        whatever it&apos;s missing.
      </p>

      {filtered.length === 0 ? (
        <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-8 text-center text-sm text-[var(--admin-text-muted)]">
          {products.length === 0
            ? "No product records yet. Save a Cultivera product's assets to the KB and it will appear here."
            : "No products match your search / filter."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)]">
          <table className="w-full min-w-[60rem] text-sm">
            <thead>
              <tr className="border-b border-[var(--admin-border)] bg-[var(--admin-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--admin-text-muted)]">
                <th className="px-3 py-2.5 font-semibold">Product</th>
                <th className="px-3 py-2.5 font-semibold">Menu readiness</th>
                <th className="px-3 py-2.5 font-semibold">Next up</th>
                <th className="px-3 py-2.5 font-semibold">Source</th>
                <th className="px-3 py-2.5 font-semibold">Last changed</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const url = p.primary_media_id ? imageUrls[p.primary_media_id] : undefined;
                const r = readinessById.get(p.id);
                const isOpen = expanded.has(p.id);
                return (
                  <Row
                    key={p.id}
                    product={p}
                    imageUrl={url}
                    result={r}
                    isOpen={isOpen}
                    onToggle={() => toggle(p.id)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** A single product row plus its expandable readiness checklist. */
function Row({
  product: p,
  imageUrl: url,
  result: r,
  isOpen,
  onToggle,
}: {
  product: KbProductRow;
  imageUrl: string | undefined;
  result: MenuReadinessResult | undefined;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="border-b border-[var(--admin-border)] align-top last:border-b-0">
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

        <td className="px-3 py-2.5">
          {r ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <ReadinessChip result={r} />
                <button
                  type="button"
                  onClick={onToggle}
                  className="text-xs font-semibold text-[var(--admin-accent)] hover:underline"
                >
                  {isOpen ? "Hide checklist" : "Show checklist"}
                </button>
              </div>
              <Meter percent={r.percent} level={r.level} />
            </div>
          ) : (
            <span className="text-xs text-[var(--admin-text-faint)]">—</span>
          )}
        </td>

        <td className="px-3 py-2.5">
          {r?.nextUp ? (
            <div className="flex flex-col gap-1">
              <div className="text-xs text-[var(--admin-text-muted)]">
                Add <strong className="text-[var(--admin-text)]">{r.nextUp.label}</strong>
                {r.nextUp.note ? (
                  <span className="text-[var(--admin-text-faint)]"> — {r.nextUp.note}</span>
                ) : null}
              </div>
              <FixLink kind={r.nextUp.fixKind} />
            </div>
          ) : (
            <span className="rounded bg-[var(--admin-accent-soft)] px-2 py-0.5 text-[0.7rem] font-semibold text-[var(--admin-accent)]">
              menu-ready ✓
            </span>
          )}
        </td>

        <td className="whitespace-nowrap px-3 py-2.5 text-xs text-[var(--admin-text-faint)]">
          {p.source ?? "—"}
        </td>
        <td className="whitespace-nowrap px-3 py-2.5 text-xs text-[var(--admin-text-faint)]">
          {formatWhen(p.updated_at)}
        </td>
      </tr>

      {isOpen && r ? (
        <tr className="border-b border-[var(--admin-border)] bg-[var(--admin-surface-2)]/40">
          <td colSpan={5} className="px-3 py-3">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {r.items.map((it) => (
                <div
                  key={it.key}
                  className="flex items-start justify-between gap-3 rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-bg)] px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-sm">
                      <span aria-hidden>{it.done ? "✅" : "⬜"}</span>
                      <span
                        className={
                          it.done
                            ? "text-[var(--admin-text)]"
                            : "font-semibold text-[var(--admin-text)]"
                        }
                      >
                        {it.label}
                      </span>
                    </div>
                    {!it.done && it.note ? (
                      <div className="mt-0.5 text-xs text-[var(--admin-text-faint)]">{it.note}</div>
                    ) : null}
                  </div>
                  {!it.done ? <FixLink kind={it.fixKind} compact /> : null}
                </div>
              ))}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

/** The grade chip: percent + a friendly level word with a color dot. */
function ReadinessChip({ result }: { result: MenuReadinessResult }) {
  const map: Record<MenuReadinessResult["level"], { dot: string; text: string; label: string }> = {
    complete: { dot: "bg-emerald-400", text: "text-emerald-300", label: "Menu-ready" },
    good: { dot: "bg-[var(--admin-accent)]", text: "text-[var(--admin-accent)]", label: "Almost there" },
    started: { dot: "bg-[var(--admin-gold)]", text: "text-[var(--admin-gold)]", label: "Getting started" },
    empty: { dot: "bg-red-400", text: "text-red-300", label: "Needs work" },
  };
  const s = map[result.level];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--admin-border)] bg-[var(--admin-bg)] px-2 py-0.5 text-xs font-semibold">
      <span className={`h-2 w-2 rounded-full ${s.dot}`} aria-hidden />
      <span className={s.text}>{result.percent}%</span>
      <span className="text-[var(--admin-text-faint)]">· {s.label}</span>
    </span>
  );
}

/** Slim progress bar tinted by level. */
function Meter({ percent, level }: { percent: number; level: MenuReadinessResult["level"] }) {
  const fill =
    level === "complete"
      ? "bg-emerald-400"
      : level === "good"
        ? "bg-[var(--admin-accent)]"
        : level === "started"
          ? "bg-[var(--admin-gold)]"
          : "bg-red-400";
  return (
    <div className="h-1.5 w-40 max-w-full overflow-hidden rounded-full bg-[var(--admin-surface-2)]">
      <div className={`h-full ${fill}`} style={{ width: `${percent}%` }} />
    </div>
  );
}

/** The smart "Fix →" link routing to the right enrichment worklist gap. */
function FixLink({ kind, compact }: { kind: MenuReadinessFixKind; compact?: boolean }) {
  return (
    <a
      href={fixHrefForKind(kind)}
      title={fixHint(kind)}
      className={
        "inline-flex shrink-0 items-center gap-1 rounded-[var(--admin-radius)] border border-[var(--admin-accent)] px-2 py-0.5 text-xs font-semibold text-[var(--admin-accent)] transition hover:bg-[var(--admin-accent)] hover:text-black " +
        (compact ? "" : "self-start")
      }
    >
      Fix →
    </a>
  );
}

/** Compact, locale-stable date label; blank when unknown. */
function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "—";
  return t.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
