/**
 * src/lib/inventory/manifest-event-labels-core.ts  (S29, pure)
 *
 * One human label and one group for every `manifest_events.event_type` the
 * app writes. Before S29 the timeline printed the raw type with `_` → " "
 * ("vendor bill refused") and truncated the note, so a refusal from the
 * books looked like any other line. The Accounting tab (S29) reads the
 * "accounting" group; ManifestTimeline groups by it.
 *
 * Writers (verified by grep, pinned by tests/compliance/s29-accounting-tab):
 *   intake/actions.ts             vendor_bill_posted/refused/skipped,
 *                                 sample_cap_vendor_notified,
 *                                 receipt_posted/receipt_refused (S29)
 *   intake-store.ts               rejected, vendor_link, sample_cap_block,
 *                                 accepted/rejected/partially_accepted (finalize),
 *                                 draft_seed_error, kb_writeback_error,
 *                                 po_auto_receive, menu_auto_carry, note,
 *                                 in_transit/received (lifecycle), transport,
 *                                 invoice_number_override
 *   import-service.ts             accepted (Cultivera migration)
 *   po-link-store.ts              po_link
 *   kb-link-store.ts              kb_link
 *   manifest-kb-bridge.ts         kb_writeback
 *   vendor-goldminer-store.ts     vendor_goldminer
 *   intake-menu-staging.ts        menu_carry_forward_incomplete,
 *                                 menu_publish_held_for_fact_review,
 *                                 menu_publish_held_for_cutover,
 *                                 menu_auto_publish, menu_auto_publish_failed
 *
 * An UNKNOWN type (a future writer) never breaks the page: it falls back to
 * the old humanised text in the "delivery" group — and the compliance test
 * fails CI so a label gets written.
 */

export type ManifestEventGroup = "delivery" | "menu" | "accounting" | "kb";

export type ManifestEventLabel = {
  label: string;
  group: ManifestEventGroup;
  /** A refusal / failure — rendered in the attention tone, never hidden. */
  problem: boolean;
};

/** Every known type → label. Keys are exactly the strings the writers use. */
export const MANIFEST_EVENT_LABELS: Readonly<Record<string, ManifestEventLabel>> = {
  // Delivery lifecycle + finalize
  in_transit: { label: "Marked in transit", group: "delivery", problem: false },
  received: { label: "Marked received", group: "delivery", problem: false },
  accepted: { label: "Accepted", group: "delivery", problem: false },
  partially_accepted: { label: "Partially accepted", group: "delivery", problem: false },
  rejected: { label: "Rejected at the dock", group: "delivery", problem: false },
  sample_cap_block: { label: "Finalize refused \u00b7 sample cap", group: "delivery", problem: true },
  sample_cap_vendor_notified: { label: "Vendor told about the sample cap", group: "delivery", problem: false },
  vendor_link: { label: "Vendor linked", group: "delivery", problem: false },
  vendor_goldminer: { label: "Vendor profile filled from paperwork", group: "delivery", problem: false },
  po_link: { label: "Purchase order link", group: "delivery", problem: false },
  po_auto_receive: { label: "Purchase order received", group: "delivery", problem: false },
  transport: { label: "Transport details", group: "delivery", problem: false },
  invoice_number_override: { label: "Invoice # corrected", group: "delivery", problem: false },
  note: { label: "Note", group: "delivery", problem: false },
  // Menu
  draft_seed_error: { label: "Onboarding drafts failed", group: "menu", problem: true },
  menu_auto_carry: { label: "Menu update", group: "menu", problem: false },
  menu_auto_publish: { label: "Published to the live menu", group: "menu", problem: false },
  menu_auto_publish_failed: { label: "Automatic publish didn\u2019t finish", group: "menu", problem: true },
  menu_publish_held_for_fact_review: { label: "Menu update held \u00b7 fact check", group: "menu", problem: true },
  menu_publish_held_for_cutover: { label: "Menu update held \u00b7 cutover", group: "menu", problem: true },
  menu_carry_forward_incomplete: { label: "Menu update not built \u00b7 live menu unreadable", group: "menu", problem: true },
  // S32: the match review (intake/[id]/match) - who chose where a look-alike product belongs.
  merge_decision_saved: { label: "Look-alike product \u00b7 choice saved", group: "menu", problem: false },
  merge_decision_forgotten: { label: "Look-alike product \u00b7 choice forgotten", group: "menu", problem: false },
  // Knowledge base
  kb_link: { label: "Knowledge base link", group: "kb", problem: false },
  kb_writeback: { label: "Promoted to the knowledge base", group: "kb", problem: false },
  kb_writeback_error: { label: "Knowledge base update failed", group: "kb", problem: true },
  // Accounting (books-81 receipt, books-83 vendor bill)
  receipt_posted: { label: "Books \u00b7 goods receipt recorded", group: "accounting", problem: false },
  receipt_refused: { label: "Books \u00b7 goods receipt not posted", group: "accounting", problem: true },
  vendor_bill_posted: { label: "Books \u00b7 vendor bill recorded", group: "accounting", problem: false },
  vendor_bill_refused: { label: "Books \u00b7 vendor bill not posted", group: "accounting", problem: true },
  vendor_bill_skipped: { label: "Books \u00b7 no vendor bill (nothing activated)", group: "accounting", problem: false },
};

/** The old rendering, kept as the fallback for an unknown type. */
function humanise(eventType: string): string {
  const t = eventType.replace(/_/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "Event";
}

export function labelForEvent(eventType: string): ManifestEventLabel {
  const known = Object.prototype.hasOwnProperty.call(MANIFEST_EVENT_LABELS, eventType)
    ? MANIFEST_EVENT_LABELS[eventType]
    : undefined;
  return known ?? { label: humanise(eventType), group: "delivery", problem: false };
}

export function isKnownEventType(eventType: string): boolean {
  return Object.prototype.hasOwnProperty.call(MANIFEST_EVENT_LABELS, eventType);
}

/** Timeline section order and titles. Accounting renders collapsed. */
export const MANIFEST_EVENT_GROUPS: readonly { key: ManifestEventGroup; title: string; collapsed: boolean }[] = [
  { key: "delivery", title: "Delivery", collapsed: false },
  { key: "menu", title: "Menu", collapsed: false },
  { key: "kb", title: "Knowledge base", collapsed: false },
  { key: "accounting", title: "Books", collapsed: true },
];

export type LabelledEvent<E> = E & { label: ManifestEventLabel };

/** Split events into the groups above, keeping each group's input order; empty groups dropped. */
export function groupManifestEvents<E extends { event_type: string }>(
  events: readonly E[],
): { key: ManifestEventGroup; title: string; collapsed: boolean; events: LabelledEvent<E>[] }[] {
  return MANIFEST_EVENT_GROUPS.map((g) => ({
    ...g,
    events: events
      .map((e) => ({ ...e, label: labelForEvent(e.event_type) }))
      .filter((e) => e.label.group === g.key),
  })).filter((g) => g.events.length > 0);
}

/** Only the books events, for the Accounting tab (input order kept). */
export function accountingEvents<E extends { event_type: string }>(events: readonly E[]): LabelledEvent<E>[] {
  return events
    .map((e) => ({ ...e, label: labelForEvent(e.event_type) }))
    .filter((e) => e.label.group === "accounting");
}

/**
 * The receipt timeline row the lifecycle action writes (S29.2): ok →
 * receipt_posted, refusal → receipt_refused, with "CODE: message". A thrown
 * error is a refusal with the error text. Pure so the exact strings are pinned.
 */
export function receiptEventFor(
  booked: { ok: boolean; code: string; message: string } | { thrown: string },
): { eventType: "receipt_posted" | "receipt_refused"; note: string } {
  if ("thrown" in booked) {
    return {
      eventType: "receipt_refused",
      note: `The delivery was marked received, but the books could not be updated: ${booked.thrown}`.slice(0, 2000),
    };
  }
  return {
    eventType: booked.ok ? "receipt_posted" : "receipt_refused",
    note: `${booked.code}: ${booked.message}`.slice(0, 2000),
  };
}

export type BooksStepState = "none" | "posted" | "refused" | "skipped";

/**
 * Where each books step stands for this delivery, from the durable timeline
 * (not the URL): the LATEST event of each family wins, because both wires are
 * idempotent per manifest and a later success supersedes an earlier refusal.
 * `open` counts families whose latest word is a refusal: the Accounting tab
 * badge. A stale refusal that was later fixed is history, not a to-do.
 */
export function accountingStatus(
  events: readonly { event_type: string }[],
): { receipt: BooksStepState; bill: BooksStepState; open: number } {
  let receipt: BooksStepState = "none";
  let bill: BooksStepState = "none";
  for (const e of events) {
    if (e.event_type === "receipt_posted") receipt = "posted";
    else if (e.event_type === "receipt_refused") receipt = "refused";
    else if (e.event_type === "vendor_bill_posted") bill = "posted";
    else if (e.event_type === "vendor_bill_refused") bill = "refused";
    else if (e.event_type === "vendor_bill_skipped") bill = "skipped";
  }
  const open = (receipt === "refused" ? 1 : 0) + (bill === "refused" ? 1 : 0);
  return { receipt, bill, open };
}

/**
 * One line per books step for the Accounting tab. "Recorded", never
 * "posted": submitJournal creates a draft and posts only when the database
 * agrees (posting-service.ts submitJournal), so a success can be a draft
 * waiting for the owner. Honest about what this page knows.
 */
export function booksStepText(step: "receipt" | "bill", state: BooksStepState): string {
  const name = step === "receipt" ? "Goods receipt" : "Vendor bill";
  if (state === "posted") return `${name}: recorded in the books (it may be waiting as a draft for the owner).`;
  if (state === "refused") return `${name}: not recorded yet \u2014 see the reason below.`;
  if (state === "skipped") return `${name}: none needed \u2014 nothing was activated, so nothing is owed.`;
  return step === "receipt"
    ? `${name}: not attempted yet \u2014 it is recorded when the delivery is marked received.`
    : `${name}: not attempted yet \u2014 it is recorded when the delivery is finalized.`;
}

/**
 * The `?books=<code>` success line (the wire passes the service code). Unknown
 * codes get the generic line rather than a guess.
 */
export function booksResultText(code: string): string {
  if (code === "RECEIPT_OK") {
    return "Books: goods receipt recorded for this delivery. It is keyed to this manifest, so it can never be recorded twice.";
  }
  if (code === "BILL_OK") {
    return "Books: vendor bill recorded for this delivery. It is keyed to this manifest, so it can never be recorded twice.";
  }
  return "Books: recorded for this delivery.";
}

/**
 * What the operator can do about a refusal, from facts on the page only.
 * While the delivery is still in progress, "Mark received" is on the page and
 * re-runs the receiving wire (idempotent per manifest). After finalize there
 * is no retry button on this page, so the copy does not promise one.
 */
export function booksRefusalNextStep(inProgress: boolean): string {
  return inProgress
    ? "Fix the reason, then use Mark received again \u2014 the entry is keyed to this manifest, so it can never be recorded twice."
    : "Nothing was recorded, so no number is wrong. The reason above says what has to change; the owner follows it up in the books.";
}

// ---------------------------------------------------------------------------
// Self-tests (house pattern)
// ---------------------------------------------------------------------------

export function __runManifestEventLabelsCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: unknown, what: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`manifest-event-labels-core self-test FAILED: ${what}`);
    }
  };

  ok(labelForEvent("vendor_bill_refused").label === "Books \u00b7 vendor bill not posted", "bible S29.4 copy");
  ok(labelForEvent("vendor_bill_refused").group === "accounting" && labelForEvent("vendor_bill_refused").problem, "refusal is accounting + problem");
  ok(labelForEvent("vendor_bill_posted").group === "accounting" && !labelForEvent("vendor_bill_posted").problem, "posted not a problem");
  ok(labelForEvent("vendor_bill_skipped").group === "accounting", "skipped is accounting");
  ok(labelForEvent("receipt_posted").group === "accounting" && labelForEvent("receipt_refused").problem, "receipt pair");
  ok(labelForEvent("menu_publish_held_for_fact_review").group === "menu", "fact-review hold is menu");
  ok(labelForEvent("menu_publish_held_for_cutover").group === "menu", "cutover hold is menu");
  ok(labelForEvent("kb_writeback_error").group === "kb" && labelForEvent("kb_writeback_error").problem, "kb error");
  ok(labelForEvent("received").group === "delivery" && labelForEvent("received").label === "Marked received", "lifecycle label");
  ok(labelForEvent("partially_accepted").label === "Partially accepted", "finalize label");
  // Unknown → humanised, delivery, never a problem claim.
  const u = labelForEvent("some_new_thing");
  ok(u.label === "Some new thing" && u.group === "delivery" && !u.problem, "unknown falls back");
  ok(labelForEvent("").label === "Event", "empty type");
  ok(labelForEvent("toString").label === "ToString" && !isKnownEventType("toString"), "prototype keys are not labels");
  ok(isKnownEventType("po_link") && !isKnownEventType("po_links"), "isKnownEventType exact");
  // Every label has text and a valid group.
  const groups = new Set(MANIFEST_EVENT_GROUPS.map((g) => g.key));
  ok(Object.values(MANIFEST_EVENT_LABELS).every((l) => l.label.length > 0 && groups.has(l.group)), "every label valid");
  ok(Object.keys(MANIFEST_EVENT_LABELS).length === 31, "31 known types (S32 adds the two match-review events)");

  // Grouping keeps order, drops empties, accounting collapsed + last.
  const ev = [
    { id: "1", event_type: "received" },
    { id: "2", event_type: "vendor_bill_refused" },
    { id: "3", event_type: "menu_auto_publish" },
    { id: "4", event_type: "accepted" },
    { id: "5", event_type: "receipt_posted" },
  ];
  const g = groupManifestEvents(ev);
  ok(g.map((x) => x.key).join(",") === "delivery,menu,accounting", "groups in order, kb dropped");
  ok(g[0].events.map((e) => e.id).join(",") === "1,4", "delivery keeps input order");
  ok(g[2].collapsed === true && g[0].collapsed === false, "books collapsed only");
  ok(g[2].events.map((e) => e.id).join(",") === "2,5", "books events");
  ok(groupManifestEvents([]).length === 0, "no events no groups");
  ok(accountingEvents(ev).map((e) => e.id).join(",") === "2,5", "accountingEvents filter");
  ok(accountingEvents(ev)[0].label.problem === true, "labels attached");

  // Receipt event strings.
  const a = receiptEventFor({ ok: true, code: "RECEIPT_OK", message: "Posted." });
  ok(a.eventType === "receipt_posted" && a.note === "RECEIPT_OK: Posted.", "ok receipt");
  const b = receiptEventFor({ ok: false, code: "RECEIPT_NO_LOTS", message: "No lots." });
  ok(b.eventType === "receipt_refused" && b.note === "RECEIPT_NO_LOTS: No lots.", "refused receipt");
  const c = receiptEventFor({ thrown: "boom" });
  ok(c.eventType === "receipt_refused" && c.note.endsWith("could not be updated: boom"), "thrown receipt");
  ok(receiptEventFor({ ok: false, code: "X", message: "m".repeat(3000) }).note.length === 2000, "note capped");

  // accountingStatus: latest per family wins; open counts live refusals.
  const s0 = accountingStatus([]);
  ok(s0.receipt === "none" && s0.bill === "none" && s0.open === 0, "status empty");
  const s1 = accountingStatus([{ event_type: "receipt_refused" }, { event_type: "vendor_bill_refused" }]);
  ok(s1.receipt === "refused" && s1.bill === "refused" && s1.open === 2, "two open refusals");
  const s2 = accountingStatus([{ event_type: "receipt_refused" }, { event_type: "receipt_posted" }]);
  ok(s2.receipt === "posted" && s2.open === 0, "later success clears refusal");
  const s3 = accountingStatus([{ event_type: "receipt_posted" }, { event_type: "receipt_refused" }]);
  ok(s3.receipt === "refused" && s3.open === 1, "later refusal reopens");
  const s4 = accountingStatus([{ event_type: "vendor_bill_skipped" }, { event_type: "received" }]);
  ok(s4.bill === "skipped" && s4.receipt === "none" && s4.open === 0, "skipped is not open");
  const s5 = accountingStatus([{ event_type: "vendor_bill_refused" }, { event_type: "vendor_bill_posted" }]);
  ok(s5.bill === "posted" && s5.open === 0, "bill success clears");

  // Copy helpers: honest, never "posted", never a promise the page can't keep.
  ok(booksStepText("receipt", "posted").startsWith("Goods receipt: recorded"), "step posted");
  ok(!/posted/i.test(booksStepText("bill", "posted")), "never says posted");
  ok(booksStepText("bill", "skipped").includes("nothing is owed"), "step skipped");
  ok(booksStepText("receipt", "refused").includes("not recorded yet"), "step refused");
  ok(booksStepText("receipt", "none").includes("marked received") && booksStepText("bill", "none").includes("finalized"), "step none");
  ok(booksResultText("RECEIPT_OK").includes("goods receipt") && booksResultText("BILL_OK").includes("vendor bill"), "result by code");
  ok(booksResultText("WHATEVER") === "Books: recorded for this delivery.", "unknown code generic");
  ok(booksRefusalNextStep(true).includes("Mark received again"), "in progress retry");
  ok(!/finali[sz]e again|re-?finali/i.test(booksRefusalNextStep(false)), "no false re-finalize promise");

  return { passed, failed };
}
