# Compliance: Effect Claims vs. Medical Claims (WA I-502)

**Purpose:** Ground the KB copy guardrails in verified law so the system can WARN on
risky phrasing but HARD-BLOCK only true medicinal/curative-therapeutic claims — while
still letting us tell customers how "stoney", relaxing, or uplifting a strain is.

**This is operational guidance, not legal advice.** Owner directive: guardrails are
WARNINGS ONLY except for genuine medical/curative claims, which are hard blocks.

---

## The controlling rule

**WAC 314-55-155(1)(a)** — cannabis advertising and labels **must not** contain any
statement or illustration that:
- (i) Is **false or misleading**;
- (ii) **Promotes over-consumption**;
- (iii) **Represents the use of cannabis has curative or therapeutic effects**;
- (iv) Is designed to appeal to minors.

(Source: WAC 314-55-155, Cornell LII, verified 2025. Statutory authority RCW 69.50.369.)

The single line that governs product copy is **(iii): no curative or therapeutic
(medical) claims.** WA does NOT prohibit describing the subjective experience/effect.

Corroborating (FDA): the violations in FDA warning letters (2015–2019 CBD analysis, PMC8713259)
are **disease/treatment claims** — e.g. "treats anxiety," "cures cancer," "anti-inflammatory,"
"relieves chronic pain." Experiential descriptors are not the target.

---

## ALLOWED (effect / experience descriptors) — WARN at most, never block

These describe the *subjective experience*, not a medical outcome:
- relaxing, relaxed, calming, chill, mellow, soothing (experience)
- uplifting, uplifted, energizing, energetic, euphoric, happy, giggly
- creative, focused, talkative, social, sleepy, couch-lock, "stoney", heavy, potent
- body high, head high, cerebral, buzzy
- flavor/aroma: earthy, citrus, piney, gassy, sweet, dank, etc.

These are the words that let us tell the customer how "stoney" a strain is. KEEP THEM.

---

## HARD-BLOCK (curative / therapeutic / medical claims)

These represent cannabis as having **curative or therapeutic effects** — the WAC (iii)
violation. Block (or require rewrite) when copy claims the product **treats, cures,
prevents, heals, or relieves a medical condition / disease / symptom**, e.g.:
- "treats/cures/heals/prevents/relieves ___"
- "cure", "remedy", "medicine for", "therapy for", "therapeutic"
- disease/condition names framed as treated: anxiety disorder, depression, insomnia
  (as a *disorder*), chronic pain, PTSD, cancer, epilepsy, arthritis, glaucoma, nausea
  (as treatment), inflammation ("anti-inflammatory"), migraines, seizures
- "clinically proven", "doctor recommended", "FDA approved", "medical grade"
- "reduces/relieves pain", "lowers blood pressure", "kills cancer cells"

### The nuance the linter must handle
- "relaxing" = ALLOWED (experience). "relieves anxiety" = BLOCK (treats a condition).
- "helps you sleep" = WARN (borderline; suggests a therapeutic outcome) — surface a
  softer suggestion ("sleepy", "good for winding down" as experience). Owner reviews.
- "pain relief" / "relieves pain" = BLOCK (therapeutic). "heavy body effect" = ALLOWED.

---

## Severity model used by the linter

- **block**  — true medical/curative/therapeutic claim (WAC (iii)) or false/misleading.
- **warn**   — borderline phrasing that *leans* therapeutic ("helps with", "good for
               your ___", "aids", condition words without a treat-verb). Shown as a
               non-blocking warning the human can accept or rewrite.
- **allow**  — pure experience/effect/flavor descriptors (no action).

Owner rule: default to WARN; reserve BLOCK for unmistakable medical claims. Always
human-in-the-loop — the linter advises, staff decide (drafts-only).

---

## Existing guardrail data to extend
- `kb_banned_phrases` (0019): owner-managed phrase list w/ severity + reason.
- `seedMedicalBlocklistAction` already seeds a medical blocklist (KB compliance page).
- The linter should combine: built-in WA rules (this doc) + `kb_banned_phrases` overlay.
