"use client";

/**
 * PreviewFrame — embeds a live preview of a public page (in Draft Mode) inside
 * an admin editor, with desktop / tablet / phone size toggles and a refresh.
 *
 * The iframe loads the public path through the Draft Mode enable route so it
 * shows unpublished drafts. Inside that page, <PreviewEditOverlay> tags blocks
 * with "✎ Edit"; clicking one posts a `gw-preview-edit` message back here, and
 * we call `onEditBlock(blockKey)` so the editor can scroll to / focus that field,
 * or (R43) `onEditTarget(href)` with the /admin/edit?… link so the host can
 * open the owning editor.
 *
 * Usage:
 *   <PreviewFrame path="/menu" onEditBlock={(k) => focusField(k)} />
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseMoveMessage, type DesignMove } from "@/lib/cms/banner-design-core";
import { isSafeAdminHref } from "@/lib/cms/edit-link-core";

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
  onEditTarget,
  moveMode = false,
  onDesignMove,
  onMoveReady,
  reloadSignal = 0,
}: {
  path: string;
  height?: number;
  onEditBlock?: (blockKey: string) => void;
  /** R43: a validated /admin/edit?… link from a ✎ Edit click (used when there is no onEditBlock or no block). */
  onEditTarget?: (href: string) => void;
  /** R41 S7: when true, the previewed page lets the owner drag designed-banner text/buttons. */
  moveMode?: boolean;
  /** R41 S7: a validated `gw-design-move` from the previewed page (owner dropped an item). */
  onDesignMove?: (move: DesignMove & { owner: string }) => void;
  /** R41 S7: how many movable items the previewed page has while Move mode is on. */
  onMoveReady?: (count: number) => void;
  /** R41 S7: bump to reload the preview (e.g. after a move was saved). */
  reloadSignal?: number;
}) {
  const [device, setDevice] = useState<Device>("desktop");
  const [nonce, setNonce] = useState(0); // bump to force reload
  const frameRef = useRef<HTMLIFrameElement>(null);
  const moveRef = useRef(moveMode);

  // The iframe goes through the enable route so Draft Mode is on for it.
  const src = useMemo(() => {
    const enable = `/api/admin/preview/enable?path=${encodeURIComponent(path)}`;
    return `${enable}${enable.includes("?") ? "&" : "?"}_n=${nonce}.${reloadSignal}`;
  }, [path, nonce, reloadSignal]);

  // R41 S7: tell the previewed page whether Move mode is on (same origin only).
  const sendMoveMode = useCallback(() => {
    frameRef.current?.contentWindow?.postMessage({ type: "gw-move-mode", on: moveRef.current }, window.location.origin);
  }, []);
  useEffect(() => {
    moveRef.current = moveMode;
    sendMoveMode();
  }, [moveMode, sendMoveMode]);

  // R41 S7: moves + handshake from the previewed page. Only our own iframe,
  // only our own origin, and the payload is re-validated (and again on the server).
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      if (!frameRef.current || e.source !== frameRef.current.contentWindow) return;
      const data = e.data as { type?: string; count?: unknown } | null;
      if (data?.type === "gw-move-hello") sendMoveMode();
      else if (data?.type === "gw-move-ready") onMoveReady?.(typeof data.count === "number" ? data.count : 0);
      else if (data?.type === "gw-design-move" && moveRef.current) {
        const move = parseMoveMessage(data);
        if (move) onDesignMove?.(move);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onDesignMove, onMoveReady, sendMoveMode]);

  // Listen for "✎ Edit" clicks from the previewed page. Only our own iframe and
  // our own origin. R43: the message also carries `target` (an /admin/edit?…
  // link); when the host passes onEditTarget it gets that (re-validated as a
  // same-site /admin path), otherwise a block-aware host gets onEditBlock.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      if (!frameRef.current || e.source !== frameRef.current.contentWindow) return;
      const data = e.data as { type?: string; blockKey?: unknown; target?: unknown } | null;
      if (data?.type !== "gw-preview-edit") return;
      const blockKey = typeof data.blockKey === "string" && data.blockKey ? data.blockKey : null;
      if (onEditBlock && blockKey) onEditBlock(blockKey);
      else if (onEditTarget && isSafeAdminHref(data.target)) onEditTarget(data.target);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onEditBlock, onEditTarget]);

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
          onLoad={sendMoveMode}
          style={{
            width: width ? `${width}px` : "100%",
            height,
            maxWidth: "100%",
          }}
          className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-white"
        />
      </div>

      {moveMode ? (
        <p className="px-4 pb-3 text-center text-xs text-[var(--admin-text-faint)]">
          Move mode is on: drag any outlined text or button, or click it and use the arrow keys then Enter.
          Phone size moves the phone layout only.
        </p>
      ) : (
        <p className="px-4 pb-3 text-center text-xs text-[var(--admin-text-faint)]">
          Click any green <span className="text-[var(--admin-accent)]">✎ Edit</span> button on the
          page to jump straight to where that item is edited.
        </p>
      )}
    </div>
  );
}
