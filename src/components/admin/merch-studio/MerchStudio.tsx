"use client";

/**
 * R70 - Merch Studio shell: tabbed, one garment + colour selection shared by
 * every tab (pick a blank on Garments, it's the blank everywhere). Selection
 * persists on this device so a reload doesn't lose your place.
 */
import { useEffect, useState, type ReactNode } from "react";
import { BLANKS, colorsFor, getBlank } from "@/lib/merch-studio/garment-catalog-core";
import { CatalogPanel } from "./CatalogPanel";
import { ArtCheckPanel } from "./ArtCheckPanel";
import { FulfillmentPanel } from "./FulfillmentPanel";

export type StudioTab = "garments" | "check" | "fulfillment";
const TABS: { id: StudioTab; label: string }[] = [
  { id: "garments", label: "\ud83d\udc55 Garments" },
  { id: "check", label: "\ud83d\udd0e Artwork Check" },
  { id: "fulfillment", label: "\ud83d\udce6 Fulfillment & Pricing" },
];
const SEL_KEY = "gw-merch-studio-sel";

export function MerchStudio({ extraTabs = [] }: { extraTabs?: { id: string; label: string; render: (sel: { blankId: string; colorHex: string; setBlank: (id: string) => void; setColor: (hex: string) => void }) => ReactNode }[] }) {
  const [tab, setTab] = useState<string>("garments");
  const [blankId, setBlankId] = useState(BLANKS[0].id);
  const [colorHex, setColorHex] = useState(() => colorsFor(BLANKS[0]).find((c) => c[0] === "Black")?.[1] ?? colorsFor(BLANKS[0])[0][1]);

  const [restored, setRestored] = useState(false);
  useEffect(() => {
    let cancelled = false;
    // Same deferral as useHydratedValue: restore after mount (SSR-safe) in a microtask.
    Promise.resolve().then(() => {
      if (cancelled) return;
      try {
        const raw = window.localStorage.getItem(SEL_KEY);
        const s = raw ? (JSON.parse(raw) as { blankId?: string; colorHex?: string; tab?: string }) : {};
        const b = s.blankId ? getBlank(s.blankId) : undefined;
        if (b) setBlankId(b.id);
        if (b && s.colorHex && colorsFor(b).some((c) => c[1] === s.colorHex)) setColorHex(s.colorHex);
        if (s.tab) setTab(s.tab);
      } catch { /* ignore corrupt storage */ }
      setRestored(true);
    });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!restored) return;
    try { window.localStorage.setItem(SEL_KEY, JSON.stringify({ blankId, colorHex, tab })); } catch { /* quota */ }
  }, [blankId, colorHex, tab, restored]);

  const setBlank = (id: string) => {
    const b = getBlank(id); if (!b) return;
    setBlankId(id);
    const cols = colorsFor(b);
    if (!cols.some((c) => c[1] === colorHex)) setColorHex(cols.find((c) => c[0] === "Black")?.[1] ?? cols[0][1]);
  };
  const all = [...TABS.slice(0, 1), ...extraTabs.map((t) => ({ id: t.id, label: t.label })), ...TABS.slice(1)];
  const blank = getBlank(blankId)!;
  const colorName = colorsFor(blank).find((c) => c[1] === colorHex)?.[0] ?? colorHex;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label="Merch Studio" className="flex flex-wrap gap-1 border-b border-[var(--admin-border)]">
          {all.map((t) => (
            <button key={t.id} role="tab" type="button" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
              className={`-mb-px px-3 py-2 text-sm font-semibold ${tab === t.id ? "border-b-2 border-[var(--admin-accent)] text-white" : "text-white/55 hover:text-white/85"}`}>
              {t.label}
            </button>
          ))}
        </div>
        <span className="flex items-center gap-2 text-xs text-white/60">
          <span className="inline-block h-4 w-4 rounded-full border border-white/30" style={{ background: colorHex }} />
          {blank.brand} {blank.model} - {colorName}
        </span>
      </div>
      <div role="tabpanel">
        {tab === "garments" ? <CatalogPanel blankId={blankId} colorHex={colorHex} onBlank={setBlank} onColor={(hex) => setColorHex(hex)} /> : null}
        {tab === "check" ? <ArtCheckPanel key={blankId} blankId={blankId} colorHex={colorHex} /> : null}
        {tab === "fulfillment" ? <FulfillmentPanel key={blankId} blankId={blankId} /> : null}
        {extraTabs.map((t) => (tab === t.id ? <div key={t.id}>{t.render({ blankId, colorHex, setBlank, setColor: setColorHex })}</div> : null))}
      </div>
    </div>
  );
}
