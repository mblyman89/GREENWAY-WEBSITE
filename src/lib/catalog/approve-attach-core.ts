/**
 * src/lib/catalog/approve-attach-core.ts  (R24 follow-up: S12.2 + the open S12.6 line)
 *
 * Owner (R24, verbatim): "Please build S36 as one pr, then build the three
 * small follow ups, each as their own pr."  This is the S12 follow-up:
 *
 *   S12.2  approveDraftWithPrice: "call attachProductFacts ... -> replaces
 *          saveStrainTypeToKb; set kb_product_id on draft/lot".
 *   S12.6  "kb_products row exists/updated for every approved product with
 *          identity."
 *
 * The PURE half. It decides, from server-read inputs only:
 *   1. the strain-type write into kb_strains: the SAME rules the old
 *      saveStrainTypeToKb applied (bible SLICE 93), so nothing about what
 *      the strain library learns from an approval changes:
 *        - the verdict is the approver's validated pick; else the folded
 *          machine suggestion when it is >= 90 and did NOT come from the
 *          strain library itself (already there - nothing to save);
 *        - decideKbStrainTypeWrite then says create / set / flip / skip
 *          (only a HUMAN pick may flip a curated value);
 *   2. the facts the approval carries onto kb_products: only facts that are
 *      ALREADY counted on the draft's attached facts (golden-record-core
 *      countedAttachedFact: a record source, or a banded source >= 90%),
 *      never the placeholder sentence, never a guess;
 *   3. one plain sentence for the audit.
 *
 * No fs, no network, no Supabase. Embedded self-tests at the bottom
 * (registered in scripts/compliance/run-pure-selftests.ts with an exact floor).
 */
import {
  decideKbStrainTypeWrite,
  suggestStrainType,
  STRAIN_TYPE_AUTO_MIN_CONFIDENCE,
} from "@/lib/inventory/strain-type-intel-core";
import { canonicalStrainType } from "@/lib/menu/strain-taxonomy";
import { countedAttachedFact, isBoilerplateDescription } from "./golden-record-core";
import { strainSlug } from "./product-identity-core";

// --- 1. Strain type ------------------------------------------------------------------

export type ApprovalStrainSource = "human" | "auto";

export interface ApprovalStrainVerdict {
  value: string;
  source: ApprovalStrainSource;
}

/**
 * The approval's strain-type verdict, or null (nothing to save). Identical to
 * the old saveStrainTypeToKb fold: the human's pick; else a >= 90 machine
 * suggestion that is not the strain library's own value.
 */
export function approvalStrainVerdict(input: {
  humanPick: string | null | undefined;
  kbStrainType: string | null | undefined;
  lotStrainType: string | null | undefined;
  productName: string | null | undefined;
}): ApprovalStrainVerdict | null {
  const pick = String(input.humanPick ?? "").trim();
  if (pick) {
    const c = canonicalStrainType(pick);
    // The caller passes validateStrainTypeChoice's canonical value; anything
    // that does not canonicalise is not a pick (never written).
    if (c === "unknown") return null;
    return { value: c, source: "human" };
  }
  const s = suggestStrainType({
    kbStrainType: input.kbStrainType ?? null,
    lotStrainType: input.lotStrainType ?? null,
    productName: input.productName ?? null,
  });
  if (!s || s.confidence < STRAIN_TYPE_AUTO_MIN_CONFIDENCE || s.source === "strain library") return null;
  return { value: s.value, source: "auto" };
}

export type ApprovalStrainWrite =
  | { action: "create"; slug: string; row: Record<string, unknown>; verdict: ApprovalStrainVerdict; reason: string }
  | { action: "set" | "flip"; slug: string; patch: Record<string, unknown>; verdict: ApprovalStrainVerdict; reason: string }
  | { action: "skip"; slug: string; reason: string };

/**
 * The kb_strains write for this approval, or null when the draft has no
 * strain name (nothing to attach the type to). The created row is exactly
 * the row the old path inserted (slug, name, strain_type, active true), so
 * a strain the owner confirms at approval is live for the next lot.
 */
export function planApprovalStrainWrite(input: {
  strainName: string | null | undefined;
  existing: { exists: boolean; strainType: string | null } ;
  verdict: ApprovalStrainVerdict | null;
  actorId: string | null;
}): ApprovalStrainWrite | null {
  const name = String(input.strainName ?? "").replace(/\s+/g, " ").trim();
  if (!name) return null;
  const slug = strainSlug(name);
  if (!input.verdict) return { action: "skip", slug, reason: "no strain type to save (no pick, and no machine verdict at 90% or more)" };
  const d = decideKbStrainTypeWrite({
    exists: input.existing.exists,
    existingType: input.existing.strainType,
    verdict: input.verdict.value as Parameters<typeof decideKbStrainTypeWrite>[0]["verdict"],
    source: input.verdict.source,
  });
  if (d.action === "skip") return { action: "skip", slug, reason: d.reason };
  if (d.action === "create") {
    return {
      action: "create",
      slug,
      verdict: input.verdict,
      reason: d.reason,
      row: {
        slug,
        name,
        strain_type: input.verdict.value,
        active: true,
        created_by: input.actorId,
        updated_by: input.actorId,
      },
    };
  }
  return {
    action: d.action,
    slug,
    verdict: input.verdict,
    reason: d.reason,
    patch: { strain_type: input.verdict.value, updated_by: input.actorId },
  };
}

// --- 2. kb_products facts --------------------------------------------------------------

export interface ApprovalKbFacts {
  description: string | null;
  short_description: string | null;
  aroma_notes: string[];
  flavor_notes: string[];
  effects: string[];
  /** The attached-facts fields that supplied a value (for the audit). */
  fields: string[];
}

function cleanStrings(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of v) {
    if (typeof x !== "string") continue;
    const t = x.replace(/\s+/g, " ").trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out;
}

/**
 * The product-level facts the draft's attached facts already COUNT (the S12
 * survivorship gate). The writer gap-fills them (a populated kb_products
 * slot is never replaced) and runs its own compliance gate on top.
 */
export function approvalKbFacts(attachedFacts: unknown): ApprovalKbFacts {
  const out: ApprovalKbFacts = { description: null, short_description: null, aroma_notes: [], flavor_notes: [], effects: [], fields: [] };
  for (const f of ["description", "short_description"] as const) {
    const c = countedAttachedFact(attachedFacts, f);
    if (!c || typeof c.value !== "string") continue;
    const t = c.value.trim();
    if (!t || isBoilerplateDescription(t)) continue;
    out[f] = t;
    out.fields.push(f);
  }
  for (const [field, col] of [
    ["aroma", "aroma_notes"],
    ["flavor", "flavor_notes"],
    ["effects", "effects"],
  ] as const) {
    const c = countedAttachedFact(attachedFacts, field);
    if (!c) continue;
    const list = cleanStrings(c.value);
    if (list.length === 0) continue;
    out[col] = list;
    out.fields.push(field);
  }
  return out;
}

// --- 3. Note ------------------------------------------------------------------------------

/** One plain sentence for the audit / log. */
export function approvalAttachNote(s: {
  kb: "written" | "no_key" | "failed" | "unavailable";
  facts: readonly string[];
  strain: ApprovalStrainWrite | null;
  linked: { draft: boolean; lot: boolean; preMigration: boolean };
}): string {
  const parts: string[] = [];
  if (s.kb === "written") {
    parts.push(
      s.facts.length
        ? `Product record saved with ${s.facts.join(", ")} (gap-fill: nothing already there was replaced).`
        : "Product record saved (no attached facts to add yet).",
    );
  } else if (s.kb === "no_key") parts.push("No product record: this product has no name or product key on its lot, so it was not guessed.");
  else if (s.kb === "unavailable") parts.push("No product record: the knowledge base table is not available.");
  else parts.push("The product record could not be saved; the approval itself is unaffected.");
  if (!s.strain) parts.push("No strain on this product.");
  else if (s.strain.action === "skip") parts.push(`Strain library unchanged (${s.strain.reason}).`);
  else parts.push(`Strain library: ${s.strain.action} ${s.strain.verdict.value} (${s.strain.verdict.source}).`);
  if (s.linked.preMigration) parts.push("Links not saved: migration 0234 is not applied.");
  else if (s.linked.draft || s.linked.lot) {
    parts.push(`Linked the ${[s.linked.draft ? "draft" : "", s.linked.lot ? "lot" : ""].filter(Boolean).join(" and ")} to the product record.`);
  }
  return parts.join(" ");
}

// --- Self-tests ---------------------------------------------------------------------------

export function __runApproveAttachCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`approve-attach-core FAIL: ${msg}`);
    }
  };
  const eq = (a: unknown, b: unknown, msg: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)})`);

  // 1. verdict
  eq(approvalStrainVerdict({ humanPick: "indica", kbStrainType: "sativa", lotStrainType: null, productName: null }), { value: "indica", source: "human" }, "human pick wins over the KB");
  eq(approvalStrainVerdict({ humanPick: "  Indica ", kbStrainType: null, lotStrainType: null, productName: null }), { value: "indica", source: "human" }, "pick canonicalised");
  eq(approvalStrainVerdict({ humanPick: "banana", kbStrainType: null, lotStrainType: "hybrid", productName: null }), null, "a junk pick is not a pick and never falls through to the machine");
  eq(approvalStrainVerdict({ humanPick: "", kbStrainType: null, lotStrainType: "hybrid", productName: null }), { value: "hybrid", source: "auto" }, "manifest 95 >= 90 -> auto");
  eq(approvalStrainVerdict({ humanPick: null, kbStrainType: "sativa", lotStrainType: "hybrid", productName: null }), null, "strain library's own value: nothing to save");
  eq(approvalStrainVerdict({ humanPick: null, kbStrainType: null, lotStrainType: null, productName: null }), null, "nothing known -> null");
  eq(approvalStrainVerdict({ humanPick: null, kbStrainType: "unknown", lotStrainType: "Indica", productName: null }), { value: "indica", source: "auto" }, "unknown KB type falls to the lot");
  eq(approvalStrainVerdict({ humanPick: undefined, kbStrainType: undefined, lotStrainType: undefined, productName: "Blue Dream [H]" }) === null || approvalStrainVerdict({ humanPick: undefined, kbStrainType: undefined, lotStrainType: undefined, productName: "Blue Dream [H]" })!.source === "auto", true, "name parse is only ever auto");
  {
    // A name parse below the bar is never written. Find one: both pures in prose (80).
    const v = approvalStrainVerdict({ humanPick: null, kbStrainType: null, lotStrainType: null, productName: "Indica Sativa Blend" });
    ok(v === null, "a below-bar (80) name hint is never written");
  }

  // 2. strain write
  const human = { value: "indica", source: "human" as const };
  const auto = { value: "hybrid", source: "auto" as const };
  eq(planApprovalStrainWrite({ strainName: "  ", existing: { exists: false, strainType: null }, verdict: human, actorId: "a" }), null, "no strain name -> null");
  eq(planApprovalStrainWrite({ strainName: null, existing: { exists: false, strainType: null }, verdict: human, actorId: "a" }), null, "null strain -> null");
  {
    const w = planApprovalStrainWrite({ strainName: "Blue  Dream", existing: { exists: false, strainType: null }, verdict: human, actorId: "a" });
    ok(w?.action === "create", "missing row -> create");
    if (w?.action === "create") {
      eq(w.row, { slug: "blue dream", name: "Blue Dream", strain_type: "indica", active: true, created_by: "a", updated_by: "a" }, "create row = the old saveStrainTypeToKb row exactly");
      eq(w.slug, "blue dream", "spaced strain slug (the injection/staging convention)");
    }
  }
  {
    const w = planApprovalStrainWrite({ strainName: "Blue Dream", existing: { exists: true, strainType: null }, verdict: auto, actorId: "a" });
    ok(w?.action === "set", "null type -> set (gap-fill)");
    if (w?.action === "set") eq(w.patch, { strain_type: "hybrid", updated_by: "a" }, "set patch is strain_type only");
  }
  {
    const w = planApprovalStrainWrite({ strainName: "Blue Dream", existing: { exists: true, strainType: "sativa" }, verdict: human, actorId: null });
    ok(w?.action === "flip", "human pick flips a curated value");
    if (w?.action === "flip") eq(w.patch, { strain_type: "indica", updated_by: null }, "flip patch");
  }
  {
    const w = planApprovalStrainWrite({ strainName: "Blue Dream", existing: { exists: true, strainType: "sativa" }, verdict: auto, actorId: null });
    ok(w?.action === "skip", "machine never overrides curation");
  }
  {
    const w = planApprovalStrainWrite({ strainName: "Blue Dream", existing: { exists: true, strainType: "Indica" }, verdict: human, actorId: null });
    ok(w?.action === "skip", "same value -> skip");
  }
  {
    const w = planApprovalStrainWrite({ strainName: "Blue Dream", existing: { exists: false, strainType: null }, verdict: null, actorId: null });
    ok(w?.action === "skip" && w.slug === "blue dream", "no verdict -> skip with the slug");
  }

  // 3. kb facts
  const at = "2026-01-01T00:00:00Z";
  const facts = {
    description: { value: "Sweet berry aroma.", source: "gemini", confidence: 0.95, at },
    short_description: { value: "Berry.", source: "gemini", confidence: 0.85, at },
    aroma: { value: ["Berry", " berry ", "pine", 3, ""], source: "human", confidence: null, at },
    flavor: { value: ["sweet"], source: "remembered", confidence: null, at },
    effects: { value: ["relaxed"], source: "gemini", confidence: 0.9, at },
  };
  const k = approvalKbFacts(facts);
  eq(k.description, "Sweet berry aroma.", "counted gemini 95 description");
  eq(k.short_description, null, "gemini 85 is not counted");
  eq(k.aroma_notes, ["Berry", "pine"], "human list cleaned + deduped, non-strings dropped");
  eq(k.flavor_notes, [], "remembered never decides");
  eq(k.effects, ["relaxed"], "gemini exactly 90 counts");
  eq(k.fields, ["description", "aroma", "effects"], "fields in order");
  eq(approvalKbFacts(null).fields, [], "no facts -> nothing");
  eq(approvalKbFacts([1, 2]).fields, [], "array -> nothing");
  eq(
    approvalKbFacts({ description: { value: "X from Y. Browse current availability, package options, and pricing at Greenway Marijuana in Port Orchard.", source: "human", confidence: null, at } }).description,
    null,
    "the placeholder sentence is never real copy",
  );
  eq(approvalKbFacts({ description: { value: "   ", source: "human", confidence: null, at } }).description, null, "blank description skipped");
  eq(approvalKbFacts({ description: { value: 5, source: "human", confidence: null, at } }).description, null, "non-string description skipped");
  eq(approvalKbFacts({ effects: { value: "relaxed", source: "human", confidence: null, at } }).effects, [], "non-array list skipped");
  eq(approvalKbFacts({ effects: { value: ["a"], source: "bogus", confidence: null, at } }).effects, [], "unknown source never counts");
  eq(approvalKbFacts({ short_description: { value: " Short. ", source: "coa", confidence: null, at } }).short_description, "Short.", "record source counts, trimmed");

  // 5. note
  const note = approvalAttachNote({
    kb: "written",
    facts: ["description"],
    strain: { action: "create", slug: "s", row: {}, verdict: human, reason: "" },
    linked: { draft: true, lot: true, preMigration: false },
  });
  ok(note.includes("Product record saved with description") && note.includes("create indica (human)") && note.includes("draft and lot"), "note: written + create + both links");
  ok(approvalAttachNote({ kb: "no_key", facts: [], strain: null, linked: { draft: false, lot: false, preMigration: true } }).includes("migration 0234"), "note: pre-0234");
  ok(approvalAttachNote({ kb: "failed", facts: [], strain: { action: "skip", slug: "s", reason: "r" }, linked: { draft: false, lot: false, preMigration: false } }).includes("Strain library unchanged (r)"), "note: skip reason");
  ok(approvalAttachNote({ kb: "written", facts: [], strain: null, linked: { draft: false, lot: true, preMigration: false } }).includes("no attached facts") , "note: no facts");
  ok(approvalAttachNote({ kb: "unavailable", facts: [], strain: null, linked: { draft: false, lot: true, preMigration: false } }).includes("Linked the lot to"), "note: lot only");

  return { passed, failed };
}
