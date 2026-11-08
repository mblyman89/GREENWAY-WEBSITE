/**
 * src/lib/inbound-email/same-email-guard-core.ts  (D215, PURE)
 *
 * Owner, verbatim (D215): "It's a duplicate, please remove it. Then build 1-3"
 * - item 1: catch the same email ingested twice even when the vendor name
 * reads differently.
 *
 * WHAT HAPPENED. The Green Revolution email "Fwd: GREEN REVOLUTION - Invoice
 * for Order# - 69055" (one RFC Message-ID) reached Receiving twice:
 *   - 2026-11-05 by the Resend webhook   -> delivery 1de6e4f4 (accepted);
 *   - 2026-11-08 by the mailbox check     -> delivery 156b8d15 (a copy).
 * The mailbox check is meant to skip an email already on the table by its
 * Message-ID, but an email whose Gmail header read fails is listed with no
 * identity (no Message-ID, no sender, no subject) so it is pulled in "to be
 * safe" - and once read in full it was staged again. The manifest dedupe
 * then missed it because the copy's vendor read "Green Revolution Vehicle ID".
 *
 * THE GUARD. Just before an intake email is staged (the one routeAndStage
 * every path runs), the email's Message-ID is looked up on the email table.
 * When ANOTHER row with the same Message-ID already staged a delivery (or was
 * itself recorded as a duplicate of one) nothing is staged again: the row is
 * logged "duplicate" and points at that delivery. The row being completed
 * (Try again on the same row) never blocks itself, and an earlier attempt
 * that failed (parse_failed / no_manifest / received) never blocks a retry.
 */

/** The inbound_email_log fields the guard reads. */
export type SameEmailRow = {
  id: string;
  message_id: string | null;
  disposition: string | null;
  manifest_id: string | null;
  to_intake?: boolean | null;
  received_at?: string | null;
};

/** "<ABC@x>" / " abc@X " -> "abc@x"; null when it is not a Message-ID. PURE. */
export function normMessageId(v: unknown): string | null {
  if (typeof v !== "string") return null;
  let t = v.trim();
  const m = /<([^<>]+)>/.exec(t);
  if (m) t = m[1];
  t = t.trim().toLowerCase();
  if (!t || t.length > 300 || !/^[\x21-\x7e]+$/.test(t) || !t.includes("@")) return null;
  return t;
}

const DONE = new Set(["staged", "duplicate"]);

/**
 * The earlier row of the SAME email that already produced a delivery, or
 * null. PURE. `selfLogId` is the row this run completes (never counted).
 * Oldest first, so the answer is the first time the email was staged.
 */
export function findEarlierStagingOfSameEmail(
  messageId: string | null | undefined,
  rows: readonly SameEmailRow[],
  selfLogId: string | null,
): SameEmailRow | null {
  const mid = normMessageId(messageId);
  if (!mid) return null;
  const hits = rows
    .filter(
      (r) =>
        r.id !== selfLogId &&
        r.to_intake !== false &&
        normMessageId(r.message_id) === mid &&
        DONE.has((r.disposition ?? "").trim().toLowerCase()) &&
        Boolean(r.manifest_id),
    )
    .sort((a, b) => {
      const ta = Date.parse(a.received_at ?? "");
      const tb = Date.parse(b.received_at ?? "");
      const x = Number.isFinite(ta) ? ta : Number.POSITIVE_INFINITY;
      const y = Number.isFinite(tb) ? tb : Number.POSITIVE_INFINITY;
      return x !== y ? x - y : a.id < b.id ? -1 : 1;
    });
  return hits[0] ?? null;
}

/** The log note for a skipped second copy. PURE. */
export function sameEmailSkipNote(earlier: SameEmailRow): string {
  return `this email (same Message-ID) was already read on ${earlier.received_at ? earlier.received_at.slice(0, 10) : "an earlier run"} and staged as delivery ${earlier.manifest_id} - not staged again (D215: one email, one delivery)`;
}

export function __runSameEmailGuardTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`  FAIL same-email-guard: ${m}`);
    }
  };
  const mid = "CA+vf5a-of5njtsvnofxebwuwq4yckmy3pekzogfqbywxdw1+ja@mail.gmail.com";
  const web: SameEmailRow = { id: "L-web", message_id: mid.toLowerCase(), disposition: "staged", manifest_id: "1de6e4f4", to_intake: true, received_at: "2026-11-05T17:21:32Z" };
  ok(findEarlierStagingOfSameEmail(`<${mid}>`, [web], "L-rec")?.manifest_id === "1de6e4f4", "the owner's case: the mailbox check's copy finds the webhook's delivery");
  ok(findEarlierStagingOfSameEmail(mid, [web], "L-web") === null, "Try again on the same row never blocks itself");
  ok(findEarlierStagingOfSameEmail(mid, [{ ...web, disposition: "parse_failed", manifest_id: null }], "L-rec") === null, "an earlier failed read never blocks a retry");
  ok(findEarlierStagingOfSameEmail(mid, [{ ...web, manifest_id: null }], "L-rec") === null, "no delivery on the earlier row -> not blocked");
  ok(findEarlierStagingOfSameEmail(null, [web], "L-rec") === null && findEarlierStagingOfSameEmail("not-an-id", [web], "L-rec") === null, "no Message-ID -> no guard (never guessed)");
  ok(findEarlierStagingOfSameEmail("other@x", [web], "L-rec") === null, "a different email is never blocked");
  ok(findEarlierStagingOfSameEmail(mid, [{ ...web, to_intake: false }], "L-rec") === null, "a row that was not for the intake mailbox does not count");
  const dup: SameEmailRow = { ...web, id: "L-dup", disposition: "duplicate", manifest_id: "1de6e4f4", received_at: "2026-11-06T00:00:00Z" };
  ok(findEarlierStagingOfSameEmail(mid, [dup, web], null)?.id === "L-web", "oldest staging wins");
  ok(sameEmailSkipNote(web).includes("1de6e4f4") && sameEmailSkipNote(web).includes("2026-11-05"), "skip note names the delivery and the date");
  return { passed, failed };
}
