"use client";

/**
 * R58-S1 — the live smoke / fog / haze layers of one banner (client only,
 * lazy: the public banner imports this through next/dynamic, so shoppers whose
 * banners have no smoke never download it, and the WebGPU engine (shaders.com,
 * ~700 KB gz) only downloads when a banner actually has a bong hit AND the
 * browser has WebGPU).
 *
 * Plays exactly when: on screen, its carousel slide is shown, the tab is
 * visible, and the visitor hasn't asked for reduced motion. Each time a
 * carousel slide is shown again, "once" effects (hits) replay.
 *
 * Fallbacks: no WebGPU → the hit uses our WebGL2 plume; no WebGL2 → nothing
 * (the banner looks exactly as without smoke). Reduced motion → one still
 * frame of fog/haze (no movement), hits skipped, words shown at once.
 */
import { useEffect, useRef } from "react";
import { hitPuffWindows, hitShaderProps, onceSeconds, type SmokeLayer } from "@/lib/cms/banner-atmos-core";
import { GlSmoke } from "./smoke-gl";

type ShaderInstance = { update(id: string, p: Record<string, unknown>): void; pause(): void; resume(): void; destroy(): void; getFailureReason(): string | null };

export type BannerSmokeProps = {
  layers: SmokeLayer[];
  /** Studio: changes to this number replay the effect. */
  replayKey?: number;
};

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export default function BannerSmokeClient({ layers, replayKey = 0 }: BannerSmokeProps) {
  const backRef = useRef<HTMLCanvasElement>(null);
  const frontRef = useRef<HTMLCanvasElement>(null);
  const gpuRef = useRef<HTMLCanvasElement>(null);
  const api = useRef<{ replay: () => void } | null>(null);
  const key = JSON.stringify(layers);

  useEffect(() => {
    const back = backRef.current;
    const host = back?.parentElement;
    if (!back || !host) return;
    const still = reducedMotion();
    const gpuHit = !still && typeof navigator !== "undefined" && "gpu" in navigator ? layers.find((l) => l.kind === "hit") : undefined;
    let gpuReady = false;
    let gpu: ShaderInstance | null = null;
    let gpuTimers: number[] = [];
    let alive = true;

    const mk = (c: HTMLCanvasElement | null, ls: SmokeLayer[]) => {
      if (!c || !ls.length) return null;
      try {
        const g = new GlSmoke(c, { still });
        g.setLayers(ls);
        return g;
      } catch {
        return null;
      }
    };
    const glLayers = (front: boolean) => layers.filter((l) => !!l.front === front && !(still && l.kind === "hit") && !(gpuReady && l === gpuHit));
    let backGl = mk(back, glLayers(false));
    let frontGl = mk(frontRef.current, glLayers(true));

    const phone = () => host.clientWidth < 768;
    const playHit = () => {
      if (!gpu || !gpuHit) return;
      gpuTimers.forEach((t) => window.clearTimeout(t));
      gpuTimers = [];
      const start = () => {
        // R60: pour for the chosen length, in one or more puffs.
        for (const [on, off] of hitPuffWindows(gpuHit)) {
          gpuTimers.push(window.setTimeout(() => gpu?.update("hit", hitShaderProps(gpuHit, phone(), true)), on * 1000));
          gpuTimers.push(window.setTimeout(() => gpu?.update("hit", hitShaderProps(gpuHit, phone(), false)), off * 1000));
        }
        if (!gpuHit.once) gpuTimers.push(window.setTimeout(start, (onceSeconds(gpuHit) + 1.5) * 1000));
      };
      gpuTimers.push(window.setTimeout(start, (gpuHit.delay ?? 0) * 1000));
    };

    const replay = () => {
      backGl?.replay();
      frontGl?.replay();
      playHit();
    };
    api.current = { replay };

    // Visibility: on screen × slide shown × tab visible.
    let onScreen = false;
    const slide = host.closest("[data-gw-slide]");
    let wasShown = !slide || slide.getAttribute("data-gw-slide") !== "hidden";
    const sync = () => {
      const shown = !slide || slide.getAttribute("data-gw-slide") !== "hidden";
      const go = onScreen && shown && document.visibilityState === "visible";
      if (shown && !wasShown) replay();
      wasShown = shown;
      if (go) {
        backGl?.start();
        frontGl?.start();
        gpu?.resume();
      } else {
        backGl?.stop();
        frontGl?.stop();
        gpu?.pause();
      }
    };
    const io = new IntersectionObserver((es) => {
      for (const e of es) onScreen = e.isIntersecting;
      sync();
    });
    io.observe(host);
    const mo = slide ? new MutationObserver(sync) : null;
    mo?.observe(slide!, { attributes: true, attributeFilter: ["data-gw-slide"] });
    document.addEventListener("visibilitychange", sync);

    // The real fluid-sim hit (WebGPU only), loaded on demand.
    if (gpuHit && gpuRef.current) {
      const canvas = gpuRef.current;
      void (async () => {
        try {
          const mod = await import("shaders/js");
          if (!alive || !mod.isWebGPUSupported()) return;
          const inst = (await mod.createShader(
            canvas,
            { components: [{ type: "Smoke", id: "hit", props: hitShaderProps(gpuHit, phone(), false) }] },
            { disableTelemetry: true, onError: () => fallback() },
          )) as ShaderInstance;
          if (!alive || inst.getFailureReason()) {
            inst.destroy();
            return;
          }
          gpu = inst;
          gpuReady = true;
          // Hand the hit over from the WebGL plume to the real simulation.
          if (gpuHit.front) frontGl?.setLayers(glLayers(true));
          else backGl?.setLayers(glLayers(false));
          canvas.style.opacity = "1";
          playHit();
          sync();
        } catch {
          /* stay on the WebGL plume */
        }
      })();
    }
    function fallback() {
      gpuReady = false;
      gpu?.destroy();
      gpu = null;
      if (gpuRef.current) gpuRef.current.style.opacity = "0";
      backGl?.destroy();
      frontGl?.destroy();
      backGl = mk(back, glLayers(false));
      frontGl = mk(frontRef.current, glLayers(true));
      sync();
    }

    return () => {
      alive = false;
      io.disconnect();
      mo?.disconnect();
      document.removeEventListener("visibilitychange", sync);
      gpuTimers.forEach((t) => window.clearTimeout(t));
      backGl?.destroy();
      frontGl?.destroy();
      gpu?.destroy();
      api.current = null;
    };
    // `key` captures every layer setting; editor/reveal re-init is cheap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (replayKey) api.current?.replay();
  }, [replayKey]);

  const hasFront = layers.some((l) => l.front);
  const gpuFront = layers.find((l) => l.kind === "hit")?.front;
  const hideSm = layers.length > 0 && layers.every((l) => l.hideOnMobile);
  return (
    <>
      <canvas ref={backRef} aria-hidden="true" className={`gw-smoke${hideSm ? " gw-hide-sm" : ""}`} />
      <canvas ref={gpuRef} aria-hidden="true" className="gw-smoke" style={{ opacity: 0, ...(gpuFront ? { zIndex: 60 } : {}) }} />
      {hasFront ? <canvas ref={frontRef} aria-hidden="true" className="gw-smoke" style={{ zIndex: 60 }} /> : null}
    </>
  );
}
