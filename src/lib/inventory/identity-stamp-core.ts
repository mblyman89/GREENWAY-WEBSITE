/**
 * src/lib/inventory/identity-stamp-core.ts  (S05 - Phase 1, Ring 1)
 *
 * PURE half of "stamp identity at the door". No Supabase, no fs, no network.
 *
 * S03 defined WHAT a product identity is (product-identity-core.ts); S04 gave
 * it somewhere to live (migration 0234). S05 writes it as product arrives:
 *
 *   staging   -> inventory_lots.identity_key (best effort, at insert)
 *   seeding   -> catalog_product_drafts.identity_key + lot facts + restock hint
 *   finalize  -> AFTER the drafts seed and the KB write-back have both
 *                settled, link lots + drafts to kb_products.id by the KB
 *                natural key, and put a one-line summary on the timeline.
 *
 * This module holds every decision in that flow that can be tested without a
 * database:
 *   1. identityStampEnabled - the INTAKE_IDENTITY_STAMP rollback switch;
 *   2. buildLiveIdentityIndex - live menu cards grouped by identity (for the
 *      restock hint; hidden cards and refused identities never enter it);
 *   3. planKbLinks - which lot gets which kb_products.id, grouped so the
 *      writes are one statement per distinct value, never one per lot;
 *   4. the timeline copy (kb_link / kb_writeback_error), in one place.
 *
 * NEVER GUESS: an identity of "" (not enough identity) never matches; a KB
 * natural key matches only on all three parts; a link is never REMOVED (a
 * lot that finds no KB row keeps whatever link it already had).
 */
import {
  identityForMenuItem,
  kbNaturalKeyString,
  type KbNaturalKey,
} from "@/lib/catalog/product-identity-core";

// ---------------------------------------------------------------------------
// 1. Rollback switch
// ---------------------------------------------------------------------------

/** Environment variable named by the S05 rollback plan. */
export const IDENTITY_STAMP_ENV = "INTAKE_IDENTITY_STAMP";

/**
 * ON by default. Only an explicit off-word turns it off, so a typo can never
 * silently disable the feature AND an unset variable means "ship it".
 * Off-words (case/space-insensitive): off, 0, false, no, disabled.
 */
export function identityStampEnabled(raw: string | null | undefined): boolean {
  const v = String(raw ?? "").trim().toLowerCase();
  return !(v === "off" || v === "0" || v === "false" || v === "no" || v === "disabled");
}

// ---------------------------------------------------------------------------
// 2. Live identity index (restock hint input)
// ---------------------------------------------------------------------------

/** The 0002 menu_items columns the index needs (no 0234 column is read). */
export type LiveMenuRow = {
  source_item_id: string;
  name: string;
  product_name: string | null;
  brand_name: string | null;
  vendor_name: string | null;
  category: string;
  hidden: boolean | null;
};

/** The exact column list the server read uses - pinned by tests. */
export const LIVE_MENU_IDENTITY_COLUMNS =
  "source_item_id, name, product_name, brand_name, vendor_name, category, hidden";

/**
 * identity -> distinct live card keys (first-seen order). Hidden cards are
 * never restock targets (the same rule intake mastering uses for merges), and
 * a card whose identity refuses ("") is not indexed at all.
 */
export function buildLiveIdentityIndex(rows: LiveMenuRow[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const r of rows) {
    if (r.hidden) continue;
    const key = String(r.source_item_id ?? "").trim();
    if (!key) continue;
    const { identityKey } = identityForMenuItem(r);
    if (!identityKey) continue;
    const list = out.get(identityKey) ?? [];
    if (!list.includes(key)) list.push(key);
    out.set(identityKey, list);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 3. KB link planning
// ---------------------------------------------------------------------------

/** One lot's identity as computed at finalize (storage form: null, never ""). */
export type LotIdentityStamp = {
  lotId: string;
  identityKey: string | null;
  kb: KbNaturalKey | null;
  /** isPromotableLot(status, disposition) - refused lots are never linked. */
  promotable: boolean;
};

export type KbRow = {
  id: string;
  brand_slug: string;
  product_slug: string;
  variant_label: string;
};

/** One UPDATE statement: every lot in lotIds gets exactly this patch. */
export type LinkWriteGroup = {
  identityKey: string | null;
  kbProductId: string | null;
  lotIds: string[];
};

export type KbLinkPlan = {
  groups: LinkWriteGroup[];
  /** Distinct KB natural keys among promotable lots (the "products"). */
  products: number;
  /** ...of which a kb_products row exists. */
  linkedProducts: number;
  /** Promotable lots with no product name -> no KB identity at all. */
  noNameLots: number;
  /** Lots that received a kb_product_id. */
  linkedLots: number;
};

/**
 * Decide the writes. Only promotable lots are touched. A lot with neither an
 * identity key nor a KB match produces no write (nothing to say). Groups are
 * keyed by the exact (identity, kb id) pair so each is ONE `.in("id", ...)`
 * statement - the finalize path must not pay a round trip per lot.
 */
export function planKbLinks(input: { lots: LotIdentityStamp[]; kbRows: KbRow[] }): KbLinkPlan {
  const kbByKey = new Map<string, string>();
  for (const r of input.kbRows) {
    const k = kbNaturalKeyString({
      brand_slug: r.brand_slug,
      product_slug: r.product_slug,
      variant_label: r.variant_label ?? "",
    });
    if (!kbByKey.has(k)) kbByKey.set(k, r.id);
  }
  const groups = new Map<string, LinkWriteGroup>();
  const productKeys = new Set<string>();
  const linkedKeys = new Set<string>();
  let noNameLots = 0;
  let linkedLots = 0;

  for (const lot of input.lots) {
    if (!lot.promotable) continue;
    let kbId: string | null = null;
    if (lot.kb) {
      const k = kbNaturalKeyString(lot.kb);
      productKeys.add(k);
      kbId = kbByKey.get(k) ?? null;
      if (kbId) {
        linkedKeys.add(k);
        linkedLots += 1;
      }
    } else {
      noNameLots += 1;
    }
    const identityKey = lot.identityKey && lot.identityKey.trim() ? lot.identityKey : null;
    if (!identityKey && !kbId) continue;
    const gk = `${identityKey ?? ""}\u001f${kbId ?? ""}`;
    const g = groups.get(gk) ?? { identityKey, kbProductId: kbId, lotIds: [] };
    g.lotIds.push(lot.lotId);
    groups.set(gk, g);
  }
  return {
    groups: Array.from(groups.values()),
    products: productKeys.size,
    linkedProducts: linkedKeys.size,
    noNameLots,
    linkedLots,
  };
}

/**
 * The lot patch for a group. Never writes NULL over an existing value: a
 * missing identity or KB match is simply left out of the patch.
 */
export function lotLinkPatch(g: LinkWriteGroup, actorId: string | null): Record<string, unknown> {
  const patch: Record<string, unknown> = { updated_by: actorId };
  if (g.identityKey) patch.identity_key = g.identityKey;
  if (g.kbProductId) patch.kb_product_id = g.kbProductId;
  return patch;
}

// ---------------------------------------------------------------------------
// 4. Timeline copy
// ---------------------------------------------------------------------------

export const KB_LINK_EVENT = "kb_link";
export const KB_WRITEBACK_ERROR_EVENT = "kb_writeback_error";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * "Knowledge base link: 12 of 14 products linked to a known product record;
 * 2 have no knowledge base record yet ..."
 *
 * Honest deviation from the roadmap copy ("will be created on approval"):
 * approving a draft does NOT write kb_products in this codebase (only the
 * manifest bridge and the purchasing importers call writeBackProductFacts),
 * so promising creation on approval would be false. The real remedy is the
 * "Promote to KB drafts" button on the same page.
 */
export function kbLinkEventNote(s: {
  products: number;
  linkedProducts: number;
  noNameLots: number;
  restockHints?: number;
  failedWrites?: number;
}): string {
  const parts: string[] = [];
  const missing = Math.max(0, s.products - s.linkedProducts);
  parts.push(
    `Knowledge base link: ${s.linkedProducts} of ${plural(s.products, "product", "products")} linked to a known product record`,
  );
  if (missing > 0) {
    parts.push(
      `${missing} ${missing === 1 ? "has" : "have"} no knowledge base record yet - press "Promote to KB drafts" on this page to retry`,
    );
  }
  if (s.noNameLots > 0) {
    parts.push(`${plural(s.noNameLots, "line has", "lines have")} no product name and cannot be linked`);
  }
  if ((s.restockHints ?? 0) > 0) {
    parts.push(
      `${plural(s.restockHints ?? 0, "new onboarding draft looks", "new onboarding drafts look")} like a restock of a product already on the live menu (flagged for review, not merged)`,
    );
  }
  if ((s.failedWrites ?? 0) > 0) {
    parts.push(`${plural(s.failedWrites ?? 0, "link write", "link writes")} FAILED (see server log)`);
  }
  return parts.join("; ") + ".";
}

/** Timeline copy when 0234 is not applied yet (owner applies migrations). */
export function kbLinkSkippedPreMigrationNote(migration: string): string {
  return `Knowledge base link skipped: database update ${migration} has not been applied yet, so products cannot be linked to their knowledge base records. Nothing else was affected.`;
}

/**
 * F-077: the KB write-back failing used to be console-only. The reason may
 * be an Error, a string, or anything thrown - render it without guessing.
 */
export function kbWritebackErrorNote(reason: unknown): string {
  let msg: string;
  if (reason === null || reason === undefined) msg = "";
  else if (reason instanceof Error) msg = reason.message;
  else if (typeof reason === "string") msg = reason;
  else {
    try {
      msg = JSON.stringify(reason) ?? String(reason);
    } catch {
      msg = String(reason);
    }
  }
  msg = (msg || "unknown error").slice(0, 500);
  return `Knowledge base write-back FAILED: ${msg}. Product facts from this transfer did not reach the knowledge base - press "Promote to KB drafts" on this page to retry.`;
}

// ---------------------------------------------------------------------------
// Embedded self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runIdentityStampCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL identity-stamp-core: " + msg);
    }
  };

  // 1. flag
  ok(identityStampEnabled(undefined), "unset -> on");
  ok(identityStampEnabled(""), "empty -> on");
  ok(identityStampEnabled("on"), "on -> on");
  ok(!identityStampEnabled("ofF "), "'ofF ' is off (trim + case-insensitive)");
  ok(!identityStampEnabled("off"), "off -> off");
  ok(!identityStampEnabled(" OFF "), "OFF -> off");
  ok(!identityStampEnabled("0"), "0 -> off");
  ok(!identityStampEnabled("false"), "false -> off");
  ok(!identityStampEnabled("no"), "no -> off");
  ok(!identityStampEnabled("disabled"), "disabled -> off");
  ok(identityStampEnabled("of"), "'of' is not an off-word -> on (never silently off)");
  ok(IDENTITY_STAMP_ENV === "INTAKE_IDENTITY_STAMP", "env name matches the rollback plan");

  // 2. live index
  const card = (key: string, over: Partial<LiveMenuRow> = {}): LiveMenuRow => ({
    source_item_id: key,
    name: "Blue Dream 3.5g",
    product_name: "Blue Dream",
    brand_name: "Acme",
    vendor_name: "Acme Farms",
    category: "flower",
    hidden: false,
    ...over,
  });
  const idx = buildLiveIdentityIndex([
    card("C1"),
    card("C1"),
    card("C2", { hidden: true }),
    card("C3", { vendor_name: null, brand_name: null }),
    card("C4", { product_name: "Gelato", name: "Gelato" }),
  ]);
  const bd = identityForMenuItem(card("x")).identityKey;
  ok(bd !== "", "fixture identity is non-empty");
  ok(JSON.stringify(idx.get(bd)) === JSON.stringify(["C1"]), "duplicate card key listed once; hidden card excluded");
  ok(!Array.from(idx.values()).some((l) => l.includes("C3")), "refused identity never indexed");
  ok(Array.from(idx.values()).some((l) => l.includes("C4")), "a different product gets its own entry");
  ok(buildLiveIdentityIndex([card("  ")]).size === 0, "blank card key skipped");
  const two = buildLiveIdentityIndex([card("A"), card("B")]);
  ok(JSON.stringify(two.get(bd)) === JSON.stringify(["A", "B"]), "two live cards, same identity -> both kept (ambiguity is visible)");

  // 3. planKbLinks
  const kbA: KbNaturalKey = { brand_slug: "acme", product_slug: "blue-dream", variant_label: "3.5 g" };
  const kbB: KbNaturalKey = { brand_slug: "acme", product_slug: "gelato", variant_label: "1 g" };
  const plan = planKbLinks({
    lots: [
      { lotId: "l1", identityKey: "acme|flower|blue dream", kb: kbA, promotable: true },
      { lotId: "l2", identityKey: "acme|flower|blue dream", kb: kbA, promotable: true },
      { lotId: "l3", identityKey: "acme|flower|gelato", kb: kbB, promotable: true },
      { lotId: "l4", identityKey: null, kb: null, promotable: true },
      { lotId: "l5", identityKey: "x|y|z", kb: kbA, promotable: false },
      { lotId: "l6", identityKey: "", kb: null, promotable: true },
    ],
    kbRows: [
      { id: "K-A", ...kbA },
      { id: "K-A-dup", ...kbA },
      { id: "K-other", brand_slug: "acme", product_slug: "blue-dream", variant_label: "1 g" },
    ],
  });
  ok(plan.products === 2, "2 distinct KB products among promotable lots");
  ok(plan.linkedProducts === 1, "only blue-dream 3.5 g has a KB row");
  ok(plan.linkedLots === 2, "both blue-dream lots linked");
  ok(plan.noNameLots === 2, "two nameless lots counted (null and '' identity)");
  const gA = plan.groups.find((g) => g.kbProductId === "K-A");
  ok(!!gA && gA.lotIds.join(",") === "l1,l2", "same (identity,kb) pair -> ONE write group; first KB row wins");
  const gB = plan.groups.find((g) => g.identityKey === "acme|flower|gelato");
  ok(!!gB && gB.kbProductId === null, "variant must match exactly: gelato 1 g has no KB row");
  ok(!plan.groups.some((g) => g.lotIds.includes("l5")), "refused (non-promotable) lot never written");
  ok(!plan.groups.some((g) => g.lotIds.includes("l4") || g.lotIds.includes("l6")), "nothing-to-write lots produce no group");
  ok(plan.groups.length === 2, "exactly two statements for six lots");
  const empty = planKbLinks({ lots: [], kbRows: [] });
  ok(empty.groups.length === 0 && empty.products === 0, "empty in -> empty plan");

  // lotLinkPatch never writes null over a value
  const p1 = lotLinkPatch({ identityKey: "i", kbProductId: null, lotIds: [] }, "u1");
  ok(p1.identity_key === "i" && !("kb_product_id" in p1) && p1.updated_by === "u1", "no KB match -> kb_product_id omitted");
  const p2 = lotLinkPatch({ identityKey: null, kbProductId: "K", lotIds: [] }, null);
  ok(!("identity_key" in p2) && p2.kb_product_id === "K", "no identity -> identity_key omitted");

  // 4. copy
  const n1 = kbLinkEventNote({ products: 14, linkedProducts: 12, noNameLots: 0 });
  ok(n1.startsWith("Knowledge base link: 12 of 14 products linked to a known product record"), "roadmap headline shape");
  ok(n1.includes("2 have no knowledge base record yet") && n1.includes("Promote to KB drafts"), "missing count + real remedy");
  ok(!/approval/i.test(n1), "never promises creation on approval (not true in this codebase)");
  const n2 = kbLinkEventNote({ products: 1, linkedProducts: 1, noNameLots: 1, restockHints: 1, failedWrites: 1 });
  ok(n2.includes("1 of 1 product linked") && !n2.includes("no knowledge base record"), "singular + no missing clause");
  ok(n2.includes("1 line has no product name"), "nameless singular");
  ok(n2.includes("1 new onboarding draft looks like a restock"), "restock singular");
  ok(n2.includes("1 link write FAILED"), "failure singular");
  ok(n2.endsWith("."), "ends with a period");
  const n3 = kbLinkEventNote({ products: 3, linkedProducts: 0, noNameLots: 2, restockHints: 2, failedWrites: 2 });
  ok(n3.includes("3 have no") && n3.includes("2 lines have") && n3.includes("2 new onboarding drafts look") && n3.includes("2 link writes"), "plurals");
  ok(kbLinkSkippedPreMigrationNote("0234_product_identity.sql").includes("0234_product_identity.sql"), "pre-migration note names the file");
  ok(kbWritebackErrorNote(new Error("boom")).includes("FAILED: boom."), "Error reason");
  ok(kbWritebackErrorNote("net down").includes("FAILED: net down."), "string reason");
  ok(kbWritebackErrorNote({ code: "X" }).includes('{"code":"X"}'), "object reason serialised");
  ok(kbWritebackErrorNote(undefined).includes("FAILED: unknown error."), "undefined reason -> 'unknown error'");
  ok(kbWritebackErrorNote(null).includes("FAILED: unknown error."), "null reason -> 'unknown error'");
  ok(kbWritebackErrorNote("x".repeat(900)).length < 700, "reason capped");
  ok(KB_LINK_EVENT === "kb_link" && KB_WRITEBACK_ERROR_EVENT === "kb_writeback_error", "event names");
  ok(LIVE_MENU_IDENTITY_COLUMNS.split(", ").length === 7 && !LIVE_MENU_IDENTITY_COLUMNS.includes("identity"), "live read names 0002 columns only");

  console.log(`identity-stamp-core: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
