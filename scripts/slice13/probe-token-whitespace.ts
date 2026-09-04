/**
 * scripts/slice13/probe-token-whitespace.ts
 *
 * The subsumption proof in probe-substring-subsumption.ts showed the plain
 * substring rung and the glue-insensitive rung below it disagree on EXACTLY
 * ONE class of input: a whitespace-only token (804 of 44,044 pairs, and zero
 * disagreements once the token carries any real character).
 *
 * So the equivalence holds IF AND ONLY IF a whitespace-only token can never
 * reach scoreTokenInField. That is a claim about the CALLERS, and claims get
 * measured, not assumed. This probe hammers the tokenizer with whitespace of
 * every kind and reports any token that is empty or blank.
 */
import { searchTokens, normalizeSearchText, scoreTokenInField } from "../../src/lib/inventory/inventory-search-core";

const NASTY = [
  "",
  " ",
  "   ",
  "\t",
  "\n",
  "\r\n",
  "\u00a0", // non-breaking space
  "\u2009", // thin space
  "\u3000", // ideographic space
  "  blue   dream  ",
  "blue\tdream",
  "blue\n\ndream",
  "blue \u00a0 dream",
  "   \t\n   ",
  "-",
  "--",
  " - - ",
  "blue - dream",
  "3.5g",
  "400mg",
  "Cantina Gummies - Guava 10 Pack 400mg",
  "Grow Op Farms, LLC",
  ",,,",
  "()[]{}",
  "%%%",
  "blue,dream",
];

let bad = 0;
let totalTokens = 0;

for (const raw of NASTY) {
  const toks = searchTokens(raw);
  totalTokens += toks.length;
  const offenders = toks.filter((t) => t.trim() === "");
  if (offenders.length > 0) {
    bad++;
    console.log(`OFFENDER  input=${JSON.stringify(raw)} -> ${JSON.stringify(toks)}`);
  } else {
    console.log(
      `ok  input=${JSON.stringify(raw)} -> ${JSON.stringify(toks)}  (normalized=${JSON.stringify(normalizeSearchText(raw))})`,
    );
  }
}

console.log("");
console.log(`inputs=${NASTY.length}  tokens produced=${totalTokens}  whitespace-only tokens=${bad}`);
console.log("");

// And the guard itself: even IF one leaked through, the function's own first
// line refuses it. Belt and braces \u2014 measure that too.
console.log("direct guard behaviour:");
for (const t of ["", " ", "   "]) {
  console.log(
    `  scoreTokenInField(${JSON.stringify(t)}, "blue dream", true) = ${JSON.stringify(
      scoreTokenInField(t, "blue dream", true),
    )}`,
  );
}
