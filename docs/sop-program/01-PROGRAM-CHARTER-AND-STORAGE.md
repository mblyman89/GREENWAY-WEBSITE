# SOP Program — Charter, Audit Method, Storage Strategy

Slice SOP-00 · 2026-10-27 · audited at `main@54445a68` · **no code edits in this slice**

## 1. Goal

1. Write one **enterprise-grade SOP** for every back-office operation the owner listed (catalog: `02-SOP-CATALOG-AND-ROADMAP.md`).
2. Use the act of writing each SOP as a **line-by-line audit** of that pipeline, recorded in `03-FINDINGS-LEDGER.md`, without fixing anything.
3. Keep a running **concierge coverage ledger** (`04-CONCIERGE-COVERAGE-LEDGER.md`).
4. Once every SOP is safely on the repo, **integrate them into the Employee area** (read, download, print), then hold the patch-strategy discussion over the ledger.

## 2. Phases

| Phase | What | Code edits? |
|---|---|---|
| **A. Recon + roadmap** | This slice (SOP-00) | No |
| **B. Audit + write SOPs** | SOP-01 … SOP-20, one per slice | **No** (docs only, under `docs/sop/`) |
| **C. Strategy session** | Owner + me walk the findings ledger and the gap list; owner decides what to build or fix and in what order | No |
| **D. Integrate** | Build the SOP library in the app, wire the concierge, add print/export | Yes (normal rule-5 slices) |
| **E. Patch** | Fix ledger items in the owner's chosen order | Yes |

Phases D and E follow all standing rules: pure `*-core.ts` + `__run…Tests()`, tsc/eslint/build green, branch → PR → **rebase merge**, authored `Greenway Dev`.

## 3. The per-slice audit method (Phase B, repeated for every SOP)

Every SOP slice runs the same 8 steps (plus the two standing rules 9 and 10 below), so the work is repeatable and nothing is guessed:

1. **Scope from the tree, not memory.** List every route (`src/app/admin/**`, `src/app/api/**`, `src/app/(site)/pos/**`), lib module, component, migration and test that the pipeline touches. Commit that list as the SOP's *Source Map* appendix.
2. **Read the gates.** For every page and action, record `requirePermission(...)` / `requireStaff()` / PIN-role sets (e.g. `APPROVER_ROLES = manager|lead`), and map them to *who can do this step*.
3. **Read the hard blocks.** Grep every refusal string (`error:`, `refused`, `ok: false`, `throw`) in the cores and routes of that pipeline. Each becomes a row in the SOP's **"If you see this message"** table, with the exact wording, the reason and the fix.
4. **Trace the data.** Follow the request → validation core → store → table → ledger/CCRS side-effects. Note every non-atomic write, ignored error, read-then-act check and money conversion (ledger types BUG/HARDEN).
5. **Check against authority.** Compliance steps (CCRS, WAC, DOH, cash handling) are pinned to the existing bibles (`docs/ccrs-bible/`, `docs/medical-doh-requirements.md`, `docs/RETURNS_DESTRUCTION_COMPLIANCE.md`, etc.). No new legal claims without a source.
6. **Compare to the owner's request.** Every requested behaviour is marked EXISTS / PARTIAL / MISSING. Missing items become `GAP` findings and are written into the SOP as *"Not built yet — interim paper procedure: …"* so staff still have a procedure today.
7. **Write the SOP** to the standard template (§5).
8. **Update the ledgers** (findings + concierge), commit, push the branch, open the PR, rebase-merge, and verify production per rule 13 (docs-only changes still go through the gate).

9. **Living SOPs: update the SOP when the app changes** (owner decision D41: *"We will eventually build and fix everything, so leave a reminder that I want to update the sop when necessary."*). An SOP describes the app **as it is today**. Every gap names the SOP sections it changes (the **SOP** column in `05-GAP-REGISTER.md`). **A gap is not closed until** (a) those sections are rewritten to the new behaviour, (b) the SOP's interim paper procedure for that gap (Appendix B) is removed or reduced, (c) a revision-history row is added with the new version, (d) the finding is marked FIXED in `03-FINDINGS-LEDGER.md` with the fixing commit, and (e) the concierge entry is updated (rule 10). Every SOP carries a reminder banner under its header table saying exactly this.
10. **The concierge grows with the program** (owner decision D42: *"I want to upgrade the concierge to use all features including future ones we will build after the sop is finished."*). After the last SOP, the concierge is upgraded to answer from **every** SOP and every feature (Phase D, `04-CONCIERGE-COVERAGE-LEDGER.md` §4 point 6). From then on, **a new feature is not finished until its concierge entry exists**: it is added in the same change that ships the feature, and checked by the same compliance test that keeps the SOP data and the Markdown in step (§4.2 point 2).

Where a behavior can only be proven against the live database (e.g. F-00-3's uuid failure), the SOP slice marks it `SUSPECTED`. It is proven in Phase E with a test, never against production data.

## 4. Storage strategy: how SOPs live in the Employee area (decided now, built in Phase D)

### 4.1 What already exists and gets reused (Standing Rule 4)
- `/admin/sop` + `/admin/sop/[slug]`: printable sheet pages driven by the pure `src/lib/catalog/sop-core.ts` (`SopDoc` type), using the house print pattern (`print:hidden` chrome + `PrintButton`, letter size, black-on-white).
- `SopSheetLink` is already embedded in 9 HelpPanels ("Prefer paper? Print the one-page SOP").
- `/admin/staffing/handbook` + `PrintHandbookButton` + the **versioned acknowledgment gate** (`handbook-ack-core.ts`) are the precedent for "read it, sign it, re-sign when it changes".
- CSV/XLSX export routes are a house pattern (`exceljs`, `xlsx`, `…/export/route.ts`).

### 4.2 Proposed design (for owner approval at Phase C)
1. **Source of truth = Markdown in the repo** (`docs/sop/SOP-XX-*.md`), written in Phase B. Reviewable in GitHub, diffable, versioned by git.
2. **App source = data, generated from the Markdown** into a pure `src/lib/sop/sop-library-core.ts` (extending the `SopDoc` shape with `version`, `audience/permission`, `sections`, `blocks[]`, `checklists[]`). A compliance test fails the build if the Markdown and generated data drift. This is what feeds the concierge (coverage ledger §4).
3. **New Employee-tab entry "SOP Library"** at `/admin/sop` (the route already exists, so nothing breaks) gated `dashboard.view`, with per-SOP `permission` filtering. A budtender sees register, clock, cleaning and online-order SOPs. A manager also sees cash oversight, receiving and inventory. Owner-only SOPs (inventory audit approval, books) are visible only to the owner. This fixes F-00-10.
4. **Each SOP gets three outputs:**
   - **Read**: the on-screen page with a table of contents, search, and "Where do I click" links to the real pages.
   - **Print**: a print stylesheet with page numbers, version/date footer, "Uncontrolled when printed — check version vX.Y" (an enterprise document-control convention), and a sign-off block.
   - **Download**: PDF via the browser print dialog ("Save as PDF", zero new dependencies), plus a **.md download** of the source. Checklists (cleaning, opening/closing, master till, EOD) also get a **CSV/XLSX blank-sheet export**.
5. **Acknowledgment tracking (recommended).** Reuse the handbook-ack pattern: each SOP has a version, and an employee clicks "I have read and understand SOP-01 v1.0". The Employees file shows which SOPs each person has acknowledged. Optional: block register unlock until SOP-01 is acknowledged, exactly as the handbook gate does today. **Owner decision Q1.**
6. **Contextual links.** Each page's HelpPanel gets a `SopSheetLink` to the relevant SOP section (the pattern already exists).

## 5. SOP document standard (every SOP uses this template)

```
SOP-XX — <Title>                         Version 1.0 · Effective <date> · Owner: Michael Lyman
1. Purpose & scope            (why, who it applies to, what it does NOT cover)
2. Roles & permissions        (table: step → role → system permission/PIN gate)
3. Before you start           (prerequisites, hardware, logins)
4. Procedures                 (numbered, one task per subsection, every step = action + where + expected result)
5. Hard blocks — "If you see this message"   (exact text · why · what to do · who to call)
6. Exceptions & escalation    (what to do when the normal path fails; manager/owner contact)
7. Controls & compliance      (why the rules exist: WAC/RCW/CCRS/DOH pins, cash controls)
8. Checklists & forms         (printable; sign-off lines)
9. Quick reference card       (one page, laminatable)
10. Glossary
Appendix A — Source map       (files/routes this SOP was verified against, at commit <sha>)
Appendix B — Not built yet    (requested behaviours that do not exist; interim paper procedure; ledger IDs)
Appendix C — Revision history
```

Writing rules: plain language, written for a new hire on day one. Exact on-screen labels in **bold**. Money in dollars on paper (the code keeps cents). Pacific time. Never describe a feature that doesn't exist as if it does.

## 6. File layout

```
docs/sop-program/            ← program records (this folder)
  00-OWNER-REQUEST-VERBATIM.md
  01-PROGRAM-CHARTER-AND-STORAGE.md
  02-SOP-CATALOG-AND-ROADMAP.md
  03-FINDINGS-LEDGER.md
  04-CONCIERGE-COVERAGE-LEDGER.md
  05-GAP-REGISTER.md          ← (created in SOP-01) owner-requested features that don't exist, for Phase C
docs/sop/                    ← the SOPs themselves (created from SOP-01 on)
  SOP-01-register-operations.md
  …
```
