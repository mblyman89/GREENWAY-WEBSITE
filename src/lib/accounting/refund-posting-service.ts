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
 *
 * Fix Phase 2.8b (owner, message 6: "Please completely finish the refund
 * entry, so it puts back the cost of returned items"). The same press also
 * drafts a SECOND entry, refunds:<day>#cogs (refund-cogs-core.ts): DR the
 * category inventory account / CR its COGS account for every unit that went
 * back on the shelf. Its cost comes from the sale's own cost entry for a void
 * (order:<id>#cogs, reversed exactly) and from the lot's unit cost x quantity
 * for a return. It is independent of the money entry: an untied refund holds
 * the money entry but not the cost one, and an exchange (no cash back) still
 * puts its cost back. Also a draft, also idempotent on its own ref.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { submitJournal } from "@/lib/accounting/posting-service";
import { mapReceiptCategory } from "@/lib/accounting/receipt-category-core";
import {
  buildRefundCogsJournal,
  costLinesFromSaleCogs,
  refundCogsSourceRef,
  returnCost,
  type RefundCogsTotals,
  type RefundCostItem,
} from "@/lib/accounting/refund-cogs-core";
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

/** Fix Phase 2.8b: what happened to the cost-back entry (refunds:<day>#cogs). */
export type RefundCogsDraft =
  | {
      readonly kind: "drafted";
      readonly sourceRef: string;
      readonly journalId: string | null;
      readonly duplicate: boolean;
      readonly totals: RefundCogsTotals;
      readonly message: string;
    }
  | { readonly kind: "nothing"; readonly totals: RefundCogsTotals; readonly message: string }
  | { readonly kind: "refused" | "failed"; readonly code: string; readonly message: string };

export type RefundDraftOutcome = (
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
  | { readonly kind: "failed"; readonly businessDay: string; readonly code: string; readonly message: string }
) & { readonly cogs?: RefundCogsDraft };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

type LineRow = { category: string | null; quantity: number; price_minor_units: number; product_name: string | null };

/** Map a free-text category to a chart slug; null = not recognised (refused by the core). */
function slugFor(category: string | null): string {
  const m = mapReceiptCategory(category);
  return m.kind === "mapped" ? m.slug : `unrecognised:${(category ?? "").trim() || "(blank)"}`;
}

type ReturnRow = {
  order_line_id: string | null;
  lot_id?: string | null;
  quantity?: number | string | null;
  disposition?: string | null;
  /** 0323 (Phase 4): set for an Other Inventory (non-cannabis) return. */
  noncannabis_product_id?: string | null;
};

/**
 * Phase 4 (G-29 item 6) — the cost of an Other Inventory return put back on
 * the shelf: the unit cost the SALE snapshot recorded (0323
 * noncannabis_adjustments.unit_cost_minor_units), else the catalog's current
 * average cost. $0 / missing = unknown (refuses the cost entry), never zero.
 */
async function ncReturnCostLines(admin: Admin, ret: ReturnRow, categorySlug: string): Promise<{ costLines: RefundCostItem["costLines"]; note: string | null }> {
  const productId = ret.noncannabis_product_id as string;
  const qty = Number(ret.quantity);
  let unit: number | null = null;
  if (ret.order_line_id) {
    const { data: snap } = await admin
      .from("noncannabis_adjustments")
      .select("unit_cost_minor_units")
      .eq("order_line_id", ret.order_line_id)
      .eq("reason", "sale")
      .maybeSingle();
    const v = (snap as { unit_cost_minor_units: number | null } | null)?.unit_cost_minor_units;
    if (v !== null && v !== undefined && Number(v) > 0) unit = Number(v);
  }
  if (unit === null) {
    const { data, error } = await admin.from("noncannabis_products").select("cost_minor_units").eq("id", productId).maybeSingle();
    if (error) return { costLines: null, note: `the Other Inventory item ${productId} could not be read (${error.message})` };
    const v = (data as { cost_minor_units: number | null } | null)?.cost_minor_units;
    if (v !== null && v !== undefined && Number(v) > 0) unit = Number(v);
  }
  const c = returnCost(unit, qty);
  if (!c.ok) return { costLines: null, note: c.problem };
  return { costLines: [{ categorySlug, costCents: c.costCents }], note: null };
}

/**
 * Fix Phase 2.8b: the cost of a return, from the lot the units went back on.
 * null costLines = unknown (refuses the cost entry, with the reason).
 */
async function returnCostLines(admin: Admin, ret: ReturnRow, categorySlug: string): Promise<{ costLines: RefundCostItem["costLines"]; note: string | null }> {
  if (ret.noncannabis_product_id) return ncReturnCostLines(admin, ret, categorySlug);
  const lotId = ret.lot_id ?? null;
  if (!lotId) return { costLines: null, note: "the return has no lot recorded" };
  const qty = Number(ret.quantity);
  const { data, error } = await admin.from("inventory_lots").select("id, unit_cost_minor_units").eq("id", lotId).maybeSingle();
  if (error) return { costLines: null, note: `the lot ${lotId} could not be read (${error.message})` };
  if (!data) return { costLines: null, note: `the lot ${lotId} no longer exists` };
  const raw = (data as { unit_cost_minor_units: number | null }).unit_cost_minor_units;
  const c = returnCost(raw === null || raw === undefined ? null : Number(raw), qty);
  if (!c.ok) return { costLines: null, note: c.problem };
  return { costLines: [{ categorySlug, costCents: c.costCents }], note: null };
}

/**
 * Fix Phase 2.8b: the cost a sale booked, read back from its own entry
 * order:<id>#cogs (draft or posted). No entry = the sale booked no cost
 * (custom keypad lines only, or the cost entry was refused) = nothing to put
 * back. A read failure is unknown, never zero.
 */
async function saleCostLines(admin: Admin, orderId: string): Promise<{ costLines: RefundCostItem["costLines"]; note: string | null }> {
  const { data: js, error } = await admin
    .from("gl_journals")
    .select("id, status")
    .eq("source_ref", `order:${orderId}#cogs`)
    .in("status", ["draft", "posted"]);
  if (error) return { costLines: null, note: `the sale's cost entry could not be read (${error.message})` };
  const rows = (js as { id: string; status: string }[] | null) ?? [];
  if (rows.length === 0) return { costLines: [], note: "the sale booked no cost" };
  if (rows.length > 1) return { costLines: null, note: `the sale has ${rows.length} cost entries; expected one` };
  const { data: ls, error: lErr } = await admin
    .from("gl_journal_lines")
    .select("amount_cents, gl_accounts!inner(code)")
    .eq("journal_id", rows[0].id);
  if (lErr) return { costLines: null, note: `the sale's cost lines could not be read (${lErr.message})` };
  const lines = ((ls as unknown as { amount_cents: number | string; gl_accounts: { code: string } | { code: string }[] | null }[] | null) ?? []).map((l) => {
    const acct = Array.isArray(l.gl_accounts) ? l.gl_accounts[0] : l.gl_accounts;
    return { accountCode: acct?.code ?? "(unknown)", amountCents: Number(l.amount_cents) };
  });
  if (lines.length === 0) return { costLines: null, note: "the sale's cost entry has no lines" };
  const got = costLinesFromSaleCogs(lines);
  if (!got.ok) return { costLines: null, note: got.problem };
  return { costLines: got.lines, note: null };
}

/** A cost read that throws is an UNKNOWN cost (refuses the cost entry), never a zero and never a crash of the money entry. */
async function safeCost(
  f: () => Promise<{ costLines: RefundCostItem["costLines"]; note: string | null }>,
): Promise<{ costLines: RefundCostItem["costLines"]; note: string | null }> {
  try {
    return await f();
  } catch (err) {
    return { costLines: null, note: `the cost could not be read (${err instanceof Error ? err.message : String(err)})` };
  }
}

/** The lines one refund belongs to, and (2.8b) what it cost. */
async function linesForRefund(
  admin: Admin,
  source: "return" | "void",
  sourceId: string,
  refundCents: number,
): Promise<
  | { ok: true; lines: RefundLineInput[]; disposition: "restock" | "destroy"; cost: { costLines: RefundCostItem["costLines"]; note: string | null } }
  | { ok: false; message: string }
> {
  if (source === "return") {
    // Phase 4: 0323 adds noncannabis_product_id; before it, read without it.
    let { data: ret, error } = await admin
      .from("customer_returns")
      .select("id, order_line_id, lot_id, quantity, disposition, noncannabis_product_id")
      .eq("id", sourceId)
      .maybeSingle();
    if (error && /noncannabis_product_id/.test(error.message ?? "")) {
      ({ data: ret, error } = await admin
        .from("customer_returns")
        .select("id, order_line_id, lot_id, quantity, disposition")
        .eq("id", sourceId)
        .maybeSingle());
    }
    if (error) return { ok: false, message: `The return ${sourceId} could not be read: ${error.message}` };
    const r = (ret as ReturnRow | null) ?? null;
    // 0115: disposition is restock | destroy, default destroy. Anything else is not guessed.
    const disposition: "restock" | "destroy" = r?.disposition === "restock" ? "restock" : "destroy";
    const lineId = r?.order_line_id ?? null;
    const noLine = { costLines: null, note: "the return is not tied to a sale line, so its category is unknown" };
    if (!lineId) return { ok: true, lines: [], disposition, cost: noLine };
    const { data: line, error: lErr } = await admin
      .from("order_lines")
      .select("category, quantity, price_minor_units, product_name")
      .eq("id", lineId)
      .maybeSingle();
    if (lErr) return { ok: false, message: `The sale line for return ${sourceId} could not be read: ${lErr.message}` };
    if (!line) return { ok: true, lines: [], disposition, cost: noLine };
    const slug = slugFor((line as LineRow).category);
    // A destroyed return keeps its cost in COGS (refund-cogs-core.ts header), so its lot is not read.
    const cost = disposition === "restock" && r ? await safeCost(() => returnCostLines(admin, r, slug)) : { costLines: [], note: null };
    // A return refunds part or all of ONE line; the whole refund belongs to it.
    return { ok: true, lines: [{ categorySlug: slug, paidCents: refundCents }], disposition, cost };
  }
  const { data, error } = await admin
    .from("order_lines")
    .select("category, quantity, price_minor_units, product_name")
    .eq("order_id", sourceId);
  if (error) return { ok: false, message: `The voided sale ${sourceId} could not be read: ${error.message}` };
  const rows = (data as LineRow[] | null) ?? [];
  // A void restocks every unit (void-store.ts restockInventoryForVoid), so the
  // whole of the sale's own cost entry comes back.
  const cost = await safeCost(() => saleCostLines(admin, sourceId));
  return {
    ok: true,
    lines: rows.map((l) => ({
      categorySlug: slugFor(l.category),
      paidCents: (Number(l.price_minor_units) || 0) * (Number(l.quantity) || 0),
    })),
    disposition: "restock",
    cost,
  };
}

/** Fix Phase 2.8b: draft the cost-back entry for the day. Never throws. */
async function draftCogsForDay(admin: Admin, day: string, items: RefundCostItem[]): Promise<RefundCogsDraft> {
  const built = buildRefundCogsJournal({ businessDay: day, items });
  if (built.kind === "refused") return { kind: "refused", code: built.code, message: built.explanation };
  if (built.kind === "nothing") return { kind: "nothing", totals: built.totals, message: built.explanation };
  const sourceRef = refundCogsSourceRef(day);
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
      // autoPost deliberately NOT set: the owner posts it (G-48).
    },
    admin,
  );
  if (!result.ok) {
    const conflict = result.code === "GL_POST_CONFLICT";
    return {
      kind: "failed",
      code: result.code ?? "GL_REFUSED",
      message: conflict
        ? `A cost entry for ${day}'s returned units already exists with different figures (a return or a lot cost changed after it was drafted). Nothing new was written. If it is still a draft, tell the developer; if it is posted, write the difference as a journal entry. (${result.message})`
        : `The books refused the cost entry: ${result.message}`,
    };
  }
  const duplicate = result.outcome === "duplicate";
  return {
    kind: "drafted",
    sourceRef,
    journalId: result.journalId ?? null,
    duplicate,
    totals: built.totals,
    message: duplicate ? `${day}'s cost entry was already drafted. Nothing was written twice.` : `${built.explanation} It is a draft: check it below and press Post.`,
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
  const costItems: RefundCostItem[] = [];
  for (const r of read.refunds) {
    const got = await linesForRefund(admin, r.source, r.sourceId, r.refundMinor);
    if (!got.ok) return { kind: "failed", businessDay: day, code: "REFUND_READ_FAILED", message: `${got.message}. Nothing was drafted.` };
    costItems.push({
      source: r.source,
      sourceId: r.sourceId,
      label: r.label ?? (r.source === "void" ? "Void" : "Counter return"),
      disposition: got.disposition,
      costLines: got.cost.costLines,
      costNote: got.cost.note,
    });
    refunds.push({
      source: r.source,
      sourceId: r.sourceId,
      label: r.label ?? (r.source === "void" ? "Void" : "Counter return"),
      refundCents: r.refundMinor,
      paidFrom: r.paidFrom,
      lines: got.lines,
    });
  }

  // 2.8b: the cost entry stands on its own (an exchange hands back no cash but
  // still puts its units back), so it is drafted whatever the money entry does.
  let cogs: RefundCogsDraft;
  try {
    cogs = costItems.length > 0 ? await draftCogsForDay(admin, day, costItems) : { kind: "nothing", totals: { costCents: 0, restockedCount: 0, destroyedCount: 0, noCostCount: 0 }, message: `No returns or voids on ${day}, so no cost to put back.` };
  } catch (err) {
    cogs = { kind: "failed", code: "REFUND_COGS_FAILED", message: `The cost entry could not be drafted: ${err instanceof Error ? err.message : String(err)}` };
  }

  const built = buildRefundDayJournal({ businessDay: day, refunds });
  if (built.kind === "refused") {
    return { kind: "refused", businessDay: day, code: built.code, message: built.explanation, cogs };
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
      cogs,
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
    cogs,
  };
}
