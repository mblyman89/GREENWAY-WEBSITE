/**
 * src/lib/ai/kb/kb-notes-core.ts  (Slice 75 — item 14: KB owner uploads)
 *
 * PURE logic for owner-uploaded reference notes: tag normalization, matching a
 * note to a product's facts, and trimming a note body to a prompt-safe length.
 * No I/O, no server-only imports — unit-testable with tsx.
 *
 * A note is either GENERAL (no tags → applies to every product) or TARGETED
 * (has tags → applies only when one of its tags appears in the product's
 * strain / category / brand / vendor / name). Everything is lowercased and
 * whitespace-collapsed so owner-typed tags interoperate with our slugs.
 */

/** Normalize a free-text token the same way the rest of the KB does. */
export function normToken(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Split a comma/newline separated tag string into clean, de-duped tags. */
export function parseTags(raw: string | null | undefined): string[] {
  const parts = (raw ?? "")
    .split(/[,\n]/)
    .map((t) => normToken(t))
    .filter((t) => t.length > 0);
  return Array.from(new Set(parts));
}

/** The subset of product facts a note is matched against. */
export type NoteMatchFacts = {
  name?: string | null;
  strainName?: string | null;
  strainSlug?: string | null;
  category?: string | null;
  brand?: string | null;
  vendor?: string | null;
};

/** A note as stored (subset used for matching + rendering). */
export type KbNote = {
  id: string;
  title: string;
  body: string;
  tags: string[];
  source?: string | null;
  active?: boolean;
};

/**
 * Build the searchable haystack for a product from its facts. Used to test
 * whether a targeted note's tag applies.
 */
export function factsHaystack(facts: NoteMatchFacts): string {
  return [
    facts.name,
    facts.strainName,
    facts.strainSlug,
    facts.category,
    facts.brand,
    facts.vendor,
  ]
    .map((f) => normToken(f))
    .filter(Boolean)
    .join(" | ");
}

/**
 * Does a single note apply to a product?
 *   - A note with NO tags is general → always applies.
 *   - A note with tags applies if ANY tag is found in the product haystack.
 * Tags shorter than 2 chars are ignored to avoid noise matches.
 */
export function noteApplies(note: KbNote, facts: NoteMatchFacts): boolean {
  if (note.active === false) return false;
  const tags = (note.tags ?? []).map(normToken).filter((t) => t.length >= 2);
  if (tags.length === 0) return true; // general note
  const hay = factsHaystack(facts);
  if (!hay) return false;
  return tags.some((t) => hay.includes(t));
}

/**
 * Select the notes that apply to a product, capped at `max`. Targeted notes
 * (with tags) are prioritized over general ones, because a note the owner
 * bothered to target is more specific/relevant. Ties keep input order.
 */
export function selectApplicableNotes(
  notes: KbNote[],
  facts: NoteMatchFacts,
  max = 4,
): KbNote[] {
  const applicable = notes.filter((n) => noteApplies(n, facts));
  const targeted = applicable.filter((n) => (n.tags ?? []).some((t) => normToken(t).length >= 2));
  const general = applicable.filter((n) => !targeted.includes(n));
  return [...targeted, ...general].slice(0, Math.max(0, max));
}

/** Collapse a note body to a single tidy line, trimmed to `maxLen` chars. */
export function trimNoteBody(body: string | null | undefined, maxLen = 400): string {
  const oneLine = (body ?? "").replace(/\s+/g, " ").trim();
  if (oneLine.length <= maxLen) return oneLine;
  return `${oneLine.slice(0, maxLen - 1).trimEnd()}…`;
}

/**
 * Render the applicable notes as grounded-fact lines the prompt builder can
 * splice in. Returns { lines, sources } — sources use the `kb:note:<id>`
 * convention so provenance stays consistent with the rest of retrieval.
 */
export function renderNoteFacts(
  notes: KbNote[],
  facts: NoteMatchFacts,
  max = 4,
): { lines: string[]; sources: string[] } {
  const selected = selectApplicableNotes(notes, facts, max);
  const lines: string[] = [];
  const sources: string[] = [];
  for (const n of selected) {
    const body = trimNoteBody(n.body);
    if (!body) continue;
    const title = (n.title ?? "").trim();
    lines.push(title ? `${title}: ${body}` : body);
    sources.push(`kb:note:${n.id}`);
  }
  return { lines, sources };
}

/** Validate an owner note-upload form. Returns cleaned values or an error. */
export type NoteInput = { title: string; body: string; tags: string[]; source: string | null };

export function validateNoteInput(input: {
  title?: string | null;
  body?: string | null;
  tags?: string | null;
  source?: string | null;
}): { ok: true; value: NoteInput } | { ok: false; error: string } {
  const title = (input.title ?? "").trim();
  const body = (input.body ?? "").trim();
  if (title.length === 0) return { ok: false, error: "A title is required." };
  if (title.length > 120) return { ok: false, error: "Keep the title under 120 characters." };
  if (body.length === 0) return { ok: false, error: "The note body can't be empty." };
  if (body.length > 4000) return { ok: false, error: "Keep the note under 4000 characters." };
  const source = (input.source ?? "").trim();
  return {
    ok: true,
    value: {
      title,
      body,
      tags: parseTags(input.tags),
      source: source.length ? source : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Self-tests (run via tsx from a throwaway harness).
// ---------------------------------------------------------------------------
export function __runKbNotesTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL:", msg);
    }
  };

  // normToken / parseTags
  ok(normToken("  Blue   Dream ") === "blue dream", "normToken collapses");
  ok(parseTags("Blue Dream, gelato\nOG Kush").join("|") === "blue dream|gelato|og kush", "parseTags splits+norm");
  ok(parseTags("a, a, b").join("|") === "a|b", "parseTags dedupes");
  ok(parseTags("").length === 0, "parseTags empty");

  const general: KbNote = { id: "g1", title: "House style", body: "Warm, expert, never medical.", tags: [] };
  const targeted: KbNote = { id: "t1", title: "Gelato line", body: "Emphasize the creamy dessert angle.", tags: ["gelato"] };
  const brandNote: KbNote = { id: "b1", title: "Constellation", body: "Premium small-batch feel.", tags: ["constellation cannabis"] };

  const gelatoFacts: NoteMatchFacts = { name: "Gelato #33 Eighth", category: "flower", brand: "House" };
  const flowerFacts: NoteMatchFacts = { name: "Random OG Eighth", category: "flower", brand: "Constellation Cannabis" };

  // noteApplies
  ok(noteApplies(general, gelatoFacts), "general applies to anything");
  ok(noteApplies(targeted, gelatoFacts), "gelato note applies to gelato product");
  ok(!noteApplies(targeted, flowerFacts), "gelato note does NOT apply to non-gelato");
  ok(noteApplies(brandNote, flowerFacts), "brand note matches on brand");
  ok(!noteApplies({ ...targeted, active: false }, gelatoFacts), "inactive note never applies");
  // A note whose only tag is < 2 chars has no usable tags → treated as general.
  ok(noteApplies({ ...targeted, tags: ["a"] }, gelatoFacts) === true, "sub-2-char-only tags behave as general");

  // selectApplicableNotes: targeted first
  const sel = selectApplicableNotes([general, targeted], gelatoFacts, 4);
  ok(sel.length === 2 && sel[0].id === "t1", "targeted prioritized before general");
  const selFlower = selectApplicableNotes([general, targeted], flowerFacts, 4);
  ok(selFlower.length === 1 && selFlower[0].id === "g1", "only general applies to flower");
  ok(selectApplicableNotes([general, targeted], gelatoFacts, 1).length === 1, "max cap honored");

  // trimNoteBody
  ok(trimNoteBody("  a\n b  ") === "a b", "trim collapses whitespace");
  const long = "x".repeat(500);
  const trimmed = trimNoteBody(long, 100);
  ok(trimmed.length === 100 && trimmed.endsWith("…"), "trim caps length with ellipsis");

  // renderNoteFacts
  const rendered = renderNoteFacts([general, targeted], gelatoFacts, 4);
  ok(rendered.lines.length === 2, "render two lines");
  ok(rendered.lines[0].startsWith("Gelato line:"), "render titled line");
  ok(rendered.sources[0] === "kb:note:t1", "render provenance source");

  // validateNoteInput
  const bad1 = validateNoteInput({ title: "", body: "x" });
  ok(!bad1.ok, "empty title rejected");
  const bad2 = validateNoteInput({ title: "t", body: "" });
  ok(!bad2.ok, "empty body rejected");
  const good = validateNoteInput({ title: " Note ", body: " Some text ", tags: "gelato, gsc", source: " Leafly " });
  ok(good.ok && good.value.title === "Note" && good.value.tags.join("|") === "gelato|gsc" && good.value.source === "Leafly", "valid input cleaned");

  console.log(`kb-notes-core: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
