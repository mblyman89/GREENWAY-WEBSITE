#!/usr/bin/env python3
"""SLICE W1 -- delegate both live weight parsers to weight-label-core.

Each edit asserts EXACTLY ONE anchor match and reads the file back off disk to
prove the write landed. Idempotent: decided by `text.count(new) == 1` ALONE.
"""
import io
import sys

ENGINE = "src/lib/promotions/discount-engine-core.ts"
CART = "src/lib/specials/cart-discount.ts"
VARIANT = "src/lib/pos/variant-grams-core.ts"


def edit(path: str, old: str, new: str, label: str) -> None:
    with io.open(path, encoding="utf-8") as f:
        text = f.read()
    if text.count(new) == 1:
        print(f"  = already applied: {label}")
        return
    n = text.count(old)
    assert n == 1, f"{label}: expected 1 anchor in {path}, found {n}"
    text = text.replace(old, new, 1)
    with io.open(path, "w", encoding="utf-8") as f:
        f.write(text)
    with io.open(path, encoding="utf-8") as f:
        back = f.read()
    assert back.count(new) == 1, f"{label}: write did not land on disk"
    print(f"  + applied: {label}")


# ---------------------------------------------------------------------------
# 1. discount-engine-core.ts -- gramsForLabel delegates.
# ---------------------------------------------------------------------------
ENGINE_OLD = '''/** "1oz" => 28, "3.5g" => 3.5. Cannabis ounce = 28g (matches cart-discount.ts). */
export function gramsForLabel(label?: string | null): number {
  if (!label) return 0;
  const s = label.trim().toLowerCase();
  const oz = s.match(/([\\d.]+)\\s*(oz|ounce)/);
  if (oz) return parseFloat(oz[1]) * STATUTORY_GRAMS_PER_OUNCE; // GW-016: shared statutory equivalence
  const g = s.match(/([\\d.]+)\\s*g\\b/);
  if (g) return parseFloat(g[1]);
  return 0;
}'''

ENGINE_NEW = '''/**
 * "1oz" => 28, "3.5g" => 3.5, "1/8 oz" => 3.5, "28 grams" => 28. Returns 0 when
 * the label states no unambiguous weight, which `tierPercent` reads as "no
 * tier" -- the store-safe direction.
 *
 * SLICE W1: this used to own a SECOND, unanchored copy of the parse
 * (`/([\\d.]+)\\s*(oz|ounce)/`), which matched the "8 oz" SUBSTRING of "1/8 oz"
 * and reported 224 g -- a full-ounce 30% tier awarded to an eighth -- while its
 * `\\bg\\b` gram branch reported 0 g for "28 grams". It now delegates to the one
 * shared parser in weight-label-core, which the WAC 314-55-095 limit parser
 * also uses, so the discount answer and the compliance answer can no longer
 * disagree (they differed on 14 of 37 measured label shapes). Verified a
 * NO-OP across all 666 machine-emittable labels before rewiring.
 */
export function gramsForLabel(label?: string | null): number {
  return parseWeightLabelGrams(label) ?? 0;
}'''

# ---------------------------------------------------------------------------
# 2. cart-discount.ts -- the byte-identical duplicate delegates too.
# ---------------------------------------------------------------------------
CART_OLD = '''/** Convert a variant label to grams. "1oz" => 28, "3.5g" => 3.5, "1g" => 1. */
export function gramsForLabel(label?: string): number {
  if (!label) return 0;
  const normalized = label.trim().toLowerCase();
  // Ounce tokens (oz / ounce). 1oz == 28g (WA statutory equivalence, GW-016).
  const ozMatch = normalized.match(/([\\d.]+)\\s*(oz|ounce)/);
  if (ozMatch) return parseFloat(ozMatch[1]) * STATUTORY_GRAMS_PER_OUNCE;
  // Gram tokens.
  const gMatch = normalized.match(/([\\d.]+)\\s*g\\b/);
  if (gMatch) return parseFloat(gMatch[1]);
  return 0;
}'''

CART_NEW = '''/**
 * Convert a variant label to grams. "1oz" => 28, "3.5g" => 3.5, "1/8 oz" => 3.5.
 * 0 means "no parseable weight" => no weight tier.
 *
 * SLICE W1: the website copy of this function was byte-for-byte identical to
 * the register's, which is exactly how the two drifted from the compliance
 * parser. Both now delegate to weight-label-core so the register, the website
 * estimator, and the WAC limit engine answer with ONE parse.
 */
export function gramsForLabel(label?: string): number {
  return parseWeightLabelGrams(label) ?? 0;
}'''

# ---------------------------------------------------------------------------
# 3. variant-grams-core.ts -- the limit parser delegates (same answers, plus
#    fractions). Stays null-on-unknown so the conservative default still wins.
# ---------------------------------------------------------------------------
VARIANT_OLD = '''export function gramsFromVariantLabel(label: string | null | undefined): number | null {
  if (typeof label !== "string") return null;
  const s = label.trim().toLowerCase();
  if (!s) return null;
  // Only whitespace may sit between the number and the unit, so "1fl oz",
  // "100mg", "30ml", "2pk", "5 each" all fail the match by design.
  const m = s.match(/^(\\d+(?:\\.\\d+)?)\\s*(g|gram|grams|oz|ounce|ounces)$/);
  if (!m) return null;
  const qty = Number(m[1]);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  const grams = m[2].startsWith("g") ? qty : qty * GRAMS_PER_OUNCE;
  return round3(grams);
}'''

VARIANT_NEW = '''export function gramsFromVariantLabel(label: string | null | undefined): number | null {
  // SLICE W1: the parse itself now lives in weight-label-core, shared with the
  // DISCOUNT engines, which previously carried their own unanchored copy and
  // disagreed with this function on 14 of 37 measured label shapes ("1/8 oz"
  // read as 224 g there, null here). Behaviour on this side is UNCHANGED for
  // every label the importer can emit -- verified identical across all 666
  // machine-emittable labels -- and additionally understands exact fractions
  // ("1/8 oz" -> 3.5 g). Still null on anything ambiguous, so the limit engine
  // keeps falling back to the conservative per-category default.
  return parseWeightLabelGrams(label);
}'''

print("SLICE W1 -- unifying the weight-label parsers")
edit(ENGINE, ENGINE_OLD, ENGINE_NEW, "discount-engine-core.gramsForLabel -> shared parser")
edit(CART, CART_OLD, CART_NEW, "cart-discount.gramsForLabel -> shared parser")
edit(VARIANT, VARIANT_OLD, VARIANT_NEW, "variant-grams-core.gramsFromVariantLabel -> shared parser")

# ---------------------------------------------------------------------------
# 4. Imports.
# ---------------------------------------------------------------------------
edit(
    ENGINE,
    'import { STATUTORY_GRAMS_PER_OUNCE } from "@/lib/compliance/grams-per-ounce";',
    'import { STATUTORY_GRAMS_PER_OUNCE } from "@/lib/compliance/grams-per-ounce";\n'
    '// SLICE W1: the ONE weight-label parse, shared with the WAC limit engine.\n'
    'import { parseWeightLabelGrams } from "@/lib/compliance/weight-label-core";',
    "engine import",
)

with io.open(CART, encoding="utf-8") as f:
    cart_text = f.read()
cart_anchor = None
for cand in (
    'import { STATUTORY_GRAMS_PER_OUNCE } from "@/lib/compliance/grams-per-ounce";',
):
    if cart_text.count(cand) == 1:
        cart_anchor = cand
        break
assert cart_anchor, "cart-discount.ts: could not find the grams-per-ounce import anchor"
edit(
    CART,
    cart_anchor,
    cart_anchor + '\n// SLICE W1: the ONE weight-label parse, shared with the WAC limit engine.\n'
    'import { parseWeightLabelGrams } from "@/lib/compliance/weight-label-core";',
    "cart import",
)

edit(
    VARIANT,
    'import { STATUTORY_GRAMS_PER_OUNCE as GRAMS_PER_OUNCE } from "@/lib/compliance/grams-per-ounce";',
    '// SLICE W1: the shared parse. GRAMS_PER_OUNCE is still imported below for the\n'
    '// self-tests that pin the statutory equivalence at this layer.\n'
    'import { parseWeightLabelGrams } from "@/lib/compliance/weight-label-core";\n'
    'import { STATUTORY_GRAMS_PER_OUNCE as GRAMS_PER_OUNCE } from "@/lib/compliance/grams-per-ounce";',
    "variant import",
)

print("\nW1 edits applied. Verifying no stale regex copies remain...")
# Only EXECUTABLE lines count -- the new headers deliberately quote the old
# regex to document what went wrong, and that prose must not trip this guard.
for path in (ENGINE, CART, VARIANT):
    with io.open(path, encoding="utf-8") as f:
        lines = f.read().splitlines()
    live = [
        ln
        for ln in lines
        if "(oz|ounce" in ln and not ln.lstrip().startswith(("*", "//", "/*"))
    ]
    if live:
        print(f"  !! {path} still parses ounces inline:")
        for ln in live:
            print("      " + ln.strip())
        sys.exit(1)
    print(f"  ok  {path}: no inline ounce parse in executable code")
print("  all three parsers now delegate to weight-label-core.")
