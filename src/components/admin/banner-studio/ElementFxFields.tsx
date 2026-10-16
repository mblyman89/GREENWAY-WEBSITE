"use client";

/**
 * R56-S1 — gradient fill + drop shadow for shapes and icons, any colours.
 * Values are written only when switched on (older designs never change).
 */
import { ELEMENT_SHADOW_MAX, type DesignElement } from "@/lib/cms/banner-elements-core";
import { ColorField, NumberSlider, Toggle } from "./controls";

export function ElementFxFields({ el, patch }: { el: DesignElement; patch: (p: Partial<DesignElement>) => void }) {
  const g = el.gradient;
  const canGradient = el.shape !== "line" && el.fillOpacity > 0;
  return (
    <div className="space-y-2 rounded-md border border-white/10 p-2">
      {canGradient ? (
        <Toggle label="Gradient fill" checked={!!g} onChange={(on) => patch({ gradient: on ? { from: el.fill, to: "#ff7f00", angle: 90 } : undefined })} />
      ) : null}
      {g && canGradient ? (
        <>
          <div className="h-4 rounded" style={{ backgroundImage: `linear-gradient(${g.angle}deg, ${g.from}, ${g.to})` }} aria-hidden />
          <ColorField label="Gradient start" value={g.from} onChange={(from) => patch({ gradient: { ...g, from } })} />
          <ColorField label="Gradient end" value={g.to} onChange={(to) => patch({ gradient: { ...g, to } })} />
          <NumberSlider label="Direction" value={g.angle} min={0} max={360} step={15} unit="°" onChange={(angle) => patch({ gradient: { ...g, angle } })} />
        </>
      ) : null}
      <NumberSlider
        label="Drop shadow"
        value={el.shadow ?? 0}
        min={0}
        max={ELEMENT_SHADOW_MAX}
        unit="px"
        onChange={(v) => patch(v > 0 ? { shadow: v, shadowColor: el.shadowColor ?? "#000000" } : { shadow: undefined, shadowColor: undefined })}
      />
      {el.shadow ? <ColorField label="Shadow colour" value={el.shadowColor ?? "#000000"} onChange={(shadowColor) => patch({ shadowColor })} /> : null}
    </div>
  );
}
