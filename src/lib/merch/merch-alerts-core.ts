/**
 * src/lib/merch/merch-alerts-core.ts  (D232 slice M-7, SOP-11 G-85)
 *
 * PURE rules for the merch alerts inbox (migration 0361 merch_alerts):
 *   - readAlertPost: the shop's POST body -> a clean alert, or a reason it was
 *     refused. Subject <= 300 characters, at most 20 lines of <= 500.
 *   - alertOrderRef: the first gm- order reference named in the alert.
 * The fingerprint (SHA-256 of subject + lines) is made by the server file.
 */

export const ALERT_SUBJECT_MAX = 300;
export const ALERT_LINE_MAX = 500;
export const ALERT_LINES_MAX = 20;
export const MERCH_ALERTS_TABLE = "merch_alerts";

export type CleanAlert = { subject: string; lines: string[]; orderRef: string | null };

const clean = (s: string, max: number) => s.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim().slice(0, max);

export function alertOrderRef(subject: string, lines: readonly string[]): string | null {
  const m = /\bgm-[a-z0-9]{6,12}-[a-z0-9]{1,8}\b/.exec([subject, ...lines].join(" "));
  return m ? m[0] : null;
}

export function readAlertPost(raw: unknown): { ok: true; alert: CleanAlert } | { ok: false; error: string } {
  const b = (raw && typeof raw === "object" ? raw : {}) as { subject?: unknown; lines?: unknown };
  if (typeof b.subject !== "string" || !clean(b.subject, ALERT_SUBJECT_MAX)) return { ok: false, error: "subject is required." };
  if (b.lines !== undefined && !Array.isArray(b.lines)) return { ok: false, error: "lines must be a list of text." };
  const subject = clean(b.subject, ALERT_SUBJECT_MAX);
  const lines = (Array.isArray(b.lines) ? b.lines : [])
    .filter((l): l is string => typeof l === "string")
    .map((l) => clean(l, ALERT_LINE_MAX))
    .filter(Boolean)
    .slice(0, ALERT_LINES_MAX);
  return { ok: true, alert: { subject, lines, orderRef: alertOrderRef(subject, lines) } };
}

export type MerchAlertRow = {
  id: string;
  subject: string;
  lines: string[];
  order_ref: string | null;
  repeat_count: number;
  first_seen_at: string;
  last_seen_at: string;
  acknowledged_at: string | null;
  acknowledged_by_email: string | null;
};

export function __runMerchAlertsTests(): { passed: number; failures: string[] } {
  let passed = 0;
  const failures: string[] = [];
  const ok = (name: string, c: boolean) => (c ? (passed += 1) : failures.push(name));
  const r = readAlertPost({ subject: "Order gm-abc123-xy needs you - NOT sent to Printful", lines: ["Customer: a@b.co", 5, "", "x".repeat(900)] });
  ok("clean alert", r.ok && r.alert.lines.length === 2 && r.alert.lines[1].length === ALERT_LINE_MAX && r.alert.orderRef === "gm-abc123-xy");
  ok("no subject refused", !readAlertPost({ lines: ["x"] }).ok && !readAlertPost({ subject: "   " }).ok && !readAlertPost(null).ok);
  ok("lines must be a list", !readAlertPost({ subject: "s", lines: "x" }).ok);
  ok("no lines is fine", readAlertPost({ subject: "s" }).ok);
  ok("max 20 lines", (() => { const x = readAlertPost({ subject: "s", lines: Array.from({ length: 40 }, (_, i) => `l${i}`) }); return x.ok && x.alert.lines.length === 20; })());
  ok("control characters removed", (() => { const x = readAlertPost({ subject: "a\u0000b\u001bc" }); return x.ok && x.alert.subject === "a b c"; })());
  ok("ref from lines", alertOrderRef("Printful rejected", ["Order gm-zzz999-a1 - Stripe session cs_x"]) === "gm-zzz999-a1");
  ok("no ref", alertOrderRef("Hello", ["none"]) === null);
  return { passed, failures };
}
