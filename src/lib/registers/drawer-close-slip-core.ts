/**
 * src/lib/registers/drawer-close-slip-core.ts  (owner D151–D155, 2026-11-03)
 *
 * PURE helpers for two things the owner asked for on 2026-11-03:
 *
 *   1. The DRAWER CLOSE SLIP. When a cashier closes a drawer on the iPad, the
 *      register prints a short slip to leave with the till so the second
 *      counter knows whose till they are counting (D151, D152).
 *
 *      The slip NEVER shows money: no counted total, no expected cash, no
 *      tips, no over/short (D153). The close is blind and the second count in
 *      the back office must stay blind too. A slip that said "$412.00" would
 *      tell the second counter the number to hit, so it would no longer be an
 *      independent count.
 *
 *   2. The READ-ONLY second-count table. After the second counter saves their
 *      count in the back office they can see the denomination table they
 *      entered again, read only (D154). `countTableRows` turns a stored
 *      drawer_counts row into the rows that table shows.
 *
 * Browser-safe: RegisterShell imports this file, so it may only import other
 * pure modules (no next/, no server-only, no node:). The register app guard
 * test enforces that.
 */

import { escapeReceiptHtml } from "@/lib/pos/receipt-core";
import { formatReceiptTimestamp } from "@/lib/printing/receipt-core";
import { DENOM_FIELDS, denomTotalMinor, type DenomCounts } from "@/lib/registers/cash";

const SLIP_HEADER = "GREENWAY MARIJUANA";

// ---------------------------------------------------------------------------
// 1. The drawer close slip
// ---------------------------------------------------------------------------

/**
 * Safe details about a closed drawer. Everything here is about WHO, WHICH and
 * WHEN. There is deliberately no money field, so the slip cannot print one.
 */
export type DrawerCloseSlipInfo = {
  /** The drawer session id (drawer_sessions.id). Printed as a short ref. */
  sessionId: string;
  /** The register's name, e.g. "Sales Register 1". */
  registerName: string;
  /** The employee who closed (counted) the drawer. */
  closedByName: string;
  /** The employee who counted the drawer in, when known. */
  openedByName?: string | null;
  /** Business day, YYYY-MM-DD. */
  businessDay: string;
  /** When the drawer was opened (ISO). */
  openedAt?: string | null;
  /** When the drawer was closed (ISO). */
  closedAt: string;
  /** The iPad that closed it (device name), when known. */
  deviceName?: string | null;
};

/**
 * The short drawer reference printed on the slip and shown in the back office
 * beside the drawer, so the second counter can match paper to screen. The
 * first 8 characters of the session id, upper case (the back office shows the
 * same thing).
 */
export function drawerRef(sessionId: string): string {
  const clean = String(sessionId ?? "").replace(/-/g, "").trim();
  if (!clean) return "--------";
  return clean.slice(0, 8).toUpperCase();
}

/** "2026-11-03" → "Tue, Nov 3, 2026". Anything else is returned as given. */
export function formatBusinessDay(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day ?? "").trim());
  if (!m) return String(day ?? "");
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d, 12));
  if (Number.isNaN(dt.getTime()) || dt.getUTCMonth() !== mo - 1) return day;
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${days[dt.getUTCDay()]}, ${months[mo - 1]} ${d}, ${y}`;
}

/**
 * Accept the close details the till API returned, or null when the shape is
 * wrong (an older server, a bad response). The register then builds the slip
 * from what it already knows (see `fallbackCloseSlipInfo`).
 */
export function parseCloseSlipInfo(raw: unknown): DrawerCloseSlipInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const sessionId = str(r.sessionId);
  const registerName = str(r.registerName);
  const closedByName = str(r.closedByName);
  const closedAt = str(r.closedAt);
  if (!sessionId || !registerName || !closedByName || !closedAt) return null;
  return {
    sessionId,
    registerName,
    closedByName,
    openedByName: str(r.openedByName),
    businessDay: str(r.businessDay) ?? "",
    openedAt: str(r.openedAt),
    closedAt,
    deviceName: str(r.deviceName),
  };
}

/**
 * What the register already knows locally, used when the server did not send
 * close details. Still enough for the slip's whole job: whose till, which
 * register, which day.
 */
export function fallbackCloseSlipInfo(input: {
  sessionId: string | null | undefined;
  registerName: string;
  closedByName: string;
  businessDay?: string | null;
  openedAt?: string | null;
  closedAt: string;
}): DrawerCloseSlipInfo {
  return {
    sessionId: input.sessionId ?? "",
    registerName: input.registerName,
    closedByName: input.closedByName,
    openedByName: null,
    businessDay: input.businessDay ?? "",
    openedAt: input.openedAt ?? null,
    closedAt: input.closedAt,
    deviceName: null,
  };
}

/**
 * Build the DRAWER CLOSED slip HTML. Same 576px page setup as every other
 * slip, so the one print path (native Star printing, PassPRNT fallback)
 * handles it unchanged.
 */
export function buildDrawerCloseSlipHtml(info: DrawerCloseSlipInfo, opts?: { reprint?: boolean }): string {
  const e = escapeReceiptHtml;
  const line = (label: string, value: string) =>
    `<p class="row"><span class="k">${e(label)}</span><span class="v">${e(value)}</span></p>`;
  const opener = info.openedByName && info.openedByName.trim() ? info.openedByName.trim() : null;
  const day = info.businessDay ? formatBusinessDay(info.businessDay) : "";
  return [
    "<!DOCTYPE html>",
    '<html><head><meta charset="utf-8">',
    '<meta name="format-detection" content="telephone=no">',
    "<style>",
    "body{width:576px;margin:0;padding:8px 4px;font-family:'Helvetica Neue',Arial,sans-serif;color:#000;}",
    "h1{font-size:34px;text-align:center;margin:0 0 4px;}",
    ".sub{font-size:24px;text-align:center;margin:0 0 8px;}",
    ".banner{font-size:28px;font-weight:bold;text-align:center;border:3px solid #000;padding:6px;margin:8px 0;}",
    ".big{font-size:40px;font-weight:bold;text-align:center;margin:6px 0 2px;}",
    ".who{font-size:32px;font-weight:bold;text-align:center;margin:2px 0 8px;}",
    ".row{font-size:24px;margin:4px 0;display:flex;justify-content:space-between;gap:12px;}",
    ".k{font-weight:bold;}",
    ".v{text-align:right;}",
    ".note{font-size:22px;margin:6px 0;}",
    ".sign{font-size:24px;margin:22px 0 4px;}",
    "hr{border:none;border-top:2px dashed #000;margin:10px 0;}",
    "@media print{body{width:auto;}}",
    "</style></head><body>",
    `<h1>${e(SLIP_HEADER)}</h1>`,
    `<p class="banner">DRAWER CLOSED &mdash; LEAVE WITH THE TILL</p>`,
    opts?.reprint ? '<p class="sub">** REPRINT **</p>' : "",
    `<p class="big">${e(info.registerName)}</p>`,
    `<p class="who">${e(info.closedByName)}</p>`,
    "<hr>",
    line("Register", info.registerName),
    line("Closed by", info.closedByName),
    opener && opener !== info.closedByName ? line("Opened by", opener) : "",
    day ? line("Business day", day) : "",
    info.openedAt ? line("Drawer opened", formatReceiptTimestamp(info.openedAt)) : "",
    line("Drawer closed", formatReceiptTimestamp(info.closedAt)),
    info.deviceName ? line("iPad", info.deviceName) : "",
    line("Drawer ref", drawerRef(info.sessionId)),
    "<hr>",
    '<p class="note"><b>Second counter:</b> count this till by yourself, then enter your count and your own PIN on Register Activity in the back office. Match the drawer ref above to the drawer on screen.</p>',
    '<p class="note">This slip shows no amounts on purpose. The close is a blind count.</p>',
    '<p class="sign">Second counter: ______________________</p>',
    '<p class="sign">Time counted: _________</p>',
    "</body></html>",
  ]
    .filter(Boolean)
    .join("");
}

// ---------------------------------------------------------------------------
// 2. The read-only count table (back office)
// ---------------------------------------------------------------------------

export type CountTableRow = { key: keyof DenomCounts; label: string; qty: number; subtotalMinor: number };

export type CountTable = { rows: CountTableRow[]; totalMinor: number; anyCounted: boolean };

/**
 * Turn a stored count (a drawer_counts row, or any partial breakdown) into the
 * rows the read-only table shows, in the same order as the count form
 * ($100 down to 1¢), so it looks like the table they typed into.
 *
 * Every denomination is listed, zeros included: the owner asked to see "the
 * table with the numbers in it again", which is the whole grid.
 */
export function countTableRows(counts: Partial<Record<keyof DenomCounts, unknown>> | null | undefined): CountTable {
  const rows: CountTableRow[] = DENOM_FIELDS.map((f) => {
    const raw = Number(counts?.[f.key] ?? 0);
    const qty = Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
    return { key: f.key, label: f.label, qty, subtotalMinor: denomTotalMinor({ [f.key]: qty }) };
  });
  const totalMinor = rows.reduce((s, r) => s + r.subtotalMinor, 0);
  return { rows, totalMinor, anyCounted: rows.some((r) => r.qty > 0) };
}

/** Pick the second count's session id from the post-save URL, or null. */
export function parseViewedSessionId(raw: string | string[] | undefined | null): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== "string") return null;
  const t = v.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t) ? t.toLowerCase() : null;
}

// ---------------------------------------------------------------------------
// Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runDrawerCloseSlipTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const check = (name: string, ok: boolean) => {
    if (ok) passed++;
    else {
      failed++;
      console.error(`  FAIL drawer-close-slip: ${name}`);
    }
  };

  const info: DrawerCloseSlipInfo = {
    sessionId: "3ac71d20-1234-4abc-8def-0123456789ab",
    registerName: "Sales Register 2",
    closedByName: "Jamie Cashier",
    openedByName: "Alex Opener",
    businessDay: "2026-11-03",
    openedAt: "2026-11-03T16:00:00.000Z",
    closedAt: "2026-11-04T05:09:00.000Z",
    deviceName: "Front iPad",
  };
  const html = buildDrawerCloseSlipHtml(info);

  check("ref is first 8 upper", drawerRef(info.sessionId) === "3AC71D20");
  check("ref of empty is dashes", drawerRef("") === "--------");
  check("banner", html.includes("DRAWER CLOSED &mdash; LEAVE WITH THE TILL"));
  check("register name", html.includes("Sales Register 2"));
  check("employee name", html.includes("Jamie Cashier"));
  check("opened by shown when different", html.includes("Opened by") && html.includes("Alex Opener"));
  check("business day formatted", html.includes("Tue, Nov 3, 2026"));
  check("ref printed", html.includes("3AC71D20"));
  check("device printed", html.includes("Front iPad"));
  check("second counter note", html.includes("Second counter:"));
  check("576 wide", html.includes("width:576px"));
  // The slip must never print a money amount: a "$" followed by a digit.
  check("no dollar amounts", !/\$\s?\d/.test(html));
  check("no counted/expected words", !/expected|variance|over\/short|counted total/i.test(html));
  check("no reprint mark by default", !html.includes("REPRINT"));
  check("reprint mark", buildDrawerCloseSlipHtml(info, { reprint: true }).includes("** REPRINT **"));

  const same = buildDrawerCloseSlipHtml({ ...info, openedByName: "Jamie Cashier" });
  check("opened by hidden when same person", !same.includes("Opened by"));
  const noOpen = buildDrawerCloseSlipHtml({ ...info, openedAt: null, deviceName: null, businessDay: "" });
  check("optional lines drop", !noOpen.includes("Drawer opened") && !noOpen.includes("iPad<") && !noOpen.includes("Business day"));

  const evil = buildDrawerCloseSlipHtml({ ...info, closedByName: "<script>x</script>" });
  check("escapes names", !evil.includes("<script>x") && evil.includes("&lt;script&gt;"));

  check("format day bad input", formatBusinessDay("nope") === "nope");
  check("format day invalid month", formatBusinessDay("2026-13-01") === "2026-13-01");

  check("parse ok", parseCloseSlipInfo({ ...info })?.registerName === "Sales Register 2");
  check("parse rejects missing name", parseCloseSlipInfo({ ...info, closedByName: "" }) === null);
  check("parse rejects non-object", parseCloseSlipInfo("x") === null && parseCloseSlipInfo(null) === null);
  check("parse ignores money fields", !("countedMinor" in (parseCloseSlipInfo({ ...info, countedMinor: 41200 }) ?? {})));

  const fb = fallbackCloseSlipInfo({ sessionId: null, registerName: "R1", closedByName: "A", closedAt: info.closedAt });
  check("fallback builds a slip", buildDrawerCloseSlipHtml(fb).includes("R1") && fb.businessDay === "");

  const t = countTableRows({ hundreds: 2, twenties: 3, quarters: 4, pennies: 7 });
  check("table lists all 13", t.rows.length === 13);
  check("table order starts $100", t.rows[0].label === "$100" && t.rows[12].label === "1¢");
  check("table subtotal", t.rows[0].subtotalMinor === 20000 && t.rows.find((r) => r.key === "quarters")?.subtotalMinor === 100);
  check("table total", t.totalMinor === 20000 + 6000 + 100 + 7);
  check("table anyCounted", t.anyCounted && !countTableRows(null).anyCounted);
  check("table cleans junk", countTableRows({ ones: -3, fives: "x", tens: 2.9 }).totalMinor === 2000);

  check("session id ok", parseViewedSessionId(info.sessionId) === info.sessionId);
  check("session id upper ok", parseViewedSessionId(info.sessionId.toUpperCase()) === info.sessionId);
  check("session id array", parseViewedSessionId([info.sessionId, "x"]) === info.sessionId);
  check("session id junk", parseViewedSessionId("1; drop") === null && parseViewedSessionId(undefined) === null);

  return { passed, failed };
}
