/**
 * USAGE-5 · preview builds are OFF for every branch except `main`.
 *
 * Vercel bills builds per CPU-minute, and the GitHub deployments API showed
 * 10–24 Preview builds a day on `greenway_website` while PRs were open. The
 * fix is one block in `vercel.json` (`git.deploymentEnabled`), and the
 * behaviour was MEASURED on throwaway branches before it was adopted: the
 * probe commit produced zero deployments and zero commit statuses; a control
 * commit pushed seconds later produced a Preview deployment.
 *
 * This file pins the block so a future "cleanup" cannot silently switch the
 * preview bill back on, and pins the AGENTS.md rule that tells the next
 * session the PR-time Vercel check no longer exists (so nobody pushes empty
 * commits hunting for it).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(path.resolve(__dirname, "../..", rel), "utf8");

type VercelConfig = {
  git?: { deploymentEnabled?: boolean | Record<string, boolean> };
  crons?: { path: string; schedule: string }[];
};

describe("USAGE-5 · vercel.json disables automatic deployments off `main`", () => {
  const cfg = JSON.parse(read("vercel.json")) as VercelConfig;

  it("keeps the git block in the documented object form (branch → boolean)", () => {
    const enabled = cfg.git?.deploymentEnabled;
    expect(enabled).toBeDefined();
    // `false` would also stop previews, but it would stop PRODUCTION too.
    expect(typeof enabled).toBe("object");
    for (const [branch, value] of Object.entries(enabled as Record<string, boolean>)) {
      expect(typeof branch).toBe("string");
      expect(typeof value).toBe("boolean");
    }
  });

  it("`main` still deploys and every other branch is matched by a `false` rule", () => {
    const enabled = cfg.git?.deploymentEnabled as Record<string, boolean>;
    expect(enabled.main).toBe(true);
    // Vercel: "If a branch matches multiple rules and at least one rule is
    // `true`, a deployment will occur." So the ONLY `true` may be `main`.
    const trueRules = Object.entries(enabled).filter(([, v]) => v === true).map(([k]) => k);
    expect(trueRules).toEqual(["main"]);
    // And the catch-all must be present and `false`, otherwise unspecified
    // branches default to `true` (docs: "any unspecified branch is set to true").
    expect(enabled["**"]).toBe(false);
  });

  it("did not disturb the cron list (rule 12 cadences are pinned elsewhere)", () => {
    const crons = cfg.crons ?? [];
    expect(crons.length).toBe(6); // R19 S13 added /api/cron/lookup-jobs
    const byPath = new Map(crons.map((c) => [c.path, c.schedule]));
    expect(byPath.get("/api/cron/leafly-menu-sync")).toBe("*/15 * * * *");
    expect(byPath.get("/api/cron/leafly-ack-sweep")).toBe("*/2 * * * *");
  });
});

describe("USAGE-5 · the standing rules describe the new merge gate", () => {
  const agents = read("AGENTS.md").replace(/\s+/g, " ");

  it("rule 13 says previews are off and names the vercel.json block", () => {
    expect(agents).toContain("Preview deployments are OFF for every branch except `main` (USAGE-5)");
    expect(agents).toContain('"deploymentEnabled": {"main": true, "**": false}');
  });

  it("the merge gate no longer waits for a Vercel PR check and requires the post-merge production read", () => {
    expect(agents).toContain("Merge gate while staging is paused and previews are off:");
    expect(agents).toContain("There is no Vercel PR check to wait for");
    expect(agents).toContain("now mandatory rather than optional");
    // The command the next session must run after every merge.
    expect(agents).toContain(
      "gh api repos/mblyman89/GREENWAY-WEBSITE/commits/<sha>/status --jq '.statuses[]|select(.context==\"Vercel – greenway_website\")|.state'",
    );
  });

  it("forbids the two reflexes that would re-create the bill", () => {
    expect(agents).toContain("Do **not** \"fix\" the missing PR check by pushing empty commits");
    expect(agents).toContain("do **not** remove the block to get a preview");
  });
});
