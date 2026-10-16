"use client";
/**
 * R56-S2 — one shared, lazily-loaded list of the owner's uploaded fonts for
 * every picker on the page (Banner Studio text + buttons, Site Content fonts),
 * plus the @font-face CSS so previews render in the real font.
 */
import { useSyncExternalStore } from "react";
import { listCustomFontsAction, type CustomFontRow } from "@/app/admin/fonts/custom-font-actions";

let fonts: CustomFontRow[] = [];
let started = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

function subscribe(cb: () => void) {
  subs.add(cb);
  if (!started) {
    started = true;
    listCustomFontsAction()
      .then((rows) => {
        const have = new Set(fonts.map((f) => f.id));
        fonts = [...fonts, ...rows.filter((r) => !have.has(r.id))];
        emit();
      })
      .catch(() => {
        started = false; // try again next mount
      });
  }
  return () => subs.delete(cb);
}

const EMPTY: CustomFontRow[] = [];

export function useCustomFonts(): CustomFontRow[] {
  return useSyncExternalStore(subscribe, () => fonts, () => EMPTY);
}

export function addCustomFont(row: CustomFontRow) {
  if (fonts.some((f) => f.id === row.id)) return;
  fonts = [row, ...fonts];
  emit();
}
