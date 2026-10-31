/**
 * src/lib/inventory/daily-checklist-core.ts  (Fix Phase 4.4b · G-38 · F-06-12)
 *
 * PURE rules for the Daily Checklists screen. No I/O.
 *
 * The owner, verbatim:
 *   "Checklists for daily tasks like cycle counts I initiate via the inventory
 *    audit feature."                                  (SOP-06 catalog)
 *   "the cycle counts and daily checklists are for all employees, admin,
 *    manger, sales."                                  (D51)
 *   "Tasks should include cleaning, organizing, stocking, marketing content ...
 *    Plus any other small retail business daily duties that you think ought to
 *    be included as well."                            (D57)
 *
 * The catalog is seeded from SOP-06 forms 8.5-8.8 by migration 0327. This
 * file decides: which sheet (period) a list belongs to, who may initial and
 * sign off which list, what initials look like, when a sign-off needs a note,
 * how a task's SOP reference becomes links, and what the live Cycle Counts
 * line says.
 */
import type { StaffRole } from "@/lib/supabase/types";
import { can } from "@/lib/auth/roles";

export const CHECKLIST_KINDS = ["opening", "during", "closing", "weekly", "monthly", "yearly"] as const;
export type ChecklistKind = (typeof CHECKLIST_KINDS)[number];

export const CHECKLIST_KIND_LABELS: Record<ChecklistKind, string> = {
  opening: "Opening",
  during: "During the shift",
  closing: "Closing",
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Year end",
};

/** The paper form each list replaces (SOP-06 §8). */
export const CHECKLIST_KIND_FORM: Record<ChecklistKind, string> = {
  opening: "8.5",
  during: "8.6",
  closing: "8.7",
  weekly: "8.8",
  monthly: "8.8",
  yearly: "8.8",
};

export function isChecklistKind(v: unknown): v is ChecklistKind {
  return typeof v === "string" && (CHECKLIST_KINDS as readonly string[]).includes(v);
}

/** Daily lists are every employee's (D51); weekly / monthly / year end are the manager's (form 8.8). */
export function isDailyKind(kind: ChecklistKind): boolean {
  return kind === "opening" || kind === "during" || kind === "closing";
}

/** May this role initial a task on this list? */
export function canInitial(role: StaffRole | null | undefined, kind: ChecklistKind): boolean {
  return isDailyKind(kind) ? can(role, "inventory.count") : can(role, "inventory.manage");
}

/** Manager sign-off (owner, admin, manager). */
export function canSignOff(role: StaffRole | null | undefined): boolean {
  return can(role, "inventory.manage");
}

/** Owner-editable catalog (D57: the owner decides the tasks). */
export function canEditCatalog(role: StaffRole | null | undefined): boolean {
  return can(role, "inventory.audit");
}

// ── Periods ──────────────────────────────────────────────────────────────

function isDay(d: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));
}

/**
 * The sheet a list belongs to, from a Pacific business day (YYYY-MM-DD):
 * the day itself for opening / during / closing, the Monday of that week for
 * weekly, the first of the month for monthly, 1 January for year end.
 */
export function checklistPeriodKey(kind: ChecklistKind, pacificDay: string): string {
  if (!isDay(pacificDay)) throw new Error(`CHECKLIST_BAD_DAY: "${pacificDay}" is not a date (YYYY-MM-DD).`);
  if (isDailyKind(kind)) return pacificDay;
  if (kind === "monthly") return `${pacificDay.slice(0, 7)}-01`;
  if (kind === "yearly") return `${pacificDay.slice(0, 4)}-01-01`;
  const d = new Date(`${pacificDay}T12:00:00Z`);
  const dow = d.getUTCDay(); // 0 Sunday
  const back = (dow + 6) % 7; // days since Monday
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

/** "Fri Oct 30 2026", "Week of Mon Oct 26 2026", "October 2026", "Year end 2026". */
export function describePeriod(kind: ChecklistKind, periodKey: string): string {
  const d = new Date(`${periodKey}T12:00:00Z`);
  const day = d.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" });
  if (isDailyKind(kind)) return day;
  if (kind === "weekly") return `Week of ${day}`;
  if (kind === "monthly") return d.toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" });
  return `Year end ${periodKey.slice(0, 4)}`;
}

// ── Initials and notes ───────────────────────────────────────────────────

/** Suggested initials from a name: "Michael Lyman" -> "ML"; an email -> its first letter. */
export function suggestInitials(name: string | null | undefined): string {
  const words = (name ?? "").replace(/@.*$/, "").split(/[^A-Za-z]+/).filter(Boolean);
  const s = words.map((w) => w[0]!.toUpperCase()).join("").slice(0, 4);
  return s || "X";
}

export type Checked<T> = { ok: true; value: T } | { ok: false; message: string };

export function checkInitials(raw: unknown): Checked<string> {
  const v = String(raw ?? "").trim().toUpperCase().replace(/[.\s]/g, "");
  if (!/^[A-Z]{1,4}$/.test(v)) {
    return { ok: false, message: "Initials are 1 to 4 letters (for example ML). Nothing was saved." };
  }
  return { ok: true, value: v };
}

export function checkTickNote(raw: unknown): Checked<string | null> {
  const v = String(raw ?? "").trim();
  if (v.length > 500) return { ok: false, message: "The note is longer than 500 characters. Nothing was saved." };
  return { ok: true, value: v || null };
}

/**
 * Manager sign-off. Tasks may be left undone (a shift can run short), but then
 * the manager writes why, so the five-year record says what happened.
 */
export function checkSignOff(input: { openTasks: number; note: unknown }): Checked<string | null> {
  const note = String(input.note ?? "").trim();
  if (note.length > 1000) return { ok: false, message: "The sign-off note is longer than 1000 characters. Nothing was saved." };
  if (input.openTasks > 0 && note.length < 3) {
    return {
      ok: false,
      message: `${input.openTasks} task${input.openTasks === 1 ? " is" : "s are"} not initialled. Write in the note why (for example "short-staffed, restroom done by closer"), then sign off. Nothing was saved.`,
    };
  }
  return { ok: true, value: note || null };
}

// ── The catalog editor ───────────────────────────────────────────────────

export type TaskDraft = { kind: ChecklistKind; section: string; label: string; sopRef: string | null; sortOrder: number };

export function checkTaskDraft(raw: { kind: unknown; section: unknown; label: unknown; sopRef: unknown; sortOrder: unknown }): Checked<TaskDraft> {
  if (!isChecklistKind(raw.kind)) return { ok: false, message: "Choose which list the task is on. Nothing was saved." };
  const label = String(raw.label ?? "").trim();
  if (label.length < 1 || label.length > 300) return { ok: false, message: "The task needs wording (up to 300 characters). Nothing was saved." };
  const section = (String(raw.section ?? "").trim() || "GENERAL").toUpperCase();
  if (section.length > 80) return { ok: false, message: "The section name is longer than 80 characters. Nothing was saved." };
  const sopRef = String(raw.sopRef ?? "").trim();
  if (sopRef.length > 200) return { ok: false, message: "The SOP reference is longer than 200 characters. Nothing was saved." };
  const n = Number(String(raw.sortOrder ?? "").trim() || "0");
  if (!Number.isInteger(n) || n < 0 || n > 100000) return { ok: false, message: "Order is a whole number (0 or more). Nothing was saved." };
  return { ok: true, value: { kind: raw.kind, section, label, sopRef: sopRef || null, sortOrder: n } };
}

// ── SOP references become links ──────────────────────────────────────────

/** Screens named on the forms, and where they live. */
export const CHECKLIST_SCREENS: Record<string, string> = {
  "Online Orders": "/admin/orders",
  "Marketing & Advertising": "/admin/marketing",
  "Creative Studio": "/admin/marketing/midjourney",
  "Shop Banner": "/admin/content/shop-banner",
  "Schedule & Releases": "/admin/content/schedule",
  Specials: "/admin/specials",
  "Email Newsletter": "/admin/newsletter",
  "Blog & Newsletter": "/admin/blog",
  "Product Enrichment": "/admin/products",
  "Catalog Hub": "/admin/catalog",
  "Regulatory Watch": "/admin/compliance/regulatory",
  "Cycle Counts": "/admin/inventory/cycle-counts",
};

/** Fix Phase 4.5b: the clearance markdown screen (F-06-17). */
export const CLEARANCE_SCREEN = "/admin/promotions/clearance";

export type RefLink = { text: string; href: string | null; note?: string };

/**
 * What the page knows about the SOP library: the slugs that exist, and for
 * each, its section headings (id + text) so "§4.16" finds its anchor.
 */
export type SopIndex = Record<string, { id: string; text: string }[]>;

const SOP_LIBRARY = "/admin/staffing/sop-library";

function sopLink(slug: string, section: string | null, index: SopIndex, text: string): RefLink {
  const sections = index[slug];
  if (!sections) return { text, href: null, note: "SOP not written yet" };
  if (section) {
    const hit = sections.find((s) => s.text.startsWith(`${section} `) || s.text === section);
    if (hit) return { text, href: `${SOP_LIBRARY}/${slug}#${hit.id}` };
  }
  return { text, href: `${SOP_LIBRARY}/${slug}` };
}

/**
 * Turn a task's label and SOP reference into links: "SOP-05a §4.16" opens
 * that section in the SOP Library; "§4.24" is SOP-06's own section; a screen
 * name opens the screen; "owner-directed D57" and statutes stay text.
 */
export function referenceLinks(label: string, sopRef: string | null, index: SopIndex): RefLink[] {
  const out: RefLink[] = [];
  const seen = new Set<string>();
  const push = (l: RefLink) => {
    const k = `${l.text}|${l.href}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(l);
    }
  };
  const sopRe = /SOP-(\d{2}[a-z]?)(?:\s*\u00a7\s*(\d+(?:\.\d+)?))?/g;
  for (const m of label.matchAll(sopRe)) {
    push(sopLink(`sop-${m[1]!.toLowerCase()}`, m[2] ?? null, index, m[0]));
  }
  for (const partRaw of (sopRef ?? "").split(";")) {
    const part = partRaw.trim();
    if (!part) continue;
    const own = /^\u00a7\s*(\d+(?:\.\d+)?)/.exec(part);
    if (own) {
      push(sopLink("sop-06", own[1]!, index, part));
      continue;
    }
    const sop = /^(?:SEO\s+)?SOP-(\d{2}[a-z]?)(?:\s*\u00a7\s*(\d+(?:\.\d+)?))?/.exec(part);
    if (sop) {
      push(sopLink(`sop-${sop[1]!.toLowerCase()}`, sop[2] ?? null, index, part));
      continue;
    }
    const screens = part.split(/\s*\/\s*|\s*,\s*/).filter(Boolean);
    if (screens.length > 0 && screens.every((s) => CHECKLIST_SCREENS[s])) {
      for (const s of screens) push({ text: s, href: CHECKLIST_SCREENS[s]! });
      continue;
    }
    push({ text: part, href: null });
  }
  // Fix Phase 4.5b (F-06-17, G-38): a task about markdowns opens the
  // Clearance screen. It needs promotions.manage, so the note says who.
  if (/markdown/i.test(label)) push({ text: "Clearance markdowns", href: CLEARANCE_SCREEN, note: "owner or manager" });
  return out;
}

// ── The live Cycle Counts line ───────────────────────────────────────────

export type QueueJob = { status: string; claimedByName: string | null; label: string };

/** "2 counts waiting on Cycle Counts: 1 not started, 1 being counted by Ana." */
export function describeCountsLine(jobs: readonly QueueJob[] | null): string {
  if (jobs === null) return "Could not read the Cycle Counts page. Open it and check by eye.";
  if (jobs.length === 0) return "No counts waiting on Cycle Counts right now.";
  const notStarted = jobs.filter((j) => !j.claimedByName).length;
  const counting = jobs.filter((j) => j.claimedByName);
  const names = [...new Set(counting.map((j) => j.claimedByName!))];
  const bits: string[] = [];
  if (notStarted) bits.push(`${notStarted} not started`);
  if (counting.length) bits.push(`${counting.length} being counted by ${names.join(", ")}`);
  return `${jobs.length} count${jobs.length === 1 ? "" : "s"} waiting on Cycle Counts: ${bits.join(", ")}.`;
}

// ── Self-test ────────────────────────────────────────────────────────────

export function __runDailyChecklistCoreTests(): number {
  let n = 0;
  const ok = (c: boolean, m: string) => {
    if (!c) throw new Error(`daily-checklist-core: ${m}`);
    n++;
  };
  ok(checklistPeriodKey("opening", "2026-10-30") === "2026-10-30", "daily sheet is the day");
  ok(checklistPeriodKey("weekly", "2026-10-30") === "2026-10-26", "Friday -> Monday");
  ok(checklistPeriodKey("weekly", "2026-10-26") === "2026-10-26", "Monday stays");
  ok(checklistPeriodKey("weekly", "2026-11-01") === "2026-10-26", "Sunday -> previous Monday");
  ok(checklistPeriodKey("monthly", "2026-10-30") === "2026-10-01", "first of month");
  ok(checklistPeriodKey("yearly", "2026-10-30") === "2026-01-01", "1 January");
  let threw = false;
  try {
    checklistPeriodKey("opening", "30/10/2026");
  } catch {
    threw = true;
  }
  ok(threw, "a bad day is refused");
  ok(describePeriod("weekly", "2026-10-26").startsWith("Week of Mon"), "week label");
  ok(describePeriod("monthly", "2026-10-01") === "October 2026", "month label");

  ok(canInitial("staff", "opening") && canInitial("staff", "closing"), "a budtender initials daily lists (D51)");
  ok(!canInitial("staff", "weekly") && canInitial("manager", "weekly"), "weekly is the manager's (form 8.8)");
  ok(!canInitial("readonly", "opening") && !canInitial("content_editor", "opening"), "non-floor roles cannot initial");
  ok(canSignOff("manager") && !canSignOff("staff"), "manager sign-off");
  ok(canEditCatalog("owner") && !canEditCatalog("admin") && !canEditCatalog("manager"), "the owner edits the catalog (D57)");

  ok(suggestInitials("Michael Lyman") === "ML", "initials from name");
  ok(suggestInitials("ana@greenway.com") === "A", "initials from email");
  const i = checkInitials(" m.l ");
  ok(i.ok && i.value === "ML", "initials normalised");
  ok(!checkInitials("12").ok && !checkInitials("ABCDE").ok && !checkInitials("").ok, "bad initials refused");

  ok(checkSignOff({ openTasks: 0, note: "" }).ok, "all done needs no note");
  const s = checkSignOff({ openTasks: 2, note: "" });
  ok(!s.ok && s.message.includes("2 tasks are not initialled"), "open tasks need a note");
  ok(checkSignOff({ openTasks: 2, note: "short-staffed" }).ok, "note given");

  const d = checkTaskDraft({ kind: "opening", section: "sales floor", label: " Wipe glass ", sopRef: "", sortOrder: "15" });
  ok(d.ok && d.value.section === "SALES FLOOR" && d.value.label === "Wipe glass" && d.value.sopRef === null && d.value.sortOrder === 15, "task draft normalised");
  ok(!checkTaskDraft({ kind: "nope", section: "", label: "x", sopRef: "", sortOrder: "" }).ok, "bad list refused");
  ok(!checkTaskDraft({ kind: "opening", section: "", label: " ", sopRef: "", sortOrder: "" }).ok, "empty wording refused");

  const idx: SopIndex = {
    "sop-05a": [{ id: "416-expired-and-expiring-stock", text: "4.16 Expired and expiring stock" }],
    "sop-06": [{ id: "424-the-counting-programme", text: "4.24 The counting programme" }],
    "sop-01": [],
  };
  const a = referenceLinks("Expired lots checked", "SOP-05a \u00a74.16", idx);
  ok(a.length === 1 && a[0]!.href === "/admin/staffing/sop-library/sop-05a#416-expired-and-expiring-stock", "SOP section anchor");
  const b = referenceLinks("Rotation on track", "\u00a74.24; G-41", idx);
  ok(b[0]!.href === "/admin/staffing/sop-library/sop-06#424-the-counting-programme" && b[1]!.href === null, "own section + plain text");
  const c = referenceLinks("Social media post published", "Marketing & Advertising / Creative Studio; SOP-11", idx);
  ok(c[0]!.href === "/admin/marketing" && c[1]!.href === "/admin/marketing/midjourney" && c[2]!.href === null && c[2]!.note === "SOP not written yet", "screens + unwritten SOP");
  const e = referenceLinks("SOP-01 form 8.1 shift-open checklist done (each register)", null, idx);
  ok(e.length === 1 && e[0]!.href === "/admin/staffing/sop-library/sop-01", "SOP named in the label");
  ok(referenceLinks("Lights on", "owner-directed D57", idx)[0]!.href === null, "owner-directed stays text");
  const md = referenceLinks("Expiring-within-30-days list read; units fronted; list given to owner for markdown", "\u00a74.23", idx);
  ok(md.some((l) => l.href === CLEARANCE_SCREEN && l.note === "owner or manager"), "markdown task opens the Clearance screen (F-06-17)");

  ok(describeCountsLine([]) === "No counts waiting on Cycle Counts right now.", "no counts");
  ok(
    describeCountsLine([
      { status: "scope_approved", claimedByName: null, label: "A" },
      { status: "counting", claimedByName: "Ana", label: "B" },
    ]) === "2 counts waiting on Cycle Counts: 1 not started, 1 being counted by Ana.",
    "live line",
  );
  ok(describeCountsLine(null).startsWith("Could not read"), "a failed read is said, never 'none'");
  return n;
}
