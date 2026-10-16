"use client";

/**
 * R58-S4 — one searchable, scrollable, category-filtered picker used for the
 * Shapes, Icons and Objects libraries (and the button icon picker), so every
 * library behaves the same: type to search (name, keywords, category), tap a
 * category chip to narrow, scroll the grid, tap a tile to add.
 */
import { useId, useMemo, useState, type ReactNode } from "react";

export type LibraryItem = { id: string; label: string; cat?: string; k?: string };

export function matchesLibrary(item: LibraryItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = `${item.label} ${item.id} ${item.k ?? ""} ${item.cat ?? ""}`.toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}

export function LibraryPicker({
  items,
  cats,
  noun,
  placeholder,
  disabled,
  thumb,
  onPick,
  toolbar,
  cols = "grid-cols-6 sm:grid-cols-10",
  maxH = "max-h-56",
  footer,
}: {
  items: LibraryItem[];
  cats?: string[];
  noun: string;
  placeholder: string;
  disabled?: boolean;
  thumb: (item: LibraryItem) => ReactNode;
  onPick: (item: LibraryItem) => void;
  toolbar?: ReactNode;
  cols?: string;
  maxH?: string;
  footer?: ReactNode;
}) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("");
  const listId = useId();
  const shown = useMemo(() => items.filter((i) => (!cat || i.cat === cat) && matchesLibrary(i, q)), [items, cat, q]);
  const chip = (on: boolean) =>
    on ? "shrink-0 rounded-full bg-[var(--admin-accent)] px-2 py-0.5 text-[0.65rem] font-bold text-black" : "shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[0.65rem] text-white/70 hover:bg-white/15";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          className="min-w-0 flex-1 rounded-md border border-white/15 bg-black/40 px-2 py-1 text-xs text-white outline-none focus:border-[var(--admin-accent)]"
          placeholder={placeholder}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label={`Search ${noun}`}
          aria-controls={listId}
        />
        {toolbar}
      </div>
      {cats && cats.length > 1 ? (
        <div className="flex gap-1 overflow-x-auto pb-1" role="group" aria-label={`${noun} categories`}>
          <button type="button" className={chip(!cat)} aria-pressed={!cat} onClick={() => setCat("")}>
            All
          </button>
          {cats.map((c) => (
            <button key={c} type="button" className={chip(cat === c)} aria-pressed={cat === c} onClick={() => setCat(cat === c ? "" : c)}>
              {c}
            </button>
          ))}
        </div>
      ) : null}
      <div id={listId} className={`grid ${cols} ${maxH} gap-1 overflow-y-auto overscroll-contain pr-1`}>
        {shown.map((i) => (
          <button
            key={i.id}
            type="button"
            disabled={disabled}
            onClick={() => onPick(i)}
            title={`Add ${i.label}`}
            aria-label={`Add ${i.label}`}
            className="flex aspect-square items-center justify-center rounded-md bg-black/30 p-1.5 text-white/85 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--admin-accent)] disabled:opacity-40"
          >
            {thumb(i)}
          </button>
        ))}
        {shown.length === 0 ? <p className="col-span-full py-2 text-xs text-white/45">No {noun} match “{q}”. Try another word.</p> : null}
      </div>
      <p className="text-[0.65rem] text-white/40" aria-live="polite">
        Showing {shown.length} of {items.length} {noun}
        {cat ? ` in ${cat}` : ""}.{footer ? <> {footer}</> : null}
      </p>
    </div>
  );
}
