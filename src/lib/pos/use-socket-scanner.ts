"use client";

/**
 * src/lib/pos/use-socket-scanner.ts  (SLICE 12)
 *
 * The React seam for Socket Mobile scanning.
 *
 * Both places that scan -- the ID gate and the cart -- need exactly the same
 * three things: start a session on mount, stop it on unmount, and know whether
 * the SDK currently owns scanning so the keyboard-wedge listener can stand
 * down. This hook is that, and nothing else. All policy is in
 * socket-scan-core.ts (pure, unit tested) and all plumbing is in
 * socket-scanner.ts.
 *
 * ── WHY OWNERSHIP IS A REF, NOT ONLY STATE ────────────────────────────────
 *
 * The wedge listeners are bound inside useEffect blocks that deliberately do
 * NOT re-bind on every render (SaleFlow keeps them keyed to `mode` and
 * `handleGlobalScan`). A listener closing over a boolean captured at bind time
 * would keep consulting a STALE value -- so a scanner connecting after the
 * listener was bound would never actually silence the wedge, and every scan
 * would arrive twice. That is precisely the bug this slice exists to prevent,
 * so ownership is read through a ref that the listener dereferences at event
 * time. The state copy exists only so the UI can re-render a status line.
 *
 * ── THE RULE ──────────────────────────────────────────────────────────────
 *
 * A SALE IS NEVER BLOCKED BY A SCANNER. If there is no native plugin, the
 * session is inert, `sdkOwnsScanning` stays false, and the register behaves
 * exactly as it does today.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { startSocketSession, type SocketSession } from "./socket-scanner";
import type { SocketScanRoute } from "./socket-scan-core";

export type UseSocketScannerOptions = {
  /** Turn the session on. Pass false to keep the hook inert (e.g. wrong screen). */
  enabled: boolean;
  /** An accepted, routed scan from the SDK. */
  onScan: (payload: string, route: SocketScanRoute) => void;
};

export type UseSocketScannerResult = {
  /**
   * Read at EVENT TIME by the wedge listeners. A function rather than a
   * boolean so a listener bound once still gets today's answer.
   */
  sdkOwnsScanning: () => boolean;
  /** True while a Socket scanner is connected -- for rendering only. */
  connected: boolean;
  /** Latest human-readable status, or null. */
  status: string | null;
};

export function useSocketScanner(options: UseSocketScannerOptions): UseSocketScannerResult {
  const { enabled, onScan } = options;

  const ownsRef = useRef(false);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  // Latest-ref pattern: the session is started ONCE, but must always call the
  // freshest onScan (which closes over cart and medical-card state). Without
  // this the session would either be torn down and rebuilt on every render --
  // dropping scans mid-shift -- or would call a stale handler.
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  });

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let session: SocketSession | null = null;

    void startSocketSession({
      onScan: (payload, route) => onScanRef.current(payload, route),
      onOwnershipChange: (owns) => {
        // The ref FIRST: it is what actually suppresses the wedge, and it must
        // be true before any scan can arrive. The state is only for display.
        ownsRef.current = owns;
        setConnected(owns);
      },
      onStatus: (message) => setStatus(message),
    }).then((started) => {
      if (cancelled) {
        // Unmounted while opening. Close what we just opened rather than
        // leaking a live Capture session into the next screen.
        void started.stop();
        return;
      }
      session = started;
      // Re-sync: a session that recovered devices via getStatus() already owns
      // scanning, and may have done so before this callback ran.
      ownsRef.current = started.sdkOwnsScanning();
      setConnected(started.sdkOwnsScanning());
    });

    return () => {
      cancelled = true;
      ownsRef.current = false;
      void session?.stop();
    };
  }, [enabled]);

  const sdkOwnsScanning = useCallback(() => ownsRef.current, []);

  return { sdkOwnsScanning, connected, status };
}
