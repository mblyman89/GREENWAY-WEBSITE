"use client";
/**
 * R56-S2 — "Upload your own font". Any .woff2/.woff/.ttf/.otf the owner
 * downloaded; the only requirement is the licence box. The file goes straight
 * from the browser to Storage (same path as the Media Library), the server
 * proves it's a font, and the new font is picked for you right away.
 */
import { useState } from "react";
import { customFontFaceCss, FONT_ACCEPT, FONT_LICENSE_STATEMENT, cleanFontLabel, checkFontUpload } from "@/lib/cms/custom-font-core";
import { putSigned } from "@/lib/media/direct-upload-client";
import { finishFontUploadAction, startFontUploadAction } from "@/app/admin/fonts/custom-font-actions";
import { addCustomFont, useCustomFonts } from "./custom-fonts-client";

/** @font-face for every uploaded font so admin previews show the real letters. */
export function CustomFontFaces() {
  const fonts = useCustomFonts();
  const css = customFontFaceCss(fonts.map((f) => f.id));
  return css ? <style data-gw-custom-fonts="">{css}</style> : null;
}

export function CustomFontUpload({ onUploaded }: { onUploaded?: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [licensed, setLicensed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err" | "info"; text: string } | null>(null);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs font-semibold text-[#7ed957] hover:underline">
        ＋ Upload your own font
      </button>
    );
  }

  async function upload() {
    if (!file) return;
    const pre = checkFontUpload({ filename: file.name, size: file.size, licenseConfirmed: licensed });
    if (!pre.ok) return setMsg({ tone: "err", text: pre.error });
    setBusy(true);
    setMsg({ tone: "info", text: "Uploading…" });
    try {
      const start = await startFontUploadAction({ filename: file.name, size: file.size, licenseConfirmed: licensed });
      if (!start.ok) return setMsg({ tone: "err", text: start.error });
      await putSigned(start.key, start.token, new File([file], file.name, { type: start.mime }), start.mime);
      const done = await finishFontUploadAction({ key: start.key, filename: file.name, size: file.size, name, licenseConfirmed: licensed });
      if (!done.ok) return setMsg({ tone: "err", text: done.error });
      addCustomFont(done.font);
      onUploaded?.(done.font.id);
      setMsg({ tone: "ok", text: `“${done.font.label}” is ready${start.advisory ? `. ${start.advisory}` : "."}` });
      setFile(null);
      setName("");
      setLicensed(false);
    } catch (e) {
      setMsg({ tone: "err", text: `Upload failed: ${e instanceof Error ? e.message : "network error"}. Please try again.` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-white/15 bg-black/40 p-3 text-xs text-white/80">
      <div className="flex items-center justify-between">
        <strong className="text-white">Upload your own font</strong>
        <button type="button" onClick={() => setOpen(false)} className="text-white/50 hover:text-white" aria-label="Close font upload">
          ✕
        </button>
      </div>
      <input
        type="file"
        accept={FONT_ACCEPT}
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          setFile(f);
          setMsg(null);
          if (f && !name) setName(cleanFontLabel("", f.name));
        }}
        className="block w-full text-xs file:mr-2 file:rounded file:border-0 file:bg-white/10 file:px-2 file:py-1 file:text-white"
      />
      <input
        type="text"
        value={name}
        maxLength={60}
        placeholder="Font name (shown in the font list)"
        onChange={(e) => setName(e.target.value)}
        className="w-full rounded border border-white/15 bg-black px-2 py-1 text-white"
      />
      <label className="flex items-start gap-2">
        <input type="checkbox" checked={licensed} onChange={(e) => setLicensed(e.target.checked)} className="mt-0.5" />
        <span>{FONT_LICENSE_STATEMENT}</span>
      </label>
      <p className="text-white/45">.woff2 (smallest, best), .woff, .ttf or .otf. Your confirmation is saved with your name and the date.</p>
      <button
        type="button"
        disabled={!file || !licensed || busy}
        onClick={upload}
        className="rounded bg-[#7ed957] px-3 py-1.5 font-bold text-black disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? "Uploading…" : "Upload font"}
      </button>
      {msg ? <p className={msg.tone === "err" ? "text-red-300" : msg.tone === "ok" ? "text-[#7ed957]" : "text-white/60"}>{msg.text}</p> : null}
    </div>
  );
}
