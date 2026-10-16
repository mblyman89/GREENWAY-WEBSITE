"use client";

/**
 * R63 — THE one shared card-editor UI.
 *
 * Every card editor in the admin (home Type cards, Specials weekday cards, and
 * any future card set) goes through this shell, so the owner only ever updates
 * ONE component:
 *
 *   • a header (title, count, unsaved badge, short intro),
 *   • a preview strip along the top that scrolls LEFT / RIGHT (never wraps to a
 *     new row — 7 Specials cards stay on one line). Click a tile to edit it,
 *   • one row per card: ▲ ▼ reorder, number, name → link, badges, Show, Edit,
 *   • the open card's editor (Design Studio first — the editors open it
 *     automatically — then Basic mode collapsed underneath).
 *
 * Data stays per editor (each keeps its own model + save); only the UI is
 * shared. Controlled component: the parent owns `openId`.
 */
import { useRef, type ReactNode } from "react";
import { Button } from "@/components/admin/ui";

export type CardShellItem = {
  id: string;
  /** Row name (newlines are shown as spaces). */
  name: string;
  /** Small grey hint after the name (e.g. "→ Flower menu"). */
  sub?: string;
  shown: boolean;
  /** Small pills after the name (e.g. "photo", "published promo"). */
  badges?: ReactNode;
  /** The mini card for the preview strip. */
  tile: ReactNode;
};

export function CardEditorShell({
  icon,
  title,
  count,
  dirty,
  intro,
  previewLabel = "Preview (scroll sideways · click a card to edit it)",
  items,
  openId,
  onOpen,
  onMove,
  onShownChange,
  renderEditor,
  footer,
  emptyNote,
}: {
  icon: string;
  title: string;
  /** e.g. "6 / 12 cards · 5 showing". */
  count: string;
  dirty: boolean;
  intro: ReactNode;
  previewLabel?: string;
  items: CardShellItem[];
  openId: string | null;
  onOpen: (id: string | null) => void;
  onMove: (index: number, dir: -1 | 1) => void;
  onShownChange: (id: string, shown: boolean) => void;
  renderEditor: (id: string) => ReactNode;
  /** Under the list (add / reset buttons, section settings, …). */
  footer?: ReactNode;
  /** Shown in the strip when no card is showing. */
  emptyNote?: ReactNode;
}) {
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const openFromTile = (id: string) => {
    onOpen(id);
    // Bring the row (and its studio) into view once it has opened.
    requestAnimationFrame(() => rowRefs.current.get(id)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const showing = items.filter((i) => i.shown).length;

  return (
    <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-base">{icon}</span>
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <span className="rounded-full border border-white/15 px-2 py-0.5 text-[0.6rem] font-semibold text-white/50">{count}</span>
        {dirty ? (
          <span className="rounded-full bg-[var(--admin-gold)]/15 px-2 py-0.5 text-[0.65rem] font-semibold text-[var(--admin-gold)]">
            ● unsaved edits
          </span>
        ) : null}
      </div>
      <div className="mb-4 text-xs text-white/50">{intro}</div>

      {/* Preview strip — one row, scrolls sideways. */}
      <div className="mb-5 rounded-[var(--admin-radius)] border border-white/10 bg-black/30 p-3">
        <p className="mb-2 text-[0.68rem] font-semibold uppercase tracking-wide text-white/60">{previewLabel}</p>
        {showing === 0 && emptyNote ? <p className="mb-2 text-xs text-[var(--admin-gold)]">{emptyNote}</p> : null}
        <div className="flex snap-x gap-2 overflow-x-auto pb-2" aria-label={`${title} preview`}>
          {items.map((it) => (
            <div
              key={it.id}
              role="button"
              tabIndex={0}
              onClick={() => openFromTile(it.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openFromTile(it.id);
                }
              }}
              aria-label={`Edit ${it.name.replace(/\n/g, " ")}`}
              aria-pressed={openId === it.id}
              className={`w-32 shrink-0 cursor-pointer snap-start rounded-lg text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--admin-accent)] sm:w-36 ${
                openId === it.id ? "ring-2 ring-[var(--admin-accent)]" : "ring-1 ring-transparent hover:ring-white/30"
              } ${it.shown ? "" : "opacity-40"}`}
            >
              <span className="pointer-events-none block">{it.tile}</span>
              {!it.shown ? <span className="mt-1 block text-center text-[0.6rem] text-white/50">hidden</span> : null}
            </div>
          ))}
        </div>
      </div>

      <ol className="space-y-2">
        {items.map((it, i) => {
          const open = openId === it.id;
          return (
            <li
              key={it.id}
              ref={(el) => {
                if (el) rowRefs.current.set(it.id, el);
                else rowRefs.current.delete(it.id);
              }}
              className={`scroll-mt-24 rounded-[var(--admin-radius)] border ${it.shown ? "border-white/10" : "border-dashed border-white/10 opacity-80"} bg-black/20`}
            >
              <div className="flex flex-wrap items-center gap-2 p-2">
                <div className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => onMove(i, -1)}
                    disabled={i === 0}
                    aria-label={`Move ${it.name || "card"} up`}
                    className="rounded px-1.5 text-xs text-white/70 hover:bg-white/10 disabled:opacity-30"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    onClick={() => onMove(i, 1)}
                    disabled={i === items.length - 1}
                    aria-label={`Move ${it.name || "card"} down`}
                    className="rounded px-1.5 text-xs text-white/70 hover:bg-white/10 disabled:opacity-30"
                  >
                    ▼
                  </button>
                </div>
                <span className="w-5 text-center text-xs text-white/40">{i + 1}</span>
                <button
                  type="button"
                  onClick={() => onOpen(open ? null : it.id)}
                  aria-expanded={open}
                  className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-white"
                >
                  {it.name.replace(/\n/g, " ")}
                  {it.sub ? <span className="ml-2 text-xs font-normal text-white/40">{it.sub}</span> : null}
                </button>
                {it.badges}
                <label className="inline-flex items-center gap-1.5 text-xs text-white/80">
                  <input type="checkbox" checked={it.shown} onChange={(e) => onShownChange(it.id, e.target.checked)} />
                  Show
                </label>
                <Button type="button" variant="neutral" size="sm" onClick={() => onOpen(open ? null : it.id)}>
                  {open ? "Close" : "Edit"}
                </Button>
              </div>
              {open ? <div className="space-y-3 border-t border-white/10 p-3">{renderEditor(it.id)}</div> : null}
            </li>
          );
        })}
      </ol>

      {footer ? <div className="mt-3">{footer}</div> : null}
    </div>
  );
}
