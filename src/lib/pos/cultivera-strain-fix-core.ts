/**
 * src/lib/pos/cultivera-strain-fix-core.ts — R15b
 *
 * Owner, Round 15: "the unknown strain type fix needs to allow me to add
 * these, it should be intelligent too, the kb has a huge set of strains in
 * there already ... compare the strains in the cultivera list with the strains
 * we have confirmed and add the kb strain facts ... to the cultivera products
 * without strain types."
 *
 * PURE. Groups the import's cards whose strain type is unknown BY STRAIN NAME
 * (one decision fixes every card of that strain) and matches each name against
 * the Knowledge Base with the existing intelligent matcher
 * (ai/kb/strain-matcher.ts matchStrainToKb: exact → alias → contained → fuzzy).
 *
 * WHAT MAY BE APPLIED IN BULK (Rule 3.1 — never auto-commit uncertain data):
 *   - "kb_exact": the matcher's best is an EXACT name or ALIAS match AND the
 *     KB row carries a real type. Same strain, curated type: safe in one press.
 *   - everything else needs a per-row human press:
 *       "kb_confirm"  contained/fuzzy candidates (measured on the real export:
 *                     "Watermelon Sugar" is CONTAINED-matched to "Watermelon",
 *                     a different strain — so these are never bulk-applied);
 *       "kb_no_type"  the KB knows the strain but not its type — pick one,
 *                     optionally saved to the KB;
 *       "no_match"    not in the KB — pick one (a name hint is shown when the
 *                     product name carries an explicit (I)/(S)/(H) code),
 *                     optionally creating the KB strain.
 */
import { matchStrainToKb, type MatchableStrain, type MatchMethod } from "@/lib/ai/kb/strain-matcher";
import { canonicalStrainType } from "@/lib/menu/strain-taxonomy";
import { parseStrainTypeFromName, validateStrainTypeChoice } from "@/lib/inventory/strain-type-intel-core";
import type { GreenwayStrainType } from "@/lib/leafly/types";

/** Same key as strain-terpenes.ts normalizeStrainKey (inlined: that module pulls the whole seed). */
export function normalizeStrainKey(raw: string | null | undefined): string {
  return (raw ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

export type StrainFixItem = {
  sourceItemId: string;
  name: string;
  productName?: string | null;
  strainName: string | null;
  strainType: string | null;
};

export type StrainFixCandidate = {
  slug: string;
  name: string;
  type: GreenwayStrainType | null;
  method: MatchMethod;
  score: number;
  reason: string;
};

export type StrainFixKind = "kb_exact" | "kb_confirm" | "kb_no_type" | "no_match";

export type StrainFixGroup = {
  /** normalizeStrainKey(strainName) — the key the live menu overlay uses. */
  key: string;
  strainName: string;
  count: number;
  sourceItemIds: string[];
  sampleNames: string[];
  kind: StrainFixKind;
  /** kb_exact: the strain to apply. kb_confirm: the top candidate. */
  best: StrainFixCandidate | null;
  candidates: StrainFixCandidate[];
  /** An explicit type code in a product name (>= 90% only), for the manual pick. */
  nameHint: { value: GreenwayStrainType; evidence: string } | null;
};

export type StrainFixPlan = {
  unknownCards: number;
  noStrainName: number;
  groups: StrainFixGroup[];
  counts: Record<StrainFixKind, number>;
};

const KIND_ORDER: Record<StrainFixKind, number> = { kb_exact: 0, kb_confirm: 1, kb_no_type: 2, no_match: 3 };

function knownType(raw: string | null | undefined): GreenwayStrainType | null {
  const c = canonicalStrainType(raw);
  return c === "unknown" ? null : c;
}

/** Cards whose strain type is unknown, grouped by strain name, each matched to the KB. */
export function planStrainFix(items: readonly StrainFixItem[], strains: readonly MatchableStrain[]): StrainFixPlan {
  const byKey = new Map<string, { strainName: string; ids: string[]; names: string[] }>();
  let unknownCards = 0;
  let noStrainName = 0;
  for (const it of items) {
    if (knownType(it.strainType)) continue;
    unknownCards += 1;
    const key = normalizeStrainKey(it.strainName);
    if (!key) { noStrainName += 1; continue; }
    const g = byKey.get(key) ?? { strainName: (it.strainName ?? "").trim().replace(/\s+/g, " "), ids: [], names: [] };
    g.ids.push(it.sourceItemId);
    if (g.names.length < 3) g.names.push(it.productName || it.name);
    byKey.set(key, g);
  }
  const pool = strains as MatchableStrain[];
  const groups: StrainFixGroup[] = [];
  for (const [key, g] of byKey) {
    const m = matchStrainToKb({ strainName: g.strainName }, pool);
    const candidates: StrainFixCandidate[] = m.candidates.map((c) => ({
      slug: c.strain.slug,
      name: c.strain.name,
      type: knownType(c.strain.strain_type),
      method: c.method,
      score: c.score,
      reason: c.reason,
    }));
    const best = m.best
      ? candidates.find((c) => c.slug === m.best!.strain.slug) ?? null
      : null;
    let kind: StrainFixKind;
    if (best && (best.method === "exact" || best.method === "alias")) {
      kind = best.type ? "kb_exact" : "kb_no_type";
    } else if (candidates.some((c) => c.type)) {
      kind = "kb_confirm";
    } else {
      kind = "no_match";
    }
    // Name hint: only a >=90% explicit code, and only when every sample agrees.
    let nameHint: StrainFixGroup["nameHint"] = null;
    for (const n of g.names) {
      const s = parseStrainTypeFromName(n);
      if (!s || s.confidence < 90) continue;
      if (nameHint && nameHint.value !== s.value) { nameHint = null; break; }
      nameHint = { value: s.value, evidence: s.evidence };
    }
    groups.push({
      key,
      strainName: g.strainName,
      count: g.ids.length,
      sourceItemIds: g.ids,
      sampleNames: g.names,
      kind,
      best: kind === "kb_confirm" ? candidates.find((c) => c.type) ?? null : best,
      candidates: candidates.filter((c) => c.type).slice(0, 4),
      nameHint,
    });
  }
  groups.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || b.count - a.count || a.key.localeCompare(b.key));
  const counts: Record<StrainFixKind, number> = { kb_exact: 0, kb_confirm: 0, kb_no_type: 0, no_match: 0 };
  for (const g of groups) counts[g.kind] += 1;
  return { unknownCards, noStrainName, groups, counts };
}

/** The KB slug convention (catalog-drafts.ts saveStrainTypeToKb): lowercase, spaces collapsed. */
export function kbSlugForStrainName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export type StrainFixChoice =
  | { ok: true; key: string; type: GreenwayStrainType; kbSlug: string | null; saveToKb: boolean; addAlias: boolean }
  | { ok: false; error: string };

/**
 * Validate ONE per-row press against the server-recomputed plan (the form is
 * never trusted): the strain must still be in the unknown list, a chosen KB
 * strain must be one of its candidates, and the type must be canonical.
 */
export function parseStrainFixChoice(
  raw: { key?: string | null; strainType?: string | null; kbSlug?: string | null; saveToKb?: string | null },
  plan: Pick<StrainFixPlan, "groups">,
): StrainFixChoice {
  const key = String(raw.key ?? "").trim();
  const group = plan.groups.find((g) => g.key === key);
  if (!group) return { ok: false, error: "That strain no longer has unknown-type cards — it may already be fixed." };
  const kbSlug = String(raw.kbSlug ?? "").trim() || null;
  const candidate = kbSlug ? [group.best, ...group.candidates].find((c) => c?.slug === kbSlug) ?? null : null;
  if (kbSlug && !candidate) return { ok: false, error: "That Knowledge Base strain is not a match for this name." };
  const picked = validateStrainTypeChoice(raw.strainType ?? (candidate?.type ?? ""));
  if (!picked.ok) return { ok: false, error: picked.error };
  if (!picked.value) return { ok: false, error: `Pick a strain type for "${group.strainName}".` };
  const saveToKb = raw.saveToKb === "1" || raw.saveToKb === "on";
  // A confirmed NON-exact match teaches the KB the Cultivera spelling as an
  // alias so the next import matches it exactly (a human pressed it).
  const addAlias = Boolean(candidate && candidate.method !== "exact" && candidate.method !== "alias");
  return { ok: true, key, type: picked.value, kbSlug: candidate?.slug ?? null, saveToKb, addAlias };
}

export const STRAIN_FIX_AUDIT = "menu_import.strain_type_fixed";

export function strainFixHref(importId: string, msg?: string, isError = false): string {
  const base = `/admin/menu-imports/${encodeURIComponent(importId)}/strains`;
  return msg ? `${base}?${isError ? "error" : "done"}=${encodeURIComponent(msg)}` : base;
}

// ── self-tests ────────────────────────────────────────────────────────────
export function __runCultiveraStrainFixCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (c: boolean, m: string) => {
    if (!c) throw new Error("FAIL cultivera-strain-fix-core: " + m);
    passed += 1;
  };
  const kb: MatchableStrain[] = [
    { slug: "blue dream", name: "Blue Dream", aliases: [], strain_type: "sativa-hybrid" },
    { slug: "watermelon", name: "Watermelon", aliases: [], strain_type: "indica" },
    { slug: "gmo cookies", name: "GMO Cookies", aliases: ["gmo"], strain_type: null },
  ];
  const plan = planStrainFix(
    [
      { sourceItemId: "a", name: "Blue Dream 3.5g", strainName: "Blue  Dream", strainType: "unknown" },
      { sourceItemId: "b", name: "Blue Dream 1g", strainName: "blue dream", strainType: null },
      { sourceItemId: "c", name: "Watermelon Sugar (S)", strainName: "Watermelon Sugar", strainType: "unknown" },
      { sourceItemId: "d", name: "GMO", strainName: "GMO", strainType: "unknown" },
      { sourceItemId: "e", name: "Zzqx Kush (I) 1g", strainName: "Zzqx Qqq", strainType: "" },
      { sourceItemId: "f", name: "Known", strainName: "Blue Dream", strainType: "hybrid" },
      { sourceItemId: "g", name: "No strain", strainName: "", strainType: "unknown" },
    ],
    kb,
  );
  const by = (k: string) => plan.groups.find((g) => g.key === k);
  ok(plan.unknownCards === 6 && plan.noStrainName === 1, "known-type cards skipped, blank names counted");
  ok(by("blue dream")?.kind === "kb_exact" && by("blue dream")?.count === 2 && by("blue dream")?.best?.type === "sativa-hybrid", "exact → bulk, grouped by normalized name");
  ok(by("watermelon sugar")?.kind !== "kb_exact", "contained match never bulk-applied");
  ok(by("gmo")?.kind === "kb_no_type", "alias hit with no KB type → pick");
  ok(by("zzqx qqq")?.kind === "no_match" && by("zzqx qqq")?.nameHint?.value === "indica", "no match carries the (I) name hint");
  ok(plan.groups[0].kind === "kb_exact", "bulk-safe first");
  const bad = parseStrainFixChoice({ key: "watermelon sugar", kbSlug: "blue dream", strainType: "sativa" }, plan);
  ok(!bad.ok, "a KB strain that is not a candidate is refused");
  const good = parseStrainFixChoice({ key: "zzqx qqq", strainType: "indica", saveToKb: "1" }, plan);
  ok(good.ok && good.type === "indica" && good.saveToKb && good.kbSlug === null, "manual pick parsed");
  ok(!parseStrainFixChoice({ key: "zzqx qqq", strainType: "purple" }, plan).ok, "junk type refused");
  ok(kbSlugForStrainName("  Blue   Dream ") === "blue dream", "slug convention");
  return { passed, failed: 0 };
}
