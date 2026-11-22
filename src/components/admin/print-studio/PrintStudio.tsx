"use client";

/**
 * D263 Print Studio shell. Owner: "The print studio version should be a near
 * identical replica [of the hero banner editor] with a few enhancements and
 * tweaks." So this shell only picks the printed size and the picture, and
 * mounts the REAL Banner Studio. A design with `frame.print` switches the
 * studio into print mode (no motion, still smoke, bleed + safe guides, real
 * inches). Work in progress is kept in this browser until saved designs land.
 */
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/admin/ui";
import { PrintPictureTools } from "./PrintPictureTools";
import { PictureSharpness } from "./PictureSharpness";
import { PrintExport } from "./PrintExport";
import { ContentImageField, type MediaChoice } from "@/components/admin/ContentImageField";
import { normalizeDesign, type BannerDesign } from "@/lib/cms/banner-design-core";
import {
  PLACEMENT_LABEL,
  applyPrintSize,
  customPreset,
  newPrintDesign,
  pixelsAt,
  presetById,
  presetsByGroup,
  recommendedDpi,
  sizeLabel,
  type PrintPlacement,
  type PrintPreset,
  type PrintVendor,
} from "@/lib/printing/print-sizes-core";

const BannerStudio = dynamic(() => import("@/components/admin/banner-studio/BannerStudio"), {
  ssr: false,
  loading: () => <p className="text-xs text-[var(--admin-text-muted)]">Loading the design studio…</p>,
});

const DRAFT_KEY = "gw.printStudio.draft.v1";
const CARD = "rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4";
const input = "rounded border border-white/15 bg-black/40 px-2 py-1 text-sm text-white";

export type PrintDraft = { presetId: string; preset: PrintPreset; design: BannerDesign; imageSrc: string; name: string };

function loadDraft(): PrintDraft | null {
  try {
    const raw = JSON.parse(window.localStorage.getItem(DRAFT_KEY) ?? "null") as Partial<PrintDraft> | null;
    if (!raw || !raw.preset || !raw.design) return null;
    const design = normalizeDesign(raw.design);
    if (!design?.frame.print) return null;
    return { presetId: String(raw.presetId ?? "custom"), preset: raw.preset as PrintPreset, design, imageSrc: String(raw.imageSrc ?? ""), name: String(raw.name ?? "") };
  } catch {
    return null;
  }
}

export function PrintStudio({ mediaChoices, fluxConfigured }: { mediaChoices: MediaChoice[]; fluxConfigured: boolean }) {
  const groups = useMemo(() => presetsByGroup(), []);
  const [draft, setDraft] = useState<PrintDraft | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [pick, setPick] = useState("banner-6x12");
  const [cw, setCw] = useState("24");
  const [ch, setCh] = useState("36");
  const [cPlace, setCPlace] = useState<PrintPlacement>("instore");
  const [cVendor, setCVendor] = useState<PrintVendor>("vistaprint");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    // Restore the work in progress after hydration (localStorage is browser-only).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(loadDraft());
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    const t = window.setTimeout(() => {
      try {
        if (draft) window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
        else window.localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* storage full or blocked: the design stays on screen */
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [draft, loaded]);

  function chosenPreset(): PrintPreset | null {
    if (pick !== "custom") return presetById(pick);
    const r = customPreset(Number(cw), Number(ch), cPlace, cVendor);
    if (!r.ok) {
      setMsg(r.error);
      return null;
    }
    return r.preset;
  }

  function start() {
    const p = chosenPreset();
    if (!p) return;
    setMsg(null);
    setDraft({ presetId: p.id, preset: p, design: newPrintDesign(p), imageSrc: draft?.imageSrc ?? "", name: p.label });
  }

  function resize() {
    const p = chosenPreset();
    if (!p || !draft) return;
    setMsg(`Changed to ${p.label}. Everything kept its place in %, so check the layout.`);
    setDraft({ ...draft, presetId: p.id, preset: p, design: applyPrintSize(draft.design, p) });
  }

  const p = draft?.preset;
  const dpi = p ? recommendedDpi(p) : 0;
  const px = p ? pixelsAt(p, dpi) : null;

  return (
    <div className="space-y-4">
      <section className={CARD}>
        <div className="mb-2 text-sm font-semibold">1. What are you printing?</div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-white/70">
            Size
            <select aria-label="Print size" className={`${input} ml-2 max-w-[22rem]`} value={pick} onChange={(e) => setPick(e.target.value)}>
              {groups.map((g) => (
                <optgroup key={g.group} label={g.group}>
                  {g.items.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.label}
                      {it.verified ? "" : " (confirm size)"}
                    </option>
                  ))}
                </optgroup>
              ))}
              <optgroup label="Custom">
                <option value="custom">Custom size…</option>
              </optgroup>
            </select>
          </label>
          {pick === "custom" ? (
            <>
              <label className="text-xs text-white/70">
                Width (in)
                <input aria-label="Custom width in inches" className={`${input} ml-1 w-20`} inputMode="decimal" value={cw} onChange={(e) => setCw(e.target.value)} />
              </label>
              <label className="text-xs text-white/70">
                Height (in)
                <input aria-label="Custom height in inches" className={`${input} ml-1 w-20`} inputMode="decimal" value={ch} onChange={(e) => setCh(e.target.value)} />
              </label>
              <select aria-label="Where it goes" className={input} value={cPlace} onChange={(e) => setCPlace(e.target.value as PrintPlacement)}>
                {(Object.keys(PLACEMENT_LABEL) as PrintPlacement[]).map((k) => (
                  <option key={k} value={k}>
                    {PLACEMENT_LABEL[k]}
                  </option>
                ))}
              </select>
              <select aria-label="Who prints it" className={input} value={cVendor} onChange={(e) => setCVendor(e.target.value as PrintVendor)}>
                <option value="vistaprint">Vistaprint prints it</option>
                <option value="self">I print it myself</option>
              </select>
            </>
          ) : null}
          <Button type="button" size="sm" onClick={start}>
            {draft ? "Start a new design at this size" : "Start designing"}
          </Button>
          {draft ? (
            <Button type="button" size="sm" variant="neutral" onClick={resize}>
              Change this design to this size
            </Button>
          ) : null}
        </div>
        {pick !== "custom" && presetById(pick)?.note ? <p className="mt-2 text-xs text-[var(--admin-gold)]">{presetById(pick)!.note}</p> : null}
        {msg ? <p className="mt-2 text-xs text-[var(--admin-gold)]">{msg}</p> : null}
      </section>

      {draft && p && px ? (
        <>
          <section className={`${CARD} grid gap-3 text-xs sm:grid-cols-2`}>
            <div className="space-y-1">
              <div className="text-sm font-semibold">2. Your piece</div>
              <label className="block text-white/70">
                Name
                <input aria-label="Design name" className={`${input} ml-2 w-64`} maxLength={80} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </label>
              <p>
                <b>{p.label}</b> · trim {sizeLabel(p)}
                {p.bleed ? ` + ${p.bleed}" bleed each side` : ""} · keep words {`${p.safe}"`} inside the edge
              </p>
              <p>
                {PLACEMENT_LABEL[p.placement]} · {p.vendor === "vistaprint" ? "Vistaprint prints it" : "You print it"} · read from about {p.viewFt} ft
              </p>
              <p>
                Sharp at <b>{dpi} DPI</b> from that distance = {px.w.toLocaleString()} x {px.h.toLocaleString()} px ({px.mp} MP).
              </p>
              {!p.verified ? <p className="text-[var(--admin-gold)]">Confirm this size on Vistaprint&apos;s product page before ordering.</p> : null}
            </div>
            <div>
              <div className="mb-1 text-sm font-semibold">Background picture</div>
              <ContentImageField value={draft.imageSrc} onChange={(imageSrc) => setDraft({ ...draft, imageSrc })} mediaChoices={mediaChoices} />
              <PictureSharpness src={draft.imageSrc} print={draft.design.frame.print} need={dpi} />
              <details className="mt-2 rounded-md border border-white/10 p-2" open>
                <summary className="cursor-pointer text-sm font-semibold">Upload, drag-drop and AI picture tools</summary>
                <div className="mt-2">
                  {draft.design.frame.print ? <PrintPictureTools src={draft.imageSrc} print={draft.design.frame.print} onUse={(imageSrc) => setDraft((d) => (d ? { ...d, imageSrc } : d))} /> : null}
                </div>
              </details>
              {!fluxConfigured ? <p className="mt-1 text-white/50">FLUX isn&apos;t connected (Settings → Integrations), so the AI picture tools will say so.</p> : null}
            </div>
          </section>

          <section className={CARD}>
            <div className="mb-2 text-sm font-semibold">3. Design it</div>
            <BannerStudio
              design={draft.design}
              onChange={(design) => setDraft((d) => (d ? { ...d, design } : d))}
              legacy={{}}
              imageSrc={draft.imageSrc}
              imageAlt={draft.name}
              posts={[]}
              printViewFt={draft.preset.viewFt}
              mediaChoices={mediaChoices}
            />
          </section>

          <section className={CARD}>
            <div className="mb-2 text-sm font-semibold">4. Download for printing</div>
            <PrintExport design={draft.design} imageSrc={draft.imageSrc} name={draft.name} preset={draft.preset} dpi={dpi} />
          </section>
        </>
      ) : loaded ? (
        <p className="text-sm text-[var(--admin-text-muted)]">Pick a size and press Start designing. Your work is kept in this browser as you go.</p>
      ) : null}
    </div>
  );
}
