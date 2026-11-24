/**
 * src/lib/merch-studio/optimizer-core.ts
 *
 * D270 - Printful Optimizer. PURE.
 *   - remapPixels(): recolour artwork by palette mapping (every pixel snaps to
 *     its nearest source colour, then takes that colour's chosen target). This
 *     both lets the owner pick the exact Printful colours AND flattens soft /
 *     photo-like edges into solid colours (what embroidery needs).
 *   - suggestTargets(): default targets (nearest Printful thread for
 *     embroidery; unchanged for print).
 *   - flatPrompt(): the FLUX Kontext ask that redraws a logo as flat,
 *     print-ready art on a key colour (cut out afterwards).
 *   - fixFor(): one-click fixes for the Checks list (patch the element, or
 *     open the optimizer for things only AI / recolouring can fix).
 */
import { THREAD_PALETTE, hexToRgb, nearestThread, type Method, type Placement } from "./garment-catalog-core";
import { DPI_MIN, EMB_MIN_LINE_IN, MIN_LETTER_IN, BEANIE_UPPER_IN, MAX_THREADS, PRINT_MIN_LINE_IN, type Issue } from "./print-rules-core";
import { CAP_HEIGHT_EM, X_HEIGHT_EM, type MElement } from "./merch-design-core";

const r4 = (n: number) => Math.round(n * 10000) / 10000;
const toHex = (c: number[]) => `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`.toUpperCase();

/** "redmean" perceptual distance squared (same formula as nearestThread). */
export function colorDist(a: number[], b: number[]): number {
  const rm = (a[0] + b[0]) / 2, dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
}

/**
 * In-place recolour. from/to are hex lists of equal length; to[i] === null keeps
 * the pixel's own colour (flattened to from[i] when flatten=true); "none" makes
 * it transparent (e.g. drop a leftover background box). hardAlpha
 * snaps alpha to 0/255 (embroidery has no soft edges). Returns pixels changed.
 */
export function remapPixels(d: Uint8Array | Uint8ClampedArray, from: string[], to: (string | null)[], opts: { flatten?: boolean; hardAlpha?: boolean } = {}): number {
  const src = from.map((h) => hexToRgb(h) ?? [0, 0, 0]);
  const drop = to.map((x) => x === "none");
  const dst = from.map((h, i) => (drop[i] ? null : hexToRgb(to[i] ?? (opts.flatten ? h : "")) ?? null));
  if (!src.length) return 0;
  let changed = 0;
  const cache = new Map<number, number>();
  for (let i = 0; i < d.length; i += 4) {
    if (opts.hardAlpha) d[i + 3] = d[i + 3] >= 128 ? 255 : 0;
    if (d[i + 3] === 0) continue;
    const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    let k = cache.get(key);
    if (k === undefined) {
      let best = Infinity;
      k = 0;
      for (let j = 0; j < src.length; j++) {
        const dd = colorDist([d[i], d[i + 1], d[i + 2]], src[j]);
        if (dd < best) { best = dd; k = j; }
      }
      if (cache.size < 200_000) cache.set(key, k);
    }
    if (drop[k]) { d[i + 3] = 0; changed++; continue; }
    const t = dst[k];
    if (!t) continue;
    if (d[i] !== t[0] || d[i + 1] !== t[1] || d[i + 2] !== t[2]) changed++;
    d[i] = t[0]; d[i + 1] = t[1]; d[i + 2] = t[2];
  }
  return changed;
}

/** Default targets: embroidery -> nearest Printful thread; print -> keep (null). */
export function suggestTargets(from: string[], method: Method): (string | null)[] {
  return from.map((h) => (method === "embroidery" ? nearestThread(h).hex.toUpperCase() : null));
}

/** Distinct final colours after a mapping (for the "N colours" read-out / thread limit). */
export function finalColors(from: string[], to: (string | null)[]): string[] {
  return [...new Set(from.map((h, i) => (to[i] ?? h).toUpperCase()).filter((h) => h !== "NONE"))];
}

export const FLAT_MIN = 1;
export const FLAT_MAX = 8;
/** FLUX Kontext ask: flat, print-ready redraw on magenta (cut out after). */
export function flatPrompt(o: { colors: number; method: Method; palette?: string[]; extra?: string }): string {
  const n = Math.max(FLAT_MIN, Math.min(FLAT_MAX, Math.round(o.colors) || 4));
  const pal = (o.palette ?? []).filter((h) => /^#[0-9a-f]{6}$/i.test(h)).slice(0, FLAT_MAX);
  const parts = [
    "Redraw this exact logo as clean, print-ready vector-style artwork for apparel printing.",
    "Keep the same design, layout, proportions, text and lettering - do not add, remove or reword anything.",
    `Use only ${n} solid flat colour${n > 1 ? "s" : ""}${pal.length ? ` (${pal.join(", ")})` : ""}: no gradients, no shading, no shadows, no glow, no photo texture, no noise.`,
    o.method === "embroidery" ? "Bold simple shapes with thick lines (embroidery thread), tiny details merged or removed." : "Crisp sharp edges, smooth curves, solid fills.",
    "Put the artwork on one perfectly flat solid pure magenta (#FF00FF) background, edge to edge, with no border or frame.",
  ];
  const extra = String(o.extra ?? "").trim().slice(0, 400);
  if (extra) parts.push(`Also: ${extra}`);
  return parts.join(" ");
}

export type Fix = { label: string; patch: Partial<MElement> } | { label: string; open: "optimize" | "colors" | "select" } | null;

/** The best one-click fix for a check (null = nothing automatic; use Select). */
export function fixFor(issue: Issue, el: MElement | undefined, p: Placement, method: Method, beanie = false): Fix {
  const id = issue.id;
  if (id === "thread-palette" || id === "thread-count") return { label: "Pick thread colours", open: "colors" };
  if (!el) return null;
  if (id.startsWith("bounds-")) {
    const k = Math.min(1, p.widthIn / el.w, p.heightIn / el.h);
    const w = r4(el.w * k), h = r4(el.h * k);
    return { label: "Move & fit inside", patch: { w, h, x: r4(Math.min(Math.max(0, el.x), p.widthIn - w)), y: r4(Math.min(Math.max(0, el.y), p.heightIn - h)), rotate: 0 } };
  }
  if (id.startsWith("emb-gradient-")) return { label: "Flatten for thread (AI / colours)", open: "optimize" };
  if (id.startsWith("emb-opacity-")) return { label: "Set opacity 100%", patch: { opacity: 100 } };
  if (id.startsWith("emb-line-")) return { label: `Thicken to ${EMB_MIN_LINE_IN}"`, patch: { strokeIn: EMB_MIN_LINE_IN } };
  if (id.startsWith("print-line-")) return { label: "Thicken to 1 pt", patch: { strokeIn: r4(Math.max(PRINT_MIN_LINE_IN, 0.015)) } };
  if (id.startsWith("emb-detail-")) return { label: "Simplify with AI", open: "optimize" };
  if (id.startsWith("dpi-") && el.kind === "image" && el.pxW && el.pxH) {
    if (issue.level === "blocker") return { label: "Enlarge / sharpen (AI)", open: "optimize" };
    return { label: "Enlarge to 300 DPI", open: "optimize" };
  }
  if ((id.startsWith("text-small-") || id.startsWith("text-beanie-")) && el.kind === "text") {
    const caps = /[A-Z0-9]/.test(el.text ?? "");
    const want = beanie || id.startsWith("text-beanie-") ? (caps ? BEANIE_UPPER_IN : MIN_LETTER_IN) : MIN_LETTER_IN;
    return { label: `Enlarge letters to ${want}"`, patch: { fontSizeIn: r4((want + 0.005) / (caps ? CAP_HEIGHT_EM : X_HEIGHT_EM)) } };
  }
  if (id.startsWith("contrast-")) return el.kind === "image" ? { label: "Change colours", open: "colors" } : { label: "Pick a new colour", open: "select" };
  if (id.startsWith("label-font-") || id.startsWith("side-chars-")) return { label: "Edit text / font", open: "select" };
  if (id.startsWith("obstacle-")) return { label: "Select & move", open: "select" };
  void method;
  return null;
}

export function __runOptimizerTests(): { passed: number; failed: number; failures: string[] } {
  let passed = 0;
  const failures: string[] = [];
  const t = (name: string, c: boolean) => (c ? passed++ : failures.push(name));
  // Remap: near-red + soft-red edge -> both become exact thread red; transparent untouched.
  const px = new Uint8Array([250, 10, 10, 255, 200, 60, 60, 120, 0, 0, 255, 255, 1, 2, 3, 0]);
  const n = remapPixels(px, ["#FF0000", "#0000FF"], ["#CC3366", null], { hardAlpha: true });
  t("red mapped", px[0] === 0xcc && px[1] === 0x33 && px[2] === 0x66);
  t("soft edge alpha snapped to 0", px[7] === 0);
  t("blue kept (null)", px[8] === 0 && px[10] === 255);
  t("transparent untouched", px[12] === 1);
  t("changed count", n === 1);
  const flat = new Uint8Array([10, 10, 240, 255]);
  remapPixels(flat, ["#0000FF"], [null], { flatten: true });
  t("flatten to source", flat[0] === 0 && flat[2] === 255);
  const dr = new Uint8Array([255, 255, 255, 255]);
  remapPixels(dr, ["#FFFFFF"], ["none"]);
  t("none -> transparent", dr[3] === 0);
  t("final colours skip none", finalColors(["#111111", "#FFFFFF"], [null, "none"]).length === 1);
  t("empty palette", remapPixels(new Uint8Array(4), [], []) === 0);
  t("suggest emb threads", suggestTargets(["#FE0101"], "embroidery")[0] === nearestThread("#FE0101").hex.toUpperCase());
  t("suggest print keep", suggestTargets(["#FE0101"], "dtg")[0] === null);
  t("final colours merge", finalColors(["#111111", "#222222"], ["#000000", "#000000"]).length === 1);
  t("final colours keep", finalColors(["#111111", "#222222"], [null, null]).length === 2);
  t("thread palette has white", THREAD_PALETTE.some((x) => x.hex === "#FFFFFF"));
  const fp = flatPrompt({ colors: 3, method: "embroidery", palette: ["#FFFFFF", "bad"], extra: "make the text bolder" });
  t("prompt colours", fp.includes("only 3 solid flat colours") && fp.includes("#FFFFFF") && !fp.includes("bad"));
  t("prompt magenta", fp.includes("#FF00FF"));
  t("prompt emb", fp.includes("embroidery"));
  t("prompt extra", fp.includes("make the text bolder"));
  t("prompt clamp", flatPrompt({ colors: 99, method: "dtg" }).includes(`only ${FLAT_MAX} solid`));
  t("toHex", toHex([255, 0, 16]) === "#FF0010");
  // fixFor
  const p = { id: "front", label: "Front", widthIn: 12, heightIn: 16 } as Placement;
  const img = { id: "a", kind: "image", x: 10, y: 0, w: 6, h: 6, rotate: 0, opacity: 100, fill: "#fff", strokeIn: 0, strokeColor: "#000", pxW: 600, pxH: 600 } as MElement;
  const iss = (id: string, level: Issue["level"] = "blocker") => ({ id, level, title: "", why: "", fix: "", source: "" }) as Issue;
  const b = fixFor(iss("bounds-a"), img, p, "dtg");
  t("bounds fix inside", !!b && "patch" in b && b.patch.x === 6 && b.patch.w === 6);
  const big = fixFor(iss("bounds-a"), { ...img, w: 24, h: 24 }, p, "dtg");
  t("bounds fix shrinks", !!big && "patch" in big && big.patch.w === 12 && big.patch.x === 0);
  const g = fixFor(iss("emb-gradient-a"), img, p, "embroidery");
  t("gradient -> optimize", !!g && "open" in g && g.open === "optimize");
  t("palette -> colors", (fixFor(iss("thread-palette", "warning"), undefined, p, "embroidery") as { open: string }).open === "colors");
  const tx = { ...img, kind: "text", text: "GREENWAY" } as MElement;
  const ts = fixFor(iss("text-small-a"), tx, p, "embroidery");
  t("text enlarge", !!ts && "patch" in ts && Math.abs((ts.patch.fontSizeIn ?? 0) * CAP_HEIGHT_EM - (MIN_LETTER_IN + 0.005)) < 1e-3);
  const tb = fixFor(iss("text-beanie-a"), tx, p, "embroidery");
  t("beanie caps", !!tb && "patch" in tb && (tb.patch.fontSizeIn ?? 0) * CAP_HEIGHT_EM > BEANIE_UPPER_IN);
  t("opacity", (fixFor(iss("emb-opacity-a", "warning"), img, p, "embroidery") as { patch: Partial<MElement> }).patch.opacity === 100);
  t("emb line", (fixFor(iss("emb-line-a"), img, p, "embroidery") as { patch: Partial<MElement> }).patch.strokeIn === EMB_MIN_LINE_IN);
  t("dpi blocker -> optimize", (fixFor(iss("dpi-a"), img, p, "dtg") as { open: string }).open === "optimize");
  t("contrast image -> colors", (fixFor(iss("contrast-a", "warning"), img, p, "dtg") as { open: string }).open === "colors");
  t("contrast text -> select", (fixFor(iss("contrast-a", "warning"), tx, p, "dtg") as { open: string }).open === "select");
  t("unknown null", fixFor(iss("imagery-review", "tip"), img, p, "dtg") === null);
  t("consts sane", DPI_MIN === 150 && MAX_THREADS === 6);
  return { passed, failed: failures.length, failures };
}
