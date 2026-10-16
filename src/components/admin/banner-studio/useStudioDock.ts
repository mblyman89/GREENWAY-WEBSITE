"use client";

/**
 * R65 — the Studio "dock": the canvas, its toolbar (Computer/Phone, ▶ Replay,
 * Undo/Redo) and the Arrange bar stay on screen (sticky under the admin
 * header) while the owner scrolls through the settings tabs below, so every
 * change can be watched live. On by default; the on/off choice and the dock
 * size are remembered in this browser. The canvas scales down to fit the
 * dock height so tall cards never cover the whole screen.
 *
 * BannerStudio is loaded client-only (dynamic, ssr:false), so localStorage is
 * readable in the initial state.
 */
import { useEffect, useState } from "react";

export type DockSize = "s" | "m" | "l";
const DOCK_SHARE: Record<DockSize, number> = { s: 0.3, m: 0.42, l: 0.55 };

function readPref(k: string): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(k);
  } catch {
    return null;
  }
}
function writePref(k: string, v: string) {
  try {
    window.localStorage.setItem(k, v);
  } catch {
    /* storage blocked: the choice just isn't remembered */
  }
}

export function useStudioDock() {
  const [follow, setFollow] = useState(() => readPref("gw-studio-follow") !== "0");
  const [dockSize, setDockSize] = useState<DockSize>(() => {
    const z = readPref("gw-studio-dock");
    return z === "s" || z === "l" ? z : "m";
  });
  const [dockTop, setDockTop] = useState(0);
  const [viewH, setViewH] = useState(0);
  useEffect(() => {
    const measure = () => {
      const header = document.querySelector(".admin-chrome header");
      setDockTop(header ? Math.max(0, Math.round(header.getBoundingClientRect().height)) : 0);
      setViewH(window.innerHeight);
    };
    const raf = window.requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
    };
  }, []);
  return {
    follow,
    saveFollow: (v: boolean) => {
      setFollow(v);
      writePref("gw-studio-follow", v ? "1" : "0");
    },
    dockSize,
    saveDock: (v: DockSize) => {
      setDockSize(v);
      writePref("gw-studio-dock", v);
    },
    dockTop,
    canvasMaxH: follow && viewH ? Math.round(viewH * DOCK_SHARE[dockSize]) : undefined,
  };
}
