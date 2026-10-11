/**
 * R45-S2: check that an uploaded file's BYTES match the type it claims.
 * The browser's Content-Type and the file name are both set by the uploader,
 * so neither proves anything on its own.
 *
 * Sources (fetched and read, not assumed):
 *  - OWASP File Upload Cheat Sheet:
 *      - "Validate the file type, don't trust the Content-Type header as it
 *        can be spoofed."
 *      - File Signature Validation is used "in conjunction with
 *        content-type validation", never on its own. Here it is layered on top
 *        of the R44 type, extension and size checks (upload-policy-core.ts).
 *      - Client-side active content (XSS) in publicly retrievable files is a
 *        named threat. That is why SVGs with scripts are refused below.
 *  - WHATWG MIME Sniffing Standard:
 *      - §6.1 image byte patterns: GIF87a/GIF89a; "RIFF"+4 bytes+"WEBPVP";
 *        89 50 4E 47 0D 0A 1A 0A (PNG); FF D8 FF (JPEG).
 *      - §6.2.1 "Signature for MP4": ftyp box with an "mp4" brand.
 *      - §6.2.2 "Signature for WebM": EBML 1A 45 DF A3 plus a "webm" DocType.
 *      - §7.1 "%PDF-" for PDF.
 *      - "Resource header": browsers sniff at most the first 1445 bytes.
 *  - MP4RA registered brands (mp4ra.org/registered-types/brands): isom,
 *    iso2-iso6, avc1, dash, mp41 and mp42 are ISO-BMFF/MP4 brands. Many real
 *    phone and Canva exports list "isom" or "avc1" without an "mp4" brand, so
 *    those are accepted too. QuickTime ("qt  ") stays refused, as R44 already
 *    refuses .MOV.
 */

/** WHATWG "resource header" length. */
export const SNIFF_BYTES = 1445;
/** Read a little more so an MP4 ftyp box with a long brand list still fits. */
export const SIGNATURE_READ_BYTES = 4096;
/** SVG is text and is checked in full. A logo over 1 MB is not a normal SVG. */
export const SVG_MAX_CHECK_BYTES = 1024 * 1024;

const ISO_BMFF_BRANDS = new Set(["isom", "iso2", "iso3", "iso4", "iso5", "iso6", "avc1", "dash", "mp41", "mp42"]);

type Bytes = Uint8Array;

function startsWith(b: Bytes, sig: readonly number[], offset = 0): boolean {
  if (b.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (b[offset + i] !== sig[i]) return false;
  return true;
}
function ascii(b: Bytes, from: number, len: number): string {
  let s = "";
  for (let i = from; i < from + len && i < b.length; i++) s += String.fromCharCode(b[i]!);
  return s;
}

export function isPng(b: Bytes): boolean {
  return startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}
export function isJpeg(b: Bytes): boolean {
  return startsWith(b, [0xff, 0xd8, 0xff]);
}
export function isGif(b: Bytes): boolean {
  return ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a";
}
export function isWebp(b: Bytes): boolean {
  return ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 6) === "WEBPVP";
}
export function isPdf(b: Bytes): boolean {
  return ascii(b, 0, 5) === "%PDF-";
}

/** The brands in an ftyp box (major brand first), or null if there is no ftyp. */
export function ftypBrands(b: Bytes): string[] | null {
  if (b.length < 12 || ascii(b, 4, 4) !== "ftyp") return null;
  const boxSize = ((b[0]! << 24) >>> 0) + (b[1]! << 16) + (b[2]! << 8) + b[3]!;
  const end = Math.min(b.length, boxSize >= 16 ? boxSize : 16);
  const brands = [ascii(b, 8, 4)];
  for (let i = 16; i + 4 <= end; i += 4) brands.push(ascii(b, i, 4)); // skip minor version at 12..15
  return brands;
}

/** WHATWG §6.2.1, with the MP4RA ISO-BMFF brands accepted as well. */
export function isMp4(b: Bytes): boolean {
  const brands = ftypBrands(b);
  if (!brands) return false;
  if (brands[0] === "qt  ") return false; // QuickTime .MOV
  return brands.some((x) => x.startsWith("mp4") || ISO_BMFF_BRANDS.has(x));
}

/** WHATWG §6.2.2, simplified: EBML magic, then a padded "webm" DocType within the first 38 bytes. */
export function isWebm(b: Bytes): boolean {
  if (!startsWith(b, [0x1a, 0x45, 0xdf, 0xa3])) return false;
  const limit = Math.min(b.length - 4, 38);
  for (let i = 4; i <= limit; i++) {
    if (b[i] === 0x42 && b[i + 1] === 0x82) {
      // The DocType element follows; scan a few bytes for "webm".
      for (let j = i + 2; j < Math.min(b.length - 3, i + 12); j++) if (ascii(b, j, 4) === "webm") return true;
    }
  }
  return false;
}

function decodeText(b: Bytes): string {
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(b);
  } catch {
    return ascii(b, 0, b.length);
  }
}

/** Is this text an SVG document? Allows an optional BOM, <?xml ?>, comments and a DOCTYPE before <svg. */
export function isSvgText(text: string): boolean {
  let t = text.replace(/^\uFEFF/, "").trimStart();
  for (let guard = 0; guard < 20; guard++) {
    if (t.startsWith("<?xml")) {
      const e = t.indexOf("?>");
      if (e < 0) return false;
      t = t.slice(e + 2).trimStart();
    } else if (t.startsWith("<!--")) {
      const e = t.indexOf("-->");
      if (e < 0) return false;
      t = t.slice(e + 3).trimStart();
    } else if (/^<!DOCTYPE\s+svg/i.test(t)) {
      const e = t.indexOf(">");
      if (e < 0) return false;
      t = t.slice(e + 1).trimStart();
    } else break;
  }
  return /^<svg[\s>/]/i.test(t);
}

/**
 * OWASP "client-side active content". An SVG opened directly from our public
 * storage can run script, so refuse anything that could execute: script tags,
 * on* event handlers, javascript: URLs, foreignObject (embeds HTML), and
 * external entities (XXE). Returns the reason, or null if the SVG is clean.
 */
export function svgActiveContent(text: string): string | null {
  const t = text.toLowerCase();
  if (/<script[\s>/]/.test(t)) return "it contains a <script>";
  if (/<foreignobject[\s>/]/.test(t)) return "it embeds HTML (<foreignObject>)";
  if (/\son[a-z]+\s*=/.test(t)) return "it has an event handler (on…=)";
  if (/(?:href|src)\s*=\s*["']?\s*(?:javascript|data:text\/html|vbscript)/.test(t)) return "it links to a script (javascript: URL)";
  if (/<!entity/.test(t)) return "it declares XML entities";
  return null;
}

/** Detect the real type from the first bytes. Null if unknown. */
export function sniffMime(b: Bytes): string | null {
  if (isPng(b)) return "image/png";
  if (isJpeg(b)) return "image/jpeg";
  if (isGif(b)) return "image/gif";
  if (isWebp(b)) return "image/webp";
  if (isPdf(b)) return "application/pdf";
  if (isWebm(b)) return "video/webm";
  if (isMp4(b)) return "video/mp4";
  if (ascii(b, 4, 4) === "ftyp" && ftypBrands(b)?.[0] === "qt  ") return "video/quicktime";
  if (ascii(b, 4, 4) === "ftyp" && ["heic", "heix", "mif1", "msf1"].includes(ftypBrands(b)?.[0] ?? "")) return "image/heic";
  if (isSvgText(decodeText(b.subarray(0, SNIFF_BYTES)))) return "image/svg+xml";
  return null;
}

const LABEL: Record<string, string> = {
  "image/png": "PNG",
  "image/jpeg": "JPG",
  "image/gif": "GIF",
  "image/webp": "WebP",
  "image/svg+xml": "SVG",
  "application/pdf": "PDF",
  "video/mp4": "MP4",
  "video/webm": "WebM",
  "video/quicktime": "QuickTime .MOV",
  "image/heic": "iPhone HEIC",
};
const label = (m: string) => LABEL[m] ?? m;

export type SignatureCheck = { ok: true } | { ok: false; detected: string | null; error: string };

/**
 * Does `bytes` (the start of the file; the WHOLE file for SVG) really match
 * `declaredMime`? Unknown declared types are refused, never waved through.
 */
export function checkFileSignature(declaredMime: unknown, bytes: Bytes, filename = "That file"): SignatureCheck {
  const declared = typeof declaredMime === "string" ? declaredMime.toLowerCase().split(";")[0]!.trim() : "";
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
    return { ok: false, detected: null, error: `${filename} is empty or couldn't be read. Please upload it again.` };
  }
  if (!LABEL[declared] || declared === "video/quicktime" || declared === "image/heic") {
    return { ok: false, detected: null, error: `${filename}: ${declared || "unknown"} files aren't accepted.` };
  }
  const detected = sniffMime(bytes);
  if (detected !== declared) {
    const what = detected ? `really a ${label(detected)} file` : "not a recognisable image, video or PDF";
    return {
      ok: false,
      detected,
      error: `${filename} says it is ${label(declared)} but it is ${what}. It was refused for safety. Re-export it as a real ${label(declared)} and upload again.`,
    };
  }
  if (declared === "image/svg+xml") {
    const why = svgActiveContent(decodeText(bytes));
    if (why) {
      return {
        ok: false,
        detected,
        error: `${filename} was refused because ${why}, and SVGs can run code in a shopper's browser. Export it as PNG or WebP instead, or re-save the SVG as a "plain" or "optimized" SVG.`,
      };
    }
  }
  return { ok: true };
}

// ── Self-tests ──────────────────────────────────────────────────────────────

export function __runFileSignatureCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error("file-signature-core FAIL:", m);
    }
  };
  const B = (...xs: (number | string)[]) => {
    const out: number[] = [];
    for (const x of xs) {
      if (typeof x === "number") out.push(x);
      else for (const ch of x) out.push(ch.charCodeAt(0));
    }
    return new Uint8Array(out);
  };
  const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const pad = (b: Uint8Array, n = 64) => {
    const o = new Uint8Array(Math.max(n, b.length));
    o.set(b);
    return o;
  };

  const png = pad(B(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a, "IHDR"));
  const jpg = pad(B(0xff, 0xd8, 0xff, 0xe0, "JFIF"));
  const gif87 = pad(B("GIF87a"));
  const gif89 = pad(B("GIF89a"));
  const webp = pad(B("RIFF", 1, 2, 3, 4, "WEBPVP8 "));
  const pdf = pad(B("%PDF-1.7\n"));
  const mp4 = pad(B(...be32(24), "ftyp", "isom", 0, 0, 2, 0, "isom", "mp41"));
  const mp4Avc = pad(B(...be32(20), "ftyp", "avc1", 0, 0, 0, 0, "avc1"));
  const mp4Brand = pad(B(...be32(20), "ftyp", "mp42", 0, 0, 0, 0, "mp42"));
  const mov = pad(B(...be32(20), "ftyp", "qt  ", 0, 0, 2, 0, "qt  "));
  const heic = pad(B(...be32(24), "ftyp", "heic", 0, 0, 0, 0, "mif1", "heic"));
  const webm = pad(B(0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x84, "webm", 0x42, 0x87));
  const mkv = pad(B(0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x82, 0x88, "matroska"));
  const svg = B('<?xml version="1.0"?>\n<!-- logo -->\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>');
  const html = B("<!doctype html><html><script>alert(1)</script></html>");
  const exe = pad(B("MZ", 0x90, 0x00));
  const zip = pad(B("PK", 3, 4));

  // sniff each real type
  ok(sniffMime(png) === "image/png", "png");
  ok(sniffMime(jpg) === "image/jpeg", "jpeg");
  ok(sniffMime(gif87) === "image/gif" && sniffMime(gif89) === "image/gif", "gif 87a/89a");
  ok(sniffMime(webp) === "image/webp", "webp");
  ok(sniffMime(pdf) === "application/pdf", "pdf");
  ok(sniffMime(mp4) === "video/mp4", "mp4 isom+mp41");
  ok(sniffMime(mp4Avc) === "video/mp4", "mp4 avc1-only (Canva/phone style)");
  ok(sniffMime(mp4Brand) === "video/mp4", "mp4 mp42 major");
  ok(sniffMime(mov) === "video/quicktime", "mov detected as quicktime");
  ok(sniffMime(heic) === "image/heic", "heic detected");
  ok(sniffMime(webm) === "video/webm", "webm");
  ok(sniffMime(mkv) === null, "plain matroska is not webm");
  ok(sniffMime(svg) === "image/svg+xml", "svg with xml decl + comment");
  ok(sniffMime(html) === null, "html is unknown");
  ok(sniffMime(exe) === null && sniffMime(zip) === null, "exe/zip unknown");
  ok(sniffMime(new Uint8Array(0)) === null, "empty unknown");
  ok(sniffMime(B(0xff, 0xd8)) === null, "truncated jpeg");
  ok(!isWebp(pad(B("RIFF", 0, 0, 0, 0, "WAVE"))), "wav is not webp");
  ok(!isMp4(pad(B(...be32(20), "ftyp", "3gp4", 0, 0, 0, 0, "3gp4"))), "unknown brand refused");
  ok(ftypBrands(mp4)?.join(",") === "isom,isom,mp41", "brands list skips minor version");
  ok(ftypBrands(png) === null, "no ftyp");

  // svg detection edge cases
  ok(isSvgText("\uFEFF  <svg>"), "bom + whitespace");
  ok(isSvgText('<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x"><svg/>'), "doctype");
  ok(!isSvgText("<html><svg></svg></html>"), "svg inside html refused");
  ok(!isSvgText("<?xml version='1.0'"), "unterminated decl");
  ok(!isSvgText("<svgfoo>"), "svgfoo not svg");

  // active content
  ok(svgActiveContent('<svg><script>x</script></svg>') !== null, "script");
  ok(svgActiveContent('<svg><SCRIPT type="x">') !== null, "SCRIPT upper");
  ok(svgActiveContent('<svg onload="x()">') !== null, "onload");
  ok(svgActiveContent('<svg><a href="javascript:alert(1)">') !== null, "javascript href");
  ok(svgActiveContent('<svg><a xlink:href = "javascript:x">') !== null, "xlink javascript");
  ok(svgActiveContent('<svg><foreignObject>') !== null, "foreignObject");
  ok(svgActiveContent('<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>') !== null, "xxe entity");
  ok(svgActiveContent('<svg><rect fill="red"/><text>online</text></svg>') === null, "clean svg (word 'online' is not a handler)");
  ok(svgActiveContent('<svg><a href="https://greenway.example">') === null, "https link ok");

  // checkFileSignature
  ok(checkFileSignature("image/png", png).ok, "png ok");
  ok(checkFileSignature("IMAGE/JPEG; charset=x", jpg).ok, "mime normalised");
  ok(checkFileSignature("video/mp4", mp4).ok && checkFileSignature("video/webm", webm).ok, "videos ok");
  ok(checkFileSignature("application/pdf", pdf).ok, "pdf ok");
  ok(checkFileSignature("image/svg+xml", svg).ok, "clean svg ok");
  const spoof = checkFileSignature("image/png", jpg, "x.png");
  ok(!spoof.ok && spoof.detected === "image/jpeg" && /really a JPG/.test(spoof.error), "jpeg renamed png refused with clear message");
  const exeAsJpg = checkFileSignature("image/jpeg", exe, "x.jpg");
  ok(!exeAsJpg.ok && exeAsJpg.detected === null && /not a recognisable/.test(exeAsJpg.error), "exe as jpg refused");
  ok(!checkFileSignature("video/mp4", mov).ok, "mov as mp4 refused");
  ok(!checkFileSignature("image/jpeg", heic).ok, "heic as jpg refused");
  ok(!checkFileSignature("image/svg+xml", html).ok, "html as svg refused");
  const evil = checkFileSignature("image/svg+xml", B('<svg onload="steal()"></svg>'), "logo.svg");
  ok(!evil.ok && /event handler/.test(evil.error), "active svg refused with reason");
  ok(!checkFileSignature("video/quicktime", mov).ok, "declared quicktime refused");
  ok(!checkFileSignature("application/zip", zip).ok, "unknown declared refused");
  ok(!checkFileSignature("image/png", new Uint8Array(0)).ok, "empty refused");
  ok(!checkFileSignature(42, png).ok, "non-string mime refused");
  ok(!checkFileSignature("image/png", "x" as unknown as Uint8Array).ok, "non-bytes refused");
  ok(SNIFF_BYTES === 1445 && SIGNATURE_READ_BYTES >= SNIFF_BYTES, "read covers WHATWG header");

  return { passed, failed };
}
