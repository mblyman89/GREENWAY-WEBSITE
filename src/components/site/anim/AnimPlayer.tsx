"use client";

/**
 * R60-S2 — plays ONE Lottie or Rive animation layer of a banner.
 *
 * Lazy twice over: the public banner reaches this file only through
 * next/dynamic (BannerAnim), and the engine (dotLottie ThorVG WASM ≈1.2 MB, or
 * Rive WASM ≈2.2 MB) is imported only for the engine the file needs, only when
 * a banner actually has an animation. Both runtimes fetch their WASM once from
 * a version-pinned CDN copy (jsDelivr / unpkg, each with the other as a
 * built-in fallback) and the browser caches it.
 *
 * Plays exactly when: on screen × its carousel slide is shown × the tab is
 * visible. Showing the slide again replays "plays by itself" animations.
 * Reduced motion: a still frame (owner-chosen %, Lottie) or hidden — never
 * moving. Hover / click / scroll-scrub / Rive state-machine inputs, data
 * binding values, text runs, Lottie themes, markers, segments and slots are all
 * applied from the saved settings (banner-anim-core).
 */
import { useEffect, useRef, type CSSProperties } from "react";
import { hexToRgb, hexToUnit, lottieAlign, riveAlign, scrollProgress, stillFrame, unitToHex, type AnimSpec } from "@/lib/cms/banner-anim-core";

/** What the Studio learns from a loaded file (fills its dropdowns). */
export type AnimInfo = {
  engine: AnimSpec["engine"];
  width: number;
  height: number;
  frames?: number;
  lottie?: {
    animations: string[];
    themes: string[];
    machines: string[];
    markers: string[];
    slots: { id: string; type: string; value?: string | number }[];
  };
  rive?: {
    artboards: { name: string; animations: string[]; machines: { name: string; inputs: { name: string; type: "number" | "boolean" | "trigger" }[] }[] }[];
    vm: { name: string; type: string }[];
  };
};

export type AnimPlayerProps = {
  anim: AnimSpec;
  /** Studio: report the file's contents once loaded. */
  onInfo?: (info: AnimInfo) => void;
  /** Studio: report a load error in plain English. */
  onError?: (msg: string) => void;
  /** Studio: changes to this number replay it. */
  replayKey?: number;
  /** Studio panel preview: always play (ignore hover/click/scroll start modes). */
  preview?: boolean;
};

type Ctl = { play(): void; pause(): void; replay(): void; still(): void; destroy(): void; hover?(on: boolean): void; click?(): void; scrub?(p: number): void };

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const fill: CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" };

export default function AnimPlayer({ anim, onInfo, onError, replayKey = 0, preview = false }: AnimPlayerProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const api = useRef<Ctl | null>(null);
  const key = JSON.stringify(anim);
  const cb = useRef({ onInfo, onError });
  useEffect(() => {
    cb.current = { onInfo, onError };
  });

  useEffect(() => {
    const canvas = ref.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;
    const still = reducedMotion() && !preview;
    if (still && anim.stillHide) {
      canvas.style.display = "none";
      return;
    }
    const start = preview ? "auto" : (anim.start ?? "auto");
    let alive = true;
    let ctl: Ctl | null = null;
    let ready = false;
    let started = false;
    let timer = 0;
    const fail = (m: string) => cb.current.onError?.(m);

    // ── visibility (on screen × slide shown × tab visible) ──
    let onScreen = false;
    const slide = host.closest("[data-gw-slide]");
    let wasShown = !slide || slide.getAttribute("data-gw-slide") !== "hidden";
    const go = () => onScreen && (!slide || slide.getAttribute("data-gw-slide") !== "hidden") && document.visibilityState === "visible";
    const sync = () => {
      if (!ctl || !ready) return;
      const shown = !slide || slide.getAttribute("data-gw-slide") !== "hidden";
      if (shown && !wasShown && start === "auto") started = false; // replay on re-show
      wasShown = shown;
      if (still) return;
      if (!go()) {
        window.clearTimeout(timer);
        ctl.pause();
        return;
      }
      if (start !== "auto") return; // hover / click / scroll drive it
      if (!started) {
        started = true;
        window.clearTimeout(timer);
        timer = window.setTimeout(() => alive && go() && ctl?.replay(), (anim.delay ?? 0) * 1000);
      } else ctl.play();
    };
    const io = new IntersectionObserver((es) => {
      for (const e of es) onScreen = e.isIntersecting;
      sync();
    });
    io.observe(host);
    const mo = slide ? new MutationObserver(sync) : null;
    mo?.observe(slide!, { attributes: true, attributeFilter: ["data-gw-slide"] });
    document.addEventListener("visibilitychange", sync);

    // ── pointer + scroll triggers ──
    const enter = () => !still && ctl?.hover?.(true);
    const leave = () => !still && ctl?.hover?.(false);
    const click = (e: Event) => {
      if (still) return;
      if (start === "hover" && (e as PointerEvent).pointerType !== "mouse") ctl?.click?.(); // phones: tap plays it
      if (start === "click") ctl?.click?.();
    };
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        const r = host.getBoundingClientRect();
        ctl?.scrub?.(scrollProgress(r.top, r.height, window.innerHeight));
      });
    };
    if (start === "hover") {
      host.addEventListener("pointerenter", enter);
      host.addEventListener("pointerleave", leave);
    }
    if (start === "hover" || start === "click") host.addEventListener("click", click);
    if (start === "scroll" && !still) window.addEventListener("scroll", onScroll, { passive: true });

    const loaded = () => {
      ready = true;
      if (still) ctl?.still();
      else if (start === "scroll") onScroll();
      sync();
    };

    void (async () => {
      try {
        ctl = anim.engine === "lottie" ? await lottie(canvas, anim, still, loaded, (i) => cb.current.onInfo?.(i), fail) : await rive(canvas, anim, still, loaded, (i) => cb.current.onInfo?.(i), fail);
        if (!alive) ctl?.destroy();
        else api.current = ctl;
      } catch {
        fail("This browser couldn't start the animation player.");
      }
    })();

    return () => {
      alive = false;
      window.clearTimeout(timer);
      if (raf) window.cancelAnimationFrame(raf);
      io.disconnect();
      mo?.disconnect();
      document.removeEventListener("visibilitychange", sync);
      host.removeEventListener("pointerenter", enter);
      host.removeEventListener("pointerleave", leave);
      host.removeEventListener("click", click);
      window.removeEventListener("scroll", onScroll);
      ctl?.destroy();
      api.current = null;
    };
    // `key` captures every setting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, preview]);

  useEffect(() => {
    if (replayKey) api.current?.replay();
  }, [replayKey]);

  return <canvas ref={ref} aria-hidden="true" style={fill} />;
}

// ── Lottie (dotLottie web, ThorVG) ───────────────────────────────────────────
async function lottie(canvas: HTMLCanvasElement, a: AnimSpec, still: boolean, loaded: () => void, info: (i: AnimInfo) => void, fail: (m: string) => void): Promise<Ctl> {
  const { DotLottie } = await import("@lottiefiles/dotlottie-web");
  const p = new DotLottie({
    canvas,
    src: a.src,
    autoplay: false,
    loop: !a.once,
    ...(a.speed ? { speed: a.speed } : {}),
    ...(a.mode ? { mode: a.mode } : {}),
    ...(a.marker ? { marker: a.marker } : a.seg ? { segment: a.seg } : {}),
    ...(a.theme ? { themeId: a.theme } : {}),
    ...(a.anim ? { animationId: a.anim } : {}),
    ...(a.sm && !still ? { stateMachineId: a.sm } : {}),
    layout: { fit: a.fit ?? "contain", align: lottieAlign(a.align) },
    renderConfig: { autoResize: true, freezeOnOffscreen: true },
  });
  p.addEventListener("loadError", () => fail("The animation file couldn't be loaded. Re-upload it as .lottie or Lottie JSON."));
  p.addEventListener("load", () => {
    try {
      for (const [id, hex] of Object.entries(a.colors ?? {})) p.setColorSlot(id, hexToUnit(hex));
      for (const [id, t] of Object.entries(a.texts ?? {})) p.setTextSlot(id, { t });
      for (const [id, n] of Object.entries(a.nums ?? {})) p.setScalarSlot(id, n);
      const size = p.animationSize();
      const slots = p.getSlotIds().map((id) => {
        const type = p.getSlotType(id) ?? "unknown";
        const v = p.getSlot(id);
        const value = type === "color" ? (unitToHex(v) ?? undefined) : type === "scalar" && typeof v === "number" ? v : undefined;
        return { id, type, ...(value !== undefined ? { value } : {}) };
      });
      info({
        engine: "lottie",
        width: size.width,
        height: size.height,
        frames: p.totalFrames,
        lottie: {
          animations: (p.manifest?.animations ?? []).map((x) => x.id),
          themes: (p.manifest?.themes ?? []).map((x) => x.id),
          machines: (p.manifest?.stateMachines ?? []).map((x) => x.id),
          markers: p.markers().map((m) => m.name),
          slots,
        },
      });
    } catch {
      /* contents are optional */
    }
    loaded();
  });
  const sm = !!a.sm && !still;
  return {
    play: () => !sm && p.play(),
    pause: () => !sm && p.pause(),
    replay: () => {
      if (sm) return;
      p.stop();
      p.play();
    },
    still: () => {
      p.pause();
      p.setFrame(stillFrame(a, p.totalFrames));
    },
    hover: (on) => (on ? p.play() : p.pause()),
    click: () => {
      p.stop();
      p.play();
    },
    scrub: (pr) => {
      const [s, e] = a.seg ?? [0, Math.max(0, p.totalFrames - 1)];
      p.setFrame(s + (e - s) * pr);
    },
    destroy: () => p.destroy(),
  };
}

// ── Rive (WebGL2 renderer) ───────────────────────────────────────────────────
async function rive(canvas: HTMLCanvasElement, a: AnimSpec, still: boolean, loaded: () => void, info: (i: AnimInfo) => void, fail: (m: string) => void): Promise<Ctl> {
  const R = await import("@rive-app/webgl2");
  const fit = a.fit === "cover" ? R.Fit.Cover : a.fit === "fill" ? R.Fit.Fill : R.Fit.Contain;
  const ro = new ResizeObserver(() => r.resizeDrawingSurfaceToCanvas());
  const machine = () => a.machine ?? r.stateMachineNames[0];
  const input = (name: string) => {
    const m = machine();
    return m ? r.stateMachineInputs(m)?.find((i) => i.name === name) : undefined;
  };
  /** Saved inputs, data-binding values and text runs (again after every reset). */
  const apply = () => {
      for (const [name, v] of Object.entries(a.inputs ?? {})) {
        const i = input(name);
        if (i) i.value = v;
      }
      const vmi = r.viewModelInstance;
      for (const [path, v] of Object.entries(a.vm ?? {})) {
        if (!vmi) break;
        if (typeof v === "boolean") {
          const b = vmi.boolean(path);
          if (b) b.value = v;
        } else if (typeof v === "number") {
          const n = vmi.number(path);
          if (n) n.value = v;
        } else if (/^#[0-9a-f]{6}$/i.test(v) && vmi.color(path)) {
          const [cr, cg, cbl] = hexToRgb(v);
          vmi.color(path)!.rgb(cr, cg, cbl);
        } else {
          const s = vmi.string(path);
          const e = s ? null : vmi.enum(path);
          if (s) s.value = v;
          else if (e) e.value = v;
        }
      }
      for (const [name, v] of Object.entries(a.runs ?? {})) {
        try {
          if (v) r.setTextRunValue(name, v);
        } catch {
          /* run not in this artboard */
        }
      }
  };
  const r: InstanceType<typeof R.Rive> = new R.Rive({
    canvas,
    src: a.src,
    ...(a.artboard ? { artboard: a.artboard } : {}),
    ...(a.machine ? { stateMachine: a.machine } : {}),
    layout: new R.Layout({ fit, alignment: riveAlign(a.align) as never }),
    autoplay: false,
    autoBind: true,
    useOffscreenRenderer: true,
    shouldDisableRiveListeners: !a.interactive || still,
    onLoadError: () => fail("The Rive file couldn't be loaded. Re-export it from Rive (.riv) and upload it again."),
    onLoad: () => {
      try {
        r.resizeDrawingSurfaceToCanvas();
        ro.observe(canvas);
        apply();
        const b = r.bounds;
        const c = r.contents;
        info({
          engine: "rive",
          width: Math.max(1, b.maxX - b.minX),
          height: Math.max(1, b.maxY - b.minY),
          rive: {
            artboards: (c.artboards ?? []).map((ab) => ({
              name: ab.name,
              animations: ab.animations,
              machines: ab.stateMachines.map((sm) => ({
                name: sm.name,
                inputs: sm.inputs.map((i) => ({ name: i.name, type: i.type === R.StateMachineInputType.Boolean ? ("boolean" as const) : i.type === R.StateMachineInputType.Trigger ? ("trigger" as const) : ("number" as const) })),
              })),
            })),
            vm: (r.viewModelInstance?.properties ?? []).map((p: { name: string; type: unknown }) => ({ name: p.name, type: String(p.type) })),
          },
        });
      } catch {
        /* contents are optional */
      }
      if (!still) r.drawFrame();
      loaded();
    },
  });
  const restart = () => {
    r.reset({ ...(a.artboard ? { artboard: a.artboard } : {}), ...(a.machine ? { stateMachine: a.machine } : {}), autoplay: true, autoBind: true });
    apply();
  };
  const fire = (name: string) => {
    const i = input(name);
    if (i) i.fire();
    else r.viewModelInstance?.trigger(name)?.trigger();
  };
  return {
    play: () => r.play(),
    pause: () => r.pause(),
    replay: restart,
    still: () => r.pause(),
    hover: (on) => {
      if (a.hoverInput) {
        const i = input(a.hoverInput);
        if (i) i.value = on;
        else {
          const b = r.viewModelInstance?.boolean(a.hoverInput);
          if (b) b.value = on;
        }
        r.play();
      } else if (on) r.play();
      else r.pause();
    },
    click: () => {
      if (a.clickFire) {
        r.play();
        fire(a.clickFire);
      } else restart();
    },
    destroy: () => {
      ro.disconnect();
      r.cleanup();
    },
  };
}
