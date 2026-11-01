/**
 * G-71e (owner message 14, item 5): locked versions plus upgrade pull requests
 * through CI, and the Node.js 20 move (CI and production on Node 24).
 *
 * Owner (verbatim): "Thank you. Please now complete item 5 to close all gaps.
 * Fit inside this slice the node.js fixes too please."
 *
 * This test feeds the REAL package files, lockfiles, workflows and
 * dependabot.yml to src/lib/platform/version-pins-core.ts. Any ^range, any
 * package.json/lockfile disagreement, a missing or wrong engines.node, a
 * node-version literal in CI, a floating action tag, or a package directory
 * without Dependabot fails the PR.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  PRODUCTION_NODE_MAJOR,
  VERCEL_NODE_MAJORS,
  __runVersionPinsTests,
  auditVersionPins,
  parseDependabotUpdates,
} from "@/lib/platform/version-pins-core";
import { PLATFORM_CHANGES } from "@/lib/platform/platform-changes";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

/** Every directory with a package.json we deploy or run (not node_modules, not fixtures). */
function packageDirs(): string[] {
  const dirs = ["/"];
  for (const name of fs.readdirSync(ROOT)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = path.join(ROOT, name);
    if (fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, "package.json"))) dirs.push(`/${name}`);
  }
  return dirs;
}

const rel = (dir: string, f: string) => (dir === "/" ? f : `${dir.slice(1)}/${f}`);

describe("G-71e locked versions", () => {
  it("pure self-tests pass and are registered with the self-test runner", () => {
    const r = __runVersionPinsTests();
    expect(r.failures).toEqual([]);
    expect(r.passed).toBeGreaterThanOrEqual(50);
    expect(read("scripts/compliance/run-pure-selftests.ts")).toMatch(/assertRan\("version-pins-core", __runVersionPinsTests\(\), 50\)/);
  });

  it("the repo has exactly the package directories this slice locked", () => {
    expect(packageDirs().sort()).toEqual(["/", "/merch-site"]);
  });

  it("every package, lockfile, workflow and the Dependabot config pass the audit", () => {
    const dirs = packageDirs();
    const workflows = fs
      .readdirSync(path.join(ROOT, ".github/workflows"))
      .filter((f) => /\.ya?ml$/.test(f))
      .map((f) => ({ file: `.github/workflows/${f}`, text: read(`.github/workflows/${f}`) }));
    const findings = auditVersionPins({
      packages: dirs.map((d) => ({ dir: d, pkgText: read(rel(d, "package.json")), lockText: read(rel(d, "package-lock.json")) })),
      workflows,
      dependabot: read(".github/dependabot.yml"),
      npmrc: dirs.map((d) => read(rel(d, ".npmrc"))),
    });
    expect(findings).toEqual([]);
  });

  it("production and CI run Node 24, a major Vercel offers, and not Node 20", () => {
    expect(PRODUCTION_NODE_MAJOR).toBe(24);
    expect(VERCEL_NODE_MAJORS).not.toContain(20);
    for (const d of packageDirs()) {
      const pkg = JSON.parse(read(rel(d, "package.json")));
      expect(pkg.engines).toEqual({ node: "24.x" });
    }
    const wf = read(".github/workflows/compliance-tests.yml");
    expect(wf).not.toMatch(/node-version:\s*20/);
    expect(wf).not.toMatch(/actions\/(checkout|setup-node)@v\d/);
  });

  it("Dependabot proposes upgrades as PRs and the agent re-authors them (rule 17)", () => {
    const dep = read(".github/dependabot.yml");
    const ups = parseDependabotUpdates(dep);
    expect(ups).toContainEqual({ ecosystem: "npm", directory: "/" });
    expect(ups).toContainEqual({ ecosystem: "npm", directory: "/merch-site" });
    expect(ups).toContainEqual({ ecosystem: "github-actions", directory: "/" });
    expect(dep).toMatch(/versioning-strategy:\s*"increase"/);
    expect(dep).toMatch(/cooldown:/);
    expect(dep).toContain("--reset-author");
    const agents = read("AGENTS.md");
    expect(agents).toMatch(/17\. \*\*Locked versions; upgrades only by pull request/);
    expect(agents).toContain("--reset-author");
  });

  it("the Node.js 20 entries on the platform register are closed", () => {
    const byId = (id: string) => PLATFORM_CHANGES.find((e) => e.id === id);
    expect(byId("supabase-js-node20")?.status).toBe("done");
    expect(byId("vercel-node20")?.status).toBe("done");
    expect(byId("github-actions-node20")?.status).toBe("done");
    expect(byId("npm-12-install-scripts")?.status).toBe("watch");
    expect(read("docs/PLATFORM-CHANGES.md")).toContain("npm-12-install-scripts");
  });
});
