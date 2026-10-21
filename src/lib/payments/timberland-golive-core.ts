/**
 * src/lib/payments/timberland-golive-core.ts   (R41 S9, plan point 1)
 *
 * The Go-Live Readiness board: one screen of gates, each green, red, grey
 * (information) or "could not be read", with a deep link. Pure.
 *
 * It NEVER blocks paying by check. Red only explains. Nothing here is a
 * permission check; the real locks are elsewhere (achGate, the 0271-0276
 * database guards, the first-file gate, the limits).
 *
 * Honesty rules:
 *   - A value that could not be read is "unread", never green.
 *   - Things the app cannot know are not guessed. Example: which login, if
 *     any, belongs to Alyssa. The board lists every active owner and admin by
 *     name so Michael can see it himself; it enforces only what code can know
 *     (exactly one active owner; ACH roles are owner and admin only).
 *   - Dual approval at Timberland is information, never red (owner's choice,
 *     signed Schedule C).
 */
import { shortDate } from "@/lib/payments/timberland-deadline-core";
import { centsToUsdText } from "@/lib/payments/timberland-profile-core";

export type GateTone = "green" | "red" | "info" | "unread";

export type GoLiveGate = { id: string; title: string; tone: GateTone; detail: string; href: string; hrefLabel: string };

export type GoLiveStaff = { name: string; role: string; active: boolean };

export type GoLiveInput = {
  todayIso: string;
  nowUtc: Date;
  /** Calendar "Timberland agreement" task done (the signed agreement is on file with Michael). */
  contractOnFile: boolean;
  countersigned: boolean;
  scheduleGEmail: boolean;
  accessReady: boolean;
  dualApprovalOn: boolean;
  /** Active and inactive staff with their roles; null = could not be read. */
  staff: GoLiveStaff[] | null;
  /** The roles that may reach ACH (from roles.ts "ach.request"). */
  achRoles: readonly string[];
  /** Owner inbox; null = could not be read. */
  waitingForOwner: { pending: number; toReview: number } | null;
  matchConfirmed: boolean | null;
  encryptionConfigured: boolean;
  /** 0258-0263 (vault and operations tables). */
  migrationsReady: boolean;
  /** The first-file gate (S7); null = could not be read. */
  firstFile: { open: boolean; stage: string | null; line: string } | null;
  /** Timberland room left (S4); null = could not be read. */
  room: { todayRoomCents: number; monthRoomCents: number; todayWarn: boolean; monthWarn: boolean } | null;
  /** The earliest open file's upload deadline (S5); null = could not be read, "none" = nothing waiting. */
  nextDeadline: { filename: string; day: string; text: string; cutoffUtc: Date } | "none" | null;
};

export const GO_LIVE_LINKS = {
  calendar: "/admin/settings/banking/calendar",
  company: "/admin/settings/banking?tab=company",
  staff: "/admin/users",
  approvals: "/admin/settings/banking/approvals",
  operations: "/admin/settings/banking/operations",
  files: "/admin/settings/banking/operations#files",
  checks: "/admin/settings/banking/operations#checks",
  migrations: "/admin/settings/banking/guide#migrations",
  checker: "/admin/settings/banking/checker",
  library: "/admin/settings/banking/library#timberland",
} as const;

const UNREAD = "Could not be read. Reload the page; this is never counted as done.";

function usd(c: number): string {
  return `$${centsToUsdText(c)}`;
}

/** Hours and minutes from now to a moment ("2 h 05 min"); "passed" if it is behind us. */
export function countdown(nowUtc: Date, to: Date): string {
  const ms = to.getTime() - nowUtc.getTime();
  if (ms <= 0) return "passed";
  const totalMin = Math.floor(ms / 60_000);
  const days = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (days > 0) return `${days} day${days === 1 ? "" : "s"} ${h} h`;
  return `${h} h ${String(m).padStart(2, "0")} min`;
}

/** The ACH access check (D-9). */
export function accessGate(staff: GoLiveStaff[] | null, achRoles: readonly string[]): GoLiveGate {
  const base = { id: "access", title: "Who can reach ACH in the app", href: GO_LIVE_LINKS.staff, hrefLabel: "Open staff logins" };
  if (staff === null) return { ...base, tone: "unread", detail: UNREAD };
  const rolesOk = achRoles.length === 2 && achRoles.includes("owner") && achRoles.includes("admin");
  const active = staff.filter((s) => s.active);
  const owners = active.filter((s) => s.role === "owner");
  const withAch = active.filter((s) => achRoles.includes(s.role));
  const names = withAch.map((s) => `${s.name} (${s.role})`).join(", ") || "nobody";
  if (!rolesOk) return { ...base, tone: "red", detail: `The app's ACH roles are ${achRoles.join(", ") || "none"}; they must be exactly owner and admin. This is a code problem: tell the developer.` };
  if (owners.length !== 1) {
    return { ...base, tone: "red", detail: `There must be exactly one active owner login; there ${owners.length === 1 ? "is" : "are"} ${owners.length}. Only the owner releases, voids, uploads or confirms funding. People with ACH access now: ${names}.` };
  }
  return { ...base, tone: "green", detail: `One active owner. People with ACH access: ${names}. Check this list yourself: anyone who should not be here (for example a login for a contact who is not staff) must be changed to a role without ACH, or turned off.` };
}

export function buildGoLiveBoard(i: GoLiveInput): GoLiveGate[] {
  const g: GoLiveGate[] = [];
  const yes = (b: boolean): GateTone => (b ? "green" : "red");

  g.push({
    id: "contract",
    title: "Timberland agreement on file",
    tone: yes(i.contractOnFile),
    detail: i.contractOnFile ? "Marked done on the calendar (signed by you 10/13/26 and by Timberland 10/14/26; the PDF stays with you, not on the website)." : "Mark the 'Timberland agreement' task done on the calendar once the signed copy is filed.",
    href: GO_LIVE_LINKS.calendar,
    hrefLabel: "Open the calendar",
  });
  g.push({
    id: "countersigned",
    title: "Countersigned copy from Timberland",
    tone: yes(i.countersigned),
    detail: i.countersigned ? "Recorded on the calendar." : "Timberland countersigned on 10/14/26 (ACH_Agreement_10-14-26.pdf). Keep that copy with your banking records, then mark the task done on the calendar.",
    href: GO_LIVE_LINKS.calendar,
    hrefLabel: "Open the calendar",
  });
  g.push({
    id: "schedule-g",
    title: "Schedule G email confirmed by Timberland",
    tone: yes(i.scheduleGEmail),
    detail: i.scheduleGEmail ? "Recorded on the calendar." : "Brenda answered (Email 3, item B): \"I have this correct in the system.  No need to correct document.\" Record that on the calendar. Until it is recorded, watch the portal itself for security notices.",
    href: GO_LIVE_LINKS.calendar,
    hrefLabel: "Open the calendar",
  });
  g.push({
    id: "dual",
    title: "Dual approval at Timberland",
    tone: "info",
    detail: i.dualApprovalOn ? "On at Timberland: a second Timberland user approves each file." : "Off by your choice (signed Schedule C). Information only.",
    href: GO_LIVE_LINKS.library,
    hrefLabel: "Read the agreement",
  });
  g.push(accessGate(i.staff, i.achRoles));
  g.push(
    i.waitingForOwner === null
      ? { id: "inbox", title: "Nothing waiting in your approvals inbox", tone: "unread", detail: UNREAD, href: GO_LIVE_LINKS.approvals, hrefLabel: "Open approvals" }
      : {
          id: "inbox",
          title: "Nothing waiting in your approvals inbox",
          tone: yes(i.waitingForOwner.pending + i.waitingForOwner.toReview === 0),
          detail:
            i.waitingForOwner.pending + i.waitingForOwner.toReview === 0
              ? "No requests or reviews waiting."
              : `${i.waitingForOwner.pending} request(s) and ${i.waitingForOwner.toReview} review(s) are waiting for you.`,
          href: GO_LIVE_LINKS.approvals,
          hrefLabel: "Open approvals",
        },
  );
  g.push({
    id: "match",
    title: "Match card confirmed by Timberland",
    tone: i.matchConfirmed === null ? "unread" : yes(i.matchConfirmed),
    detail: i.matchConfirmed === null ? UNREAD : i.matchConfirmed ? "The 'Timberland confirmed on ___' stamp is set." : "On My banking, read the match card to Timberland and record their confirmation.",
    href: GO_LIVE_LINKS.company,
    hrefLabel: "Open My banking",
  });
  g.push({
    id: "encryption",
    title: "Encryption key set",
    tone: yes(i.encryptionConfigured),
    detail: i.encryptionConfigured ? "Bank details and released files are encrypted at rest." : "The encryption key is not set in Vercel, so no bank detail or file can be saved.",
    href: GO_LIVE_LINKS.migrations,
    hrefLabel: "How to fix",
  });
  g.push({
    id: "migrations",
    title: "Database migrations applied",
    tone: yes(i.migrationsReady),
    detail: i.migrationsReady ? "The ACH vault and operations tables are in place. The newer ledger steps (0273-0276) name themselves if missing when used." : "The ACH tables are not in the database yet.",
    href: GO_LIVE_LINKS.migrations,
    hrefLabel: "Step-by-step",
  });
  g.push({
    id: "access-ready",
    title: "Brenda says cash management access is ready",
    tone: yes(i.accessReady),
    detail: i.accessReady ? "Recorded on the calendar." : "Brenda will tell you when the separate cash management login is set up. Then press Done on the calendar.",
    href: GO_LIVE_LINKS.calendar,
    hrefLabel: "Open the calendar",
  });
  if (i.firstFile === null) {
    g.push({ id: "prenote", title: "First prenote processed by Timberland", tone: "unread", detail: UNREAD, href: GO_LIVE_LINKS.checks, hrefLabel: "Open account checks" });
    g.push({ id: "wait", title: "The 6-banking-day wait is over", tone: "unread", detail: UNREAD, href: GO_LIVE_LINKS.checks, hrefLabel: "Open account checks" });
  } else {
    const prenoteDone = i.firstFile.open || i.firstFile.stage === "waiting";
    g.push({
      id: "prenote",
      title: "First prenote processed by Timberland",
      tone: yes(prenoteDone),
      detail: prenoteDone ? "A prenote file was approved at Timberland and a prenote passed." : i.firstFile.line,
      href: GO_LIVE_LINKS.checks,
      hrefLabel: "Open account checks",
    });
    g.push({
      id: "wait",
      title: "The 6-banking-day wait is over",
      tone: yes(i.firstFile.open),
      detail: i.firstFile.line,
      href: GO_LIVE_LINKS.checks,
      hrefLabel: "Open account checks",
    });
  }
  g.push(
    i.room === null
      ? { id: "room", title: "Room left under Timberland's limits", tone: "unread", detail: UNREAD, href: GO_LIVE_LINKS.operations, hrefLabel: "Open operations" }
      : {
          id: "room",
          title: "Room left under Timberland's limits",
          tone: i.room.todayRoomCents === 0 || i.room.monthRoomCents === 0 ? "red" : "green",
          detail: `Today ${usd(i.room.todayRoomCents)} of $50,000.00; this month ${usd(i.room.monthRoomCents)} of $100,000.00.${i.room.todayWarn || i.room.monthWarn ? " Over 80% used." : ""}`,
          href: GO_LIVE_LINKS.operations,
          hrefLabel: "Open operations",
        },
  );
  if (i.nextDeadline === null) g.push({ id: "deadline", title: "Next upload deadline", tone: "unread", detail: UNREAD, href: GO_LIVE_LINKS.files, hrefLabel: "Open released files" });
  else if (i.nextDeadline === "none") g.push({ id: "deadline", title: "Next upload deadline", tone: "info", detail: "No released file is waiting to go to Timberland.", href: GO_LIVE_LINKS.files, hrefLabel: "Open released files" });
  else {
    const left = countdown(i.nowUtc, i.nextDeadline.cutoffUtc);
    g.push({
      id: "deadline",
      title: "Next upload deadline",
      tone: left === "passed" ? "red" : "info",
      detail: `${i.nextDeadline.filename}: upload and approve by ${i.nextDeadline.text} (${shortDate(i.nextDeadline.day)}). ${left === "passed" ? "The deadline has passed: void it and pay by check if it was not approved." : `${left} left. Run the file checker first.`}`,
      href: GO_LIVE_LINKS.files,
      hrefLabel: "Open released files",
    });
  }
  return g;
}

export function goLiveSummary(gates: readonly GoLiveGate[]): { green: number; red: number; unread: number; info: number; line: string } {
  const c = { green: 0, red: 0, unread: 0, info: 0 };
  for (const x of gates) c[x.tone] += 1;
  const line =
    c.red + c.unread === 0
      ? "Every gate is green. You are ready for live ACH."
      : `${c.red} red${c.unread ? `, ${c.unread} could not be read` : ""}. Red only explains: paying by check always works.`;
  return { ...c, line };
}

// ------------------------------------------------------------ self-tests ---

export function __runTimberlandGoLiveCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, n: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`timberland-golive-core FAIL: ${n}`);
    }
  };
  const now = new Date("2026-10-19T17:00:00Z"); // Mon 10:00 am PDT
  const all: GoLiveInput = {
    todayIso: "2026-10-19",
    nowUtc: now,
    contractOnFile: true,
    countersigned: true,
    scheduleGEmail: true,
    accessReady: true,
    dualApprovalOn: false,
    staff: [
      { name: "Michael", role: "owner", active: true },
      { name: "Stephen", role: "admin", active: true },
      { name: "Clerk", role: "staff", active: true },
      { name: "Old owner", role: "owner", active: false },
    ],
    achRoles: ["owner", "admin"],
    waitingForOwner: { pending: 0, toReview: 0 },
    matchConfirmed: true,
    encryptionConfigured: true,
    migrationsReady: true,
    firstFile: { open: true, stage: null, line: "Live ACH is open." },
    room: { todayRoomCents: 5_000_000, monthRoomCents: 10_000_000, todayWarn: false, monthWarn: false },
    nextDeadline: "none",
  };
  const b = buildGoLiveBoard(all);
  const tone = (gs: GoLiveGate[], id: string) => gs.find((x) => x.id === id)?.tone;
  ok(b.length === 14, "fourteen gates");
  ok(new Set(b.map((x) => x.id)).size === b.length, "gate ids unique");
  ok(b.map((x) => x.id).join(",") === "contract,countersigned,schedule-g,dual,access,inbox,match,encryption,migrations,access-ready,prenote,wait,room,deadline", "gate order matches the plan");
  ok(b.every((x) => x.href.startsWith("/admin/")), "every gate deep-links inside the admin");
  const s = goLiveSummary(b);
  ok(s.red === 0 && s.unread === 0 && /ready for live ACH/.test(s.line), "all green summary");
  ok(tone(b, "dual") === "info" && tone(buildGoLiveBoard({ ...all, dualApprovalOn: true }), "dual") === "info", "dual approval is information either way, never red");
  ok(tone(buildGoLiveBoard({ ...all, scheduleGEmail: false }), "schedule-g") === "red", "Schedule G email not confirmed is red (plan v4)");
  ok(/watch the portal/.test(buildGoLiveBoard({ ...all, scheduleGEmail: false }).find((x) => x.id === "schedule-g")!.detail), "Schedule G strict default: watch the portal");
  ok(tone(buildGoLiveBoard({ ...all, countersigned: false }), "countersigned") === "red", "not countersigned is red");
  ok(tone(buildGoLiveBoard({ ...all, contractOnFile: false }), "contract") === "red", "contract not marked is red");
  ok(tone(buildGoLiveBoard({ ...all, accessReady: false }), "access-ready") === "red", "access not ready is red");
  ok(tone(buildGoLiveBoard({ ...all, encryptionConfigured: false }), "encryption") === "red", "no key is red");
  ok(tone(buildGoLiveBoard({ ...all, migrationsReady: false }), "migrations") === "red", "no tables is red");
  ok(tone(buildGoLiveBoard({ ...all, matchConfirmed: false }), "match") === "red" && tone(buildGoLiveBoard({ ...all, matchConfirmed: null }), "match") === "unread", "match card red / unread");

  // access gate
  const ag = accessGate(all.staff, all.achRoles);
  ok(ag.tone === "green" && /Michael \(owner\), Stephen \(admin\)/.test(ag.detail) && !/Clerk/.test(ag.detail) && !/Old owner/.test(ag.detail), "access lists active owner/admin only");
  ok(/Check this list yourself/.test(ag.detail), "access asks Michael to look (Alyssa is not guessed)");
  ok(accessGate([...all.staff!, { name: "Second", role: "owner", active: true }], all.achRoles).tone === "red", "two active owners is red");
  ok(accessGate([{ name: "Stephen", role: "admin", active: true }], all.achRoles).tone === "red", "no active owner is red");
  ok(accessGate(all.staff, ["owner", "admin", "manager"]).tone === "red", "a third ACH role is red (code problem)");
  ok(accessGate(all.staff, ["owner"]).tone === "red", "a missing admin role is red too (must be exactly owner+admin)");
  ok(accessGate(null, all.achRoles).tone === "unread", "unreadable staff is unread, never green");

  // inbox
  ok(tone(buildGoLiveBoard({ ...all, waitingForOwner: { pending: 1, toReview: 0 } }), "inbox") === "red", "a pending request is red");
  ok(tone(buildGoLiveBoard({ ...all, waitingForOwner: { pending: 0, toReview: 2 } }), "inbox") === "red", "a review to check off is red");
  ok(tone(buildGoLiveBoard({ ...all, waitingForOwner: null }), "inbox") === "unread", "unreadable inbox is unread");

  // first file
  const ff = (f: GoLiveInput["firstFile"]) => buildGoLiveBoard({ ...all, firstFile: f });
  ok(tone(ff({ open: false, stage: "no_file", line: "Send a prenote file." }), "prenote") === "red" && tone(ff({ open: false, stage: "no_file", line: "x" }), "wait") === "red", "no prenote file: both red");
  ok(tone(ff({ open: false, stage: "waiting", line: "Wait until Oct 28." }), "prenote") === "green" && tone(ff({ open: false, stage: "waiting", line: "x" }), "wait") === "red", "waiting: prenote green, wait red");
  ok(ff({ open: false, stage: "waiting", line: "Wait until Oct 28." }).find((x) => x.id === "wait")!.detail === "Wait until Oct 28.", "the wait gate shows the gate's own line");
  ok(tone(ff(null), "prenote") === "unread" && tone(ff(null), "wait") === "unread", "unreadable first-file gate: both unread");

  // room
  ok(tone(buildGoLiveBoard({ ...all, room: { ...all.room!, todayRoomCents: 0 } }), "room") === "red", "no room today is red");
  ok(tone(buildGoLiveBoard({ ...all, room: { ...all.room!, monthRoomCents: 0 } }), "room") === "red", "no room this month is red");
  ok(/Over 80%/.test(buildGoLiveBoard({ ...all, room: { ...all.room!, todayWarn: true } }).find((x) => x.id === "room")!.detail), "80% warning shown");
  ok(/\$50,000\.00 of \$50,000\.00/.test(b.find((x) => x.id === "room")!.detail), "room in dollars");
  ok(tone(buildGoLiveBoard({ ...all, room: null }), "room") === "unread", "unreadable room is unread");

  // deadline
  const dl = { filename: "GW-PAY.ach", day: "2026-10-19", text: "3:30 pm Pacific (Timberland's cutoff is 4:00 pm)", cutoffUtc: new Date("2026-10-19T23:00:00Z") };
  const d1 = buildGoLiveBoard({ ...all, nextDeadline: dl }).find((x) => x.id === "deadline")!;
  ok(d1.tone === "info" && /6 h 00 min left/.test(d1.detail) && /GW-PAY\.ach/.test(d1.detail) && /file checker/.test(d1.detail), "countdown shown, checker named");
  const d2 = buildGoLiveBoard({ ...all, nowUtc: new Date("2026-10-19T23:00:00Z"), nextDeadline: dl }).find((x) => x.id === "deadline")!;
  ok(d2.tone === "red" && /pay by check/.test(d2.detail), "passed deadline is red, check named");
  ok(tone(buildGoLiveBoard({ ...all, nextDeadline: null }), "deadline") === "unread", "unreadable deadline is unread");
  ok(tone(b, "deadline") === "info", "nothing waiting is information");

  // countdown
  ok(countdown(now, new Date(now.getTime() + 65 * 60_000)) === "1 h 05 min", "countdown h/min");
  ok(countdown(now, new Date(now.getTime() + 26 * 3600_000)) === "1 day 2 h", "countdown days");
  ok(countdown(now, new Date(now.getTime() + 3 * 86_400_000)) === "3 days 0 h", "countdown plural days");
  ok(countdown(now, now) === "passed" && countdown(now, new Date(now.getTime() - 1)) === "passed", "countdown passed");

  // summary
  const bad = goLiveSummary(buildGoLiveBoard({ ...all, countersigned: false, staff: null }));
  ok(bad.red === 1 && bad.unread === 1 && /paying by check always works/.test(bad.line) && /1 could not be read/.test(bad.line), "summary counts red and unread, names checks");
  ok(!buildGoLiveBoard({ ...all, countersigned: false }).some((x) => /blocked|cannot pay/i.test(x.detail)), "no gate claims payments are blocked");

  console.log(`timberland-golive-core: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
