// Leafly Menu Integration API v2.0 — REMOVING ITEMS, ON PURPOSE AND ONLY ON PURPOSE.
//
// ###########################################################################
// # WHY THIS FILE EXISTS                                                    #
// #                                                                         #
// # Leafly's certification checklist asks to see three verbs in an          #
// # integration's request log:                                              #
// #                                                                         #
// #   POST   - full menu, once a day                                        #
// #   PUT    - individual item updates                                      #
// #   DELETE - removal of items from Leafly menus                           #
// #                                                                         #
// # `deleteLeaflyItems()` has existed in push.ts for some time and issues a #
// # correct DELETE. But a grep across every .ts and .tsx file in the repo   #
// # found NO caller anywhere in the admin UI. The capability was built and  #
// # then never given a button, so in practice the owner could not remove an #
// # item from Leafly at all, and could not produce the DELETE traffic that  #
// # certification requires.                                                 #
// #                                                                         #
// # This module is the safety layer between a text box and an irreversible  #
// # action against a live public menu.                                      #
// #                                                                         #
// # WHY A WHOLE MODULE FOR "SPLIT A STRING ON COMMAS"                       #
// #                                                                         #
// # Because the failure modes are asymmetric and severe. Getting a DELETE   #
// # wrong does not show a red box; it removes real products from a public   #
// # menu, and the only way to notice is for a customer not to find          #
// # something. Specifically:                                                #
// #                                                                         #
// #   - A stray blank line must not become a delete for "".                 #
// #   - A duplicated id must not be sent twice.                             #
// #   - A pasted spreadsheet column arrives with quotes and trailing        #
// #     commas; those are punctuation, not part of the id.                  #
// #   - A typo'd id that matches nothing must be REPORTED, not silently     #
// #     succeed. "200 OK, deleted 0 items" reads as success and is how      #
// #     somebody concludes the feature works when it never touched          #
// #     anything.                                                           #
// #   - An empty request must be refused outright rather than sent as       #
// #     `{ ids: [] }`, which is a live API call that accomplishes nothing.  #
// #                                                                         #
// # Every one of those is a data decision, which means it can be made pure  #
// # and tested exhaustively rather than discovered against Leafly's         #
// # production menu.                                                        #
// ###########################################################################
//
// GROUND TRUTH
// ------------
// docs/leafly-specs/menu-integration-v2.openapi.json
//   - the DELETE operation takes `{ "ids": [...] }`
//   - "Inventory Management: `items[].variants[]` must contain at least one
//     entry in `POST` and `PUT requests`. Thus it is no longer possible to
//     delete menu items by submitting an empty array of `variants[]`. Use the
//     `DELETE` method instead."  <- deleting is DELETE-only in v2
//
// PURITY
// ------
// Zero imports. Pure. Runs under plain `tsx`.

/* -------------------------------------------------------------------------- */
/* Limits                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The most ids one request may carry.
 *
 * A cap exists because this is a text box, and a text box is one bad paste
 * away from carrying the entire catalogue. Removing the whole menu is a
 * legitimate thing to want and an illegitimate thing to do by accident, so
 * past this point the owner has to do it in batches — which is friction, and
 * friction is the correct response to an irreversible bulk action.
 */
export const MAX_DELETE_IDS = 200;

/** Longest plausible item id. Anything past this is a paste accident. */
export const MAX_DELETE_ID_LENGTH = 128;

/* -------------------------------------------------------------------------- */
/* Parsing                                                                    */
/* -------------------------------------------------------------------------- */

export type DeleteIdProblem =
  /** Nothing usable in the input at all. */
  | "empty"
  /** More ids than MAX_DELETE_IDS. */
  | "too_many"
  /** At least one id was longer than MAX_DELETE_ID_LENGTH. */
  | "id_too_long";

export type ParsedDeleteRequest = {
  /** Clean, de-duplicated, order-preserving ids, ready to send. */
  ids: string[];
  /** Ids that appeared more than once. Reported, not an error. */
  duplicates: string[];
  /** Entries rejected for being unusable, with the raw text. */
  rejected: { raw: string; reason: "too_long" }[];
  /** Blocking problems. Empty means the request may proceed. */
  problems: DeleteIdProblem[];
  ok: boolean;
};

/**
 * Turn whatever the owner typed or pasted into a safe list of ids.
 *
 * Accepts commas, newlines, semicolons, tabs and spaces as separators, because
 * a person pasting from a spreadsheet, a log line or an email should not have
 * to think about which one they got. Strips surrounding quotes for the same
 * reason.
 *
 * Order is preserved and duplicates are removed keeping the FIRST occurrence,
 * so the list the owner sees echoed back matches the order they wrote it in.
 */
export function parseDeleteIds(raw: string | null | undefined): ParsedDeleteRequest {
  const text = raw == null ? "" : String(raw);

  const tokens = text
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    // Strip matched or stray surrounding quotes — a spreadsheet paste brings
    // them along and they are punctuation, not part of the id.
    .map((t) => t.replace(/^["'`]+/, "").replace(/["'`]+$/, ""))
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  const seen = new Set<string>();
  const ids: string[] = [];
  const duplicates: string[] = [];
  const rejected: { raw: string; reason: "too_long" }[] = [];

  for (const t of tokens) {
    if (t.length > MAX_DELETE_ID_LENGTH) {
      rejected.push({ raw: t, reason: "too_long" });
      continue;
    }
    if (seen.has(t)) {
      if (!duplicates.includes(t)) duplicates.push(t);
      continue;
    }
    seen.add(t);
    ids.push(t);
  }

  const problems: DeleteIdProblem[] = [];
  if (ids.length === 0) problems.push("empty");
  if (ids.length > MAX_DELETE_IDS) problems.push("too_many");
  if (rejected.length > 0) problems.push("id_too_long");

  return { ids, duplicates, rejected, problems, ok: problems.length === 0 };
}

/** Plain-English refusal, or null when the request is fine. */
export function describeDeleteProblems(parsed: ParsedDeleteRequest): string | null {
  if (parsed.ok) return null;
  const parts: string[] = [];
  if (parsed.problems.includes("empty")) {
    parts.push("No product IDs were entered, so there is nothing to remove.");
  }
  if (parsed.problems.includes("too_many")) {
    parts.push(
      `${parsed.ids.length} IDs were entered, which is more than the ${MAX_DELETE_IDS} allowed ` +
        `in one go. Removing products cannot be undone, so large removals have to be done in ` +
        `batches on purpose rather than in one paste.`,
    );
  }
  if (parsed.problems.includes("id_too_long")) {
    parts.push(
      `${parsed.rejected.length} entr${parsed.rejected.length === 1 ? "y was" : "ies were"} too ` +
        `long to be a product ID. This usually means a whole line was pasted instead of just ` +
        `the ID.`,
    );
  }
  return parts.join(" ");
}

/* -------------------------------------------------------------------------- */
/* Reconciling what we asked for against what actually went                   */
/* -------------------------------------------------------------------------- */

/**
 * Did the delete do what the owner asked?
 *
 * The important case: ids that are not on the Leafly menu. Leafly answers a
 * DELETE for an unknown id with a perfectly cheerful success, because from
 * their side the desired end state — that item is not on the menu — is already
 * true. That is reasonable of them and dangerous for us, because "success" is
 * then indistinguishable from "your typo did nothing".
 *
 * `known` is the set of ids we believe are live (from our own sync state or a
 * readback). When it is supplied, ids outside it are flagged. When it is not
 * supplied we say nothing, because a guess about which ids exist is worse than
 * silence.
 */
export type DeleteReconciliation = {
  requested: string[];
  /** Requested ids we have no record of ever sending. Likely typos. */
  unknown: string[];
  /** Requested ids we do have a record of. These are the real removals. */
  recognised: string[];
  /** Null when `known` was not supplied — we decline to guess. */
  checked: boolean;
};

export function reconcileDeleteRequest(
  requested: readonly string[],
  known: ReadonlySet<string> | null | undefined,
): DeleteReconciliation {
  const req = [...requested];
  if (known == null) {
    return { requested: req, unknown: [], recognised: [], checked: false };
  }
  const unknown: string[] = [];
  const recognised: string[] = [];
  for (const id of req) {
    if (known.has(id)) recognised.push(id);
    else unknown.push(id);
  }
  return { requested: req, unknown, recognised, checked: true };
}

/** Warn about ids we do not recognise, or null when there is nothing to say. */
export function describeUnknownDeleteIds(r: DeleteReconciliation): string | null {
  if (!r.checked || r.unknown.length === 0) return null;
  const n = r.unknown.length;
  const idWord = n === 1 ? "ID" : "IDs";
  const isWord = n === 1 ? "is" : "are";
  return (
    `${n} of the ${idWord} entered (${r.unknown.join(", ")}) ${isWord} not in our record of what ` +
    `we have sent to Leafly. Leafly reports success when asked to remove something that is ` +
    `already absent, so this would look like it worked while doing nothing. Check for a typo.`
  );
}

/** Confirmation sentence after a successful delete. */
export function describeDeleteOutcome(count: number): string {
  if (count === 1) {
    return (
      `1 product was removed from the Leafly menu. Allow ~2.5 minutes (sandbox) or ~5 minutes ` +
      `(production) for it to disappear, then use "Read menu back" to confirm it is gone.`
    );
  }
  return (
    `${count} products were removed from the Leafly menu. Allow ~2.5 minutes (sandbox) or ` +
    `~5 minutes (production) for them to disappear, then use "Read menu back" to confirm.`
  );
}

/* -------------------------------------------------------------------------- */
/* Self-tests                                                                 */
/* -------------------------------------------------------------------------- */

export function __runLeaflyDeleteRequestTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (label: string, cond: boolean) => {
    if (cond) {
      passed += 1;
    } else {
      failed += 1;
      console.error(`FAIL: ${label}`);
    }
  };

  // ---- the ordinary cases ------------------------------------------------
  const one = parseDeleteIds("abc-123");
  ok("single id parsed", one.ids.length === 1 && one.ids[0] === "abc-123");
  ok("single id ok", one.ok);
  ok("single id no problems", one.problems.length === 0);

  const commas = parseDeleteIds("a,b,c");
  ok("comma separated", commas.ids.join("|") === "a|b|c");

  const spaces = parseDeleteIds("a b c");
  ok("space separated", spaces.ids.join("|") === "a|b|c");

  const newlines = parseDeleteIds("a\nb\nc");
  ok("newline separated", newlines.ids.join("|") === "a|b|c");

  const crlf = parseDeleteIds("a\r\nb\r\nc");
  ok("CRLF separated", crlf.ids.join("|") === "a|b|c");

  const semis = parseDeleteIds("a;b;c");
  ok("semicolon separated", semis.ids.join("|") === "a|b|c");

  const tabs = parseDeleteIds("a\tb\tc");
  ok("tab separated", tabs.ids.join("|") === "a|b|c");

  const mixed = parseDeleteIds("a, b\nc;d\te");
  ok("mixed separators", mixed.ids.join("|") === "a|b|c|d|e");

  // ---- the paste accidents ----------------------------------------------
  const trailing = parseDeleteIds("a,b,c,");
  ok("trailing comma ignored", trailing.ids.join("|") === "a|b|c");
  ok("trailing comma does not make an empty id", !trailing.ids.includes(""));

  const leading = parseDeleteIds(",a,b");
  ok("leading comma ignored", leading.ids.join("|") === "a|b");

  const blankLines = parseDeleteIds("a\n\n\nb\n  \nc");
  ok("blank lines ignored", blankLines.ids.join("|") === "a|b|c");

  const padded = parseDeleteIds("  a  ,  b  ");
  ok("surrounding whitespace trimmed", padded.ids.join("|") === "a|b");

  const quoted = parseDeleteIds('"a","b"');
  ok("double quotes stripped", quoted.ids.join("|") === "a|b");

  const single = parseDeleteIds("'a','b'");
  ok("single quotes stripped", single.ids.join("|") === "a|b");

  const backtick = parseDeleteIds("`a`");
  ok("backticks stripped", backtick.ids[0] === "a");

  // A quote in the MIDDLE is part of the id and must survive. Stripping it
  // would silently delete a different product than the one named.
  const innerQuote = parseDeleteIds('a"b');
  ok("interior quote preserved", innerQuote.ids[0] === 'a"b');

  // ---- duplicates --------------------------------------------------------
  const dupes = parseDeleteIds("a,b,a,c,a");
  ok("duplicates removed", dupes.ids.join("|") === "a|b|c");
  ok("duplicate reported once", dupes.duplicates.join("|") === "a");
  ok("duplicates do not block", dupes.ok);
  ok("first occurrence order kept", dupes.ids[0] === "a" && dupes.ids[1] === "b");

  const twoDupes = parseDeleteIds("a,a,b,b");
  ok("two distinct duplicates reported", twoDupes.duplicates.join("|") === "a|b");

  // ---- empty -------------------------------------------------------------
  for (const input of ["", "   ", "\n\n", ",,,", null, undefined, ";  ,\t"]) {
    const p = parseDeleteIds(input as string | null | undefined);
    ok(`empty input rejected: ${JSON.stringify(input)}`, !p.ok);
    ok(`empty input flagged: ${JSON.stringify(input)}`, p.problems.includes("empty"));
    ok(`empty input sends nothing: ${JSON.stringify(input)}`, p.ids.length === 0);
  }
  const emptyText = describeDeleteProblems(parseDeleteIds(""));
  ok("empty explained", (emptyText ?? "").includes("nothing to remove"));

  // ---- the cap -----------------------------------------------------------
  const atCap = parseDeleteIds(
    Array.from({ length: MAX_DELETE_IDS }, (_, i) => `id${i}`).join(","),
  );
  ok("exactly at the cap is allowed", atCap.ok);
  ok("exactly at the cap keeps all", atCap.ids.length === MAX_DELETE_IDS);

  const overCap = parseDeleteIds(
    Array.from({ length: MAX_DELETE_IDS + 1 }, (_, i) => `id${i}`).join(","),
  );
  ok("one over the cap is refused", !overCap.ok);
  ok("over cap flagged", overCap.problems.includes("too_many"));
  const capText = describeDeleteProblems(overCap) ?? "";
  ok("cap explained", capText.includes("cannot be undone"));
  ok("cap quotes the limit", capText.includes(String(MAX_DELETE_IDS)));

  // Duplicates are removed BEFORE the cap is applied, so pasting the same 300
  // ids twice is not a cap violation.
  const dupeHeavy = parseDeleteIds(
    [...Array.from({ length: 100 }, (_, i) => `id${i}`), ...Array.from({ length: 100 }, (_, i) => `id${i}`)].join(","),
  );
  ok("duplicates counted once against the cap", dupeHeavy.ok && dupeHeavy.ids.length === 100);

  // ---- absurdly long entries --------------------------------------------
  const longOne = "x".repeat(MAX_DELETE_ID_LENGTH + 1);
  const tooLong = parseDeleteIds(`good-id,${longOne}`);
  ok("too-long entry rejected", !tooLong.ok);
  ok("too-long flagged", tooLong.problems.includes("id_too_long"));
  ok("too-long recorded", tooLong.rejected.length === 1);
  ok("too-long does not reach the ids", !tooLong.ids.includes(longOne));
  ok("the good id survives parsing", tooLong.ids.includes("good-id"));
  const longText = describeDeleteProblems(tooLong) ?? "";
  ok("too-long explained", longText.includes("whole line was pasted"));

  // Exactly at the length limit is fine. Boundary on both sides.
  const exact = parseDeleteIds("x".repeat(MAX_DELETE_ID_LENGTH));
  ok("exactly max length allowed", exact.ok && exact.ids.length === 1);

  // ---- nothing is fabricated --------------------------------------------
  // PROPERTY: every id we output was present in the input text. A parser that
  // can invent an id can delete a product nobody named.
  const fuzzInputs = [
    "a,b,c", '"x" "y"', "p1\np2\n\np3", ",,,a,,,", "  q  ", "a;b,c d\te",
    "'quoted',unquoted", "dup,dup,dup", "id-with-dash_and_underscore.and.dots",
    "UPPER,lower,MiXeD", "123,456",
  ];
  let fabricated = 0;
  for (const input of fuzzInputs) {
    for (const id of parseDeleteIds(input).ids) {
      if (!input.includes(id)) fabricated += 1;
    }
  }
  ok("PROPERTY: never fabricates an id not present in the input", fabricated === 0);

  // PROPERTY: an empty string is never emitted as an id. Sending "" would be a
  // delete request for a product with no name.
  let blanks = 0;
  for (const input of [...fuzzInputs, "", ",", ",,", " , , ", '""', "''"]) {
    if (parseDeleteIds(input).ids.some((id) => id.length === 0)) blanks += 1;
  }
  ok("PROPERTY: never emits a blank id", blanks === 0);

  // PROPERTY: output is always unique.
  let notUnique = 0;
  for (const input of [...fuzzInputs, "a,a,a,a", "x x x"]) {
    const out = parseDeleteIds(input).ids;
    if (new Set(out).size !== out.length) notUnique += 1;
  }
  ok("PROPERTY: output ids are always unique", notUnique === 0);

  // PROPERTY: never ok with an empty list. Proceeding with nothing to send is
  // a pointless live API call reported as a success.
  let okButEmpty = 0;
  for (const input of [...fuzzInputs, "", "   ", ",,,", null as unknown as string]) {
    const p = parseDeleteIds(input);
    if (p.ok && p.ids.length === 0) okButEmpty += 1;
  }
  ok("PROPERTY: ok is never true with zero ids", okButEmpty === 0);

  // ---- reconciliation ----------------------------------------------------
  const noKnowledge = reconcileDeleteRequest(["a", "b"], null);
  ok("no knowledge means unchecked", !noKnowledge.checked);
  ok("no knowledge flags nothing", noKnowledge.unknown.length === 0);
  ok("no knowledge says nothing", describeUnknownDeleteIds(noKnowledge) === null);
  ok("no knowledge still echoes the request", noKnowledge.requested.join("|") === "a|b");

  const allKnown = reconcileDeleteRequest(["a", "b"], new Set(["a", "b", "c"]));
  ok("all known checked", allKnown.checked);
  ok("all known has no unknowns", allKnown.unknown.length === 0);
  ok("all known recognises both", allKnown.recognised.join("|") === "a|b");
  ok("all known says nothing", describeUnknownDeleteIds(allKnown) === null);

  const someUnknown = reconcileDeleteRequest(["a", "typo"], new Set(["a"]));
  ok("unknown detected", someUnknown.unknown.join("|") === "typo");
  ok("known still recognised", someUnknown.recognised.join("|") === "a");
  const unknownText = describeUnknownDeleteIds(someUnknown) ?? "";
  ok("unknown warned", unknownText.length > 0);
  ok("unknown names the id", unknownText.includes("typo"));
  ok("unknown explains the false success", unknownText.includes("already absent"));
  ok("unknown suggests a typo", unknownText.includes("typo"));

  // Singular vs plural grammar.
  const oneUnknown = describeUnknownDeleteIds(reconcileDeleteRequest(["x"], new Set())) ?? "";
  ok("one unknown singular", oneUnknown.includes("1 of the ID entered") && oneUnknown.includes(" is not"));
  const twoUnknown = describeUnknownDeleteIds(reconcileDeleteRequest(["x", "y"], new Set())) ?? "";
  ok("two unknown plural", twoUnknown.includes("2 of the IDs entered") && twoUnknown.includes(" are not"));

  // An empty known-set is still a CHECK, not an absence of knowledge. This is
  // the `null` vs `new Set()` distinction, and conflating them would make a
  // brand-new integration silently skip the warning.
  const emptyKnown = reconcileDeleteRequest(["a"], new Set());
  ok("empty known set is still checked", emptyKnown.checked);
  ok("empty known set flags everything", emptyKnown.unknown.join("|") === "a");

  // ---- outcome wording ---------------------------------------------------
  const outOne = describeDeleteOutcome(1);
  ok("single outcome singular", outOne.startsWith("1 product was removed"));
  ok("single outcome mentions readback", outOne.includes("Read menu back"));
  const outMany = describeDeleteOutcome(7);
  ok("many outcome plural", outMany.startsWith("7 products were removed"));
  ok("outcome gives the latency", outMany.includes("~2.5 minutes"));

  return { passed, failed };
}
