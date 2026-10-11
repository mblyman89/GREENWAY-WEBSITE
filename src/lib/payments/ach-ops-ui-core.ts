/**
 * src/lib/payments/ach-ops-ui-core.ts  (R39 S7 part 2)
 *
 * Pure words for the Operations page and its actions: the "who was told / who
 * to call" line, the site address for links in owner emails, the notice
 * urgency label, the monitoring summary, and the hold-release form hint.
 * No I/O.
 */
import { noticeUrgency, type OpenNoticeRow } from "./ach-return-log-core";
import type { MonitorReport } from "./ach-ops-core";

/** The public site. The owner set NEXT_PUBLIC_SITE_URL to this; it is the fallback. */
export const CANONICAL_SITE = "https://www.greenwaymarijuana.com";

/** https origin from NEXT_PUBLIC_SITE_URL, or the canonical site. Never http, never a path. */
export function opsSiteUrl(env: Readonly<Record<string, string | undefined>>): string {
  const raw = (env.NEXT_PUBLIC_SITE_URL ?? "").trim();
  try {
    const u = new URL(raw);
    if (u.protocol === "https:" && u.hostname && !u.username && !u.password) return u.origin;
  } catch {
    /* fall through */
  }
  return CANONICAL_SITE;
}

/** One sentence: was the email sent, who to phone, whose number is missing. */
export function opsNoticeLine(o: { emailed: boolean; detail: string; call: readonly string[]; missingPhones: readonly string[] }): string {
  const parts: string[] = [];
  parts.push(o.emailed ? "The owners and the store were emailed." : `The email did NOT go out (${o.detail.slice(0, 120)}): tell them yourself.`);
  if (o.call.length) parts.push(`Call: ${o.call.join("; ")}.`);
  if (o.missingPhones.length) parts.push(`No phone on file for ${o.missingPhones.join(", ")} (set ACH_NOTIFY_*_PHONE in Vercel).`);
  return parts.join(" ");
}

export function noticeUrgencyLabel(r: OpenNoticeRow, todayIso: string): { text: string; tone: "danger" | "warning" | "neutral" } {
  const u = noticeUrgency(r, todayIso);
  if (u === "overdue") return { text: r.apply_by ? `Apply-by ${r.apply_by} has passed` : "Overdue", tone: "danger" };
  if (u === "due_soon") return { text: `Apply by ${r.apply_by}`, tone: "warning" };
  return { text: r.notice_kind === "noc" ? `Apply by ${r.apply_by ?? "-"}` : "Open", tone: "neutral" };
}

/** The monitoring box, in words. */
export function monitorSummary(m: MonitorReport): { headline: string; tone: "ok" | "look" } {
  const headline = `Test credits sent: ${m.sent30} in the last 30 days (${m.returned30} came back); ${m.sent365} in the last year (${m.returned365} came back).`;
  return { headline, tone: m.flags.length ? "look" : "ok" };
}

/** Hint above the release form: will this be a solo release? */
export function releaseHint(actorId: string, holdEnteredBy: string | null): string {
  if (holdEnteredBy === null) return "Nobody is recorded as having put this on hold, so releasing it counts as one person: write a reason of 20+ characters. The other owner is emailed.";
  if (holdEnteredBy === actorId) return "You put this on hold, so releasing it yourself counts as one person: write a reason of 20+ characters. The other owner is emailed.";
  return "Someone else put this on hold, so your release is the second person. A reason is optional.";
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runAchOpsUiCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`  ✗ ach-ops-ui-core: ${m}`);
    }
  };
  ok(opsSiteUrl({ NEXT_PUBLIC_SITE_URL: "https://www.greenwaymarijuana.com/" }) === "https://www.greenwaymarijuana.com", "trailing slash dropped");
  ok(opsSiteUrl({ NEXT_PUBLIC_SITE_URL: "https://preview.example.com/admin" }) === "https://preview.example.com", "path dropped");
  ok(opsSiteUrl({ NEXT_PUBLIC_SITE_URL: "http://www.greenwaymarijuana.com" }) === CANONICAL_SITE, "http refused");
  ok(opsSiteUrl({ NEXT_PUBLIC_SITE_URL: "https://user:pw@evil.example" }) === CANONICAL_SITE, "credentials refused");
  ok(opsSiteUrl({ NEXT_PUBLIC_SITE_URL: "javascript:alert(1)" }) === CANONICAL_SITE, "javascript refused");
  ok(opsSiteUrl({}) === CANONICAL_SITE, "unset -> canonical");
  ok(opsSiteUrl({ NEXT_PUBLIC_SITE_URL: "  " }) === CANONICAL_SITE, "blank -> canonical");

  const l1 = opsNoticeLine({ emailed: true, detail: "emailed 3", call: ["Stephen at 360-555-0101"], missingPhones: ["Michael"] });
  ok(l1 === "The owners and the store were emailed. Call: Stephen at 360-555-0101. No phone on file for Michael (set ACH_NOTIFY_*_PHONE in Vercel).", "full line");
  const l2 = opsNoticeLine({ emailed: false, detail: "provider 500", call: [], missingPhones: [] });
  ok(l2 === "The email did NOT go out (provider 500): tell them yourself.", "failed email, nothing else");
  ok(!/Call:/.test(l2) && !/No phone/.test(l2), "empty lists add nothing");

  const T = "2026-10-05";
  ok(noticeUrgencyLabel({ id: "n", notice_kind: "noc", code: "C01", received_on: "2026-09-01", apply_by: "2026-09-10" }, T).tone === "danger", "past apply-by is danger");
  ok(noticeUrgencyLabel({ id: "n", notice_kind: "return", code: "R01", received_on: "2026-10-02", apply_by: null }, T).text === "Open", "return is Open");

  const m0 = monitorSummary({ sent30: 1, returned30: 0, sent365: 3, returned365: 1, flags: [] });
  ok(m0.tone === "ok" && m0.headline === "Test credits sent: 1 in the last 30 days (0 came back); 3 in the last year (1 came back).", "summary words");
  ok(monitorSummary({ sent30: 0, returned30: 0, sent365: 0, returned365: 0, flags: ["x"] }).tone === "look", "any flag -> look");

  ok(/one person/.test(releaseHint("a", null)), "unknown author is solo");
  ok(/one person/.test(releaseHint("a", "a")), "own hold is solo");
  ok(/second person/.test(releaseHint("a", "b")), "other's hold is dual");
  return { passed, failed };
}
