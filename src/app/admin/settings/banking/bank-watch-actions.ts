"use server";

/**
 * R41 S16 (0289): the bank watch actions.
 *
 *   addRuleAction / retireRuleAction   OWNER ONLY (ach.act). A known-payee
 *     rule decides which money-out lines stop being reported, so it is the
 *     owner's call, like any ACH filter list. The 0289 trigger checks the
 *     owner again (ach_write_by_owner).
 *   recordReviewAction                 finances.view (the owner today). The
 *     page lists every money-out line on the Main account, which is the bank
 *     feed, so it keeps the Bank Feeds gate. Saying what a line was moves no
 *     money; it is the record of who looked and what they found (who they
 *     called at 1-800-562-8761, what was said). The 0289 trigger is the floor:
 *     it allows the owner or an ACTIVE admin, so the app gate is stricter.
 *
 * Every write is audited (Security Log).
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { checkReviewForm, checkRuleForm, VERDICT_WORD } from "@/lib/payments/ach-bank-watch-core";
import { addWatchRule, recordWatchReview, retireWatchRule } from "@/lib/payments/ach-bank-watch-store";

const PAGE = "/admin/settings/banking/bank-watch";

function back(qs: { msg?: string; error?: string }, anchor = "top"): never {
  const p = new URLSearchParams();
  if (qs.msg) p.set("msg", qs.msg.slice(0, 900));
  if (qs.error) p.set("error", qs.error.slice(0, 900));
  revalidatePath(PAGE);
  redirect(`${PAGE}?${p.toString()}#${anchor}`);
}

export async function addRuleAction(fd: FormData): Promise<void> {
  const session = await requirePermission("ach.act");
  const form = checkRuleForm((k) => fd.get(k) as string | null);
  if (!form.ok) back({ error: form.error }, "rules");
  const r = await addWatchRule({ ...form.rule, actorId: session.profile.id });
  if (!r.ok) back({ error: r.error }, "rules");
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "ach.bank_watch.rule_added",
    entityType: "ach_bank_watch_rules",
    entityId: r.id,
    after: { match_text: form.rule.matchText, max_cents: form.rule.maxCents },
  }).catch(() => {});
  back({ msg: `Known payee "${form.rule.matchText}" added. Matching money-out lines${form.rule.maxCents !== null ? " up to the limit" : ""} are no longer reported.` }, "rules");
}

export async function retireRuleAction(fd: FormData): Promise<void> {
  const session = await requirePermission("ach.act");
  const id = String(fd.get("rule_id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) back({ error: "That rule could not be identified. Reload the page." }, "rules");
  const r = await retireWatchRule({ id, actorId: session.profile.id });
  if (!r.ok) back({ error: r.error }, "rules");
  await recordAudit({ actorId: session.profile.id, actorEmail: session.email, action: "ach.bank_watch.rule_retired", entityType: "ach_bank_watch_rules", entityId: id }).catch(() => {});
  back({ msg: "Rule retired. Its lines are reported again from now on (the rule stays on record)." }, "rules");
}

export async function recordReviewAction(fd: FormData): Promise<void> {
  const session = await requirePermission("finances.view");
  const form = checkReviewForm((k) => fd.get(k) as string | null);
  if (!form.ok) back({ error: form.error }, "unexplained");
  const r = await recordWatchReview({ ...form.review, actorId: session.profile.id });
  if (!r.ok) back({ error: r.error }, "unexplained");
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "ach.bank_watch.reviewed",
    entityType: "ach_bank_watch_reviews",
    entityId: r.id,
    after: { transaction_id: form.review.transactionId, verdict: form.review.verdict },
  }).catch(() => {});
  back({ msg: `Recorded: ${VERDICT_WORD[form.review.verdict]}.` }, "unexplained");
}
