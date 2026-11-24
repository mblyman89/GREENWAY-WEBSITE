"use client";

/**
 * D267 - Artwork from the Media library (logos first) + "Prep for Printful".
 * Pick (or upload to Media) -> see the DPI at this placement -> one-click
 * prep (FLUX sharpen when it is too soft, then enlarge to 300 DPI) or the
 * single tools (enlarge, FLUX sharpen, remove background) -> place it.
 * Placing reuses the Studio's normal upload path (onFile), so the checks,
 * layers and print export all work exactly as for a file from this device.
 */
import { useEffect, useRef, useState } from "react";
import { LibraryPicker } from "@/components/admin/banner-studio/LibraryPicker";
import { printFluxPollAction } from "@/app/admin/marketing/print-studio/actions";
import { merchKeyOutAction, merchRemoveBgAction, merchSharpenAction, merchUpscaleAction, type PrepOut } from "@/app/admin/merch-studio/art-prep-actions";
import { startDirectUploadAction, finishDirectUploadAction } from "@/app/admin/media/direct-upload-actions";
import { putSigned, tusSigned } from "@/lib/media/direct-upload-client";
import { checkUpload } from "@/lib/media/upload-policy-core";
import { printVerdict, type ArtChoice } from "@/lib/merch-studio/art-prep-core";
import type { Placement } from "@/lib/merch-studio/garment-catalog-core";

const POLL_MS = 4000;
const MAX_POLLS = 75;
type Pick = { url: string; title: string; w: number; h: number; vector: boolean };
const abs = (u: string) => (u.startsWith("/") ? `${window.location.origin}${u}` : u);
const btn = "rounded-[var(--admin-radius-sm)] bg-white/10 px-2.5 py-1 text-xs text-white/85 hover:bg-white/20 disabled:opacity-40";

export function ArtLibraryPanel({ choices, placement, disabled, onFile }: { choices: ArtChoice[]; placement: Placement; disabled: boolean; onFile: (f: File) => void | Promise<void> }) {
  const [pick, setPick] = useState<Pick | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);
  const byId = new Map(choices.map((c) => [c.id, c]));
  const items = choices.map((c) => ({ id: c.id, label: c.title, cat: c.logo ? "Logos" : "Library", k: c.source === "brand" ? "brand kit logo" : "" }));
  const logoCount = choices.filter((c) => c.logo).length;

  const load = (url: string, title: string) =>
    new Promise<Pick>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ url, title, w: img.naturalWidth, h: img.naturalHeight, vector: /\.svg(\?|$)/i.test(url) });
      img.onerror = () => reject(new Error("That picture could not be loaded."));
      img.src = url;
    });
  const choose = async (url: string, title: string, note?: string) => {
    try {
      const p = await load(abs(url), title);
      if (alive.current) setPick(p);
      if (note) setMsg({ ok: true, text: note });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Could not load it." });
    }
  };

  const pollFlux = async (pollingUrl: string, prompt: string): Promise<string> => {
    for (let n = 0; n < MAX_POLLS && alive.current; n++) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const r = await printFluxPollAction(pollingUrl, prompt);
      if (r.state === "ready") return r.url;
      if (r.state === "failed") throw new Error(r.error);
      setBusy(`FLUX working… ${Math.round((r.progress ?? 0) * 100)}%`);
    }
    throw new Error("FLUX took too long - try again.");
  };
  const done = async (out: PrepOut): Promise<{ url: string; note: string }> => {
    if (!out.ok) throw new Error(out.error);
    if (out.kind === "done") return { url: out.url, note: out.note };
    return { url: await pollFlux(out.pollingUrl, out.prompt), note: "Sharpened with FLUX." };
  };
  const run = async (label: string, fn: (p: Pick) => Promise<{ url: string; note: string } | null>) => {
    if (!pick) return;
    setMsg(null);
    setBusy(label);
    try {
      const r = await fn(pick);
      if (r) await choose(r.url, pick.title, `${r.note} Saved to Media (original kept).`);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "That did not work." });
    } finally {
      if (alive.current) setBusy(null);
    }
  };
  const size = { widthIn: placement.widthIn, heightIn: placement.heightIn };
  const upscale = (p: Pick) => merchUpscaleAction({ url: p.url, title: p.title, ...size }).then(done);
  const sharpen = (p: Pick) => merchSharpenAction({ url: p.url }).then(done);
  const removeBg = async (p: Pick) => {
    const r = await merchRemoveBgAction({ url: p.url, title: p.title });
    if (!r.ok) throw new Error(r.error);
    if (r.kind === "done") return { url: r.url, note: r.note };
    const flat = await pollFlux(r.pollingUrl, r.prompt);
    setBusy("Cutting out the background…");
    return done(await merchKeyOutAction({ url: flat, title: p.title }));
  };
  const autoPrep = async (p: Pick) => {
    const v = printVerdict(p.w, p.h, size.widthIn, size.heightIn, p.vector);
    if (v.level === "ideal") return { url: p.url, note: "Already print-ready." };
    let cur = p.url;
    const notes: string[] = [];
    if (v.level === "low") {
      setBusy("FLUX sharpening…");
      const s = await sharpen(p);
      cur = s.url;
      notes.push(s.note);
    }
    setBusy("Enlarging to 300 DPI…");
    const u = await done(await merchUpscaleAction({ url: cur, title: p.title, ...size })).catch((e: Error) => (notes.length ? { url: cur, note: e.message } : Promise.reject(e)));
    notes.push(u.note);
    return { url: u.url, note: notes.join(" ") };
  };
  const place = async () => {
    if (!pick) return;
    setBusy("Placing…");
    try {
      const res = await fetch(pick.url);
      if (!res.ok) throw new Error(`Could not download it (HTTP ${res.status}).`);
      const blob = await res.blob();
      const ext = blob.type === "image/svg+xml" ? "svg" : blob.type === "image/jpeg" ? "jpg" : blob.type === "image/webp" ? "webp" : "png";
      await onFile(new File([blob], `${pick.title.replace(/[^\w -]+/g, "").slice(0, 60) || "artwork"}.${ext}`, { type: blob.type || "image/png" }));
      setMsg({ ok: true, text: `Placed on ${placement.label}.` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Could not place it." });
    } finally {
      setBusy(null);
    }
  };
  const upload = async (file: File) => {
    const pre = checkUpload({ filename: file.name, mime: file.type, size: file.size });
    if (!pre.ok) return setMsg({ ok: false, text: pre.error });
    setMsg(null);
    setBusy("Uploading to Media…");
    try {
      const s = await startDirectUploadAction({ filename: file.name, mime: pre.mime, size: file.size, usageType: "merch" });
      if (!s.ok) throw new Error(s.error);
      if (s.resumable) await tusSigned({ endpoint: s.endpoint, anonKey: s.anonKey, key: s.key, token: s.token, file, contentType: pre.mime });
      else await putSigned(s.key, s.token, file, pre.mime);
      const title = file.name.replace(/\.[a-z0-9]+$/i, "");
      const fin = await finishDirectUploadAction({ key: s.key, filename: file.name, size: file.size, title, usageType: "merch", status: "published" });
      if (!fin.ok) throw new Error(fin.error);
      await choose(fin.url, title, "Uploaded to Media. Prep it below, then place it.");
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Upload failed." });
    } finally {
      setBusy(null);
    }
  };

  const v = pick ? printVerdict(pick.w, pick.h, placement.widthIn, placement.heightIn, pick.vector) : null;
  const tone = v?.level === "ideal" ? "text-[var(--admin-accent)]" : v?.level === "ok" ? "text-[var(--admin-gold)]" : "text-red-300";
  const off = disabled || !!busy;
  return (
    <div className="space-y-2 rounded-[var(--admin-radius-sm)] border border-white/10 bg-black/20 p-2">
      <p className="text-xs font-semibold text-white">From Media library {logoCount ? <span className="font-normal text-white/50">· {logoCount} logos first</span> : null}</p>
      {choices.length ? (
        <LibraryPicker items={items} cats={["Logos", "Library"]} noun="pictures" placeholder="Search logos & pictures…" disabled={off} cols="grid-cols-5 sm:grid-cols-7" maxH="max-h-44"
          thumb={(i) => {
            const c = byId.get(i.id);
            // eslint-disable-next-line @next/next/no-img-element
            return c ? <img src={c.url} alt="" loading="lazy" className="h-full w-full rounded bg-[repeating-conic-gradient(#3a3a3a_0_25%,#2a2a2a_0_50%)] bg-[length:10px_10px] object-contain" /> : null;
          }}
          onPick={(i) => { const c = byId.get(i.id); if (c) void choose(c.url, c.title); }} />
      ) : <p className="text-xs text-white/50">No pictures in Media yet.</p>}
      <label className="block text-[0.72rem] text-white/60">
        Or upload to Media &amp; prep:{" "}
        <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" disabled={off} className="text-xs text-white/80"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.currentTarget.value = ""; }} />
      </label>
      {pick && v ? (
        <div className="flex gap-2 border-t border-white/10 pt-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={pick.url} alt="" className="h-20 w-20 shrink-0 rounded bg-[repeating-conic-gradient(#3a3a3a_0_25%,#2a2a2a_0_50%)] bg-[length:10px_10px] object-contain" />
          <div className="min-w-0 space-y-1 text-xs">
            <p className="truncate text-white">{pick.title} <span className="text-white/50">{pick.vector ? "SVG" : `${pick.w} × ${pick.h} px`}</span></p>
            <p className={tone}>{placement.label} ({placement.widthIn}×{placement.heightIn} in): {v.text}</p>
            <div className="flex flex-wrap gap-1">
              {!pick.vector && v.level !== "ideal" ? <button type="button" disabled={off} className={`${btn} !bg-[var(--admin-accent)] font-bold !text-black`} onClick={() => void run("Prepping…", autoPrep)} title="FLUX sharpen if it is soft, then enlarge to 300 DPI at this placement">✨ Prep for Printful</button> : null}
              {!pick.vector && v.level !== "ideal" ? <button type="button" disabled={off} className={btn} onClick={() => void run("Enlarging to 300 DPI…", upscale)}>Enlarge to 300 DPI</button> : null}
              {!pick.vector ? <button type="button" disabled={off} className={btn} onClick={() => void run("FLUX sharpening…", sharpen)} title="FLUX Deblur - rebuilds soft or pixelated edges">Sharpen (FLUX)</button> : null}
              {!pick.vector ? <button type="button" disabled={off} className={btn} onClick={() => void run("Removing background…", removeBg)} title="Transparent PNG - no box on the shirt. Flat backgrounds are cut out exactly (free); busy ones use FLUX.">Remove background</button> : null}
              <button type="button" disabled={off} className={`${btn} !bg-white/20 font-semibold text-white`} onClick={() => void place()}>Place on garment</button>
            </div>
          </div>
        </div>
      ) : null}
      {busy ? <p className="text-xs text-white/60">{busy}</p> : null}
      {msg ? <p className={`text-xs ${msg.ok ? "text-[var(--admin-accent)]" : "text-red-300"}`}>{msg.text}</p> : null}
    </div>
  );
}
