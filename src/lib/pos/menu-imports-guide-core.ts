/**
 * R50 S10b — the Menu Imports step-by-step migration guide (pure, no I/O).
 *
 * Owner follow-up #5: "completely revamp the menu import page, all of the
 * helpers need to be updated completely to help with the new process. Any
 * links or buttons or help text and such should be modified, updated, and
 * significantly enhanced to make it easy to read and follow the steps."
 *
 * The guide is an ordered checklist of the real migration path, from the one
 * Fetch button to the first CCRS clean-up upload, then day-to-day receiving.
 * Each step's status comes ONLY from facts the Menu Imports page already reads
 * (cutover verdict, recent fetch runs, import rows, crawler configured). Any
 * step this page cannot prove is "check" (go look), never "done". An unknown
 * cutover read never claims progress: every step degrades to "check".
 */

import { rehomeHref } from "@/lib/inventory/cultivera-rehome-ui-core";
import { IMPORT_PAGE_ANCHORS, missingProductsHref } from "@/lib/pos/pos-import-fix-core";
import { CUTOVER_RUNBOOK_HREF } from "@/lib/inventory/cutover-guard-core";
import { RECEIVING_PATH } from "@/lib/inventory/receiving-table-core";

export type GuideStatus = "done" | "next" | "todo" | "check" | "blocked";

export const GUIDE_STATUS_LABEL: Record<GuideStatus, string> = {
  done: "Done",
  next: "Do this next",
  todo: "Later",
  check: "Check",
  blocked: "Set up first",
};

export type GuideLink = { href: string; label: string };

export type GuideStep = {
  key: GuideStepKey;
  n: number;
  title: string;
  body: string;
  status: GuideStatus;
  /** Why the status is what it is, in one plain sentence. */
  why: string;
  links: GuideLink[];
};

export const GUIDE_STEP_KEYS = [
  "fetch",
  "go_no_go",
  "stage",
  "review",
  "publish",
  "count",
  "manifests",
  "onboarding",
  "ccrs_cleanup",
  "receiving",
] as const;
export type GuideStepKey = (typeof GUIDE_STEP_KEYS)[number];

/** Static hrefs the guide links to (all real routes; pinned by tests). */
export const GUIDE_HREF = {
  runbook: CUTOVER_RUNBOOK_HREF,
  fetchRun: (runId: string) => `/admin/menu-imports/fetch/${encodeURIComponent(runId)}`,
  importReview: (importId: string) => `/admin/menu-imports/${importId}`,
  facts: (importId: string) => `/admin/menu-imports/${importId}/facts`,
  diagnostics: (importId: string) => `/admin/menu-imports/${importId}#${IMPORT_PAGE_ANCHORS.diagnostics}`,
  publishSection: (importId: string) => `/admin/menu-imports/${importId}#publish`,
  publish: "/admin/publish",
  onboarding: "/admin/inventory/drafts",
  receivingCultivera: `${RECEIVING_PATH}?view=cultivera`,
  receiving: RECEIVING_PATH,
  ccrsCleanup: "/admin/compliance/ccrs#migration-garbage",
  ccrsFiles: "/admin/compliance/ccrs#ccrs-files",
  count: "/admin/menu-imports/count",
  // R50 A2: the go / no-go units check (Cultivera file = our lots).
  reconcile: (importId: string | null) => (importId ? `/admin/menu-imports/reconcile?import=${importId}` : "/admin/menu-imports/reconcile"),
} as const;

export type GuideImportRow = {
  id: string;
  status: string;
  is_test?: boolean | null;
  created_at: string;
};

export type GuideCutover =
  | { done: false; unknown: boolean }
  | { done: true; first: { importId: string; publishedAt: string } };

export type GuideInput = {
  cutover: GuideCutover;
  crawlerConfigured: boolean;
  /** Recent fetch run ids, newest first (listPosRuns order). */
  recentRuns: readonly string[];
  /** Import rows (listImports order, newest first). */
  imports: readonly GuideImportRow[];
};

/** The newest real (non-test) import waiting on review: status "staged". */
export function latestRealStaged(imports: readonly GuideImportRow[]): GuideImportRow | null {
  let best: GuideImportRow | null = null;
  for (const r of imports) {
    if (!r || r.is_test === true || r.status !== "staged" || typeof r.id !== "string" || r.id === "") continue;
    if (!best || String(r.created_at) > String(best.created_at)) best = r;
  }
  return best;
}

/** Build the ordered guide. Exactly one step is "next" unless the import is done or unknown. */
export function buildMenuImportsGuide(input: GuideInput): GuideStep[] {
  const cut = input.cutover;
  const unknown = !cut.done && cut.unknown;
  const done = cut.done;
  const runs = (input.recentRuns ?? []).filter((r) => typeof r === "string" && r.trim() !== "");
  const latestRun = runs[0] ?? null;
  const staged = latestRealStaged(input.imports ?? []);
  const migratedImportId = done ? cut.first.importId : null;
  const reviewImportId = migratedImportId ?? staged?.id ?? null;

  const steps: GuideStep[] = [];
  const push = (s: Omit<GuideStep, "n">) => steps.push({ ...s, n: steps.length + 1 });

  // 1) Fetch
  push({
    key: "fetch",
    title: "Fetch everything from Cultivera",
    body: "Press the Fetch button once. It logs in to Cultivera POS read-only and pulls every lot, product, manifest and batch. Nothing in Cultivera changes. It takes about 8 minutes.",
    status: done ? "done" : !input.crawlerConfigured ? "blocked" : latestRun ? "done" : "todo",
    why: done
      ? "The Cultivera import is already live."
      : !input.crawlerConfigured
        ? "The crawler is not connected yet, so the Fetch button is off."
        : latestRun
          ? `A fetch has run (latest: ${latestRun}).`
          : "No fetch has run yet.",
    links: [{ href: "#fetch-cultivera", label: "Go to the Fetch button" }, { href: GUIDE_HREF.runbook, label: "Cutover runbook" }],
  });

  // 2) Go / no-go
  push({
    key: "go_no_go",
    title: "Read the go / no-go report",
    body: "Open the fetch run. It must say GO: every lot present, units and cost matching to the cent, nothing hidden. A NO-GO names exactly what is wrong. Fix it or fetch again.",
    status: done ? "done" : staged ? "done" : latestRun ? "check" : "todo",
    why: done
      ? "The import passed and went live."
      : staged
        ? "A harvest was staged, which needs a GO."
        : latestRun
          ? "Open the latest run and confirm it says GO."
          : "Waits on a fetch.",
    links: latestRun ? [{ href: GUIDE_HREF.fetchRun(latestRun), label: `Open run ${latestRun}` }] : [],
  });

  // 3) Stage
  push({
    key: "stage",
    title: "Stage the harvest for review",
    body: "On a GO run, press \u201cStage this harvest for review\u201d. That builds a draft menu. Nothing goes live yet.",
    status: done || staged ? "done" : "todo",
    why: done ? "Staged and published." : staged ? "A real import is staged and waiting for review." : "Nothing is staged yet.",
    links: latestRun && !done && !staged ? [{ href: GUIDE_HREF.fetchRun(latestRun), label: "Stage from the run page" }] : [],
  });

  // 4) Review
  push({
    key: "review",
    title: "Review the import: facts, warnings, types",
    body: "Open the import. Work Fact Review (each fact needs a yes or a fix), clear the diagnostics warnings with their Fix links, and check the type and category list.",
    status: done ? "done" : staged ? "check" : "todo",
    why: done
      ? "The publish gate passed, so review was complete."
      : staged
        ? "This page can't see the review queue. Open the import to see what is left."
        : "Waits on a staged import.",
    links: reviewImportId
      ? [
          { href: GUIDE_HREF.importReview(reviewImportId), label: "Open the import" },
          { href: GUIDE_HREF.facts(reviewImportId), label: "Fact Review" },
          { href: GUIDE_HREF.diagnostics(reviewImportId), label: "Warnings to fix" },
        ]
      : [],
  });

  // 5) Publish
  push({
    key: "publish",
    title: "Publish the Cultivera menu",
    body: "Press Publish on the import page (a manager or admin). That makes the menu live and creates the compliance lots. Publish Cultivera first, then receive.",
    status: done ? "done" : "todo",
    why: done ? "The Cultivera menu is live." : "Not published yet.",
    links: reviewImportId && !done ? [{ href: GUIDE_HREF.publishSection(reviewImportId), label: "Go to Publish" }] : [],
  });

  // 6..10 happen after the import is live. This page doesn't read them, so they are
  // "check" once done, otherwise "todo".
  const after: GuideStatus = done ? "check" : "todo";
  push({
    key: "count",
    title: "Apply the Oct 30 shelf count",
    body: "Before the count, download one scan workbook per counter. After publish, upload the scanned workbooks. You see every lot's move first (counted, minus the sales on the 31st), and nothing changes until you confirm.",
    status: after,
    why: done ? "Open the count page. It shows whether the count was applied." : "The upload opens after publish. Workbooks can be downloaded before.",
    links: [
      { href: GUIDE_HREF.count, label: "Oct 30 shelf count" },
      { href: GUIDE_HREF.reconcile(migratedImportId), label: "Go / no-go: do the units balance?" },
    ],
  });
  push({
    key: "manifests",
    title: "Rebuild the Cultivera manifests",
    body: "Put each migrated lot back on the real delivery it arrived on. You see a preview first, and only the manifest changes.",
    status: after,
    why: done ? "Open the preview. It says when every lot is already home." : "Opens after publish.",
    links: migratedImportId ? [{ href: rehomeHref(migratedImportId), label: "Rebuild manifests (preview first)" }] : [],
  });
  push({
    key: "onboarding",
    title: "Work Onboarding and the missing products",
    body: "Approve the rebuilt products on Product Onboarding. Lots with no product master are listed under Missing products.",
    status: after,
    why: done ? "Open Onboarding to see what is still waiting." : "Opens after publish.",
    links: [
      { href: GUIDE_HREF.onboarding, label: "Product Onboarding" },
      ...(migratedImportId ? [{ href: missingProductsHref(migratedImportId), label: "Missing products" }] : []),
    ],
  });
  push({
    key: "ccrs_cleanup",
    title: "Clean up migrated garbage at the first CCRS upload",
    body: "Dead lots from Cultivera (no product master, no barcode, no received date) are flagged on the CCRS hub. They are zeroed out in CCRS by Reconciliation in your first upload, never sent as a Delete. Fixable rows are listed so you can fix them instead.",
    status: after,
    why: done ? "Open the clean-up panel to see what is still open." : "Opens after publish.",
    links: [
      { href: GUIDE_HREF.ccrsCleanup, label: "Migration clean-up (CCRS)" },
      { href: GUIDE_HREF.ccrsFiles, label: "CCRS files" },
    ],
  });
  push({
    key: "receiving",
    title: "Receive from now on",
    body: "From here on, receive deliveries and approve each product with a price. Approval publishes it automatically. Use the Cultivera view in Receiving to see which migrated manifests still need attention.",
    status: after,
    why: done ? "Day to day happens in Receiving." : "Opens after publish.",
    links: [
      { href: GUIDE_HREF.receivingCultivera, label: "Cultivera manifests in Receiving" },
      { href: GUIDE_HREF.receiving, label: "Receiving" },
    ],
  });

  if (unknown) {
    // Never claim progress on an unknown read.
    for (const s of steps) {
      s.status = "check";
      s.why = "We couldn't confirm the import status just now. Reload to check.";
    }
    return steps;
  }
  // Exactly one "next": the first not-done, not-blocked step.
  const firstOpen = steps.find((s) => s.status !== "done" && s.status !== "blocked");
  if (firstOpen && !done) firstOpen.status = "next";
  return steps;
}

export type GuideSummary = { done: number; total: number; headline: string };

export function guideSummary(steps: readonly GuideStep[]): GuideSummary {
  const total = steps.length;
  const doneN = steps.filter((s) => s.status === "done").length;
  const next = steps.find((s) => s.status === "next");
  const blocked = steps.find((s) => s.status === "blocked");
  const headline = blocked
    ? `Set up first: ${blocked.title}.`
    : next
      ? `Step ${next.n} of ${total}: ${next.title}.`
      : doneN >= 5 && steps.slice(0, 5).every((s) => s.status === "done")
        ? "The Cultivera import is live. Finish the follow-up checks below."
        : "Check each step below.";
  return { done: doneN, total, headline };
}

/** The page help steps (HelpPanel), rewritten for the new process. */
export const MENU_IMPORTS_HELP_STEPS: readonly string[] = [
  "One time only: press Fetch on this page. It reads Cultivera POS (read-only) and checks every lot, unit and cent.",
  "Open the fetch run. If it says GO, press \u201cStage this harvest for review\u201d. If it says NO-GO, it names what to fix.",
  "Open the staged import. Work Fact Review and the warnings, then Publish. Publish Cultivera first, then receive.",
  "After publish: upload the Oct 30 shelf count workbooks, rebuild the Cultivera manifests, approve products on Onboarding, and clean up dead lots on the CCRS hub before your first upload.",
  "Day to day: receive and approve each product with a price. That publishes it automatically, with no upload and no Publish click.",
];

// ─── fetch run page: one plain "what to do now" line ─────────────────────────
export type FetchRunNextInput = {
  /** runView(...) facts, or null when the run could not be read. */
  view: { status: "running" | "done" | "failed" | "cancelled" | "unknown"; canImport: boolean } | null;
  loadError: string | null;
  checkError: string | null;
  /** The go/no-go report was computed (loadRunForImport succeeded). */
  checked: boolean;
  go: boolean | null;
  /** importDecision(...).allowed for a REAL import, or null when not computed. */
  realAllowed: boolean | null;
  /** R74 S2: vendor transfer files the run is missing (0 / absent = none). */
  vendorFilesMissing?: number;
};
export type FetchRunNext = { tone: "wait" | "go" | "fix"; text: string };

export function fetchRunNextStep(i: FetchRunNextInput): FetchRunNext {
  if (i.loadError || !i.view)
    return { tone: "fix", text: "We couldn't reach the crawler just now. Reload in a minute. A running harvest keeps going on its own." };
  const v = i.view;
  if (v.status === "running")
    return { tone: "wait", text: "The harvest is running. This page refreshes itself, so you can leave and come back. Nothing to do yet." };
  if (v.status === "failed" || v.status === "cancelled")
    return { tone: "fix", text: "The harvest stopped before it finished. Press \u201cResume this harvest\u201d. It picks up where it stopped." };
  if (v.status === "unknown")
    return { tone: "fix", text: "The crawler reported a status we don't recognize. Go back to Menu Imports and start a fresh fetch." };
  if (!v.canImport)
    return { tone: "fix", text: "The harvest says done, but a required stage is missing. Go back to Menu Imports and start a fresh fetch." };
  if (i.checkError)
    return { tone: "fix", text: "The harvest finished, but checking its files failed. Reload. If it happens again, start a fresh fetch." };
  if (!i.checked || i.go === null || i.realAllowed === null)
    return { tone: "fix", text: "The go / no-go check has not run. Reload this page." };
  const vm = i.vendorFilesMissing ?? 0;
  if (i.go && i.realAllowed && vm > 0)
    return { tone: "fix", text: `GO, but ${vm} vendor transfer file${vm === 1 ? " is" : "s are"} MISSING (lab results). Fetch again to get them, or tick \u201cStage without the missing vendor files\u201d and stage. The files it did get still stage.` };
  if (i.go && i.realAllowed)
    return { tone: "go", text: "GO. Leave Test mode off and press \u201cStage this harvest for review\u201d. Then open the import, work Fact Review, and publish." };
  if (i.go)
    return { tone: "fix", text: "GO, but a real import is refused for the reason listed below. Test mode is on, so staging now makes a rehearsal import only." };
  return { tone: "fix", text: "NO-GO. The report below names what didn't match. Fix it in Cultivera, or fetch again. You can still stage a rehearsal (Test mode)." };
}

// ─── self-tests ─────────────────────────────────────────────────────────────
export function __runMenuImportsGuideCoreTests(): { passed: number; failed: number } {
  let n = 0;
  const ok = (c: unknown, m: string) => {
    if (!c) throw new Error(`menu-imports-guide-core: ${m}`);
    n++;
  };
  const imp = (id: string, status: string, created_at: string, is_test = false): GuideImportRow => ({ id, status, created_at, is_test });
  const base: GuideInput = { cutover: { done: false, unknown: false }, crawlerConfigured: true, recentRuns: [], imports: [] };
  const st = (g: GuideStep[], k: GuideStepKey) => g.find((s) => s.key === k)!;
  const nexts = (g: GuideStep[]) => g.filter((s) => s.status === "next").map((s) => s.key);

  // shape
  const g0 = buildMenuImportsGuide(base);
  ok(g0.length === GUIDE_STEP_KEYS.length && g0.length === 10, "10 steps");
  ok(g0.map((s) => s.key).join() === GUIDE_STEP_KEYS.join(), "order");
  ok(g0.every((s, i) => s.n === i + 1), "numbered 1..n");
  ok(g0.every((s) => s.title && s.body && s.why), "copy present");
  ok(!g0.some((s) => /\bDelete\b/.test(s.title)), "no step title says Delete");

  // fresh start
  ok(nexts(g0).join() === "fetch", "fresh: fetch is next");
  ok(st(g0, "go_no_go").status === "todo" && st(g0, "go_no_go").links.length === 0, "fresh: no run link");
  ok(st(g0, "manifests").status === "todo" && st(g0, "manifests").links.length === 0, "fresh: manifests locked, no link");
  ok(st(g0, "ccrs_cleanup").links[0].href === "/admin/compliance/ccrs#migration-garbage", "ccrs link");
  ok(st(g0, "receiving").links[0].href === "/admin/inventory/intake?view=cultivera", "receiving cultivera link");
  ok(st(g0, "fetch").links[1].href === "/admin/menu-imports/cutover", "runbook link");
  ok(st(g0, "count").links[0].href === "/admin/menu-imports/count", "count link");
  ok(st(g0, "count").links[1].href === "/admin/menu-imports/reconcile", "A2: go / no-go link (no import yet = page picker)");
  ok(st(g0, "count").status === "todo" && st(g0, "count").n === 6, "count is step 6, after publish, locked before it");

  // crawler off
  const gOff = buildMenuImportsGuide({ ...base, crawlerConfigured: false });
  ok(st(gOff, "fetch").status === "blocked", "crawler off: blocked");
  ok(nexts(gOff).join() === "go_no_go", "blocked step is never next");
  ok(guideSummary(gOff).headline.startsWith("Set up first"), "blocked headline");

  // run exists
  const gRun = buildMenuImportsGuide({ ...base, recentRuns: ["r2", "r1"] });
  ok(st(gRun, "fetch").status === "done", "run: fetch done");
  ok(st(gRun, "go_no_go").status === "next", "run: go/no-go next (was check)");
  ok(st(gRun, "go_no_go").links[0].href === "/admin/menu-imports/fetch/r2", "run: newest run linked");
  ok(st(gRun, "stage").links[0]?.href === "/admin/menu-imports/fetch/r2", "run: stage link to run");
  ok(nexts(gRun).length === 1, "exactly one next");
  ok(st(gRun, "stage").status === "todo", "run but nothing staged: stage is not done");
  const gBlank = buildMenuImportsGuide({ ...base, recentRuns: ["  ", ""] });
  ok(st(gBlank, "fetch").status === "next", "blank run ids ignored");
  ok(GUIDE_HREF.fetchRun("a b") === "/admin/menu-imports/fetch/a%20b", "run id encoded");

  // staged real import
  const gSt = buildMenuImportsGuide({
    ...base,
    recentRuns: ["r1"],
    imports: [imp("t", "staged", "2026-10-03", true), imp("old", "staged", "2026-10-01"), imp("new", "staged", "2026-10-02"), imp("f", "failed", "2026-10-04")],
  });
  ok(st(gSt, "go_no_go").status === "done" && st(gSt, "stage").status === "done", "staged: earlier steps done");
  ok(st(gSt, "review").status === "next", "staged: review next");
  ok(st(gSt, "review").links[0].href === "/admin/menu-imports/new", "staged: newest real import (not test, not failed)");
  ok(st(gSt, "review").links[1].href === "/admin/menu-imports/new/facts", "facts link");
  ok(st(gSt, "review").links[2].href === "/admin/menu-imports/new#diagnostics", "diagnostics link");
  ok(st(gSt, "publish").links[0].href === "/admin/menu-imports/new#publish", "publish link");
  ok(st(gSt, "stage").links.length === 0, "staged: no stage link");
  ok(st(gSt, "manifests").links.length === 0 && st(gSt, "manifests").status === "todo", "staged (not live): no rehome link yet");
  ok(latestRealStaged([imp("", "staged", "z")]) === null, "blank id ignored");
  ok(latestRealStaged([imp("x", "published", "z")]) === null, "published is not staged");
  const gTestOnly = buildMenuImportsGuide({ ...base, imports: [imp("t", "staged", "z", true)] });
  ok(st(gTestOnly, "stage").status !== "done", "test import never counts");

  // done
  const gDone = buildMenuImportsGuide({
    ...base,
    cutover: { done: true, first: { importId: "IMP", publishedAt: "2026-11-01" } },
    imports: [imp("new", "staged", "2026-12-01")],
  });
  ok(GUIDE_STEP_KEYS.slice(0, 5).every((k) => st(gDone, k).status === "done"), "done: first five done");
  ok(GUIDE_STEP_KEYS.slice(5).every((k) => st(gDone, k).status === "check"), "done: follow-ups are check, never done");
  ok(nexts(gDone).length === 0, "done: no next");
  ok(st(gDone, "manifests").links[0].href === rehomeHref("IMP"), "done: rehome for the migrated import");
  ok(st(gDone, "count").links[1].href === "/admin/menu-imports/reconcile?import=IMP", "A2: done: go / no-go for the migrated import");
  ok(st(gDone, "onboarding").links[1].href === missingProductsHref("IMP"), "done: missing products for migrated import");
  ok(st(gDone, "review").links[0].href === "/admin/menu-imports/IMP", "done: review links the migrated import, not a later staged one");
  ok(st(gDone, "publish").links.length === 0, "done: no publish link");
  ok(guideSummary(gDone).headline.startsWith("The Cultivera import is live"), "done headline");
  ok(guideSummary(gDone).done === 5 && guideSummary(gDone).total === 10, "done counts");
  ok(st(gDone, "fetch").status === "done", "done overrides crawler-off");
  const gDoneOff = buildMenuImportsGuide({ ...base, crawlerConfigured: false, cutover: { done: true, first: { importId: "I", publishedAt: "x" } } });
  ok(st(gDoneOff, "fetch").status === "done", "done + crawler off: fetch done");

  // unknown
  const gUnk = buildMenuImportsGuide({ ...base, cutover: { done: false, unknown: true }, recentRuns: ["r"], imports: [imp("s", "staged", "z")] });
  ok(gUnk.every((s) => s.status === "check"), "unknown: everything check");
  ok(nexts(gUnk).length === 0, "unknown: no next");
  ok(guideSummary(gUnk).headline === "Check each step below.", "unknown headline");
  ok(guideSummary(gUnk).done === 0, "unknown: zero done");

  // summary
  const mixed = buildMenuImportsGuide(base).map((x, i) => ({ ...x, status: (i === 0 ? "done" : "check") as GuideStatus }));
  ok(guideSummary(mixed).headline === "Check each step below.", "partly done, no next: never says live");
  ok(guideSummary(g0).headline === `Step 1 of 10: ${st(g0, "fetch").title}.`, "fresh headline");
  ok(guideSummary(gSt).headline.startsWith("Step 4 of 10"), "staged headline");
  ok(Object.keys(GUIDE_STATUS_LABEL).length === 5, "five labels");
  ok(MENU_IMPORTS_HELP_STEPS.length === 5, "five help steps");
  ok(MENU_IMPORTS_HELP_STEPS.some((s) => s.includes("Publish Cultivera first, then receive")), "help keeps runbook rule");
  ok(!MENU_IMPORTS_HELP_STEPS.some((s) => /\bDelete\b/.test(s)), "help never says Delete");
  ok(st(g0, "ccrs_cleanup").body.includes("never sent as a Delete"), "ccrs step says never Delete");

  // fetch run next step
  const fr = (o: Partial<FetchRunNextInput>): FetchRunNext =>
    fetchRunNextStep({ view: { status: "done", canImport: true }, loadError: null, checkError: null, checked: true, go: true, realAllowed: true, ...o });
  ok(fr({}).tone === "go" && fr({}).text.startsWith("GO. Leave Test mode off"), "go + allowed");
  ok(fr({ realAllowed: false }).tone === "fix" && fr({ realAllowed: false }).text.includes("rehearsal import only"), "go but refused");
  ok(fr({ go: false }).text.startsWith("NO-GO"), "no-go");
  ok(fr({ go: false, realAllowed: true }).text.startsWith("NO-GO"), "no-go wins even if allowed");
  ok(fr({ loadError: "x" }).tone === "fix" && fr({ view: null }).text.includes("couldn't reach"), "unreachable");
  ok(fr({ view: { status: "running", canImport: false } }).tone === "wait", "running waits");
  ok(fr({ view: { status: "failed", canImport: false } }).text.includes("Resume"), "failed resumes");
  ok(fr({ view: { status: "cancelled", canImport: false } }).text.includes("Resume"), "cancelled resumes");
  ok(fr({ view: { status: "unknown", canImport: false } }).text.includes("status we don't recognize"), "unknown → own wording");
  ok(fr({ view: { status: "done", canImport: false } }).text.includes("required stage is missing"), "done short → fresh");
  ok(fr({ checkError: "boom" }).text.includes("checking its files failed"), "check error");
  ok(fr({ checked: false }).text.includes("has not run"), "unchecked never says GO");
  ok(fr({ go: null }).tone === "fix" && fr({ realAllowed: null }).tone === "fix", "nulls never say GO");
  ok(fr({ view: { status: "running", canImport: true } }).tone === "wait", "running wins over canImport");
  // R74 S2: missing vendor files never read as a plain GO.
  ok(fr({ vendorFilesMissing: 3 }).tone === "fix" && fr({ vendorFilesMissing: 3 }).text.includes("3 vendor transfer files are MISSING"), "missing vendor files → fix, loud");
  ok(fr({ vendorFilesMissing: 1 }).text.includes("1 vendor transfer file is MISSING"), "singular");
  ok(fr({ vendorFilesMissing: 0 }).tone === "go", "none missing → GO");

  return { passed: n, failed: 0 };
}
