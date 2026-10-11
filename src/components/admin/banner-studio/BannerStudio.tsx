"use client";

/**
 * R41 S2 — Banner Studio (bible PART 5.6). Controlled component: the parent
 * (SectionCard, later the Specials / page editors) owns the design and saves
 * it through its existing form (settings_json → normalizeDesign on the server).
 *
 * Layout: device toggle + undo/redo on top, the live canvas, then tabs:
 * Text · Buttons · Picture · Checks.
 *
 * Undo/redo: rapid changes (a drag fires many updates) are grouped into one
 * history step when they arrive within 600 ms of each other, so a single
 * Ctrl+Z puts a dragged box back where it started.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/admin/ux";
import { checkDesign, type BannerDesign, type DesignDevice } from "@/lib/cms/banner-design-core";
import { StudioCanvas, type StudioSelection } from "./StudioCanvas";
import { TextBoxPanel } from "./TextBoxPanel";
import { ButtonPanel } from "./ButtonPanel";
import { ImagePanel } from "./ImagePanel";
import { WarningsPanel } from "./WarningsPanel";
import type { PickerPost } from "./LinkPicker";

type Tab = "text" | "buttons" | "picture" | "checks";
const HISTORY_MAX = 60;
const GROUP_MS = 600;

export function BannerStudio({
  design,
  onChange,
  legacy,
  imageSrc,
  imageAlt,
  posts,
}: {
  design: BannerDesign;
  onChange: (d: BannerDesign) => void;
  legacy: { eyebrow?: string; title?: string; subtitle?: string };
  imageSrc: string;
  imageAlt: string;
  posts: PickerPost[];
}) {
  const [device, setDevice] = useState<DesignDevice>("desktop");
  const [tab, setTab] = useState<Tab>("text");
  const [selection, setSelection] = useState<StudioSelection>(null);
  const [pendingDelete, setPendingDelete] = useState<NonNullable<StudioSelection> | null>(null);
  const past = useRef<BannerDesign[]>([]);
  const future = useRef<BannerDesign[]>([]);
  const lastPush = useRef(0);
  const [counts, setCounts] = useState({ undo: 0, redo: 0 });
  const sync = useCallback(() => setCounts({ undo: past.current.length, redo: future.current.length }), []);
  const rootRef = useRef<HTMLDivElement>(null);

  const change = useCallback(
    (next: BannerDesign) => {
      const now = Date.now();
      if (now - lastPush.current > GROUP_MS) {
        past.current = [...past.current, design].slice(-HISTORY_MAX);
        future.current = [];
      }
      lastPush.current = now;
      onChange(next);
      sync();
    },
    [design, onChange, sync],
  );

  const undo = useCallback(() => {
    const prev = past.current[past.current.length - 1];
    if (!prev) return;
    past.current = past.current.slice(0, -1);
    future.current = [design, ...future.current].slice(0, HISTORY_MAX);
    lastPush.current = 0;
    onChange(prev);
    sync();
  }, [design, onChange, sync]);

  const redo = useCallback(() => {
    const nxt = future.current[0];
    if (!nxt) return;
    future.current = future.current.slice(1);
    past.current = [...past.current, design].slice(-HISTORY_MAX);
    lastPush.current = 0;
    onChange(nxt);
    sync();
  }, [design, onChange, sync]);

  // Ctrl/Cmd+Z, Ctrl+Shift+Z / Ctrl+Y — only while focus is inside the studio
  // and not while typing in a text field (the browser's own text undo wins there).
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select")) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((k === "z" && e.shiftKey) || k === "y") {
        e.preventDefault();
        redo();
      }
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  function select(s: StudioSelection) {
    setSelection(s);
    if (s?.target === "box" && tab !== "text") setTab("text");
    if (s?.target === "button" && tab !== "buttons") setTab("buttons");
  }

  function confirmDelete() {
    const s = pendingDelete;
    setPendingDelete(null);
    if (!s) return;
    if (s.target === "box") change({ ...design, boxes: design.boxes.filter((b) => b.id !== s.id) });
    else change({ ...design, buttons: design.buttons.filter((b) => b.id !== s.id) });
    setSelection(null);
  }

  function resetPhone() {
    change({
      ...design,
      image: { ...design.image, focusXMobile: null, focusYMobile: null },
      boxes: design.boxes.map((b) => ({ ...b, mx: null, my: null, mw: null })),
      buttons: design.buttons.map((b) => ({ ...b, mx: null, my: null })),
    });
  }

  const hasPhoneOverrides =
    design.image.focusXMobile !== null ||
    design.image.focusYMobile !== null ||
    design.boxes.some((b) => b.mx !== null || b.my !== null || b.mw !== null) ||
    design.buttons.some((b) => b.mx !== null || b.my !== null);

  const warnCount = checkDesign(design, legacy).length;
  const tabBtn = (id: Tab, label: string) => (
    <button
      key={id}
      type="button"
      role="tab"
      aria-selected={tab === id}
      onClick={() => setTab(id)}
      className={
        tab === id
          ? "rounded-t-md border-b-2 border-[var(--admin-accent)] px-3 py-1.5 text-xs font-bold text-white"
          : "rounded-t-md px-3 py-1.5 text-xs text-white/60 hover:text-white"
      }
    >
      {label}
    </button>
  );

  return (
    <div ref={rootRef} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="radiogroup" aria-label="Preview size" className="flex gap-1">
          {(["desktop", "mobile"] as DesignDevice[]).map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={device === d}
              onClick={() => setDevice(d)}
              className={
                device === d
                  ? "rounded-full bg-[var(--admin-accent)] px-3 py-1 text-xs font-bold text-black"
                  : "rounded-full bg-white/10 px-3 py-1 text-xs text-white/75 hover:bg-white/20"
              }
            >
              {d === "desktop" ? "🖥 Computer" : "📱 Phone"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={undo} disabled={!counts.undo} className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/80 hover:bg-white/20 disabled:opacity-30" title="Undo (Ctrl+Z)">
            ↶ Undo
          </button>
          <button type="button" onClick={redo} disabled={!counts.redo} className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/80 hover:bg-white/20 disabled:opacity-30" title="Redo (Ctrl+Shift+Z)">
            ↷ Redo
          </button>
        </div>
      </div>

      {device === "mobile" ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-[var(--admin-orange)]/12 px-3 py-1.5 text-xs text-[var(--admin-orange)]">
          <span>📱 Phone layout: moves and sizes here only change how the banner looks on phones.</span>
          {hasPhoneOverrides ? (
            <button type="button" className="underline" onClick={resetPhone}>
              Reset phone layout
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="rounded-lg bg-black/40 p-2">
        <StudioCanvas
          design={design}
          device={device}
          legacy={legacy}
          imageSrc={imageSrc}
          imageAlt={imageAlt}
          selection={selection}
          onSelect={select}
          onChange={change}
          onRequestDelete={setPendingDelete}
        />
      </div>
      <p className="text-[0.7rem] text-white/45">
        Drag text and buttons to move them · drag the green handle to change wrap width · arrow keys nudge (Shift = bigger steps) · hold Alt to stop snapping · Delete removes.
      </p>

      <div role="tablist" className="flex flex-wrap gap-1 border-b border-white/10">
        {tabBtn("text", "✏️ Text")}
        {tabBtn("buttons", "🔘 Buttons")}
        {tabBtn("picture", "🖼 Picture & shade")}
        {tabBtn("checks", warnCount ? `⚠️ Checks (${warnCount})` : "✓ Checks")}
      </div>
      <div role="tabpanel">
        {tab === "text" ? (
          <TextBoxPanel design={design} device={device} legacy={legacy} selection={selection} onSelect={select} onChange={change} onRequestDelete={setPendingDelete} />
        ) : tab === "buttons" ? (
          <ButtonPanel design={design} device={device} posts={posts} selection={selection} onSelect={select} onChange={change} onRequestDelete={setPendingDelete} />
        ) : tab === "picture" ? (
          <ImagePanel design={design} device={device} imageSrc={imageSrc} onChange={change} />
        ) : (
          <WarningsPanel design={design} legacy={legacy} onSelect={select} />
        )}
      </div>

      <ConfirmDialog
        open={!!pendingDelete}
        title={pendingDelete?.target === "button" ? "Delete this button?" : "Delete this text box?"}
        description="You can bring it back with Undo until you leave the page."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

export default BannerStudio;
