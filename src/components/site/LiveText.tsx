"use client";

/**
 * R58-S3 — countdown + auto deal badges on the visitor's screen.
 *
 * One shared 1-second clock (useSyncExternalStore — no setState in effects)
 * drives every live box on the page; it pauses while the tab is hidden. The
 * server / first paint shows a neutral placeholder ("0h 00m", "…") so the
 * markup hydrates cleanly, then the real value fills in immediately.
 * Deals come from PublishedRulesProvider (root layout) — the same published
 * rules the cart and register use — so badges never disagree with prices.
 */
import { createElement, useSyncExternalStore, type CSSProperties, type ElementType } from "react";
import type { DesignTextBox } from "@/lib/cms/banner-design-core";
import { placeholderText, resolveLive } from "@/lib/cms/banner-live-core";
import { offerLabelFor } from "@/lib/promotions/published-rules-core";
import { usePublishedRules } from "@/components/promotions/PublishedRulesProvider";
import { CurvedText } from "./CurvedText";

const subs = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let nowSec = 0;
function tick() {
  if (typeof document !== "undefined" && document.hidden) return;
  nowSec = Math.floor(Date.now() / 1000);
  subs.forEach((f) => f());
}
function subscribe(f: () => void) {
  subs.add(f);
  if (!timer) {
    nowSec = Math.floor(Date.now() / 1000);
    timer = setInterval(tick, 1000);
  }
  return () => {
    subs.delete(f);
    if (!subs.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}
const getSnap = () => nowSec || Math.floor(Date.now() / 1000);
const getServer = () => 0;

/** Resolved text for a box (live boxes tick; plain boxes pass through). */
export function useLiveText(box: DesignTextBox, text: string): { text: string; ended: boolean } {
  const sec = useSyncExternalStore(subscribe, getSnap, getServer);
  const rules = usePublishedRules();
  if (!box.live) return { text, ended: false };
  if (!sec) return { text: placeholderText(text), ended: false };
  const r = resolveLive(text, box.live, new Date(sec * 1000), rules, offerLabelFor);
  return { text: r.text, ended: r.ended && !r.text.trim() };
}

/** A whole live text box for the public banner (hides itself when the deal/countdown is over). */
export function LiveBox({
  as,
  box,
  text,
  style,
  className,
  attrs,
}: {
  as: string;
  box: DesignTextBox;
  text: string;
  style: CSSProperties;
  className: string;
  attrs?: Record<string, string>;
}) {
  const live = useLiveText(box, text);
  if (live.ended) return null;
  return createElement(
    as as ElementType,
    { style, className, ...attrs, "aria-live": box.live?.mode === "countdown" ? "off" : undefined, suppressHydrationWarning: true },
    box.curve ? <CurvedText box={box} text={live.text} /> : live.text,
  );
}

/** Studio canvas body of a text box: live preview + curve, faded when it would be hidden on the site. */
export function StudioBoxText({ box, text, empty }: { box: DesignTextBox; text: string; empty: string }) {
  const live = useLiveText(box, text);
  if (box.live && live.ended) return <span style={{ opacity: 0.45 }}>(ended — hidden on the site) {text}</span>;
  if (!live.text.trim()) return <span style={{ opacity: 0.45 }}>{empty}</span>;
  return box.curve ? <CurvedText box={box} text={live.text} /> : <>{live.text}</>;
}
