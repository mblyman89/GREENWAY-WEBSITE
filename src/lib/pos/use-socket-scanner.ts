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

import { getSocketHealth, startSocketSession, type SocketSession } from "./socket-scanner";
import type { SocketScanRoute } from "./socket-scan-core";
import type { SocketHealth } from "./socket-resilience-core";

export type UseSocketScannerOptions = {
  /**
   * Should THIS subscriber be handed scans right now?
   *
   * ── READ THIS BEFORE CHANGING IT (SLICE 15) ──────────────────────────────
   *
   * This gates DELIVERY. It does not gate the SESSION, and the difference is
   * the bug that took the register offline overnight.
   *
   * It used to gate the session: `enabled: mode === "scan"` meant that every
   * time a cashier stepped out of scan mode, the Capture service was closed
   * and rebuilt. That contradicts Socket's own instruction to "open Capture
   * Helper only once in the application", and with two scanning surfaces
   * mounted at once it was worse than churn -- whichever surface unmounted
   * first closed Capture underneath the other one, which then kept the
   * keyboard wedge suppressed over a session nobody was listening to.
   *
   * So the lease is now held for as long as the component is mounted, and
   * `enabled` only decides whether scans reach THIS caller.
   */
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
  /** Structured health for a scanner indicator: level, headline, detail, remedy. */
  health: SocketHealth;
};

export function useSocketScanner(options: UseSocketScannerOptions): UseSocketScannerResult {
  const { enabled, onScan } = options;

  const ownsRef = useRef(false);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [health, setHealth] = useState<SocketHealth>(() => getSocketHealth());

  // `enabled` gates DELIVERY only (see the option's doc comment). Read through
  // a ref so the long-lived session always sees today's answer instead of the
  // value captured when the subscription was made.
  const enabledRef = useRef(enabled);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  // Latest-ref pattern: the session is started ONCE, but must always call the
  // freshest onScan (which closes over cart and medical-card state). Without
  // this the session would either be torn down and rebuilt on every render --
  // dropping scans mid-shift -- or would call a stale handler.
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  });

  // NOTE the empty dependency array. Subscribing is deliberately NOT keyed to
  // `enabled`: the lease is held for the lifetime of the component so the
  // shared Capture session is never torn down by a mode change.
  useEffect(() => {
    let cancelled = false;
    let session: SocketSession | null = null;

    void startSocketSession({
      onScan: (payload, route) => {
        if (!enabledRef.current) return;
        onScanRef.current(payload, route);
      },
      onHealth: (next) => setHealth(next),
      onOwnershipChange: (owns) => {
        // The ref FIRST: it is what actually suppresses the wedge, and it must
        // be true before any scan can arrive. The state is only for display.
        ownsRef.current = owns;
        setConnected(owns);
      },
      onStatus: (message) => setStatus(message),
    }).then((started) => {
      if (cancelled) {
        // Unmounted while opening. Release the lease we just took. This does
        // NOT close Capture -- another screen may still be scanning through
        // it, and closing it under them is precisely the defect Slice 15 fixed.
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
      // Ownership is released for THIS caller so its wedge listener is never
      // left muted by a session it can no longer hear.
      ownsRef.current = false;
      void session?.stop();
    };
    // The empty dependency array is intentional -- see the note above.
    // Keying this effect to `enabled` is the bug, not the fix.
  }, []);

  // The wedge must be free whenever THIS caller is not taking scans. Without
  // this, leaving scan mode would suppress the wedge on behalf of a subscriber
  // that is ignoring every scan it is handed.
  const sdkOwnsScanning = useCallback(() => enabledRef.current && ownsRef.current, []);

  return { sdkOwnsScanning, connected, status, health };
}
