"use client";

/**
 * R59-S2 — "✨ Animate" tab: one-click whole-banner entrance presets (staggered
 * in reading order), Remove all, ▶ Play, and a timeline of who enters when
 * (click a row to edit that item). Per-item controls live in each item's panel.
 */
import type { ReactNode } from "react";
import { ENTER_FX, ENTER_PRESETS, applyEnterPreset, entrancePlan } from "@/lib/cms/banner-enter-core";
import type { BannerDesign } from "@/lib/cms/banner-design-core";
import type { StudioSelection } from "./StudioCanvas";
import { studioReplay } from "./EnterFields";

const box = "space-y-2 rounded-md border border-white/10 p-2";

export function AnimatePanel({
  design,
  onChange,
  onSelect,
  children,
}: {
  design: BannerDesign;
  onChange: (d: BannerDesign) => void;
  onSelect: (s: StudioSelection) => void;
  /** R59-S3: the "start blank, then reveal" curtain controls. */
  children?: ReactNode;
}) {
  const plan = entrancePlan(design);
  const total = plan.reduce((m, p) => Math.max(m, p.start + p.dur), 0);
  const any = [...design.boxes, ...design.buttons, ...(design.elements ?? [])].some((i) => i.enter);
  const name = (id: string) => {
    const b = design.boxes.find((x) => x.id === id);
    if (b) return `✏️ ${(b.text || b.bind || b.role).slice(0, 28)}`;
    const btn = design.buttons.find((x) => x.id === id);
    if (btn) return `🔘 ${btn.label.slice(0, 28)}`;
    const el = design.elements?.find((x) => x.id === id);
    return el ? `◆ ${el.kind === "icon" ? (el.icon ?? "icon") : el.shape}` : id;
  };
  const target = (id: string): StudioSelection =>
    design.boxes.some((b) => b.id === id) ? { target: "box", id } : design.buttons.some((b) => b.id === id) ? { target: "button", id } : { target: "element", id };

  return (
    <div className="space-y-3">
      <div className={box}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-white/80">Animate everything in (one click)</p>
          <button type="button" onClick={studioReplay} className="rounded-full bg-[var(--admin-accent)] px-3 py-1 text-xs font-bold text-black">
            ▶ Play
          </button>
        </div>
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
          {ENTER_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                onChange(applyEnterPreset(design, p));
                studioReplay();
              }}
              className="rounded-md bg-black/30 px-2 py-2 text-left text-xs text-white/80 hover:bg-white/10"
            >
              <span aria-hidden="true">{p.emoji}</span> {p.label}
            </button>
          ))}
        </div>
        {any ? (
          <button type="button" onClick={() => onChange(applyEnterPreset(design, null))} className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/80 hover:bg-white/20">
            Remove all entrances
          </button>
        ) : null}
        <p className="text-[0.7rem] text-white/50">
          Items come in top → bottom, left → right (shapes, then words, then buttons). Fine-tune any item in its own tab under “✨ Entrance”.
        </p>
      </div>

      {children}

      <div className={box}>
        <p className="text-xs font-semibold text-white/80">Timeline {plan.length ? `(${Math.round(total * 10) / 10}s)` : ""}</p>
        {plan.length ? (
          <ul className="space-y-1">
            {plan.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => onSelect(target(p.id))} className="w-full rounded px-1 py-0.5 text-left hover:bg-white/10">
                  <div className="flex justify-between gap-2 text-[0.7rem] text-white/75">
                    <span className="truncate">{name(p.id)}</span>
                    <span className="shrink-0 text-white/50">
                      {ENTER_FX.find((f) => f.id === p.fx)?.label} · {p.start}s
                    </span>
                  </div>
                  <div className="relative mt-0.5 h-1.5 rounded bg-white/10">
                    <div
                      className="absolute h-1.5 rounded bg-[var(--admin-accent)]"
                      style={{ left: `${(p.start / (total || 1)) * 100}%`, width: `${Math.max(2, (p.dur / (total || 1)) * 100)}%` }}
                    />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[0.7rem] text-white/50">Nothing animates in yet — everything is simply there when the slide shows.</p>
        )}
      </div>
    </div>
  );
}
