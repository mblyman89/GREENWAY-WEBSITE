/**
 * D266 - colours ticked on the Garments tab, per blank, in this browser.
 * Publish & Ads starts its colour list from these (plus the design's own colour).
 */
import { validColors } from "@/lib/merch-studio/garment-preview-core";

const KEY = "gw-merch-studio-picks";

function readAll(): Record<string, unknown> {
  try { const raw = window.localStorage.getItem(KEY); const v = raw ? JSON.parse(raw) : {}; return v && typeof v === "object" ? v : {}; } catch { return {}; }
}

export function loadPickedColors(blankId: string, catalogOrder: readonly string[]): string[] {
  const v = readAll()[blankId];
  return Array.isArray(v) ? validColors(v, catalogOrder) : [];
}

export function savePickedColors(blankId: string, names: readonly string[]): void {
  try { window.localStorage.setItem(KEY, JSON.stringify({ ...readAll(), [blankId]: names })); } catch { /* quota */ }
}
