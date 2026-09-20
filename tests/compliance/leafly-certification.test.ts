/**
 * SLICE L-4 — the menu-certification gate, asserted against Leafly's LIVE spec.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `assessMenuCertificationReadiness()` decides whether to tell the owner "you are ready to
 * ask Leafly for menu certification". Getting that wrong is expensive in both directions:
 *
 *   - A FALSE READY sends a request that Leafly rejects on review. Certification requires
 *     two business days' notice, a human reads the logged request activity, and a failed
 *     review costs most of a week before the next attempt.
 *   - A FALSE NOT-READY is just as bad in a quieter way: the owner sits and waits on a
 *     blocker we invented. Finding L-20 is exactly that failure mode, caught here.
 *
 * So the gate is not tested against my summary of Leafly's checklist. It is tested against
 * the vendored OpenAPI document, which is Leafly's own published text, retrieved live and
 * md5-recorded in docs/leafly-specs/SOURCES.md. Where my readiness report and the spec
 * disagreed, the spec won and the report was corrected.
 *
 * This file also holds the promise made in `page.tsx`: it reads `vercel.json` and fails if
 * `LEAFLY_SCHEDULED_SYNC_EXISTS` and reality disagree in EITHER direction.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  GREENWAY_IN_STOCK_MAJORITY_FRACTION,
  LEAFLY_CERTIFICATION_NOTICE_BUSINESS_DAYS,
  LEAFLY_IN_STOCK_REQUIREMENT_TEXT,
  __runLeaflyCertificationTests,
  assessMenuCertificationReadiness,
  type MenuCertificationInputs,
} from "@/lib/leafly/certification-core";
import { DAILY_HOUR_DEFAULT } from "@/lib/leafly/schedule-core";
import type { LeaflyReconcileResult } from "@/lib/leafly/readback-core";

const ROOT = process.cwd();

function readText(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}
function readJson(rel: string): Record<string, unknown> {
  return JSON.parse(readText(rel)) as Record<string, unknown>;
}

const openapi = readJson(path.join("docs", "leafly-specs", "menu-integration-v2.openapi.json"));
const specText = String((openapi.info as Record<string, unknown> | undefined)?.description ?? "");

/**
 * The spec description is hard-wrapped markdown, so a sentence Leafly wrote on one logical
 * line can be split across two physical ones ("...and not\n    the use of manual tools").
 * Our criterion strings are single-line. Comparing them against the raw text therefore
 * fails on whitespace alone, which says nothing about whether the wording matches.
 *
 * Collapsing runs of whitespace to a single space makes the comparison test the WORDS,
 * which is the thing that matters. Nothing else is altered: no case folding, no
 * punctuation stripping, so a genuine wording change still fails.
 */
const specFlat = specText.replace(/\s+/g, " ");

/** A reconcile result with nothing wrong, for fixtures. */
const cleanReconcile: LeaflyReconcileResult = {
  ok: true,
  scope: "full",
  sentItemCount: 10,
  readbackItemCount: 10,
  comparedItemCount: 10,
  missingFromLeafly: [],
  extraAtLeafly: [],
  untouchedAtLeafly: null,
  issues: [],
  unverifiable: [],
};

/**
 * The ONLY fixture in this file that passes every criterion. Everything else mutates one
 * field off this, so each test proves exactly one thing.
 */
const allGood: MenuCertificationInputs = {
  credentialsConfigured: true,
  environment: "sandbox",
  authSucceeded: true,
  recentPushStatuses: [200, 200],
  reconcile: cleanReconcile,
  itemCount: 10,
  variantCount: 20,
  inStockVariantCount: 18,
  inStockItemCount: 10,
  ownerAttestsNoManualTools: true,
  scheduledSyncEnabled: true,
};

function statusOf(inputs: MenuCertificationInputs, id: string) {
  return assessMenuCertificationReadiness(inputs).criteria.find((c) => c.id === id)?.status;
}

describe("L-4 · the gate grades Leafly's published checklist and nothing else", () => {
  it("the vendored spec really contains a certification checklist", () => {
    expect(specText).toContain("#### Certification Checklist");
    expect(specText).toContain("verifying the logged activity");
  });

  it("grades exactly five criteria — none invented, none dropped", () => {
    expect(assessMenuCertificationReadiness(allGood).criteria).toHaveLength(5);
  });

  it("every criterion's wording traces to Leafly's spec", () => {
    // Each criterion quotes Leafly. Assert a distinctive phrase from each against the
    // live spec text so a reworded criterion cannot silently stop matching the source.
    const phrases = [
      "successfully authenticates",
      "200-level",
      "manual tools (e.g., postman or curl)",
      "Full menu updates across items at a cadence of once per day",
      "most items are in stock",
    ];
    for (const phrase of phrases) {
      expect(specFlat).toContain(phrase);
    }
  });

  it("the five criterion ids are stable and unique", () => {
    // The admin UI and the audit trail branch on these.
    const ids = assessMenuCertificationReadiness(allGood).criteria.map((c) => c.id);
    expect(ids).toEqual(["auth", "responses", "no_manual_tools", "cadence", "data_quality"]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("two business days' notice is Leafly's requirement, not a guess", () => {
    expect(LEAFLY_CERTIFICATION_NOTICE_BUSINESS_DAYS).toBe(2);
    expect(assessMenuCertificationReadiness(allGood).noticeBusinessDays).toBe(2);
  });
});

/**
 * FINDING L-20 — the paraphrase that would have blocked a legitimate request.
 *
 * My readiness report condensed Leafly's "Variants contain inventory that reflect most
 * items are in stock" into "most variants in stock". The graded unit changed from item to
 * variant, which inverts the result for any shop that stocks its products in one size.
 */
describe("L-4 · finding L-20: in-stock is graded per ITEM, in Leafly's words", () => {
  it("the requirement string is Leafly's, character for character, and is IN the spec", () => {
    expect(LEAFLY_IN_STOCK_REQUIREMENT_TEXT).toBe(
      "Variants contain inventory that reflect most items are in stock",
    );
    expect(specFlat).toContain(LEAFLY_IN_STOCK_REQUIREMENT_TEXT);
  });

  it("the spec says 'most items', and never 'most variants'", () => {
    // The direct proof that the paraphrase was wrong.
    expect(specText).toContain("most items are in stock");
    // Checked on the flattened text as well: if the phrase were ever wrapped as
    // "most\nvariants" the raw check would pass vacuously.
    expect(specFlat).not.toContain("most variants");
    expect(specText).not.toContain("most variants");
  });

  it("Leafly's publishing rule confirms one in-stock size publishes an item", () => {
    // This is WHY the item is the right unit, not merely that the words say so.
    expect(specText).toContain(
      "Items are published to the consumer site automatically if they're",
    );
    expect(specText).toContain("received via the API with inventory associated");
  });

  it("every product stocked in one size PASSES, though only 33% of variants are", () => {
    // The exact scenario the paraphrase got backwards.
    expect(
      statusOf(
        { ...allGood, itemCount: 10, inStockItemCount: 10, variantCount: 30, inStockVariantCount: 10 },
        "data_quality",
      ),
    ).toBe("pass");
  });

  it("...and the whole gate reports ready for that shop", () => {
    // Proves the corrected unit actually unblocks the owner end to end, not just in one
    // criterion's status field.
    const r = assessMenuCertificationReadiness({
      ...allGood,
      itemCount: 10,
      inStockItemCount: 10,
      variantCount: 30,
      inStockVariantCount: 10,
    });
    expect(r.readyToRequest).toBe(true);
    expect(r.blockers).toHaveLength(0);
  });

  it("most products sold out FAILS, even if every remaining size is stocked", () => {
    // The converse. Grading variants here would have wrongly PASSED (9 of 9 = 100%).
    expect(
      statusOf(
        { ...allGood, itemCount: 20, inStockItemCount: 3, variantCount: 9, inStockVariantCount: 9 },
        "data_quality",
      ),
    ).toBe("fail");
  });

  it("the finding text quotes Leafly and disowns our own threshold", () => {
    const finding =
      assessMenuCertificationReadiness({
        ...allGood,
        itemCount: 20,
        inStockItemCount: 3,
      }).criteria.find((c) => c.id === "data_quality")?.finding ?? "";
    expect(finding).toContain(LEAFLY_IN_STOCK_REQUIREMENT_TEXT);
    expect(finding).toContain("ours, not");
    expect(finding).toContain("3 of 20");
    // And it must not reintroduce the paraphrase.
    expect(finding).not.toContain("most variants in stock");
  });

  it("the majority threshold is ours, is a floor, and the boundary is exact", () => {
    expect(GREENWAY_IN_STOCK_MAJORITY_FRACTION).toBe(0.5);
    // Exactly half passes; one below fails.
    expect(statusOf({ ...allGood, itemCount: 20, inStockItemCount: 10 }, "data_quality")).toBe("pass");
    expect(statusOf({ ...allGood, itemCount: 20, inStockItemCount: 9 }, "data_quality")).toBe("fail");
  });
});

describe("L-4 · the gate fails CLOSED", () => {
  it("no credentials fails authentication and blocks", () => {
    const r = assessMenuCertificationReadiness({ ...allGood, credentialsConfigured: false });
    expect(statusOf({ ...allGood, credentialsConfigured: false }, "auth")).toBe("fail");
    expect(r.readyToRequest).toBe(false);
  });

  it("credentials saved but never used is UNKNOWN, not a pass", () => {
    // The distinction that keeps the gate honest: untested is not the same as working.
    expect(statusOf({ ...allGood, authSucceeded: null }, "auth")).toBe("unknown");
    expect(
      assessMenuCertificationReadiness({ ...allGood, authSucceeded: null }).readyToRequest,
    ).toBe(false);
  });

  it("a rejected token exchange fails", () => {
    expect(statusOf({ ...allGood, authSucceeded: false }, "auth")).toBe("fail");
  });

  it("an empty request log cannot pass — Leafly grades logged activity", () => {
    expect(statusOf({ ...allGood, recentPushStatuses: [] }, "responses")).toBe("fail");
  });

  it("earlier errors that were CORRECTED pass, exactly as Leafly's wording allows", () => {
    expect(statusOf({ ...allGood, recentPushStatuses: [400, 500, 200] }, "responses")).toBe("pass");
  });

  it("but the most recent request must succeed", () => {
    expect(statusOf({ ...allGood, recentPushStatuses: [200, 200, 400] }, "responses")).toBe("fail");
  });

  it("chronological order is load-bearing, not cosmetic", () => {
    // Same statuses, opposite order, opposite verdict. If the caller ever forgets to
    // reverse the newest-first log, this is the behaviour that changes.
    expect(statusOf({ ...allGood, recentPushStatuses: [400, 200] }, "responses")).toBe("pass");
    expect(statusOf({ ...allGood, recentPushStatuses: [200, 400] }, "responses")).toBe("fail");
  });

  it("only 2xx counts — Leafly says '200-level', so 3xx is NOT a success", () => {
    // ADDED BECAUSE A MUTATION SURVIVED. Widening the success test to `<= 399` passed
    // every existing case, because no fixture used a 3xx status at all. Leafly's wording
    // is "Successful (200-level) responses are being solicited from the Menu API" -- a
    // 301 or 304 is not that. In practice a 3xx here means the request was redirected
    // and the menu was never stored, which is precisely the silent failure this
    // criterion exists to catch.
    expect(specFlat).toContain("Successful (200-level) responses");
    for (const redirect of [300, 301, 302, 304, 307, 308, 399]) {
      expect(statusOf({ ...allGood, recentPushStatuses: [redirect] }, "responses")).toBe("fail");
    }
  });

  it("the 2xx boundary is exact at both ends", () => {
    for (const ok of [200, 201, 204, 299]) {
      expect(statusOf({ ...allGood, recentPushStatuses: [ok] }, "responses")).toBe("pass");
    }
    for (const notOk of [199, 300, 400, 401, 429, 500]) {
      expect(statusOf({ ...allGood, recentPushStatuses: [notOk] }, "responses")).toBe("fail");
    }
  });

  it("a 3xx among earlier pushes still counts as an error that was corrected", () => {
    // Consistency check: if 3xx is a failure, it must be reported as one of the
    // "errors ... corrected on subsequent requests", not ignored.
    const finding =
      assessMenuCertificationReadiness({
        ...allGood,
        recentPushStatuses: [302, 200],
      }).criteria.find((c) => c.id === "responses")?.finding ?? "";
    expect(finding).toContain("302");
  });

  it("no scheduled sync fails the cadence criterion", () => {
    expect(statusOf({ ...allGood, scheduledSyncEnabled: false }, "cadence")).toBe("fail");
  });

  it("a never-reconciled menu cannot claim data quality", () => {
    // A 200 from Leafly means "accepted", not "stored what you meant".
    expect(statusOf({ ...allGood, reconcile: null }, "data_quality")).toBe("fail");
  });

  it("a reconcile with errors fails data quality", () => {
    const bad: LeaflyReconcileResult = {
      ...cleanReconcile,
      ok: false,
      issues: [
        { severity: "error", code: "image_dropped", itemId: "SKU-1", message: "Photo missing." },
      ],
    };
    expect(statusOf({ ...allGood, reconcile: bad }, "data_quality")).toBe("fail");
  });

  it("an empty menu fails data quality", () => {
    expect(
      statusOf(
        { ...allGood, itemCount: 0, inStockItemCount: 0, variantCount: 0, inStockVariantCount: 0 },
        "data_quality",
      ),
    ).toBe("fail");
  });

  it("an all-default/empty input set is not ready, with reasons", () => {
    const r = assessMenuCertificationReadiness({
      credentialsConfigured: false,
      environment: "sandbox",
      authSucceeded: null,
      recentPushStatuses: [],
      reconcile: null,
      itemCount: 0,
      variantCount: 0,
      inStockVariantCount: 0,
      inStockItemCount: 0,
      ownerAttestsNoManualTools: null,
      scheduledSyncEnabled: false,
    });
    expect(r.readyToRequest).toBe(false);
    expect(r.blockers.length).toBeGreaterThan(0);
    // Every blocker must be actionable prose, not a code.
    for (const b of r.blockers) expect(b.length).toBeGreaterThan(20);
  });

  it("every non-passing criterion carries a remedy, and passing ones do not", () => {
    const r = assessMenuCertificationReadiness({
      ...allGood,
      credentialsConfigured: false,
      scheduledSyncEnabled: false,
      reconcile: null,
    });
    for (const c of r.criteria) {
      if (c.status === "pass") expect(c.remedy).toBe("");
      else expect(c.remedy.length).toBeGreaterThan(20);
    }
  });

  it("the headline never says 'ready' when it is not", () => {
    const r = assessMenuCertificationReadiness({ ...allGood, credentialsConfigured: false });
    expect(r.headline.toLowerCase()).toContain("not ready");
  });
});

describe("L-4 · the manual-tools criterion is attested, never auto-passed", () => {
  it("unanswered is 'attest' — not a pass and not a failure", () => {
    // The app cannot see what tool made a past request, and this criterion is
    // retroactive. Guessing either way is the single most expensive wrong answer.
    expect(statusOf({ ...allGood, ownerAttestsNoManualTools: null }, "no_manual_tools")).toBe(
      "attest",
    );
  });

  it("'attest' still blocks readiness — only a real pass unblocks", () => {
    expect(
      assessMenuCertificationReadiness({ ...allGood, ownerAttestsNoManualTools: null })
        .readyToRequest,
    ).toBe(false);
  });

  it("admitting Postman/curl use fails and points at Ben Scott", () => {
    const c = assessMenuCertificationReadiness({
      ...allGood,
      ownerAttestsNoManualTools: false,
    }).criteria.find((x) => x.id === "no_manual_tools");
    expect(c?.status).toBe("fail");
    expect(c?.remedy).toContain("Ben Scott");
  });

  it("the disqualifying wording is Leafly's own", () => {
    const c = assessMenuCertificationReadiness(allGood).criteria.find(
      (x) => x.id === "no_manual_tools",
    );
    // Compared against the whitespace-flattened spec because Leafly hard-wraps this
    // sentence mid-clause. The words must match exactly; only line breaks are forgiven.
    expect(c?.leaflyRequirement ?? "@@missing@@").toBe(
      "Request signatures indicate the presence of an automated application and not the " +
        "use of manual tools (e.g., postman or curl)",
    );
    expect(specFlat).toContain(c?.leaflyRequirement ?? "@@nope@@");
  });
});

describe("L-4 · environment is a blocker but NOT a sixth criterion", () => {
  it("production blocks readiness without adding a criterion", () => {
    const r = assessMenuCertificationReadiness({ ...allGood, environment: "production" });
    expect(r.readyToRequest).toBe(false);
    expect(r.criteria).toHaveLength(5);
    expect(r.blockers.join(" ")).toContain("PRODUCTION");
  });

  it("sandbox with everything satisfied is the only way to reach ready", () => {
    const r = assessMenuCertificationReadiness(allGood);
    expect(r.readyToRequest).toBe(true);
    expect(r.blockers).toHaveLength(0);
    expect(r.headline).toContain("2 business days");
  });
});

/**
 * The promise made in `src/app/admin/integrations/leafly/page.tsx`:
 *
 *   "tests/compliance/leafly-certification.test.ts asserts vercel.json still has no
 *    Leafly cron, so the day somebody adds one that test fails and points here."
 *
 * `LEAFLY_SCHEDULED_SYNC_EXISTS` is a hand-maintained constant, and a hand-maintained
 * constant about infrastructure drifts the moment someone ships the infrastructure. This
 * ties it to the file that decides the truth.
 */
describe("L-4 · the cadence constant cannot drift from vercel.json", () => {
  const vercel = readJson("vercel.json");
  const crons = (vercel.crons ?? []) as { path?: string; schedule?: string }[];
  const pageSource = readText(path.join("src", "app", "admin", "integrations", "leafly", "page.tsx"));

  it("vercel.json declares crons in the expected shape", () => {
    expect(Array.isArray(crons)).toBe(true);
    for (const c of crons) {
      expect(typeof c.path).toBe("string");
      expect(typeof c.schedule).toBe("string");
    }
  });

  // SLICE L-7. This block previously read:
  //
  //     it("no declared cron syncs Leafly", ...)  expect(leaflyCrons).toEqual([])
  //
  // That was correct when written and is now false: L-7 added the cron, which is
  // exactly the event the L-4 comment predicted ("the day somebody adds one that
  // test fails and points here"). It failed, it pointed here, and this is the
  // update. The gate is not weakened -- it is inverted and tightened, because a
  // cron that exists can be wrong in more ways than a cron that does not.
  it("exactly one declared cron syncs Leafly", () => {
    const leaflyCrons = crons.filter((c) => (c.path ?? "").toLowerCase().includes("leafly"));
    expect(leaflyCrons).toHaveLength(1);
    expect(leaflyCrons[0]?.path).toBe("/api/cron/leafly-menu-sync");
  });

  it("the Leafly cron route actually exists on disk", () => {
    // A cron pointing at a path with no route handler deploys happily and 404s
    // once a day forever, which looks like a working schedule in vercel.json and
    // is not one.
    const routePath = path.join("src", "app", "api", "cron", "leafly-menu-sync", "route.ts");
    expect(existsSync(path.join(ROOT, routePath))).toBe(true);
    const routeSource = readText(routePath);
    // It must delegate, not re-decide. The whole value of the pure core is lost
    // if timing logic gets reimplemented in the route.
    expect(routeSource).toContain("runScheduledLeaflySync");
    // And it must be fail-closed like every other cron on this project.
    expect(routeSource).toContain("shouldRefuseWhenSecretMissing");
    expect(routeSource).toContain("CRON_SECRET");
  });

  it("every cron schedule runs at most once per day (Vercel Hobby limit)", () => {
    // MEASURED CONSTRAINT, not a style rule. Vercel's cron documentation (read
    // 2026-09-18, page last updated 2026-07-15) states Hobby accounts are
    // "limited to cron jobs that run once per day" and that a more frequent
    // expression "will fail during deployment". This project is recorded as
    // Vercel Hobby in docs/CRYPTO_PORTFOLIO_BIBLE.md.
    //
    // So a sub-daily expression here does not degrade the Leafly sync -- it
    // BREAKS EVERY DEPLOYMENT of the whole site, including the point of sale.
    // This test is the guard rail that stops a well-meant "let's sync hourly"
    // from taking the shop offline.
    for (const c of crons) {
      const schedule = c.schedule ?? "";
      const [minute, hour] = schedule.split(/\s+/);
      // A step or wildcard in the minute or hour field means more than one run
      // per day. A list (1,2) or range (1-5) does too.
      expect(minute, `cron "${c.path}" minute field "${minute}"`).toMatch(/^\d+$/);
      expect(hour, `cron "${c.path}" hour field "${hour}"`).toMatch(/^\d+$/);
    }
  });

  it("the Leafly cron hour lands at or after the default sync hour year-round", () => {
    // The single daily tick must not land BELOW the schedule's configured hour,
    // or the hour gate would refuse it and -- with no second tick on this plan --
    // the daily full sync would depend entirely on the catch-up rule.
    //
    // Pacific is UTC-7 (PDT) or UTC-8 (PST). DAILY_HOUR_DEFAULT is 4.
    const leafly = crons.find((c) => (c.path ?? "").includes("leafly-menu-sync"));
    const utcHour = Number.parseInt((leafly?.schedule ?? "").split(/\s+/)[1] ?? "", 10);
    expect(Number.isFinite(utcHour)).toBe(true);
    const pdtHour = (utcHour - 7 + 24) % 24;
    const pstHour = (utcHour - 8 + 24) % 24;
    expect(pdtHour).toBeGreaterThanOrEqual(DAILY_HOUR_DEFAULT);
    expect(pstHour).toBeGreaterThanOrEqual(DAILY_HOUR_DEFAULT);
  });

  it("the page's constant matches reality in BOTH directions", () => {
    // The whole point. If someone adds a Leafly cron and forgets the constant, this
    // fails. If someone flips the constant without adding a cron, this also fails.
    const declared = /const LEAFLY_SCHEDULED_SYNC_EXISTS = (true|false);/.exec(pageSource);
    expect(declared).not.toBeNull();
    const constantSaysYes = declared?.[1] === "true";
    const realitySaysYes = crons.some((c) => (c.path ?? "").toLowerCase().includes("leafly"));
    expect(constantSaysYes).toBe(realitySaysYes);
  });

  it("the page feeds that constant into the cadence criterion", () => {
    // Guards against the constant existing but being ignored — which is how the original
    // `syncMode === "post" || syncMode === "put"` bug produced a permanent false pass.
    expect(pageSource).toContain("scheduledSyncEnabled: LEAFLY_SCHEDULED_SYNC_EXISTS");
  });

  it("the page does not derive cadence from syncMode", () => {
    // syncMode only ever chooses POST vs PUT for a hand-triggered push. Deriving cadence
    // from it is always true, i.e. a meaningless pass. Never again.
    expect(pageSource).not.toMatch(/scheduledSyncEnabled:\s*settings\.syncMode/);
  });

  it("the page counts in-stock ITEMS, not variants, for the gate (finding L-20)", () => {
    expect(pageSource).toContain("inStockItemCount");
    expect(pageSource).toMatch(/item\.variants\.some\(\(v\) => v\.inventoryLevel > 0\)/);
  });
});

describe("L-4 · the certification gate never throws", () => {
  it("survives nonsense numbers without crashing", () => {
    const nonsense: MenuCertificationInputs[] = [
      { ...allGood, itemCount: -5, inStockItemCount: -5 },
      { ...allGood, variantCount: 0, inStockVariantCount: 99 },
      { ...allGood, itemCount: 0, inStockItemCount: 99 },
      { ...allGood, recentPushStatuses: [0, -1, 99999] },
    ];
    for (const inputs of nonsense) {
      expect(() => assessMenuCertificationReadiness(inputs)).not.toThrow();
      const r = assessMenuCertificationReadiness(inputs);
      expect(r.criteria).toHaveLength(5);
      expect(r.headline.length).toBeGreaterThan(10);
    }
  });
});

describe("L-4 · the pure self-tests are wired in", () => {
  it("certification-core self-tests all pass", () => {
    const r = __runLeaflyCertificationTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThan(60);
  });
});
