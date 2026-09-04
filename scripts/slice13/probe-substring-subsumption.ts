/**
 * scripts/slice13/probe-substring-subsumption.ts
 *
 * WHY THIS EXISTS.
 *
 * The mutation run (scripts/slice13/mutate.sh) produced exactly one survivor:
 * disabling the plain substring rung
 *
 *     if (fieldText.includes(token)) return "substring";
 *
 * left every test passing. That is either a TEST GAP or an EQUIVALENT MUTANT,
 * and the difference matters enormously. A test gap means the owner's
 * headline requirement ("find it even if my search is a MIDDLE PART") is
 * unprotected. An equivalent mutant means the line is subsumed by the
 * glue-insensitive rung immediately below it:
 *
 *     const squashedField = fieldText.replace(/ /g, "");
 *     const squashedToken = token.replace(/ /g, "");
 *     if (squashedToken && squashedField.includes(squashedToken)) return "substring";
 *
 * Standing rule: "do not guess, do not assume. we build from fact, not
 * memory." So this probe does not reason about it. It BRUTE-FORCES every
 * (field, token) pair over a small alphabet that includes the space (the only
 * character the two rungs treat differently) and reports every input where the
 * two versions disagree.
 *
 * Exhaustive over |alphabet|=3, field length <= 5, token length <= 4:
 * that is every structural arrangement of letters and spaces the two
 * predicates can distinguish.
 */

const ALPHABET = ["a", "b", " "];

function strings(maxLen: number): string[] {
  const out: string[] = [""];
  let frontier = [""];
  for (let len = 1; len <= maxLen; len++) {
    const next: string[] = [];
    for (const s of frontier) for (const c of ALPHABET) next.push(s + c);
    out.push(...next);
    frontier = next;
  }
  return out;
}

/** The rung under test, in isolation. */
function withPlainRung(fieldText: string, token: string): string | null {
  if (fieldText.includes(token)) return "substring";
  const squashedField = fieldText.replace(/ /g, "");
  const squashedToken = token.replace(/ /g, "");
  if (squashedToken && squashedField.includes(squashedToken)) return "substring";
  return null;
}

/** The same code with the plain rung removed \u2014 i.e. the mutant. */
function withoutPlainRung(fieldText: string, token: string): string | null {
  const squashedField = fieldText.replace(/ /g, "");
  const squashedToken = token.replace(/ /g, "");
  if (squashedToken && squashedField.includes(squashedToken)) return "substring";
  return null;
}

const fields = strings(5);
const tokens = strings(4);

let compared = 0;
const disagreements: Array<{ field: string; token: string; a: string | null; b: string | null }> = [];

for (const f of fields) {
  for (const t of tokens) {
    compared++;
    const a = withPlainRung(f, t);
    const b = withoutPlainRung(f, t);
    if (a !== b) disagreements.push({ field: f, token: t, a, b });
  }
}

console.log(`compared ${compared} (field, token) pairs over alphabet ${JSON.stringify(ALPHABET)}`);
console.log(`disagreements: ${disagreements.length}`);
console.log("");

// Group the disagreements by shape so the RULE is visible, not just examples.
const shapes = new Map<string, number>();
for (const d of disagreements) {
  const shape =
    d.token.trim() === ""
      ? "token is whitespace-only"
      : d.token.includes(" ")
        ? "token contains a space"
        : "other";
  shapes.set(shape, (shapes.get(shape) ?? 0) + 1);
}
for (const [shape, n] of shapes) console.log(`  ${n.toString().padStart(5)}  ${shape}`);
console.log("");

console.log("first 12 disagreeing inputs:");
for (const d of disagreements.slice(0, 12)) {
  console.log(
    `  field=${JSON.stringify(d.field)} token=${JSON.stringify(d.token)} ` +
      `original=${JSON.stringify(d.a)} mutant=${JSON.stringify(d.b)}`,
  );
}
console.log("");

// The specific question that decides how to close the survivor: is there ANY
// disagreement where the token carries real (non-space) content?
const meaningful = disagreements.filter((d) => d.token.trim() !== "");
console.log(`disagreements with a NON-whitespace token: ${meaningful.length}`);
for (const d of meaningful.slice(0, 12)) {
  console.log(
    `  field=${JSON.stringify(d.field)} token=${JSON.stringify(d.token)} ` +
      `original=${JSON.stringify(d.a)} mutant=${JSON.stringify(d.b)}`,
  );
}
