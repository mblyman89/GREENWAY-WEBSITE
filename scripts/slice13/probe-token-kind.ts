/**
 * scripts/slice13/probe-token-kind.ts
 *
 * MEASUREMENT, NOT ASSUMPTION.
 *
 * Three assertions in tests/compliance/slice13-inventory-filtering.test.ts were
 * written from expectation rather than measurement. Standing rule: "do not
 * guess, do not assume. we build from fact, not memory." This probe prints the
 * ACTUAL return shape and values of scoreTokenInField so the test can pin what
 * the code really does.
 */
import {
  scoreTokenInField,
  TOKEN_MATCH_SCORE,
  FUZZY_MIN_TOKEN_LENGTH,
} from "../../src/lib/inventory/inventory-search-core";

function show(token: string, field: string, allowFuzzy: boolean) {
  const r = scoreTokenInField(token, field, allowFuzzy);
  console.log(
    `scoreTokenInField(${JSON.stringify(token)}, ${JSON.stringify(field)}, ${allowFuzzy}) ` +
      `=> ${JSON.stringify(r)}   typeof=${typeof r}`,
  );
}

console.log(`FUZZY_MIN_TOKEN_LENGTH = ${FUZZY_MIN_TOKEN_LENGTH}`);
console.log(`TOKEN_MATCH_SCORE = ${JSON.stringify(TOKEN_MATCH_SCORE)}`);
console.log("");

console.log("--- the short-token question the failing test was asking ---");
show("og", "og kush", true);
show("og", "blue og kush", true);
show("kush", "og kush", true);
show("xq", "blue dream", true);

console.log("");
console.log("--- is fuzzy really refused below FUZZY_MIN_TOKEN_LENGTH? ---");
// "dre" vs "dream" is a substring, so it can't prove the guard. Use a token
// that is NOT a substring and IS short: "grn" vs "green".
show("grn", "green apple", true);
show("gren", "green apple", true); // 4 chars = at the boundary
show("dreem", "blue dream", true); // 5 chars, a real typo
show("dreem", "blue dream", false); // fuzzy switched OFF

console.log("");
console.log("--- the whole ladder, one demonstrative case each ---");
show("blue dream", "blue dream", true); // exact
show("blue", "blue dream", true); // prefix
show("dream", "blue dream", true); // word-prefix
show("ream", "blue dream", true); // substring (genuine mid-word)
show("gg4", "gg 4 preroll", true); // squashed substring
show("weding", "wedding cake", true); // fuzzy
show("zebra", "blue dream", true); // null
