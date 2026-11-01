/**
 * G-71e (owner message 14, item 5): locked versions plus upgrade pull requests
 * through CI, and the Node.js 20 move.
 *
 * Owner (verbatim): "Please now complete item 5 to close all gaps. Fit inside
 * this slice the node.js fixes too please."
 *
 * PURE. Text in, findings out. tests/compliance/g71e-version-pins.test.ts feeds
 * it the real package.json files, lockfiles, workflow and dependabot.yml.
 *
 * What "locked" means here, each rule with the failure it prevents:
 *
 *  1. Every dependency in package.json is one exact version ("2.108.2", never
 *     "^2.108.2"). A range lets `npm install` move a library without a PR.
 *  2. package.json and package-lock.json agree on every direct dependency, so
 *     the file a person reads is the version that is installed.
 *  3. engines.node is "<major>.x" on a major Vercel offers. Vercel reads this
 *     field and it overrides Project Settings (vercel.com/docs/functions/
 *     runtimes/node-js/node-js-versions), so the production Node version lives
 *     in the repo, under review, not in a dashboard.
 *  4. CI reads its Node version from that same field (`node-version-file:
 *     package.json`) and never names a version itself. If both are given,
 *     setup-node uses node-version, so a literal would silently win.
 *  5. Every `uses:` action is pinned to a full 40-character commit SHA with its
 *     release tag in a comment. A tag like @v4 can be moved by its owner.
 *  6. Dependabot watches every directory that has a package.json, plus the
 *     workflow actions, so every pinned thing has an upgrade path by PR.
 */

/** Node majors Vercel offers for builds and functions (docs updated 2026-02-27: 26.x default, 24.x, 22.x). */
export const VERCEL_NODE_MAJORS: readonly number[] = [22, 24, 26];

/** The Node major production and CI run. One place; the guard test checks both package.json files carry it. */
export const PRODUCTION_NODE_MAJOR = 24;

export interface PinFinding {
  readonly where: string;
  readonly problem: string;
}

type Json = Record<string, unknown>;

const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** True when a dependency spec names exactly one published version. */
export function isExactVersion(spec: string): boolean {
  return EXACT.test(spec.trim());
}

function depMaps(pkg: Json): Array<[string, Record<string, string>]> {
  const out: Array<[string, Record<string, string>]> = [];
  for (const sec of ["dependencies", "devDependencies", "optionalDependencies"]) {
    const m = pkg[sec];
    if (m && typeof m === "object") out.push([sec, m as Record<string, string>]);
  }
  return out;
}

/** Rule 1: every direct dependency is an exact version. */
export function findRanges(pkg: Json, file: string): PinFinding[] {
  const out: PinFinding[] = [];
  for (const [sec, m] of depMaps(pkg)) {
    for (const [name, spec] of Object.entries(m)) {
      if (!isExactVersion(String(spec))) {
        out.push({ where: `${file} ${sec}.${name}`, problem: `"${spec}" is a range; pin the exact version (e.g. the one in package-lock.json)` });
      }
    }
  }
  return out;
}

/** Rule 2: package.json and package-lock.json name the same version for every direct dependency. */
export function findLockDrift(pkg: Json, lock: Json, file: string): PinFinding[] {
  const out: PinFinding[] = [];
  const pkgs = (lock.packages ?? {}) as Record<string, Json>;
  for (const [sec, m] of depMaps(pkg)) {
    for (const [name, spec] of Object.entries(m)) {
      const locked = pkgs[`node_modules/${name}`]?.version;
      if (locked === undefined) {
        out.push({ where: `${file} ${sec}.${name}`, problem: "not in package-lock.json; run npm install and commit the lockfile" });
      } else if (String(locked) !== String(spec)) {
        out.push({ where: `${file} ${sec}.${name}`, problem: `package.json says ${spec} but package-lock.json installs ${locked}` });
      }
    }
  }
  const root = (pkgs[""] ?? {}) as Json;
  const want = JSON.stringify((pkg.engines ?? null) as unknown);
  const got = JSON.stringify((root.engines ?? null) as unknown);
  if (want !== got) out.push({ where: `${file} engines`, problem: `package.json engines ${want} but package-lock.json root has ${got}; run npm install` });
  return out;
}

/** Rule 3: engines.node is "<major>.x" on the production major, which Vercel must offer. */
export function checkEngines(pkg: Json, file: string, major: number = PRODUCTION_NODE_MAJOR): PinFinding[] {
  const node = (pkg.engines as Json | undefined)?.node;
  if (typeof node !== "string") {
    return [{ where: `${file} engines.node`, problem: `missing; set "engines": { "node": "${major}.x" } so the Node version is in the repo, not the Vercel dashboard` }];
  }
  const m = /^(\d+)\.x$/.exec(node.trim());
  if (!m) return [{ where: `${file} engines.node`, problem: `"${node}" must be "<major>.x" (Vercel deploys the latest of that major)` }];
  const n = Number(m[1]);
  const out: PinFinding[] = [];
  if (!VERCEL_NODE_MAJORS.includes(n)) out.push({ where: `${file} engines.node`, problem: `Node ${n} is not offered by Vercel (${VERCEL_NODE_MAJORS.join(", ")})` });
  if (n !== major) out.push({ where: `${file} engines.node`, problem: `"${node}" but the production major is ${major}.x` });
  return out;
}

/** Rule 3b: @types/node matches the Node major we run, so the types describe the runtime. */
export function checkTypesNode(pkg: Json, file: string, major: number = PRODUCTION_NODE_MAJOR): PinFinding[] {
  const spec = (pkg.devDependencies as Record<string, string> | undefined)?.["@types/node"];
  if (spec === undefined) return [];
  return spec.split(".")[0] === String(major) ? [] : [{ where: `${file} devDependencies.@types/node`, problem: `${spec} describes a different Node than ${major}.x` }];
}

/** Rules 4 and 5, read from the workflow text. */
export function checkWorkflow(yaml: string, file: string): PinFinding[] {
  const out: PinFinding[] = [];
  const lines = yaml.split(/\r?\n/);
  let uses = 0;
  let setupNode = 0;
  lines.forEach((raw, i) => {
    const line = raw.replace(/^\s*-\s*/, "").trim();
    if (line.startsWith("#")) return;
    const u = /^uses:\s*(\S+)(.*)$/.exec(line);
    if (u) {
      uses += 1;
      const [ref, rest] = [u[1], u[2]];
      if (ref.startsWith("./") || ref.startsWith("docker://")) return;
      const at = ref.split("@");
      if (at.length !== 2 || !/^[0-9a-f]{40}$/.test(at[1])) {
        out.push({ where: `${file}:${i + 1}`, problem: `${ref} is not pinned to a 40-character commit SHA` });
      } else if (!/#\s*v\d+(\.\d+){0,2}\b/.test(rest)) {
        out.push({ where: `${file}:${i + 1}`, problem: `${ref} has no "# vX.Y.Z" comment naming the release` });
      }
      if (at[0] === "actions/setup-node") setupNode += 1;
    }
    if (/^node-version\s*:/.test(line)) {
      out.push({ where: `${file}:${i + 1}`, problem: `"${line}" names a Node version in CI; use node-version-file: package.json (a literal would override engines.node)` });
    }
  });
  const files = (yaml.match(/^\s*node-version-file:\s*package\.json\s*$/gm) ?? []).length;
  if (setupNode !== files) {
    out.push({ where: file, problem: `${setupNode} setup-node step(s) but ${files} read node-version-file: package.json; every one must` });
  }
  if (uses === 0) out.push({ where: file, problem: "no uses: steps found; is this the right file?" });
  return out;
}

/** The ecosystem/directory pairs a dependabot.yml declares (enough YAML for our own file). */
export function parseDependabotUpdates(yaml: string): Array<{ ecosystem: string; directory: string }> {
  const out: Array<{ ecosystem: string; directory: string }> = [];
  let cur: { ecosystem: string; directory: string } | null = null;
  for (const raw of yaml.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "");
    const eco = /^\s*-\s*package-ecosystem:\s*"?([\w-]+)"?\s*$/.exec(line);
    if (eco) {
      if (cur) out.push(cur);
      cur = { ecosystem: eco[1], directory: "" };
      continue;
    }
    const dir = /^\s+directory:\s*"?([^"\s]+)"?\s*$/.exec(line);
    if (dir && cur) cur.directory = dir[1];
  }
  if (cur) out.push(cur);
  return out;
}

/** Rule 6: Dependabot covers every npm directory and the workflow actions. */
export function checkDependabot(yaml: string, npmDirs: readonly string[]): PinFinding[] {
  const ups = parseDependabotUpdates(yaml);
  const out: PinFinding[] = [];
  if (!/^version:\s*2\s*$/m.test(yaml)) out.push({ where: ".github/dependabot.yml", problem: "must start with version: 2" });
  for (const d of npmDirs) {
    if (!ups.some((u) => u.ecosystem === "npm" && u.directory === d)) {
      out.push({ where: ".github/dependabot.yml", problem: `no npm entry for ${d}; its pinned versions would never get an upgrade PR` });
    }
  }
  if (!ups.some((u) => u.ecosystem === "github-actions" && u.directory === "/")) {
    out.push({ where: ".github/dependabot.yml", problem: "no github-actions entry; the SHA-pinned actions would never get an upgrade PR" });
  }
  if (/versioning-strategy:\s*"?(widen|increase-if-necessary)"?/.test(yaml)) {
    out.push({ where: ".github/dependabot.yml", problem: "widen / increase-if-necessary would write ranges back; use increase" });
  }
  return out;
}

/** One package directory: package.json + package-lock.json text. */
export interface PackageDir {
  readonly dir: string;
  readonly pkgText: string;
  readonly lockText: string;
}

/** Every rule over every file. Empty means locked. */
export function auditVersionPins(input: {
  packages: readonly PackageDir[];
  workflows: ReadonlyArray<{ file: string; text: string }>;
  dependabot: string;
  npmrc: readonly string[];
}): PinFinding[] {
  const out: PinFinding[] = [];
  for (const p of input.packages) {
    const file = p.dir === "/" ? "package.json" : `${p.dir.replace(/^\//, "")}/package.json`;
    const pkg = JSON.parse(p.pkgText) as Json;
    const lock = JSON.parse(p.lockText) as Json;
    out.push(...findRanges(pkg, file), ...findLockDrift(pkg, lock, file), ...checkEngines(pkg, file), ...checkTypesNode(pkg, file));
  }
  for (const w of input.workflows) out.push(...checkWorkflow(w.text, w.file));
  out.push(...checkDependabot(input.dependabot, input.packages.map((p) => p.dir)));
  input.npmrc.forEach((t, i) => {
    if (!/^\s*save-exact\s*=\s*true\s*$/m.test(t)) out.push({ where: `.npmrc #${i + 1}`, problem: "save-exact=true missing; npm install would write a ^range" });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runVersionPinsTests(): { passed: number; failed: number; failures: string[] } {
  let passed = 0;
  let failed = 0;
  const failures: string[] = [];
  const ok = (c: boolean, name: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      failures.push(name);
    }
  };

  // isExactVersion
  ok(isExactVersion("2.108.2"), "exact x.y.z");
  ok(isExactVersion("1.0.0-beta.3"), "exact prerelease");
  ok(!isExactVersion("^2.108.2"), "caret is a range");
  ok(!isExactVersion("~1.2.3"), "tilde is a range");
  ok(!isExactVersion("^4"), "bare major is a range");
  ok(!isExactVersion("*"), "star is a range");
  ok(!isExactVersion(">=1.0.0"), ">= is a range");
  ok(!isExactVersion("latest"), "dist-tag is not exact");
  ok(!isExactVersion("1.2"), "x.y is a range");
  ok(!isExactVersion("1.2.x"), "x wildcard is a range");
  ok(!isExactVersion("github:a/b"), "git spec is not exact");

  // findRanges
  const pkg = { dependencies: { a: "1.0.0", b: "^2.0.0" }, devDependencies: { c: "^4" } };
  const r = findRanges(pkg, "package.json");
  ok(r.length === 2, "two ranges found");
  ok(r.some((f) => f.where === "package.json dependencies.b"), "names the section and package");
  ok(r.some((f) => f.where === "package.json devDependencies.c"), "dev deps checked too");
  ok(findRanges({ dependencies: { a: "1.0.0" } }, "p").length === 0, "all exact: clean");
  ok(findRanges({}, "p").length === 0, "no deps: clean");

  // findLockDrift
  const lock = { packages: { "": { engines: { node: "24.x" } }, "node_modules/a": { version: "1.0.0" }, "node_modules/b": { version: "2.0.1" } } };
  const d = findLockDrift({ engines: { node: "24.x" }, dependencies: { a: "1.0.0", b: "2.0.0" } }, lock, "package.json");
  ok(d.length === 1 && d[0].problem.includes("2.0.1"), "drift names the installed version");
  ok(findLockDrift({ engines: { node: "24.x" }, dependencies: { a: "1.0.0" } }, lock, "p").length === 0, "in step: clean");
  ok(findLockDrift({ engines: { node: "24.x" }, dependencies: { z: "1.0.0" } }, lock, "p")[0]?.problem.includes("not in package-lock"), "missing from lock");
  ok(findLockDrift({ dependencies: { a: "1.0.0" } }, lock, "p").some((f) => f.where.endsWith("engines")), "engines must be in the lock root too");

  // checkEngines
  ok(checkEngines({ engines: { node: "24.x" } }, "p").length === 0, "24.x is the production major");
  ok(checkEngines({}, "p")[0]?.problem.startsWith("missing"), "missing engines flagged");
  ok(checkEngines({ engines: { node: ">=20" } }, "p")[0]?.problem.includes("<major>.x"), "open range flagged");
  ok(checkEngines({ engines: { node: "20.x" } }, "p").some((f) => f.problem.includes("not offered by Vercel")), "Node 20 is not offered by Vercel");
  ok(checkEngines({ engines: { node: "22.x" } }, "p").length === 1, "22 offered but not the production major");
  ok(checkEngines({ engines: { node: "26.x" } }, "p", 26).length === 0, "major is a parameter (a future move to 26)");
  ok(VERCEL_NODE_MAJORS.includes(PRODUCTION_NODE_MAJOR), "production major is one Vercel offers");

  // checkTypesNode
  ok(checkTypesNode({ devDependencies: { "@types/node": "24.19.2" } }, "p").length === 0, "@types/node 24 matches");
  ok(checkTypesNode({ devDependencies: { "@types/node": "20.19.43" } }, "p").length === 1, "@types/node 20 flagged");
  ok(checkTypesNode({}, "p").length === 0, "no @types/node: nothing to check");

  // checkWorkflow
  const SHA = "3d3c42e5aac5ba805825da76410c181273ba90b1";
  const SHA2 = "949feb2413d6458794dcd2491c4babbbce0c15c1";
  const good = [
    "jobs:",
    "  a:",
    "    steps:",
    `      - uses: actions/checkout@${SHA} # v7.0.1`,
    `      - uses: actions/setup-node@${SHA2} # v7.1.0`,
    "        with:",
    "          node-version-file: package.json",
    "          cache: npm",
  ].join("\n");
  ok(checkWorkflow(good, "w").length === 0, "SHA pins + node-version-file: clean");
  ok(checkWorkflow(good.replace(`@${SHA} # v7.0.1`, "@v4"), "w").some((f) => f.problem.includes("40-character")), "floating tag flagged");
  ok(checkWorkflow(good.replace(" # v7.0.1", ""), "w").some((f) => f.problem.includes("# vX.Y.Z")), "SHA without release comment flagged");
  ok(checkWorkflow(good.replace("node-version-file: package.json", "node-version: 20"), "w").some((f) => f.problem.includes("names a Node version")), "node-version literal flagged");
  ok(checkWorkflow(good.replace("node-version-file: package.json", "node-version: 20"), "w").some((f) => f.problem.includes("setup-node step")), "setup-node without node-version-file flagged");
  ok(checkWorkflow(good + "\n          node-version: 24", "w").some((f) => f.problem.includes("override")), "literal alongside the file still flagged (it would win)");
  ok(checkWorkflow(good.replace(SHA, SHA.slice(0, 7)), "w").length === 1, "short SHA is not a pin");
  ok(checkWorkflow(good + "\n      # - uses: actions/foo@v1", "w").length === 0, "commented-out lines ignored");
  ok(checkWorkflow(good + "\n      - uses: ./local-action", "w").length === 0, "local actions need no SHA");
  ok(checkWorkflow("name: x", "w").some((f) => f.problem.includes("no uses")), "empty workflow flagged");

  // dependabot
  const dep = [
    "version: 2",
    "updates:",
    '  - package-ecosystem: "npm"',
    '    directory: "/"',
    '    versioning-strategy: "increase"',
    '  - package-ecosystem: "npm"',
    '    directory: "/merch-site"',
    '  - package-ecosystem: "github-actions"',
    '    directory: "/"',
  ].join("\n");
  ok(parseDependabotUpdates(dep).length === 3, "parses three update entries");
  ok(parseDependabotUpdates(dep)[1].directory === "/merch-site", "reads directory");
  ok(checkDependabot(dep, ["/", "/merch-site"]).length === 0, "covers both npm dirs and actions");
  ok(checkDependabot(dep, ["/", "/merch-site", "/new-app"]).some((f) => f.problem.includes("/new-app")), "a new package dir without Dependabot is flagged");
  ok(checkDependabot(dep.replace('"github-actions"', '"docker"'), ["/"]).some((f) => f.problem.includes("github-actions")), "missing actions entry flagged");
  ok(checkDependabot(dep.replace('"increase"', '"widen"'), ["/"]).some((f) => f.problem.includes("widen")), "widen would reintroduce ranges");
  ok(checkDependabot(dep.replace("version: 2", "version: 1"), ["/"]).length === 1, "version 2 required");

  // auditVersionPins end to end
  const pj = JSON.stringify({ engines: { node: "24.x" }, dependencies: { a: "1.0.0" }, devDependencies: { "@types/node": "24.19.2" } });
  const lk = JSON.stringify({ packages: { "": { engines: { node: "24.x" } }, "node_modules/a": { version: "1.0.0" }, "node_modules/@types/node": { version: "24.19.2" } } });
  const base = { packages: [{ dir: "/", pkgText: pj, lockText: lk }], workflows: [{ file: "w", text: good }], dependabot: dep, npmrc: ["save-exact=true\n"] };
  ok(auditVersionPins(base).length === 0, "audit clean on a locked repo");
  ok(auditVersionPins({ ...base, npmrc: ["# nothing\n"] }).some((f) => f.problem.includes("save-exact")), "missing save-exact flagged");
  ok(auditVersionPins({ ...base, packages: [{ dir: "/merch-site", pkgText: pj.replace('"1.0.0"', '"^1.0.0"'), lockText: lk }] }).some((f) => f.where.startsWith("merch-site/package.json")), "subdirectory named in findings");

  return { passed, failed, failures };
}
