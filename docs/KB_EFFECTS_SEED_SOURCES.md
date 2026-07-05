# KB Effects Vocabulary — Source Notes & Compliance Rationale

**Purpose.** Ground the `kb_effects` seed (KB hardening v2, Slice 1) so every stored
experiential-effect record is (a) traceable to how the term is used across the cannabis
industry, and (b) provably compliant with the codebase's own effect allow-list. Per the
standing rules: **never guess.** Every seeded slug is a verbatim member of the authoritative
`ALLOWED_EFFECTS` list in `src/lib/ai/compliance.ts`, and every definition/house-note is written
as **subjective experience only** — no medical/therapeutic claim.

---

## Why an effects vocabulary (the gap this fills)

Migration `0071_kb_products_and_effects.sql` added free-text `effects text[]` columns to
`kb_products`, `kb_strains`, and `kb_product_categories`. The retrieval brain
(`src/lib/ai/kb/retrieval.ts`) surfaces them verbatim as a bare list:

> `Curated experiential character: relaxed, sleepy, uplifted (experience only, not medical).`

Those bare tags carry **no canonical definition, no per-term compliance vetting at the vocabulary
level, and no house voice.** `kb_effects` gives each experiential effect one authoritative record:
a factual non-medical **definition**, a **house_note** (fun-but-professional budtender voice), and
neutral **aliases** for matching. The existing `effects[]` arrays reference `kb_effects.slug`
(loose ref, exactly like `kb_products.terpenes[]` → `kb_terpenes.slug`).

## Compliance contract (WA I-502)

- **Allow-list membership is mandatory.** Every seeded `slug` is a member of `ALLOWED_EFFECTS`
  (src/lib/ai/compliance.ts). If a term is not on that list, `checkEffects()` rejects it — so the
  vocabulary and the gate can never disagree.
- **Subjective experience only.** Definitions describe *how it tends to feel* ("a mellow,
  settled, take-it-easy body feeling"), never a health outcome. Prohibited words
  (treat/cure/relieve/pain/anxiety/insomnia/…) are stripped by `checkCompliance` +
  `EFFECT_MEDICAL_WORDS` before anything surfaces.
- **`category` is a UI grouping, not a medical category.** Values: `calming`, `uplifting`,
  `energizing`, `character`.
- **House voice brief (from the owner).** "A professional group of experienced cannabis users who
  cater to adults 21+ … the tone should reflect a sophisticated pothead: relaxed, knowledgeable,
  friendly, with some fun creative terms — enjoyable and a little funny, but still professional."
  Every `house_note` is written to that brief and remains non-medical.

## Curated core set (quality over quantity — owner-approved)

A tight, high-signal set of the effects budtenders actually reach for, grouped into four families.
All slugs are drawn from `ALLOWED_EFFECTS`; a handful of adjacent allow-list synonyms
(relaxing/calming/energizing/uplifting/sedating) are folded in as `aliases` rather than separate
rows, so the vocabulary stays clean.

### Calming / body (family: `calming`)
- **relaxed** — the classic mellow, settled, tension-melting body feeling. aliases: relaxing, calm, calming, chill, mellow, soothing.
- **sleepy** — heavy-eyed, winding-down, ready-for-bed drowsiness. aliases: sedate, sedating, drowsy.
- **couch-lock** — that pleasantly pinned-to-the-cushions heaviness where getting up feels optional. aliases: heavy, body high.
- **dreamy** — soft, floaty, slightly-in-your-head-in-a-good-way haze. aliases: —

### Uplifting / social (family: `uplifting`)
- **happy** — a light, good-mood lift. aliases: —
- **euphoric** — a bigger, brighter wave of feel-good. aliases: uplifted, uplifting.
- **giggly** — everything's a little funnier than it has any right to be. aliases: —
- **talkative** — chatty, sociable, easy-conversation energy. aliases: sociable, social.

### Energizing / active (family: `energizing`)
- **energetic** — get-up-and-go, do-the-thing energy. aliases: energizing, buzzy.
- **focused** — dialed-in, heads-down clarity. aliases: —
- **creative** — ideas-flowing, color-outside-the-lines headspace. aliases: —
- **hungry** — the appetite nudge, affectionately "the munchies." aliases: —

### Character / intensity (family: `character`)
- **cerebral** — a heady, up-top experience you feel more in your mind than your body. aliases: head high.
- **body high** — the opposite pole: felt physically, in the limbs and shoulders. aliases: —
- **potent** — a heads-up that this one hits hard; pace yourself. aliases: stoney, strong.
- **tingly** — a light, pleasant physical fizz or buzz. aliases: —

## Sources (industry usage of these experiential terms)
1. Leafly effect taxonomy (relaxed / euphoric / body-vs-head effects). https://www.leafly.com/strains/lists/effect/relaxed , https://www.leafly.com/strains/lists/effect/euphoric , https://www.leafly.com/news/strains-products/weeds-strains-body-focused-effects
2. Amsterdam Genetics — "Relaxing Body Effect vs Uplifting Head Effect" (body-high vs head-high, couch-lock, energetic/euphoric/giggly/talkative vs sleepy/relaxed). https://www.amsterdamgenetics.com/choosing-cannabis-effects
3. Codebase allow-list of record: `ALLOWED_EFFECTS` in `src/lib/ai/compliance.ts` (authoritative WA-compliant experiential vocabulary; every seeded slug is a member).

> Note: these sources establish that the terms are standard, widely-understood *experiential*
> descriptors. They are NOT cited as medical evidence — the KB stores no medical claims. Any
> medical framing seen in third-party pages (e.g. "remedy for pain") is deliberately excluded.
