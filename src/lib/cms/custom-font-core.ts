/**
 * custom-font-core — R56-S2. Pure, import-free rules for fonts the OWNER
 * uploads (any font they downloaded), used by Banner Studio and the site-wide
 * heading/body font picker.
 *
 * Owner, verbatim: "allow me to upload any font I download, and give me the
 * opportunity to check a box that says I am allowed to use the font. instead
 * of the system going above and beyond and blocking me from using cool fonts".
 * So the ONLY gates are: (1) the licence box is ticked (recorded with who and
 * when), and (2) the bytes really are a web font a browser can load. Nothing
 * else is judged.
 *
 * A custom font id is SELF-DESCRIBING: `custom:<16 hex>.<ext>`. From the id
 * alone the public page can build the @font-face (family `gwf-<hex>`, file
 * `/gw-fonts/<hex>.<ext>`), so rendering a banner never needs a database read.
 * `/gw-fonts/*` is a same-origin rewrite to the public `media` bucket
 * (next.config.ts) — browsers require CORS for cross-origin fonts (CSS Fonts 4
 * §4.8.2 "font fetching requirements"), and same-origin needs none.
 *
 * File signatures (first 4 bytes), from the specs:
 *   WOFF2  "wOF2"            (W3C WOFF2 §3, signature 0x774F4632)
 *   WOFF   "wOFF"            (W3C WOFF 1.0 §3, signature 0x774F4646)
 *   TTF    00 01 00 00 / "true"  (OpenType sfntVersion; "true" = old Apple TrueType)
 *   OTF    "OTTO"            (OpenType with CFF outlines)
 *   TTC    "ttcf"            (collection — refused: @font-face can't pick a face)
 */

export type FontExt = "woff2" | "woff" | "ttf" | "otf";

export const FONT_FORMATS: Record<FontExt, { mime: string; css: string; label: string }> = {
  woff2: { mime: "font/woff2", css: "woff2", label: "WOFF2" },
  woff: { mime: "font/woff", css: "woff", label: "WOFF" },
  ttf: { mime: "font/ttf", css: "truetype", label: "TrueType" },
  otf: { mime: "font/otf", css: "opentype", label: "OpenType" },
};

export const FONT_ACCEPT = ".woff2,.woff,.ttf,.otf";
/** Storage sanity only — real web fonts are 20 KB to ~2 MB; CJK families can reach ~15 MB. */
export const FONT_MAX_BYTES = 25 * 1024 * 1024;
/** Above this every first-time visitor waits noticeably for the font; we SAY so, never block. */
export const FONT_ADVISORY_BYTES = 1024 * 1024;
/** URL prefix rewritten (same origin) to media/fonts/ in the public bucket. */
export const CUSTOM_FONT_URL_PREFIX = "/gw-fonts/";
export const CUSTOM_FONT_STORAGE_FOLDER = "fonts/";
export const CUSTOM_FONT_USAGE = "font";
export const FONT_LICENSE_STATUS = "owner-attested";
export const FONT_LICENSE_STATEMENT = "I have the right to use this font on this website (I bought it, it's free for commercial use, or I have a licence).";

const ID_RE = /^custom:([a-f0-9]{16})\.(woff2|woff|ttf|otf)$/;
const KEY_RE = /^fonts\/([a-f0-9]{16})\.(woff2|woff|ttf|otf)$/;

export function isCustomFontId(id: unknown): id is string {
  return typeof id === "string" && ID_RE.test(id);
}

export function customFontParts(id: string): { nonce: string; ext: FontExt } | null {
  const m = ID_RE.exec(id);
  return m ? { nonce: m[1]!, ext: m[2] as FontExt } : null;
}

export function customFontId(nonce: string, ext: FontExt): string | null {
  const id = `custom:${nonce}.${ext}`;
  return isCustomFontId(id) ? id : null;
}

export function customFontKey(nonce: string, ext: FontExt): string {
  return `${CUSTOM_FONT_STORAGE_FOLDER}${nonce}.${ext}`;
}

/** Storage key → font id (null when the key isn't one of ours). */
export function customFontIdFromKey(key: unknown): string | null {
  if (typeof key !== "string") return null;
  const m = KEY_RE.exec(key);
  return m ? `custom:${m[1]}.${m[2]}` : null;
}

export function customFontFamily(id: string): string | null {
  const p = customFontParts(id);
  return p ? `gwf-${p.nonce}` : null;
}

/** CSS font-family for a custom id, with a safe system fallback while it loads. */
export function customFontStack(id: string): string | null {
  const fam = customFontFamily(id);
  return fam ? `"${fam}", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` : null;
}

export function customFontUrl(id: string): string | null {
  const p = customFontParts(id);
  return p ? `${CUSTOM_FONT_URL_PREFIX}${p.nonce}.${p.ext}` : null;
}

/**
 * @font-face rules for the given ids (unknown ids skipped, duplicates once,
 * stable order). font-display: swap = text shows at once in the fallback and
 * swaps in. The weight/style RANGE stops the browser faking bold/italic on a
 * single-weight font (synthetic bold smears display fonts).
 */
export function customFontFaceCss(ids: Iterable<string>): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!isCustomFontId(id) || seen.has(id)) continue;
    seen.add(id);
    const p = customFontParts(id)!;
    out.push(
      `@font-face{font-family:"gwf-${p.nonce}";src:url("${CUSTOM_FONT_URL_PREFIX}${p.nonce}.${p.ext}") format("${FONT_FORMATS[p.ext].css}");font-display:swap;font-weight:100 900;font-style:normal}`,
    );
  }
  return out.join("\n");
}

export function fontExtFromName(filename: unknown): FontExt | null {
  if (typeof filename !== "string") return null;
  const m = /\.(woff2|woff|ttf|otf)$/i.exec(filename.trim());
  return m ? (m[1]!.toLowerCase() as FontExt) : null;
}

export type FontSniff = { ok: true; ext: FontExt } | { ok: false; error: string };

/** Identify a font from its first bytes (never trusts the file name). */
export function sniffFont(bytes: Uint8Array): FontSniff {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4) return { ok: false, error: "The file is empty or too short to be a font." };
  const tag = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
  if (tag === "wOF2") return { ok: true, ext: "woff2" };
  if (tag === "wOFF") return { ok: true, ext: "woff" };
  if (tag === "OTTO") return { ok: true, ext: "otf" };
  if (tag === "true" || (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0)) return { ok: true, ext: "ttf" };
  if (tag === "ttcf") return { ok: false, error: "That's a font COLLECTION (.ttc), which web pages can't load. Use the single .ttf/.otf for the style you want." };
  return { ok: false, error: "That file isn't a font a web browser can load. Use a .woff2, .woff, .ttf or .otf file." };
}

/** The stored file's real type must agree with its name. TTF↔OTF are both sfnt, so either label is fine. */
export function sniffMatchesExt(sniffed: FontExt, ext: FontExt): boolean {
  if (sniffed === ext) return true;
  const sfnt = (e: FontExt) => e === "ttf" || e === "otf";
  return sfnt(sniffed) && sfnt(ext);
}

/** A readable family label: the name typed, else the file name tidied. */
export function cleanFontLabel(name: unknown, filename?: unknown): string {
  const raw = typeof name === "string" && name.trim() ? name : typeof filename === "string" ? filename.replace(/\.(woff2|woff|ttf|otf)$/i, "") : "";
  const s = raw.replace(/[\u0000-\u001f\u007f<>"`\\]/g, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  return s || "My font";
}

export type FontUploadCheck = { ok: true; ext: FontExt; mime: string; advisory: string | null } | { ok: false; error: string };

export function checkFontUpload(input: { filename: unknown; size: unknown; licenseConfirmed: unknown }): FontUploadCheck {
  if (input.licenseConfirmed !== true) return { ok: false, error: "Tick the box to confirm you have the right to use this font." };
  const ext = fontExtFromName(input.filename);
  if (!ext) return { ok: false, error: "Choose a .woff2, .woff, .ttf or .otf font file." };
  const size = Number(input.size);
  if (!Number.isFinite(size) || size <= 0) return { ok: false, error: "That file is empty." };
  if (size > FONT_MAX_BYTES) return { ok: false, error: "That font is over 25 MB — far larger than any web font. Check you picked the right file." };
  const advisory =
    size > FONT_ADVISORY_BYTES
      ? `This font is ${(size / 1024 / 1024).toFixed(1)} MB, so first-time visitors wait a moment for it (text shows in a standard font meanwhile).${ext === "woff2" ? "" : " A .woff2 version of the same font is usually 50–70% smaller."}`
      : null;
  return { ok: true, ext, mime: FONT_FORMATS[ext].mime, advisory };
}

/** Every custom font id used anywhere in a design-like object (boxes + buttons). */
export function customFontIdsIn(design: { boxes?: { font?: string }[]; buttons?: { font?: string }[] } | null | undefined): string[] {
  if (!design) return [];
  const ids = [...(design.boxes ?? []), ...(design.buttons ?? [])].map((x) => x?.font).filter(isCustomFontId);
  return [...new Set(ids)].sort();
}

// ── Self-tests ─────────────────────────────────────────────────────────────

export function __runCustomFontTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error("custom-font-core FAIL:", m);
    }
  };
  const b = (...xs: number[]) => new Uint8Array(xs);
  const s = (t: string) => new Uint8Array([...t].map((c) => c.charCodeAt(0)));
  const id = "custom:0123456789abcdef.woff2";

  ok(isCustomFontId(id) && !isCustomFontId("custom:XYZ.woff2") && !isCustomFontId("custom:0123456789abcdef.exe") && !isCustomFontId("oswald"), "id shape");
  ok(customFontId("0123456789abcdef", "ttf") === "custom:0123456789abcdef.ttf" && customFontId("nothex", "ttf") === null, "id builder");
  ok(customFontIdFromKey("fonts/0123456789abcdef.otf") === "custom:0123456789abcdef.otf" && customFontIdFromKey("uploads/x.png") === null, "key → id");
  ok(customFontFamily(id) === "gwf-0123456789abcdef" && (customFontStack(id) ?? "").startsWith('"gwf-0123456789abcdef", system-ui'), "family + stack");
  ok(customFontUrl(id) === "/gw-fonts/0123456789abcdef.woff2", "same-origin url");
  const css = customFontFaceCss([id, id, "bogus", "custom:fedcba9876543210.ttf"]);
  ok(css.split("@font-face").length === 3, "dedupes + skips unknown");
  ok(css.includes('format("woff2")') && css.includes('format("truetype")') && css.includes("font-display:swap") && css.includes("font-weight:100 900"), "face css");
  ok(sniffFont(s("wOF2xxxx")).ok && (sniffFont(s("wOF2")) as { ext: string }).ext === "woff2", "woff2 sniff");
  ok((sniffFont(s("wOFF")) as { ext: string }).ext === "woff" && (sniffFont(s("OTTO")) as { ext: string }).ext === "otf", "woff/otf sniff");
  ok((sniffFont(b(0, 1, 0, 0)) as { ext: string }).ext === "ttf" && (sniffFont(s("true")) as { ext: string }).ext === "ttf", "ttf sniff");
  ok(!sniffFont(s("ttcf")).ok && !sniffFont(s("\x89PNG")).ok && !sniffFont(b(1, 2)).ok, "refuses ttc/png/short");
  ok(sniffMatchesExt("otf", "ttf") && sniffMatchesExt("woff2", "woff2") && !sniffMatchesExt("woff", "woff2"), "ext agreement");
  ok(cleanFontLabel("", "Bubble_Gum-Regular.otf") === "Bubble Gum-Regular" && cleanFontLabel('  Cool <b>"Font"  ') === "Cool bFont", "label tidy");
  ok(cleanFontLabel(null, null) === "My font" && cleanFontLabel("x".repeat(99)).length === 60, "label fallback + cap");
  ok(!checkFontUpload({ filename: "a.woff2", size: 10, licenseConfirmed: false }).ok, "licence box required");
  ok(!checkFontUpload({ filename: "a.zip", size: 10, licenseConfirmed: true }).ok && !checkFontUpload({ filename: "a.ttf", size: 0, licenseConfirmed: true }).ok, "type + empty");
  const big = checkFontUpload({ filename: "A.TTF", size: 3 * 1024 * 1024, licenseConfirmed: true });
  ok(big.ok && big.ext === "ttf" && big.mime === "font/ttf" && (big.advisory ?? "").includes("woff2"), "advisory, never block");
  ok(!checkFontUpload({ filename: "a.otf", size: FONT_MAX_BYTES + 1, licenseConfirmed: true }).ok, "sanity cap");
  ok(
    customFontIdsIn({ boxes: [{ font: id }, { font: "site" }], buttons: [{ font: id }, { font: "custom:fedcba9876543210.ttf" }] }).join() === `${id},custom:fedcba9876543210.ttf`,
    "collect ids",
  );
  return { passed, failed };
}
