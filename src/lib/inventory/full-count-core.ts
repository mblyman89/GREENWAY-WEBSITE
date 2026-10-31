/**
 * src/lib/inventory/full-count-core.ts   (Fix Phase 4.4d · G-41 · owner D58, D56, D54)
 *
 * PURE. The year-end full count: every active lot, no cap, split into
 * counter-sized sections, one release, one combined review, one work paper.
 *
 * The owner, verbatim (Q-06-5, D58):
 *   "we do a full inventory audit once per year at the end of the year."
 *
 * A full count is a GROUP of ordinary audit sessions (migration 0328 marks
 * them with full_count_id / full_count_year / section_no / section_count).
 * Each section is counted by one employee (D56) through the same Cycle Counts
 * sheet as any other count, so the blind count, the books captured per lot at
 * first count (G-35), the recount rule, the reasons and the posting all apply
 * unchanged. This file decides only what is new:
 *
 *   planFullCount     every lot -> sections of about N lots. A vendor stays
 *                     together where it fits; a big vendor is split, and a
 *                     product (all its lots) is never split across sections
 *                     (the lot-code trap, inventory-audit-core.ts).
 *   rollupFullCount   the sections' statuses -> one stage, the combined
 *                     progress and money, and the one next step for the owner.
 *   fullCountYear     which year-end a count started today belongs to.
 *
 * No cap: the 400-lot limit on "Show every active lot instead" does not apply.
 */
import { groupLotsByProduct, type AuditLot } from "./inventory-audit-core";

/** Default lots per section: about what one person counts in a session. */
export const DEFAULT_SECTION_LOTS = 60;
export const MIN_SECTION_LOTS = 10;
export const MAX_SECTION_LOTS = 300;

export function checkSectionLots(raw: unknown): { ok: true; value: number } | { ok: false; message: string } {
  const n = Number(typeof raw === "string" ? raw.trim() : raw);
  if (!Number.isInteger(n) || n < MIN_SECTION_LOTS || n > MAX_SECTION_LOTS) {
    return {
      ok: false,
      message: `Lots per section is a whole number from ${MIN_SECTION_LOTS} to ${MAX_SECTION_LOTS}. Nothing was created.`,
    };
  }
  return { ok: true, value: n };
}

/**
 * The year-end a full count started on `todayPacific` (YYYY-MM-DD) is for.
 * July..December -> this year; January..June -> last year (a count done on
 * 2 January closes the year just ended).
 */
export function fullCountYear(todayPacific: string): number {
  const [y, m] = todayPacific.split("-").map((x) => Number(x));
  if (!Number.isInteger(y) || !Number.isInteger(m)) return new Date().getUTCFullYear();
  return m >= 7 ? y : y - 1;
}

export function checkFullCountYear(raw: unknown, todayPacific: string): { ok: true; value: number } | { ok: false; message: string } {
  const n = Number(typeof raw === "string" ? raw.trim() : raw);
  const thisYear = Number(todayPacific.slice(0, 4));
  if (!Number.isInteger(n) || n < 2020 || n > thisYear) {
    return { ok: false, message: `The year-end must be a year from 2020 to ${thisYear}. Nothing was created.` };
  }
  return { ok: true, value: n };
}

export type FullCountSection = {
  /** 1-based. */
  no: number;
  lotIds: string[];
  /** Vendor names in this section, in order (a big vendor may say "part 2 of 3"). */
  vendors: string[];
};

export type FullCountPlan = {
  sections: FullCountSection[];
  lotCount: number;
  vendorCount: number;
};

const NO_VENDOR = "\u0000none";

/**
 * Split every lot into sections of about `sectionLots`.
 *
 * Order: vendors A..Z (no vendor last), products A..Z inside a vendor. A
 * product's lots always travel together (never split across two counters,
 * because two lots of one product are the classic mix-up). Small vendors share
 * a section; a vendor bigger than one section is split into parts, each
 * named "Vendor (part i of n)". A single product larger than a section gets a
 * section of its own rather than being split.
 */
export function planFullCount(lots: readonly AuditLot[], sectionLots: number): FullCountPlan {
  const size = Math.max(1, Math.trunc(sectionLots));
  const byVendor = new Map<string, AuditLot[]>();
  for (const l of lots) {
    const id = l.vendorId ?? NO_VENDOR;
    const arr = byVendor.get(id);
    if (arr) arr.push(l);
    else byVendor.set(id, [l]);
  }

  type Unit = { vendorKey: string; vendorName: string; lotIds: string[] };
  const vendors = [...byVendor.entries()].map(([id, arr]) => {
    const name = id === NO_VENDOR ? "Vendor not recorded" : arr.find((l) => l.vendorName)?.vendorName ?? "Unnamed vendor";
    const key = `${id === NO_VENDOR ? "\uffff" : ""}${name.toLowerCase()}\u0000${id}`;
    const groups = [...groupLotsByProduct(arr).entries()].sort(
      (a, b) => (a[1][0]?.productName ?? "").localeCompare(b[1][0]?.productName ?? "") || a[0].localeCompare(b[0]),
    );
    // Chunk this vendor's products into parts no bigger than one section.
    const parts: string[][] = [];
    let cur: string[] = [];
    for (const [, members] of groups) {
      if (cur.length > 0 && cur.length + members.length > size) {
        parts.push(cur);
        cur = [];
      }
      cur.push(...members.map((m) => m.lotId).sort());
    }
    if (cur.length > 0) parts.push(cur);
    const units: Unit[] = parts.map((p, i) => ({
      vendorKey: key,
      vendorName: parts.length > 1 ? `${name} (part ${i + 1} of ${parts.length})` : name,
      lotIds: p,
    }));
    return { key, units };
  });
  vendors.sort((a, b) => a.key.localeCompare(b.key));

  // Pack the units into sections, in order.
  const sections: FullCountSection[] = [];
  let open: FullCountSection | null = null;
  for (const v of vendors) {
    for (const u of v.units) {
      if (open && open.lotIds.length + u.lotIds.length > size) {
        sections.push(open);
        open = null;
      }
      if (!open) open = { no: sections.length + 1, lotIds: [], vendors: [] };
      open.lotIds.push(...u.lotIds);
      open.vendors.push(u.vendorName);
    }
  }
  if (open) sections.push(open);

  return { sections, lotCount: lots.length, vendorCount: byVendor.size };
}

/** "Year-end full count 2026 - section 3 of 12" */
export function fullCountLabel(year: number, no: number, count: number): string {
  return `Year-end full count ${year} \u2014 section ${no} of ${count}`;
}

/** The scope rationale every section carries (written before any number is known). */
export function fullCountRationale(year: number, section: FullCountSection, plan: FullCountPlan): string {
  const v = section.vendors;
  const vendors = v.length <= 4 ? v.join(", ") : `${v.slice(0, 3).join(", ")} and ${v.length - 3} more`;
  return (
    `Year-end full count for ${year} (D58: "we do a full inventory audit once per year at the end of the year"). ` +
    `Every active lot, ${plan.lotCount} lots from ${plan.vendorCount} vendor${plan.vendorCount === 1 ? "" : "s"}, ` +
    `split into ${plan.sections.length} section${plan.sections.length === 1 ? "" : "s"}; one employee counts each section. ` +
    `This is section ${section.no}: ${section.lotIds.length} lot${section.lotIds.length === 1 ? "" : "s"} (${vendors}).`
  );
}

// ── Roll-up ─────────────────────────────────────────────────────────────────

export type SectionStatus = "draft" | "scope_approved" | "counting" | "review" | "approved" | "cancelled";

export type SectionSummary = {
  id: string;
  sectionNo: number;
  sectionCount: number;
  status: SectionStatus | string;
  postedAt: string | null;
  plannedLotCount: number;
  countedLotCount: number;
  claimedByName: string | null;
  submittedAt: string | null;
  netVarianceCents: number;
  grossVarianceCents: number;
};

export type FullCountStage =
  | "draft" // nothing released yet
  | "counting" // released, at least one section not yet I'm done
  | "review" // every live section is in review or later, at least one in review
  | "approved" // every live section approved, at least one not posted
  | "posted" // every live section posted
  | "cancelled"; // every section cancelled

export type FullCountRollup = {
  stage: FullCountStage;
  live: number;
  cancelled: number;
  byStatus: Record<string, number>;
  plannedLots: number;
  countedLots: number;
  /** Sections waiting for the owner to press Release. */
  toRelease: number;
  /** Sections nobody has started. */
  unclaimed: number;
  /** Sections in review. */
  inReview: number;
  /** Sections approved but not posted. */
  toPost: number;
  posted: number;
  /** One sentence: what the owner does next. */
  next: string;
};

export function rollupFullCount(sections: readonly SectionSummary[]): FullCountRollup {
  const live = sections.filter((s) => s.status !== "cancelled");
  const byStatus: Record<string, number> = {};
  for (const s of sections) {
    const k = s.status === "approved" && s.postedAt ? "posted" : String(s.status);
    byStatus[k] = (byStatus[k] ?? 0) + 1;
  }
  const toRelease = live.filter((s) => s.status === "draft").length;
  const unclaimed = live.filter((s) => s.status === "scope_approved").length;
  const counting = live.filter((s) => s.status === "counting").length;
  const inReview = live.filter((s) => s.status === "review").length;
  const toPost = live.filter((s) => s.status === "approved" && !s.postedAt).length;
  const posted = live.filter((s) => s.status === "approved" && !!s.postedAt).length;

  let stage: FullCountStage;
  if (live.length === 0) stage = "cancelled";
  else if (toRelease === live.length) stage = "draft";
  else if (toRelease + unclaimed + counting > 0) stage = "counting";
  else if (inReview > 0) stage = "review";
  else if (toPost > 0) stage = "approved";
  else stage = "posted";

  const n = (k: number, word: string) => `${k} section${k === 1 ? "" : "s"} ${word}`;
  let next: string;
  switch (stage) {
    case "cancelled":
      next = "This full count was cancelled. Plan a new one if the year-end count is still to do.";
      break;
    case "draft":
      next = "Check the sections, then press Release all sections. Each employee then starts one section on Cycle Counts.";
      break;
    case "counting": {
      const parts = [
        toRelease ? n(toRelease, "not released") : "",
        unclaimed ? n(unclaimed, "not started") : "",
        counting ? n(counting, "being counted") : "",
        inReview ? n(inReview, "waiting for your review") : "",
      ].filter(Boolean);
      next = `Counting: ${parts.join(", ")}. Each counter presses I'm done when their section is finished.`;
      break;
    }
    case "review":
      next = `${n(inReview, "waiting for your review")}. Open each one, recount or add reasons where asked, then Approve every ready section.`;
      break;
    case "approved":
      next = `${n(toPost, "approved and not posted")}. Press Post every approved section to correct the shelf and draft the journal entries, then print the work paper.`;
      break;
    default:
      next = "Every section is posted. Print the combined work paper for the accountant and file it with form 8.8.";
  }

  return {
    stage,
    live: live.length,
    cancelled: sections.length - live.length,
    byStatus,
    plannedLots: live.reduce((a, s) => a + s.plannedLotCount, 0),
    countedLots: live.reduce((a, s) => a + s.countedLotCount, 0),
    toRelease,
    unclaimed,
    inReview,
    toPost,
    posted,
    next,
  };
}

export const FULL_COUNT_STAGE_LABEL: Record<FullCountStage, string> = {
  draft: "planned, not released",
  counting: "counting",
  review: "waiting for review",
  approved: "approved, not posted",
  posted: "posted",
  cancelled: "cancelled",
};

/** Combined money. Null when any section's figure is not calculable (a missing cost is not zero). */
export function combineMoney(values: ReadonlyArray<number | null>): number | null {
  let sum = 0;
  for (const v of values) {
    if (v === null) return null;
    sum += v;
  }
  return sum;
}

/** Cancelling a full count: only sections that are not approved can be cancelled (0326). */
export function cancellableSections<T extends Pick<SectionSummary, "status">>(sections: readonly T[]): T[] {
  return sections.filter((s) => ["draft", "scope_approved", "counting", "review"].includes(String(s.status)));
}

/** The cockpit reminder in December when no full count exists for this year. */
export function fullCountReminder(input: { todayPacific: string; hasCountForYear: boolean }): string | null {
  const month = Number(input.todayPacific.slice(5, 7));
  if (month !== 12 || input.hasCountForYear) return null;
  const year = Number(input.todayPacific.slice(0, 4));
  return `Year-end full count for ${year} is not planned yet. Plan it at Inventory Audits \u2192 Year-end full count.`;
}

// ═══════════════════════════════════════════════════════════════════════════
// SELF-TEST
// ═══════════════════════════════════════════════════════════════════════════

export function __runFullCountCoreTests(): number {
  let n = 0;
  const ok = (c: boolean, m: string) => {
    if (!c) throw new Error(`full-count-core: ${m}`);
    n++;
  };
  const lot = (id: string, o: Partial<AuditLot> = {}): AuditLot => ({
    lotId: id,
    lotCode: `L-${id}`,
    posProductKey: `p-${id}`,
    productName: `Product ${id}`,
    categorySlug: "flower",
    vendorId: "v1",
    vendorName: "Alpha Farms",
    onHandQty: 10,
    unitCostMinorUnits: 500,
    lastCountedAt: null,
    priorVarianceCount: 0,
    status: "active",
    ...o,
  });

  // section size
  ok(checkSectionLots("60").ok, "60 is a valid section size");
  ok(!checkSectionLots(9).ok && !checkSectionLots(301).ok && !checkSectionLots("2.5").ok, "out of range / fraction refused");

  // year
  ok(fullCountYear("2026-12-30") === 2026, "December counts for this year");
  ok(fullCountYear("2027-01-02") === 2026, "early January closes last year");
  ok(checkFullCountYear("2026", "2026-12-01").ok && !checkFullCountYear("2027", "2026-12-01").ok, "future year refused");

  // no cap: 1,000 lots across 3 vendors all planned
  const many: AuditLot[] = [];
  for (let i = 0; i < 1000; i++) {
    const v = i % 3;
    many.push(lot(`x${String(i).padStart(4, "0")}`, { vendorId: `v${v}`, vendorName: ["Alpha", "Bravo", "Charlie"][v] }));
  }
  const big = planFullCount(many, 60);
  const planned = big.sections.flatMap((s) => s.lotIds);
  ok(planned.length === 1000 && new Set(planned).size === 1000, "every lot planned exactly once (no 400 cap)");
  ok(big.sections.every((s) => s.lotIds.length <= 60), "no section bigger than the size");
  ok(big.sections.every((s, i) => s.no === i + 1), "sections numbered 1..n");
  ok(big.vendorCount === 3 && big.lotCount === 1000, "vendor and lot totals");
  ok(big.sections[0].vendors[0].startsWith("Alpha (part 1 of"), "a big vendor is split into named parts");

  // a product's lots are never split
  const prod = [
    ...[1, 2, 3].map((i) => lot(`a${i}`, { posProductKey: "same", productName: "Same" })),
    ...Array.from({ length: 9 }, (_, i) => lot(`b${i}`)),
  ];
  const pp = planFullCount(prod, 10);
  const holder = pp.sections.filter((s) => s.lotIds.some((id) => id.startsWith("a")));
  ok(holder.length === 1 && holder[0].lotIds.filter((id) => id.startsWith("a")).length === 3, "one product stays in one section");

  // small vendors share a section
  const small = [
    lot("s1", { vendorId: "va", vendorName: "Apex" }),
    lot("s2", { vendorId: "vb", vendorName: "Birch" }),
    lot("s3", { vendorId: null, vendorName: null }),
  ];
  const sp = planFullCount(small, 10);
  ok(sp.sections.length === 1 && sp.sections[0].vendors.join("|") === "Apex|Birch|Vendor not recorded", "small vendors share; no-vendor last");
  ok(planFullCount([], 60).sections.length === 0, "nothing to count, no sections");

  // labels
  ok(fullCountLabel(2026, 3, 12) === "Year-end full count 2026 \u2014 section 3 of 12", "label");
  ok(fullCountRationale(2026, sp.sections[0], sp).includes("section 1: 3 lots"), "rationale names the section");
  ok(fullCountRationale(2026, sp.sections[0], sp).includes("once per year at the end of the year"), "rationale quotes the owner");

  // roll-up
  const sec = (no: number, status: string, o: Partial<SectionSummary> = {}): SectionSummary => ({
    id: `s${no}`,
    sectionNo: no,
    sectionCount: 3,
    status,
    postedAt: null,
    plannedLotCount: 10,
    countedLotCount: 0,
    claimedByName: null,
    submittedAt: null,
    netVarianceCents: 0,
    grossVarianceCents: 0,
    ...o,
  });
  ok(rollupFullCount([sec(1, "draft"), sec(2, "draft")]).stage === "draft", "all draft = draft");
  const c = rollupFullCount([sec(1, "scope_approved"), sec(2, "counting"), sec(3, "review")]);
  ok(c.stage === "counting" && c.unclaimed === 1 && c.inReview === 1, "mixed = counting");
  ok(c.next.includes("1 section not started"), "next names what is left");
  ok(rollupFullCount([sec(1, "review"), sec(2, "approved")]).stage === "review", "review");
  ok(rollupFullCount([sec(1, "approved"), sec(2, "approved", { postedAt: "x" })]).stage === "approved", "approved, one to post");
  const p = rollupFullCount([sec(1, "approved", { postedAt: "x" }), sec(2, "cancelled")]);
  ok(p.stage === "posted" && p.live === 1 && p.cancelled === 1, "posted ignores cancelled sections");
  ok(rollupFullCount([sec(1, "cancelled")]).stage === "cancelled", "all cancelled");
  ok(rollupFullCount([sec(1, "counting", { countedLotCount: 4 }), sec(2, "cancelled", { plannedLotCount: 99 })]).plannedLots === 10, "cancelled lots not in progress");

  // money
  ok(combineMoney([100, -50, 25]) === 75, "money sums");
  ok(combineMoney([100, null]) === null, "one unknown cost = not calculable");

  // cancel
  ok(cancellableSections([sec(1, "approved"), sec(2, "review"), sec(3, "cancelled")]).length === 1, "only open sections cancel");

  // reminder
  ok(fullCountReminder({ todayPacific: "2026-12-05", hasCountForYear: false })!.includes("2026"), "December reminder");
  ok(fullCountReminder({ todayPacific: "2026-12-05", hasCountForYear: true }) === null, "no reminder once planned");
  ok(fullCountReminder({ todayPacific: "2026-11-05", hasCountForYear: false }) === null, "no reminder outside December");

  return n;
}
