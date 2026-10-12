/**
 * R47-S2 — first-party banner / button click analytics (pure core).
 *
 * Michael asked for "clicks and reports": which home slides, shop banners
 * and buttons customers actually press. Clicks are stored in OUR database
 * (website_click_events, migration 0268) so the numbers are available even
 * when GA4 is not configured, and GA4 gets the standard `select_promotion`
 * event as well when it is.
 *
 * Privacy: no cookies, no IP address, no user id, no query strings. A row is
 * "someone on a phone pressed 'Shop now' on the Black Friday slide on /".
 * Visitors with Global Privacy Control on and the private no-track pages
 * send nothing (enforced in the client tracker and again here on the path).
 *
 * Everything below is pure so it is self-tested without a database.
 */
import { isNoTrackPath } from "@/lib/analytics/no-track-paths";

export const CLICK_PLACEMENTS = [
  "home_hero",
  "shop_banner",
  "specials_hero",
  "loyalty_hero",
  "section",
  "other",
] as const;
export type ClickPlacement = (typeof CLICK_PLACEMENTS)[number];

export const CLICK_DEVICES = ["phone", "tablet", "desktop"] as const;
export type ClickDevice = (typeof CLICK_DEVICES)[number];

/** Friendly names for the report. */
export const PLACEMENT_LABELS: Record<ClickPlacement, string> = {
  home_hero: "Home carousel",
  shop_banner: "Shop banner",
  specials_hero: "Specials top banner",
  loyalty_hero: "Loyalty top banner",
  section: "Page banner",
  other: "Other",
};

/** Column caps — identical to the CHECK constraint in migration 0268. */
export const CLICK_LIMITS = {
  page_path: 300,
  slot_key: 120,
  slot_label: 160,
  button_label: 120,
  target_href: 500,
  maxPosition: 99,
} as const;

export type ClickEventRow = {
  page_path: string;
  placement: ClickPlacement;
  slot_key: string | null;
  slot_label: string | null;
  slot_position: number | null;
  button_label: string | null;
  target_href: string | null;
  device: ClickDevice;
};

/** Phone below 768 px (Tailwind md), tablet below 1024 px (lg), else desktop. */
export function deviceFromWidth(width: unknown): ClickDevice {
  const w = typeof width === "number" && Number.isFinite(width) ? width : 1280;
  if (w < 768) return "phone";
  if (w < 1024) return "tablet";
  return "desktop";
}

function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  // Collapse whitespace, drop control characters.
  const t = v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
}

/** Path only: no query string or #hash (they can carry personal data). */
export function cleanClickPath(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const raw = v.trim();
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  const path = raw.split(/[?#]/)[0] || "/";
  if (path.length > CLICK_LIMITS.page_path) return null;
  return path;
}

/**
 * Where the button goes. Site links keep the path only; outside links keep
 * origin + path (never a query string, which may hold tracking ids or email
 * addresses). tel:/mailto: are reduced to the scheme.
 */
export function cleanTargetHref(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const raw = v.trim();
  if (!raw) return null;
  if (/^tel:/i.test(raw)) return "tel:";
  if (/^mailto:/i.test(raw)) return "mailto:";
  if (raw.startsWith("/") && !raw.startsWith("//")) {
    const p = raw.split(/[?#]/)[0] || "/";
    return p.slice(0, CLICK_LIMITS.target_href);
  }
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return `${u.origin}${u.pathname}`.slice(0, CLICK_LIMITS.target_href);
  } catch {
    return null;
  }
}

/**
 * Validate an untrusted beacon body into a row, or null to drop it. Never
 * throws. Admin pages and no-track pages are always dropped.
 */
export function normalizeClickEvent(raw: unknown): ClickEventRow | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const page_path = cleanClickPath(r.page_path);
  if (!page_path) return null;
  if (isNoTrackPath(page_path)) return null;
  if (page_path === "/admin" || page_path.startsWith("/admin/")) return null;
  const placement = (CLICK_PLACEMENTS as readonly string[]).includes(String(r.placement))
    ? (r.placement as ClickPlacement)
    : null;
  if (!placement) return null;
  const device = (CLICK_DEVICES as readonly string[]).includes(String(r.device))
    ? (r.device as ClickDevice)
    : "desktop";
  let slot_position: number | null = null;
  const pos = typeof r.slot_position === "string" ? Number(r.slot_position) : r.slot_position;
  if (typeof pos === "number" && Number.isInteger(pos) && pos >= 0 && pos <= CLICK_LIMITS.maxPosition) {
    slot_position = pos;
  }
  return {
    page_path,
    placement,
    slot_key: cleanText(r.slot_key, CLICK_LIMITS.slot_key),
    slot_label: cleanText(r.slot_label, CLICK_LIMITS.slot_label),
    slot_position,
    button_label: cleanText(r.button_label, CLICK_LIMITS.button_label),
    target_href: cleanTargetHref(r.target_href),
    device,
  };
}

/**
 * data-* attributes a banner puts on its outer element so the one global
 * click listener knows which slide a pressed button belongs to.
 */
export function clickZoneAttrs(zone: {
  place: ClickPlacement;
  slot?: string | null;
  label?: string | null;
  position?: number | null;
}): Record<string, string> {
  const out: Record<string, string> = { "data-gw-place": zone.place };
  if (zone.slot) out["data-gw-slot"] = zone.slot.slice(0, CLICK_LIMITS.slot_key);
  if (zone.label) out["data-gw-label"] = zone.label.slice(0, CLICK_LIMITS.slot_label);
  if (typeof zone.position === "number") out["data-gw-pos"] = String(zone.position);
  return out;
}

// ---------------------------------------------------------------------------
// Report summaries
// ---------------------------------------------------------------------------

export type StoredClick = ClickEventRow & { occurred_at: string };

export type CountRow = { label: string; value: number };

export type SlotSummary = {
  placement: ClickPlacement;
  slotKey: string;
  label: string;
  clicks: number;
};

export type ClickSummary = {
  total: number;
  byDevice: Record<ClickDevice, number>;
  byPlacement: CountRow[];
  topSlots: SlotSummary[];
  topButtons: CountRow[];
  byPage: CountRow[];
  daily: { date: string; value: number }[];
};

/** YYYY-MM-DD in Pacific time (the shop's day). */
export function pacificDay(iso: string | number | Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function topN(map: Map<string, number>, n: number): CountRow[] {
  return Array.from(map.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
    .slice(0, n);
}

/**
 * Summarise stored clicks for the report. `endMs` and `days` define the
 * daily series (one bar per Pacific day, zero-filled).
 */
export function summarizeClicks(rows: StoredClick[], days: number, endMs: number): ClickSummary {
  const byDevice: Record<ClickDevice, number> = { phone: 0, tablet: 0, desktop: 0 };
  const placement = new Map<string, number>();
  const slots = new Map<string, SlotSummary>();
  const buttons = new Map<string, number>();
  const pages = new Map<string, number>();
  const perDay = new Map<string, number>();
  for (const r of rows) {
    byDevice[r.device] = (byDevice[r.device] ?? 0) + 1;
    const pl = PLACEMENT_LABELS[r.placement] ?? r.placement;
    placement.set(pl, (placement.get(pl) ?? 0) + 1);
    const slotKey = r.slot_key ?? "(unnamed)";
    const k = `${r.placement}|${slotKey}`;
    const s = slots.get(k);
    if (s) {
      s.clicks += 1;
      // Keep the most recent non-empty name the owner gave it.
      if (r.slot_label) s.label = r.slot_label;
    } else {
      slots.set(k, {
        placement: r.placement,
        slotKey,
        label: r.slot_label || slotKey,
        clicks: 1,
      });
    }
    const b = `${r.button_label || "(no words)"} → ${r.target_href || "?"}`;
    buttons.set(b, (buttons.get(b) ?? 0) + 1);
    pages.set(r.page_path, (pages.get(r.page_path) ?? 0) + 1);
    const day = pacificDay(r.occurred_at);
    if (day) perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }
  const daily: { date: string; value: number }[] = [];
  const seen = new Set<string>();
  const n = Math.max(1, Math.min(366, Math.floor(days)));
  for (let i = n - 1; i >= 0; i -= 1) {
    const date = pacificDay(endMs - i * 86_400_000);
    if (!date || seen.has(date)) continue;
    seen.add(date);
    daily.push({ date, value: perDay.get(date) ?? 0 });
  }
  return {
    total: rows.length,
    byDevice,
    byPlacement: topN(placement, 10),
    topSlots: Array.from(slots.values())
      .sort((a, b) => b.clicks - a.clicks || a.label.localeCompare(b.label))
      .slice(0, 15),
    topButtons: topN(buttons, 15),
    byPage: topN(pages, 15),
    daily,
  };
}

export type LiveSlot = { placement: ClickPlacement; slotKey: string; label: string; hasButtons: boolean };

/**
 * Live slides that have buttons but got no clicks in the period ("dead
 * banners"). Slides with no buttons cannot be clicked, so they are skipped.
 */
export function deadSlots(live: LiveSlot[], rows: StoredClick[]): LiveSlot[] {
  const clicked = new Set(rows.map((r) => `${r.placement}|${r.slot_key ?? ""}`));
  return live.filter((s) => s.hasButtons && !clicked.has(`${s.placement}|${s.slotKey}`));
}

/** Range picker values for the report (days). */
export const CLICK_RANGES = [7, 30, 90] as const;
export function parseClickRange(v: unknown): (typeof CLICK_RANGES)[number] {
  const n = Number(v);
  return (CLICK_RANGES as readonly number[]).includes(n) ? (n as (typeof CLICK_RANGES)[number]) : 30;
}

/** The report window: now and the start of the period (clock read here). */
export function clickReportWindow(days: number, nowMs: number = Date.now()): { nowMs: number; sinceIso: string } {
  return { nowMs, sinceIso: new Date(nowMs - days * 86_400_000).toISOString() };
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runClickEventsTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, label: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`[click-events-core] FAIL: ${label}`);
    }
  };
  const base = {
    page_path: "/",
    placement: "home_hero",
    slot_key: "slide-1",
    slot_label: "Black Friday",
    slot_position: 0,
    button_label: "Shop now",
    target_href: "/menu?sale=1",
    device: "phone",
  };

  // deviceFromWidth
  ok(deviceFromWidth(375) === "phone", "375 phone");
  ok(deviceFromWidth(767) === "phone", "767 phone");
  ok(deviceFromWidth(768) === "tablet", "768 tablet");
  ok(deviceFromWidth(1023) === "tablet", "1023 tablet");
  ok(deviceFromWidth(1024) === "desktop", "1024 desktop");
  ok(deviceFromWidth(undefined) === "desktop", "unknown desktop");
  ok(deviceFromWidth(Number.NaN) === "desktop", "NaN desktop");

  // normalize
  const n = normalizeClickEvent(base);
  ok(!!n && n.placement === "home_hero" && n.device === "phone", "valid row");
  ok(n?.target_href === "/menu", "query stripped from site href");
  ok(normalizeClickEvent(null) === null, "null dropped");
  ok(normalizeClickEvent([]) === null, "array dropped");
  ok(normalizeClickEvent("x") === null, "string dropped");
  ok(normalizeClickEvent({ ...base, placement: "evil" }) === null, "bad placement dropped");
  ok(normalizeClickEvent({ ...base, page_path: "menu" }) === null, "relative path dropped");
  ok(normalizeClickEvent({ ...base, page_path: "//evil.com/x" }) === null, "protocol-relative dropped");
  ok(normalizeClickEvent({ ...base, page_path: "/vendor-ach/SECRET" }) === null, "no-track path dropped");
  ok(normalizeClickEvent({ ...base, page_path: "/admin/pages/home" }) === null, "admin dropped");
  ok(normalizeClickEvent({ ...base, page_path: "/admin" }) === null, "admin root dropped");
  ok(normalizeClickEvent({ ...base, page_path: "/administrator" }) !== null, "look-alike kept");
  ok(normalizeClickEvent({ ...base, page_path: "/menu?email=a@b.c#x" })?.page_path === "/menu", "page query stripped");
  ok(normalizeClickEvent({ ...base, page_path: "/" + "a".repeat(400) }) === null, "overlong path dropped");
  ok(normalizeClickEvent({ ...base, device: "fridge" })?.device === "desktop", "bad device -> desktop");
  ok(normalizeClickEvent({ ...base, slot_position: 100 })?.slot_position === null, "position > 99 -> null");
  ok(normalizeClickEvent({ ...base, slot_position: -1 })?.slot_position === null, "negative position -> null");
  ok(normalizeClickEvent({ ...base, slot_position: 1.5 })?.slot_position === null, "fractional position -> null");
  ok(normalizeClickEvent({ ...base, slot_position: "3" })?.slot_position === 3, "string position parsed");
  ok(normalizeClickEvent({ ...base, slot_label: "x".repeat(500) })?.slot_label?.length === 160, "label capped 160");
  ok(normalizeClickEvent({ ...base, button_label: "x".repeat(500) })?.button_label?.length === 120, "button capped 120");
  ok(normalizeClickEvent({ ...base, slot_key: "k".repeat(500) })?.slot_key?.length === 120, "slot key capped 120");
  ok(normalizeClickEvent({ ...base, button_label: "  Shop\n\tnow  " })?.button_label === "Shop now", "whitespace collapsed");
  ok(normalizeClickEvent({ ...base, button_label: "   " })?.button_label === null, "blank -> null");
  ok(normalizeClickEvent({ ...base, button_label: 5 })?.button_label === null, "non-string -> null");

  // hrefs
  ok(cleanTargetHref("https://leafly.com/x?utm=1") === "https://leafly.com/x", "outside query stripped");
  ok(cleanTargetHref("tel:+13605551212") === "tel:", "tel reduced");
  ok(cleanTargetHref("mailto:a@b.c") === "mailto:", "mailto reduced");
  ok(cleanTargetHref("javascript:alert(1)") === null, "javascript dropped");
  ok(cleanTargetHref("//evil.com") === null, "protocol-relative href dropped");
  ok(cleanTargetHref("") === null, "empty href null");
  ok(cleanTargetHref("/x#top") === "/x", "hash stripped");

  // zone attrs
  const z = clickZoneAttrs({ place: "shop_banner", slot: "s1", label: "Sale", position: 2 });
  ok(z["data-gw-place"] === "shop_banner" && z["data-gw-slot"] === "s1" && z["data-gw-label"] === "Sale" && z["data-gw-pos"] === "2", "zone attrs");
  ok(!("data-gw-slot" in clickZoneAttrs({ place: "other" })), "zone attrs omit empty");
  ok(clickZoneAttrs({ place: "other", position: 0 })["data-gw-pos"] === "0", "position 0 kept");

  // summaries
  const end = Date.parse("2026-03-10T20:00:00Z");
  const rows: StoredClick[] = [
    { ...(normalizeClickEvent(base) as ClickEventRow), occurred_at: "2026-03-10T19:00:00Z" },
    { ...(normalizeClickEvent(base) as ClickEventRow), occurred_at: "2026-03-09T19:00:00Z" },
    {
      ...(normalizeClickEvent({ ...base, placement: "shop_banner", slot_key: "s2", slot_label: "4/20", device: "desktop", page_path: "/menu" }) as ClickEventRow),
      occurred_at: "2026-03-10T18:00:00Z",
    },
  ];
  const s = summarizeClicks(rows, 7, end);
  ok(s.total === 3, "total");
  ok(s.byDevice.phone === 2 && s.byDevice.desktop === 1 && s.byDevice.tablet === 0, "device split");
  ok(s.topSlots[0].label === "Black Friday" && s.topSlots[0].clicks === 2, "top slot");
  ok(s.byPage[0].label === "/" && s.byPage[0].value === 2, "by page");
  ok(s.daily.length === 7, "7 daily bars");
  ok(s.daily[s.daily.length - 1].date === "2026-03-10" && s.daily[s.daily.length - 1].value === 2, "last day count");
  ok(s.daily[s.daily.length - 2].value === 1, "previous day count");
  ok(s.byPlacement[0].label === "Home carousel", "placement label");
  ok(summarizeClicks([], 30, end).total === 0 && summarizeClicks([], 30, end).daily.length === 30, "empty summary");
  ok(pacificDay("2026-03-11T06:00:00Z") === "2026-03-10", "pacific day boundary");
  ok(pacificDay("nope") === "", "bad date -> empty");

  // dead slots
  const dead = deadSlots(
    [
      { placement: "home_hero", slotKey: "slide-1", label: "BF", hasButtons: true },
      { placement: "home_hero", slotKey: "slide-9", label: "Quiet", hasButtons: true },
      { placement: "home_hero", slotKey: "slide-7", label: "No buttons", hasButtons: false },
    ],
    rows,
  );
  ok(dead.length === 1 && dead[0].slotKey === "slide-9", "dead slot found, buttonless skipped");

  // range
  ok(parseClickRange("7") === 7 && parseClickRange("90") === 90, "range parsed");
  ok(clickReportWindow(7, end).sinceIso === "2026-03-03T20:00:00.000Z", "report window start");
  ok(parseClickRange("5") === 30 && parseClickRange(undefined) === 30, "range default 30");

  return { passed, failed };
}
