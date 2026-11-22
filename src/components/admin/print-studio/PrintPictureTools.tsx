"use client";

/**
 * D263 S3: picture tools for the Print Studio background. Upload from the
 * computer or drag-drop (straight into the media library), then FLUX:
 * make a picture, remove background, erase / replace what you paint,
 * stretch to the print shape (FLUX draws the white space), grow a side,
 * remove text (the enrichment FLUX text-erase) and enlarge 2×.
 * Results are saved to Media; "Use it" puts them on the canvas.
 */
import { useEffect, useRef, useState, useTransition } from "react";
import { MaskBrush } from "@/components/admin/newsletter/CanvasPictureTools";
import { printFindTextAction, printFluxPollAction, printPictureToolAction, printPollEraseAction, printStartEraseAction } from "@/app/admin/marketing/print-studio/actions";
import { startDirectUploadAction, finishDirectUploadAction } from "@/app/admin/media/direct-upload-actions";
import { putSigned, tusSigned } from "@/lib/media/direct-upload-client";
import { checkUpload } from "@/lib/media/upload-policy-core";
import { maskCoverageIssue } from "@/lib/cms/newsletter-picture-core";
import type { DesignPrint } from "@/lib/cms/banner-design-core";
import { printRatio } from "@/lib/cms/banner-design-core";
import type { FoundText } from "@/lib/enrichment/text-erase-core";

type Tool = "generate" | "remove-bg" | "erase" | "replace" | "fill" | "extend" | "text" | "upscale";
const TOOLS: { key: Tool; label: string; help: string; needs: boolean }[] = [
  { key: "generate", label: "✨ Make a picture (AI)", help: "Describe it. Then use Fill to print shape so it covers the whole sign.", needs: false },
  { key: "fill", label: "↔ Fill to print shape", help: "FLUX stretches the picture to this sign's exact shape and draws the new edges (no white space).", needs: true },
  { key: "extend", label: "⇲ Grow one side", help: "FLUX adds more picture on one side.", needs: true },
  { key: "remove-bg", label: "✂ Remove background", help: "Cuts the subject out (see-through PNG).", needs: true },
  { key: "erase", label: "🧽 Erase what I paint", help: "Paint over an object; FLUX fills it in to match.", needs: true },
  { key: "replace", label: "🎨 Replace what I paint", help: "Paint an area and say what goes there.", needs: true },
  { key: "text", label: "🔤 Remove text", help: "Finds words on the picture and FLUX erases the ones you tick.", needs: true },
  { key: "upscale", label: "🔍 Enlarge 2× (sharper print)", help: "Doubles the pixels. Run it again if the size card says the picture is too small.", needs: true },
];
const POLL_MS = 4000;
const MAX_POLLS = 75;
const ASPECTS = [
  { key: "wide", r: 1.5 },
  { key: "banner", r: 2 },
  { key: "square", r: 1 },
  { key: "tall", r: 2 / 3 },
];
const nearestAspect = (r: number) => ASPECTS.reduce((a, b) => (Math.abs(Math.log(b.r / r)) < Math.abs(Math.log(a.r / r)) ? b : a)).key;

export function PrintPictureTools({ src, print, onUse }: { src: string; print: DesignPrint; onUse: (url: string, title?: string) => void }) {
  const [tool, setTool] = useState<Tool>("generate");
  const [ask, setAsk] = useState("");
  const [side, setSide] = useState("all");
  const [mask, setMask] = useState<{ url: string | null; coverage: number }>({ url: null, coverage: 0 });
  const [found, setFound] = useState<(FoundText & { on: boolean })[] | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [drag, setDrag] = useState(false);
  const alive = useRef(true);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => () => void (alive.current = false), []);
  const def = TOOLS.find((t) => t.key === tool)!;
  const ratio = printRatio(print);

  const upload = (file: File) =>
    start(async () => {
      setMsg(null);
      const pre = checkUpload({ filename: file.name, mime: file.type, size: file.size });
      if (!pre.ok) return setMsg({ ok: false, text: pre.error });
      try {
        setBusy("Uploading…");
        const s = await startDirectUploadAction({ filename: file.name, mime: pre.mime, size: file.size, usageType: "banner" });
        if (!s.ok) throw new Error(s.error);
        if (s.resumable) await tusSigned({ endpoint: s.endpoint, anonKey: s.anonKey, key: s.key, token: s.token, file, contentType: pre.mime });
        else await putSigned(s.key, s.token, file, pre.mime);
        setBusy("Checking the file…");
        const title = file.name.replace(/\.[a-z0-9]+$/i, "");
        const fin = await finishDirectUploadAction({ key: s.key, filename: file.name, size: file.size, title, usageType: "banner", status: "published" });
        if (!fin.ok) throw new Error(fin.error);
        onUse(fin.url, title);
        setMsg({ ok: true, text: `Uploaded to Media and placed on the canvas.${pre.advisory ? ` ${pre.advisory}` : ""}` });
      } catch (e) {
        setMsg({ ok: false, text: e instanceof Error ? e.message : "Upload failed." });
      } finally {
        setBusy(null);
      }
    });

  const poll = async (next: () => Promise<{ state: string; url?: string; error?: string; progress?: number }>) => {
    for (let n = 0; n < MAX_POLLS && alive.current; n++) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const r = await next();
      if (r.state === "pending") {
        setBusy(`FLUX is working${r.progress ? ` (${Math.round(r.progress * 100)}%)` : ""}…`);
        continue;
      }
      if (r.state === "failed") return setMsg({ ok: false, text: `FLUX: ${r.error}` });
      setResult(r.url ?? null);
      return setMsg({ ok: true, text: "Saved to Media. Compare, then press Use it." });
    }
    setMsg({ ok: false, text: "FLUX took too long. The picture may still appear in Media later." });
  };

  const run = () =>
    start(async () => {
      setMsg(null);
      setResult(null);
      try {
        if (tool === "text") {
          if (!found) {
            setBusy("Looking for text…");
            const f = await printFindTextAction(src);
            if (!f.ok) return setMsg({ ok: false, text: f.error });
            if (!f.found.length) return setMsg({ ok: true, text: "No text found on this picture." });
            setFound(f.found.map((x) => ({ ...x, on: x.advice !== "keep" })));
            return setMsg({ ok: true, text: "Tick the words to remove, then press Remove ticked text." });
          }
          const boxes = JSON.stringify(found.filter((x) => x.on).map((x) => x.box));
          setBusy("Sending to FLUX…");
          const s = await printStartEraseAction(src, boxes);
          if (!s.ok) return setMsg({ ok: false, text: s.error });
          setFound(null);
          return await poll(() => printPollEraseAction(s.pollingUrl, s.mediaId ?? "", boxes, s.mode));
        }
        if ((tool === "erase" || tool === "replace") && maskCoverageIssue(mask.coverage)) return setMsg({ ok: false, text: maskCoverageIssue(mask.coverage)! });
        if ((tool === "generate" || tool === "replace") && !ask.trim()) return setMsg({ ok: false, text: "Say what you want first." });
        setBusy("Working…");
        const out = await printPictureToolAction({
          tool: tool === "fill" ? "extend" : tool,
          engine: null,
          sourceUrl: tool === "generate" ? null : src,
          ask,
          aspect: nearestAspect(ratio),
          maskDataUrl: mask.url,
          ratio: tool === "fill" ? ratio : null,
          side,
          percent: 40,
        });
        if (!out.ok) return setMsg({ ok: false, text: out.error });
        if (out.kind === "flux") return await poll(() => printFluxPollAction(out.pollingUrl, out.prompt));
        setResult(out.results[0]?.url ?? null);
        setMsg({ ok: true, text: `Saved to Media.${out.note ? ` ${out.note}` : ""} Press Use it to put it on the canvas.` });
      } catch (e) {
        setMsg({ ok: false, text: e instanceof Error ? e.message : "The picture tool failed." });
      } finally {
        if (alive.current) setBusy(null);
      }
    });

  const btn = "rounded-full px-3 py-1 text-xs font-semibold";
  return (
    <div className="space-y-2 text-xs">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files?.[0];
          if (f) upload(f);
        }}
        className={`rounded-md border-2 border-dashed p-3 text-center ${drag ? "border-[var(--admin-accent)] bg-[var(--admin-accent)]/10" : "border-white/20"}`}
      >
        Drop a picture here, or{" "}
        <button type="button" className="underline" onClick={() => fileRef.current?.click()} disabled={pending}>
          upload from this computer
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      </div>

      <div className="flex flex-wrap gap-1">
        {TOOLS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              setTool(t.key);
              setFound(null);
              setMsg(null);
              setMask({ url: null, coverage: 0 });
            }}
            className={`${btn} ${tool === t.key ? "bg-[var(--admin-accent)] text-black" : "bg-white/10 text-white/80 hover:bg-white/20"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="text-white/60">{def.help}</p>
      {def.needs && !src ? <p className="text-[var(--admin-gold)]">Pick or upload a picture first.</p> : null}
      {tool === "generate" || tool === "replace" || tool === "erase" || tool === "fill" || tool === "extend" ? (
        <textarea
          value={ask}
          onChange={(e) => setAsk(e.target.value)}
          rows={2}
          placeholder={tool === "generate" ? "A sunny storefront with green leaves…" : "Optional: what should appear there"}
          className="w-full rounded border border-white/15 bg-black/40 p-2 text-white"
        />
      ) : null}
      {tool === "extend" ? (
        <select value={side} onChange={(e) => setSide(e.target.value)} className="rounded border border-white/15 bg-black/40 px-2 py-1">
          {["all", "left", "right", "top", "bottom"].map((s) => (
            <option key={s} value={s}>
              {s === "all" ? "All sides" : s}
            </option>
          ))}
        </select>
      ) : null}
      {(tool === "erase" || tool === "replace") && src ? <MaskBrush src={src} onMask={(url, coverage) => setMask({ url, coverage })} /> : null}
      {found ? (
        <ul className="space-y-1">
          {found.map((f, i) => (
            <li key={i}>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={f.on} onChange={() => setFound(found.map((x, j) => (j === i ? { ...x, on: !x.on } : x)))} />
                <span>“{f.text}”</span>
                <span className="text-white/45">AI says {f.advice}</span>
              </label>
            </li>
          ))}
        </ul>
      ) : null}
      <button type="button" onClick={run} disabled={pending || (def.needs && !src)} className={`${btn} bg-[#ffd700] text-black disabled:opacity-40`}>
        {busy ?? (tool === "text" ? (found ? "Remove ticked text" : "Find the text") : "Run")}
      </button>
      {msg ? <p className={msg.ok ? "text-emerald-300" : "text-red-300"}>{msg.text}</p> : null}
      {result ? (
        <div className="flex flex-wrap items-start gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={result} alt="Result" className="max-h-40 rounded border border-white/15 bg-[repeating-conic-gradient(#555_0_25%,#333_0_50%)] bg-[length:16px_16px]" />
          <button type="button" className={`${btn} bg-[var(--admin-accent)] text-black`} onClick={() => (onUse(result), setResult(null))}>
            Use it
          </button>
        </div>
      ) : null}
    </div>
  );
}
