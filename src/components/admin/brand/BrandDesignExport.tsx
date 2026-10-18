"use client";

/**
 * R73 S6 — "Save as picture": turns a saved Brand design into a finished PNG at
 * an exact size and files it in the Media Library (Merch folder by default),
 * so Merch Banners / blog / newsletter can attach it like any other image.
 *
 * It renders the SAME public <DesignedBanner> offscreen (a "still" copy: no
 * entrances, square corners) and rasterises it with modern-screenshot (MIT),
 * then uploads through the existing direct-upload actions. No new renderer.
 */
import { useRef, useState } from "react";
import { DesignedBanner } from "@/components/site/DesignedBanner";
import type { BannerDesign } from "@/lib/cms/banner-design-core";
import { EXPORT_FOLDERS, exportFilename, exportPlan, stillDesign, type BrandSize } from "@/lib/brand/brand-sizes-core";
import { putSigned, tusSigned } from "@/lib/media/direct-upload-client";
import { finishDirectUploadAction, startDirectUploadAction } from "@/app/admin/media/direct-upload-actions";

type Status = { kind: "idle" } | { kind: "busy" } | { kind: "ok"; url: string; folder: string } | { kind: "err"; msg: string };

export function BrandDesignExport({ name, image, design, size }: { name: string; image: string; design: BannerDesign; size?: BrandSize }) {
  const [folder, setFolder] = useState("merch");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [rendering, setRendering] = useState(false);
  const holder = useRef<HTMLDivElement>(null);
  const plan = exportPlan(design, size);

  async function run() {
    setStatus({ kind: "busy" });
    setRendering(true);
    try {
      // let React paint the offscreen copy before capturing it
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const node = holder.current?.firstElementChild as HTMLElement | null;
      if (!node) throw new Error("Couldn't prepare the picture — try again.");
      const { domToBlob } = await import("modern-screenshot");
      const blob = await domToBlob(node, {
        width: plan.renderW,
        height: plan.renderH,
        scale: plan.scale,
        backgroundColor: "#1a1a1a",
        type: "image/png",
        timeout: 20000,
      });
      if (!blob || !blob.size) throw new Error("The picture came out empty — try again.");
      const filename = exportFilename(name, plan);
      const mime = "image/png";
      const start = await startDirectUploadAction({ filename, mime, size: blob.size, usageType: folder });
      if (!start.ok) throw new Error(start.error);
      // Big pictures (> 6 MB) go through the resumable path, like the Media Library dropzone.
      if (start.resumable) await tusSigned({ endpoint: start.endpoint, anonKey: start.anonKey, key: start.key, token: start.token, file: new File([blob], filename, { type: mime }), contentType: mime });
      else await putSigned(start.key, start.token, blob, mime);
      const fin = await finishDirectUploadAction({
        key: start.key,
        filename,
        size: blob.size,
        width: plan.outW,
        height: plan.outH,
        title: name,
        usageType: folder,
        status: "published",
      });
      if (!fin.ok) throw new Error(fin.error);
      setStatus({ kind: "ok", url: fin.url ?? "", folder });
    } catch (e) {
      setStatus({ kind: "err", msg: (e as Error).message || "Saving the picture failed." });
    } finally {
      setRendering(false);
    }
  }

  return (
    <div className="space-y-1 rounded border border-[var(--admin-border)] p-2 text-xs text-[var(--admin-text)]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold">Save as picture</span>
        <span className="text-[var(--admin-text-muted)]">
          {plan.outW}×{plan.outH} PNG →
        </span>
        <select value={folder} onChange={(e) => setFolder(e.target.value)} className="rounded border border-[var(--admin-border)] bg-[var(--admin-surface)] px-1 py-0.5" aria-label="Media Library folder">
          {EXPORT_FOLDERS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
        <button type="button" onClick={run} disabled={status.kind === "busy"} className="rounded bg-[var(--admin-accent)] px-2 py-0.5 font-bold text-black disabled:opacity-50">
          {status.kind === "busy" ? "Saving…" : "Save to Media Library"}
        </button>
      </div>
      {status.kind === "ok" ? (
        <p className="text-green-400">
          Saved to the {EXPORT_FOLDERS.find((f) => f.id === status.folder)?.label ?? status.folder} folder.{" "}
          {status.url ? (
            <a href={status.url} target="_blank" rel="noopener noreferrer" className="underline">
              View picture
            </a>
          ) : null}
        </p>
      ) : null}
      {status.kind === "err" ? <p className="text-red-400">{status.msg}</p> : null}
      {rendering ? (
        <div aria-hidden="true" style={{ position: "fixed", left: -20000, top: 0, pointerEvents: "none" }}>
          <div ref={holder} style={{ width: plan.renderW }}>
            <DesignedBanner design={stillDesign(design)} imageSrc={image} imageAlt="" legacy={{}} frameClassName="" priority />
          </div>
        </div>
      ) : null}
    </div>
  );
}
