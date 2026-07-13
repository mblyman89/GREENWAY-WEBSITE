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
    <div className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)]">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--admin-border)] px-4 py-3">
        <div className="flex items-center gap-2 text-xs text-[var(--admin-text-muted)]">
          <span className="inline-block h-2 w-2 rounded-full bg-[var(--admin-accent)]" />
          Live preview · <span className="font-mono text-[var(--admin-text)]">{path}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-[var(--admin-radius-sm)] border border-[var(--admin-border-strong)]">
            {(["desktop", "tablet", "phone"] as Device[]).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDevice(d)}
                className={`admin-focus px-3 py-1.5 text-xs capitalize transition ${
                  device === d
                    ? "bg-[var(--admin-accent)] font-semibold text-black"
                    : "text-[var(--admin-text-muted)] hover:bg-[var(--admin-surface-hover)]"
                }`}
              >
                {d === "desktop" ? "🖥 Desktop" : d === "tablet" ? "📱 Tablet" : "📱 Phone"}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setNonce((n) => n + 1)}
            className="admin-focus rounded-[var(--admin-radius-sm)] border border-[var(--admin-border-strong)] px-3 py-1.5 text-xs text-[var(--admin-text-muted)] hover:bg-[var(--admin-surface-hover)]"
            title="Reload preview"
          >
            ↻ Refresh
          </button>
          <a
            href={`/api/admin/preview/enable?path=${encodeURIComponent(path)}`}
            target="_blank"
            rel="noreferrer"
            className="admin-focus rounded-[var(--admin-radius-sm)] border border-[var(--admin-border-strong)] px-3 py-1.5 text-xs text-[var(--admin-text-muted)] hover:bg-[var(--admin-surface-hover)]"
            title="Open preview in a new tab"
          >
            ↗ Open
          </a>
        </div>
      </div>

      {/* Frame */}
      <div className="flex justify-center overflow-auto bg-[var(--admin-canvas)] p-4" style={{ minHeight: height }}>
        <iframe
          ref={frameRef}
          src={src}
          title={`Preview of ${path}`}
          style={{
            width: width ? `${width}px` : "100%",
            height,
            maxWidth: "100%",
          }}
          className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-white"
        />
      </div>

      <p className="px-4 pb-3 text-center text-xs text-[var(--admin-text-faint)]">
        Hover the page and click <span className="text-[var(--admin-accent)]">✎ Edit</span>{" "}
        on any highlighted text to jump straight to it.
      </p>
    </div>
  );
}
