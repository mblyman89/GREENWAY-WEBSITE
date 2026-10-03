/**
 * src/lib/enrichment/sensory-fill-core.ts - Round 23 (fixes 3 + 10).
 *
 * THE PROBLEM (owner, round 23): the enrichment page said "Still missing:
 * effects, terpenes, aroma, flavor" while the checklist said "Fully
 * enriched", and a 100%-match KB row with all of those facts sat below with
 * no way to use it.
 *
 * WHY: the KB knowledge ladder stops at its FIRST hit. A card with its own
 * enrichment copy hits rung 3 ("enrichment"), and that rung carries no
 * sensory lists by design (tests/compliance/menu-knowledge-batch.test.ts pins
 * it). So the gap vector measured four empty lists even when the facts were
 * on file elsewhere: in the KB row the human linked, in sensory/effects
 * suggestions the human accepted, or in the strain library.
 *
 * THE FIX (this module, pure): a separate gap-fill layer, applied by the
 * command center AFTER the ladder and BEFORE the gap vector. The ladder and
 * the public menu are untouched. Each EMPTY list is filled from the first
 * layer, in the caller's order, that has a non-empty list for it; a list the
 * ladder already filled is never replaced. Every filled list remembers WHERE
 * it came from, so the page can say so ("aroma - Linked KB").
 *
 * Industry pattern: field-level survivorship with source precedence (MDM
 * "golden record" rules) - first trusted non-empty source wins per field,
 * with lineage kept per field.
 *
 * Never guesses: only explicit human-linked or human-accepted facts and the
 * curated strain library are layers. A fuzzy "suggested match" is NOT a layer
 * until a human clicks "Use these facts".
 */

/** The four sensory/experience fields the gap vector measures from the KB. */
export const SENSORY_FIELDS = ["effects", "terpenes", "aroma", "flavor"] as const;
export type SensoryField = (typeof SENSORY_FIELDS)[number];

/** The lists, in ProductKnowledge's names. */
export interface SensoryLists {
  effects: readonly string[];
  terpenes: readonly string[];
  aromaNotes: readonly string[];
  flavorNotes: readonly string[];
}

/** One fill layer: its plain-English label and its lists (any may be null). */
export interface SensoryLayer {
  label: string;
  effects?: readonly unknown[] | null;
  terpenes?: readonly unknown[] | null;
  aromaNotes?: readonly unknown[] | null;
  flavorNotes?: readonly unknown[] | null;
}

export interface SensoryFillResult {
  lists: { effects: string[]; terpenes: string[]; aromaNotes: string[]; flavorNotes: string[] };
  /** Field -> label of the layer that filled it (only fields this module filled). */
  origins: Partial<Record<SensoryField, string>>;
}

const LIST_KEY: Readonly<Record<SensoryField, keyof SensoryLists>> = Object.freeze({
  effects: "effects",
  terpenes: "terpenes",
  aroma: "aromaNotes",
  flavor: "flavorNotes",
});

/** Trimmed, non-blank strings, de-duplicated case-insensitively, first casing kept. */
export function cleanList(v: readonly unknown[] | null | undefined): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of v) {
    if (typeof x !== "string") continue;
    const t = x.trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

/**
 * Gap-fill each EMPTY list of `base` from the first layer with a non-empty
 * list for it. Inputs are never mutated. Layers with a blank label are
 * skipped (a fill must always be explainable).
 */
export function fillSensory(base: SensoryLists, layers: readonly SensoryLayer[]): SensoryFillResult {
  const lists = {
    effects: cleanList(base.effects),
    terpenes: cleanList(base.terpenes),
    aromaNotes: cleanList(base.aromaNotes),
    flavorNotes: cleanList(base.flavorNotes),
  };
  const origins: Partial<Record<SensoryField, string>> = {};
  for (const f of SENSORY_FIELDS) {
    const key = LIST_KEY[f];
    if (lists[key].length > 0) continue;
    for (const layer of layers) {
      const label = typeof layer?.label === "string" ? layer.label.trim() : "";
      if (!label) continue;
      const got = cleanList(layer[key] ?? null);
      if (got.length === 0) continue;
      lists[key] = got;
      origins[f] = label;
      break;
    }
  }
  return { lists, origins };
}

/**
 * Parse the accepted ai_suggestions the enrichment page writes:
 *   "sensory" -> JSON {aroma_notes, flavor_notes, terpenes}
 *   "effects" -> comma list.
 * Per LIST, the newest accepted row with a non-empty list wins (rows are
 * passed newest first, as the read orders them), so a newer "sensory" row
 * without aroma never hides an older accepted aroma. Malformed JSON is
 * ignored, never thrown.
 */
export function sensoryFromAcceptedSuggestions(
  rows: readonly { field_key?: unknown; suggested_value?: unknown }[] | null | undefined,
): Omit<SensoryLayer, "label"> {
  const out = { effects: [] as string[], terpenes: [] as string[], aromaNotes: [] as string[], flavorNotes: [] as string[] };
  const take = (key: keyof typeof out, v: unknown) => {
    if (out[key].length > 0) return;
    const got = cleanList(Array.isArray(v) ? v : null);
    if (got.length > 0) out[key] = got;
  };
  for (const r of rows ?? []) {
    const field = typeof r?.field_key === "string" ? r.field_key : "";
    const value = typeof r?.suggested_value === "string" ? r.suggested_value : "";
    if (!value.trim()) continue;
    if (field === "sensory") {
      try {
        const p = JSON.parse(value) as Record<string, unknown>;
        if (p && typeof p === "object" && !Array.isArray(p)) {
          take("aromaNotes", p.aroma_notes);
          take("flavorNotes", p.flavor_notes);
          take("terpenes", p.terpenes);
        }
      } catch {
        /* malformed -> ignored */
      }
    } else if (field === "effects") {
      take("effects", value.split(","));
    }
  }
  return out;
}

/** What a KB row would ADD to this card: the sensory fields it has that the card lacks. */
export function factsToAdd(
  card: SensoryLists,
  kb: Omit<SensoryLayer, "label">,
): SensoryField[] {
  const out: SensoryField[] = [];
  for (const f of SENSORY_FIELDS) {
    const key = LIST_KEY[f];
    if (cleanList(card[key]).length === 0 && cleanList(kb[key] ?? null).length > 0) out.push(f);
  }
  return out;
}

/**
 * The sensory lists recorded on the onboarding fact history (one LATEST
 * onboarding provenance row per field, as latestProvenance returns them).
 * Provenance is only written for facts that LANDED live (attach-plan-core),
 * so these are attached facts, not guesses. Non-list values are ignored.
 */
export function sensoryFromProvenance(
  latest: ReadonlyMap<string, { value_json: unknown }> | null | undefined,
): Omit<SensoryLayer, "label"> {
  const list = (f: string) => cleanList((latest?.get(f)?.value_json as unknown[] | undefined) ?? null);
  return { effects: list("effects"), terpenes: list("terpenes"), aromaNotes: list("aroma"), flavorNotes: list("flavor") };
}

/**
 * The KB suggested-match button (R23 fix 10). Already linked -> no button;
 * facts to add -> "Use these facts (adds ...)"; nothing new -> "Link to this
 * card" (the link still lets the KB row fill this card from now on).
 */
export function kbMatchAction(input: {
  linked: boolean;
  adds: readonly string[];
}): { kind: "linked" | "use" | "link"; label: string } {
  if (input.linked) return { kind: "linked", label: "Linked to this card" };
  const adds = input.adds.filter((x) => typeof x === "string" && x.trim() !== "");
  if (adds.length > 0) return { kind: "use", label: `Use these facts (adds ${joinFields(adds)})` };
  return { kind: "link", label: "Link to this card" };
}

/** What the "Use these facts" action will write (R23 fix 10). */
export interface KbFactsPlan {
  /** The accepted "sensory" suggestion value (JSON), or null = nothing new. */
  sensoryJson: string | null;
  /** The accepted "effects" suggestion value (comma list), or null. */
  effectsCsv: string | null;
  /** Gap-fill for an EMPTY enrichment description, or null. */
  description: string | null;
  /** Gap-fill for an EMPTY enrichment short description, or null. */
  shortDescription: string | null;
  /** Plain-English names of what this adds ("aroma", "description", ...). */
  adds: string[];
  /** Terms/copy refused by the compliance gate (for the audit + the message). */
  refused: string[];
}

function unionLists(a: readonly string[], b: readonly string[]): string[] {
  return cleanList([...a, ...b]);
}

/**
 * Plan attaching a KB row's facts to a card. Pure: the server passes the
 * compliance verdicts in (the compliance module is server-only):
 *   - allowedEffects: checkEffects(kb.effects).allowed
 *   - termOk / proseOk: no BLOCKING compliance flag.
 * Sensory/effects are UNIONED with what the card already accepted (so the
 * newest accepted row - which writeBackOnPublish reads - never loses an older
 * fact). Prose only fills an EMPTY slot (curated copy is never overwritten).
 * A blank or refused value never produces a write.
 */
export function planKbFactsAttach(input: {
  card: { description: string | null; shortDescription: string | null; accepted: Omit<SensoryLayer, "label"> };
  /** What the card already shows per list (after the fill layers). */
  shown: SensoryLists;
  kb: {
    aromaNotes: readonly unknown[] | null;
    flavorNotes: readonly unknown[] | null;
    terpenes: readonly unknown[] | null;
    description: string | null;
    shortDescription: string | null;
  };
  allowedEffects: readonly string[];
  termOk: (term: string) => boolean;
  proseOk: (text: string) => boolean;
}): KbFactsPlan {
  const refused: string[] = [];
  const safeTerms = (v: readonly unknown[] | null) =>
    cleanList(v).filter((t) => {
      if (input.termOk(t)) return true;
      refused.push(t);
      return false;
    });
  const aroma = safeTerms(input.kb.aromaNotes);
  const flavor = safeTerms(input.kb.flavorNotes);
  const terps = safeTerms(input.kb.terpenes);
  const effects = cleanList(input.allowedEffects);

  const acc = input.card.accepted;
  const accA = cleanList(acc.aromaNotes ?? null);
  const accF = cleanList(acc.flavorNotes ?? null);
  const accT = cleanList(acc.terpenes ?? null);
  const accE = cleanList(acc.effects ?? null);

  const lower = (xs: readonly string[]) => new Set(xs.map((x) => x.toLowerCase()));
  const addsNew = (accepted: string[], kb: string[]) => {
    const have = lower(accepted);
    return kb.some((x) => !have.has(x.toLowerCase()));
  };

  const adds: string[] = [];
  const shownEmpty = (k: keyof SensoryLists) => cleanList(input.shown[k]).length === 0;
  if (effects.length > 0 && shownEmpty("effects")) adds.push("effects");
  if (terps.length > 0 && shownEmpty("terpenes")) adds.push("terpenes");
  if (aroma.length > 0 && shownEmpty("aromaNotes")) adds.push("aroma");
  if (flavor.length > 0 && shownEmpty("flavorNotes")) adds.push("flavor");

  const sensoryChanged = addsNew(accA, aroma) || addsNew(accF, flavor) || addsNew(accT, terps);
  const sensoryJson = sensoryChanged
    ? JSON.stringify({ aroma_notes: unionLists(accA, aroma), flavor_notes: unionLists(accF, flavor), terpenes: unionLists(accT, terps) })
    : null;
  const effectsCsv = addsNew(accE, effects) ? unionLists(accE, effects).join(", ") : null;

  const fillProse = (cur: string | null, next: string | null, name: string): string | null => {
    if (typeof cur === "string" && cur.trim() !== "") return null;
    const t = typeof next === "string" ? next.trim() : "";
    if (!t) return null;
    if (!input.proseOk(t)) {
      refused.push(name);
      return null;
    }
    adds.push(name);
    return t;
  };
  const description = fillProse(input.card.description, input.kb.description, "description");
  const shortDescription = fillProse(input.card.shortDescription, input.kb.shortDescription, "short description");

  return { sensoryJson, effectsCsv, description, shortDescription, adds, refused };
}

/** "aroma, flavor and terpenes" style list for buttons. */
export function joinFields(fields: readonly string[]): string {
  if (fields.length === 0) return "";
  if (fields.length === 1) return fields[0]!;
  return `${fields.slice(0, -1).join(", ")} and ${fields[fields.length - 1]}`;
}

/** Plain-English name of a knowledge-ladder source for the KB panel badge. */
export function knowledgeSourceLabel(source: string | null | undefined): string {
  switch (String(source ?? "")) {
    case "kb-exact":
      return "KB product (published)";
    case "kb-draft":
      return "KB product (draft)";
    case "enrichment":
      return "This card's enrichment";
    case "strain":
      return "Strain library";
    default:
      return "No match";
  }
}

// --- Self-test ------------------------------------------------------------------------

export function __runSensoryFillCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`[sensory-fill-core] FAIL: ${label}`);
    }
  };
  const eq = (label: string, a: unknown, b: unknown) => ok(JSON.stringify(a) === JSON.stringify(b), `${label} (got ${JSON.stringify(a)})`);
  const empty: SensoryLists = { effects: [], terpenes: [], aromaNotes: [], flavorNotes: [] };

  // cleanList
  eq("clean trims/dedupes/keeps first casing", cleanList([" Pine ", "pine", "", 3, null, "Citrus"]), ["Pine", "Citrus"]);
  eq("clean non-array", cleanList(null), []);
  eq("clean string is not a list", cleanList("pine" as unknown as unknown[]), []);

  // fillSensory - base wins, layers in order, origin recorded
  const r1 = fillSensory(
    { ...empty, aromaNotes: ["berry"] },
    [
      { label: "Linked KB", aromaNotes: ["pine"], flavorNotes: ["sweet"] },
      { label: "Strain library", flavorNotes: ["sour"], terpenes: ["myrcene"], effects: ["calm"] },
    ],
  );
  eq("base aroma kept", r1.lists.aromaNotes, ["berry"]);
  eq("flavor from first layer", r1.lists.flavorNotes, ["sweet"]);
  eq("terpenes from second layer", r1.lists.terpenes, ["myrcene"]);
  eq("effects from second layer", r1.lists.effects, ["calm"]);
  eq("origins only for filled", r1.origins, { effects: "Strain library", terpenes: "Strain library", flavor: "Linked KB" });
  ok(!("aroma" in r1.origins), "base field has no origin");

  // empty layer list is skipped, not a fill
  const r2 = fillSensory(empty, [{ label: "A", effects: [" ", ""] }, { label: "B", effects: ["happy"] }]);
  eq("blank list skipped", r2.lists.effects, ["happy"]);
  eq("blank list origin", r2.origins.effects, "B");

  // blank label skipped
  const r3 = fillSensory(empty, [{ label: "  ", terpenes: ["limonene"] }]);
  eq("blank label never fills", r3.lists.terpenes, []);
  eq("blank label no origin", r3.origins, {});

  // no layers -> unchanged
  const r4 = fillSensory({ ...empty, effects: ["relaxed"] }, []);
  eq("no layers", r4.lists, { effects: ["relaxed"], terpenes: [], aromaNotes: [], flavorNotes: [] });

  // inputs never mutated
  const baseIn: SensoryLists = { effects: [], terpenes: [], aromaNotes: [], flavorNotes: [] };
  const layerIn = { label: "X", effects: ["calm"] };
  fillSensory(baseIn, [layerIn]);
  eq("base not mutated", baseIn.effects, []);
  eq("layer not mutated", layerIn.effects, ["calm"]);

  // returned lists are copies
  const shared = ["pine"];
  const r5 = fillSensory(empty, [{ label: "X", aromaNotes: shared }]);
  r5.lists.aromaNotes.push("x");
  eq("returned list is a copy", shared, ["pine"]);

  // accepted suggestions
  const acc = sensoryFromAcceptedSuggestions([
    { field_key: "sensory", suggested_value: JSON.stringify({ aroma_notes: ["banana"], flavor_notes: ["cream"], terpenes: ["Myrcene", "myrcene"] }) },
    { field_key: "sensory", suggested_value: JSON.stringify({ aroma_notes: ["old"] }) },
    { field_key: "effects", suggested_value: "relaxed, happy ,, " },
    { field_key: "effects", suggested_value: "old" },
    { field_key: "description", suggested_value: "x" },
  ]);
  eq("accepted aroma newest", acc.aromaNotes, ["banana"]);
  eq("accepted flavor", acc.flavorNotes, ["cream"]);
  eq("accepted terps deduped", acc.terpenes, ["Myrcene"]);
  eq("accepted effects split", acc.effects, ["relaxed", "happy"]);
  const bad = sensoryFromAcceptedSuggestions([
    { field_key: "sensory", suggested_value: "{not json" },
    { field_key: "sensory", suggested_value: "[1,2]" },
    { field_key: "effects", suggested_value: "   " },
  ]);
  eq("malformed ignored", bad, { effects: [], terpenes: [], aromaNotes: [], flavorNotes: [] });
  eq("null rows", sensoryFromAcceptedSuggestions(null), { effects: [], terpenes: [], aromaNotes: [], flavorNotes: [] });
  // a malformed newest row does not block an older valid one
  const older = sensoryFromAcceptedSuggestions([
    { field_key: "sensory", suggested_value: "oops" },
    { field_key: "sensory", suggested_value: JSON.stringify({ terpenes: ["pinene"] }) },
  ]);
  eq("older valid after malformed", older.terpenes, ["pinene"]);
  const perList = sensoryFromAcceptedSuggestions([
    { field_key: "sensory", suggested_value: JSON.stringify({ aroma_notes: [], flavor_notes: ["new"], terpenes: [] }) },
    { field_key: "sensory", suggested_value: JSON.stringify({ aroma_notes: ["old aroma"], flavor_notes: ["old"] }) },
  ]);
  eq("per-list: newer row without aroma keeps older aroma", perList.aromaNotes, ["old aroma"]);
  eq("per-list: newest flavor wins", perList.flavorNotes, ["new"]);

  // factsToAdd
  eq(
    "factsToAdd only gaps the kb can fill",
    factsToAdd({ ...empty, aromaNotes: ["x"] }, { aromaNotes: ["y"], flavorNotes: ["z"], terpenes: [], effects: ["calm"] }),
    ["effects", "flavor"],
  );
  eq("factsToAdd none", factsToAdd({ effects: ["a"], terpenes: ["b"], aromaNotes: ["c"], flavorNotes: ["d"] }, { effects: ["q"] }), []);

  // joinFields
  eq("join 0", joinFields([]), "");
  eq("join 1", joinFields(["aroma"]), "aroma");
  eq("join 2", joinFields(["aroma", "flavor"]), "aroma and flavor");
  eq("join 3", joinFields(["effects", "aroma", "flavor"]), "effects, aroma and flavor");

  // sensoryFromProvenance
  const prov = new Map<string, { value_json: unknown }>([
    ["aroma", { value_json: ["Banana", "banana"] }],
    ["effects", { value_json: "calm" }],
    ["flavor", { value_json: [] }],
    ["terpenes", { value_json: ["limonene"] }],
  ]);
  eq("prov lists", sensoryFromProvenance(prov), { effects: [], terpenes: ["limonene"], aromaNotes: ["Banana"], flavorNotes: [] });
  eq("prov null", sensoryFromProvenance(null), { effects: [], terpenes: [], aromaNotes: [], flavorNotes: [] });

  // kbMatchAction
  eq("action linked", kbMatchAction({ linked: true, adds: ["aroma"] }), { kind: "linked", label: "Linked to this card" });
  eq("action use", kbMatchAction({ linked: false, adds: ["aroma", "flavor"] }), { kind: "use", label: "Use these facts (adds aroma and flavor)" });
  eq("action link", kbMatchAction({ linked: false, adds: [" "] }), { kind: "link", label: "Link to this card" });

  // planKbFactsAttach
  const okAll = () => true;
  const emptyShown: SensoryLists = { effects: [], terpenes: [], aromaNotes: [], flavorNotes: [] };
  const plan1 = planKbFactsAttach({
    card: { description: null, shortDescription: "  ", accepted: { aromaNotes: ["Banana"], effects: ["happy"] } },
    shown: { ...emptyShown, aromaNotes: ["Banana"] },
    kb: { aromaNotes: ["banana", "Cream"], flavorNotes: ["Sweet"], terpenes: ["Myrcene", "cure cancer"], description: " Creamy. ", shortDescription: "Short" },
    allowedEffects: ["relaxed", "Happy"],
    termOk: (t) => t !== "cure cancer",
    proseOk: okAll,
  });
  eq("plan sensory unions accepted first", plan1.sensoryJson, JSON.stringify({ aroma_notes: ["Banana", "Cream"], flavor_notes: ["Sweet"], terpenes: ["Myrcene"] }));
  eq("plan effects union", plan1.effectsCsv, "happy, relaxed");
  eq("plan description trimmed", plan1.description, "Creamy.");
  eq("plan blank short gets filled", plan1.shortDescription, "Short");
  eq("plan adds (shown aroma excluded)", plan1.adds, ["effects", "terpenes", "flavor", "description", "short description"]);
  eq("plan refused term", plan1.refused, ["cure cancer"]);
  const plan2 = planKbFactsAttach({
    card: { description: "Ours", shortDescription: null, accepted: { aromaNotes: ["pine"], flavorNotes: [], terpenes: [], effects: ["calm"] } },
    shown: { effects: ["calm"], terpenes: [], aromaNotes: ["pine"], flavorNotes: [] },
    kb: { aromaNotes: ["PINE"], flavorNotes: [], terpenes: [], description: "Theirs", shortDescription: "bad" },
    allowedEffects: ["Calm"],
    termOk: okAll,
    proseOk: (t) => t !== "bad",
  });
  eq("plan nothing new sensory", plan2.sensoryJson, null);
  eq("plan nothing new effects", plan2.effectsCsv, null);
  eq("plan curated description kept", plan2.description, null);
  eq("plan refused prose", [plan2.shortDescription, plan2.refused], [null, ["short description"]]);
  eq("plan adds nothing", plan2.adds, []);

  // knowledgeSourceLabel
  eq("label exact", knowledgeSourceLabel("kb-exact"), "KB product (published)");
  eq("label draft", knowledgeSourceLabel("kb-draft"), "KB product (draft)");
  eq("label enrichment", knowledgeSourceLabel("enrichment"), "This card's enrichment");
  eq("label strain", knowledgeSourceLabel("strain"), "Strain library");
  eq("label none", knowledgeSourceLabel("none"), "No match");
  eq("label null", knowledgeSourceLabel(null), "No match");

  return { passed, failed };
}
