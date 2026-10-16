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
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { ConfirmDialog } from "@/components/admin/ux";
import { checkDesign, mobileImageSrc, type BannerDesign, type DesignBind, type DesignDevice } from "@/lib/cms/banner-design-core";
import type { MediaChoice } from "@/components/admin/ContentImageField";
import { StudioCanvas, type StudioSelection } from "./StudioCanvas";
import { TextBoxPanel } from "./TextBoxPanel";
import { ButtonPanel } from "./ButtonPanel";
import { ImagePanel } from "./ImagePanel";
import { WarningsPanel } from "./WarningsPanel";
import { ShapePanel } from "./ShapePanel";
import { SmokePanel } from "./SmokePanel";
import { AnimPanel } from "./AnimPanel";
import { AnimatePanel } from "./AnimatePanel";
import { IntroFields } from "./IntroFields";
import { LayersPanel } from "./LayersPanel";
import { CustomFontFaces } from "@/components/admin/fonts/CustomFontUpload";
import { ArrangeBar } from "./ArrangeBar";
import { toggleRef, type ItemRef } from "@/lib/cms/banner-arrange-core";
import type { PickerPost } from "./LinkPicker";
import { applySuggestion, type PlacementSuggestion } from "@/lib/cms/banner-ai-core";
import { suggestBannerPlacementAction } from "@/app/admin/banner-ai-actions";

type Tab = "text" | "buttons" | "shapes" | "anims" | "animate" | "smoke" | "layers" | "picture" | "checks";
const HISTORY_MAX = 60;
const GROUP_MS = 600;

export function BannerStudio({
  design,
  onChange,
  legacy,
  imageSrc,
  imageAlt,
  posts,
  mediaChoices,
  onLegacyEdit,
}: {
  design: BannerDesign;
  onChange: (d: BannerDesign) => void;
  legacy: { eyebrow?: string; title?: string; subtitle?: string };
  imageSrc: string;
  imageAlt: string;
  posts: PickerPost[];
  /** R42 Q4: media library choices for the optional phone picture. */
  mediaChoices?: MediaChoice[];
  /** R53: double-click editing of a bound box writes the banner's own field (omit = bound boxes not inline-editable). */
  onLegacyEdit?: (bind: NonNullable<DesignBind>, text: string) => void;
}) {
  const [device, setDevice] = useState<DesignDevice>("desktop");
  // R53: one picture per banner (the R42 phone picture was removed).
  const deviceSrc = imageSrc;
  const [tab, setTab] = useState<Tab>("text");
  const [replayKey, setReplayKey] = useState(0);
  // R59: entrance controls anywhere in the Studio ask for a replay via this event.
  // R63: every replay also acts out hover + click effects for a moment.
  const [demo, setDemo] = useState(false);
  const demoT = useRef(0);
  const replay = useCallback(() => {
    setReplayKey((k) => k + 1);
    setDemo(true);
    window.clearTimeout(demoT.current);
    demoT.current = window.setTimeout(() => setDemo(false), 1900);
  }, []);
  useEffect(() => {
    window.addEventListener("gw-studio-replay", replay);
    return () => window.removeEventListener("gw-studio-replay", replay);
  }, [replay]);
  const [selection, setSelection] = useState<StudioSelection>(null);
  // R56: shift-click group (2+ items); empty = single selection only.
  const [group, setGroup] = useState<ItemRef[]>([]);
  const [pendingDelete, setPendingDelete] = useState<NonNullable<StudioSelection> | null>(null);
  const past = useRef<BannerDesign[]>([]);
  const future = useRef<BannerDesign[]>([]);
  const lastPush = useRef(0);
  const [counts, setCounts] = useState({ undo: 0, redo: 0 });
  const sync = useCallback(() => setCounts({ undo: past.current.length, redo: future.current.length }), []);
  const rootRef = useRef<HTMLDivElement>(null);
  // R41 S8: AI suggestion (drafts only — Apply changes unsaved studio state).
  const [ai, setAi] = useState<{ s: PlacementSuggestion; device: DesignDevice } | null>(null);
  const [aiMsg, setAiMsg] = useState<string | null>(null);
  const [aiBusy, startAi] = useTransition();

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
      if (t.closest("input, textarea, select") || t.isContentEditable) return;
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

  function toggle(r: ItemRef) {
    const base = group.length ? group : selection ? [selection] : [];
    const next = toggleRef(base, r);
    if (next.length > 1) {
      setGroup(next);
      setSelection(next[next.length - 1]!);
    } else {
      setGroup([]);
      setSelection(next[0] ?? null);
    }
  }

  function selectMany(refs: ItemRef[]) {
    if (refs.length > 1) {
      setGroup(refs);
      setSelection(refs[0]!);
    } else select(refs[0] ?? null);
  }

  function select(s: StudioSelection) {
    setGroup([]);
    setSelection(s);
    if (s?.target === "box" && tab !== "text") setTab("text");
    if (s?.target === "button" && tab !== "buttons") setTab("buttons");
    // R55: shapes open their own tab (unless the owner is working in Layers).
    // R60: Lottie / Rive layers open the 🎞️ Animations tab.
    const isAnim = s?.target === "element" && design.elements?.find((e) => e.id === s.id)?.kind === "anim";
    if (s?.target === "element" && tab !== "layers") {
      if (isAnim && tab !== "anims") setTab("anims");
      if (!isAnim && tab !== "shapes") setTab("shapes");
    }
  }

  function confirmDelete() {
    const s = pendingDelete;
    setPendingDelete(null);
    if (!s) return;
    const order = design.order?.filter((id) => id !== s.id);
    const rest = { ...design, ...(design.order ? { order: order?.length ? order : undefined } : {}) };
    if (s.target === "box") change({ ...rest, boxes: design.boxes.filter((b) => b.id !== s.id) });
    else if (s.target === "element") change({ ...rest, elements: (design.elements ?? []).filter((e) => e.id !== s.id) });
    else change({ ...rest, buttons: design.buttons.filter((b) => b.id !== s.id) });
    setSelection(null);
  }

  function askAi() {
    setAiMsg(null);
    setAi(null);
    const forDevice = device;
    startAi(async () => {
      try {
        const res = await suggestBannerPlacementAction({
          imageSrc: forDevice === "mobile" ? mobileImageSrc(design, imageSrc) : imageSrc,
          design,
          legacy,
          device: forDevice,
        });
        if (res.ok) setAi({ s: res.suggestion, device: forDevice });
        else setAiMsg(res.message);
      } catch {
        setAiMsg("Couldn't reach the server. Check your connection and try again.");
      }
    });
  }

  function applyAi() {
    if (!ai) return;
    if (ai.device !== device) setDevice(ai.device);
    change(applySuggestion(design, ai.s, legacy, ai.device));
    setAi(null);
    setAiMsg("Applied. Not saved yet — press Save draft when you're happy (Undo puts it back).");
  }

  function resetPhone() {
    change({
      ...design,
      image: { ...design.image, focusXMobile: null, focusYMobile: null },
      boxes: design.boxes.map((b) => ({ ...b, mx: null, my: null, mw: null })),
      buttons: design.buttons.map((b) => ({ ...b, mx: null, my: null })),
      ...(design.elements ? { elements: design.elements.map((e) => ({ ...e, mx: null, my: null, mw: null, mh: null })) } : {}),
    });
  }

  const hasPhoneOverrides =
    design.image.focusXMobile !== null ||
    design.image.focusYMobile !== null ||
    design.boxes.some((b) => b.mx !== null || b.my !== null || b.mw !== null) ||
    design.buttons.some((b) => b.mx !== null || b.my !== null) ||
    (design.elements ?? []).some((e) => e.mx !== null || e.my !== null || e.mw !== null || e.mh !== null);

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
      <CustomFontFaces />
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

      <div className="rounded-md border border-[#ffd700]/30 bg-[#ffd700]/5 px-3 py-2 text-xs text-white/80">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={askAi}
            disabled={aiBusy || !imageSrc}
            className="rounded-full bg-[#ffd700] px-3 py-1 text-xs font-bold text-black hover:bg-[#ffe34d] disabled:opacity-40"
            title={imageSrc ? "AI looks at the picture and suggests where the text and focus should go" : "Pick a picture first"}
          >
            {aiBusy ? "✨ Looking at the picture…" : `✨ AI suggest (${device === "mobile" ? "phone" : "computer"})`}
          </button>
          <span className="text-white/55">Suggests the picture focus, where the text fits best, the shade and text colour. Nothing is saved until you press Save.</span>
        </div>
        {ai ? (
          <div className="mt-2 flex flex-wrap items-center gap-2" aria-live="polite">
            <span className="text-[#ffd700]">
              Suggestion for {ai.device === "mobile" ? "phone" : "computer"} (dotted box = text area, ring = focus):
            </span>
            <span className="text-white/80">{ai.s.reason || "No reason given."}</span>
            <button type="button" onClick={applyAi} className="rounded-full bg-[var(--admin-accent)] px-3 py-1 font-bold text-black">
              Apply
            </button>
            <button type="button" onClick={() => setAi(null)} className="rounded-full bg-white/10 px-3 py-1 text-white/80 hover:bg-white/20">
              Dismiss
            </button>
          </div>
        ) : aiMsg ? (
          <p className="mt-2 text-white/75" aria-live="polite">{aiMsg}</p>
        ) : null}
      </div>

      <div className={`rounded-lg bg-black/40 p-2${demo ? " gw-demo" : ""}`}>
        <StudioCanvas
          ghost={ai && ai.device === device ? { zone: ai.s.textZone, focusX: ai.s.focusX, focusY: ai.s.focusY } : null}
          design={design}
          device={device}
          legacy={legacy}
          imageSrc={deviceSrc}
          imageAlt={imageAlt}
          selection={selection}
          onSelect={select}
          onChange={change}
          onRequestDelete={setPendingDelete}
          onLegacyEdit={onLegacyEdit}
          group={group}
          onToggle={toggle}
          replayKey={replayKey}
        />
      </div>
      {/* R63: one-tap replay of every motion/smoke/entrance on the canvas. */}
      <div className="-mt-1 flex justify-end">
        <button type="button" onClick={replay} className="rounded-full bg-amber-500/90 px-3 py-1 text-xs font-bold text-black hover:bg-amber-400" title="Replay all motion, entrances and smoke on the canvas">▶ Replay</button>
      </div>
      <ArrangeBar
        design={design}
        device={device}
        refs={group.length > 1 ? group : selection ? [selection] : []}
        rootRef={rootRef}
        legacy={legacy}
        onChange={change}
        onSelectMany={selectMany}
      />
      <p className="text-[0.7rem] text-white/45">
        Drag text and buttons to move them · double-click text to type on it (Enter = new line, Esc or click away to finish) · drag the green handle to change wrap width · drag the gold knob to rotate (Shift = 15° steps) · Shift-click to select several, then drag them together or use Arrange · Ctrl/⌘+C / V / D copy, paste (into any banner), duplicate · click an item, then arrow keys nudge it (Shift = bigger steps) · 🔒 locked items stay put · Ctrl/⌘+Z undo · hold Alt to stop snapping · Delete removes.
      </p>

      <div role="tablist" className="flex flex-wrap gap-1 border-b border-white/10">
        {tabBtn("text", "✏️ Text")}
        {tabBtn("buttons", "🔘 Buttons")}
        {tabBtn("shapes", "◆ Shapes & icons")}
        {tabBtn("anims", "🎞️ Lottie & Rive")}
        {tabBtn("animate", "✨ Animate")}
        {tabBtn("smoke", "💨 Smoke & fog")}
        {tabBtn("layers", "☰ Layers")}
        {tabBtn("picture", "🖼 Picture & shade")}
        {tabBtn("checks", warnCount ? `⚠️ Checks (${warnCount})` : "✓ Checks")}
      </div>
      <div role="tabpanel">
        {tab === "text" ? (
          <TextBoxPanel design={design} device={device} legacy={legacy} selection={selection} onSelect={select} onChange={change} onRequestDelete={setPendingDelete} />
        ) : tab === "buttons" ? (
          <ButtonPanel design={design} device={device} posts={posts} selection={selection} onSelect={select} onChange={change} onRequestDelete={setPendingDelete} />
        ) : tab === "shapes" ? (
          <ShapePanel design={design} device={device} selection={selection} onSelect={select} onChange={change} onRequestDelete={setPendingDelete} />
        ) : tab === "anims" ? (
          <AnimPanel design={design} device={device} selection={selection} onSelect={select} onChange={change} onRequestDelete={setPendingDelete} />
        ) : tab === "animate" ? (
          <AnimatePanel design={design} onChange={change} onSelect={select}>
            <IntroFields design={design} onChange={change} mediaChoices={mediaChoices} />
          </AnimatePanel>
        ) : tab === "smoke" ? (
          <SmokePanel design={design} device={device} imageSrc={deviceSrc} onChange={change} onReplay={replay} mediaChoices={mediaChoices} />
        ) : tab === "layers" ? (
          <LayersPanel design={design} legacy={legacy} selection={selection} onSelect={select} onChange={change} />
        ) : tab === "picture" ? (
          <ImagePanel design={design} device={device} imageSrc={deviceSrc} onChange={change} mediaChoices={mediaChoices} />
        ) : (
          <WarningsPanel design={design} legacy={legacy} onSelect={select} />
        )}
      </div>

      <ConfirmDialog
        open={!!pendingDelete}
        title={pendingDelete?.target === "button" ? "Delete this button?" : pendingDelete?.target === "element" ? (design.elements?.find((e) => e.id === pendingDelete.id)?.kind === "anim" ? "Delete this animation?" : "Delete this shape or icon?") : "Delete this text box?"}
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
