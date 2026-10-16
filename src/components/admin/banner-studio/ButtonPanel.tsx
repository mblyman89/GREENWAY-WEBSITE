"use client";

/**
 * R41 S2 — designed-banner buttons (bible PART 5.6, Q23/Q24/Q25/Q26).
 * Up to 4 buttons; each has a label, a link chosen with the LinkPicker, size,
 * shape, style, colors, font, case, new-tab, position and visibility.
 */
import { useState } from "react";
import {
  BUTTON_SHAPES,
  BUTTON_SIZES,
  BUTTON_STYLES,
  MAX_BUTTON_LABEL,
  MAX_DESIGN_BUTTONS,
  defaultButton,
  nextId,
  type BannerDesign,
  type DesignButton,
  type DesignButtonShape,
  type DesignButtonSize,
  type DesignButtonStyle,
  type DesignDevice,
} from "@/lib/cms/banner-design-core";
import { checkHref, describeHref } from "@/lib/cms/link-target-core";
import { ColorField, NumberSlider, Row, Segmented, Toggle, studioInput } from "./controls";
import { LinkPicker, type PickerPost } from "./LinkPicker";
import type { StudioSelection } from "./StudioCanvas";
import { FontSelect } from "./TextFxFields";
import { ButtonFxFields } from "./ButtonFxFields";

const SIZE_LABEL: Record<DesignButtonSize, string> = { sm: "Small", md: "Medium", lg: "Large" };
const SHAPE_LABEL: Record<DesignButtonShape, string> = { pill: "Pill", rounded: "Rounded", square: "Square" };
const STYLE_LABEL: Record<DesignButtonStyle, string> = { solid: "Solid", outline: "Outline", ghost: "Text link" };

export function ButtonPanel({
  design,
  device,
  posts,
  selection,
  onSelect,
  onChange,
  onRequestDelete,
}: {
  design: BannerDesign;
  device: DesignDevice;
  posts: PickerPost[];
  selection: StudioSelection;
  onSelect: (s: StudioSelection) => void;
  onChange: (d: BannerDesign) => void;
  onRequestDelete: (s: NonNullable<StudioSelection>) => void;
}) {
  const [picking, setPicking] = useState(false);
  const btn = selection?.target === "button" ? design.buttons.find((b) => b.id === selection.id) : undefined;
  const mobile = device === "mobile";
  const blogTitles = Object.fromEntries(posts.map((p) => [p.slug, p.title]));

  const patch = (id: string, p: Partial<DesignButton>) =>
    onChange({ ...design, buttons: design.buttons.map((b) => (b.id === id ? { ...b, ...p } : b)) });

  function add() {
    if (design.buttons.length >= MAX_DESIGN_BUTTONS) return;
    const id = nextId(design, "button");
    const last = design.buttons[design.buttons.length - 1];
    const nb = defaultButton({ id, x: last ? Math.min(85, last.x + 16) : 4, y: last ? last.y : 72 });
    onChange({ ...design, buttons: [...design.buttons, nb] });
    onSelect({ target: "button", id });
  }

  const check = btn ? checkHref(btn.href) : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-white/70">
          Buttons ({design.buttons.length}/{MAX_DESIGN_BUTTONS})
        </span>
        <button
          type="button"
          disabled={design.buttons.length >= MAX_DESIGN_BUTTONS}
          onClick={add}
          className="rounded-full bg-[var(--admin-accent)] px-3 py-1 text-xs font-bold text-black disabled:opacity-40"
        >
          ＋ Add button
        </button>
      </div>
      <ul className="space-y-1">
        {design.buttons.map((b) => (
          <li key={b.id}>
            <button
              type="button"
              onClick={() => onSelect({ target: "button", id: b.id })}
              className={`w-full truncate rounded-md px-2 py-1 text-left text-xs ${btn?.id === b.id ? "bg-[var(--admin-accent-soft)] text-white" : "text-white/80 hover:bg-white/5"}`}
            >
              🔘 <span className="font-semibold">{b.label}</span>
              {b.enabled ? "" : " (hidden)"} <span className="text-white/50">→ {describeHref(b.href, { blogTitles })}</span>
            </button>
          </li>
        ))}
      </ul>
      {design.buttons.length === 0 ? <p className="text-xs text-white/45">No buttons. Add one to send shoppers somewhere.</p> : null}

      {btn ? (
        <div className="space-y-3 rounded-lg border border-white/10 bg-black/30 p-3">
          <Row label="Button words">
            <input className={studioInput} value={btn.label} maxLength={MAX_BUTTON_LABEL} onChange={(e) => patch(btn.id, { label: e.target.value })} />
          </Row>
          <Row label="Goes to">
            <div className="space-y-1">
              <div className="flex gap-2">
                <input className={`${studioInput} font-mono text-xs`} value={btn.href} onChange={(e) => patch(btn.id, { href: e.target.value })} aria-label="Link address" />
                <button type="button" onClick={() => setPicking(true)} className="shrink-0 rounded-full bg-[var(--admin-orange)] px-3 py-1 text-xs font-bold text-black">
                  Pick a link…
                </button>
              </div>
              <p className="text-xs text-white/70">{describeHref(btn.href, { blogTitles })}</p>
              {check && check.level !== "ok" ? (
                <p className={`text-xs ${check.level === "block" ? "text-[var(--admin-danger)]" : "text-[var(--admin-gold)]"}`}>
                  {check.level === "block" ? "⛔ This button will be removed when you save: " : "⚠️ "}
                  {check.message}
                </p>
              ) : null}
            </div>
          </Row>
          {picking ? <LinkPicker value={btn.href} posts={posts} onPick={(href) => patch(btn.id, { href })} onClose={() => setPicking(false)} /> : null}

          <Segmented<DesignButtonSize> label="Size" value={btn.size} options={BUTTON_SIZES.map((v) => ({ value: v, label: SIZE_LABEL[v] }))} onChange={(size) => patch(btn.id, { size })} />
          <Segmented<DesignButtonShape> label="Shape" value={btn.shape} options={BUTTON_SHAPES.map((v) => ({ value: v, label: SHAPE_LABEL[v] }))} onChange={(shape) => patch(btn.id, { shape })} />
          <Segmented<DesignButtonStyle> label="Style" value={btn.style} options={BUTTON_STYLES.map((v) => ({ value: v, label: STYLE_LABEL[v] }))} onChange={(style) => patch(btn.id, { style })} />
          {btn.style === "solid" ? <ColorField label="Button color" value={btn.bg} onChange={(bg) => patch(btn.id, { bg })} /> : null}
          <ColorField label="Text color" value={btn.fg} onChange={(fg) => patch(btn.id, { fg })} />
          {btn.style !== "ghost" ? <ColorField label="Border color" value={btn.border} onChange={(border) => patch(btn.id, { border })} /> : null}
          <FontSelect value={btn.font} onChange={(font) => patch(btn.id, { font })} />
          <ButtonFxFields btn={btn} patch={(p) => patch(btn.id, p)} />
          <div className="rounded-md border border-white/10 p-2">
            <p className="mb-2 text-[0.7rem] font-semibold uppercase tracking-wide text-white/60">Position {mobile ? "— phone layout" : "— computer layout"}</p>
            <div className="grid grid-cols-2 gap-2">
              <NumberSlider
                label="Across (X)"
                value={mobile ? (btn.mx ?? btn.x) : btn.x}
                min={0}
                max={100}
                step={0.5}
                unit="%"
                onChange={(x) => patch(btn.id, mobile ? { mx: x } : { x })}
              />
              <NumberSlider
                label="Down (Y)"
                value={mobile ? (btn.my ?? btn.y) : btn.y}
                min={0}
                max={100}
                step={0.5}
                unit="%"
                onChange={(y) => patch(btn.id, mobile ? { my: y } : { y })}
              />
            </div>
            {mobile && (btn.mx !== null || btn.my !== null) ? (
              <button type="button" className="mt-2 text-xs text-white/60 underline" onClick={() => patch(btn.id, { mx: null, my: null })}>
                Use computer position on phones
              </button>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-3">
            <Toggle label="CAPITAL letters" checked={btn.uppercase} onChange={(uppercase) => patch(btn.id, { uppercase })} />
            <Toggle label="Open in a new tab" checked={btn.newTab} onChange={(newTab) => patch(btn.id, { newTab })} />
            <Toggle label="Show" checked={btn.enabled} onChange={(enabled) => patch(btn.id, { enabled })} />
            <Toggle label="Hide on phones" checked={btn.hideOnMobile} onChange={(hideOnMobile) => patch(btn.id, { hideOnMobile })} />
          </div>
          <div className="border-t border-white/10 pt-2">
            <button type="button" className="rounded-full bg-[var(--admin-danger)]/80 px-3 py-1 text-xs font-semibold text-white hover:bg-[var(--admin-danger)]" onClick={() => onRequestDelete({ target: "button", id: btn.id })}>
              Delete button
            </button>
          </div>
        </div>
      ) : design.buttons.length ? (
        <p className="text-xs text-white/45">Click a button in the preview (or the list) to edit it.</p>
      ) : null}
    </div>
  );
}
