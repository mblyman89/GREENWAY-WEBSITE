"use client";

/**
 * D263 S11 — Print Studio workspace (owner: "the controls and options ...
 * contained on the left side of the container, scrollable, so the canvas can
 * be made as large as possible").
 *
 * [rail][panel][ zoom viewport ........................................ ]
 *
 * - Rail: one icon button per tab (always visible, 4.5rem wide).
 * - Panel: the active tab's settings, scrolls on its own. Width modes:
 *   Auto (wider only for the tabs that need it), Narrow, Wide, or hidden
 *   (click the active tab again or press "\" to hide / show it).
 * - The whole workspace is one screen tall (below the admin header), so the
 *   canvas always fills what's left and the page itself barely scrolls.
 * The width choice is remembered in this browser.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";

export type WsTab = { id: string; icon: string; label: string; title?: string; badge?: number; wide?: boolean };
type Width = "auto" | "narrow" | "wide";
const KEY = "gw-print-panel";
const PX: Record<"narrow" | "wide", number> = { narrow: 320, wide: 460 };

function readW(): { w: Width; open: boolean } {
  try {
    const v = window.localStorage.getItem(KEY) ?? "";
    const [w, o] = v.split(":");
    return { w: w === "narrow" || w === "wide" ? w : "auto", open: o !== "0" };
  } catch {
    return { w: "auto", open: true };
  }
}

export function PrintWorkspace({
  tabs,
  tab,
  onTab,
  panel,
  viewport,
  headerTop,
  footer,
}: {
  tabs: WsTab[];
  tab: string;
  onTab: (id: string) => void;
  panel: ReactNode;
  viewport: ReactNode;
  /** Admin header height (px) — the workspace fills the screen below it. */
  headerTop: number;
  /** Small extras under the rail (e.g. the keys sheet button). */
  footer?: ReactNode;
}) {
  const [pref, setPref] = useState(readW);
  const save = (p: { w: Width; open: boolean }) => {
    setPref(p);
    try {
      window.localStorage.setItem(KEY, `${p.w}:${p.open ? 1 : 0}`);
    } catch {
      /* not remembered */
    }
  };
  const cur = tabs.find((t) => t.id === tab);
  const px = pref.w === "auto" ? (cur?.wide ? PX.wide : PX.narrow) : PX[pref.w];
  const wsRef = useRef<HTMLDivElement>(null);

  // "\" toggles the panel (not while typing).
  const live = useRef({ pref, save });
  useEffect(() => {
    live.current = { pref, save };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== "\\" || e.ctrlKey || e.metaKey || e.altKey || t?.closest?.("input, textarea, select") || t?.isContentEditable) return;
      if (!wsRef.current?.contains(document.activeElement) && !wsRef.current?.matches(":hover")) return;
      e.preventDefault();
      const { pref: p, save: s } = live.current;
      s({ ...p, open: !p.open });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const railBtn = (t: WsTab) => {
    const on = t.id === tab;
    return (
      <button
        key={t.id}
        type="button"
        role="tab"
        aria-selected={on}
        title={t.title ?? t.label}
        onClick={() => (on ? save({ ...pref, open: !pref.open }) : (onTab(t.id), !pref.open && save({ ...pref, open: true })))}
        className={`relative flex w-full flex-col items-center gap-0.5 rounded-md px-1 py-2 text-[0.65rem] leading-tight ${
          on && pref.open ? "bg-[var(--admin-accent)]/20 font-bold text-white" : on ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/10 hover:text-white"
        }`}
      >
        <span className="text-base leading-none" aria-hidden="true">
          {t.icon}
        </span>
        {t.label}
        {t.badge ? <span className="absolute right-1 top-1 rounded-full bg-[var(--admin-orange)] px-1 text-[0.6rem] font-bold text-black">{t.badge}</span> : null}
      </button>
    );
  };
  const wBtn = (w: Width, label: string, title: string) => (
    <button
      type="button"
      onClick={() => save({ w, open: true })}
      aria-pressed={pref.w === w}
      title={title}
      className={pref.w === w ? "rounded bg-white/20 px-1.5 py-0.5 text-white" : "rounded px-1.5 py-0.5 text-white/55 hover:bg-white/10 hover:text-white"}
    >
      {label}
    </button>
  );

  return (
    <div
      ref={wsRef}
      className="flex gap-2"
      style={{ height: `calc(100dvh - ${headerTop + 24}px)`, minHeight: 540, scrollMarginTop: headerTop + 12 }}
    >
      <div className="flex w-[4.5rem] shrink-0 flex-col gap-1 overflow-y-auto rounded-md bg-white/5 p-1" role="tablist" aria-label="Design tools" aria-orientation="vertical">
        {tabs.map(railBtn)}
        <div className="mt-auto flex flex-col gap-1 pt-2">
          {footer}
          <button
            type="button"
            onClick={() => wsRef.current?.scrollIntoView({ block: "start", behavior: "smooth" })}
            title="Line the workspace up with the top of the screen"
            className="rounded-md px-1 py-1.5 text-[0.65rem] text-white/60 hover:bg-white/10 hover:text-white"
          >
            ⤒ Fill screen
          </button>
        </div>
      </div>
      {pref.open ? (
        <div className="flex shrink-0 flex-col overflow-hidden rounded-md border border-white/10 bg-black/25 transition-[width] duration-150" style={{ width: px }}>
          <div className="flex items-center justify-between gap-1 border-b border-white/10 px-2 py-1.5 text-xs">
            <span className="truncate font-semibold text-white">{cur ? `${cur.icon} ${cur.title ?? cur.label}` : ""}</span>
            <span className="flex shrink-0 items-center gap-0.5 text-[0.65rem]" aria-label="Panel width">
              {wBtn("auto", "Auto", "Auto width: wider only for tabs that need room")}
              {wBtn("narrow", "S", "Narrow panel (more canvas)")}
              {wBtn("wide", "L", "Wide panel (more room for settings)")}
              <button type="button" onClick={() => save({ ...pref, open: false })} title="Hide the panel (\\). Click a tab to bring it back." className="rounded px-1.5 py-0.5 text-white/55 hover:bg-white/10 hover:text-white" aria-label="Hide panel">
                «
              </button>
            </span>
          </div>
          <div role="tabpanel" className="gw-side min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 [scrollbar-gutter:stable]">
            {panel}
          </div>
        </div>
      ) : null}
      <div className="min-w-0 flex-1">{viewport}</div>
    </div>
  );
}
