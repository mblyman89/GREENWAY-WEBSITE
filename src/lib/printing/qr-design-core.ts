/**
 * D263 S5: designer QR codes for print. Pure. Builds on our own encoder
 * (qr-core, version ≤ 10) and writes ONE vector SVG path (viewBox 0 0 256)
 * so the QR stays razor sharp at any print size and in the PDF.
 *
 *  - Content: website (+ UTM tracking), phone, text message, email, map,
 *    Wi-Fi, contact card, plain text.
 *  - Module look: square, rounded, dots, diamonds, vertical / horizontal bars.
 *  - Corner eyes: square, rounded, circle, leaf (outer ring + inner ball).
 *  - Logo hole in the middle (forces level H, ≤ 22% of the width).
 *  - Warn-only checks: contrast, print size for the reading distance, quiet zone.
 * Rings use opposite winding so the default nonzero fill leaves holes.
 */
import { encodeQr, type QrEcLevel } from "./qr-core";

export type QrContentKind = "url" | "tel" | "sms" | "email" | "map" | "wifi" | "vcard" | "text";
export type QrModuleStyle = "square" | "rounded" | "dots" | "diamond" | "vbars" | "hbars";
export type QrEyeStyle = "square" | "rounded" | "circle" | "leaf";
export type QrContent = {
  kind: QrContentKind;
  value: string;
  utm?: { source: string; medium: string; campaign: string };
  body?: string;
  ssid?: string;
  password?: string;
  security?: "WPA" | "WEP" | "nopass";
  name?: string;
  org?: string;
  email?: string;
  url?: string;
  address?: string;
};
export const QR_CONTENT_KINDS: { id: QrContentKind; label: string }[] = [
  { id: "url", label: "Website" },
  { id: "tel", label: "Phone call" },
  { id: "sms", label: "Text message" },
  { id: "email", label: "Email" },
  { id: "map", label: "Map / directions" },
  { id: "wifi", label: "Wi-Fi" },
  { id: "vcard", label: "Contact card" },
  { id: "text", label: "Plain text" },
];
export const QR_MODULE_STYLES: { id: QrModuleStyle; label: string }[] = [
  { id: "square", label: "Classic" },
  { id: "rounded", label: "Rounded" },
  { id: "dots", label: "Dots" },
  { id: "diamond", label: "Diamonds" },
  { id: "vbars", label: "Vertical bars" },
  { id: "hbars", label: "Horizontal bars" },
];
export const QR_EYE_STYLES: { id: QrEyeStyle; label: string }[] = [
  { id: "square", label: "Square" },
  { id: "rounded", label: "Rounded" },
  { id: "circle", label: "Circle" },
  { id: "leaf", label: "Leaf" },
];

const esc = (s: string) => s.replace(/([\\;,:"])/g, "\\$1");
const clean = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/[\r\n]+/g, " ").trim().slice(0, n) : "");

/** The text the QR carries. Returns "" when the required field is missing. */
export function qrPayload(c: QrContent): string {
  const v = clean(c.value, 600);
  switch (c.kind) {
    case "url": {
      if (!/^https?:\/\/[^\s]+$/i.test(v)) return "";
      if (!c.utm || !(c.utm.source || c.utm.medium || c.utm.campaign)) return v;
      try {
        const u = new URL(v);
        if (c.utm.source) u.searchParams.set("utm_source", clean(c.utm.source, 60));
        if (c.utm.medium) u.searchParams.set("utm_medium", clean(c.utm.medium, 60));
        if (c.utm.campaign) u.searchParams.set("utm_campaign", clean(c.utm.campaign, 80));
        return u.toString();
      } catch {
        return v;
      }
    }
    case "tel": {
      const n = v.replace(/[^\d+]/g, "");
      return n.length >= 7 ? `tel:${n}` : "";
    }
    case "sms": {
      const n = v.replace(/[^\d+]/g, "");
      return n.length >= 7 ? `SMSTO:${n}:${clean(c.body, 160)}` : "";
    }
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? `mailto:${v}${c.body ? `?subject=${encodeURIComponent(clean(c.body, 120))}` : ""}` : "";
    case "map":
      return v ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v)}` : "";
    case "wifi": {
      const ssid = clean(c.ssid, 64);
      if (!ssid) return "";
      const sec = c.security === "WEP" || c.security === "nopass" ? c.security : "WPA";
      return `WIFI:T:${sec};S:${esc(ssid)};${sec === "nopass" ? "" : `P:${esc(clean(c.password, 64))};`};`;
    }
    case "vcard": {
      const name = clean(c.name, 80);
      if (!name) return "";
      const lines = ["BEGIN:VCARD", "VERSION:3.0", `FN:${esc(name)}`];
      if (c.org) lines.push(`ORG:${esc(clean(c.org, 80))}`);
      if (v) lines.push(`TEL:${v.replace(/[^\d+]/g, "")}`);
      if (c.email) lines.push(`EMAIL:${clean(c.email, 120)}`);
      if (c.url) lines.push(`URL:${clean(c.url, 200)}`);
      if (c.address) lines.push(`ADR:;;${esc(clean(c.address, 160))};;;;`);
      lines.push("END:VCARD");
      return lines.join("\n");
    }
    case "text":
      return v;
  }
}

export type QrLook = { modules: QrModuleStyle; eyes: QrEyeStyle; logoHole: number; level?: QrEcLevel };
export type QrBuild = { ok: true; path: string; eyes: string; size: number; version: number; level: QrEcLevel } | { ok: false; error: string };

const f2 = (n: number) => String(Math.round(n * 100) / 100);
/** Rect, clockwise (cw) or counter-clockwise, with corner radius r. */
function rrect(x: number, y: number, w: number, h: number, r: number, cw = true): string {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  if (r === 0) return cw ? `M${f2(x)} ${f2(y)}h${f2(w)}v${f2(h)}h${f2(-w)}z` : `M${f2(x)} ${f2(y)}v${f2(h)}h${f2(w)}v${f2(-h)}z`;
  const R = f2(r);
  const sweep = cw ? 1 : 0;
  if (cw)
    return `M${f2(x + r)} ${f2(y)}h${f2(w - 2 * r)}a${R} ${R} 0 0 ${sweep} ${R} ${R}v${f2(h - 2 * r)}a${R} ${R} 0 0 ${sweep} ${f2(-r)} ${R}h${f2(-(w - 2 * r))}a${R} ${R} 0 0 ${sweep} ${f2(-r)} ${f2(-r)}v${f2(-(h - 2 * r))}a${R} ${R} 0 0 ${sweep} ${R} ${f2(-r)}z`;
  return `M${f2(x + r)} ${f2(y)}a${R} ${R} 0 0 0 ${f2(-r)} ${R}v${f2(h - 2 * r)}a${R} ${R} 0 0 0 ${R} ${R}h${f2(w - 2 * r)}a${R} ${R} 0 0 0 ${R} ${f2(-r)}v${f2(-(h - 2 * r))}a${R} ${R} 0 0 0 ${f2(-r)} ${f2(-r)}z`;
}
function circle(cx: number, cy: number, r: number, cw = true): string {
  const s = cw ? 1 : 0;
  return `M${f2(cx - r)} ${f2(cy)}a${f2(r)} ${f2(r)} 0 1 ${s} ${f2(2 * r)} 0a${f2(r)} ${f2(r)} 0 1 ${s} ${f2(-2 * r)} 0z`;
}
/** Leaf: two opposite corners round, two sharp. */
function leaf(x: number, y: number, w: number, r: number, cw = true): string {
  const R = f2(r);
  if (cw) return `M${f2(x + r)} ${f2(y)}h${f2(w - r)}v${f2(w - r)}a${R} ${R} 0 0 1 ${f2(-r)} ${R}h${f2(-(w - r))}v${f2(-(w - r))}a${R} ${R} 0 0 1 ${R} ${f2(-r)}z`;
  return `M${f2(x + r)} ${f2(y)}a${R} ${R} 0 0 0 ${f2(-r)} ${R}v${f2(w - r)}h${f2(w - r)}a${R} ${R} 0 0 0 ${R} ${f2(-r)}v${f2(-(w - r))}z`;
}

function eye(style: QrEyeStyle, x: number, y: number, m: number): string {
  const o = 7 * m;
  const i = 3 * m;
  switch (style) {
    case "square":
      return rrect(x, y, o, o, 0) + rrect(x + m, y + m, 5 * m, 5 * m, 0, false) + rrect(x + 2 * m, y + 2 * m, i, i, 0);
    case "rounded":
      return rrect(x, y, o, o, 2 * m) + rrect(x + m, y + m, 5 * m, 5 * m, 1.4 * m, false) + rrect(x + 2 * m, y + 2 * m, i, i, m);
    case "circle":
      return circle(x + o / 2, y + o / 2, o / 2) + circle(x + o / 2, y + o / 2, 2.5 * m, false) + circle(x + o / 2, y + o / 2, 1.5 * m);
    case "leaf":
      return leaf(x, y, o, 3 * m) + leaf(x + m, y + m, 5 * m, 2 * m, false) + leaf(x + 2 * m, y + 2 * m, i, 1.2 * m);
  }
}

/** Build the designer QR path for `text`. */
export function qrDesignPath(text: string, look: QrLook): QrBuild {
  if (!text) return { ok: false, error: "Fill in what the QR should open first." };
  const logo = Math.max(0, Math.min(22, look.logoHole || 0));
  const level: QrEcLevel = logo > 0 ? "H" : (look.level ?? "Q");
  const q = encodeQr(text, { level });
  if (!q.ok || q.size <= 0) return { ok: false, error: q.error ?? "That is too long for a QR code. Shorten it (a short link helps)." };
  const n = q.size;
  const m = 256 / n;
  const inEye = (r: number, c: number) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  const hole = (logo / 100) * n;
  const lo = (n - hole) / 2;
  const inHole = (r: number, c: number) => logo > 0 && r + 1 > lo && r < lo + hole && c + 1 > lo && c < lo + hole;
  const dark = (r: number, c: number) => r >= 0 && c >= 0 && r < n && c < n && q.modules[r][c] && !inEye(r, c) && !inHole(r, c);
  const eyes = eye(look.eyes, 0, 0, m) + eye(look.eyes, (n - 7) * m, 0, m) + eye(look.eyes, 0, (n - 7) * m, m);
  const parts: string[] = [];
  if (look.modules === "vbars" || look.modules === "hbars") {
    const vert = look.modules === "vbars";
    for (let a = 0; a < n; a++) {
      let b = 0;
      while (b < n) {
        const [r, c] = vert ? [b, a] : [a, b];
        if (!dark(r, c)) {
          b++;
          continue;
        }
        let run = 0;
        while (b + run < n && (vert ? dark(b + run, a) : dark(a, b + run))) run++;
        const inset = m * 0.1;
        parts.push(vert ? rrect(a * m + inset, b * m + inset, m - 2 * inset, run * m - 2 * inset, (m - 2 * inset) / 2) : rrect(b * m + inset, a * m + inset, run * m - 2 * inset, m - 2 * inset, (m - 2 * inset) / 2));
        b += run;
      }
    }
  } else {
    for (let r = 0; r < n; r++) {
      let c = 0;
      while (c < n) {
        if (!dark(r, c)) {
          c++;
          continue;
        }
        if (look.modules === "square") {
          let run = 0;
          while (c + run < n && dark(r, c + run)) run++;
          parts.push(`M${f2(c * m)} ${f2(r * m)}h${f2(run * m)}v${f2(m)}h${f2(-run * m)}z`);
          c += run;
          continue;
        }
        const x = c * m;
        const y = r * m;
        if (look.modules === "dots") parts.push(circle(x + m / 2, y + m / 2, m * 0.45));
        else if (look.modules === "diamond") parts.push(`M${f2(x + m / 2)} ${f2(y)}l${f2(m / 2)} ${f2(m / 2)}l${f2(-m / 2)} ${f2(m / 2)}l${f2(-m / 2)} ${f2(-m / 2)}z`);
        else parts.push(rrect(x + m * 0.05, y + m * 0.05, m * 0.9, m * 0.9, m * 0.35));
        c++;
      }
    }
  }
  return { ok: true, path: parts.join(""), eyes, size: n, version: q.version, level };
}

export type QrWarn = { level: "warn" | "info"; text: string };
/** Warn-only print checks. `sizeIn` = printed width in inches; `viewFt` = reading distance. */
export function qrChecks(p: { fg: string; bg: string; contrast: number; sizeIn: number; viewFt: number; plate: boolean; logoHole: number; modules: QrModuleStyle; payload: string }): QrWarn[] {
  const out: QrWarn[] = [];
  if (p.contrast < 4) out.push({ level: "warn", text: `Low contrast (${p.contrast.toFixed(1)}:1). Phones read dark-on-light best; aim for 4:1 or more.` });
  // Rule of thumb: a QR scans from about 10× its width.
  const minIn = Math.max(0.8, (p.viewFt * 12) / 10);
  if (p.sizeIn > 0 && p.sizeIn < minIn) out.push({ level: "warn", text: `Printed about ${p.sizeIn.toFixed(1)}" wide. To scan from ${p.viewFt} ft it should be at least ${minIn.toFixed(1)}" wide.` });
  if (!p.plate) out.push({ level: "info", text: "No light square behind it. Keep a clear margin round the code (the white plate does this for you)." });
  if (p.logoHole > 0 && p.modules !== "square") out.push({ level: "info", text: "Logo + fancy dots: test-scan with two different phones before ordering." });
  if (/^https?:/i.test(p.payload) && p.payload.length > 120) out.push({ level: "info", text: "Long link = dense code. A shorter link prints bigger dots and scans faster." });
  return out;
}

/** What a QR element stores (the path is rebuilt from this when drawn). */
export type QrSpec = { content: QrContent; modules: QrModuleStyle; eyes: QrEyeStyle; logoHole: number; eyeColor?: string; plate?: string; logo?: string };
const HEX = /^#[0-9a-f]{6}$/i;
const SAFE_IMG = (v: unknown) => (typeof v === "string" && v.length <= 1000 && !/["'()\\\s<>]/.test(v) && (/^https:\/\//i.test(v) || /^\/(?!\/)/.test(v)) ? v : undefined);
export function normalizeQrSpec(raw: unknown): QrSpec | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const c = (r.content && typeof r.content === "object" ? r.content : {}) as Record<string, unknown>;
  const kind = QR_CONTENT_KINDS.find((k) => k.id === c.kind)?.id ?? "url";
  const content: QrContent = { kind, value: clean(c.value, 600) };
  for (const k of ["body", "ssid", "password", "name", "org", "email", "url", "address"] as const) if (typeof c[k] === "string" && c[k]) content[k] = clean(c[k], 200);
  if (c.security === "WEP" || c.security === "nopass" || c.security === "WPA") content.security = c.security;
  const u = c.utm as Record<string, unknown> | undefined;
  if (u && typeof u === "object") content.utm = { source: clean(u.source, 60), medium: clean(u.medium, 60), campaign: clean(u.campaign, 80) };
  const out: QrSpec = {
    content,
    modules: QR_MODULE_STYLES.find((m) => m.id === r.modules)?.id ?? "square",
    eyes: QR_EYE_STYLES.find((m) => m.id === r.eyes)?.id ?? "square",
    logoHole: Math.max(0, Math.min(22, Math.round(Number(r.logoHole) || 0))),
  };
  if (typeof r.eyeColor === "string" && HEX.test(r.eyeColor)) out.eyeColor = r.eyeColor.toLowerCase();
  if (typeof r.plate === "string" && HEX.test(r.plate)) out.plate = r.plate.toLowerCase();
  const logo = SAFE_IMG(r.logo);
  if (logo) out.logo = logo;
  return out;
}

export function __runQrDesignTests(): { passed: number; failed: number; failures: string[] } {
  let passed = 0;
  const failures: string[] = [];
  const ok = (c: boolean, m: string) => (c ? passed++ : failures.push(m));
  ok(qrPayload({ kind: "url", value: "javascript:alert(1)" }) === "", "url: http(s) only");
  ok(qrPayload({ kind: "url", value: "https://greenwaymarijuana.com/menu", utm: { source: "flyer", medium: "print", campaign: "" } }) === "https://greenwaymarijuana.com/menu?utm_source=flyer&utm_medium=print", "utm added");
  ok(qrPayload({ kind: "tel", value: "(360) 555-0100" }) === "tel:3605550100", "tel");
  ok(qrPayload({ kind: "wifi", value: "", ssid: "Green;way", password: "p:w" }) === "WIFI:T:WPA;S:Green\\;way;P:p\\:w;;", "wifi escaped");
  ok(qrPayload({ kind: "vcard", value: "3605550100", name: "Greenway" }).startsWith("BEGIN:VCARD\nVERSION:3.0\nFN:Greenway"), "vcard");
  ok(qrPayload({ kind: "email", value: "bad" }) === "", "email checked");
  for (const mod of QR_MODULE_STYLES)
    for (const e of QR_EYE_STYLES) {
      const b = qrDesignPath("https://greenwaymarijuana.com/menu", { modules: mod.id, eyes: e.id, logoHole: 0 });
      ok(b.ok && /^[MmLlHhVvAaZz0-9.,\-\s]+$/.test(b.path + b.eyes) && b.eyes.length > 0, `path ${mod.id}/${e.id}`);
    }
  const logo = qrDesignPath("https://greenwaymarijuana.com", { modules: "dots", eyes: "circle", logoHole: 20 });
  const plain = qrDesignPath("https://greenwaymarijuana.com", { modules: "dots", eyes: "circle", logoHole: 0 });
  ok(logo.ok && logo.level === "H" && plain.ok && plain.level === "Q", "logo forces level H");
  ok(!qrDesignPath("", { modules: "square", eyes: "square", logoHole: 0 }).ok, "empty refused");
  ok(qrChecks({ fg: "#000", bg: "#fff", contrast: 21, sizeIn: 1, viewFt: 10, plate: true, logoHole: 0, modules: "square", payload: "x" }).some((w) => w.text.includes("12.0")), "size warn for distance");
  ok(qrChecks({ fg: "#000", bg: "#fff", contrast: 21, sizeIn: 2, viewFt: 1, plate: true, logoHole: 0, modules: "square", payload: "x" }).length === 0, "good QR no warnings");
  const sp = normalizeQrSpec({ content: { kind: "url", value: "https://a.co" }, modules: "dots", eyes: "leaf", logoHole: 99, eyeColor: "#FF0000", logo: "javascript:x" });
  ok(sp?.logoHole === 22 && sp.eyeColor === "#ff0000" && sp.logo === undefined && sp.modules === "dots", "spec normalized");
  return { passed, failed: failures.length, failures };
}
