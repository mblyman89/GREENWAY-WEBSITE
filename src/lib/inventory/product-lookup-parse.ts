/**
 * src/lib/inventory/product-lookup-parse.ts
 *
 * A tolerant JSON extractor for the AI lookup (T-314). The web_search path has
 * no response_format, so the model may wrap its JSON in prose or code fences.
 * This pulls the first balanced JSON object out of arbitrary text. Pure, no
 * imports \u2014 unit-testable offline.
 */

/** Try hard to parse a JSON object out of model text. Returns {} on failure. */
export function looseParseLookupJson(text: string): unknown {
  const s = String(text ?? "").trim();
  if (!s) return {};

  // 1) Direct parse.
  try {
    return JSON.parse(s);
  } catch {
    /* fall through */
  }

  // 2) Strip a ```json ... ``` fence if present.
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      /* fall through */
    }
  }

  // 3) Extract the first balanced { ... } block.
  const start = s.indexOf("{");
  if (start >= 0) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          const slice = s.slice(start, i + 1);
          try {
            return JSON.parse(slice);
          } catch {
            return {};
          }
        }
      }
    }
  }
  return {};
}

// ---------------------------------------------------------------------------
// PURE SELF-TEST \u2014 registered in scripts/compliance/run-pure-selftests.ts.
// ---------------------------------------------------------------------------
export function __runProductLookupParseTests(): { passed: number; failed: number } {
  let passed = 0;
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`product-lookup-parse self-test failed: ${msg}`);
    passed++;
  };

  const a = looseParseLookupJson('{"found":true,"strain_type":"indica"}') as Record<string, unknown>;
  assert(a.found === true && a.strain_type === "indica", "direct parse");

  const b = looseParseLookupJson('```json\n{"found":false}\n```') as Record<string, unknown>;
  assert(b.found === false, "fenced parse");

  const c = looseParseLookupJson(
    'Here is what I found:\n{"strain_type":"sativa","found":true} \u2014 hope that helps!',
  ) as Record<string, unknown>;
  assert(c.strain_type === "sativa" && c.found === true, "embedded parse");

  const d = looseParseLookupJson('the string has {"a":"}not real"} inside') as Record<string, unknown>;
  assert(d.a === "}not real", "string-aware brace balancing");

  const e = looseParseLookupJson("no json at all");
  assert(JSON.stringify(e) === "{}", "garbage -> {}");

  const f = looseParseLookupJson("");
  assert(JSON.stringify(f) === "{}", "empty -> {}");

  return { passed, failed: 0 };
}
