# 01 — Standing Rules, Citation Rules, and the Handoff Protocol

## A. Owner's binding rules (verbatim, as spoken in this engagement)

These are quoted word-for-word from the owner (Michael Lyman, Greenway Marijuana, Port Orchard WA, I-502 retail licensee). They are not paraphrased and must not be paraphrased when repeated.

1. "do not guess, do not assume. we build from fact, not memory."
2. "be efficient with tokens, we are on a budget right now"
3. "recon everything you will touch before touching it"
4. "go above and beyond for me please."
5. "Test it, test the tests."
6. On this document: "create a detailed strategy roadmap for you, the ai, to follow. it should anchor code lines and work from verbatim authoritative sources. i want this roadmap task list todo list strategy document to lay out every single detail that needs to be worked on. if it is not included in this document, future ai agents will drift... this document should be thousands of lines long so that there is no possible way to drift from it. if you need to create this new roadmap strategy bible in multiple slices so it is supremely accurate, that is fine... recon, research, report in logical batches... follow the standing rules and never guess, never assume. go above and beyond. no code edits, more strategy... i do not plan on reading this document, it is for you. you do not need to condense it or summarize it... give yourself the full report, with everything included, anchors and pins and all."
7. On the hub (Q6): "one central command center/ HUB that allows me to do all work flows from that one centralized hub. if it is ccrs weekly upload related, it should live in the hub."
8. On InventoryTransfer (Q3): "if it is required by the lcb or ccrs, then yes i want InventoryTransfer.csv populated from those manifests... if not, please explain better what the advantage would be."
9. On medical (Q4): leave `IsMedical=FALSE` for now until the owner flips the switch (store is built and ready but not yet medically endorsed).
10. On WA.gov (Q7): start the transition work now; he believes only the login changes and the upload is identical — "if i am wrong about that, we should know sooner than later."
11. On the LCB error emails (Q5): YES to pasting them into the app so the ledger reflects the LCB verdict.
12. On history (Q1/Q2): NO uploads have ever been made from this system. Cultivera currently does the weekly upload as Greenway's integrator. Migration is soon. The upload process is "about the last thing we need to lock in and perfect." He has emailed his enforcement officer asking how to test uploads before going live.

The full dated log with what each answer changes is Part 05.

## B. Repository rules that constrain every slice (from `AGENTS.md`, verified this session)

- `main` is branch-protected. Merge ONLY with `gh pr merge <n> --rebase --delete-branch --admin`. **Never squash** (Vercel reads the git author; squash rewrites it to the bot and the deploy is BLOCKED — established by experiment, PRs #1090/#1091 vs #1092).
- Every commit author must be `Greenway Dev <dev@greenwaymarijuana.com>`; CI enforces via `scripts/compliance/verify-commit-authorship.ts`.
- Slice shape: ground → PURE `*-core.ts` logic + `__run…Tests()` → verify (tsc 0, eslint 0, next build ok) → branch → PR → rebase-merge. "Ship 6 slices at a time."
- Money in minor units (cents). Pacific time (`America/Los_Angeles`) is the business clock; calendar-day logic must anchor to Pacific, never UTC.
- Rule 11: receiving intake is the ONLY way product enters Greenway. The Cultivera menu import is one-time. Fix order for pipeline work: (1) receiving intake, (2) mastering/staging/publish, (3) POS/cart/promotions, (4) Cultivera last.
- CCRS section (binding): ground against the live LCB spec; every generated file must be upload-valid (3-row header, `NumberRecords` exact, exact template column row, `\r\n`, valid enums, text clamps, Pacific `MM/DD/YYYY`, stable external identifiers, order-of-operations groups); add guardrails not just fixes; keep `docs/ccrs-data-model.md` + `docs/ccrs-templates/` current; the living audit ledger is `docs/CCRS_COMPLIANCE_AUDIT.md`. There is ONE column spec: `CCRS_COLUMNS` in `src/lib/compliance/ccrs-batch-core.ts` (Part 03 §B).
- DOH medical section (binding): two exemptions never conflated; excise exempt only when endorsed retailer + valid in-MCR card + DOH-compliant product; `medical_exempt_sales` ledger retained 5 years.
- `repo/todo.md` is a TRACKED business document — never overwrite. Agent scratch: `/workspace/todo.md`, `/workspace/ccrs-notes.md`.
- Sandbox command cap is 240 s; long runs go `blocking=false` with output to a file.

Verified this session: `docs/ccrs-templates/*.csv` are byte-identical (md5) to the seven templates downloaded live from https://lcb.wa.gov/ccrs/resources on 2026-09-15. So the repo's template mirror is current; the *header-row padding* question (Part 12 U-03) is about the generator, not the mirror.

## C. Citation rules inside this bible

- Spec pins: `[G L0124]` = `lcb/guide.txt` line 124 as reproduced in Part 02 §1. `[FAQ L0039]` = Part 02 §2. `[API L0070]`, `[LOGIN L####]`, `[ADMIN L####]`, `[SAW L####]`, `[MANI L####]`, `[TPL Sales R1]`.
- Code pins: `path L###` or `path L###-L###`, always against the commit stamped at the top of Part 03. If you change the file, regenerate Part 03 in the same PR.
- Words that are LCB's are in quotes. Words that are ours are not. Never put our words in quotes attributed to LCB.
- A statement with no pin is an opinion. Opinions go in Part 12 (UNVERIFIED) or are deleted.
- Do not cite `docs/CCRS_SELF_REPORTING_GUIDE.md`, `docs/CCRS_COMMAND_CENTER_RESEARCH.md` or other repo prose as authority for a CCRS rule. They are downstream of the LCB documents and two of them are known to be stale (Part 04 §D).

## D. Standard slice protocol (binding order of operations for every slice in Part 09)

1. **Recon** — `git log -1`, `git status`, `git diff <atlas commit> -- <every file the slice names>`. If anything moved, regenerate Part 03 and re-pin the slice before writing code.
2. **Ground** — for every rule the slice enforces, copy the `[G …]`/`[FAQ …]` pin into the test file as a comment. A test without a pin is not allowed for CCRS rules.
3. **Tests first** — write the failing Vitest cases (and the `__run…Tests()` self-test for pure modules) before touching the implementation. Run them, confirm they fail for the right reason.
4. **Implement** in the named file at the named anchor. Pure logic in `*-core.ts`; I/O in the sibling non-core file; UI last.
5. **Verify** — `npx tsc --noEmit` (0), `npx eslint .` (0), `npx vitest run tests/compliance` (all green), `npm run build` (ok). Then re-run the golden fixture tests specifically (`tests/compliance/ccrs-batch.test.ts`) — any golden diff must be intentional and explained in the PR body with the spec pin that justifies it.
6. **Docs in the same PR** — update Part 04 (gap status), Part 12 (if an UNVERIFIED item was proven), `docs/CCRS_COMPLIANCE_AUDIT.md` ledger line, and regenerate Part 03.
7. **Branch + PR** — branch `ccrs/<slice-id>-<kebab>`; PR body must list: slice id, spec pins, code pins, tests added, verification output summary. Rebase-merge only.
8. **Handoff** — report in the owner's terms, plainly, what changed and what remains UNVERIFIED (Part 12 IDs). Attach the files that changed. Ask only when a decision is his (Part 05 shows which kinds are his).

## E. Things a future agent must NOT do (each has burned time before)

- Do not "improve" a CCRS file format from memory of other states' systems. WA CCRS is unique; the guide is the only authority.
- Do not assume a page or feature exists in the CCRS portal because a repo doc says so. Example: `docs/CCRS_SELF_REPORTING_GUIDE.md` A5.4 describes a "Processing Status (PST)" page; the Upload User Guide contains no such page, and the FAQ's "PST" is the time zone for filenames `[FAQ L0075]`.
- Do not assume there is no API. The FAQ still says "No. There is no Application Programming Interface (API) for CCRS." `[FAQ L0179]` but the August 2026 Integrator API Guide (Part 02 §3) exists. Both are true in their own scope: the API is for approved integrators; licensees upload via the portal.
- Do not treat a `warning`-severity finding as safe. Several current "warnings" describe conditions the guide lists as hard errors (Part 04, W1/W2/W4/W12/W15).
- Do not emit or test against production CCRS. All unknowns are settled in PREproduction (`https://precannabisreporting.lcb.wa.gov` `[API L0070]`), which "do[es] not share administration or reporting data" with production `[FAQ L0096]`.
- Do not create InventoryExternalIdentifiers that differ from what Cultivera already filed for existing stock (Part 07). CCRS has no read-back; the only proof of what was filed is a Public Records request `[FAQ L0142]` or Cultivera's own export (the Barcode column, `src/lib/pos/import-lot-core.ts` L17-L19, L47-L48).
- Do not write to `repo/todo.md`.
