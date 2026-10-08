/**
 * src/lib/inventory/line-identity-chip-core.ts
 *
 * R31: the per-line "what is this product to us?" chip on the manifest review
 * page. It replaces the old strain-name KB matcher ("KB match: X",
 * "KB: X? · confirm", "No KB match"), which:
 *   - guessed from the strain NAME with a fuzzy score, so it was often wrong;
 *   - offered nothing to do about it (no link, no action);
 *   - ignored product identity, which the rest of the pipeline is keyed on
 *     since S03-S05 (product-identity-core, identity-stamp-core).
 *
 * Enterprise entity resolution matches on trusted identifiers first and only
 * then on a deterministic natural key; fuzzy matching is kept out of anything
 * that acts automatically because of false positives (Zingg, "Deterministic
 * vs probabilistic matching"). This chip uses ONLY deterministic keys, in the
 * SAME order onboarding uses them (draft-seed-core.planDraftSeeding):
 *   1. the lot's own POS key is a card on the published menu -> restock;
 *   2. the product identity matches exactly ONE live card -> restock of that
 *      card (2+ cards = ambiguous, never a coin flip);
 *   3. the KB natural key (brand, product, size) has a kb_products row ->
 *      known product, with a link to its record;
 *   4. otherwise -> new; onboarding creates it on finalize.
 * Every chip links somewhere useful, so it is something the owner can act on.
 *
 * Pure: no I/O. The server half is line-identity-server.ts.
 */
import { kbNaturalKeyString, type KbNaturalKey } from "@/lib/catalog/product-identity-core";

export type LineIdentityInput = {
  lotId: string;
  posProductKey: string | null;
  /** productIdentityKey output ("" = not enough identity). */
  identityKey: string;
  kb: KbNaturalKey | null;
};

export type KbRowLite = { id: string; brand_slug: string; product_slug: string; variant_label: string | null };

export type LineChipKind = "on_menu" | "restock_card" | "ambiguous" | "kb_known" | "new" | "no_name";

export type LineChip = {
  kind: LineChipKind;
  /** Short text on the chip. */
  label: string;
  /** Tooltip: what this means and what happens on finalize. */
  title: string;
  /** Where the chip goes (null = no destination). */
  href: string | null;
  tone: "accent" | "gold" | "muted";
  /** Secondary: the KB record when known and not already the primary chip. */
  kbHref: string | null;
};

export type LineIdentityFacts = {
  lots: LineIdentityInput[];
  /** POS keys that are cards on the published menu. */
  publishedKeys: ReadonlySet<string>;
  /** identity -> live card keys (buildLiveIdentityIndex); undefined = unknown. */
  liveIndex: Map<string, string[]> | undefined;
  /** kb_products rows read by product_slug; undefined = unknown. */
  kbRows: KbRowLite[] | undefined;
  /** Is there a published menu at all? */
  hasPublishedMenu: boolean;
};

const enc = encodeURIComponent;
export const productCardHref = (key: string) => `/admin/products/${enc(key)}`;
export const kbProductHref = (id: string) => `/admin/knowledge-base/products/${enc(id)}`;

export function planLineChips(f: LineIdentityFacts): Map<string, LineChip> {
  const kbByKey = new Map<string, string>();
  for (const r of f.kbRows ?? []) {
    const k = kbNaturalKeyString({
      brand_slug: r.brand_slug,
      product_slug: r.product_slug,
      variant_label: r.variant_label ?? "",
    });
    if (!kbByKey.has(k)) kbByKey.set(k, r.id);
  }
  const out = new Map<string, LineChip>();
  for (const lot of f.lots) {
    const kbId = lot.kb ? kbByKey.get(kbNaturalKeyString(lot.kb)) ?? null : null;
    const kbHref = kbId ? kbProductHref(kbId) : null;
    const key = (lot.posProductKey ?? "").trim();

    if (key && f.publishedKeys.has(key)) {
      out.set(lot.lotId, {
        kind: "on_menu",
        label: "On the menu · restock",
        title:
          "This exact product is already a card on the live menu. Finalize adds this stock to it; no onboarding needed.",
        href: productCardHref(key),
        tone: "accent",
        kbHref,
      });
      continue;
    }
    const id = lot.identityKey.trim();
    const cards = id && f.liveIndex ? (f.liveIndex.get(id) ?? []).filter((c) => c && c !== key) : [];
    if (cards.length === 1) {
      out.set(lot.lotId, {
        kind: "restock_card",
        label: "Restock of a live card",
        title:
          "Same vendor/brand, product name and category as one card already on the live menu (only the lot changed). Onboarding offers to merge it into that card.",
        href: productCardHref(cards[0]),
        tone: "accent",
        kbHref,
      });
      continue;
    }
    if (cards.length > 1) {
      out.set(lot.lotId, {
        kind: "ambiguous",
        label: `Matches ${cards.length} live cards`,
        title:
          "This product's identity matches more than one live card, so nothing is picked automatically. Onboarding asks you which one it is.",
        href: null,
        tone: "gold",
        kbHref,
      });
      continue;
    }
    if (kbId) {
      out.set(lot.lotId, {
        kind: "kb_known",
        label: "Known product (KB)",
        title:
          "Not on the menu yet, but the Knowledge Base already has this brand + product + size. Onboarding pre-fills its facts from that record.",
        href: kbHref,
        tone: "accent",
        kbHref: null,
      });
      continue;
    }
    if (!lot.kb) {
      out.set(lot.lotId, {
        kind: "no_name",
        label: "No product name",
        title: "The manifest line has no product name, so it cannot be matched. Onboarding will ask for one.",
        href: null,
        tone: "gold",
        kbHref: null,
      });
      continue;
    }
    out.set(lot.lotId, {
      kind: "new",
      label: f.hasPublishedMenu ? "New product" : "New (no live menu yet)",
      title:
        "Not on the live menu and not in the Knowledge Base yet. Finalize creates its onboarding draft; you approve it from Product Onboarding.",
      href: null,
      tone: "muted",
      kbHref: null,
    });
  }
  return out;
}

/** Counts for the one-line summary above the table. */
export function summarizeLineChips(chips: Map<string, LineChip>): {
  restock: number;
  known: number;
  fresh: number;
  attention: number;
  text: string;
} {
  let restock = 0;
  let known = 0;
  let fresh = 0;
  let attention = 0;
  for (const c of chips.values()) {
    if (c.kind === "on_menu" || c.kind === "restock_card") restock += 1;
    else if (c.kind === "kb_known") known += 1;
    else if (c.kind === "new") fresh += 1;
    else attention += 1;
  }
  const parts: string[] = [];
  if (restock) parts.push(`${restock} restock${restock === 1 ? "" : "s"}`);
  if (known) parts.push(`${known} known to the KB`);
  if (fresh) parts.push(`${fresh} new`);
  if (attention) parts.push(`${attention} need${attention === 1 ? "s" : ""} a choice in onboarding`);
  return { restock, known, fresh, attention, text: parts.join(" · ") };
}

// ---------------------------------------------------------------------------
// Self-tests (house pattern)
// ---------------------------------------------------------------------------

export function __runLineIdentityChipCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: unknown, what: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`line-identity-chip-core self-test FAILED: ${what}`);
    }
  };
  const kb = (p: string, v = "3.5g"): KbNaturalKey => ({ brand_slug: "acme", product_slug: p, variant_label: v });
  const lots: LineIdentityInput[] = [
    { lotId: "L1", posProductKey: "K1", identityKey: "acme|blue|flower", kb: kb("blue") },
    { lotId: "L2", posProductKey: "K2", identityKey: "acme|gold|flower", kb: kb("gold") },
    { lotId: "L3", posProductKey: "K3", identityKey: "acme|two|flower", kb: kb("two") },
    { lotId: "L4", posProductKey: "K4", identityKey: "acme|known|flower", kb: kb("known") },
    { lotId: "L5", posProductKey: null, identityKey: "acme|fresh|flower", kb: kb("fresh") },
    { lotId: "L6", posProductKey: "K6", identityKey: "", kb: null },
  ];
  const facts: LineIdentityFacts = {
    lots,
    publishedKeys: new Set(["K1"]),
    liveIndex: new Map([
      ["acme|blue|flower", ["K1"]],
      ["acme|gold|flower", ["CARD-G"]],
      ["acme|two|flower", ["C1", "C2"]],
    ]),
    kbRows: [
      { id: "kb-known", brand_slug: "acme", product_slug: "known", variant_label: "3.5g" },
      { id: "kb-blue", brand_slug: "acme", product_slug: "blue", variant_label: "3.5g" },
      { id: "kb-wrongsize", brand_slug: "acme", product_slug: "fresh", variant_label: "1g" },
    ],
    hasPublishedMenu: true,
  };
  const m = planLineChips(facts);
  ok(m.get("L1")?.kind === "on_menu" && m.get("L1")?.href === "/admin/products/K1", "own key live -> on_menu");
  ok(m.get("L1")?.kbHref === "/admin/knowledge-base/products/kb-blue", "on_menu keeps a secondary KB link");
  ok(m.get("L2")?.kind === "restock_card" && m.get("L2")?.href === "/admin/products/CARD-G", "single identity card -> restock_card");
  ok(m.get("L3")?.kind === "ambiguous" && m.get("L3")?.href === null, "2+ cards -> ambiguous, no guess");
  ok(m.get("L3")?.label === "Matches 2 live cards", "ambiguous label counts cards");
  ok(m.get("L4")?.kind === "kb_known" && m.get("L4")?.href === "/admin/knowledge-base/products/kb-known", "kb natural key -> kb_known");
  ok(m.get("L5")?.kind === "new", "size differs from KB row -> new (all three parts must match)");
  ok(m.get("L6")?.kind === "no_name", "no kb identity -> no_name");
  ok(m.size === 6, "every lot gets a chip");

  // Unknown inputs never invent a match.
  const u = planLineChips({ ...facts, liveIndex: undefined, kbRows: undefined });
  ok(u.get("L2")?.kind === "new" && u.get("L4")?.kind === "new", "unknown index/kb -> new, never a guess");
  ok(u.get("L1")?.kind === "on_menu", "on_menu needs only the published keys");

  // "" identity never matches an index entry keyed "".
  const e = planLineChips({
    ...facts,
    lots: [{ lotId: "E", posProductKey: "KE", identityKey: "", kb: kb("e") }],
    liveIndex: new Map([["", ["X"]]]),
  });
  ok(e.get("E")?.kind === "new", "empty identity never matches");

  // A live card under the lot's OWN key that is not published is not a restock hint.
  const own = planLineChips({
    ...facts,
    lots: [{ lotId: "O", posProductKey: "KO", identityKey: "acme|o|flower", kb: kb("o") }],
    publishedKeys: new Set(),
    liveIndex: new Map([["acme|o|flower", ["KO"]]]),
  });
  ok(own.get("O")?.kind === "new", "own key filtered from restock candidates");

  // Null variant_label in a KB row equals "".
  const nv = planLineChips({
    ...facts,
    lots: [{ lotId: "N", posProductKey: null, identityKey: "x|y|z", kb: kb("each", "") }],
    kbRows: [{ id: "kb-each", brand_slug: "acme", product_slug: "each", variant_label: null }],
  });
  ok(nv.get("N")?.kind === "kb_known", "null variant_label == empty");

  // No published menu wording.
  const np = planLineChips({ ...facts, publishedKeys: new Set(), liveIndex: undefined, kbRows: [], hasPublishedMenu: false });
  ok(np.get("L5")?.label === "New (no live menu yet)", "no menu wording");

  // Summary.
  const s = summarizeLineChips(m);
  ok(s.restock === 2 && s.known === 1 && s.fresh === 1 && s.attention === 2, "summary counts");
  ok(s.text === "2 restocks · 1 known to the KB · 1 new · 2 need a choice in onboarding", "summary text");
  ok(summarizeLineChips(new Map()).text === "", "empty summary");

  // Every chip with an href points at a real admin route prefix.
  for (const c of m.values()) {
    if (c.href) ok(c.href.startsWith("/admin/products/") || c.href.startsWith("/admin/knowledge-base/products/"), `href shape ${c.kind}`);
  }
  // Encoding.
  ok(productCardHref("a b/c") === "/admin/products/a%20b%2Fc", "card href encodes");

  return { passed, failed };
}
