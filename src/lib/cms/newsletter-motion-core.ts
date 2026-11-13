/**
 * src/lib/cms/newsletter-motion-core.ts
 *
 * D238 N-8c (SOP-22 G-118): moving and interactive pieces for the newsletter
 * canvas. Pure (no I/O) so the self-test covers it.
 *
 * Owner (D238): "I want to be able to use moving elements, interactive
 * elements, other types of advanced marketing techniques."
 *
 * Email cannot run scripts, so:
 *   - MOVING = animated GIFs. (1) The GIF maker joins 2-10 pictures into a
 *     slideshow GIF. (2) The live countdown is a GIF drawn by our server at
 *     the moment the email is opened, so it always shows the time left.
 *     Outlook for Windows shows only the first frame, which is why the
 *     countdown's first frame is the real time left and the GIF maker puts
 *     your first picture first.
 *   - INTERACTIVE = links that count. A poll block shows 2-4 answers as
 *     buttons; each answer is a link tagged `utm_content=<block>-o<n>`, so a
 *     tap is a vote. Every other block's links carry `utm_content=<block>`,
 *     so the click report shows which section people tapped.
 *
 * The countdown digits are drawn as seven-segment shapes (no fonts needed on
 * the server).
 */
import type { CanvasDoc } from "./newsletter-canvas-core";

// ── Countdown ───────────────────────────────────────────────────────────────

export const COUNTDOWN_W = 520;
export const COUNTDOWN_H = 110;
/** One minute of seconds per GIF; it then stops on the last frame. */
export const COUNTDOWN_FRAMES = 60;
/** Furthest a countdown may end (one year), so the URL cannot be abused. */
export const COUNTDOWN_MAX_AHEAD_SEC = 366 * 24 * 3600;
export const COUNTDOWN_TZ = "America/Los_Angeles";

export type CountdownParts = { d: number; h: number; m: number; s: number };

export function splitRemaining(sec: number): CountdownParts {
  const t = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0));
  const d = Math.min(99, Math.floor(t / 86400));
  if (t >= 100 * 86400) return { d: 99, h: 23, m: 59, s: 59 };
  return { d, h: Math.floor((t % 86400) / 3600), m: Math.floor((t % 3600) / 60), s: t % 60 };
}

/** Seconds shown in each frame: now, now-1, ... and stops at 0 (fewer frames near the end). */
export function countdownFrameSeconds(remaining: number, frames = COUNTDOWN_FRAMES): number[] {
  const r = Math.max(0, Math.floor(remaining));
  const out: number[] = [];
  for (let i = 0; i < frames; i++) {
    out.push(Math.max(0, r - i));
    if (r - i <= 0) break;
  }
  return out;
}

// Segments a..g of a seven-segment digit.
const SEGS: Record<string, string> = {
  "0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc", "5": "afgcd", "6": "afgedc", "7": "abc", "8": "abcdefg", "9": "abcdfg",
};

function digitSvg(ch: string, x: number, y: number, w: number, h: number, t: number, on: string, off: string): string {
  const lit = SEGS[ch] ?? "";
  const half = (h - t) / 2;
  const rects: Record<string, [number, number, number, number]> = {
    a: [x + t, y, w - 2 * t, t],
    b: [x + w - t, y + t, t, half - t],
    c: [x + w - t, y + half + t, t, half - t],
    d: [x + t, y + h - t, w - 2 * t, t],
    e: [x, y + half + t, t, half - t],
    f: [x, y + t, t, half - t],
    g: [x + t, y + half, w - 2 * t, t],
  };
  return Object.entries(rects)
    .map(([k, [rx, ry, rw, rh]]) => `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" rx="${t / 2}" fill="${lit.includes(k) ? on : off}"/>`)
    .join("");
}

export type CountdownTheme = "dark" | "light";
const CD_COLORS: Record<CountdownTheme, { bg: string; on: string; off: string; colon: string }> = {
  dark: { bg: "#0f0f0f", on: "#7ed957", off: "#1c1c1c", colon: "#ffd700" },
  light: { bg: "#ffffff", on: "#2f7d16", off: "#ececec", colon: "#8a6d00" },
};

/** One countdown frame (DD:HH:MM:SS) as SVG. */
export function countdownSvg(sec: number, theme: CountdownTheme): string {
  const p = splitRemaining(sec);
  const c = CD_COLORS[theme] ?? CD_COLORS.dark;
  const pad = (n: number) => String(n).padStart(2, "0");
  const groups = [pad(p.d), pad(p.h), pad(p.m), pad(p.s)];
  const dw = 44;
  const dh = 76;
  const t = 8;
  const gap = 10;
  const colonW = 26;
  const groupW = dw * 2 + gap;
  const total = groupW * 4 + colonW * 3;
  let x = Math.round((COUNTDOWN_W - total) / 2);
  const y = Math.round((COUNTDOWN_H - dh) / 2);
  let body = "";
  groups.forEach((g, gi) => {
    body += digitSvg(g[0], x, y, dw, dh, t, c.on, c.off);
    body += digitSvg(g[1], x + dw + gap, y, dw, dh, t, c.on, c.off);
    x += groupW;
    if (gi < 3) {
      const cx = x + colonW / 2;
      body += `<circle cx="${cx}" cy="${y + dh * 0.3}" r="4.5" fill="${c.colon}"/><circle cx="${cx}" cy="${y + dh * 0.7}" r="4.5" fill="${c.colon}"/>`;
      x += colonW;
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${COUNTDOWN_W}" height="${COUNTDOWN_H}" viewBox="0 0 ${COUNTDOWN_W} ${COUNTDOWN_H}"><rect width="100%" height="100%" rx="14" fill="${c.bg}"/>${body}</svg>`;
}

/** Validate the countdown image query (?e=<end epoch seconds>&th=d|l). */
export function parseCountdownQuery(q: { e?: string | null; th?: string | null }, nowSec: number): { endSec: number; theme: CountdownTheme } | null {
  const e = Number(q.e);
  if (!Number.isInteger(e) || e < 1_577_836_800 || e > nowSec + COUNTDOWN_MAX_AHEAD_SEC) return null;
  return { endSec: e, theme: q.th === "l" ? "light" : "dark" };
}

/** The countdown picture link for an end time (ISO). Empty when the time is not valid. */
export function countdownImageUrl(siteUrl: string, endsAtIso: string, theme: CountdownTheme): string {
  const ms = Date.parse(endsAtIso);
  if (!Number.isFinite(ms)) return "";
  return `${siteUrl.replace(/\/$/, "")}/api/newsletter/countdown?e=${Math.floor(ms / 1000)}&th=${theme === "light" ? "l" : "d"}`;
}

/** "Sat, Nov 15, 8:00 PM" in store time. */
export function formatEndsAt(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone: COUNTDOWN_TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(ms));
}

// ── GIF maker ──────────────────────────────────────────────────────────────

export const GIF_MIN_FRAMES = 2;
export const GIF_MAX_FRAMES = 10;
export const GIF_SHAPES = [
  { key: "wide", label: "Wide (3:2)", ratio: 2 / 3 },
  { key: "banner", label: "Banner (2:1)", ratio: 1 / 2 },
  { key: "square", label: "Square", ratio: 1 },
] as const;
export type GifShapeKey = (typeof GIF_SHAPES)[number]["key"];

export type GifPlan = { ok: true; width: number; height: number; delayMs: number; colours: number; frames: number } | { ok: false; error: string };

/** Check the GIF maker settings and work out the size. */
export function planGifBuild(p: { frames: number; width: number; seconds: number; shape: string }): GifPlan {
  const frames = Math.floor(p.frames);
  if (!(frames >= GIF_MIN_FRAMES)) return { ok: false, error: `Pick at least ${GIF_MIN_FRAMES} pictures.` };
  if (frames > GIF_MAX_FRAMES) return { ok: false, error: `Pick at most ${GIF_MAX_FRAMES} pictures (more makes the email slow).` };
  const width = Math.min(600, Math.max(200, Math.round(Number(p.width) || 600)));
  const seconds = Math.min(5, Math.max(0.3, Number(p.seconds) || 1.5));
  const shape = GIF_SHAPES.find((s) => s.key === p.shape) ?? GIF_SHAPES[0];
  return { ok: true, width, height: Math.round(width * shape.ratio), delayMs: Math.round(seconds * 1000), colours: frames > 6 ? 96 : 128, frames };
}

/** When a built GIF is too heavy, the next try (fewer colours, then narrower), or null to give up. */
export function gifRetry(bytes: number, limit: number, plan: { width: number; height: number; colours: number }): { width: number; height: number; colours: number } | null {
  if (bytes <= limit) return null;
  if (plan.colours > 48) return { ...plan, colours: Math.max(48, Math.floor(plan.colours / 2)) };
  if (plan.width > 320) {
    const width = Math.max(320, Math.round(plan.width * 0.75));
    return { width, height: Math.round((plan.height * width) / plan.width), colours: plan.colours };
  }
  return null;
}

// ── Poll + click report ────────────────────────────────────────────────────

export const POLL_MIN_OPTIONS = 2;
export const POLL_MAX_OPTIONS = 4;

/** utm_content value for a poll answer. */
export function pollContent(blockId: string, option: number): string {
  return `${blockId}-o${option}`;
}

/** Which block (and poll answer) a clicked link belongs to, from its utm_content. */
export function blockOfUrl(url: string): { blockId: string; option: number | null } | null {
  try {
    const c = new URL(url).searchParams.get("utm_content");
    if (!c) return null;
    const m = /^(.+)-o([1-9])$/.exec(c);
    return m ? { blockId: m[1], option: Number(m[2]) } : { blockId: c, option: null };
  } catch {
    return null;
  }
}

export type ClickEvent = { url: string | null; recipient: string };
export type ClickRow = { blockId: string; label: string; clicks: number; people: number; options: { label: string; votes: number; people: number }[] };
export type ClickReport = { totalClicks: number; people: number; rows: ClickRow[]; unsubscribes: number; otherClicks: number };

function blockLabel(b: CanvasDoc["blocks"][number]): string {
  switch (b.type) {
    case "headline": return `Headline: ${b.text}`.slice(0, 80);
    case "text": return `Text: ${b.text}`.slice(0, 80);
    case "image": return `Picture: ${b.alt || b.caption || "image"}`.slice(0, 80);
    case "button": return `Button: ${b.label}`;
    case "qr": return `QR code: ${b.caption || b.url}`.slice(0, 80);
    case "cards": return `Cards: ${b.heading}`;
    case "countdown": return `Countdown: ${b.label || "timer"}`;
    case "poll": return `Poll: ${b.question}`.slice(0, 80);
    case "design": return `Design: ${b.alt || "picture"}`.slice(0, 80);
    default: return b.type;
  }
}

/** Clicks per section (and votes per poll answer) for one newsletter. */
export function canvasClickReport(doc: CanvasDoc, events: ClickEvent[]): ClickReport {
  const byBlock = new Map<string, { clicks: number; people: Set<string>; opt: Map<number, { votes: number; people: Set<string> }> }>();
  const everyone = new Set<string>();
  let unsubscribes = 0;
  let otherClicks = 0;
  let totalClicks = 0;
  const ids = new Set(doc.blocks.map((b) => b.id));
  for (const e of events) {
    if (!e.url) continue;
    totalClicks++;
    const who = e.recipient.toLowerCase();
    everyone.add(who);
    if (/\/unsubscribe\b/i.test(e.url)) {
      unsubscribes++;
      continue;
    }
    const hit = blockOfUrl(e.url);
    if (!hit || !ids.has(hit.blockId)) {
      otherClicks++;
      continue;
    }
    const row = byBlock.get(hit.blockId) ?? { clicks: 0, people: new Set<string>(), opt: new Map() };
    row.clicks++;
    row.people.add(who);
    if (hit.option !== null) {
      const o = row.opt.get(hit.option) ?? { votes: 0, people: new Set<string>() };
      o.votes++;
      o.people.add(who);
      row.opt.set(hit.option, o);
    }
    byBlock.set(hit.blockId, row);
  }
  const rows: ClickRow[] = [];
  for (const b of doc.blocks) {
    const r = byBlock.get(b.id);
    if (!r && b.type !== "poll") continue;
    const options = b.type === "poll" ? b.options.map((label, i) => ({ label, votes: r?.opt.get(i + 1)?.votes ?? 0, people: r?.opt.get(i + 1)?.people.size ?? 0 })) : [];
    rows.push({ blockId: b.id, label: blockLabel(b), clicks: r?.clicks ?? 0, people: r?.people.size ?? 0, options });
  }
  rows.sort((a, b) => b.clicks - a.clicks);
  return { totalClicks, people: everyone.size, rows, unsubscribes, otherClicks };
}

// ── Self-test ──────────────────────────────────────────────────────────────

export function __runNewsletterMotionCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (name: string, cond: boolean) => {
    if (cond) passed++;
    else {
      failed++;
      console.log(`FAIL newsletter-motion-core: ${name}`);
    }
  };
  const sp = splitRemaining(90061);
  ok("split d/h/m/s", sp.d === 1 && sp.h === 1 && sp.m === 1 && sp.s === 1);
  ok("split negative is zero", JSON.stringify(splitRemaining(-5)) === JSON.stringify({ d: 0, h: 0, m: 0, s: 0 }));
  ok("split NaN is zero", splitRemaining(Number.NaN).s === 0);
  ok("split caps at 99 days", splitRemaining(200 * 86400).d === 99 && splitRemaining(200 * 86400).s === 59);
  ok("frames: 60", countdownFrameSeconds(1000).length === 60);
  ok("frames count down", countdownFrameSeconds(1000)[1] === 999);
  ok("frames stop at zero", JSON.stringify(countdownFrameSeconds(2)) === "[2,1,0]");
  ok("frames ended: one frame", JSON.stringify(countdownFrameSeconds(-30)) === "[0]");
  const svg = countdownSvg(3723, "dark");
  ok("svg size", svg.includes(`width="${COUNTDOWN_W}"`) && svg.includes(`height="${COUNTDOWN_H}"`));
  ok("svg no text (no fonts needed)", !svg.includes("<text"));
  ok("svg 8 digits x 7 segments", (svg.match(/<rect x=/g) ?? []).length === 56);
  ok("svg colons", (svg.match(/<circle/g) ?? []).length === 6);
  ok("svg lit colour", svg.includes("#7ed957"));
  ok("svg light theme", countdownSvg(5, "light").includes("#2f7d16"));
  // 00:01:02:03 -> lit segments: 0(6)+0(6) + 0(6)+1(2) + 0(6)+2(5) + 0(6)+3(5) = 42
  ok("svg lit count", (svg.match(/fill="#7ed957"/g) ?? []).length === 42);
  const now = 1_800_000_000;
  ok("query ok", parseCountdownQuery({ e: String(now + 3600), th: "l" }, now)?.theme === "light");
  ok("query default dark", parseCountdownQuery({ e: String(now + 10) }, now)?.theme === "dark");
  ok("query rejects text", parseCountdownQuery({ e: "abc" }, now) === null);
  ok("query rejects far future", parseCountdownQuery({ e: String(now + COUNTDOWN_MAX_AHEAD_SEC + 10) }, now) === null);
  ok("query rejects ancient", parseCountdownQuery({ e: "100" }, now) === null);
  ok("query rejects decimals", parseCountdownQuery({ e: "1800000000.5" }, now) === null);
  ok("query allows ended", parseCountdownQuery({ e: String(now - 100) }, now) !== null);
  const u = countdownImageUrl("https://www.greenwaymarijuana.com/", "2027-01-01T08:00:00.000Z", "dark");
  ok("image url", u === "https://www.greenwaymarijuana.com/api/newsletter/countdown?e=1798790400&th=d");
  ok("image url bad date", countdownImageUrl("https://x.example", "nope", "dark") === "");
  ok("format ends in PT", formatEndsAt("2027-01-01T08:00:00.000Z").includes("12:00"));
  ok("format bad", formatEndsAt("") === "");
  // GIF plan
  const g = planGifBuild({ frames: 3, width: 600, seconds: 1.5, shape: "wide" });
  ok("gif plan ok", g.ok && g.width === 600 && g.height === 400 && g.delayMs === 1500 && g.colours === 128);
  ok("gif too few", !planGifBuild({ frames: 1, width: 600, seconds: 1, shape: "wide" }).ok);
  ok("gif too many", !planGifBuild({ frames: 11, width: 600, seconds: 1, shape: "wide" }).ok);
  const g2 = planGifBuild({ frames: 8, width: 9999, seconds: 99, shape: "square" });
  ok("gif clamps", g2.ok && g2.width === 600 && g2.height === 600 && g2.delayMs === 5000 && g2.colours === 96);
  const g3 = planGifBuild({ frames: 2, width: 10, seconds: 0, shape: "banner" });
  ok("gif min width + default seconds", g3.ok && g3.width === 200 && g3.height === 100 && g3.delayMs === 1500);
  ok("gif retry none when light", gifRetry(100, 200, { width: 600, height: 400, colours: 128 }) === null);
  ok("gif retry colours", gifRetry(300, 200, { width: 600, height: 400, colours: 128 })?.colours === 64);
  const r2 = gifRetry(300, 200, { width: 600, height: 400, colours: 48 });
  ok("gif retry width", r2?.width === 450 && r2?.height === 300);
  ok("gif retry give up", gifRetry(300, 200, { width: 320, height: 213, colours: 48 }) === null);
  // Click report
  ok("blockOf block", JSON.stringify(blockOfUrl("https://x.example/a?utm_content=btn1")) === JSON.stringify({ blockId: "btn1", option: null }));
  ok("blockOf poll", JSON.stringify(blockOfUrl("https://x.example/a?utm_content=poll1-o2")) === JSON.stringify({ blockId: "poll1", option: 2 }));
  ok("blockOf none", blockOfUrl("https://x.example/a") === null);
  ok("blockOf junk", blockOfUrl("not a url") === null);
  ok("pollContent", pollContent("p", 3) === "p-o3");
  const doc = {
    version: 1,
    subject: "s",
    preheader: "",
    theme: "dark",
    useForEmail: true,
    blocks: [
      { id: "btn1", type: "button", label: "Shop", href: "https://x.example", color: "accent" },
      { id: "poll1", type: "poll", question: "Next?", options: ["Gummies", "Pre-rolls"], href: "" },
      { id: "t1", type: "text", text: "hi", align: "left" },
    ],
  } as unknown as CanvasDoc;
  const rep = canvasClickReport(doc, [
    { url: "https://x.example/?utm_content=btn1", recipient: "A@x.com" },
    { url: "https://x.example/?utm_content=btn1", recipient: "a@x.com" },
    { url: "https://x.example/?utm_content=btn1", recipient: "b@x.com" },
    { url: "https://x.example/?utm_content=poll1-o2", recipient: "a@x.com" },
    { url: "https://x.example/unsubscribe?token=1", recipient: "c@x.com" },
    { url: "https://other.example/", recipient: "d@x.com" },
    { url: null, recipient: "e@x.com" },
  ]);
  ok("report total", rep.totalClicks === 6);
  ok("report people", rep.people === 4);
  ok("report unsub", rep.unsubscribes === 1);
  ok("report other", rep.otherClicks === 1);
  ok("report top row", rep.rows[0].blockId === "btn1" && rep.rows[0].clicks === 3 && rep.rows[0].people === 2);
  const poll = rep.rows.find((r) => r.blockId === "poll1");
  ok("report poll votes", poll?.options[1].votes === 1 && poll?.options[0].votes === 0);
  ok("report poll shown even with no votes", canvasClickReport(doc, []).rows.some((r) => r.blockId === "poll1"));
  ok("report skips unclicked blocks", !rep.rows.some((r) => r.blockId === "t1"));
  ok("report unknown block counts as other", canvasClickReport(doc, [{ url: "https://x.example/?utm_content=gone", recipient: "a" }]).otherClicks === 1);
  return { passed, failed };
}
