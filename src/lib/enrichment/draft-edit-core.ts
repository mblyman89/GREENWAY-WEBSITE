/**
 * src/lib/enrichment/draft-edit-core.ts  (D244 R-2 - edit a draft on the grid)
 *
 * Owner (verbatim, round 2): "please also include this round the ability to
 * edit a draft directly on the bulk grid."
 *
 * PURE. Every all-fields draft is shown as plain text a person can type over
 * (editText), and the typed text is read back into the exact stored shape of
 * that field (resolveDraftEdit): plain text, a comma list, the SEO pair, the
 * sensory JSON, a canonical strain type or the potency text. Nothing typed
 * skips the rules the AI's own draft has to pass: SEO is re-cleaned, tags
 * stay in the allowed list, strain type is canonical, potency must parse and
 * stay under the ceilings. The caller still runs the compliance gate (and,
 * for effects, checkEffects) on the result.
 *
 * Unchanged text (after whitespace) is NOT an edit: the stored draft is used
 * byte for byte, so pressing Save & accept on an untouched box equals Accept.
 */
import { MAX_EDITED_VALUE_CHARS } from "@/lib/ai/edited-value";
import { SEO_FIELD_KEY, parseSeoSuggestion, seoSuggestionValue } from "@/lib/enrichment/seo-draft-core";
import { canonicalStrainType, strainTypeLabel } from "@/lib/menu/strain-taxonomy";
import { parsePotencyText, potencyText } from "@/lib/enrichment/lot-evidence-core";
import { sensoryText } from "@/lib/enrichment/ai-draft-v2-core";

export type DraftEditKind = "text" | "list" | "seo" | "sensory" | "strain" | "potency";

/** How a field is edited (unknown fields: plain text). */
export function editKind(field: string): DraftEditKind {
  if (field === SEO_FIELD_KEY) return "seo";
  if (field === "tags" || field === "effects") return "list";
  if (field === "sensory") return "sensory";
  if (field === "strain_type") return "strain";
  if (field === "potency") return "potency";
  return "text";
}

/** One-line help under the edit box. */
export const EDIT_HINT: Readonly<Record<DraftEditKind, string>> = Object.freeze({
  text: "Type over the draft. What you save is what customers see.",
  list: "Comma-separated. Only words from the allowed list are kept.",
  seo: "Line 1: the page title (39 characters max). Line 2: the meta description (120-160 characters).",
  sensory: "Keep the labels: Aroma: … · Flavor: … · Terpenes: … (each comma-separated).",
  strain: "One of: Indica, Sativa, Hybrid, Indica-Hybrid, Sativa-Hybrid, CBD.",
  potency: "Like: THC 24.5% · CBD 0.1%  (use mg for edibles, drinks and tinctures).",
});

/** The text shown in the edit box for a stored draft value. */
export function editText(field: string, stored: string | null | undefined): string {
  const v = String(stored ?? "");
  switch (editKind(field)) {
    case "seo": {
      const d = parseSeoSuggestion(v);
      return d ? `${d.title}\n${d.description}` : v;
    }
    case "sensory":
      return sensoryText(v) || v;
    case "strain":
      return strainTypeLabel(canonicalStrainType(v));
    case "potency": {
      const p = parsePotencyText(v);
      return p.ok ? potencyText(p.value) : v;
    }
    default:
      return v;
  }
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const list = (s: string) =>
  s
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean);

export type DraftEditResult = { value: string; edited: boolean; error: string };

/**
 * Read a typed edit back into the stored shape. `allowedTags` is the tag
 * whitelist (passed in so this file stays free of server-only imports).
 */
export function resolveDraftEdit(
  field: string,
  stored: string | null | undefined,
  raw: FormDataEntryValue | null | undefined,
  opts: { allowedTags?: readonly string[] } = {},
): DraftEditResult {
  const original = String(stored ?? "");
  const typed = typeof raw === "string" ? raw : "";
  const same = { value: original, edited: false, error: "" };
  if (typed.length > MAX_EDITED_VALUE_CHARS) {
    return { ...same, error: `That edit is too long (the limit is ${MAX_EDITED_VALUE_CHARS.toLocaleString()} characters).` };
  }
  if (!typed.trim() || squash(typed) === squash(editText(field, original))) return same;
  const fail = (error: string): DraftEditResult => ({ ...same, error });
  const done = (value: string): DraftEditResult => (value === original ? same : { value, edited: true, error: "" });

  switch (editKind(field)) {
    case "text":
      return done(typed.trim());
    case "list": {
      let items = list(typed).map((t) => t.toLowerCase());
      if (field === "tags" && opts.allowedTags) {
        const ok = new Set(opts.allowedTags);
        const bad = items.filter((t) => !ok.has(t));
        if (bad.length) return fail(`Not an allowed tag: ${bad.join(", ")}. Allowed: ${opts.allowedTags.join(", ")}.`);
      }
      items = items.filter((t, i) => items.indexOf(t) === i);
      if (items.length === 0) return fail("The list is empty. Reject the draft instead.");
      return done(items.join(", "));
    }
    case "seo": {
      const [title, ...rest] = typed.split("\n");
      const value = seoSuggestionValue({ title: title ?? "", description: rest.join(" ") });
      if (!value) return fail("Write the title on the first line and the meta description on the second.");
      return done(value);
    }
    case "sensory": {
      const part = (label: string) => {
        const m = typed.match(new RegExp(`${label}\\s*:\\s*([^·\\n]*)`, "i"));
        return m ? list(m[1]!).slice(0, 5) : [];
      };
      const v = { aroma_notes: part("aroma"), flavor_notes: part("flavou?r"), terpenes: part("terpenes?").slice(0, 4) };
      if (!v.aroma_notes.length && !v.flavor_notes.length && !v.terpenes.length) {
        return fail("Keep the labels, like: Aroma: berry, sweet · Flavor: blueberry · Terpenes: myrcene.");
      }
      return done(JSON.stringify(v));
    }
    case "strain": {
      const t = canonicalStrainType(typed);
      if (t === "unknown") return fail(EDIT_HINT.strain);
      return done(t);
    }
    case "potency": {
      const p = parsePotencyText(typed);
      if (!p.ok) return fail(p.error);
      return done(potencyText(p.value));
    }
  }
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runDraftEditTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`draft-edit-core FAIL: ${label}`);
    }
  };
  const eq = (a: unknown, b: unknown, label: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${label}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
  const T = ["local", "staff-pick", "new-arrival"];

  eq(
    ["description", "seo", "tags", "effects", "sensory", "strain_type", "potency"].map(editKind),
    ["text", "seo", "list", "list", "sensory", "strain", "potency"],
    "kinds",
  );
  // untouched = not an edit (stored value byte for byte)
  const seoStored = JSON.stringify({ seo_title: "Blue Dream 3.5g", seo_description: "x".repeat(130) });
  eq(resolveDraftEdit("seo", seoStored, editText("seo", seoStored)), { value: seoStored, edited: false, error: "" }, "seo untouched");
  eq(resolveDraftEdit("description", "Old.", "  Old.  "), { value: "Old.", edited: false, error: "" }, "whitespace only");
  eq(resolveDraftEdit("description", "Old.", ""), { value: "Old.", edited: false, error: "" }, "empty box keeps draft");
  eq(resolveDraftEdit("description", "Old.", "New copy."), { value: "New copy.", edited: true, error: "" }, "text edit");
  ok(resolveDraftEdit("description", "Old.", "x".repeat(MAX_EDITED_VALUE_CHARS + 1)).error !== "", "too long");
  // lists
  eq(resolveDraftEdit("tags", "local", "Local, staff-pick, local", { allowedTags: T }).value, "local, staff-pick", "tags lowercased + deduped");
  ok(resolveDraftEdit("tags", "local", "local, best-ever", { allowedTags: T }).error.includes("best-ever"), "bad tag refused");
  eq(resolveDraftEdit("effects", "relaxed", "relaxed, happy").value, "relaxed, happy", "effects list (gated by caller)");
  ok(resolveDraftEdit("effects", "relaxed", " , ").edited === false, "blank list = untouched");
  // seo
  const seo = resolveDraftEdit("seo", seoStored, `Blue Dream Flower | Greenway Marijuana\n${"y".repeat(140)}`);
  ok(seo.edited && JSON.parse(seo.value).seo_title === "Blue Dream Flower", "seo re-cleaned (store name stripped)");
  ok(resolveDraftEdit("seo", seoStored, "only a title").error !== "", "seo needs both lines");
  // sensory round trip
  const sens = JSON.stringify({ aroma_notes: ["berry"], flavor_notes: ["sweet"], terpenes: ["myrcene"] });
  eq(editText("sensory", sens), "Aroma: berry · Flavor: sweet · Terpenes: myrcene", "sensory shown");
  eq(
    JSON.parse(resolveDraftEdit("sensory", sens, "Aroma: berry, pine · Flavor: sweet · Terpenes: myrcene").value),
    { aroma_notes: ["berry", "pine"], flavor_notes: ["sweet"], terpenes: ["myrcene"] },
    "sensory parsed",
  );
  ok(resolveDraftEdit("sensory", sens, "berry and pine").error !== "", "sensory needs labels");
  // strain type
  eq(editText("strain_type", "indica-hybrid"), "Indica-Hybrid", "strain shown");
  eq(resolveDraftEdit("strain_type", "hybrid", "indica dominant hybrid").value, "indica-hybrid", "strain canonical");
  ok(resolveDraftEdit("strain_type", "hybrid", "purple").error !== "", "strain junk refused");
  // potency
  eq(resolveDraftEdit("potency", "THC 24.5%", "THC 25.1% CBD 0.2%").value, "THC 25.1% · CBD 0.2%", "potency normalised");
  ok(resolveDraftEdit("potency", "THC 24.5%", "THC 240%").error !== "", "potency ceiling");
  eq(resolveDraftEdit("potency", "THC 24.5%", "thc 24.5 %").edited, false, "same potency = untouched");
  return { passed, failed };
}
