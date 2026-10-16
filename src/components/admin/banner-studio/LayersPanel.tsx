"use client";

/**
 * R55-S2 — Layers tab (Canva / Figma pattern): every text box, button and
 * shape, front-most at the top. Bring forward / send backward / to front /
 * to back, lock and show/hide per layer. Reordering writes `design.order`
 * (painted with z-index; the site's reading order is unchanged — WCAG 1.3.2).
 */
import { designLayers, resolveBoxText, roleInfo, type BannerDesign } from "@/lib/cms/banner-design-core";
import { elementLabel, moveLayer, type LayerKind, type LayerMove } from "@/lib/cms/banner-elements-core";
import type { StudioSelection } from "./StudioCanvas";

const ICON: Record<LayerKind, string> = { box: "✏️", button: "🔘", element: "◆" };

export function LayersPanel({
  design,
  legacy,
  selection,
  onSelect,
  onChange,
}: {
  design: BannerDesign;
  legacy: { eyebrow?: string; title?: string; subtitle?: string };
  selection: StudioSelection;
  onSelect: (s: StudioSelection) => void;
  onChange: (d: BannerDesign) => void;
}) {
  const layers = designLayers(design);
  const ids = layers.map((l) => l.id);
  const frontFirst = layers.slice().reverse();

  function info(kind: LayerKind, id: string): { name: string; locked: boolean; visible: boolean } {
    if (kind === "box") {
      const b = design.boxes.find((x) => x.id === id)!;
      const t = resolveBoxText(b, legacy).trim();
      return { name: `${roleInfo(b.role).label}${t ? ` — ${t.slice(0, 32)}` : ""}`, locked: !!b.locked, visible: !b.hidden };
    }
    if (kind === "button") {
      const b = design.buttons.find((x) => x.id === id)!;
      return { name: `Button — ${b.label}`, locked: !!b.locked, visible: b.enabled };
    }
    const e = (design.elements ?? []).find((x) => x.id === id)!;
    return { name: elementLabel(e), locked: !!e.locked, visible: !e.hidden };
  }

  function move(id: string, m: LayerMove) {
    onChange({ ...design, order: moveLayer(ids, id, m) });
  }

  function setFlag(kind: LayerKind, id: string, flag: "locked" | "visible", v: boolean) {
    if (kind === "box")
      onChange({ ...design, boxes: design.boxes.map((b) => (b.id !== id ? b : flag === "locked" ? { ...b, locked: v || undefined } : { ...b, hidden: !v })) });
    else if (kind === "button")
      onChange({ ...design, buttons: design.buttons.map((b) => (b.id !== id ? b : flag === "locked" ? { ...b, locked: v || undefined } : { ...b, enabled: v })) });
    else
      onChange({
        ...design,
        elements: (design.elements ?? []).map((e) => (e.id !== id ? e : flag === "locked" ? { ...e, locked: v || undefined } : { ...e, hidden: !v })),
      });
  }

  const iconBtn = "rounded px-1.5 py-0.5 text-xs text-white/70 hover:bg-white/10 disabled:opacity-25";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-white/70">Layers — front at the top</span>
        {design.order ? (
          <button type="button" className="text-xs text-white/55 underline" onClick={() => onChange({ ...design, order: undefined })}>
            Reset order
          </button>
        ) : null}
      </div>
      {frontFirst.length === 0 ? <p className="text-xs text-white/45">Nothing on the banner yet.</p> : null}
      <ul className="space-y-1">
        {frontFirst.map((l, i) => {
          const it = info(l.kind, l.id);
          const sel = selection?.target === l.kind && selection.id === l.id;
          const atFront = i === 0;
          const atBack = i === frontFirst.length - 1;
          return (
            <li
              key={l.id}
              className={`flex items-center gap-1 rounded-md px-1.5 py-1 ${sel ? "bg-[var(--admin-accent-soft)]" : "hover:bg-white/5"}`}
            >
              <button
                type="button"
                onClick={() => onSelect({ target: l.kind, id: l.id })}
                className={`min-w-0 flex-1 truncate text-left text-xs ${it.visible ? "text-white/85" : "text-white/35 line-through"}`}
              >
                <span aria-hidden="true">{ICON[l.kind]}</span> {it.name}
              </button>
              <button type="button" className={iconBtn} disabled={atFront} onClick={() => move(l.id, "front")} title="Bring to front" aria-label={`Bring ${it.name} to front`}>
                ⤒
              </button>
              <button type="button" className={iconBtn} disabled={atFront} onClick={() => move(l.id, "forward")} title="Bring forward" aria-label={`Bring ${it.name} forward`}>
                ↑
              </button>
              <button type="button" className={iconBtn} disabled={atBack} onClick={() => move(l.id, "backward")} title="Send backward" aria-label={`Send ${it.name} backward`}>
                ↓
              </button>
              <button type="button" className={iconBtn} disabled={atBack} onClick={() => move(l.id, "back")} title="Send to back" aria-label={`Send ${it.name} to back`}>
                ⤓
              </button>
              <button
                type="button"
                className={iconBtn}
                onClick={() => setFlag(l.kind, l.id, "visible", !it.visible)}
                title={it.visible ? "Hide" : "Show"}
                aria-pressed={!it.visible}
                aria-label={`${it.visible ? "Hide" : "Show"} ${it.name}`}
              >
                {it.visible ? "👁" : "🚫"}
              </button>
              <button
                type="button"
                className={iconBtn}
                onClick={() => setFlag(l.kind, l.id, "locked", !it.locked)}
                title={it.locked ? "Unlock" : "Lock in place"}
                aria-pressed={it.locked}
                aria-label={`${it.locked ? "Unlock" : "Lock"} ${it.name}`}
              >
                {it.locked ? "🔒" : "🔓"}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="text-[0.7rem] text-white/45">
        Order only changes what sits on top. Screen readers and Google still read text top-to-bottom as usual. Locked items can be edited here but can&apos;t be dragged by accident.
      </p>
    </div>
  );
}
