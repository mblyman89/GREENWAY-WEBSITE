"use client";

/**
 * PreviewFrame — embeds a live preview of a public page (in Draft Mode) inside
 * an admin editor, with desktop / tablet / phone size toggles and a refresh.
 *
 * The iframe loads the public path through the Draft Mode enable route so it
 * shows unpublished drafts. Inside that page, <PreviewEditOverlay> tags blocks
 * with "✎ Edit"; clicking one posts a `gw-preview-edit` message back here, and
 * we call `onEditBlock(blockKey)` so the editor can scroll to / focus that field.
 *
 * Usage:
 *   <PreviewFrame path="/menu" onEditBlock={(k) => focusField(k)} />
 */
import { useEffect, useMemo, useRef, useState } from "react";

type Device = "desktop" | "tablet" | "phone";

const DEVICE_WIDTH: Record<Device, number | null> = {
  desktop: null, // full width
  tablet: 834,
  phone: 390,
};

export function PreviewFrame({
  path,
  height = 640,
  onEditBlock,
}: {
  path: string;
  height?: number;
  onEditBlock?: (blockKey: string) => void;
}) {
  const [device, setDevice] = useState<Device>("desktop");
  const [nonce, setNonce] = useState(0); // bump to force reload
  const frameRef = useRef<HTMLIFrameElement>(null);

  // The iframe goes through the enable route so Draft Mode is on for it.
  const src = useMemo(() => {
    const enable = `/api/admin/preview/enable?path=${encodeURIComponent(path)}`;
    return `${enable}${enable.includes("?") ? "&" : "?"}_n=${nonce}`;
  }, [path, nonce]);

  // Listen for "edit this block" messages from the previewed page.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      const data = e.data as { type?: string; blockKey?: string } | null;
      if (data?.type === "gw-preview-edit" && data.blockKey) {
        onEditBlock?.(data.blockKey);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onEditBlock]);

  const width = DEVICE_WIDTH[device];

  return (
    <div className="rounded-xl border border-white/10 bg-[#0a0a0a]">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2 text-xs text-white/50">
          <span className="inline-block h-2 w-2 rounded-full bg-[#7ed957]" />
          Live preview · <span className="font-mono text-white/70">{path}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-white/15">
            {(["desktop", "tablet", "phone"] as Device[]).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDevice(d)}
                className={`px-3 py-1.5 text-xs capitalize transition ${
                  device === d
                    ? "bg-[#7ed957] text-black"
                    : "text-white/60 hover:bg-white/5"
                }`}
              >
                {d === "desktop" ? "🖥 Desktop" : d === "tablet" ? "📱 Tablet" : "📱 Phone"}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setNonce((n) => n + 1)}
            className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/70 hover:bg-white/5"
            title="Reload preview"
          >
            ↻ Refresh
          </button>
          <a
            href={`/api/admin/preview/enable?path=${encodeURIComponent(path)}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/70 hover:bg-white/5"
            title="Open preview in a new tab"
          >
            ↗ Open
          </a>
        </div>
      </div>

      {/* Frame */}
      <div className="flex justify-center overflow-auto bg-[#050505] p-4" style={{ minHeight: height }}>
        <iframe
          ref={frameRef}
          src={src}
          title={`Preview of ${path}`}
          style={{
            width: width ? `${width}px` : "100%",
            height,
            maxWidth: "100%",
          }}
          className="rounded-lg border border-white/10 bg-white"
        />
      </div>

      <p className="px-4 pb-3 text-center text-xs text-white/40">
        Hover the page and click <span className="text-[#7ed957]">✎ Edit</span>{" "}
        on any highlighted text to jump straight to it.
      </p>
    </div>
  );
}
