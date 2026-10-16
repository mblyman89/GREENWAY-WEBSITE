"use client";

/**
 * R58-S1 — lazy door to the smoke layers. Server pages render this tiny
 * placeholder; the engine (BannerSmokeClient + WebGL2 shader, and shaders.com
 * only for WebGPU bong hits) downloads only for banners that use smoke.
 */
import dynamic from "next/dynamic";
import type { BannerSmokeProps } from "./BannerSmokeClient";

const Live = dynamic(() => import("./BannerSmokeClient"), { ssr: false });

export function BannerSmoke(props: BannerSmokeProps) {
  if (!props.layers.length) return null;
  return <Live {...props} />;
}
