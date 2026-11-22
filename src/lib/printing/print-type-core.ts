/**
 * D263 S4: Print Studio artistic type. Pure (no React, no DOM).
 *
 *  - TextArt: 3D extrude, long shadow, retro double, glitch, emboss,
 *    double outline and picture-filled letters, all as CSS text-shadow /
 *    background-clip so they render the same on the canvas, in PNG and in PDF.
 *  - GRADIENT_PRESETS: metal and colour fills for gradient letters.
 *  - PRINT_FONTS: a curated Google Fonts library (display, script, serif,
 *    sans, retro) loaded only inside the Print Studio (one <link> per family,
 *    so one bad family never breaks the others).
 */

export type TextArtKind = "extrude" | "long" | "retro" | "glitch" | "emboss" | "double" | "outline-glow";
export const TEXT_ART_KINDS: { id: TextArtKind; label: string; help: string }[] = [
  { id: "extrude", label: "3D block", help: "Solid 3D letters with depth" },
  { id: "long", label: "Long shadow", help: "Flat shadow that runs off at an angle" },
  { id: "retro", label: "Retro double", help: "Two offset colours, 70s poster look" },
  { id: "glitch", label: "Glitch", help: "Red and cyan split" },
  { id: "emboss", label: "Emboss", help: "Pressed into the page" },
  { id: "double", label: "Double outline", help: "Two rings of outline (sticker look)" },
  { id: "outline-glow", label: "Glow ring", help: "Soft halo in any colour (neon sign on paper)" },
];
export type TextArt = { kind: TextArtKind; depth: number; color: string; color2?: string; angle: number; img?: string };
export const ART_DEPTH_MAX = 30;

const HEX = /^#[0-9a-f]{6}$/i;
const hex = (v: unknown, d: string) => (typeof v === "string" && HEX.test(v) ? v.toLowerCase() : d);
const clamp = (v: unknown, d: number, lo: number, hi: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n * 10) / 10)) : d;
};
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Safe picture for letter fills: our https / same-site paths only, no quotes or parens. */
export function safeArtImg(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (s.length > 1000 || /["'()\\\s<>]/.test(s)) return undefined;
  return /^https:\/\//i.test(s) || /^\/(?!\/)/.test(s) ? s : undefined;
}

export function normalizeTextArt(raw: unknown): TextArt | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const kind = TEXT_ART_KINDS.find((k) => k.id === r.kind)?.id;
  const img = safeArtImg(r.img);
  if (!kind && !img) return undefined;
  const out: TextArt = { kind: kind ?? "extrude", depth: clamp(r.depth, 6, 0, ART_DEPTH_MAX), color: hex(r.color, "#000000"), angle: clamp(r.angle, 45, 0, 360) };
  if (typeof r.color2 === "string" && HEX.test(r.color2)) out.color2 = r.color2.toLowerCase();
  if (img) out.img = img;
  return out;
}

/** Text-shadow for the effect. Units are em so it scales with the text at any print size. */
export function artShadow(art: TextArt, textColor: string): string {
  const d = art.depth;
  if (d <= 0 && art.kind !== "emboss") return "";
  const rad = (art.angle * Math.PI) / 180;
  const ux = Math.cos(rad);
  const uy = Math.sin(rad);
  const em = (px: number) => `${r3(px / 100)}em`;
  const steps = (n: number, fn: (i: number) => string) => Array.from({ length: n }, (_, i) => fn(i + 1)).join(", ");
  switch (art.kind) {
    case "extrude": {
      const n = Math.max(1, Math.round(d));
      const shade = steps(n, (i) => `${em(ux * i)} ${em(uy * i)} 0 ${art.color}`);
      return `${shade}, ${em(ux * (n + 2))} ${em(uy * (n + 2))} ${em(4)} rgba(0,0,0,0.45)`;
    }
    case "long": {
      const n = Math.max(1, Math.round(d * 3));
      return steps(n, (i) => `${em(ux * i)} ${em(uy * i)} 0 ${art.color}`);
    }
    case "retro":
      return `${em(ux * d)} ${em(uy * d)} 0 ${art.color}, ${em(ux * d * 2)} ${em(uy * d * 2)} 0 ${art.color2 ?? "#f2c14e"}`;
    case "glitch":
      return `${em(-d / 2)} 0 0 ${art.color2 ?? "#ff004c"}, ${em(d / 2)} 0 0 ${art.color === "#000000" ? "#00e5ff" : art.color}`;
    case "emboss":
      return `${em(-1)} ${em(-1)} 0 rgba(255,255,255,0.55), ${em(1 + d / 4)} ${em(1 + d / 4)} ${em(1)} rgba(0,0,0,0.6)`;
    case "double": {
      const a = Math.max(1, d / 2);
      const ring = (w: number, c: string) => [0, 45, 90, 135, 180, 225, 270, 315].map((g) => `${em(Math.cos((g * Math.PI) / 180) * w)} ${em(Math.sin((g * Math.PI) / 180) * w)} 0 ${c}`).join(", ");
      return `${ring(a, art.color2 ?? textColor === "#ffffff" ? "#000000" : "#ffffff")}, ${ring(a * 2, art.color)}`;
    }
    case "outline-glow":
      return `0 0 ${em(d)} ${art.color}, 0 0 ${em(d * 2)} ${art.color}, 0 0 ${em(d * 4)} ${art.color}`;
  }
}

// ── Gradient presets (2-stop, matches DesignGradient) ──────────────────────
export const GRADIENT_PRESETS: { id: string; label: string; from: string; to: string; angle: number }[] = [
  { id: "gold", label: "Gold", from: "#fff2a8", to: "#b8860b", angle: 180 },
  { id: "chrome", label: "Chrome", from: "#ffffff", to: "#6b7280", angle: 180 },
  { id: "rose", label: "Rose gold", from: "#fde2e4", to: "#b76e79", angle: 180 },
  { id: "copper", label: "Copper", from: "#ffd3a5", to: "#9a4f1c", angle: 180 },
  { id: "leaf", label: "Fresh green", from: "#d9ff8a", to: "#1f8a3a", angle: 160 },
  { id: "sunset", label: "Sunset", from: "#ffcc33", to: "#ff2e63", angle: 90 },
  { id: "ocean", label: "Ocean", from: "#5ee7df", to: "#2563eb", angle: 90 },
  { id: "fire", label: "Fire", from: "#ffe259", to: "#ff2a00", angle: 180 },
  { id: "purple", label: "Purple haze", from: "#f0abfc", to: "#6d28d9", angle: 135 },
  { id: "ice", label: "Ice", from: "#ffffff", to: "#7dd3fc", angle: 180 },
];

// ── Google Fonts library (Print Studio only) ────────────────────────────────
export type PrintFontCat = "display" | "retro" | "script" | "serif" | "sans" | "fun";
export type PrintFont = { family: string; cat: PrintFontCat; axes?: string };
export const PRINT_FONT_PREFIX = "gf:";
const F = (cat: PrintFontCat, list: string) => list.split("|").map((s) => {
  const at = s.indexOf("@");
  const family = at < 0 ? s : s.slice(0, at);
  const axes = at < 0 ? "" : s.slice(at + 1);
  return axes ? { family, cat, axes } : { family, cat };
});
export const PRINT_FONTS: PrintFont[] = [
  ...F("display", "Anton|Bebas Neue|Oswald@wght@200..700|Alfa Slab One|Abril Fatface|Archivo Black|Black Ops One|Staatliches|Ultra|Titan One|Lilita One|Passion One|Paytone One|Russo One|Righteous|Teko@wght@300..700|Big Shoulders Display@wght@100..900|Rubik Mono One|Sigmar One|Climate Crisis|Bungee|Bungee Shade|Bungee Inline|Bungee Spice|Nabla|Monoton|Faster One|Fascinate|Poller One|Rampart One"),
  ...F("retro", "Shrikhand|Rye|Ewert|Sancreek|Diplomata|Special Elite|Press Start 2P|VT323|Silkscreen|Audiowide|Orbitron@wght@400..900|Michroma|Syncopate|Major Mono Display|Codystar|Monofett|Rubik Glitch|Rubik Wet Paint|Rubik Puddles|Rubik Spray Paint|Creepster|Eater|Nosifer|Frijole"),
  ...F("script", "Pacifico|Lobster|Dancing Script@wght@400..700|Great Vibes|Satisfy|Kaushan Script|Permanent Marker|Caveat@wght@400..700|Sacramento|Yellowtail|Allura|Parisienne|Alex Brush|Marck Script|Courgette|Cookie|Damion|Mr Dafoe|Rock Salt|Shadows Into Light|Homemade Apple|Reenie Beanie|Knewave|Sedgwick Ave Display|Amatic SC"),
  ...F("serif", "Playfair Display@wght@400..900|DM Serif Display|Cinzel@wght@400..900|Cinzel Decorative|Cormorant Garamond|Libre Baskerville|Bodoni Moda@wght@400..900|Yeseva One|Rozha One|Gloock|Fraunces@wght@100..900"),
  ...F("sans", "Montserrat@wght@100..900|Raleway@wght@100..900|Work Sans@wght@100..900|Archivo@wght@100..900|Barlow Condensed|League Spartan@wght@100..900|Outfit@wght@100..900|Kanit|Exo 2@wght@100..900|Josefin Sans@wght@100..700|Quicksand@wght@300..700|Nunito@wght@200..1000|Lexend@wght@100..900"),
  ...F("fun", "Luckiest Guy|Bangers|Chewy|Fredoka@wght@300..700|Gochi Hand|Boogaloo|Bowlby One SC|Carter One|Concert One|Fugaz One|Gluten@wght@100..900|Grandstander@wght@100..900|Modak|Spicy Rice|Sniglet"),
];
export const PRINT_FONT_CATS: { cat: PrintFontCat; label: string }[] = [
  { cat: "display", label: "Print: bold display" },
  { cat: "retro", label: "Print: retro & specialty" },
  { cat: "script", label: "Print: script & hand" },
  { cat: "serif", label: "Print: elegant serif" },
  { cat: "sans", label: "Print: clean sans" },
  { cat: "fun", label: "Print: fun & friendly" },
];
const BY_ID = new Map(PRINT_FONTS.map((f) => [PRINT_FONT_PREFIX + f.family.replace(/ /g, "+"), f]));
export const printFontId = (family: string) => PRINT_FONT_PREFIX + family.replace(/ /g, "+");
export const isPrintFontId = (id: unknown): id is string => typeof id === "string" && BY_ID.has(id);
export function printFontStack(id: string): string | null {
  const f = BY_ID.get(id);
  if (!f) return null;
  const back = f.cat === "script" ? "cursive" : f.cat === "serif" ? "Georgia, serif" : "Impact, Arial, sans-serif";
  return `"${f.family}", ${back}`;
}
/** One stylesheet URL per family (Google css2; display=block so exports wait for the font). */
export function printFontHref(id: string): string | null {
  const f = BY_ID.get(id);
  if (!f) return null;
  return `https://fonts.googleapis.com/css2?family=${f.family.replace(/ /g, "+")}${f.axes ? `:${f.axes}` : ""}&display=block`;
}

export function __runPrintTypeTests(): { passed: number; failed: number; failures: string[] } {
  let passed = 0;
  const failures: string[] = [];
  const ok = (c: boolean, m: string) => (c ? passed++ : failures.push(m));
  ok(normalizeTextArt(null) === undefined && normalizeTextArt({ kind: "nope" }) === undefined, "art: junk dropped");
  const a = normalizeTextArt({ kind: "extrude", depth: 99, color: "#FF0000", angle: 45 });
  ok(a?.depth === ART_DEPTH_MAX && a.color === "#ff0000", "art: clamp + lowercase");
  ok(artShadow({ kind: "extrude", depth: 3, color: "#000000", angle: 0 }, "#fff").split(", ").length === 4, "extrude layers");
  ok(artShadow({ kind: "long", depth: 2, color: "#000000", angle: 90 }, "#fff").split(", ").length === 6, "long layers");
  ok(artShadow({ kind: "extrude", depth: 0, color: "#000000", angle: 0 }, "#fff") === "", "zero depth = nothing");
  ok(normalizeTextArt({ img: "https://x.supabase.co/a.jpg" })?.img === "https://x.supabase.co/a.jpg", "img fill ok");
  ok(safeArtImg("javascript:alert(1)") === undefined && safeArtImg("https://a/b c.jpg") === undefined && safeArtImg("//evil.com/a") === undefined, "img guard");
  ok(isPrintFontId("gf:Bebas+Neue") && !isPrintFontId("gf:Comic+Sans") && printFontStack("gf:Pacifico")?.includes("cursive") === true, "fonts");
  ok(printFontHref("gf:Montserrat") === "https://fonts.googleapis.com/css2?family=Montserrat:wght@100..900&display=block", "font href axes");
  ok(printFontHref("gf:Anton") === "https://fonts.googleapis.com/css2?family=Anton&display=block", "font href plain");
  ok(new Set(PRINT_FONTS.map((f) => f.family)).size === PRINT_FONTS.length && PRINT_FONTS.length >= 100, "fonts unique, 100+");
  return { passed, failed: failures.length, failures };
}
