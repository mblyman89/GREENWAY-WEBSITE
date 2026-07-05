# KB Terpene → Aroma Cross-Map — Enrichment Notes (Slice 5)

> **KB Hardening v2 — Slice 5: Terpene → aroma cross-map enrichment.**
> Purpose: make the existing terpene aroma/flavor map do more work in grounded
> copy — fire for the product's OWN terpenes (not just the strain's), and add a
> reverse map (aroma word → the terpene that typically drives it + its familiar
> botanical source) so sensory copy can be richer and more accurate.

**Sensory-only, non-medical.** Terpenes here are strictly a *sensory translation
layer* (aroma / flavor / "also found in" botanical bridge). There is
deliberately **no** effect, "entourage effect", or medical content — that has
been the rule since migration 0019 and it is preserved.

---

## What already existed (verified)

- **`kb_terpenes`** (migration 0019): `slug`, `name`, `aroma_notes[]`,
  `flavor_notes[]`, `also_found_in` (botanical bridge). Staff-only, RLS, trigger.
- **`SEED_TERPENES`** (seed.ts): 22 terpenes already carry rich `aroma_notes`,
  `flavor_notes`, and `also_found_in`.
- **Retrieval grounding** only fired terpene lines for terpenes the *strain*
  listed (`strain.terpenes`), emitted bare words, and had no reverse map.

## What this slice adds

1. **`aroma_families text[]`** on `kb_terpenes` (migration 0089) — a small set of
   normalized aroma-family tags per terpene (limonene → `{citrus}`, pinene →
   `{pine, herbal}`, myrcene → `{earthy, musky, herbal}`, …).
2. **Widened terpene trigger** in retrieval: fire for the product record's own
   `terpenes[]` **and** the strain's `terpenes[]` (deduped), so a product that
   names its terpenes gets the map even without a matched strain.
3. **Reverse cross-map** (aroma word → terpene) in retrieval: when a product's
   `aroma_notes` / `flavor_notes` mention an aroma family (e.g. "citrus",
   "pine", "berry") that a curated terpene drives, surface a line bridging the
   aroma to the terpene and its familiar botanical source — e.g. *"That citrus
   lift lines up with limonene, the same terpene you'd meet in lemon rind."*
   This is additive grounding, still purely sensory.

The aroma-family assignments are curated from the same aroma/flavor descriptors
already present in `SEED_TERPENES` (self-consistent), so no external claim is
introduced — it is a normalization of data the KB already holds.

---

## Aroma family → terpene (curated cross-map)

| Aroma family | Primary terpene(s) |
|---|---|
| citrus | limonene, valencene, ocimene |
| pine | pinene, camphene, carene |
| earthy | myrcene, humulene, fenchol |
| floral | linalool, geraniol, terpineol, bisabolol, nerolidol |
| spicy / peppery | caryophyllene, sabinene |
| minty / cooling | eucalyptol, borneol, pulegone, phellandrene |
| herbal | pinene, terpinolene, ocimene |
| woody | humulene, guaiol, nerolidol |
| sweet / fruity | ocimene, geraniol, carene |
| hoppy | humulene, myrcene |

Every pairing above is derived from the terpene's own `aroma_notes` /
`flavor_notes` already in `SEED_TERPENES` — this table is just the inverse view
used to build the reverse index.

---

## Sources

- Repo migration `0019_cannabis_knowledge_base.sql` + `SEED_TERPENES` (existing
  curated aroma/flavor data — the authoritative in-repo source this slice
  normalizes).
- Leafly terpene profiles (aroma descriptors) — consistent with the existing
  `also_found_in` botanical bridges already curated in `SEED_TERPENES`.
