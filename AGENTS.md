<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:greenway-standing-rules -->
# Greenway Back-Office — Standing Rules (BINDING)

These rules govern ALL work in this repository. They are owner-mandated and permanent.

1. **Record every request verbatim.** Capture the owner's words word-for-word before acting.
2. **Deep-research every topic. Ground all decisions in verified fact — never guess.** Cite the authoritative source. If unsure, STOP and ask.
3. **AI / crawler / machine output is DRAFTS-ONLY.** An employee validates before it becomes truth. Never silently invent a value; surface a precise warning for the human to resolve.
4. **Walk the file tree repeatedly.** Do not assume something doesn't exist — verify. Reuse existing, verified work instead of rebuilding it.
5. **Ship 6 slices at a time.** Each slice: ground → PURE `*-core.ts` logic + `__run…Tests()` → verify (tsc 0, eslint 0, next build ok) → branch → PR → **rebase-merge** (rule 6) → sync main.
6. **`main` is branch-protected, and REBASE MERGE is the only way in.** Owner-authorized, permanent. Every change goes through a branch + PR, merged with `gh pr merge <n> --rebase --delete-branch --admin`. Never a merge commit, never a direct push to `main`. History stays linear, so any slice can be reverted as a unit.

   **Never squash-merge in this repository.** This is not a style preference, it is a deployment constraint, and it was established by direct experiment on this repo rather than assumed. A squash merge performed by the automation token rewrites the commit **author** to `superninja-app[bot]`, which belongs to no team member, and Vercel then refuses the deployment with **BLOCKED** and no build logs (rule 7). Measured on throwaway `zz-lab/*` branches:

   | merge method | commits in PR | resulting author | Vercel |
   | --- | --- | --- | --- |
   | squash | 2 (PR #1090) | `superninja-app[bot]` | BLOCKED |
   | squash | 1 (PR #1091) | `superninja-app[bot]` | BLOCKED |
   | rebase | 3 (PR #1092) | `Greenway Dev <dev@greenwaymarijuana.com>` on all 3 | builds |

   Rebase merge rewrites each commit's **committer** to the bot but leaves the **author** intact, and Vercel reads the author. Note that a rebase merge changes commit SHAs, so after merging, re-sync local `main` with `git fetch origin && git reset --hard origin/main` instead of assuming the branch SHAs survived. Keep Supabase migrations **idempotent** (owner applies them MANUALLY in the SQL editor).
7. **Every commit MUST be authored `Greenway Dev <dev@greenwaymarijuana.com>`.** This is a DEPLOYMENT PRECONDITION, not a preference. Vercel resolves the git author email to a GitHub account and refuses to build when that account is not a team member — the deployment shows **BLOCKED with no build logs**, which looks nothing like a build failure and cannot be diagnosed from CI. `dev@greenwaymarijuana.com` is verified on the owner's GitHub account `mblyman89`; Slice 13 was authored `superninja@ninjatech.ai`, which belongs to no GitHub account, and was blocked. **Set the identity before the first commit of every session** — git does not error on an unset identity, it silently invents one from the hostname:
   ```
   git config user.name  "Greenway Dev"
   git config user.email "dev@greenwaymarijuana.com"
   ```
   Enforced by `scripts/compliance/verify-commit-authorship.ts` in CI. Because a rebase merge (rule 6) preserves each commit's author verbatim, the branch author is exactly what lands on `main` — so the identity must be right **on the branch**, before the merge. CI cannot catch it after the fact, because a merge that rewrites authorship produces a commit that no CI run ever inspected.
8. **Money in MINOR UNITS (cents).** Convert only at the boundary.
9. **Pacific time is the business clock.** Greenway operates in `America/Los_Angeles`. Any calendar-day / reporting-period logic MUST anchor to Pacific, never raw UTC.
10. **Prefer non-blocking narrative updates;** only use `ask` for essential decisions. Use best judgment even when it's harder.

## 🔴 CCRS COMPLIANCE — ALWAYS CHECK AND SATISFY (BINDING)

The POS / back office MUST strictly adhere to the WA LCB **Cannabis Central Reporting
System (CCRS)** at all times. Compliance protects the owner's license. For ANY change
that touches inventory, sales, products, strains, areas, adjustments, transfers, tax,
manifests, or any file/data the LCB ingests, you MUST:

- **Ground against the authoritative spec — never guess a CCRS field, column, enum,
  format, or rule.** Verified sources (re-verify against the LIVE current versions):
  - CCRS Resources + current `.CSV` templates: https://lcb.wa.gov/ccrs/resources
  - **CCRS Data Model File Specifications Manual** (PDF) — field types, lengths,
    required flags, and **valid-value enums** (SaleType, StrainType,
    InventoryCategory/Type, AdjustmentReason, Boolean columns, etc.).
  - CCRS Upload User Guide (CIB / dated) and `docs/ccrs-data-model.md`,
    `docs/ccrs-templates/*.csv` (kept in sync with the live templates).
  - Manifests: https://lcb.wa.gov/ccrs/manifests
- **Every generated CCRS file MUST be upload-valid:**
  - The **3-row common header** (`SubmittedBy,<v>` / `SubmittedDate,<v>` /
    `NumberRecords,<v>`) with `NumberRecords` EXACTLY equal to the data-row count,
    then the exact template **column header row**, then data rows. Use `\r\n`.
  - **Exact template column names + order** (e.g. Sale uses `RetailSalesTax` /
    `CannabisExciseTax`; InventoryAdjustment includes its own `ExternalIdentifier`).
    There is ONE authoritative column spec: `src/lib/compliance/ccrs-batch-core.ts`
    `CCRS_COLUMNS`. Do not duplicate/diverge it.
  - **Valid enum values only** — validate SaleType, StrainType,
    InventoryCategory/InventoryType, AdjustmentReason, Booleans (`TRUE`/`FALSE`)
    against the Data Model Manual. Unknown values → keep the value but raise an
    **error-level sync warning** for the employee; never invent one.
  - **Text-length clamps** per the manual (e.g. Product.Name 75, Description 250).
  - **Pacific calendar dates** (`pacificDayKey`) formatted `MM/DD/YYYY` — never UTC.
  - **Stable, non-drifting external identifiers** reused consistently across files
    (`src/lib/compliance/ccrs-identifiers.ts`).
  - Respect the **order-of-operations** groups (Strain/Area/Product → Inventory →
    Adjustment/Transfer/Sale) and CCRS rules (e.g. no sale of quarantined inventory).
- **Add guardrails, not just fixes.** Prefer PURE, unit-tested normalize/validate
  layers that flag non-conformant data BEFORE it can be uploaded (CCRS only notifies
  failures by email, so catch them here).
- **Keep the spec docs current.** When the LCB updates a template/manual, update
  `docs/ccrs-data-model.md` + `docs/ccrs-templates/` and re-verify generators.
- The living audit + findings ledger is `docs/CCRS_COMPLIANCE_AUDIT.md`.

## 🔴 DOH MEDICAL CANNABIS COMPLIANCE — ALWAYS RESPECT (BINDING)

The medical program MUST strictly adhere to WA **DOH** (Medical Cannabis Registry / MCR)
and the medical provisions of LCB rules at all times. Compliance protects the owner's
license and the patient. For ANY change that touches medical patients, recognition
cards, authorization intake, tax exemptions (sales/excise), possession/purchase limits,
DOH-compliant products, or the medical audit trail, you MUST:

- **Ground against the authoritative sources — never guess a DOH rule, field, rate,
  limit, or date.** Verified sources (re-verify against the LIVE current versions):
  - DOH **Medical Cannabis Registry (MCR)** program page (replaced "Airlift" on
    2025-06-30). There is **NO public retailer API** — staff validate cards by logging
    into the MCR; our system stores the **validation result**, it never calls the MCR.
  - **RCW 69.51A** (esp. `.230` recognition-card unique patient identifier / dates),
    **RCW 69.50.375/.535**, **HB 1453** (DOH 608-050 FAQ), **DOH 608-048** (authorization-
    form validation checklist), **WAC 314-55-090** (recognition-card sales + the
    `(2)` excise-exempt recordkeeping, 5-yr retention; `(6)` exemption sunset
    **2029-06-30**), **WAC 246-70-040** (DOH-compliant product), **WAC 314-55-095**
    (purchase limits). The living reference is `docs/medical-doh-requirements.md`.
- **Never issue a card unless DOH 608-048 is fully satisfied.** All four form checks
  (complete/signed, tamper-resistant paper w/ security feature, identity verified,
  embossed RCW 69.51A.030 seal) MUST be verified server-side. If ANY cannot be
  verified → do NOT create a card. A UPID is required whenever the patient is marked
  in the MCR; effective ≤ expiration; never issue an already-expired card.
- **Two tax exemptions — never conflate them.** Sales tax (9.3%) exempt for a
  carded patient/DP buying ANY cannabis at a medically-endorsed store. Excise (37%)
  exempt ONLY when ALL THREE hold: endorsed retailer + valid **in-MCR** card + product
  is **DOH-compliant** (WAC 246-70-040). An expired/invalid card grants NO exemption.
- **Retain the WAC 314-55-090(2) record for every excise-exempt sale for 5 years**
  (date, UPID, card effective + expiration, product SKU, sales price). If we cannot
  produce it, excise is presumed owed. Keep the durable `medical_exempt_sales` ledger.
- **Enforce the 3× carded purchase limits** (WAC 314-55-095: 3 oz usable, 48 oz
  solid, 216 oz infused-liquid, 21 g concentrate) for carded patients.
- **Protect PHI.** Scanned authorization forms and patient data are sensitive: keep
  them in the PRIVATE `medical-forms` bucket (staff-only), never public; audit access.
- **Add guardrails, not just fixes** — PURE, unit-tested validate layers that BLOCK a
  non-compliant card/exemption before it can happen. Drafts-only for anything crawled.
- The living reference is `docs/medical-doh-requirements.md`; keep it current.
<!-- END:greenway-standing-rules -->
