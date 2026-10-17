"use client";

/**
 * R70 S1 - "Artwork Check" tab: before the canvas (Slice 2) the owner can
 * already ask "will THIS file work on THIS garment, placement and method?".
 * Pick an image (read locally - nothing is uploaded), set the print width,
 * and the rules engine reports DPI, bounds, method fit, thread palette etc.
 */
import { useState } from "react";
import { getBlank, getPlacement, placementsFor, METHOD_LABEL, METHOD_BLURB, type Method } from "@/lib/merch-studio/garment-catalog-core";
import { checkDesign, maxInchesAt300, summarize, type RuleElement } from "@/lib/merch-studio/print-rules-core";
import { NumberSlider, Row, Segmented, Toggle, studioInput } from "@/components/admin/banner-studio/controls";
import { IssueList } from "./IssueList";

export function ArtCheckPanel({ blankId, colorHex }: { blankId: string; colorHex: string }) {
  const blank = getBlank(blankId)!;
  const methods = [...new Set(blank.placements.flatMap((p) => p.methods))];
  const [method, setMethod] = useState<Method>(methods[0]);
  const m: Method = methods.includes(method) ? method : methods[0];
  const options = placementsFor(blank, m);
  const [placementId, setPlacementId] = useState(options[0]?.id ?? "");
  const placement = getPlacement(blank, placementId) && options.some((o) => o.id === placementId) ? getPlacement(blank, placementId)! : options[0];

  const [img, setImg] = useState<{ url: string; w: number; h: number; name: string } | null>(null);
  const [widthIn, setWidthIn] = useState(4);
  const [gradient, setGradient] = useState(false);
  const [photo, setPhoto] = useState(false);
  const [text, setText] = useState("");
  const [textH, setTextH] = useState(0.5);
  const [puff, setPuff] = useState(false);

  const onFile = (f: File | undefined) => {
    if (!f) return;
    const url = URL.createObjectURL(f);
    const el = new Image();
    el.onload = () => {
      setImg({ url, w: el.naturalWidth, h: el.naturalHeight, name: f.name });
      if (placement) setWidthIn(Math.min(placement.widthIn, Math.max(0.5, Math.round(Math.min(maxInchesAt300(el.naturalWidth), placement.widthIn) * 4) / 4)));
    };
    el.src = url;
  };

  const issues = (() => {
    if (!placement) return [];
    const els: RuleElement[] = [];
    if (img) {
      const hIn = (widthIn * img.h) / img.w;
      els.push({ id: "art", kind: "image", name: img.name, x: (placement.widthIn - widthIn) / 2, y: 0, w: widthIn, h: hIn, pxW: img.w, pxH: img.h, colors: [], hasGradient: gradient, isPhoto: photo });
    }
    if (text.trim()) {
      const w = Math.min(placement.widthIn, text.length * textH * 0.62);
      els.push({ id: "txt", kind: "text", text, letterHeightIn: textH, fontSizeIn: textH / 0.7, x: (placement.widthIn - w) / 2, y: Math.max(0, placement.heightIn - textH - 0.25), w, h: textH, colors: [] });
    }
    return checkDesign({ blank, placement, method: m, garmentHex: colorHex, elements: els, puff });
  })();
  const sum = summarize(issues);

  return (
    <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
      <div className="space-y-3">
        <Segmented label="Method" value={m} options={methods.map((x) => ({ value: x, label: METHOD_LABEL[x].split(" (")[0], title: METHOD_BLURB[x] }))} onChange={(v) => setMethod(v)} />
        <p className="text-[0.72rem] text-white/55">{METHOD_BLURB[m]}</p>
        <Row label="Placement">
          <select className={studioInput} value={placement?.id} onChange={(e) => setPlacementId(e.target.value)}>
            {options.map((p) => <option key={p.id} value={p.id}>{p.label} ({p.widthIn}&quot; x {p.heightIn}&quot;)</option>)}
          </select>
        </Row>
        <Row label="Artwork file" hint="Read on this device only - nothing is uploaded. PNG with transparency is best.">
          <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="text-xs text-white/80" onChange={(e) => onFile(e.target.files?.[0])} />
        </Row>
        {img && placement ? (
          <>
            <p className="text-xs text-white/65">{img.w} x {img.h} px - sharp at 300 DPI up to {maxInchesAt300(img.w)}&quot; wide.</p>
            <NumberSlider label="Print width" value={widthIn} min={0.5} max={placement.widthIn} step={0.25} unit="in" onChange={setWidthIn} />
            <Toggle label="Art contains gradients / soft shadows" checked={gradient} onChange={setGradient} />
            <Toggle label="Art is a photo / photographic detail" checked={photo} onChange={setPhoto} />
          </>
        ) : null}
        <Row label="Test a line of text (optional)" hint="Checks letter height, hat-side length and compliance themes.">
          <input className={studioInput} value={text} maxLength={60} onChange={(e) => setText(e.target.value)} placeholder="e.g. GREENWAY" />
        </Row>
        {text.trim() ? <NumberSlider label="Letter (cap) height" value={textH} min={0.1} max={3} step={0.05} unit="in" onChange={setTextH} /> : null}
        {blank.puffAvailable && m === "embroidery" ? <Toggle label="3D puff" checked={puff} onChange={setPuff} /> : null}
      </div>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded bg-[var(--admin-danger)]/20 px-2 py-1 text-white">{sum.blocker} blocker(s)</span>
          <span className="rounded bg-[var(--admin-gold)]/20 px-2 py-1 text-white">{sum.warning} warning(s)</span>
          <span className="rounded bg-[var(--admin-orange)]/20 px-2 py-1 text-white">{sum.review} review</span>
          <span className="rounded bg-[var(--admin-accent-soft)] px-2 py-1 text-white">{sum.tip} tip(s)</span>
        </div>
        {img && placement ? (
          <div className="flex items-center justify-center rounded-[var(--admin-radius)] border border-dashed border-white/25 p-4" style={{ background: colorHex }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img.url} alt="Artwork preview" style={{ width: `${(widthIn / placement.widthIn) * 100}%`, maxHeight: 280, objectFit: "contain" }} />
          </div>
        ) : null}
        <IssueList issues={issues} />
      </div>
    </div>
  );
}
