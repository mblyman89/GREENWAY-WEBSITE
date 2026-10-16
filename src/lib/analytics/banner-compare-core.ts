/**
 * R55-S1 — Banner comparison for Reports > Website.
 *
 * Michael, verbatim: "we have a website clicks tab already built, and I think
 * we should add the banner comparison stats in there somehow organized very
 * nicely with the rest of the data being reported."
 *
 * Pure. Compares every banner (live now, or clicked in the period) inside its
 * own placement (home carousel vs shop banner), against the previous period of
 * the same length. We do NOT record impressions, so this is a share-of-clicks
 * comparison, not a click-through rate — the report says so.
 */
import { PLACEMENT_LABELS, type ClickPlacement, type LiveSlot, type StoredClick } from "./click-events-core";

/** A banner needs at least this many clicks before we crown it the leader. */
export const LEADER_MIN_CLICKS = 5;
/** Trend arrows ignore tiny swings below this many clicks either way. */
export const TREND_MIN_DELTA = 3;

export type Trend = { kind: "up" | "down" | "flat" | "new"; pct: number | null };

export type BannerRow = {
  placement: ClickPlacement;
  slotKey: string;
  label: string;
  live: boolean;
  clicks: number;
  prevClicks: number;
  /** Share of all clicks inside this placement, 0–100 (rounded). */
  share: number;
  perDay: number;
  phonePct: number;
  topButton: { label: string; clicks: number } | null;
  trend: Trend;
  leader: boolean;
};

export type PlacementGroup = {
  placement: ClickPlacement;
  title: string;
  total: number;
  prevTotal: number;
  rows: BannerRow[];
  /** Why no leader was named (only when no row is the leader). */
  leaderNote: string | null;
};

const key = (p: string, s: string | null) => `${p}|${s ?? "(unnamed)"}`;

export function trendOf(now: number, prev: number): Trend {
  if (prev === 0) return now > 0 ? { kind: "new", pct: null } : { kind: "flat", pct: null };
  const pct = Math.round(((now - prev) / prev) * 100);
  if (Math.abs(now - prev) < TREND_MIN_DELTA) return { kind: "flat", pct };
  return { kind: now > prev ? "up" : "down", pct };
}

/**
 * Build the comparison. Only placements that have banners (live, or clicked
 * in the period) are returned, home carousel first.
 */
export function compareBanners(
  rows: StoredClick[],
  prevRows: StoredClick[],
  live: LiveSlot[],
  days: number,
): PlacementGroup[] {
  const d = Math.max(1, Math.floor(days));
  type Acc = {
    placement: ClickPlacement;
    slotKey: string;
    label: string;
    live: boolean;
    clicks: number;
    prev: number;
    phone: number;
    buttons: Map<string, number>;
  };
  const acc = new Map<string, Acc>();
  const get = (placement: ClickPlacement, slotKey: string, label: string): Acc => {
    const k = key(placement, slotKey);
    let a = acc.get(k);
    if (!a) {
      a = { placement, slotKey, label, live: false, clicks: 0, prev: 0, phone: 0, buttons: new Map() };
      acc.set(k, a);
    }
    return a;
  };
  for (const s of live) {
    const a = get(s.placement, s.slotKey, s.label);
    a.live = true;
    a.label = s.label || a.label;
  }
  for (const r of rows) {
    const slot = r.slot_key ?? "(unnamed)";
    const a = get(r.placement, slot, r.slot_label || slot);
    a.clicks += 1;
    if (r.device === "phone") a.phone += 1;
    const b = r.button_label || "(no words)";
    a.buttons.set(b, (a.buttons.get(b) ?? 0) + 1);
  }
  for (const r of prevRows) {
    const a = acc.get(key(r.placement, r.slot_key));
    // Banners only in the previous period (and not live now) are not shown.
    if (a) a.prev += 1;
  }

  const groups = new Map<ClickPlacement, BannerRow[]>();
  for (const a of acc.values()) {
    let top: { label: string; clicks: number } | null = null;
    for (const [label, clicks] of a.buttons) {
      if (!top || clicks > top.clicks || (clicks === top.clicks && label < top.label)) top = { label, clicks };
    }
    const row: BannerRow = {
      placement: a.placement,
      slotKey: a.slotKey,
      label: a.label,
      live: a.live,
      clicks: a.clicks,
      prevClicks: a.prev,
      share: 0,
      perDay: Math.round((a.clicks / d) * 10) / 10,
      phonePct: a.clicks ? Math.round((a.phone / a.clicks) * 100) : 0,
      topButton: top,
      trend: trendOf(a.clicks, a.prev),
      leader: false,
    };
    const list = groups.get(a.placement) ?? [];
    list.push(row);
    groups.set(a.placement, list);
  }

  const order: ClickPlacement[] = ["home_hero", "shop_banner", "specials_hero", "loyalty_hero", "section", "other"];
  const out: PlacementGroup[] = [];
  for (const placement of order) {
    const list = groups.get(placement);
    if (!list || list.length === 0) continue;
    const total = list.reduce((n, r) => n + r.clicks, 0);
    const prevTotal = list.reduce((n, r) => n + r.prevClicks, 0);
    for (const r of list) r.share = total ? Math.round((r.clicks / total) * 100) : 0;
    list.sort((a, b) => b.clicks - a.clicks || Number(b.live) - Number(a.live) || a.label.localeCompare(b.label));
    let leaderNote: string | null = null;
    const [first, second] = list;
    if (list.length < 2) leaderNote = "Only one banner here — nothing to compare yet.";
    else if (first.clicks < LEADER_MIN_CLICKS) leaderNote = `Too early to call — the top banner needs ${LEADER_MIN_CLICKS}+ clicks.`;
    else if (second && second.clicks === first.clicks) leaderNote = "Tied at the top.";
    else first.leader = true;
    out.push({ placement, title: PLACEMENT_LABELS[placement], total, prevTotal, rows: list, leaderNote });
  }
  return out;
}

/** The previous period window, same length, ending where this one starts. */
export function previousWindow(days: number, nowMs: number): { sinceIso: string; untilIso: string } {
  return {
    sinceIso: new Date(nowMs - 2 * days * 86_400_000).toISOString(),
    untilIso: new Date(nowMs - days * 86_400_000).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runBannerCompareTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, label: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error("  ✗ banner-compare:", label);
    }
  };
  const click = (slot: string, extra: Partial<StoredClick> = {}): StoredClick => ({
    occurred_at: "2026-03-09T20:00:00.000Z",
    page_path: "/",
    placement: "home_hero",
    slot_key: slot,
    slot_label: slot.toUpperCase(),
    slot_position: 0,
    button_label: "Shop now",
    target_href: "/shop",
    device: "phone",
    ...extra,
  });
  const rows: StoredClick[] = [
    ...Array.from({ length: 8 }, () => click("a")),
    click("a", { button_label: "Deals", device: "desktop" }),
    click("a", { button_label: "Deals", device: "desktop" }),
    ...Array.from({ length: 4 }, () => click("b")),
    click("s1", { placement: "shop_banner" }),
  ];
  const prev: StoredClick[] = [...Array.from({ length: 4 }, () => click("a")), ...Array.from({ length: 4 }, () => click("b")), click("gone")];
  const live: LiveSlot[] = [
    { placement: "home_hero", slotKey: "a", label: "Spring sale", hasButtons: true },
    { placement: "home_hero", slotKey: "b", label: "Loyalty", hasButtons: true },
    { placement: "home_hero", slotKey: "c", label: "Quiet", hasButtons: true },
  ];
  const g = compareBanners(rows, prev, live, 10);
  ok(g.length === 2 && g[0].placement === "home_hero" && g[1].placement === "shop_banner", "groups ordered home first");
  const home = g[0];
  ok(home.rows.length === 3, "live zero-click banner included, prev-only banner excluded");
  ok(home.total === 14 && home.prevTotal === 8, "group totals");
  const a = home.rows[0];
  ok(a.slotKey === "a" && a.label === "Spring sale", "sorted by clicks, live label wins");
  ok(a.clicks === 10 && a.prevClicks === 4, "clicks + prev");
  ok(a.share === 71, "share in placement");
  ok(a.perDay === 1, "per day");
  ok(a.phonePct === 80, "phone pct");
  ok(a.topButton?.label === "Shop now" && a.topButton.clicks === 8, "top button");
  ok(a.trend.kind === "up" && a.trend.pct === 150, "trend up");
  ok(a.leader && !home.rows[1].leader && home.leaderNote === null, "leader crowned");
  ok(home.rows[1].trend.kind === "flat", "no change -> flat");
  ok(home.rows[2].slotKey === "c" && home.rows[2].clicks === 0 && home.rows[2].topButton === null, "quiet banner last");
  ok(g[1].leaderNote !== null && !g[1].rows[0].leader, "single banner: no leader");
  ok(g[1].rows[0].trend.kind === "new", "no prev clicks -> new");
  const early = compareBanners([click("a"), click("b")], [], [], 7)[0];
  ok(early.leaderNote?.startsWith("Too early") === true && !early.rows.some((r) => r.leader), "too early to call");
  const tie = compareBanners([...Array(6)].flatMap(() => [click("a"), click("b")]), [], [], 7)[0];
  ok(tie.leaderNote === "Tied at the top." && !tie.rows.some((r) => r.leader), "tie: no leader");
  ok(trendOf(5, 10).kind === "down" && trendOf(5, 10).pct === -50, "trend down");
  ok(trendOf(11, 10).kind === "flat", "small swing flat");
  ok(trendOf(0, 0).kind === "flat", "zero/zero flat");
  ok(compareBanners([], [], [], 30).length === 0, "empty -> no groups");
  const pw = previousWindow(7, Date.parse("2026-03-10T20:00:00.000Z"));
  ok(pw.sinceIso === "2026-02-24T20:00:00.000Z" && pw.untilIso === "2026-03-03T20:00:00.000Z", "previous window");
  return { passed, failed };
}
