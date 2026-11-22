/**
 * D263 S7 — business card builder (pure). Turns contact details + a style into
 * a ready front and back design (real text boxes, shapes, icons and a QR
 * contact card) that the owner then fine-tunes in the normal studio.
 */
import { defaultTextBox, pxForPt, type BannerDesign, type DesignPrint, type DesignTextBox } from "@/lib/cms/banner-design-core";
import { defaultElement, defaultIcon, type DesignElement } from "@/lib/cms/banner-elements-core";
import { BANNER_ICON_DATA } from "@/lib/cms/banner-icons-data";
import { printFontId } from "./print-type-core";
import type { QrSpec } from "./qr-design-core";

export type CardInfo = { name: string; title: string; company: string; phone: string; email: string; website: string; address: string; instagram: string; tagline: string };
export type CardStyle = "classic" | "bold" | "split" | "minimal" | "luxe";
export type CardBack = "contact-qr" | "menu-qr" | "logo" | "loyalty" | "blank";

export const CARD_STYLES: { id: CardStyle; label: string; bg: string; fg: string; accent: string; head: string; body: string }[] = [
  { id: "classic", label: "Classic green", bg: "#0f2a1a", fg: "#ffffff", accent: "#7ed957", head: "Montserrat", body: "Montserrat" },
  { id: "bold", label: "Bold street", bg: "#111111", fg: "#ffffff", accent: "#ffd700", head: "Bebas Neue", body: "Barlow Condensed" },
  { id: "split", label: "Split colour", bg: "#ffffff", fg: "#111111", accent: "#1f7a3a", head: "League Spartan", body: "Work Sans" },
  { id: "minimal", label: "Clean white", bg: "#fafaf7", fg: "#1a1a1a", accent: "#1f7a3a", head: "Outfit", body: "Outfit" },
  { id: "luxe", label: "Black & gold", bg: "#0b0b0b", fg: "#f5e6b8", accent: "#c9a227", head: "Cinzel", body: "Cormorant Garamond" },
];

export const CARD_BACKS: { id: CardBack; label: string }[] = [
  { id: "contact-qr", label: "QR that saves your contact" },
  { id: "menu-qr", label: "QR to the online menu" },
  { id: "loyalty", label: "Loyalty punch card (10 stamps)" },
  { id: "logo", label: "Big logo / brand only" },
  { id: "blank", label: "Blank back" },
];

export const DEFAULT_CARD_INFO: CardInfo = { name: "", title: "", company: "Greenway Marijuana", phone: "", email: "", website: "greenwaymarijuana.com", address: "", instagram: "", tagline: "21+ only" };

const icon = (id: string) => BANNER_ICON_DATA[id]?.regular?.[0] ?? "";
const withHttp = (u: string) => (/^https?:\/\//i.test(u) ? u : `https://${u.replace(/^\/+/, "")}`);

type Ctx = { print: DesignPrint; pt: (n: number) => number; s: (typeof CARD_STYLES)[number]; tall: boolean; ids: Set<string> };

function uid(c: Ctx, base: string): string {
  let id = base;
  let n = 2;
  while (c.ids.has(id)) id = `${base}-${n++}`;
  c.ids.add(id);
  return id;
}

function text(c: Ctx, role: DesignTextBox["role"], t: string, o: Partial<DesignTextBox> & { pt: number; head?: boolean }): DesignTextBox {
  const { pt, head, ...rest } = o;
  const size = c.pt(pt);
  return defaultTextBox(role, {
    id: uid(c, role),
    text: t,
    font: printFontId(head ? c.s.head : c.s.body),
    size,
    sizeMobile: size,
    color: c.s.fg,
    transform: "none",
    letterSpacing: 0,
    lineHeight: 1.25,
    wrap: "normal",
    ...rest,
  });
}

function rect(c: Ctx, o: Partial<DesignElement>): DesignElement {
  return defaultElement("rect", { id: uid(c, "panel"), x: 0, y: 0, w: 100, h: 100, fill: c.s.bg, radius: 0, ...o });
}

function contactLines(info: CardInfo): { icon: string; text: string }[] {
  const out: { icon: string; text: string }[] = [];
  if (info.phone.trim()) out.push({ icon: "phone", text: info.phone.trim() });
  if (info.email.trim()) out.push({ icon: "envelope", text: info.email.trim() });
  if (info.website.trim()) out.push({ icon: "globe", text: info.website.trim().replace(/^https?:\/\//i, "") });
  if (info.address.trim()) out.push({ icon: "map-pin", text: info.address.trim() });
  if (info.instagram.trim()) out.push({ icon: "instagram", text: info.instagram.trim().startsWith("@") ? info.instagram.trim() : `@${info.instagram.trim()}` });
  return out.slice(0, 5);
}

/** Inset (%) for the safe line on each axis. */
function insets(p: DesignPrint): { sx: number; sy: number } {
  const W = p.w + 2 * p.bleed;
  const H = p.h + 2 * p.bleed;
  return { sx: ((p.bleed + p.safe + 0.03) / W) * 100, sy: ((p.bleed + p.safe + 0.03) / H) * 100 };
}

function frontParts(c: Ctx, info: CardInfo): { boxes: DesignTextBox[]; els: DesignElement[] } {
  const { sx, sy } = insets(c.print);
  const els: DesignElement[] = [rect(c, { id: uid(c, "background") })];
  const boxes: DesignTextBox[] = [];
  const lines = contactLines(info);
  const st = c.s.id;
  if (st === "split") {
    const left = c.tall ? 100 : 38;
    els.push(rect(c, { fill: c.s.accent, w: left, h: c.tall ? 40 : 100 }));
    boxes.push(text(c, "headline", info.company || "Greenway", { pt: 11, head: true, weight: 800, color: "#ffffff", x: sx, y: sy + 4, w: (c.tall ? 100 : left) - 2 * sx, transform: "uppercase", letterSpacing: 0.04 }));
    if (info.tagline) boxes.push(text(c, "eyebrow", info.tagline, { pt: 6, color: "#ffffff", opacity: 85, x: sx, y: c.tall ? 30 : 100 - sy - 10, w: (c.tall ? 100 : left) - 2 * sx }));
  } else {
    if (st === "bold") els.push(rect(c, { fill: c.s.accent, w: 100, h: 6, y: 94 }));
    if (st === "luxe") els.push(rect(c, { fill: "transparent", fillOpacity: 0, stroke: c.s.accent, strokeWidth: 1, x: sx / 2, y: sy / 2, w: 100 - sx, h: 100 - sy }));
    if (st === "classic") els.push({ ...defaultIcon("leaf", "fill", BANNER_ICON_DATA.leaf?.fill?.[0] ?? icon("leaf"), { id: uid(c, "leaf"), x: c.tall ? 70 : 82, y: sy, w: c.tall ? 18 : 9, fill: c.s.accent, opacity: 90 }) });
  }
  const x0 = st === "split" && !c.tall ? 42 : sx;
  const w0 = 100 - x0 - sx;
  const nameY = st === "split" ? (c.tall ? 44 : sy + 4) : c.tall ? 34 : sy + (st === "minimal" ? 6 : 2);
  if (info.name) boxes.push(text(c, "headline", info.name, { pt: st === "bold" ? 18 : 13, head: true, weight: 800, x: x0, y: nameY, w: w0, color: st === "luxe" ? c.s.accent : c.s.fg, transform: st === "bold" || st === "luxe" ? "uppercase" : "none", letterSpacing: st === "luxe" ? 0.08 : 0 }));
  if (info.title) boxes.push(text(c, "subhead", info.title, { pt: 7.5, x: x0, y: nameY + (c.tall ? 9 : 17), w: w0, color: st === "split" || st === "minimal" ? c.s.accent : c.s.accent, weight: 600, transform: "uppercase", letterSpacing: 0.12 }));
  if (st !== "split" && info.company) boxes.push(text(c, "eyebrow", info.company, { pt: 7, head: true, x: x0, y: nameY + (c.tall ? 15 : 28), w: w0, weight: 700, opacity: 85 }));
  // Contact block: icon + line per item.
  const lh = c.tall ? 5.5 : 9.5;
  const startY = 100 - sy - lines.length * lh - (st === "bold" ? 7 : 1);
  const iconW = c.tall ? 6 : 3.4;
  lines.forEach((l, i) => {
    const y = startY + i * lh;
    els.push(defaultIcon(l.icon, "regular", icon(l.icon), { id: uid(c, `ic-${l.icon}`), x: x0, y: y + (c.tall ? 0.6 : 1), w: iconW, fill: c.s.accent }));
    boxes.push(text(c, "body", l.text, { pt: 6.5, x: x0 + iconW + 1.5, y, w: w0 - iconW - 1.5, wrap: "nowrap" }));
  });
  return { boxes, els };
}

function backParts(c: Ctx, info: CardInfo, back: CardBack): { boxes: DesignTextBox[]; els: DesignElement[] } {
  const { sx, sy } = insets(c.print);
  const dark = c.s.id === "minimal" || c.s.id === "split";
  const bg = dark ? c.s.accent : c.s.bg;
  const fg = dark ? "#ffffff" : c.s.fg;
  const els: DesignElement[] = [rect(c, { id: uid(c, "background"), fill: bg })];
  const boxes: DesignTextBox[] = [];
  if (back === "blank") return { boxes, els };
  const brand = info.company || "Greenway";
  if (back === "contact-qr" || back === "menu-qr") {
    const qrW = c.tall ? 52 : 30;
    const qr: QrSpec =
      back === "contact-qr"
        ? { content: { kind: "vcard", value: info.phone, name: info.name || brand, org: info.company, email: info.email, url: info.website ? withHttp(info.website) : undefined, address: info.address }, modules: "rounded", eyes: "rounded", logoHole: 0, plate: "#ffffff" }
        : { content: { kind: "url", value: info.website ? withHttp(info.website).replace(/\/$/, "") + "/menu" : "https://www.greenwaymarijuana.com/menu", utm: { source: "business-card", medium: "qr", campaign: "" } }, modules: "rounded", eyes: "rounded", logoHole: 0, plate: "#ffffff" };
    const qx = c.tall ? (100 - qrW) / 2 : 100 - sx - qrW;
    els.push({ ...defaultIcon("qr", "regular", "M0 0h256v256H0z", { id: uid(c, "qr"), x: qx, y: c.tall ? 14 : 50 - (qrW * ((c.print.w + 2 * c.print.bleed) / (c.print.h + 2 * c.print.bleed))) / 2, w: qrW, fill: "#000000" }), qr });
    const tx = c.tall ? sx : sx;
    const tw = c.tall ? 100 - 2 * sx : qx - sx - 4;
    boxes.push(text(c, "headline", brand, { pt: c.s.id === "bold" ? 16 : 12, head: true, weight: 800, color: fg, x: tx, y: c.tall ? 62 : 30, w: tw, align: c.tall ? "center" : "left", transform: c.s.id === "bold" || c.s.id === "luxe" ? "uppercase" : "none" }));
    boxes.push(text(c, "subhead", back === "contact-qr" ? "Scan to save my contact" : "Scan for today's menu", { pt: 7, color: fg, opacity: 85, x: tx, y: c.tall ? 72 : 52, w: tw, align: c.tall ? "center" : "left" }));
    if (info.tagline) boxes.push(text(c, "legal", info.tagline, { pt: 5.5, color: fg, opacity: 70, x: tx, y: 100 - sy - 8, w: tw, align: c.tall ? "center" : "left" }));
    return { boxes, els };
  }
  if (back === "loyalty") {
    boxes.push(text(c, "headline", `${brand} rewards`, { pt: 10, head: true, weight: 800, color: fg, x: sx, y: sy, w: 100 - 2 * sx, align: "center", transform: "uppercase", letterSpacing: 0.06 }));
    const cols = c.tall ? 2 : 5;
    const rows = c.tall ? 5 : 2;
    const W = c.print.w + 2 * c.print.bleed;
    const H = c.print.h + 2 * c.print.bleed;
    const areaTop = c.tall ? 18 : 30;
    const areaH = c.tall ? 64 : 48;
    const cellW = (100 - 2 * sx) / cols;
    const cellH = areaH / rows;
    const dIn = Math.min((cellW / 100) * W, (cellH / 100) * H) * 0.72;
    const dPct = (dIn / W) * 100;
    for (let r = 0; r < rows; r += 1)
      for (let k = 0; k < cols; k += 1)
        els.push(defaultElement("circle", { id: uid(c, "stamp"), x: sx + k * cellW + (cellW - dPct) / 2, y: areaTop + r * cellH + (cellH - (dIn / H) * 100) / 2, w: dPct, h: null, fill: "transparent", fillOpacity: 0, stroke: fg, strokeWidth: 1 }));
    boxes.push(text(c, "legal", "Get a stamp with every visit. Ask a budtender for details. 21+ only.", { pt: 5.5, color: fg, opacity: 80, x: sx, y: 100 - sy - 9, w: 100 - 2 * sx, align: "center" }));
    return { boxes, els };
  }
  // logo
  els.push({ ...defaultIcon("leaf", "fill", BANNER_ICON_DATA.leaf?.fill?.[0] ?? icon("leaf"), { id: uid(c, "leaf"), x: c.tall ? 35 : 42, y: c.tall ? 28 : 18, w: c.tall ? 30 : 16, fill: dark ? "#ffffff" : c.s.accent }) });
  boxes.push(text(c, "headline", brand, { pt: c.s.id === "bold" ? 20 : 14, head: true, weight: 800, color: fg, x: sx, y: c.tall ? 56 : 58, w: 100 - 2 * sx, align: "center", transform: "uppercase", letterSpacing: 0.06 }));
  if (info.tagline) boxes.push(text(c, "legal", info.tagline, { pt: 6, color: fg, opacity: 75, x: sx, y: c.tall ? 66 : 76, w: 100 - 2 * sx, align: "center" }));
  return { boxes, els };
}

/** Front + back designs for this card (based on `base`, which carries the print size). */
export function buildBusinessCard(base: BannerDesign, info: CardInfo, style: CardStyle, back: CardBack): { front: BannerDesign; back: BannerDesign } | null {
  const print = base.frame.print;
  if (!print) return null;
  const s = CARD_STYLES.find((x) => x.id === style) ?? CARD_STYLES[0];
  const mk = (parts: { boxes: DesignTextBox[]; els: DesignElement[] }): BannerDesign => {
    const d: BannerDesign = { ...base, overlay: { kind: "none", color: "#000000", opacity: 0, direction: "bottom" }, boxes: parts.boxes, buttons: [], elements: parts.els };
    delete d.order;
    delete d.smoke;
    return d;
  };
  const ctx = (): Ctx => ({ print, pt: (n) => Math.max(2, pxForPt(n, print)), s, tall: print.h > print.w * 1.2, ids: new Set() });
  return { front: mk(frontParts(ctx(), info)), back: mk(backParts(ctx(), info, back)) };
}

/** Warn-only card tips. */
export function cardTips(info: CardInfo): string[] {
  const out: string[] = [];
  if (!info.name.trim() && !info.company.trim()) out.push("Add a name or the company name.");
  if (!info.phone.trim() && !info.email.trim() && !info.website.trim()) out.push("Add at least one way to reach you (phone, email or website).");
  if (contactLines(info).length > 4) out.push("Five contact lines is a lot for a small card. Consider dropping one.");
  if (info.phone && info.phone.replace(/\D/g, "").length < 10) out.push("The phone number looks short. Include the area code.");
  if (info.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(info.email.trim())) out.push("The email address doesn't look complete.");
  return out;
}

export function __runBusinessCardTests(): { passed: number; failed: number; failures: string[] } {
  let passed = 0;
  const failures: string[] = [];
  const ok = (c: boolean, m: string) => (c ? passed++ : failures.push(m));
  const print: DesignPrint = { w: 3.5, h: 2, bleed: 0.055, safe: 0.125 };
  const base = { v: 1, enabled: true, frame: { height: 300, heightMobile: 300, radius: 0, card: { ratio: 1.71, ratioMobile: 1.71 }, print }, image: {}, overlay: {}, boxes: [], buttons: [] } as unknown as BannerDesign;
  const info: CardInfo = { ...DEFAULT_CARD_INFO, name: "Jordan Lee", title: "Store manager", phone: "(360) 555-0100", email: "jordan@greenwaymarijuana.com", instagram: "greenway" };
  for (const st of CARD_STYLES)
    for (const b of CARD_BACKS) {
      const r = buildBusinessCard(base, info, st.id, b.id)!;
      const all = [...r.front.boxes, ...r.back.boxes, ...(r.front.elements ?? []), ...(r.back.elements ?? [])];
      ok(all.every((x) => x.x >= 0 && x.x <= 100 && x.y >= 0 && x.y <= 100), `${st.id}/${b.id} inside`);
      const ids = [...r.front.boxes.map((x) => x.id), ...(r.front.elements ?? []).map((x) => x.id)];
      ok(new Set(ids).size === ids.length, `${st.id} unique ids`);
    }
  const r = buildBusinessCard(base, info, "classic", "contact-qr")!;
  ok(r.front.boxes.some((b) => b.text === "Jordan Lee") && r.front.boxes.some((b) => b.text === "@greenway"), "front text");
  ok((r.back.elements ?? []).some((e) => e.qr?.content.kind === "vcard"), "vcard qr");
  ok(r.front.boxes.every((b) => b.font.startsWith("gf:")), "print fonts");
  ok(cardTips({ ...DEFAULT_CARD_INFO, website: "", company: "" }).length === 2, "tips");
  const tall = buildBusinessCard({ ...base, frame: { ...base.frame, print: { ...print, w: 2, h: 3.5 } } }, info, "bold", "loyalty")!;
  ok((tall.back.elements ?? []).filter((e) => e.shape === "circle").length === 10, "10 stamps");
  ok(buildBusinessCard({ ...base, frame: { ...base.frame, print: undefined } }, info, "classic", "blank") === null, "needs print");
  return { passed, failed: failures.length, failures };
}
