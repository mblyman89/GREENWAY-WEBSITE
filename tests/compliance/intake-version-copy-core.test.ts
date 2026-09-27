/**
 * tests/compliance/intake-version-copy-core.test.ts  (S01)
 *
 * Every intake-origin menu version must explain itself: which delivery it
 * came from, what happened to it, and — only when something is waiting — the
 * one thing to do. This file pins:
 *   1. the pure copy (describeIntakeVersion + friends), incl. old rows;
 *   2. the WRITER contract in intake-menu-staging.ts: header read with named
 *      columns, outcome born at insert, failure recorded on the rare failure
 *      path only (guarded to still-staged rows), success path = zero extra
 *      writes, no UUID notes;
 *   3. the READERS: publish page, version page and Menu Imports list render
 *      describeIntakeVersion, not the raw summary counts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  __runIntakeVersionCopyCoreTests,
  buildIntakeVersionNotes,
  buildManifestHeader,
  describeIntakeVersion,
  failedPublishOutcome,
  initialPublishOutcome,
  parseIntakeSummary,
  ERROR_MAX,
} from "@/lib/pos/intake-version-copy-core";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const STAGING = "src/lib/pos/intake-menu-staging.ts";
const T = "2026-09-26T21:14:00Z";

/** Brace-matched body of the first function whose signature is given. */
function bodyAfter(source: string, signature: string): string {
  const start = source.indexOf(signature);
  if (start < 0) throw new Error(`signature not found: ${signature}`);
  const open = source.indexOf("{", source.indexOf(")", start));
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced body: ${signature}`);
}

const M = buildManifestHeader("m-1", {
  manifest_number: "0012345",
  vendor_label: "Acme Farms",
  received_at: T,
  transfer_date: "2026-09-25",
});
const flag = (name: string, reason: string) => ({
  severity: "warning",
  code: "fact_extraction_review",
  message: reason,
  context: { productName: name, displayName: name, reasons: [reason] },
});
const row = (status: string, outcome: unknown, published_at: string | null = null, diags: unknown[] = []) => ({
  status,
  published_at,
  created_at: T,
  summary_json: {
    origin: "intake",
    manifest_id: "m-1",
    carried: 412,
    added: 3,
    merged: 1,
    diagnostics: diags,
    manifest: M,
    publish_outcome: outcome,
  },
});

describe("S01 intake-version-copy-core: embedded self-tests", () => {
  it("run clean with a meaningful assertion count", () => {
    const r = __runIntakeVersionCopyCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(48);
  });
});

describe("S01 copy: the roadmap acceptance examples", () => {
  it("auto_published reads 'Published automatically at 2:14 PM'", () => {
    const d = describeIntakeVersion(row("published", initialPublishOutcome(0, T), T));
    expect(d.headline).toMatch(/^Published automatically · Sep 26, 2:14\sPM$/);
    expect(d.action).toBeNull();
  });
  it("held names the product and the reason", () => {
    const d = describeIntakeVersion(
      row("staged", initialPublishOutcome(1, T), null, [flag("Gummies 100mg", "THC per piece is not confirmed.")]),
    );
    expect(d.headline).toBe("Waiting: 1 fact needs a second look");
    expect(d.detail).toBe("Gummies 100mg — THC per piece is not confirmed.");
    expect(d.action).toMatch(/press Publish/);
  });
  it("failed shows the real error and says retry", () => {
    const d = describeIntakeVersion(row("staged", failedPublishOutcome("timeout from RPC", T)));
    expect(d.headline).toBe("Automatic publish didn't finish");
    expect(d.detail).toContain("timeout from RPC");
    expect(d.action).toBe("Press Publish to try again.");
  });
  it("the humanised note replaces the UUID note", () => {
    const notes = buildIntakeVersionNotes({ manifest: M, added: 3, merged: 1, carried: 412 });
    expect(notes).toBe(
      "From Acme Farms · manifest 0012345 · received Sep 26: 3 new products, 1 restock, 412 live items carried.",
    );
  });
});

describe("S01 copy: status columns are the truth for 'live'", () => {
  it("a stored outcome never makes a staged row claim to be live", () => {
    for (const o of [initialPublishOutcome(0, T), initialPublishOutcome(2, T), failedPublishOutcome("x", T), null]) {
      const d = describeIntakeVersion(row("staged", o));
      expect(d.tone).not.toBe("live");
      expect(d.headline).not.toMatch(/published|live/i);
      expect(d.action).not.toBeNull();
    }
  });
  it("a published row is live whatever the stored outcome says", () => {
    for (const o of [initialPublishOutcome(0, T), initialPublishOutcome(2, T), failedPublishOutcome("x", T), null]) {
      const d = describeIntakeVersion(row("published", o, T));
      expect(d.tone).toBe("live");
      expect(d.action).toBeNull();
    }
  });
  it("archived rows never ask for action", () => {
    expect(describeIntakeVersion(row("archived", initialPublishOutcome(2, T))).action).toBeNull();
  });
});

describe("S01 copy: old rows degrade without inventing a cause", () => {
  it("a pre-S01 staged row with no keys renders without crashing and without a reason claim", () => {
    const d = describeIntakeVersion({ status: "staged", published_at: null, created_at: T, summary_json: { origin: "intake", carried: 2, added: 1, merged: 0 } });
    expect(d.source).toBeNull();
    expect(d.headline).toBe("Waiting for a Publish click");
    expect(d.detail).not.toMatch(/fail|error/i);
  });
  it("junk summary_json is safe", () => {
    for (const j of [null, undefined, "str", 42, [], { publish_outcome: "held" }, { manifest: { id: 7 } }]) {
      expect(() => describeIntakeVersion({ status: "staged", published_at: null, created_at: T, summary_json: j })).not.toThrow();
    }
    expect(parseIntakeSummary({ manifest: { id: 7 } }).manifest).toBeNull();
  });
  it("failure messages are capped so the row stays small", () => {
    expect(failedPublishOutcome("e".repeat(5000), T).error!.length).toBe(ERROR_MAX);
  });
});

describe("S01 writer: intake-menu-staging.ts persists a self-describing row", () => {
  const src = read(STAGING);
  const stage = bodyAfter(src, "export async function stageIntakeMenuVersionForManifest");
  const auto = bodyAfter(src, "async function autoPublishIntakeVersion");

  it("reads the manifest header once, by id, with NAMED columns (usage rule)", () => {
    const reads = stage.match(/\.from\("inbound_manifests"\)/g) ?? [];
    expect(reads.length).toBe(1);
    expect(stage).toContain('.select("manifest_number, vendor_label, received_at, transfer_date")');
    expect(stage).not.toMatch(/from\("inbound_manifests"\)\s*\.select\("\*"\)/);
  });
  it("the header read happens AFTER the no-changes early return (no read when nothing is staged)", () => {
    expect(stage.indexOf('return skip("no-new-items")')).toBeGreaterThan(-1);
    expect(stage.indexOf('.from("inbound_manifests")')).toBeGreaterThan(stage.indexOf('return skip("no-new-items")'));
  });
  it("summary_json is born with manifest + publish_outcome, and fact flags are known before the insert", () => {
    expect(stage).toMatch(/manifest:\s*manifestHeader,/);
    expect(stage).toMatch(/publish_outcome:\s*initialPublishOutcome\(factFlags\.length,/);
    const insertAt = stage.indexOf("import_id: null,");
    expect(insertAt).toBeGreaterThan(-1);
    expect(stage.indexOf("const factFlags")).toBeGreaterThan(-1);
    expect(stage.indexOf("const factFlags")).toBeLessThan(insertAt);
  });
  it("notes come from the pure builder; the UUID template is gone", () => {
    expect(stage).toMatch(/notes:\s*buildIntakeVersionNotes\(/);
    expect(src).not.toContain("Auto-carried from accepted manifest");
  });
  it("the hold path adds NO extra menu_versions write (outcome already persisted)", () => {
    const hold = stage.slice(stage.indexOf("if (factFlags.length > 0)"), stage.indexOf('reason: "held-for-fact-review"'));
    expect(hold).not.toContain('.from("menu_versions")');
  });
  it("failure is recorded on BOTH failure branches, guarded to still-staged rows, and never throws", () => {
    expect((auto.match(/await recordFailure\(/g) ?? []).length).toBe(2);
    const rf = auto.slice(auto.indexOf("const recordFailure"), auto.indexOf("const { error } = await admin.rpc"));
    expect(rf).toContain('.eq("status", "staged")');
    expect(rf).toContain("failedPublishOutcome(");
    expect(rf).toMatch(/try\s*\{/);
    expect(rf).toMatch(/catch \(err\)/);
    expect(rf).toContain("...base");
  });
  it("the SUCCESS path adds no summary_json write (zero extra egress on the common path)", () => {
    // Everything in autoPublishIntakeVersion OUTSIDE the recordFailure helper
    // must never touch summary_json — wherever a write is slipped in.
    const rfStart = auto.indexOf("const recordFailure");
    const rfEnd = auto.indexOf("const logEvent");
    expect(rfStart).toBeGreaterThan(-1);
    expect(rfEnd).toBeGreaterThan(rfStart);
    const outside = auto.slice(0, rfStart) + auto.slice(rfEnd);
    expect(outside).not.toContain("summary_json");
    // Exactly two menu_versions writes: the failure record + the stale sweep.
    expect((auto.match(/\.from\("menu_versions"\)/g) ?? []).length).toBe(2);
    const success = auto.slice(auto.indexOf("// Housekeeping"));
    expect(success).not.toContain("recordFailure");
  });
  it("still auto-publishes via the RPC (S00 story stays true)", () => {
    expect(auto).toContain('admin.rpc("publish_menu_version"');
    expect(stage).toMatch(/await autoPublishIntakeVersion\(\s*version\.id,/);
  });
});

describe("S01 readers render describeIntakeVersion", () => {
  it("publish page: pure call per receiving row, no new query", () => {
    const p = read("src/app/admin/publish/page.tsx");
    expect(p).toContain('from "@/lib/pos/intake-version-copy-core"');
    expect(p).toMatch(/origin === "receiving" \? describeIntakeVersion\(v\) : null/);
    expect(p).toContain("{story.headline}");
    expect(p).toContain("{story.action}");
    // No new data sources: the same three loaders as before.
    expect(p).toMatch(/getPublishedVersion\(\),\s*listIntakeStagedVersions\(\),\s*listVersions\(\),/);
  });
  it("version page: subtitle from source+counts, outcome banner from the description", () => {
    const p = read("src/app/admin/menu-imports/version/[versionId]/page.tsx");
    expect(p).toContain("const story = describeIntakeVersion(version)");
    expect(p).toContain("story.source ??");
    expect(p).toContain("{story.headline}");
    expect(p).not.toMatch(/subtitle=\{`Auto-carried/);
  });
  it("Menu Imports intake list: source + headline, raw count cast is gone", () => {
    const p = read("src/app/admin/menu-imports/page.tsx");
    expect(p).toContain("const story = describeIntakeVersion(v)");
    expect(p).toContain("{story.counts}");
    expect(p).not.toContain("new from receiving");
  });
});
