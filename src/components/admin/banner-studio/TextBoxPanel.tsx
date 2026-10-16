"use client";

/**
 * R41 S2 — text box list + controls (bible PART 5.6, Q5/Q7/Q8/Q13/Q14/Q18/Q22).
 *
 * "Create new text boxes, but with purpose": the Add menu lists each ROLE with
 * its purpose, dos and don'ts (DESIGN_ROLES, from the bible's research table),
 * so a new box is always a headline / sub-headline / badge / fine print … with
 * sensible defaults for that job, not an anonymous text blob.
 */
import { useState } from "react";
import {
  DESIGN_ROLES,
  MAX_BOX_TEXT,
  MAX_TEXT_BOXES,
  boxPosition,
  defaultTextBox,
  nextId,
  resolveBoxText,
  roleInfo,
  type BannerDesign,
  type DesignAlign,
  type DesignBackdrop,
  type DesignDevice,
  type DesignRole,
  type DesignTextBox,
  type DesignTransform,
  type DesignWrap,
} from "@/lib/cms/banner-design-core";
import { ColorField, NumberSlider, Row, Segmented, SelectField, Toggle, studioInput } from "./controls";
import type { StudioSelection } from "./StudioCanvas";
import { FontSelect, TextFxFields } from "./TextFxFields";

const ROLE_ICON: Record<DesignRole, string> = { eyebrow: "🏷", headline: "🅷", subhead: "💬", body: "¶", badge: "⭐", legal: "⚖️" };

const BIND_LABEL = { eyebrow: "Eyebrow", title: "Title", subtitle: "Subtitle" } as const;

function FmtButton({ active, onClick, label, children }: { active: boolean; onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`h-8 w-8 rounded-[var(--admin-radius-sm)] text-sm ${active ? "bg-[var(--admin-accent)] text-black" : "bg-black/40 text-white/80 hover:bg-white/10"}`}
    >
      {children}
    </button>
  );
}

export function TextBoxPanel({
  design,
  device,
  legacy,
  selection,
  onSelect,
  onChange,
  onRequestDelete,
}: {
  design: BannerDesign;
  device: DesignDevice;
  legacy: { eyebrow?: string; title?: string; subtitle?: string };
  selection: StudioSelection;
  onSelect: (s: StudioSelection) => void;
  onChange: (d: BannerDesign) => void;
  onRequestDelete: (s: NonNullable<StudioSelection>) => void;
}) {
  const [adding, setAdding] = useState(false);
  const box = selection?.target === "box" ? design.boxes.find((b) => b.id === selection.id) : undefined;
  const mobile = device === "mobile";

  const patch = (id: string, p: Partial<DesignTextBox>) =>
    onChange({ ...design, boxes: design.boxes.map((b) => (b.id === id ? { ...b, ...p } : b)) });

  function add(role: DesignRole) {
    if (design.boxes.length >= MAX_TEXT_BOXES) return;
    const id = nextId(design, role);
    const sample: Record<DesignRole, string> = {
      eyebrow: "New label",
      headline: "Your headline",
      subhead: "A short supporting line.",
      body: "A little more detail.",
      badge: "20% OFF",
      legal: "21+ only. Not for resale.",
    };
    const y = Math.min(85, 10 + design.boxes.length * 10);
    const nb = defaultTextBox(role, { id, text: sample[role], x: 4, y, w: role === "badge" ? 20 : 50 });
    onChange({ ...design, boxes: [...design.boxes, nb] });
    onSelect({ target: "box", id });
    setAdding(false);
  }

  function move(id: string, dir: -1 | 1) {
    const i = design.boxes.findIndex((b) => b.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= design.boxes.length) return;
    const boxes = [...design.boxes];
    [boxes[i], boxes[j]] = [boxes[j], boxes[i]];
    onChange({ ...design, boxes });
  }

  function duplicate(b: DesignTextBox) {
    if (design.boxes.length >= MAX_TEXT_BOXES) return;
    const id = nextId(design, b.role);
    const copy: DesignTextBox = { ...b, id, bind: null, text: resolveBoxText(b, legacy), y: Math.min(95, b.y + 8) };
    onChange({ ...design, boxes: [...design.boxes, copy] });
    onSelect({ target: "box", id });
  }

  const pos = box ? boxPosition(box, device) : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-white/70">
          Text boxes ({design.boxes.length}/{MAX_TEXT_BOXES})
        </span>
        <button
          type="button"
          disabled={design.boxes.length >= MAX_TEXT_BOXES}
          onClick={() => setAdding((v) => !v)}
          className="rounded-full bg-[var(--admin-accent)] px-3 py-1 text-xs font-bold text-black disabled:opacity-40"
          aria-expanded={adding}
        >
          ＋ Add text box
        </button>
      </div>

      {adding ? (
        <div className="space-y-1.5 rounded-lg border border-[var(--admin-accent)]/40 bg-black/40 p-2">
          <p className="text-[0.7rem] text-white/55">Pick what the new text is FOR — each kind starts with the right size and style for its job.</p>
          {DESIGN_ROLES.map((r) => (
            <button key={r.role} type="button" onClick={() => add(r.role)} className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-white/10">
              <span className="text-sm font-semibold text-white">
                {ROLE_ICON[r.role]} {r.label}
              </span>
              <span className="block text-xs text-white/70">{r.purpose}</span>
              <span className="block text-[0.7rem] text-[var(--admin-accent)]">✓ {r.dos}</span>
              <span className="block text-[0.7rem] text-[var(--admin-orange)]">✗ {r.donts}</span>
            </button>
          ))}
        </div>
      ) : null}

      <ul className="space-y-1">
        {design.boxes.map((b, i) => {
          const text = resolveBoxText(b, legacy);
          const active = box?.id === b.id;
          return (
            <li key={b.id} className={`flex items-center gap-1 rounded-md px-1.5 py-1 ${active ? "bg-[var(--admin-accent-soft)]" : "hover:bg-white/5"}`}>
              <button type="button" className="min-w-0 flex-1 truncate text-left text-xs text-white/85" onClick={() => onSelect({ target: "box", id: b.id })}>
                {ROLE_ICON[b.role]} <span className="font-semibold">{roleInfo(b.role).label}</span>
                {b.hidden ? " (hidden)" : ""} — <span className="text-white/55">{text.replace(/\n/g, " ").slice(0, 32) || "empty"}</span>
              </button>
              <button type="button" className="px-1 text-white/50 hover:text-white disabled:opacity-30" disabled={i === 0} onClick={() => move(b.id, -1)} aria-label="Send backward" title="Send backward">
                ↑
              </button>
              <button type="button" className="px-1 text-white/50 hover:text-white disabled:opacity-30" disabled={i === design.boxes.length - 1} onClick={() => move(b.id, 1)} aria-label="Bring forward" title="Bring forward">
                ↓
              </button>
            </li>
          );
        })}
      </ul>

      {box && pos ? (
        <div className="space-y-3 rounded-lg border border-white/10 bg-black/30 p-3">
          <div className="rounded-md bg-white/5 px-2 py-1.5 text-[0.7rem] text-white/60">
            <strong className="text-white/85">{roleInfo(box.role).label}:</strong> {roleInfo(box.role).purpose} <span className="text-[var(--admin-accent)]">✓ {roleInfo(box.role).dos}</span>
          </div>

          <SelectField<DesignRole>
            label="What this text is for"
            value={box.role}
            options={DESIGN_ROLES.map((r) => ({ value: r.role, label: r.label }))}
            onChange={(role) => patch(box.id, { role })}
          />

          {box.bind ? (
            <Row label="Text" hint={`This box shows the banner's ${BIND_LABEL[box.bind]} field (edit it above the studio). Press Enter there for a new line.`}>
              <div className="flex items-center justify-between gap-2 rounded-md bg-black/40 px-2 py-1.5 text-sm text-white/80">
                <span className="whitespace-pre-line">{resolveBoxText(box, legacy) || "(empty)"}</span>
                <button type="button" className="shrink-0 text-xs text-[var(--admin-accent)] underline" onClick={() => patch(box.id, { bind: null, text: resolveBoxText(box, legacy) })}>
                  Type its own text instead
                </button>
              </div>
            </Row>
          ) : (
            <Row label="Text" hint="Press Enter for a new line.">
              <textarea
                className={`${studioInput} min-h-[64px] resize-y`}
                value={box.text}
                maxLength={MAX_BOX_TEXT}
                onChange={(e) => patch(box.id, { text: e.target.value })}
              />
            </Row>
          )}

          <FontSelect value={box.font} onChange={(font) => patch(box.id, { font })} preview />

          <div className="grid grid-cols-2 gap-3">
            <NumberSlider label="Size — computer" value={box.size} min={8} max={160} unit="px" onChange={(size) => patch(box.id, { size })} />
            <NumberSlider label="Size — phone" value={box.sizeMobile} min={6} max={96} step={0.5} unit="px" onChange={(sizeMobile) => patch(box.id, { sizeMobile })} />
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <Row label="Style">
              <div className="flex gap-1">
                <FmtButton label="Bold" active={box.weight >= 700} onClick={() => patch(box.id, { weight: box.weight >= 700 ? 400 : 800 })}>
                  <strong>B</strong>
                </FmtButton>
                <FmtButton label="Italic" active={box.italic} onClick={() => patch(box.id, { italic: !box.italic })}>
                  <em>I</em>
                </FmtButton>
                <FmtButton label="Underline" active={box.underline} onClick={() => patch(box.id, { underline: !box.underline })}>
                  <span className="underline">U</span>
                </FmtButton>
                <FmtButton label="Strikethrough" active={box.strike} onClick={() => patch(box.id, { strike: !box.strike })}>
                  <span className="line-through">S</span>
                </FmtButton>
              </div>
            </Row>
            <div className="min-w-[140px] flex-1">
              <SelectField
                label="Weight"
                value={String(box.weight)}
                options={[100, 200, 300, 400, 500, 600, 700, 800, 900].map((w) => ({ value: String(w), label: `${w}${w === 400 ? " (regular)" : w === 700 ? " (bold)" : w === 900 ? " (black)" : ""}` }))}
                onChange={(w) => patch(box.id, { weight: Number(w) })}
              />
            </div>
          </div>

          <Segmented<DesignAlign>
            label="Align text"
            value={box.align}
            options={[
              { value: "left", label: "⯇ Left" },
              { value: "center", label: "Center" },
              { value: "right", label: "Right ⯈" },
              { value: "justify", label: "Justify" },
            ]}
            onChange={(align) => patch(box.id, { align })}
          />

          <Segmented<DesignTransform>
            label="Letter case"
            value={box.transform}
            options={[
              { value: "none", label: "As typed" },
              { value: "uppercase", label: "ABC" },
              { value: "lowercase", label: "abc" },
              { value: "capitalize", label: "Abc" },
            ]}
            onChange={(transform) => patch(box.id, { transform })}
          />

          <ColorField label="Text color" value={box.color} onChange={(color) => patch(box.id, { color })} />

          <div className="rounded-md border border-white/10 p-2">
            <p className="mb-2 text-[0.7rem] font-semibold uppercase tracking-wide text-white/60">
              Position &amp; wrapping {mobile ? "— phone layout" : "— computer layout"}
            </p>
            <div className="grid grid-cols-3 gap-2">
              <NumberSlider label="Across (X)" value={pos.x} min={0} max={100} step={0.5} unit="%" onChange={(x) => patch(box.id, mobile ? { mx: x } : { x })} />
              <NumberSlider label="Down (Y)" value={pos.y} min={0} max={100} step={0.5} unit="%" onChange={(y) => patch(box.id, mobile ? { my: y } : { y })} />
              <NumberSlider
                label="Wrap width"
                value={pos.w}
                min={5}
                max={100}
                step={0.5}
                unit="%"
                onChange={(w) => patch(box.id, mobile ? { mw: w } : { w })}
                hint="How far text runs before it wraps."
              />
            </div>
            <div className="mt-2">
              <Segmented<DesignWrap>
                label="Wrapping"
                value={box.wrap}
                options={[
                  { value: "normal", label: "Normal", title: "Wrap at the box edge" },
                  { value: "balance", label: "Balanced", title: "Even line lengths — great for headlines" },
                  { value: "nowrap", label: "No wrap", title: "Only your own Enter line breaks" },
                ]}
                onChange={(wrap) => patch(box.id, { wrap })}
              />
            </div>
          </div>

          <details className="rounded-md border border-white/10 p-2">
            <summary className="cursor-pointer text-xs font-semibold text-white/70">More text effects</summary>
            <div className="mt-2 space-y-3">
              <NumberSlider label="Opacity" value={box.opacity} min={10} max={100} unit="%" onChange={(opacity) => patch(box.id, { opacity })} />
              <NumberSlider label="Letter spacing" value={box.letterSpacing} min={-0.1} max={0.5} step={0.01} unit="em" onChange={(letterSpacing) => patch(box.id, { letterSpacing })} />
              <NumberSlider label="Line height" value={box.lineHeight} min={0.7} max={3} step={0.05} onChange={(lineHeight) => patch(box.id, { lineHeight })} />
              <TextFxFields box={box} patch={(p) => patch(box.id, p)} />
              <Segmented<DesignBackdrop>
                label="Box behind text (helps reading on busy photos)"
                value={box.backdrop}
                options={[
                  { value: "none", label: "None" },
                  { value: "box", label: "Box" },
                  { value: "blur", label: "Frosted" },
                  { value: "pill", label: "Pill" },
                ]}
                onChange={(backdrop) => patch(box.id, { backdrop })}
              />
              {box.backdrop !== "none" || box.outline ? (
                <>
                  <ColorField label={box.backdrop !== "none" ? "Box / outline color" : "Outline color"} value={box.backdropColor} onChange={(backdropColor) => patch(box.id, { backdropColor })} />
                  {box.backdrop !== "none" ? (
                    <NumberSlider label="Box strength" value={box.backdropOpacity} min={0} max={100} unit="%" onChange={(backdropOpacity) => patch(box.id, { backdropOpacity })} />
                  ) : null}
                </>
              ) : null}
              {!box.strokeWidth ? <Toggle label="Thin outline around letters" checked={box.outline} onChange={(outline) => patch(box.id, { outline })} /> : null}
            </div>
          </details>

          <div className="flex flex-wrap gap-3">
            <Toggle label="Hide this box" checked={box.hidden} onChange={(hidden) => patch(box.id, { hidden })} />
            <Toggle label="Hide on phones" checked={box.hideOnMobile} onChange={(hideOnMobile) => patch(box.id, { hideOnMobile })} />
          </div>
          <div className="flex flex-wrap gap-2 border-t border-white/10 pt-2">
            <button type="button" className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/80 hover:bg-white/20 disabled:opacity-40" disabled={design.boxes.length >= MAX_TEXT_BOXES} onClick={() => duplicate(box)}>
              Duplicate
            </button>
            {mobile && (box.mx !== null || box.my !== null || box.mw !== null || box.sizeMobile !== roleInfo(box.role).sizeMobile) ? (
              <button type="button" className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/80 hover:bg-white/20" onClick={() => patch(box.id, { mx: null, my: null, mw: null })}>
                Use computer position on phones
              </button>
            ) : null}
            <button type="button" className="rounded-full bg-[var(--admin-danger,#dc2626)]/80 px-3 py-1 text-xs font-semibold text-white hover:bg-red-600" onClick={() => onRequestDelete({ target: "box", id: box.id })}>
              Delete box
            </button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-white/45">Click a text box in the preview (or in the list) to style it.</p>
      )}
    </div>
  );
}
