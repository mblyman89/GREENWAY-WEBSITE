"use client";

/**
 * R58-S4 — the "Add" library on the Shapes tab: Shapes (30), Icons (240+,
 * 3 styles) and Objects (110+ illustrations & decorative elements). Every
 * library is searchable, category-filtered and scrolls inside its own box.
 * Only the picked artwork is copied into the banner — the public site never
 * loads these libraries.
 */
import { useState } from "react";
import { BANNER_ICON_CATS, BANNER_ICON_DATA, BANNER_ICON_LIST, BANNER_ICON_WEIGHTS, type BannerIconWeight } from "@/lib/cms/banner-icons-data";
import { BANNER_OBJECT_CATS, BANNER_OBJECT_DATA, BANNER_OBJECT_LIST } from "@/lib/cms/banner-objects-data";
import { SHAPE_KEYWORDS, SHAPE_KINDS, shapePoints, type ShapeKind } from "@/lib/cms/banner-elements-core";
import { LibraryPicker, type LibraryItem } from "./LibraryPicker";

const SHAPE_CAT: Record<string, ShapeKind[]> = {
  Basic: ["rect", "circle", "line", "triangle", "diamond", "pentagon", "hexagon", "octagon", "parallelogram", "trapezoid", "half", "frame"],
  "Stars & badges": ["star", "star4", "star6", "burst", "seal", "shield", "heart"],
  "Signs & bubbles": ["bubble", "cloud", "ribbon", "tag", "cross", "bolt", "drop", "moon"],
  Arrows: ["arrow", "arrow2", "chevron"],
};
const SHAPE_ITEMS: LibraryItem[] = SHAPE_KINDS.map((s) => ({
  id: s.id,
  label: s.label,
  cat: Object.keys(SHAPE_CAT).find((c) => SHAPE_CAT[c].includes(s.id)),
  k: SHAPE_KEYWORDS[s.id],
}));

function ShapeThumb({ id }: { id: ShapeKind }) {
  const pts = shapePoints(id);
  return (
    <svg viewBox="-4 -4 108 108" className="h-full w-full" aria-hidden="true" focusable="false">
      {pts ? <polygon points={pts} fill="#7ed957" /> : null}
      {id === "rect" ? <rect x="0" y="22" width="100" height="56" rx="10" fill="#7ed957" /> : null}
      {id === "circle" ? <circle cx="50" cy="50" r="50" fill="#7ed957" /> : null}
      {id === "line" ? <rect x="0" y="45" width="100" height="10" rx="5" fill="#ffffff" /> : null}
    </svg>
  );
}

const pathThumb = (d: string | undefined) => (
  <svg viewBox="0 0 256 256" className="h-full w-full" aria-hidden="true" focusable="false">
    {d ? <path d={d} fill="currentColor" /> : null}
  </svg>
);

export type LibraryTab = "shapes" | "icons" | "objects";

export function AddLibrary({
  disabled,
  onShape,
  onIcon,
  onObject,
}: {
  disabled: boolean;
  onShape: (s: ShapeKind) => void;
  onIcon: (id: string, weight: BannerIconWeight, path: string) => void;
  onObject: (id: string, path: string) => void;
}) {
  const [tab, setTab] = useState<LibraryTab>("shapes");
  const [weight, setWeight] = useState<BannerIconWeight>("fill");
  const tabs: { id: LibraryTab; label: string }[] = [
    { id: "shapes", label: `Shapes (${SHAPE_ITEMS.length})` },
    { id: "icons", label: `Icons (${BANNER_ICON_LIST.length})` },
    { id: "objects", label: `Objects (${BANNER_OBJECT_LIST.length})` },
  ];
  const weightToggle = (
    <div role="radiogroup" aria-label="Icon style" className="flex gap-1">
      {BANNER_ICON_WEIGHTS.map((w) => (
        <button
          key={w}
          type="button"
          role="radio"
          aria-checked={weight === w}
          onClick={() => setWeight(w)}
          className={weight === w ? "rounded-full bg-[var(--admin-accent)] px-2 py-0.5 text-[0.65rem] font-bold text-black" : "rounded-full bg-white/10 px-2 py-0.5 text-[0.65rem] text-white/70"}
        >
          {w === "regular" ? "Thin" : w === "bold" ? "Bold" : "Solid"}
        </button>
      ))}
    </div>
  );

  return (
    <div className="space-y-2 rounded-lg border border-white/10 p-2">
      <div role="tablist" aria-label="Add from library" className="flex gap-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={tab === t.id ? "rounded-md bg-white/15 px-2.5 py-1 text-xs font-semibold text-white" : "rounded-md px-2.5 py-1 text-xs text-white/60 hover:bg-white/5"}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "shapes" ? (
        <LibraryPicker
          key="shapes"
          items={SHAPE_ITEMS}
          cats={Object.keys(SHAPE_CAT)}
          noun="shapes"
          placeholder="Search shapes (heart, cloud, badge…)"
          disabled={disabled}
          cols="grid-cols-6 sm:grid-cols-10"
          maxH="max-h-44"
          thumb={(i) => <ShapeThumb id={i.id as ShapeKind} />}
          onPick={(i) => onShape(i.id as ShapeKind)}
          footer="Most shapes can also morph (Motion → Morph)."
        />
      ) : null}
      {tab === "icons" ? (
        <LibraryPicker
          key="icons"
          items={BANNER_ICON_LIST}
          cats={BANNER_ICON_CATS}
          noun="icons"
          placeholder="Search icons (leaf, gift, clock, fire…)"
          disabled={disabled}
          toolbar={weightToggle}
          cols="grid-cols-8 sm:grid-cols-12"
          thumb={(i) => pathThumb(BANNER_ICON_DATA[i.id]?.[weight]?.[0])}
          onPick={(i) => {
            const path = BANNER_ICON_DATA[i.id]?.[weight]?.[0];
            if (path) onIcon(i.id, weight, path);
          }}
          footer="Icons by Phosphor (MIT)."
        />
      ) : null}
      {tab === "objects" ? (
        <LibraryPicker
          key="objects"
          items={BANNER_OBJECT_LIST}
          cats={BANNER_OBJECT_CATS}
          noun="objects"
          placeholder="Search objects (joint, cupcake, sparkles, frame…)"
          disabled={disabled}
          cols="grid-cols-6 sm:grid-cols-10"
          thumb={(i) => pathThumb(BANNER_OBJECT_DATA[i.id])}
          onPick={(i) => {
            const path = BANNER_OBJECT_DATA[i.id];
            if (path) onObject(i.id, path);
          }}
          footer="Objects by Material Design Icons (Apache 2.0) + Greenway originals."
        />
      ) : null}
      <p className="text-[0.65rem] text-white/35">Only what you pick is saved into the banner. Colour, size, glow and motion are set below once it’s selected.</p>
    </div>
  );
}

/** Friendly names for every icon + object (layer list, selected-item header). */
export const LIBRARY_LABELS: Record<string, string> = Object.fromEntries([...BANNER_ICON_LIST, ...BANNER_OBJECT_LIST].map((i) => [i.id, i.label]));
