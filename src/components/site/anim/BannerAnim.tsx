"use client";

/**
 * R60-S2 — lazy door to a Lottie / Rive animation layer. Server pages render
 * this tiny placeholder; the player (and only the engine the file needs) is
 * downloaded only for banners that actually contain an animation.
 */
import dynamic from "next/dynamic";
import type { AnimPlayerProps } from "./AnimPlayer";

const Live = dynamic(() => import("./AnimPlayer"), { ssr: false });

export function BannerAnim(props: AnimPlayerProps) {
  if (!props.anim?.src) return null;
  return <Live {...props} />;
}
