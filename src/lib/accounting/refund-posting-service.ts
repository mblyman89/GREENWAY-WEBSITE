import "server-only";

/**
 * src/lib/accounting/refund-posting-service.ts  (Fix Phase 2.8 · G-48 · F-15-14)
 *
 * THE WIRE for census row revenue_and_tax_collected.refund_or_return.
 *
 *   owner presses "Draft refunds" on /admin/books/drafts
 *     -> app/admin/books/drafts/actions.ts#draftRefundsAction  (requireBooksAccess first)
 *     -> THIS FILE #draftRefundsForDay
 *     -> registers/drawer-figure-store.ts#readDayRefunds   (every void and return
 *        of the day, with where the cash came from - the same read reconcile uses)
 *     -> refund-journal-core.ts#buildRefundDayJournal
 *     -> posting-service.ts#submitJournal   (NO autoPost -> status 'draft')
 *     -> the draft waits on /admin/books/drafts for the owner's Post
 *
 * NOTHING POSTS HERE. autoPost is never set, so gl_submit_journal returns a
 * draft and only the owner's Post button (approveAndPostJournal, owner-only)
 * can turn it into history. G-48: "awaiting owner approval".
 *
 * IDEMPOTENT. One source ref per business day (refunds:<day>). Pressing the
 * button twice returns "duplicate" and writes nothing. If a refund is added to
 * a day AFTER its entry was drafted, the ledger refuses the different content
 * (GL_POST_CONFLICT) and this says so - it never writes a second entry.
 *
 * WHY ONLY A FINISHED DAY. Today is refused: a refund rung after the draft
 * would land in a day whose entry already exists.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { submitJournal } from "@/lib/accounting/posting-service";
import { mapReceiptCategory } from "@/lib/accounting/receipt-category-core";
import {
  buildRefundDayJournal,
  refundDaySourceRef,
  type RefundDayTotals,
  type RefundInput,
  type RefundLineInput,
} from "@/lib/accounting/refund-journal-core";
import { readDayRefunds } from "@/lib/registers/drawer-figure-store";
import { pacificToday } from "@/lib/reports/timezone";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

export type RefundDraftOutcome =
  | {
      readonly kind: "drafted";
      readonly businessDay: string;
      readonly sourceRef: string;
      readonly journalId: string | null;
      readonly status: string | null;
      /** True when this day's entry already existed; nothing was written. */
      readonly duplicate: boolean;
      readonly totals: RefundDayTotals;
      readonly message: string;
    }
  | { readonly kind: "refused"; readonly businessDay: string; readonly code: string; readonly message: string }
  | { readonly kind: "failed"; readonly businessDay: string; readonly code: string; readonly message: string };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

type LineRow = { category: string | null; quantity: number; price_minor_units: number; product_name: string | null };

/** Map a free-text category to a chart slug; null = not recognised (refused by the core). */
function slugFor(category: string | null): string {
  const m = mapReceiptCategory(category);
  return m.kind === "mapped" ? m.slug : `unrecognised:${(category ?? "").trim() || "(blank)"}`;
}

/** The lines one refund belongs to. */
async function linesForRefund(
  admin: Admin,
  source: "return" | "void",
  sourceId: string,
  refundCents: number,
): Promise<{ ok: true; lines: RefundLineInput[] } | { ok: false; message: string }> {
  if (source === "return") {
    const { data: ret, error } = await admin
      .from("customer_returns")
      .select("id, order_line_id")
      .eq("id", sourceId)
      .maybeSingle();
    if (error) return { ok: false, message: `The return ${sourceId} could not be read: ${error.message}` };
    const lineId = (ret as { order_line_id: string | null } | null)?.order_line_id ?? null;
    if (!lineId) return { ok: true, lines: [] };
    const { data: line, error: lErr } = await admin
      .from("order_lines")
      .select("category, quantity, price_minor_units, product_name")
      .eq("id", lineId)
      .maybeSingle();
    if (lErr) return { ok: false, message: `The sale line for return ${sourceId} could not be read: ${lErr.message}` };
    if (!line) return { ok: true, lines: [] };
    // A return refunds part or all of ONE line; the whole refund belongs to it.
    return { ok: true, lines: [{ categorySlug: slugFor((line as LineRow).category), paidCents: refundCents }] };
  }
  const { data, error } = await admin
    .from("order_lines")
    .select("category, quantity, price_minor_units, product_name")
    .eq("order_id", sourceId);
  if (error) return { ok: false, message: `The voided sale ${sourceId} could not be read: ${error.message}` };
  const rows = (data as LineRow[] | null) ?? [];
  return {
    ok: true,
    lines: rows.map((l) => ({
      categorySlug: slugFor(l.category),
      paidCents: (Number(l.price_minor_units) || 0) * (Number(l.quantity) || 0),
    })),
  };
}

/** Draft the refund entry for one finished business day. Safe to press again. */
export async function draftRefundsForDay(businessDay: string, client?: Admin): Promise<RefundDraftOutcome> {
  const day = (businessDay ?? "").trim();
  if (!ISO_DAY.test(day)) {
    return { kind: "refused", businessDay: day, code: "REFUND_BAD_DAY", message: "Pick a business day (YYYY-MM-DD). Nothing was drafted." };
  }
  if (day >= pacificToday()) {
    return {
      kind: "refused",
      businessDay: day,
      code: "REFUND_DAY_NOT_OVER",
      message: `${day} is not over yet. Draft a day's refunds after its drawers are reconciled, so no refund can arrive after the entry. Nothing was drafted.`,
    };
  }
  if (!client && !isSupabaseServiceConfigured) {
    return { kind: "failed", businessDay: day, code: "NOT_CONFIGURED", message: "Supabase is not configured, so nothing was drafted." };
  }
  const admin = client ?? createSupabaseAdminClient();

  const read = await readDayRefunds(day);
  if (!read.complete) {
    return {
      kind: "refused",
      businessDay: day,
      code: "REFUND_READ_INCOMPLETE",
      message: `The refunds for ${day} did not all load (${read.problem ?? "unknown reason"}). Nothing was drafted - try again in a minute.`,
    };
  }

  const refunds: RefundInput[] = [];
  for (const r of read.refunds) {
    const got = await linesForRefund(admin, r.source, r.sourceId, r.refundMinor);
    if (!got.ok) return { kind: "failed", businessDay: day, code: "REFUND_READ_FAILED", message: `${got.message}. Nothing was drafted.` };
    refunds.push({
      source: r.source,
      sourceId: r.sourceId,
      label: r.label ?? (r.source === "void" ? "Void" : "Counter return"),
      refundCents: r.refundMinor,
      paidFrom: r.paidFrom,
      lines: got.lines,
    });
  }

  const built = buildRefundDayJournal({ businessDay: day, refunds });
  if (built.kind === "refused") {
    return { kind: "refused", businessDay: day, code: built.code, message: built.explanation };
  }

  const sourceRef = refundDaySourceRef(day);
  const result = await submitJournal(
    {
      entityCode: built.journal.entityCode,
      journalDate: built.journal.journalDate,
      sourceKind: built.journal.sourceKind,
      sourceRef,
      memo: built.journal.memo,
      lines: built.journal.lines.map((l) => ({
        accountCode: l.accountCode,
        amountCents: l.amountCents,
        costClass: l.costClass,
        description: l.description ?? undefined,
      })),
      // autoPost deliberately NOT set: the entry waits for the owner (G-48).
    },
    admin,
  );
  if (!result.ok) {
    const conflict = result.code === "GL_POST_CONFLICT";
    return {
      kind: "failed",
      businessDay: day,
      code: result.code ?? "GL_REFUSED",
      message: conflict
        ? `An entry for ${day}'s refunds already exists with different figures, so a refund was added or changed after it was drafted. Nothing new was written. Look at the draft on this page: if it is still a draft, tell the developer; if it is posted, write the difference as a journal entry. (${result.message})`
        : `The books refused the refund entry: ${result.message}`,
    };
  }
  const duplicate = result.outcome === "duplicate";
  return {
    kind: "drafted",
    businessDay: day,
    sourceRef,
    journalId: result.journalId ?? null,
    status: result.status ?? null,
    duplicate,
    totals: built.totals,
    message: duplicate
      ? `${day}'s refunds were already drafted. Nothing was written twice.`
      : `${built.explanation} It is a draft: check it below and press Post.`,
  };
}
