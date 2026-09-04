/**
 * tests/compliance/classification-memory-plumbing.test.ts  (SLICE 18F)
 *
 * The pure core (classification-memory-core.ts) is proven behaviourally in
 * classification-memory.test.ts. A pure core nobody calls, or calls WRONGLY,
 * fixes nothing -- SLICE 18E's Defect 3 was exactly that shape: correct policy
 * that two DB-boundary mappers silently dropped on the floor.
 *
 * So this file guards the LAYERS THE PURE TESTS CANNOT REACH:
 *
 *   1. the store read actually selects the columns the memory needs;
 *   2. the approval card actually pre-fills, and keeps `required`;
 *   3. the write path re-derives provenance SERVER-SIDE and never trusts
 *      the form to claim "this was remembered";
 *   4. Option B is not quietly downgraded to Option C (auto-apply).
 *
 * These read source on purpose. A behavioural test can only prove things
 * about code as it is TODAY; these are aimed at a future edit. Every needle
 * below is chosen so that the assertion fails LOUDLY if the wiring is removed,
 * and each states the consequence of the regression it is preventing.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const STORE = "src/lib/inventory/catalog-drafts.ts";
const PAGE = "src/app/admin/inventory/drafts/page.tsx";
const CORE = "src/lib/inventory/classification-memory-core.ts";
const SELFTESTS = "scripts/compliance/run-pure-selftests.ts";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

/**
 * Extract a function body by brace-balancing from a signature. Substring
 * matching across a 900-line file would let an assertion pass because of code
 * in an unrelated function -- a survivor we already paid for once in 18G.
 */
function bodyAfter(source: string, signature: string): string {
  const start = source.indexOf(signature);
  if (start === -1) throw new Error(`signature not found: ${signature}`);

  // Find the START OF THE BODY, not merely the next "{".
  //
  // `approveDraftWithPrice` declares an inline object type in its parameter
  // list, so the first "{" after the signature opens a TYPE, not the body.
  // Scoping to that type would make every assertion below vacuously false
  // while looking like a real failure. Walk the parameter parens to their
  // balanced close first, then take the "{" that follows.
  const parenOpen = source.indexOf("(", start);
  if (parenOpen === -1) throw new Error(`no parameter list for: ${signature}`);
  let parenDepth = 0;
  let parenClose = -1;
  for (let i = parenOpen; i < source.length; i++) {
    if (source[i] === "(") parenDepth++;
    else if (source[i] === ")") {
      parenDepth--;
      if (parenDepth === 0) {
        parenClose = i;
        break;
      }
    }
  }
  if (parenClose === -1) throw new Error(`unbalanced parameters for: ${signature}`);

  // Now skip the RETURN TYPE annotation. `approveDraftWithPrice` is declared
  // `): Promise<{ ok: boolean; error?: string }> {`, so the first "{" after the
  // parameters opens a generic type argument, not the body. Walking angle
  // brackets is safe here because only type syntax can appear between the
  // parameter list and the body. `=>` is excluded so an arrow inside a
  // function-typed return annotation cannot close a depth we never opened.
  let angleDepth = 0;
  let open = -1;
  for (let i = parenClose + 1; i < source.length; i++) {
    const ch = source[i];
    if (ch === "<") angleDepth++;
    else if (ch === ">") {
      if (source[i - 1] !== "=") angleDepth--;
    } else if (ch === "{" && angleDepth === 0) {
      open = i;
      break;
    }
  }
  if (open === -1) throw new Error(`no body for: ${signature}`);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced body for: ${signature}`);
}

/** Scope to a single PostgREST query chain, `.from("<table>")` .. `;`. */
function queryChainFor(body: string, table: string): string {
  const marker = `.from("${table}")`;
  const at = body.indexOf(marker);
  if (at === -1) throw new Error(`no query on table: ${table}`);
  const end = body.indexOf(";", at);
  return body.slice(at, end === -1 ? body.length : end + 1);
}

/** Executable lines only -- a needle inside a comment proves nothing. */
function executable(source: string): string {
  return source
    .split("\n")
    .filter((ln) => {
      const t = ln.trim();
      return t !== "" && !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

// ===========================================================================
describe("SLICE 18F: the store read supplies what the memory key needs", () => {
  const store = read(STORE);

  it("listPriorClassifications selects every field the recall depends on", () => {
    const body = bodyAfter(store, "export async function listPriorClassifications");
    const chain = queryChainFor(body, "catalog_product_drafts");
    // The memory key is rebuilt from IDENTITY, because pos_product_key is
    // `sku ?? lot_code` and changes between deliveries. Drop any one of these
    // and the key silently changes shape -- the memory would simply never
    // match, which LOOKS like "this product was never classified".
    for (const column of [
      "name",
      "brand_name",
      "vendor_name",
      "category",
      "chosen_otherwise_taken",
      "chosen_units_per_package",
      "chosen_classification_provenance",
      "updated_at",
      "updated_by",
    ]) {
      expect(
        chain.includes(column),
        `listPriorClassifications must select ${column}: without it the memory ` +
          `key or the recallability check changes meaning, and a product that ` +
          `WAS classified would silently look unclassified.`,
      ).toBe(true);
    }
  });

  it("only APPROVED drafts are treated as prior decisions", () => {
    const body = bodyAfter(store, "export async function listPriorClassifications");
    // A row still sitting in `draft` is an unfinished thought, not a decision.
    expect(body).toContain('.eq("status", "approved")');
  });

  it("the read is READ-ONLY -- a lookup must never write", () => {
    const body = executable(bodyAfter(store, "export async function listPriorClassifications"));
    // Needles are assembled, not written literally, so this test cannot match
    // its own source text.
    for (const op of ["update", "insert", "upsert", "delete", "rpc"]) {
      expect(body.includes(`.${op}(`), `listPriorClassifications must not call .${op}()`).toBe(false);
    }
  });

  it("maps the prior row with ?? and never with || (a human's false must live)", () => {
    const body = executable(bodyAfter(store, "export async function listPriorClassifications"));
    for (const field of ["chosen_otherwise_taken", "chosen_low_thc_liquid"]) {
      expect(
        body.includes(`${field} ||`),
        `${field} must not be coalesced with || -- a human's literal false is a ` +
          `real answer ("no, not a suppository") and || would erase it, so the ` +
          `product would be re-asked forever.`,
      ).toBe(false);
    }
  });
});

// ===========================================================================
describe("SLICE 18F: the approval card actually uses the memory", () => {
  const page = read(PAGE);

  it("calls the recall and the prefill", () => {
    const exec = executable(page);
    expect(exec).toContain("recallClassification(");
    expect(exec).toContain("prefillFromMemory(");
  });

  it("pre-fills the otherwise-taken picker from memory, not from a blank", () => {
    const exec = executable(page);
    expect(
      exec.includes("defaultValue={prefill.otherwiseTaken}"),
      "the picker must be pre-filled from the remembered answer; a hard-coded " +
        'defaultValue="" is the defect this slice fixes.',
    ).toBe(true);
  });

  it("KEEPS the pick required -- Option B, never Option C", () => {
    // If `required` is ever dropped from this control, a fail-permissive
    // statutory gate has been weakened to a suggestion.
    //
    // MUTATION-TESTING NOTE (18F). This originally scanned a 600-character
    // window after `name="otherwise_taken"`. A character window is the wrong
    // instrument twice over: it can spill into a NEIGHBOURING control and pass
    // on that control's `required`, and it can be satisfied by the word
    // "required" appearing in PROSE -- there is a comment thirty lines below
    // reading "PROMPTED, never required". Scope to the element's OPENING TAG
    // and to executable lines only, so nothing but this control can satisfy it.
    const at = page.indexOf('name="otherwise_taken"');
    expect(at, 'the otherwise_taken control must exist').toBeGreaterThan(-1);

    // Walk back to the start of the JSX element, forward to the end of its
    // opening tag. Attributes of this control, and nothing else.
    const tagStart = page.lastIndexOf("<", at);
    const tagEnd = page.indexOf(">", at);
    expect(tagEnd).toBeGreaterThan(tagStart);
    const openingTag = executable(page.slice(tagStart, tagEnd));

    expect(
      /(^|\s)required(\s|$|=)/.test(openingTag),
      "the otherwise_taken pick must stay required: pre-filling saves the " +
        "typing, never the decision. Option B, never Option C.\n" +
        `opening tag was:\n${openingTag}`,
    ).toBe(true);

    // And it must be pre-filled on the SAME control -- proving the two
    // properties hold together, not in two different elements.
    expect(openingTag).toContain("defaultValue={prefill.otherwiseTaken}");
  });

  it("labels a remembered pre-fill instead of filling it silently", () => {
    const exec = executable(page);
    expect(exec).toContain("describeMemory(");
    expect(exec).toContain("prefill.isRemembered");
  });
});

// ===========================================================================
describe("SLICE 18F: provenance is re-derived server-side, never trusted", () => {
  const store = read(STORE);
  const body = bodyAfter(store, "export async function approveDraftWithPrice");

  it("the approval recomputes the recall itself", () => {
    expect(
      body.includes("recallClassification("),
      "approveDraftWithPrice must re-derive the memory server-side; trusting a " +
        "form field that claims 'this was remembered' would let a client " +
        "launder a fresh guess into a value that reads as corroborated.",
    ).toBe(true);
  });

  it("never reads a `remembered` claim off the submitted form", () => {
    const exec = executable(body);
    for (const spoof of [
      'formData.get("remembered")',
      'get("was_remembered")',
      "classification?.remembered",
      "classification?.wasRemembered",
    ]) {
      expect(exec.includes(spoof), `the form must not be able to assert provenance (${spoof})`).toBe(
        false,
      );
    }
  });

  it("only upgrades to `remembered` when the human's answer MATCHES the memory", () => {
    // If the approver changed the answer, that is a fresh decision about a
    // product whose formulation may have changed. Crediting it to a prior
    // decision that in fact DISAGREED would be a false audit trail.
    const exec = executable(body);
    expect(exec).toContain("remembered.otherwiseTaken === compliance.otherwiseTaken");
  });

  it("writes the provenance it computed, not the raw one, when remembering", () => {
    const exec = executable(body);
    expect(exec).toContain("update.chosen_classification_provenance = classificationProvenance");
  });

  it("still writes otherwise_taken on EVERY approval (18-0 invariant intact)", () => {
    // 18-0's guarantee: an approved product always carries a definite answer,
    // so the ten-unit limit can never fail to engage because a box was blank.
    const exec = executable(body);
    expect(exec).toContain("update.chosen_otherwise_taken = compliance.otherwiseTaken");
  });
});

// ===========================================================================
describe("SLICE 18F: the vocabulary grew without being rewritten", () => {
  it("the memory core spreads the 18-0 vocabulary rather than redeclaring it", () => {
    const core = read(CORE);
    // Two hand-maintained copies of a provenance vocabulary WILL drift, and a
    // drifted vocabulary silently reinterprets rows already written.
    expect(core).toContain("...RECEIVING_CLASSIFICATION_PROVENANCE");
  });

  it("does not redefine any of the three ratified values", () => {
    const core = executable(read(CORE));
    for (const redefinition of ['human: "', 'machine: "', 'unanswered: "']) {
      expect(
        core.includes(redefinition),
        `the memory core must not redeclare ${redefinition} -- 0218's column ` +
          `comment enumerates this vocabulary and every row already written ` +
          `depends on the existing meanings.`,
      ).toBe(false);
    }
  });

  it("the pure self-test is registered so CI runs it", () => {
    const runner = read(SELFTESTS);
    expect(runner).toContain("__runClassificationMemoryTests");
    // Registered AND invoked -- an import alone runs nothing.
    expect(runner).toContain("__runClassificationMemoryTests()");
  });
});

// ===========================================================================
// TESTING THE TEST. Every assertion in this file is only as trustworthy as
// `bodyAfter`. It already lied once during this slice: it returned the inline
// parameter TYPE of `approveDraftWithPrice` instead of the body, which turned
// four real, passing behaviours into four red failures. A source-reading
// harness that scopes to the wrong region fails in BOTH directions -- it can
// also pass vacuously, which is the silent one. So the extractor is pinned
// against the two signature shapes this repo actually contains.
describe("SLICE 18F: the source-reading harness itself is correct", () => {
  const store = read(STORE);

  it("returns the BODY, not the inline parameter type", () => {
    // `approveDraftWithPrice(draftId, priceMinor, actorId, classification?: {...})`
    // -- the first "{" after the name opens a type.
    const body = bodyAfter(store, "export async function approveDraftWithPrice");
    expect(body).not.toContain("chosenWebsiteCategory?: string | null;");
    expect(body).toContain("createSupabaseAdminClient()");
  });

  it("returns the BODY, not the return-type generic", () => {
    // `): Promise<{ ok: boolean; error?: string }> {` -- the "{" inside the
    // generic is not the body either.
    const body = bodyAfter(store, "export async function approveDraftWithPrice");
    expect(body.startsWith("{ ok: boolean")).toBe(false);
    expect(body).toContain("update.chosen_otherwise_taken");
  });

  it("is brace-balanced and stops at the end of the function", () => {
    const body = bodyAfter(store, "export async function listPriorClassifications");
    let depth = 0;
    for (const ch of body) {
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
    }
    expect(depth).toBe(0);
    // Scoped: it must NOT bleed into the next exported function, or a needle
    // could be satisfied by unrelated code further down a 900-line file.
    expect(body).not.toContain("export async function approveDraftWithPrice");
  });

  it("throws loudly rather than returning nothing when a signature moves", () => {
    // A renamed function must break the suite, not quietly scope to "".
    expect(() => bodyAfter(store, "export async function thisDoesNotExist")).toThrow(
      /signature not found/,
    );
  });

  it("executable() strips comments so a needle in prose cannot pass", () => {
    const stripped = executable(["// update.chosen_otherwise_taken = x", "const y = 1;"].join("\n"));
    expect(stripped).not.toContain("chosen_otherwise_taken");
    expect(stripped).toContain("const y = 1;");
  });

  it("queryChainFor scopes to one table's chain", () => {
    const chain = queryChainFor(
      'a.from("other").select("nope");\nb.from("wanted").select("yes");',
      "wanted",
    );
    expect(chain).toContain("yes");
    expect(chain).not.toContain("nope");
  });
});
