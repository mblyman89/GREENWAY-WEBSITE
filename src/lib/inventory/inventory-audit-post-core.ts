/**
 * src/lib/inventory/inventory-audit-post-core.ts   (slice books-11)
 *
 * PURE. No I/O, no database, no clock of its own. The rules that decide whether
 * an approved audit session is allowed to move inventory and touch the books,
 * and exactly what it should write when it is.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE IS FOR
 * ---------------------------------------------------------------------------
 * books-10 built the auditor: it plans a scope, hands staff a checklist, reads
 * the counts back and works out what differs. It deliberately stopped there.
 * Nothing it produced ever reached the shelf record or the general ledger.
 *
 * This file is the bridge, and it is written as a separate PURE module rather
 * than as code inside the store for one reason: the store talks to a database,
 * and anything that talks to a database can only be tested by standing up a
 * database. The decisions here are the part that must never be wrong, so they
 * live where they can be swept, mutated and attacked with no infrastructure at
 * all.
 *
 * ---------------------------------------------------------------------------
 * THE DEFECT THIS MODULE EXISTS TO PREVENT (proven, not theorised)
 * ---------------------------------------------------------------------------
 * The cycle-count code that shipped before this slice applies a session by
 * reading each line, checking whether it was already applied, and then writing.
 * Read, decide, write — with a gap in the middle. That gap was executed against
 * a real PostgreSQL 15.18 during this slice, using a lot whose system quantity
 * was 100 and whose counted quantity was 90:
 *
 *     on_hand 100  ->  90  ->  80
 *
 * The second application invented a second ten-unit shrink that nobody counted
 * and no shelf ever lost. It is the same shape as the double-reversal defect
 * found in F3, which invented money, and it is triggered by the most ordinary
 * human act there is: clicking the button again because you are not sure the
 * first click registered.
 *
 * The fix is not "check harder before writing" — that just makes the gap
 * smaller. The fix is to stop having a gap: the session is CLAIMED by a
 * conditional update that is its own lock, and the claim either returns a row
 * or it does not. That was executed too, with two transactions launched
 * simultaneously and deliberately overlapped, and exactly one claim was
 * granted. The rules in this file assume that claim exists; `assertPostPlan`
 * refuses to build a plan for a session that has already been posted, so the
 * TypeScript and the SQL both say no.
 *
 * ---------------------------------------------------------------------------
 * THE SIGN WALL
 * ---------------------------------------------------------------------------
 * In `gl_journal_lines`, a POSITIVE `amount_cents` is a DEBIT. Everything in
 * this file obeys that and there is a test that fails if the convention is
 * flipped. A shrink DEBITS cost of goods sold and CREDITS inventory; an overage
 * is the exact mirror. Getting this backwards does not crash anything — it
 * silently reports profit as loss, which is precisely why it is tested by name
 * rather than trusted to review.
 */

import type { GuidanceAuthority } from "@/lib/accounting/books-guidance-core";
import {
  resolveAuditAuthorities,
  assessLine,
  extendCostCents,
  formatCents,
  type AuditLot,
  type AuditCountLine,
  type LineAssessment,
  type MaterialityPolicy,
  DEFAULT_MATERIALITY,
} from "./inventory-audit-core";

// ═══════════════════════════════════════════════════════════════════════════
// 1) THE STATES A SESSION CAN BE IN
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Mirrors `inventory_audit_sessions_status_ck` in migration 0191, in the same
 * order. If these two lists ever disagree, the database wins and this file is
 * wrong — which is why a test reads the migration off disk and compares.
 */
export const AUDIT_SESSION_STATUSES = [
  "draft",
  "scope_approved",
  "counting",
  "review",
  "approved",
  "cancelled",
] as const;

export type AuditSessionStatus = (typeof AUDIT_SESSION_STATUSES)[number];

export function isAuditSessionStatus(v: string): v is AuditSessionStatus {
  return (AUDIT_SESSION_STATUSES as readonly string[]).includes(v);
}

/**
 * The single status from which inventory may actually move.
 *
 * Deliberately ONE value, not a set. "Approved or review" would be convenient
 * and would mean a session could post while the owner was still reading it.
 */
export const POSTABLE_STATUS: AuditSessionStatus = "approved";

/**
 * The legal moves, written down rather than left implicit in whichever `if`
 * happened to be typed first. Everything not listed here is refused.
 *
 * Note what is NOT here: nothing returns from `approved`, and nothing returns
 * from `cancelled`. An approval that can be walked back quietly is not an
 * approval, and a cancelled session that can be revived is a way to make a
 * count that was abandoned for a reason come back without that reason.
 */
export const LEGAL_STATUS_MOVES: Readonly<Record<AuditSessionStatus, readonly AuditSessionStatus[]>> = {
  draft: ["scope_approved", "cancelled"],
  scope_approved: ["counting", "cancelled"],
  counting: ["review", "cancelled"],
  review: ["approved", "counting", "cancelled"],
  approved: [],
  cancelled: [],
};

export type StatusMoveVerdict = {
  allowed: boolean;
  /** Plain English, aimed at whoever clicked the button. */
  reason: string;
};

export function canMoveStatus(
  from: AuditSessionStatus,
  to: AuditSessionStatus,
): StatusMoveVerdict {
  if (from === to) {
    return {
      allowed: false,
      reason: `This audit is already ${LABELS[from]}. Nothing to change.`,
    };
  }
  const allowed = LEGAL_STATUS_MOVES[from];
  if (allowed.includes(to)) {
    return { allowed: true, reason: `Moving from ${LABELS[from]} to ${LABELS[to]}.` };
  }
  if (from === "approved") {
    return {
      allowed: false,
      reason:
        "This audit has already been approved, and an approval cannot be taken back. " +
        "If the result was wrong, the fix is a new audit and a correcting entry, " +
        "so that the record shows what happened instead of hiding it.",
    };
  }
  if (from === "cancelled") {
    return {
      allowed: false,
      reason:
        "This audit was cancelled. A cancelled audit stays cancelled — start a new " +
        "one rather than reviving this one, so the abandoned count is still on the record.",
    };
  }
  return {
    allowed: false,
    reason:
      `An audit that is ${LABELS[from]} cannot jump straight to ${LABELS[to]}. ` +
      `From here the only options are: ${allowed.map((s) => LABELS[s]).join(", ") || "none"}.`,
  };
}

/** Plain-English names. Staff read these, so they say what happened, not what enum it is. */
export const LABELS: Readonly<Record<AuditSessionStatus, string>> = {
  draft: "being planned",
  scope_approved: "ready to count",
  counting: "being counted",
  review: "waiting for your review",
  approved: "approved",
  cancelled: "cancelled",
};

// ═══════════════════════════════════════════════════════════════════════════
// 2) THE ACCOUNT PAIR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The chart of accounts pairs inventory, sales and cost of goods sold on a
 * shared last-four-digit suffix: inventory 2xxxx, sales 5xxxx, COGS 6xxxx. So
 * flower at 20140 has its cost of sales at 60140. That relationship is what
 * lets a count variance find its own accounts instead of being hand-mapped in
 * a table that would drift the first time a category was added.
 *
 * This function derives the COGS code from the inventory code, and REFUSES
 * rather than guessing when the input is not a well-formed inventory account.
 * Refusing is the whole point: a silently wrong account code posts a real
 * number to the wrong line of the tax return, and nothing about the books will
 * look broken afterwards.
 */
export type AccountPair =
  | { ok: true; inventoryAccountCode: string; cogsAccountCode: string }
  | { ok: false; problem: string };

export function deriveCogsAccount(inventoryAccountCode: string): AccountPair {
  const code = inventoryAccountCode.trim();
  if (!/^\d{5}$/.test(code)) {
    return {
      ok: false,
      problem:
        `"${inventoryAccountCode}" is not a five-digit account number, so the matching ` +
        "cost-of-goods account cannot be worked out. Nothing was posted.",
    };
  }
  if (!code.startsWith("2")) {
    return {
      ok: false,
      problem:
        `Account ${code} is not an inventory account (inventory accounts start with 2). ` +
        "A count variance can only move inventory, so nothing was posted.",
    };
  }
  return {
    ok: true,
    inventoryAccountCode: code,
    cogsAccountCode: `6${code.slice(1)}`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 3) WHETHER THIS SESSION MAY POST AT ALL
// ═══════════════════════════════════════════════════════════════════════════

export type SessionForPosting = {
  sessionId: string;
  status: string;
  /** Set once the session has already moved inventory. Non-null = done. */
  postedAt: string | null;
  resultApprovedBy: string | null;
  resultApprovedAt: string | null;
  label: string;
};

export type PostGateVerdict = {
  mayPost: boolean;
  /** Machine-readable, for tests and for the store to branch on. */
  code:
    | "OK"
    | "NOT_APPROVED"
    | "ALREADY_POSTED"
    | "APPROVAL_NOT_EVIDENCED"
    | "NO_LINES"
    | "NOTHING_TO_POST";
  /** Written for Michael. */
  reason: string;
};

/**
 * The gate. Every condition here is a refusal, never a warning, per rule 14:
 * a blocked legitimate action costs a minute, a permitted illegitimate one
 * costs an audit.
 */
export function gateSessionForPosting(
  session: SessionForPosting,
  assessments: readonly LineAssessment[],
): PostGateVerdict {
  if (session.postedAt !== null) {
    return {
      mayPost: false,
      code: "ALREADY_POSTED",
      reason:
        `"${session.label}" was already posted on ${session.postedAt}. Posting it again ` +
        "would move the same inventory a second time and invent a shortage that never " +
        "happened, so it is refused.",
    };
  }
  if (session.status !== POSTABLE_STATUS) {
    return {
      mayPost: false,
      code: "NOT_APPROVED",
      reason:
        `"${session.label}" is ${
          isAuditSessionStatus(session.status) ? LABELS[session.status] : session.status
        }. ` + "Only an approved audit can change inventory. Nothing was posted.",
    };
  }
  // 0191 constrains this too. Checked here as well because a constraint tells
  // you at write time and this tells you at decision time, and the decision
  // time message is the one a human reads.
  if (session.resultApprovedBy === null || session.resultApprovedAt === null) {
    return {
      mayPost: false,
      code: "APPROVAL_NOT_EVIDENCED",
      reason:
        `"${session.label}" is marked approved but does not record who approved it or when. ` +
        "An approval nobody signed is exactly what an auditor writes up, so this is refused " +
        "until the record is complete.",
    };
  }
  if (assessments.length === 0) {
    return {
      mayPost: false,
      code: "NO_LINES",
      reason:
        `"${session.label}" has no count lines at all. An audit with nothing in it is not ` +
        "evidence that everything is fine — it is evidence that nothing was looked at.",
    };
  }
  const movable = assessments.filter((a) => isMovable(a));
  if (movable.length === 0) {
    return {
      mayPost: false,
      code: "NOTHING_TO_POST",
      reason:
        `Every line in "${session.label}" matched the books exactly. There is nothing to ` +
        "correct, which is the outcome you want. The audit is complete and no entry is needed.",
    };
  }
  return {
    mayPost: true,
    code: "OK",
    reason: `${movable.length} line(s) differ from the books and will be corrected.`,
  };
}

/**
 * A line moves inventory only if somebody actually counted it AND what they
 * found differs from the books.
 *
 * The `varianceQty !== null` test is doing more work than it looks like. An
 * uncounted line has a NULL variance, and NULL is not zero: zero means a person
 * looked and found nothing, NULL means nobody looked. Collapsing them would
 * take every lot that was never counted and write it off to zero — turning an
 * incomplete audit into the largest shrink adjustment in the shop's history.
 */
export function isMovable(a: LineAssessment): boolean {
  return a.varianceQty !== null && a.varianceQty !== 0 && a.effectiveCountedQty !== null;
}

// ═══════════════════════════════════════════════════════════════════════════
// 4) THE PLAN
// ═══════════════════════════════════════════════════════════════════════════

/** One shelf correction. Quantities, not money. */
export type AdjustmentInstruction = {
  lotId: string;
  /** Signed. Negative = the shelf had less than the books said. */
  qtyDelta: number;
  /** Always 'count' — the established reason code in inventory_adjustments. */
  reason: "count";
  note: string;
  /** What the lot's on-hand must become. Computed, never re-derived later. */
  newOnHandQty: number;
};

/** One line of the draft journal. POSITIVE = DEBIT. */
export type PostJournalLine = {
  accountCode: string;
  amountCents: number;
  memo: string;
};

export type PostPlan = {
  sessionId: string;
  adjustments: AdjustmentInstruction[];
  journalLines: PostJournalLine[];
  /** Sum of signed variances in cents. What actually hits the books. */
  netVarianceCents: number;
  /** Sum of absolute variances. What tells you if the books are in control. */
  grossVarianceCents: number;
  /** Lines that need Michael's decision before they can be written off. */
  needsOwnerDecision: string[];
  warnings: string[];
  authorityIds: string[];
  /** Plain English, for the approval screen and the audit file. */
  explanation: string;
  balanced: boolean;
};

export type BuildPostPlanInput = {
  session: SessionForPosting;
  lots: readonly AuditLot[];
  lines: readonly AuditCountLine[];
  /** Inventory account per house category slug, e.g. { flower: "20140" }. */
  accountByCategory: Readonly<Record<string, string>>;
  policy?: MaterialityPolicy;
};

export type BuildPostPlanResult =
  | { ok: true; plan: PostPlan }
  | {
      ok: false;
      code: PostGateVerdict["code"] | "ACCOUNT_UNRESOLVED" | "DUPLICATE_LINES";
      problem: string;
    };

/**
 * THE LAST LINE OF DEFENCE, EXTRACTED SO IT CAN BE PROVEN.
 *
 * `buildPostPlan` writes journal lines in mirrored pairs, so with today's code
 * this can never report a failure. That is exactly what makes it dangerous to
 * leave inline: a mutation that deletes an unreachable check changes no
 * observable behaviour, so NO behavioural test can kill it, and the campaign
 * for this slice proved it — replacing `if (!balanced)` with `if (false)`
 * survived BOTH gates. A guard that cannot be proven to work is not a guard;
 * it is a comment that looks like one.
 *
 * Extracting it makes it callable with input `buildPostPlan` would never
 * produce, so the guard itself is tested directly, and a mutation to it now
 * dies. The check stays because the pairing could be changed by a future edit,
 * and an unbalanced entry reaching the general ledger is the single thing a
 * double-entry system exists to make impossible.
 */
export function checkJournalBalance(
  lines: readonly PostJournalLine[],
): { balanced: true } | { balanced: false; problem: string } {
  const debits = lines.filter((l) => l.amountCents > 0).reduce((s, l) => s + l.amountCents, 0);
  const credits = lines.filter((l) => l.amountCents < 0).reduce((s, l) => s - l.amountCents, 0);
  if (debits === credits) return { balanced: true };
  return {
    balanced: false,
    problem:
      `The draft entry does not balance (${formatCents(debits)} against ${formatCents(credits)}). ` +
      "This is a bug, not a data problem, and nothing was posted.",
  };
}

/**
 * Turn an approved session into the exact set of writes the store should make.
 *
 * Everything is computed here and nothing is left for the store to work out,
 * so that the arithmetic is testable without a database and so the store
 * cannot quietly disagree with the plan it was handed.
 */
export function buildPostPlan(input: BuildPostPlanInput): BuildPostPlanResult {
  const { session, lots, lines, accountByCategory } = input;
  const policy = input.policy ?? DEFAULT_MATERIALITY;

  // ───────────────────────────────────────────────────────────────────────
  // DUPLICATE LINES ARE REFUSED BEFORE ANYTHING ELSE HAPPENS.
  //
  // Found by attacking this module: two count lines for the SAME lot produced
  // two separate shelf corrections. A lot that held 100, counted once at 90 and
  // once at 80, planned a move of -10 AND a move of -20 and would have left 70
  // on the shelf — a quantity nobody counted, wrong by either measure — while
  // booking $150 of shrink where the truth is at most $100. The two rows even
  // disagreed with each other about what the new on-hand should be (90 vs 80).
  //
  // The database already forbids this with `unique (session_id, lot_id)` in
  // 0191, and this check is here anyway on purpose: the core is what DECIDES,
  // and a decision that is only correct because something downstream happens to
  // reject it is not a correct decision. It is also the same family as the
  // lot-code failure — two records claiming to describe one physical lot.
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const l of lines) {
    if (seen.has(l.lotId)) dupes.add(l.lotId);
    seen.add(l.lotId);
  }
  if (dupes.size > 0) {
    const names = [...dupes]
      .sort()
      .map((id) => lots.find((l) => l.lotId === id)?.lotCode ?? id)
      .join(", ");
    return {
      ok: false,
      code: "DUPLICATE_LINES",
      problem:
        `This audit has more than one count sheet line for the same lot (${names}). ` +
        "Two counts of one lot cannot both be right, and applying both would move the shelf " +
        "twice to a number nobody counted. Nothing was posted — delete the duplicate line " +
        "and approve again.",
    };
  }

  const lotById = new Map(lots.map((l) => [l.lotId, l]));
  const lineByLot = new Map(lines.map((l) => [l.lotId, l]));
  const assessments: LineAssessment[] = [];
  for (const line of lines) {
    const lot = lotById.get(line.lotId);
    if (!lot) continue;
    assessments.push(assessLine(lot, line, policy));
  }

  const gate = gateSessionForPosting(session, assessments);
  if (!gate.mayPost) {
    return { ok: false, code: gate.code, problem: gate.reason };
  }

  const adjustments: AdjustmentInstruction[] = [];
  const journalLines: PostJournalLine[] = [];
  const needsOwnerDecision: string[] = [];
  const warnings: string[] = [];
  const authorityIds = new Set<string>([
    "REG_1_471_2_D_VERIFY_BY_COUNT",
    "REG_1_471_3_B_RESELLER_COST",
  ]);

  let net = 0;
  let gross = 0;

  // Deterministic order. Two runs over the same data must produce byte-identical
  // plans, otherwise a diff between them is unreadable and a test is flaky.
  const ordered = [...assessments].sort((a, b) => (a.lotId < b.lotId ? -1 : a.lotId > b.lotId ? 1 : 0));

  for (const a of ordered) {
    if (!isMovable(a)) continue;
    const lot = lotById.get(a.lotId);
    if (!lot) continue;

    const qtyDelta = a.varianceQty as number;
    const label = lot.lotCode ?? lot.productName ?? lot.lotId;

    // ---- the shelf ----
    const newOnHand = lot.onHandQty + qtyDelta;
    if (newOnHand < 0) {
      // Michael's Sage file is full of negative inventory. It is arithmetically
      // impossible to hold less than nothing, so a plan that would create it is
      // refused outright rather than clamped: clamping hides the contradiction,
      // and the contradiction is the finding.
      return {
        ok: false,
        code: "ACCOUNT_UNRESOLVED",
        problem:
          `Correcting ${label} by ${qtyDelta} would leave ${newOnHand} on the shelf, and a ` +
          "shelf cannot hold less than nothing. That means the counted number and the system " +
          "number disagree in a way that needs a person to look, not an entry. Nothing was posted.",
      };
    }
    adjustments.push({
      lotId: a.lotId,
      qtyDelta,
      reason: "count",
      note: `Audit ${session.label}: counted ${a.effectiveCountedQty}, books said ${
        lot.onHandQty
      }.`,
      newOnHandQty: newOnHand,
    });

    // ---- the books ----
    // An unvalued line still corrects the SHELF but cannot touch the books:
    // posting it would require inventing a cost, and an invented cost is a plug.
    if (a.varianceCents === null) {
      warnings.push(
        `${label}: the shelf count is corrected, but this lot has no recorded cost, so the ` +
          "money side cannot be worked out. The books are left alone rather than guessed at. " +
          "Add the invoice cost and this will settle itself.",
      );
      continue;
    }

    const varianceCents = a.varianceCents;
    net += varianceCents;
    gross += Math.abs(varianceCents);

    const slug = lot.categorySlug ?? "";
    const invCode = accountByCategory[slug];
    if (!invCode) {
      return {
        ok: false,
        code: "ACCOUNT_UNRESOLVED",
        problem:
          `${label} is in category "${slug || "(none)"}", which has no inventory account ` +
          "assigned. Rather than post it somewhere plausible and let it drift, nothing was " +
          "posted. Assign the account and run this again.",
      };
    }
    const pair = deriveCogsAccount(invCode);
    if (!pair.ok) {
      return { ok: false, code: "ACCOUNT_UNRESOLVED", problem: `${label}: ${pair.problem}` };
    }

    const isShrink = varianceCents < 0;
    // "Documented" means a human wrote SOMETHING down. A structured reason code
    // or free text both count; whitespace does not, because a space bar is not
    // an explanation.
    const src = lineByLot.get(a.lotId);
    const documented =
      (src?.reason ?? "").trim().length > 0 || (src?.note ?? "").trim().length > 0;
    if (isShrink && !documented) {
      needsOwnerDecision.push(
        `${label}: ${formatCents(Math.abs(varianceCents))} went missing with no reason recorded. ` +
          "Washington treats an undocumented reduction as a sale and charges the 37% excise on " +
          "it, so this one needs your decision before it is written off.",
      );
      authorityIds.add("WAC_314_55_089_4_C_DEEMED_SALES");
    }

    // THE SIGN WALL. Positive = DEBIT.
    // Shrink  -> DEBIT cost of goods sold, CREDIT inventory.
    // Overage -> CREDIT cost of goods sold, DEBIT inventory.
    journalLines.push({
      accountCode: pair.cogsAccountCode,
      amountCents: -varianceCents,
      memo: `${isShrink ? "Count shortage" : "Count overage"} — ${label}`,
    });
    journalLines.push({
      accountCode: pair.inventoryAccountCode,
      amountCents: varianceCents,
      memo: `${isShrink ? "Count shortage" : "Count overage"} — ${label}`,
    });
  }

  const balance = checkJournalBalance(journalLines);
  const balanced = balance.balanced;

  if (!balanced) {
    // Cannot happen with the mirrored pair above, which is exactly why it is
    // checked: if it ever does happen, something changed and the entry must not
    // reach the ledger while it is wrong.
    return { ok: false, code: "ACCOUNT_UNRESOLVED", problem: balance.problem };
  }

  return {
    ok: true,
    plan: {
      sessionId: session.sessionId,
      adjustments,
      journalLines,
      netVarianceCents: net,
      grossVarianceCents: gross,
      needsOwnerDecision,
      warnings,
      authorityIds: [...authorityIds].sort(),
      explanation: explainPlan(adjustments.length, net, gross, needsOwnerDecision.length),
      balanced,
    },
  };
}

/**
 * The sentence a human reads. It reports NET and GROSS separately and always
 * in that order, because a $600 overage and a $600 shortage net to zero and
 * look perfect while being two separate errors. A report that shows only the
 * net teaches the owner that offsetting mistakes are the same as no mistakes.
 */
export function explainPlan(
  lineCount: number,
  netCents: number,
  grossCents: number,
  needingDecision: number,
): string {
  const parts: string[] = [];
  parts.push(
    `${lineCount} lot${lineCount === 1 ? "" : "s"} did not match the books and will be corrected.`,
  );
  if (netCents === 0 && grossCents === 0) {
    parts.push("The money effect is zero.");
  } else if (netCents < 0) {
    parts.push(`The books will go DOWN by ${formatCents(Math.abs(netCents))}.`);
  } else if (netCents > 0) {
    parts.push(`The books will go UP by ${formatCents(netCents)}.`);
  } else {
    parts.push("The ups and downs cancel out exactly.");
  }
  if (grossCents !== Math.abs(netCents)) {
    parts.push(
      `Counting every difference regardless of direction, ${formatCents(grossCents)} moved. ` +
        "That is the honest measure of how far the books were off, because an overage on one " +
        "lot and a shortage on another are two mistakes, not zero.",
    );
  }
  if (needingDecision > 0) {
    parts.push(
      `${needingDecision} of them need your decision first because no reason was recorded.`,
    );
  }
  return parts.join(" ");
}

// ═══════════════════════════════════════════════════════════════════════════
// 5) THE HISTORY ROW
// ═══════════════════════════════════════════════════════════════════════════

/**
 * What gets written to `inventory_audit_history`, which outlives the lot.
 *
 * The label and product key are copied in rather than joined later on purpose:
 * a lot row can be deleted, and when it is, the audit record of what was
 * counted must not vanish with it. WAC 314-55-087 requires the record be
 * keepable for years; a foreign key that cascades to nothing is not a record.
 */
export type HistoryRow = {
  lotId: string;
  lotLabel: string;
  posProductKey: string | null;
  sessionId: string;
  systemQty: number;
  countedQty: number | null;
  varianceQty: number | null;
  varianceCents: number | null;
  reasonCode: string | null;
  hadVariance: boolean;
};

export function buildHistoryRows(
  sessionId: string,
  lots: readonly AuditLot[],
  lines: readonly AuditCountLine[],
  policy: MaterialityPolicy = DEFAULT_MATERIALITY,
): HistoryRow[] {
  const lotById = new Map(lots.map((l) => [l.lotId, l]));
  const rows: HistoryRow[] = [];
  for (const line of lines) {
    const lot = lotById.get(line.lotId);
    if (!lot) continue;
    // A line nobody counted produces NO history row. History is a record of
    // counts that happened; writing a row for a lot nobody looked at would put
    // a fictional count in the coverage record and make the next audit skip it.
    const effective = line.recountQty !== null ? line.recountQty : line.countedQty;
    if (effective === null) continue;
    const a = assessLine(lot, line, policy);
    rows.push({
      lotId: lot.lotId,
      lotLabel: lot.lotCode ?? lot.productName ?? lot.lotId,
      posProductKey: lot.posProductKey,
      sessionId,
      systemQty: line.systemQty,
      countedQty: effective,
      varianceQty: a.varianceQty,
      varianceCents: a.varianceCents,
      reasonCode: line.reason,
      hadVariance: a.varianceQty !== null && a.varianceQty !== 0,
    });
  }
  return rows.sort((x, y) => (x.lotId < y.lotId ? -1 : x.lotId > y.lotId ? 1 : 0));
}

/**
 * Which lots may have their coverage memory updated.
 *
 * ONLY lots somebody actually counted. This is the single most consequential
 * rule in the coverage system: stamping `last_counted_at` on a lot nobody
 * counted tells every future audit that the lot is fresh, and it will not come
 * up again for another cadence. One wrong stamp hides a lot for months.
 */
export function lotsToStampAsCounted(lines: readonly AuditCountLine[]): string[] {
  return lines
    .filter((l) => (l.recountQty !== null ? l.recountQty : l.countedQty) !== null)
    .map((l) => l.lotId)
    .sort();
}

export function resolvePostAuthorities(ids: readonly string[]): GuidanceAuthority[] {
  return resolveAuditAuthorities(ids);
}

// ═══════════════════════════════════════════════════════════════════════════
// 6) SELF-TESTS
// ═══════════════════════════════════════════════════════════════════════════

function ok(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`inventory-audit-post-core: ${msg}`);
}
function eq(actual: unknown, expected: unknown, msg: string): void {
  if (actual !== expected) {
    throw new Error(`inventory-audit-post-core: ${msg} (expected ${String(expected)}, got ${String(actual)})`);
  }
}

function tLot(over: Partial<AuditLot> = {}): AuditLot {
  return {
    lotId: "lot-1",
    lotCode: "LOT-001",
    posProductKey: "prod-1",
    productName: "Blue Dream 3.5g",
    categorySlug: "flower",
    vendorId: "v1",
    vendorName: "Vendor",
    onHandQty: 100,
    unitCostMinorUnits: 500,
    lastCountedAt: null,
    priorVarianceCount: 0,
    status: "active",
    ...over,
  };
}
function tLine(over: Partial<AuditCountLine> = {}): AuditCountLine {
  return {
    lotId: "lot-1",
    systemQty: 100,
    countedQty: 100,
    recountQty: null,
    reason: null,
    note: null,
    ...over,
  };
}
function tSession(over: Partial<SessionForPosting> = {}): SessionForPosting {
  return {
    sessionId: "sess-1",
    status: "approved",
    postedAt: null,
    resultApprovedBy: "owner-1",
    resultApprovedAt: "2026-11-02T10:00:00Z",
    label: "November A-lots",
    ...over,
  };
}
const ACCOUNTS = { flower: "20140", edible: "20150" } as const;

export function __runInventoryAuditPostCoreTests(): void {
  // ---- status machine ----
  eq(AUDIT_SESSION_STATUSES.length, 6, "six statuses, matching 0191");
  ok(canMoveStatus("review", "approved").allowed, "review -> approved is legal");
  ok(!canMoveStatus("draft", "approved").allowed, "draft may NOT jump to approved");
  ok(!canMoveStatus("approved", "counting").allowed, "approved is terminal");
  ok(!canMoveStatus("cancelled", "draft").allowed, "cancelled is terminal");
  ok(!canMoveStatus("draft", "draft").allowed, "a no-op move is refused, not silently allowed");
  ok(
    /cannot be taken back/i.test(canMoveStatus("approved", "review").reason),
    "the refusal explains WHY approval is final",
  );
  // negative control: prove the machine is not simply refusing everything
  ok(canMoveStatus("draft", "scope_approved").allowed, "NEGATIVE CONTROL: legal moves are allowed");
  ok(canMoveStatus("counting", "review").allowed, "NEGATIVE CONTROL: counting -> review allowed");
  ok(canMoveStatus("review", "counting").allowed, "review may send it back for a recount");

  // ---- account derivation ----
  const p = deriveCogsAccount("20140");
  ok(p.ok, "20140 resolves");
  if (p.ok) eq(p.cogsAccountCode, "60140", "inventory 20140 pairs with COGS 60140");
  ok(!deriveCogsAccount("2014").ok, "four digits is refused");
  ok(!deriveCogsAccount("50140").ok, "a revenue account is refused as inventory");
  ok(!deriveCogsAccount("").ok, "empty is refused");
  ok(!deriveCogsAccount("2014X").ok, "non-numeric is refused");
  // negative control
  ok(deriveCogsAccount("20150").ok, "NEGATIVE CONTROL: a valid inventory code still resolves");

  // ---- the gate ----
  const cleanA = [assessLine(tLot(), tLine())];
  eq(gateSessionForPosting(tSession(), cleanA).code, "NOTHING_TO_POST", "a perfect count posts nothing");
  eq(
    gateSessionForPosting(tSession({ status: "review" }), cleanA).code,
    "NOT_APPROVED",
    "an unapproved session is refused",
  );
  eq(
    gateSessionForPosting(tSession({ postedAt: "2026-11-02T12:00:00Z" }), cleanA).code,
    "ALREADY_POSTED",
    "THE DOUBLE-POST: a session that already posted is refused",
  );
  eq(
    gateSessionForPosting(tSession({ resultApprovedBy: null }), cleanA).code,
    "APPROVAL_NOT_EVIDENCED",
    "approved by nobody is refused",
  );
  eq(gateSessionForPosting(tSession(), []).code, "NO_LINES", "an empty audit is not a clean bill of health");
  // negative control: something that SHOULD pass the gate
  const varied = [assessLine(tLot(), tLine({ countedQty: 90 }))];
  eq(gateSessionForPosting(tSession(), varied).code, "OK", "NEGATIVE CONTROL: a real variance passes the gate");

  // ---- NULL IS NOT ZERO ----
  const uncounted = assessLine(tLot(), tLine({ countedQty: null }));
  ok(!isMovable(uncounted), "an uncounted line moves nothing");
  const zeroCount = assessLine(tLot(), tLine({ countedQty: 0 }));
  ok(isMovable(zeroCount), "counting zero IS a finding and does move");
  eq(zeroCount.varianceQty, -100, "counting zero against 100 is a shrink of 100");

  // BOTH GUARDS ARE LOAD-BEARING, AND EACH IS PROVEN SEPARATELY.
  // Today assessLine() always sets varianceQty and effectiveCountedQty
  // together, so no fixture built from assessLine() can reach the second
  // clause on its own -- which means a mutation that DELETES that clause
  // survives every example-based test. It was proven to survive: the pure
  // runner still exited 0 with `a.effectiveCountedQty !== null` removed.
  // The clause is not decorative. It is the last thing standing between an
  // uncounted lot and a write-off of stock that is sitting on the shelf, which
  // 26 C.F.R. §1.471-2(f)(3) forbids. So it is asserted DIRECTLY, against a
  // hand-built assessment that today's assessLine() cannot produce but a
  // future edit to assessLine() could.
  ok(
    !isMovable({ ...zeroCount, effectiveCountedQty: null }),
    "A VARIANCE WITH NO COUNT BEHIND IT MOVES NOTHING — proven without going through assessLine()",
  );
  ok(
    !isMovable({ ...zeroCount, varianceQty: null }),
    "and a count with no variance behind it moves nothing either",
  );
  ok(
    isMovable({ ...zeroCount, varianceQty: -1, effectiveCountedQty: 99 }),
    "NEGATIVE CONTROL: with both facts present the same shape does move",
  );

  // ---- the plan, and the sign wall ----
  const shrink = buildPostPlan({
    session: tSession(),
    lots: [tLot()],
    lines: [tLine({ countedQty: 90, reason: "damage", note: "broken jars" })],
    accountByCategory: ACCOUNTS,
  });
  // ---- THE BALANCE GUARD, PROVEN DIRECTLY ----
  // Mutating the inline `if (!balanced)` to `if (false)` used to survive BOTH
  // gates, because buildPostPlan cannot produce an unbalanced pair and so no
  // behavioural test could reach the branch. Extracted and called with input
  // buildPostPlan would never generate, the guard is now provable.
  ok(checkJournalBalance([]).balanced, "no lines at all is trivially balanced");
  ok(
    checkJournalBalance([
      { accountCode: "60140", amountCents: 5_000, memo: "m" },
      { accountCode: "20140", amountCents: -5_000, memo: "m" },
    ]).balanced,
    "a mirrored pair balances",
  );
  const unbal = checkJournalBalance([
    { accountCode: "60140", amountCents: 5_000, memo: "m" },
    { accountCode: "20140", amountCents: -4_999, memo: "m" },
  ]);
  ok(!unbal.balanced, "ONE CENT OUT IS OUT — an unbalanced entry never reaches the ledger");
  ok(
    !unbal.balanced && /does not balance/i.test(unbal.problem),
    "and it says so in words, naming both sides",
  );
  ok(
    !checkJournalBalance([{ accountCode: "60140", amountCents: 1, memo: "m" }]).balanced,
    "a lone debit with no credit is refused",
  );

  // ---- WHITESPACE IS NOT AN EXPLANATION ----
  // A space bar is not a reason. Michael's staff will hit the space bar.
  for (const blank of ["   ", "\t", "\n"]) {
    const ws = buildPostPlan({
      session: tSession(),
      lots: [tLot()],
      lines: [tLine({ countedQty: 90, reason: blank, note: blank })],
      accountByCategory: ACCOUNTS,
    });
    ok(ws.ok, "a whitespace-documented shrink still plans");
    ok(
      ws.ok && ws.plan.needsOwnerDecision.length === 1,
      `whitespace (${JSON.stringify(blank)}) does NOT count as a recorded reason`,
    );
  }
  const realNote = buildPostPlan({
    session: tSession(),
    lots: [tLot()],
    lines: [tLine({ countedQty: 90, reason: null, note: "dropped, witnessed" })],
    accountByCategory: ACCOUNTS,
  });
  ok(
    realNote.ok && realNote.plan.needsOwnerDecision.length === 0,
    "NEGATIVE CONTROL: real text DOES document the write-off",
  );

  ok(shrink.ok, "a documented shrink plans successfully");
  if (shrink.ok) {
    eq(shrink.plan.adjustments.length, 1, "one shelf correction");
    eq(shrink.plan.adjustments[0].qtyDelta, -10, "shelf falls by 10");
    eq(shrink.plan.adjustments[0].newOnHandQty, 90, "new on-hand is 90");
    eq(shrink.plan.netVarianceCents, -5000, "10 units at $5.00 = -$50.00");
    eq(shrink.plan.grossVarianceCents, 5000, "gross equals net when there is one line");
    const cogs = shrink.plan.journalLines.find((l) => l.accountCode === "60140");
    const inv = shrink.plan.journalLines.find((l) => l.accountCode === "20140");
    ok(!!cogs && !!inv, "both sides present");
    ok(
      (cogs as PostJournalLine).amountCents === 5000,
      "THE SIGN WALL: a shrink DEBITS cost of goods (positive)",
    );
    ok(
      (inv as PostJournalLine).amountCents === -5000,
      "THE SIGN WALL: a shrink CREDITS inventory (negative)",
    );
    ok(shrink.plan.balanced, "the entry balances");
    eq(shrink.plan.needsOwnerDecision.length, 0, "a documented shrink needs no extra decision");
  }

  // overage is the exact mirror
  const over = buildPostPlan({
    session: tSession(),
    lots: [tLot()],
    lines: [tLine({ countedQty: 110 })],
    accountByCategory: ACCOUNTS,
  });
  ok(over.ok, "an overage plans");
  if (over.ok) {
    const cogs = over.plan.journalLines.find((l) => l.accountCode === "60140");
    const inv = over.plan.journalLines.find((l) => l.accountCode === "20140");
    eq((cogs as PostJournalLine).amountCents, -5000, "an overage CREDITS cost of goods");
    eq((inv as PostJournalLine).amountCents, 5000, "an overage DEBITS inventory");
    eq(over.plan.netVarianceCents, 5000, "net is positive");
  }

  // ---- undocumented shrink needs Michael ----
  const undoc = buildPostPlan({
    session: tSession(),
    lots: [tLot()],
    lines: [tLine({ countedQty: 90 })],
    accountByCategory: ACCOUNTS,
  });
  ok(undoc.ok, "it still plans");
  if (undoc.ok) {
    eq(undoc.plan.needsOwnerDecision.length, 1, "an undocumented shrink is flagged for the owner");
    ok(/37%/.test(undoc.plan.needsOwnerDecision[0]), "and the excise consequence is stated");
    ok(
      undoc.plan.authorityIds.includes("WAC_314_55_089_4_C_DEEMED_SALES"),
      "and the authority is cited",
    );
  }

  // ---- GROSS vs NET: offsetting errors must not look like no errors ----
  const offset = buildPostPlan({
    session: tSession(),
    lots: [
      tLot({ lotId: "a", lotCode: "A" }),
      tLot({ lotId: "b", lotCode: "B" }),
    ],
    lines: [
      tLine({ lotId: "a", countedQty: 90, reason: "damage" }),
      tLine({ lotId: "b", countedQty: 110 }),
    ],
    accountByCategory: ACCOUNTS,
  });
  ok(offset.ok, "offsetting variances plan");
  if (offset.ok) {
    eq(offset.plan.netVarianceCents, 0, "they net to zero");
    eq(offset.plan.grossVarianceCents, 10000, "but gross is $100.00 — two real errors");
    ok(
      /honest measure/i.test(offset.plan.explanation),
      "and the explanation refuses to let net stand alone",
    );
  }

  // ---- refusals that protect the books ----
  const noAccount = buildPostPlan({
    session: tSession(),
    lots: [tLot({ categorySlug: "mystery" })],
    lines: [tLine({ countedQty: 90, reason: "damage" })],
    accountByCategory: ACCOUNTS,
  });
  ok(!noAccount.ok, "an unmapped category refuses rather than guessing an account");
  if (!noAccount.ok) eq(noAccount.code, "ACCOUNT_UNRESOLVED", "with the right code");

  const negative = buildPostPlan({
    session: tSession(),
    lots: [tLot({ onHandQty: 5 })],
    lines: [tLine({ systemQty: 5, countedQty: 0, reason: "damage" })],
    accountByCategory: ACCOUNTS,
  });
  ok(negative.ok, "counting a lot down to zero is legal");
  const impossible = buildPostPlan({
    session: tSession(),
    // system says 100 but the lot only holds 5 -> correcting by -95 would go to -90
    lots: [tLot({ onHandQty: 5 })],
    lines: [tLine({ systemQty: 100, countedQty: 5, reason: "damage" })],
    accountByCategory: ACCOUNTS,
  });
  ok(!impossible.ok, "a correction that would create NEGATIVE inventory is refused");
  if (!impossible.ok) ok(/less than nothing/i.test(impossible.problem), "and says so plainly");

  // ---- DUPLICATE LINES (found by attacking this module) ----
  const dupPlan = buildPostPlan({
    session: tSession(),
    lots: [tLot()],
    lines: [tLine({ countedQty: 90, reason: "d" }), tLine({ countedQty: 80, reason: "d" })],
    accountByCategory: ACCOUNTS,
  });
  ok(!dupPlan.ok, "TWO COUNT LINES FOR ONE LOT IS REFUSED, not applied twice");
  if (!dupPlan.ok) {
    eq(dupPlan.code, "DUPLICATE_LINES", "with its own code");
    ok(/nobody counted/i.test(dupPlan.problem), "and explains the shelf would end up wrong");
  }
  // negative control: one line per lot across several lots is fine
  const multi = buildPostPlan({
    session: tSession(),
    lots: [tLot({ lotId: "a" }), tLot({ lotId: "b" })],
    lines: [tLine({ lotId: "a", countedQty: 90, reason: "d" }), tLine({ lotId: "b", countedQty: 95, reason: "d" })],
    accountByCategory: ACCOUNTS,
  });
  ok(multi.ok, "NEGATIVE CONTROL: distinct lots are not mistaken for duplicates");
  if (multi.ok) eq(multi.plan.adjustments.length, 2, "and both are planned");

  // ---- unvalued lots correct the shelf but never the books ----
  const unvalued = buildPostPlan({
    session: tSession(),
    lots: [tLot({ unitCostMinorUnits: null })],
    lines: [tLine({ countedQty: 90, reason: "damage" })],
    accountByCategory: ACCOUNTS,
  });
  ok(unvalued.ok, "an unvalued lot still plans");
  if (unvalued.ok) {
    eq(unvalued.plan.adjustments.length, 1, "the shelf is still corrected");
    eq(unvalued.plan.journalLines.length, 0, "but the books are NOT guessed at");
    eq(unvalued.plan.netVarianceCents, 0, "and no money is invented");
    ok(unvalued.plan.warnings.length > 0, "and it says why");
  }

  // ---- determinism ----
  const mk = () =>
    buildPostPlan({
      session: tSession(),
      lots: [tLot({ lotId: "z" }), tLot({ lotId: "a" }), tLot({ lotId: "m" })],
      lines: [
        tLine({ lotId: "z", countedQty: 90, reason: "d" }),
        tLine({ lotId: "a", countedQty: 90, reason: "d" }),
        tLine({ lotId: "m", countedQty: 90, reason: "d" }),
      ],
      accountByCategory: ACCOUNTS,
    });
  const r1 = mk();
  const r2 = mk();
  ok(r1.ok && r2.ok, "both plan");
  if (r1.ok && r2.ok) {
    eq(JSON.stringify(r1.plan), JSON.stringify(r2.plan), "two runs produce identical plans");
    eq(r1.plan.adjustments[0].lotId, "a", "and they are sorted by lot id");
  }

  // ---- history ----
  const hist = buildHistoryRows(
    "sess-1",
    [tLot({ lotId: "a" }), tLot({ lotId: "b" })],
    [tLine({ lotId: "a", countedQty: 90 }), tLine({ lotId: "b", countedQty: null })],
  );
  eq(hist.length, 1, "only counted lots produce history");
  eq(hist[0].lotId, "a", "and it is the one that was counted");
  ok(hist[0].hadVariance, "the variance flag is set");
  eq(hist[0].lotLabel, "LOT-001", "the label is denormalised so it outlives the lot");

  // ---- coverage stamping ----
  const stamp = lotsToStampAsCounted([
    tLine({ lotId: "a", countedQty: 100 }),
    tLine({ lotId: "b", countedQty: null }),
    tLine({ lotId: "c", countedQty: null, recountQty: 5 }),
  ]);
  eq(stamp.length, 2, "only lots with a real count are stamped");
  ok(stamp.includes("a"), "a counted lot is stamped");
  ok(!stamp.includes("b"), "AN UNCOUNTED LOT IS NEVER STAMPED — it would hide for a cadence");
  ok(stamp.includes("c"), "a recount alone still counts as counted");

  // ---- the extend/round helper still behaves at the boundary ----
  eq(extendCostCents(0.5, 1), 1, "half a cent rounds AWAY from zero");
  eq(extendCostCents(-0.5, 1), -1, "and symmetrically for a loss");
}
