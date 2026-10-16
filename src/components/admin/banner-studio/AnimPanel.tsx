"use client";

/**
 * R60-S2 — 🎞️ Animations tab: Lottie (.lottie / .json) and Rive (.riv) layers.
 *
 *  • Add from the Media Library, or upload right here (same safe direct-upload
 *    path as the Media page: size + type checked, then proven from the bytes).
 *  • A live preview reads the file and fills every dropdown with what is
 *    really inside it (artboards, state machines, inputs, data binding, themes,
 *    markers, slots) — see AnimFields.
 *  • The layer is a normal banner element, so drag / resize / rotate, phone
 *    layout, layers, lock, copy-paste and entrances all work as for shapes.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { nextId, type BannerDesign, type DesignDevice } from "@/lib/cms/banner-design-core";
import { MAX_ELEMENTS, defaultAnimElement, type DesignElement } from "@/lib/cms/banner-elements-core";
import { ANIM_ALIGNS, ANIM_DELAY_MAX, ANIM_FITS, ANIM_SOURCES, ANIM_STARTS, MAX_ANIMS, animLabel, normalizeAnim, type AnimAlign, type AnimFit, type AnimSpec, type AnimStart } from "@/lib/cms/banner-anim-core";
import { checkUpload, formatBytes } from "@/lib/media/upload-policy-core";
import { putSigned, tusSigned } from "@/lib/media/direct-upload-client";
import { startDirectUploadAction, finishDirectUploadAction } from "@/app/admin/media/direct-upload-actions";
import { listBannerAnimationsAction, type AnimChoice } from "@/app/admin/banner-anim-actions";
import { BannerAnim } from "@/components/site/anim/BannerAnim";
import type { AnimInfo } from "@/components/site/anim/AnimPlayer";
import { NumberSlider, Segmented, SelectField, Toggle, studioInput } from "./controls";
import { EnterFields } from "./EnterFields";
import { LottieFields, RiveFields } from "./AnimFields";
import type { StudioSelection } from "./StudioCanvas";

const box = "space-y-2 rounded-md border border-white/10 p-2";
const title = "text-[0.7rem] font-semibold uppercase tracking-wide text-white/60";
const hint = "text-[0.65rem] text-white/45";
const pill = "rounded-full bg-white/10 px-3 py-1 text-xs text-white/80 hover:bg-white/20 disabled:opacity-40";

export function AnimPanel({
  design,
  device,
  selection,
  onSelect,
  onChange,
  onRequestDelete,
}: {
  design: BannerDesign;
  device: DesignDevice;
  selection: StudioSelection;
  onSelect: (s: StudioSelection) => void;
  onChange: (d: BannerDesign) => void;
  onRequestDelete: (s: NonNullable<StudioSelection>) => void;
}) {
  const elements = design.elements ?? [];
  const anims = elements.filter((e) => e.kind === "anim");
  const el = selection?.target === "element" ? anims.find((e) => e.id === selection.id) : undefined;
  const full = anims.length >= MAX_ANIMS || elements.length >= MAX_ELEMENTS;
  const mobile = device === "mobile";

  const [library, setLibrary] = useState<AnimChoice[] | null>(null);
  const [libError, setLibError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [upError, setUpError] = useState<string | null>(null);
  const [info, setInfo] = useState<Record<string, AnimInfo>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [replay, setReplay] = useState(0);
  const [replaceMode, setReplaceMode] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    listBannerAnimationsAction()
      .then((l) => {
        setLibError(null);
        setLibrary(l);
      })
      .catch(() => setLibError("Couldn't load the Media Library list. Check your connection and press Refresh."));
  }, []);
  useEffect(load, [load]);

  const patchEl = (id: string, p: Partial<DesignElement>) => onChange({ ...design, elements: elements.map((e) => (e.id === id ? { ...e, ...p } : e)) });
  /** Every change goes through the normalizer, so the Studio never holds settings the site would drop. */
  const setAnim = (p: Partial<AnimSpec>) => {
    if (!el?.anim) return;
    const next = normalizeAnim({ ...el.anim, ...p });
    if (next) patchEl(el.id, { anim: next });
  };

  function addFile(c: { url: string; title: string }) {
    const a = normalizeAnim({ src: c.url, name: c.title });
    if (!a) return;
    if (replaceMode && el) {
      // Keep layout + timing; drop file-specific choices that may not exist in the new file.
      const keep = normalizeAnim({ src: a.src, name: a.name, start: el.anim?.start, delay: el.anim?.delay, fit: el.anim?.fit, align: el.anim?.align, alt: el.anim?.alt, stillHide: el.anim?.stillHide });
      if (keep) patchEl(el.id, { anim: keep });
      setReplaceMode(false);
      return;
    }
    if (full) return;
    const ne = defaultAnimElement(a, { id: nextId(design, a.engine === "rive" ? "rive" : "lottie") });
    onChange({ ...design, elements: [...elements, ne], ...(design.order ? { order: [...design.order, ne.id] } : {}) });
    onSelect({ target: "element", id: ne.id });
  }

  async function upload(file: File) {
    setUpError(null);
    const pre = checkUpload({ filename: file.name, mime: file.type, size: file.size });
    if (!pre.ok || pre.kind !== "animation") {
      setUpError(pre.ok ? `${file.name} isn't an animation. Use .lottie, Lottie .json or Rive .riv.` : pre.error);
      return;
    }
    setBusy(`Uploading ${file.name}…`);
    try {
      const start = await startDirectUploadAction({ filename: file.name, mime: pre.mime, size: file.size, usageType: "banner" });
      if (!start.ok) throw new Error(start.error);
      if (start.resumable) await tusSigned({ endpoint: start.endpoint, anonKey: start.anonKey, key: start.key, token: start.token, file, contentType: pre.mime });
      else await putSigned(start.key, start.token, file, pre.mime);
      setBusy("Checking the file…");
      const fin = await finishDirectUploadAction({ key: start.key, filename: file.name, size: file.size, title: file.name.replace(/\.[a-z0-9]+$/i, ""), usageType: "banner", status: "published" });
      if (!fin.ok) throw new Error(fin.error);
      if (pre.advisory) setUpError(pre.advisory);
      addFile({ url: fin.url, title: file.name.replace(/\.[a-z0-9]+$/i, "") });
      load();
    } catch (e) {
      setUpError((e as Error).message || "The upload failed. Please try again.");
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const a = el?.anim;
  const fileInfo = a ? (info[a.src] ?? null) : null;
  const onInfo = useCallback(
    (i: AnimInfo) => {
      if (!a) return;
      setLoadError(null);
      setInfo((m) => ({ ...m, [a.src]: i }));
      // Keep the file's own shape the first time we learn it.
      if (el && !a.ratio && i.width > 0 && i.height > 0) {
        const ratio = normalizeAnim({ ...a, ratio: i.width / i.height });
        if (ratio) patchEl(el.id, { anim: ratio });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [a?.src, a?.ratio, el?.id, design],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-white/70">
          🎞️ Animations ({anims.length}/{MAX_ANIMS})
        </span>
        <span className="text-[0.7rem] text-white/45">Lottie &amp; Rive · they pause off screen and respect “reduce motion”.</span>
      </div>

      {/* ── Add ── */}
      <div className={box}>
        <p className={title}>{replaceMode ? "Pick the new file for this layer" : "Add an animation"}</p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={pill} disabled={!!busy || (full && !replaceMode)} onClick={() => fileRef.current?.click()}>
            ⬆ Upload .lottie / .json / .riv
          </button>
          <button type="button" className={pill} onClick={load}>
            ↻ Refresh list
          </button>
          {replaceMode ? (
            <button type="button" className="text-xs text-white/60 underline" onClick={() => setReplaceMode(false)}>
              Cancel replace
            </button>
          ) : null}
          <input
            ref={fileRef}
            type="file"
            accept=".lottie,.json,.riv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
            }}
          />
        </div>
        {busy ? <p className="text-xs text-white/70">{busy}</p> : null}
        {upError ? <p className="text-xs text-amber-300/90">{upError}</p> : null}
        {full && !replaceMode ? <p className="text-xs text-amber-300/80">This banner has the most animations/layers it can hold — delete one to add another.</p> : null}
        {libError ? <p className="text-xs text-amber-300/90">{libError}</p> : null}
        {library === null && !libError ? <p className={hint}>Loading your animation files…</p> : null}
        {library?.length === 0 ? <p className={hint}>No animation files in the Media Library yet — upload one above (it is saved to the library too).</p> : null}
        {library?.length ? (
          <div className="grid max-h-56 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
            {library.map((c) => (
              <button
                key={c.id}
                type="button"
                disabled={full && !replaceMode}
                onClick={() => addFile(c)}
                className="flex items-center gap-2 rounded-md bg-black/30 px-2 py-1.5 text-left text-xs text-white/80 hover:bg-white/10 disabled:opacity-40"
              >
                <span className={c.engine === "rive" ? "rounded bg-fuchsia-500/30 px-1.5 text-[0.6rem] font-bold" : "rounded bg-sky-500/30 px-1.5 text-[0.6rem] font-bold"}>{c.engine === "rive" ? "RIVE" : "LOTTIE"}</span>
                <span className="flex-1 truncate">{c.title}</span>
                {c.size ? <span className="text-[0.6rem] text-white/40">{formatBytes(c.size)}</span> : null}
              </button>
            ))}
          </div>
        ) : null}
        <details>
          <summary className="cursor-pointer text-[0.7rem] text-white/60">Where to get animations</summary>
          <ul className="mt-1 space-y-1">
            {ANIM_SOURCES.map((s) => (
              <li key={s.url} className="text-[0.7rem] text-white/60">
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-[var(--admin-accent)] underline">
                  {s.label}
                </a>{" "}
                — {s.hint}
              </li>
            ))}
            <li className={hint}>Keep files small (under 1 MB is ideal). dotLottie (.lottie) is compressed and usually smallest. Check each file&apos;s licence before using it.</li>
          </ul>
        </details>
      </div>

      {/* ── Selected layer ── */}
      {el && a ? (
        <div className="space-y-3 rounded-lg border border-white/10 bg-black/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-xs font-semibold text-white/80">
              {animLabel(a)}
              {el.locked ? " 🔒" : ""}
            </p>
            <div className="flex gap-1">
              <button type="button" className={pill} onClick={() => setReplay((k) => k + 1)}>
                ▶ Replay
              </button>
              <button type="button" className={pill} onClick={() => setReplaceMode(true)}>
                ⇄ Replace file
              </button>
            </div>
          </div>
          <div className="relative mx-auto w-full max-w-[260px] overflow-hidden rounded-md border border-white/10 bg-[repeating-conic-gradient(#222_0%_25%,#2c2c2c_0%_50%)] [background-size:16px_16px]" style={{ aspectRatio: `${a.ratio ?? 1} / 1` }}>
            <BannerAnim key={a.src} anim={{ ...a, interactive: undefined }} preview replayKey={replay} onInfo={onInfo} onError={setLoadError} />
          </div>
          {loadError ? <p className="text-xs text-amber-300/90">{loadError}</p> : null}
          {fileInfo ? (
            <p className={hint}>
              {fileInfo.engine === "rive" ? "Rive" : "Lottie"} · {Math.round(fileInfo.width)}×{Math.round(fileInfo.height)}
              {fileInfo.frames ? ` · ${fileInfo.frames} frames` : ""}
              {fileInfo.rive ? ` · ${fileInfo.rive.artboards.length} artboard(s)` : ""}
            </p>
          ) : null}

          <div className={box}>
            <p className={title}>When it plays</p>
            <SelectField
              label="Start"
              value={a.start ?? "auto"}
              options={ANIM_STARTS.filter((s) => !(s.id === "scroll" && a.engine === "rive")).map((s) => ({ value: s.id, label: s.label }))}
              onChange={(v) => setAnim({ start: v as AnimStart })}
            />
            <p className={hint}>{ANIM_STARTS.find((s) => s.id === (a.start ?? "auto"))?.hint}</p>
            {(a.start ?? "auto") === "auto" ? <NumberSlider label="Wait before starting" value={a.delay ?? 0} min={0} max={ANIM_DELAY_MAX} step={0.1} unit="s" onChange={(delay) => setAnim({ delay })} /> : null}
          </div>

          {a.engine === "lottie" ? <LottieFields a={a} info={fileInfo} set={setAnim} /> : <RiveFields a={a} info={fileInfo} set={setAnim} />}

          <div className={box}>
            <p className={title}>Fit &amp; position inside its box</p>
            <SelectField label="Fit" value={a.fit ?? "contain"} options={ANIM_FITS.map((f) => ({ value: f.id, label: f.label }))} onChange={(v) => setAnim({ fit: v as AnimFit })} />
            <Segmented label="Anchor" value={a.align ?? "center"} options={ANIM_ALIGNS.map((x) => ({ value: x.id, label: x.label, title: x.id }))} onChange={(v) => setAnim({ align: v as AnimAlign })} />
          </div>

          <div className={box}>
            <p className={title}>Accessibility</p>
            <Toggle label="Hide for visitors who ask for reduced motion" checked={!!a.stillHide} onChange={(v) => setAnim({ stillHide: v || undefined })} />
            {!a.stillHide && a.engine === "lottie" ? <NumberSlider label="…otherwise show this moment as a still" value={a.still ?? 0} min={0} max={100} unit="%" onChange={(still) => setAnim({ still })} /> : null}
            {!a.stillHide && a.engine === "rive" ? <p className={hint}>Reduced motion: the first frame is shown as a still.</p> : null}
            <label className="block text-xs text-white/70">
              Description for screen readers (leave empty if decorative)
              <input className={studioInput} value={a.alt ?? ""} maxLength={160} onChange={(e) => setAnim({ alt: e.target.value || undefined })} placeholder="e.g. A leaf spinning gently" />
            </label>
          </div>

          <EnterFields enter={el.enter} reveal={design.reveal} onChange={(enter) => patchEl(el.id, { enter })} />
          <NumberSlider label="Rotate" value={el.rotate} min={-180} max={180} unit="°" onChange={(rotate) => patchEl(el.id, { rotate })} />
          <NumberSlider label="See-through" value={el.opacity} min={5} max={100} unit="%" onChange={(opacity) => patchEl(el.id, { opacity })} />

          <div className="rounded-md border border-white/10 p-2">
            <p className="mb-2 text-[0.7rem] font-semibold uppercase tracking-wide text-white/60">Size &amp; position {mobile ? "— phone layout" : "— computer layout"}</p>
            <div className="grid grid-cols-2 gap-2">
              <NumberSlider label="Across (X)" value={mobile ? (el.mx ?? el.x) : el.x} min={0} max={100} step={0.5} unit="%" onChange={(x) => patchEl(el.id, mobile ? { mx: x } : { x })} />
              <NumberSlider label="Down (Y)" value={mobile ? (el.my ?? el.y) : el.y} min={0} max={100} step={0.5} unit="%" onChange={(y) => patchEl(el.id, mobile ? { my: y } : { y })} />
              <NumberSlider label="Width" value={mobile ? (el.mw ?? el.w) : el.w} min={1} max={100} step={0.5} unit="%" onChange={(w) => patchEl(el.id, mobile ? { mw: w } : { w })} />
              {el.h !== null ? <NumberSlider label="Height" value={mobile ? (el.mh ?? el.h) : el.h} min={1} max={100} step={0.5} unit="%" onChange={(h) => patchEl(el.id, mobile ? { mh: h } : { h })} /> : null}
            </div>
            <div className="mt-2">
              <Toggle label="Keep the file's own shape" checked={el.h === null} onChange={(keep) => patchEl(el.id, keep ? { h: null, mh: null } : { h: 20 })} />
            </div>
            {mobile && (el.mx !== null || el.my !== null || el.mw !== null || el.mh !== null) ? (
              <button type="button" className="mt-2 text-xs text-white/60 underline" onClick={() => patchEl(el.id, { mx: null, my: null, mw: null, mh: null })}>
                Use computer size &amp; position on phones
              </button>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-3">
            <Toggle label="Show" checked={!el.hidden} onChange={(v) => patchEl(el.id, { hidden: !v })} />
            <Toggle label="Hide on phones" checked={el.hideOnMobile} onChange={(hideOnMobile) => patchEl(el.id, { hideOnMobile })} />
            <Toggle label="Lock in place" checked={!!el.locked} onChange={(v) => patchEl(el.id, { locked: v || undefined })} />
          </div>
          <div className="border-t border-white/10 pt-2">
            <button type="button" className="rounded-full bg-[var(--admin-danger)]/80 px-3 py-1 text-xs font-semibold text-white hover:bg-[var(--admin-danger)]" onClick={() => onRequestDelete({ target: "element", id: el.id })}>
              Delete animation
            </button>
          </div>
        </div>
      ) : anims.length ? (
        <div className="space-y-1">
          <p className={hint}>Click an animation in the preview (or below) to change it.</p>
          {anims.map((x) => (
            <button key={x.id} type="button" className="block w-full truncate rounded-md bg-black/30 px-2 py-1.5 text-left text-xs text-white/80 hover:bg-white/10" onClick={() => onSelect({ target: "element", id: x.id })}>
              {animLabel(x.anim)}
              {x.hidden ? " (hidden)" : ""}
            </button>
          ))}
        </div>
      ) : (
        <p className={hint}>Pick a file above. Tip: small looping accents (a leaf, a sparkle, an arrow) look the most professional.</p>
      )}
    </div>
  );
}
