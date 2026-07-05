# Cannabinoid KB Seed — Research-Backed Source Notes

**Purpose.** Ground the `kb_cannabinoids` pre-seed (Slice C) in verified, citable facts from
reputable sources. Per the standing rules: **never guess.** Every fact used in the seed below is
traceable to a source in the reference list. **Compliance constraint:** the KB stores only
**factual pharmacology / chemistry** — molecular identity, biosynthetic relationship (acidic
precursor → decarboxylation), and *intoxicating vs. non-intoxicating* classification. It stores
**NO** medical/therapeutic claims ("treats / helps / relieves / cures"). All seed prose is routed
through the existing `checkCompliance` gate before it can surface in retrieval.

**Authoritative compound vocabulary (already in the codebase).** The seed set is exactly the 8
compounds enumerated by `src/lib/naming/convention-core.ts` (`CannabinoidType`) and
`src/lib/leafly/types.ts` (`GreenwayCannabinoid.type`): **thc, thca, cbd, cbda, cbg, cbn, cbdv, cbc**.
THCV appears nowhere in the code vocabulary and is therefore **NOT** seeded (never guess / never
invent scope).

---

## Verified facts per compound

### THC — Δ9-tetrahydrocannabinol  (slug: `thc`)
- Molecular formula **C21H30O2**. [1]
- The **principal psychoactive / intoxicating** constituent of cannabis. [1]
- Not itself the plant's native form: it is produced by **decarboxylation of its acidic precursor
  THCA** (loss of CO2 driven by heat and/or time/aging). [1][3]
- Classification for KB: **intoxicating**. `is_acidic = false`. `decarbs_to = null`.

### THCA — tetrahydrocannabinolic acid  (slug: `thca`)
- The **acidic biosynthetic precursor** of THC; the dominant cannabinoid form actually present in
  living/fresh, un-heated cannabis. [1][3]
- **Non-intoxicating** in its acidic form; on heating (smoking, vaping, cooking) it
  **decarboxylates to THC**. [1][3]
- Classification for KB: **non-intoxicating (acidic precursor)**. `is_acidic = true`.
  `decarbs_to = "thc"`.

### CBD — cannabidiol  (slug: `cbd`)
- Molecular formula **C21H30O2**. [2]
- **Non-intoxicating**; has **very weak affinity for CB1 and CB2** receptors (i.e. it does not
  produce the CB1-driven intoxication that THC does). [2]
- Produced by **decarboxylation of its acidic precursor CBDA**. [2][3]
- Classification for KB: **non-intoxicating**. `is_acidic = false`. `decarbs_to = null`.

### CBDA — cannabidiolic acid  (slug: `cbda`)
- The **acidic biosynthetic precursor** of CBD, present in fresh/un-heated plant material. [2][3]
- **Non-intoxicating**; **decarboxylates to CBD** with heat/time. [2][3]
- Classification for KB: **non-intoxicating (acidic precursor)**. `is_acidic = true`.
  `decarbs_to = "cbd"`.

### CBG — cannabigerol  (slug: `cbg`)
- Molecular formula **C21H32O2**. [4]
- Often called the **"mother cannabinoid"**: its acidic form **CBGA (cannabigerolic acid) is the
  single common intermediate** from which the plant's enzymes biosynthesize the acidic precursors
  of THC (THCA), CBD (CBDA) and CBC (CBCA). [4][5]
- **Non-intoxicating**; typically a **minor** cannabinoid in finished material. [4]
- Classification for KB: **non-intoxicating**. `is_acidic = false`. `decarbs_to = null`.

### CBN — cannabinol  (slug: `cbn`)
- Molecular formula **C21H26O2**; PubChem CID **2543**. [6]
- **Mildly psychoactive**: a **low-affinity partial agonist at CB1**, so much **higher doses are
  required to experience intoxicating effects** than with THC. [6]
- **Unique origin:** CBN does **not** arise from its own acidic precursor — it is a
  **degradation/oxidation product of THC**, forming mostly in **aged/stored** cannabis on exposure
  to **oxygen, heat and light**. [6]
- Classification for KB: **mildly psychoactive (THC oxidation product)**. `is_acidic = false`.
  `decarbs_to = null`.

### CBC — cannabichromene  (slug: `cbc`)
- Molecular formula **C21H30O2**; PubChem CID **30219**. [7]
- **Non-intoxicating**; binds only **weakly** to CB1/CB2 (much lower affinity than THC). [7]
- Occurs in the plant mainly as its acidic precursor **CBCA**, which is formed from **CBGA** by
  CBCA synthase and **decarboxylates to CBC** over time or when heated. [7][3]
- Classification for KB: **non-intoxicating**. `is_acidic = false`. `decarbs_to = null`.

### CBDV — cannabidivarin  (slug: `cbdv`)
- A **propyl (varin) analog of CBD** — structurally the CBD homolog with a shorter (propyl vs.
  pentyl) side chain — grouped with the cannabidiols. [8]
- **Non-intoxicating** (a minor cannabinoid). [8]
- Classification for KB: **non-intoxicating (propyl analog of CBD)**. `is_acidic = false`.
  `decarbs_to = null`.

---

## Biosynthesis summary (verified, used for `decarbs_to` / relationships)
- **CBGA** is the common parent → enzymes convert it to **THCA, CBDA, CBCA**. [3][4][5]
- **Decarboxylation** (heat / time) converts the acids to the neutrals:
  **THCA→THC, CBDA→CBD, CBCA→CBC** (and CBGA→CBG). [1][2][3][7]
- **CBN** is the exception: it forms by **oxidation of THC** in aged material, not from an acid
  precursor. [6]

## Compliance handling of the "what it does" text
- Allowed in KB prose: molecular identity, "**intoxicating**" vs "**non-intoxicating**" vs "**mildly
  psychoactive**", "**acidic precursor**", "**decarboxylates to X**", "**degradation product of
  THC**", relative **abundance** (major/minor), and neutral **receptor-affinity** facts
  ("weak/low affinity for CB1"). These are chemistry, not medical claims.
- **Prohibited** (and stripped by `checkCompliance`): any "treats / helps / relieves / cures /
  reduces / anti-anxiety / sleep aid / pain" style therapeutic assertion. The seed prose is written
  to contain none.

---

## References
1. Tetrahydrocannabinol — Wikipedia. https://en.wikipedia.org/wiki/Tetrahydrocannabinol
2. Cannabidiol — Wikipedia. https://en.wikipedia.org/wiki/Cannabidiol
3. Decarboxylation / phytocannabinoid biosynthesis (CBGA → THCA/CBDA/CBCA; decarb to neutrals) —
   Wikipedia (Cannabinol §Biosynthesis diagram; Cannabichromene §Biosynthesis).
   https://en.wikipedia.org/wiki/Cannabichromene
4. Cannabigerol — Wikipedia. https://en.wikipedia.org/wiki/Cannabigerol
5. Cannabigerolic acid (CBGA, "sole intermediate for all other phytocannabinoids") — Wikipedia.
   https://en.wikipedia.org/wiki/Cannabigerolic_acid
6. Cannabinol — Wikipedia (formula C21H26O2, PubChem CID 2543, low-affinity CB1 partial agonist,
   THC oxidation product in aged material). https://en.wikipedia.org/wiki/Cannabinol
7. Cannabichromene — Wikipedia (formula C21H30O2, PubChem CID 30219, weak CB1/CB2, CBCA→CBC).
   https://en.wikipedia.org/wiki/Cannabichromene
8. Cannabidivarin — Wikipedia (propyl analog of CBD). https://en.wikipedia.org/wiki/Cannabidivarin
