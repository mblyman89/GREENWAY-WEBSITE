/**
 * src/lib/pos/cutover-weekend-core.ts  (R50 A5)
 *
 * PURE: the one-page, dated and timed plan for the cutover weekend
 * (Fri 10/30 count, Sat 10/31 last Cultivera day + dress rehearsal, Sun 11/01
 * the real run before the 08:00 open), plus "you are here" from the clock.
 *
 * Every time and rule below is taken from code or a measurement, never made up:
 *  - 06:00 start, 08:00 open, about 8 min harvest: roadmap 3b.7 / 3b.8 and
 *    rehearsal #2a (478 s), docs/CULTIVERA_CUTOVER_RUNBOOK.md.
 *  - Stage within 90 minutes of the harvest: MAX_HARVEST_AGE_MINUTES
 *    (cultivera-fetch-button-core.ts importDecision).
 *  - The count fetch IS the real fetch: the count page takes "the import staged
 *    from the count fetch", the sales day is the count date + 1
 *    (salesDayAfter), and a sale after the sales day blocks apply (U-50).
 *  - Apply the count before the first sale on our register: a lot that moved
 *    after the import is left alone (moved_since_import, cultivera-count-core).
 *  - TICK Start fresh on 11/01: the crawler resumes the newest UNFINISHED run when
 *    it is off (cultivera_pos_jobs.py resumable_run), so a stopped 10/31
 *    rehearsal would be resumed with its 10/31 stages. Runs never share data
 *    (each run has its own folder), so the 11/01 fetch is a full harvest
 *    (rehearsal #2a: 478 s).
 *  - Point of no return = the first receiving approval after the Cultivera
 *    publish (cutoverDone, cutover-guard-core.ts).
 *  - Clocks fall back at 02:00 on Sun 2026-11-01 (US DST end; timeanddate.com),
 *    so 01:00-01:59 Pacific happens twice; Cultivera stamps sales in Pacific
 *    wall time (U-49). Nothing in the plan runs in that window.
 *
 * Nothing here reads or writes anything.
 */

import { MAX_HARVEST_AGE_MINUTES } from "./cultivera-fetch-button-core";

export const CUTOVER_COUNT_DATE = "2026-10-30";
export const CUTOVER_LAST_CULTIVERA_DAY = "2026-10-31";
export const CUTOVER_DAY = "2026-11-01";
export const CUTOVER_OPEN_AT = "08:00";
export const CUTOVER_DOC = "docs/CUTOVER_WEEKEND_ONE_PAGE.md";
export const STORE_TZ = "America/Los_Angeles";

export type WeekendDay = "before" | typeof CUTOVER_COUNT_DATE | typeof CUTOVER_LAST_CULTIVERA_DAY | typeof CUTOVER_DAY | "after";

export type WeekendStep = {
  key: string;
  day: WeekendDay;
  /** "HH:MM" Pacific, or null = any time that day (after the previous timed step). */
  at: string | null;
  title: string;
  detail: string;
  /** What must be true before moving on. */
  check: string;
  href: string | null;
  linkLabel: string | null;
};

export const WEEKEND_DAY_LABEL: Record<WeekendDay, string> = {
  before: "Before Fri 10/30 (week of 10/26)",
  "2026-10-30": "Fri 10/30: the shelf count",
  "2026-10-31": "Sat 10/31: last Cultivera day",
  "2026-11-01": "Sun 11/01: cutover, before the 08:00 open",
  after: "Mon 11/02 to Sun 11/08",
};

export const WEEKEND_STEPS: readonly WeekendStep[] = [
  // ---- before ----
  {
    key: "rehearsal3",
    day: "before",
    at: null,
    title: "Rehearsal #3 in Test mode",
    detail: "Press Fetch, stop it halfway, press Resume. Stage it with Test mode on, look it over, then Clean Slate.",
    check: "The resumed run says GO and Clean Slate says real data was untouched.",
    href: "/admin/menu-imports",
    linkLabel: "Menu Imports",
  },
  {
    key: "scanners",
    day: "before",
    at: null,
    title: "Test every scanner and the workbook",
    detail: "Scan 3 items per scanner into the test box, and open one downloaded workbook in Excel on a store PC (U-47, U-53).",
    check: "Every scan lands on its own line; the Scan sheet works in Excel.",
    href: "/admin/menu-imports/count",
    linkLabel: "Oct 30 shelf count",
  },
  {
    key: "test_sale",
    day: "before",
    at: null,
    title: "Ring one test sale and one return in Cultivera",
    detail: "Note the Pacific time you ring them. The rehearsal's sales read must show them at that time (U-48, U-49).",
    check: "The sale and the return show up with the time you noted.",
    href: null,
    linkLabel: null,
  },
  {
    key: "alerts",
    day: "before",
    at: null,
    title: "Send a test alert to the phone you will carry",
    detail: "Below on this page. If it says alerts cannot reach you, set the email and push settings it names first.",
    check: "The email and the phone notification both arrive.",
    href: "/admin/menu-imports/cutover#cutover-alerts",
    linkLabel: "Failure alerts",
  },
  // ---- Fri 10/30 ----
  {
    key: "workbooks",
    day: CUTOVER_COUNT_DATE,
    at: null,
    title: "Download one scan workbook per counter",
    detail: "Each counter gets their own file. Never copy one. Do it before counting starts.",
    check: "One file per counter, each with its counter's name.",
    href: "/admin/menu-imports/count",
    linkLabel: "Oct 30 shelf count",
  },
  {
    key: "back_stock",
    day: CUTOVER_COUNT_DATE,
    at: "18:00",
    title: "Back stock counted by 18:00, then close",
    detail: "Count the back room while open. Nothing is pulled from it during the count. Close at 18:00.",
    check: "The back room is finished before 18:00.",
    href: null,
    linkLabel: null,
  },
  {
    key: "floor",
    day: CUTOVER_COUNT_DATE,
    at: null,
    title: "Count the sales floor after the close",
    detail: "Scan each unit once. Items without a barcode go on the Hand Count sheet. Save every workbook; you upload them on 11/01.",
    check: "Every counter's workbook is saved somewhere safe.",
    href: null,
    linkLabel: null,
  },
  // ---- Sat 10/31 ----
  {
    key: "last_day",
    day: CUTOVER_LAST_CULTIVERA_DAY,
    at: null,
    title: "Sell on Cultivera as normal",
    detail: "Its 10/31 sales are taken off your count on 11/01. Do not approve anything on Product Onboarding today.",
    check: "Nothing is approved on Onboarding.",
    href: null,
    linkLabel: null,
  },
  {
    key: "rehearsal4",
    day: CUTOVER_LAST_CULTIVERA_DAY,
    at: null,
    title: "After the close: dress rehearsal #4, Test mode",
    detail: "Fetch with the count date 10/30, read GO, stage with Test mode ON, then Clean Slate. (The units check skips test imports.) Finish before 01:00.",
    check: "GO on every check, Sales done; Clean Slate done.",
    href: "/admin/menu-imports",
    linkLabel: "Menu Imports",
  },
  // ---- Sun 11/01 ----
  {
    key: "dst",
    day: CUTOVER_DAY,
    at: "02:00",
    title: "Clocks fall back (02:00 becomes 01:00)",
    detail: "01:00 to 01:59 happens twice tonight. Run nothing between 01:00 and 03:00: Cultivera stamps sales in Pacific wall time.",
    check: "Nothing is running.",
    href: null,
    linkLabel: null,
  },
  {
    key: "fetch",
    day: CUTOVER_DAY,
    at: "06:00",
    title: "Fetch, with the count date set to 10/30",
    detail: "Menu Imports: set the count date to 2026-10-30, TICK Start fresh, press Fetch It All. About 8 minutes. If it stops, press Resume on its run page.",
    check: "Every stage is done, Sales too. A partial Sales read means the count is refused.",
    href: "/admin/menu-imports#fetch-cultivera",
    linkLabel: "Fetch button",
  },
  {
    key: "go",
    day: CUTOVER_DAY,
    at: "06:10",
    title: "Read the go / no-go",
    detail: "On the run page. A NO-GO names what is wrong; a control-total mismatch means fetch again. Never accept a mismatch.",
    check: "GO on every check.",
    href: "/admin/menu-imports",
    linkLabel: "Latest run (Menu Imports)",
  },
  {
    key: "stage",
    day: CUTOVER_DAY,
    at: "06:15",
    title: "Stage it with Test mode OFF",
    detail: `Within ${MAX_HARVEST_AGE_MINUTES} minutes of the harvest finishing, or the app refuses and you fetch again.`,
    check: "The import is staged as real, not test.",
    href: null,
    linkLabel: null,
  },
  {
    key: "publish",
    day: CUTOVER_DAY,
    at: "06:20",
    title: "Fact review, then Publish",
    detail: "On the import's page. Its counts must match the run page: lots, items, variants, units, value at cost.",
    check: "The Cultivera menu is live.",
    href: "/admin/menu-imports",
    linkLabel: "The staged import",
  },
  {
    key: "balance",
    day: CUTOVER_DAY,
    at: "06:40",
    title: "Do the units balance?",
    detail: "Every unit in Cultivera's file must be a unit on a lot. Red lines say what to do.",
    check: "Green.",
    href: "/admin/menu-imports/reconcile",
    linkLabel: "Go / no-go check",
  },
  {
    key: "count",
    day: CUTOVER_DAY,
    at: "06:50",
    title: "Upload the count workbooks and apply",
    detail: "Pick this morning's import, upload every workbook at once, read the preview, apply. Before 08:00: a lot sold first is left alone.",
    check: "Applied, with nothing refused.",
    href: "/admin/menu-imports/count",
    linkLabel: "Oct 30 shelf count",
  },
  {
    key: "nothing_waiting",
    day: CUTOVER_DAY,
    at: "07:30",
    title: "Nothing waiting, menu and register checked",
    detail: "Still to rebuild says none. Publish Menu shows nothing waiting. Check the public menu and ring a few items on the register.",
    check: "The menu and the register look right.",
    href: "/admin/publish",
    linkLabel: "Publish Menu",
  },
  {
    key: "open",
    day: CUTOVER_DAY,
    at: CUTOVER_OPEN_AT,
    title: "Open. Receiving is the only door now",
    detail: "Your first receiving approval is the point of no return: after it, fixes go forward through receiving only.",
    check: "-",
    href: "/admin/inventory/intake",
    linkLabel: "Receiving",
  },
  {
    key: "day_work",
    day: CUTOVER_DAY,
    at: null,
    title: "During the day: manifests and onboarding",
    detail: "Rebuild the Cultivera manifests (preview first), attach vendor lab results, then work Product Onboarding.",
    check: "Nothing here can take a product off the menu.",
    href: "/admin/inventory/drafts",
    linkLabel: "Product Onboarding",
  },
  {
    key: "password",
    day: CUTOVER_DAY,
    at: null,
    title: "Change your Cultivera password",
    detail: "When the day's work no longer needs Cultivera. The crawler's login stops working, as intended.",
    check: "The old password no longer logs in.",
    href: null,
    linkLabel: null,
  },
  // ---- after ----
  {
    key: "drift",
    day: "after",
    at: null,
    title: "Daily: compare against Cultivera's last numbers",
    detail: "Once a day for the first week, check the units by vendor and category against the cutover import.",
    check: "Each difference has a reason (a sale, a delivery, a count).",
    href: "/admin/menu-imports/reconcile",
    linkLabel: "Go / no-go check",
  },
];

/** Rollback, by checkpoint (decided before the day, never improvised). */
export const WEEKEND_ROLLBACK: readonly { when: string; what: string }[] = [
  { when: "Before Publish", what: "Nothing changed. Stop. Cultivera keeps working; fetch again later or use the manual upload." },
  { when: "After Publish, before the first receiving approval", what: "Fetch again, stage and publish the corrected harvest. A real re-import is still allowed." },
  { when: "After the first receiving approval", what: "Forward-fix only: re-approve from receiving. A second real Cultivera upload is refused." },
];

const DAY_ORDER: Record<WeekendDay, number> = { before: 0, "2026-10-30": 1, "2026-10-31": 2, "2026-11-01": 3, after: 4 };

/** Pacific wall date + time for an instant (DST-correct, via Intl). */
export function pacificWall(nowMs: number): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: STORE_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(nowMs));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { date: `${g("year")}-${g("month")}-${g("day")}`, time: `${g("hour")}:${g("minute")}` };
}

export function weekendDayOf(date: string): WeekendDay {
  if (date < CUTOVER_COUNT_DATE) return "before";
  if (date === CUTOVER_COUNT_DATE) return CUTOVER_COUNT_DATE;
  if (date === CUTOVER_LAST_CULTIVERA_DAY) return CUTOVER_LAST_CULTIVERA_DAY;
  if (date === CUTOVER_DAY) return CUTOVER_DAY;
  return "after";
}

export type WeekendNow = {
  day: WeekendDay;
  pacific: { date: string; time: string };
  /** The first timed step today that has not come yet (null: none left today / untimed day). */
  nextTimedKey: string | null;
  headline: string;
};

/**
 * "You are here". Only says what the clock says (today's section, the next timed step today);
 * it never claims a step is done, because the page cannot see that.
 */
export function weekendNow(nowMs: number): WeekendNow {
  const pacific = pacificWall(nowMs);
  const day = weekendDayOf(pacific.date);
  const today = WEEKEND_STEPS.filter((s) => s.day === day);
  const next = today.find((s) => s.at !== null && s.at > pacific.time) ?? null;
  let headline: string;
  if (day === "before") headline = `Today is ${pacific.date}. Do the before-the-weekend steps.`;
  else if (day === "after") headline = `Cutover is behind you (${pacific.date}). Keep the daily check going through 11/08.`;
  else headline = next ? `Now: ${WEEKEND_DAY_LABEL[day]}. Next at ${next.at}: ${next.title}.` : `Now: ${WEEKEND_DAY_LABEL[day]}.`;
  return { day, pacific, nextTimedKey: next?.key ?? null, headline };
}

/** Steps in order: days in DAY_ORDER, timed steps never out of order within a day. */
export function stepsInOrder(steps: readonly WeekendStep[]): boolean {
  let lastDay = -1;
  let lastAt = "";
  for (const s of steps) {
    const d = DAY_ORDER[s.day];
    if (d < lastDay) return false;
    if (d > lastDay) {
      lastDay = d;
      lastAt = "";
    }
    if (s.at !== null) {
      if (s.at < lastAt) return false;
      lastAt = s.at;
    }
  }
  return true;
}

/**
 * The printable one-pager (docs/CUTOVER_WEEKEND_ONE_PAGE.md) rendered from the SAME steps the
 * page shows. A test compares the committed file to this output byte for byte.
 */
export function renderWeekendMarkdown(): string {
  const days: WeekendDay[] = ["before", CUTOVER_COUNT_DATE, CUTOVER_LAST_CULTIVERA_DAY, CUTOVER_DAY, "after"];
  const cell = (t: string) => t.replace(/\|/g, "\\|");
  const out: string[] = [
    "# Cutover weekend: one page (10/30 - 11/01)",
    "",
    "<!-- Generated from src/lib/pos/cutover-weekend-core.ts (renderWeekendMarkdown). Do not edit by hand. -->",
    "",
    "All times Pacific. In the app: Admin -> Menu Imports -> Cultivera cutover runbook (/admin/menu-imports/cutover).",
    "Tick each box yourself; the app cannot see what you have done.",
  ];
  for (const d of days) {
    out.push("", `## ${WEEKEND_DAY_LABEL[d]}`, "", "| Done | Time | Step | Check |", "|---|---|---|---|");
    for (const st of WEEKEND_STEPS.filter((x) => x.day === d)) {
      const where = st.href ? ` (${st.href})` : "";
      out.push(`| [ ] | ${st.at ?? ""} | **${cell(st.title)}.** ${cell(st.detail)}${where} | ${cell(st.check)} |`);
    }
  }
  out.push("", "## If something goes wrong", "");
  for (const r of WEEKEND_ROLLBACK) out.push(`- **${r.when}:** ${r.what}`);
  out.push("", "Long form, with the reasons and the evidence: docs/CULTIVERA_CUTOVER_RUNBOOK.md.", "");
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runCutoverWeekendCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL cutover-weekend-core: " + msg);
    passed += 1;
  };
  const st = (k: string) => {
    const s = WEEKEND_STEPS.find((x) => x.key === k);
    if (!s) throw new Error("FAIL cutover-weekend-core: no step " + k);
    return s;
  };
  const idx = (k: string) => WEEKEND_STEPS.findIndex((x) => x.key === k);
  const days5 = () => Object.keys(DAY_ORDER) as WeekendDay[];

  // shape
  ok(new Set(WEEKEND_STEPS.map((s) => s.key)).size === WEEKEND_STEPS.length, "keys unique");
  ok(WEEKEND_STEPS.every((s) => s.title.length <= 64 && s.detail.length <= 200 && s.check.length > 0), "every step short, with a check");
  ok(WEEKEND_STEPS.every((s) => (s.href === null) === (s.linkLabel === null)), "a link always has a label");
  ok(WEEKEND_STEPS.every((s) => s.at === null || /^([01]\d|2[0-3]):[0-5]\d$/.test(s.at)), "times are HH:MM");
  ok(stepsInOrder(WEEKEND_STEPS), "days and times in order");
  ok(Object.keys(DAY_ORDER).every((d) => WEEKEND_STEPS.some((s) => s.day === d)), "every day has a step");

  // the order that matters
  ok(idx("fetch") < idx("go") && idx("go") < idx("stage") && idx("stage") < idx("publish"), "fetch, go, stage, publish");
  ok(idx("publish") < idx("balance") && idx("balance") < idx("count"), "publish, balance, count");
  ok(st("count").at! < CUTOVER_OPEN_AT && st("nothing_waiting").at! < CUTOVER_OPEN_AT, "count + checks before the open");
  ok(idx("count") < idx("open") && idx("open") < idx("day_work"), "count before open; onboarding after");
  ok(idx("workbooks") < idx("back_stock") && idx("back_stock") < idx("floor"), "workbooks before the count");
  ok(idx("rehearsal4") < idx("fetch") && st("rehearsal4").day === CUTOVER_LAST_CULTIVERA_DAY, "dress rehearsal the evening before");

  // facts the steps must carry
  ok(st("fetch").detail.includes(CUTOVER_COUNT_DATE) && st("fetch").detail.includes("TICK Start fresh") && st("fetch").detail.includes("Resume on its run page"), "fetch: count date + a brand-new harvest (never resume the 10/31 rehearsal)");
  ok(st("fetch").at === "06:00" && st("open").at === "08:00", "06:00 start, 08:00 open");
  ok(st("stage").detail.includes(`${MAX_HARVEST_AGE_MINUTES} minutes`) && MAX_HARVEST_AGE_MINUTES === 90, "stage window = the gate's 90 min");
  ok(st("stage").title.includes("Test mode OFF") && st("rehearsal4").detail.includes("Test mode ON") && st("rehearsal3").title.includes("Test mode"), "real vs test said plainly");
  ok(st("count").detail.includes("Before 08:00") && st("count").detail.includes("left alone"), "count: why before the open");
  ok(st("dst").at === "02:00" && /between 01:00 and 03:00/.test(st("dst").detail) && st("fetch").at! >= "03:00", "DST: nothing in the repeated hour");
  ok(/before 01:00/.test(st("rehearsal4").detail), "rehearsal ends before the repeated hour");
  ok(st("open").detail.includes("point of no return"), "point of no return named");
  ok(st("last_day").detail.includes("Do not approve"), "no approvals on the last Cultivera day");
  ok(st("back_stock").at === "18:00", "close at 18:00 on the count day");
  ok(WEEKEND_ROLLBACK.length === 3 && WEEKEND_ROLLBACK[2].what.includes("refused"), "three rollback checkpoints");

  // links are app routes or anchors on them
  ok(WEEKEND_STEPS.every((s) => s.href === null || s.href.startsWith("/admin/")), "links stay in admin");

  // clock -> Pacific (DST-correct)
  ok(pacificWall(Date.UTC(2026, 10, 1, 14, 0)).time === "06:00" && pacificWall(Date.UTC(2026, 10, 1, 14, 0)).date === CUTOVER_DAY, "11/01 14:00Z = 06:00 PST");
  ok(pacificWall(Date.UTC(2026, 9, 31, 13, 0)).time === "06:00", "10/31 13:00Z = 06:00 PDT");
  ok(pacificWall(Date.UTC(2026, 10, 1, 6, 30)).date === CUTOVER_LAST_CULTIVERA_DAY && pacificWall(Date.UTC(2026, 10, 1, 6, 30)).time === "23:30", "11/01 06:30Z = 10/31 23:30 PDT");

  // day of
  ok(weekendDayOf("2026-10-29") === "before" && weekendDayOf(CUTOVER_COUNT_DATE) === CUTOVER_COUNT_DATE && weekendDayOf("2026-11-02") === "after", "day buckets");
  ok(weekendDayOf(CUTOVER_LAST_CULTIVERA_DAY) === CUTOVER_LAST_CULTIVERA_DAY && weekendDayOf(CUTOVER_DAY) === CUTOVER_DAY && weekendDayOf("2027-01-01") === "after", "day buckets (2)");

  // you are here
  const n1 = weekendNow(Date.UTC(2026, 10, 1, 14, 5)); // 06:05 PST
  ok(n1.day === CUTOVER_DAY && n1.nextTimedKey === "go" && n1.headline.includes("Next at 06:10"), "06:05 -> next is go/no-go");
  const n2 = weekendNow(Date.UTC(2026, 10, 1, 14, 0)); // exactly 06:00
  ok(n2.nextTimedKey === "go", "a step at exactly now is not 'next'");
  const n3 = weekendNow(Date.UTC(2026, 10, 1, 20, 0)); // 12:00
  ok(n3.nextTimedKey === null && !n3.headline.includes("Next"), "after the last timed step: no next");
  ok(weekendNow(Date.UTC(2026, 9, 27, 18, 0)).day === "before" && weekendNow(Date.UTC(2026, 10, 3, 18, 0)).day === "after", "before / after");
  ok(weekendNow(Date.UTC(2026, 9, 30, 20, 0)).nextTimedKey === "back_stock", "Fri 13:00 -> next is the 18:00 close");
  ok(weekendNow(Date.UTC(2026, 10, 1, 8, 30)).nextTimedKey === "dst", "01:30 PDT -> next is the clock change");

  // the printable copy
  const md = renderWeekendMarkdown();
  ok(WEEKEND_STEPS.every((x) => md.includes(`**${x.title}.**`)), "md: every step");
  ok(days5().every((d) => md.includes(`## ${WEEKEND_DAY_LABEL[d]}`)) && md.includes("## If something goes wrong"), "md: every day + rollback");
  ok(md.indexOf("**Fetch, with the count date set to 10/30.**") < md.indexOf("**Fact review, then Publish.**"), "md: order kept");
  ok((md.match(/^\| \[ \] \|/gm) ?? []).length === WEEKEND_STEPS.length && md.endsWith("\n"), "md: one tick box per step");

  // the order check really checks
  const swapped = [st("go"), st("fetch")];
  ok(!stepsInOrder(swapped), "out-of-order times caught");
  ok(!stepsInOrder([st("fetch"), st("floor")]), "out-of-order days caught");
  ok(stepsInOrder([st("floor"), st("fetch"), st("day_work"), st("drift")]), "untimed steps never break the order");

  return { passed, failed: 0 };
}
