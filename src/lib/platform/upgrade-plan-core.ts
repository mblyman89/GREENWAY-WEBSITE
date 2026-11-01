/**
 * G-74 (owner message 16, D115/D116): upgrades the old way.
 *
 * Owner (verbatim): "I don’t understand why our pull requests have to be
 * merged by the dependabot. The previous 1600 pr’s didn’t need the bot. ...
 * Can we go back to the old way of merging pr’s?"
 *
 * Dependabot is removed. This module replaces what it did: given the exact
 * versions pinned in a package.json (G-71e keeps them exact) and the versions
 * the npm registry publishes, it says which packages have a newer patch, minor
 * or major release, and groups them the way rule 17 takes them: patch and
 * minor together in one Greenway Dev PR, each major in its own slice.
 *
 * PURE. No network, no file system. scripts/deps/upgrade-plan.ts fetches the
 * registry data and prints the plan.
 */

export type UpgradeKind = "patch" | "minor" | "major";

export interface Semver {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly pre: string | null;
}

/** "1.2.3" or "1.2.3-beta.1" -> parts; anything else (ranges, tags, git urls) -> null. */
export function parseSemver(v: string): Semver | null {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(String(v).trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ?? null };
}

function cmpPre(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1; // a release is newer than its prerelease
  if (b === null) return -1;
  const pa = a.split(".");
  const pb = b.split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    if (pa[i] === undefined) return -1;
    if (pb[i] === undefined) return 1;
    const na = /^\d+$/.test(pa[i]) ? Number(pa[i]) : NaN;
    const nb = /^\d+$/.test(pb[i]) ? Number(pb[i]) : NaN;
    if (!Number.isNaN(na) && !Number.isNaN(nb)) {
      if (na !== nb) return na < nb ? -1 : 1;
    } else if (pa[i] !== pb[i]) {
      return pa[i] < pb[i] ? -1 : 1;
    }
  }
  return 0;
}

/** Semver order: negative when a < b. */
export function compareSemver(a: Semver, b: Semver): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  return cmpPre(a.pre, b.pre);
}

/** The size of the move from `from` to `to` (to must be newer). */
export function upgradeKind(from: Semver, to: Semver): UpgradeKind {
  if (to.major !== from.major) return "major";
  // Before 1.0.0 a minor bump is breaking (semver item 4), so treat it as a major.
  if (from.major === 0 && to.minor !== from.minor) return "major";
  if (to.minor !== from.minor) return "minor";
  return "patch";
}

/** What the registry says about one package. */
export interface RegistryInfo {
  /** Every published version. */
  readonly versions: readonly string[];
  /** dist-tags.latest: the release the maintainers call current. */
  readonly latest: string | null;
  /** version -> publish time (ISO). Optional; used for the cooldown. */
  readonly time?: Readonly<Record<string, string>>;
  /** version -> deprecation message, when the version is deprecated. */
  readonly deprecated?: Readonly<Record<string, string>>;
}

export interface PackageUpgrade {
  readonly dir: string;
  readonly name: string;
  readonly section: string;
  readonly current: string;
  /** Newest release in the same major (patch/minor), after the cooldown; null when none. */
  readonly sameMajor: string | null;
  readonly sameMajorKind: "patch" | "minor" | null;
  /** dist-tags.latest when it is a newer major; null otherwise. */
  readonly nextMajor: string | null;
  /** Releases newer than current that are younger than the cooldown, so not offered yet. */
  readonly tooNew: readonly string[];
  /** Set when the pinned version itself is deprecated on the registry. */
  readonly currentDeprecated: string | null;
  /** Why the next major is held (it is reported, never offered); null when not held. */
  readonly majorHeld: string | null;
}

export interface UpgradePlan {
  readonly upgrades: readonly PackageUpgrade[];
  /** Packages whose spec is not one exact version (should never happen after G-71e). */
  readonly notExact: ReadonlyArray<{ dir: string; name: string; spec: string }>;
  /** Packages the registry did not answer for. */
  readonly unknown: ReadonlyArray<{ dir: string; name: string }>;
}

/** Days a release must have been public before it is offered (the old Dependabot cooldown). */
export const UPGRADE_COOLDOWN_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * One package: the newest same-major release (no prereleases, not deprecated,
 * at least `cooldownDays` old when publish times are known, never above
 * dist-tags.latest) and the next major when latest is one.
 */
export function planPackage(
  dir: string,
  section: string,
  name: string,
  current: string,
  info: RegistryInfo,
  now: Date,
  cooldownDays: number = UPGRADE_COOLDOWN_DAYS,
  majorHeld: string | null = null,
): PackageUpgrade | null {
  const cur = parseSemver(current);
  if (!cur) return null;
  const latest = info.latest ? parseSemver(info.latest) : null;
  const cutoff = now.getTime() - cooldownDays * DAY_MS;
  const isOldEnough = (v: string) => {
    const t = info.time?.[v];
    if (!t) return true;
    const ms = Date.parse(t);
    return Number.isNaN(ms) || ms <= cutoff;
  };
  let best: Semver | null = null;
  let bestText: string | null = null;
  const tooNew: string[] = [];
  for (const v of info.versions) {
    const s = parseSemver(v);
    if (!s || s.pre !== null) continue;
    if (compareSemver(s, cur) <= 0) continue;
    if (info.deprecated?.[v]) continue;
    if (latest && compareSemver(s, latest) > 0) continue; // never above what maintainers call latest
    if (upgradeKind(cur, s) === "major") continue;
    if (!isOldEnough(v)) {
      tooNew.push(v);
      continue;
    }
    if (!best || compareSemver(s, best) > 0) {
      best = s;
      bestText = v;
    }
  }
  let nextMajor: string | null = null;
  if (latest && latest.pre === null && compareSemver(latest, cur) > 0 && upgradeKind(cur, latest) === "major") {
    nextMajor = info.latest;
  }
  const currentDeprecated = info.deprecated?.[current] ?? null;
  if (!bestText && !nextMajor && tooNew.length === 0 && !currentDeprecated) return null;
  tooNew.sort((a, b) => compareSemver(parseSemver(a)!, parseSemver(b)!));
  return {
    dir,
    name,
    section,
    current,
    sameMajor: bestText,
    sameMajorKind: best ? (upgradeKind(cur, best) as "patch" | "minor") : null,
    nextMajor,
    tooNew,
    currentDeprecated,
    majorHeld: nextMajor ? majorHeld : null,
  };
}

/**
 * Majors that are held on purpose. @types/node describes the Node runtime, so
 * its major follows engines.node (PRODUCTION_NODE_MAJOR in version-pins-core,
 * checked by checkTypesNode) and moves only in the Node-major slice.
 */
export function defaultMajorHolds(productionNodeMajor: number): ReadonlyMap<string, string> {
  return new Map([["@types/node", `follows the Node major production runs (${productionNodeMajor}.x); moves with engines.node in its own slice`]]);
}

type Json = Record<string, unknown>;

/** Every direct dependency of every package directory, planned against the registry. */
export function planUpgrades(
  packages: ReadonlyArray<{ dir: string; pkg: Json }>,
  registry: ReadonlyMap<string, RegistryInfo>,
  now: Date,
  cooldownDays: number = UPGRADE_COOLDOWN_DAYS,
  holds: ReadonlyMap<string, string> = new Map(),
): UpgradePlan {
  const upgrades: PackageUpgrade[] = [];
  const notExact: Array<{ dir: string; name: string; spec: string }> = [];
  const unknown: Array<{ dir: string; name: string }> = [];
  for (const { dir, pkg } of packages) {
    for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
      const m = pkg[section];
      if (!m || typeof m !== "object") continue;
      for (const [name, spec] of Object.entries(m as Record<string, string>)) {
        if (!parseSemver(String(spec))) {
          notExact.push({ dir, name, spec: String(spec) });
          continue;
        }
        const info = registry.get(name);
        if (!info) {
          unknown.push({ dir, name });
          continue;
        }
        const u = planPackage(dir, section, name, String(spec), info, now, cooldownDays, holds.get(name) ?? null);
        if (u) upgrades.push(u);
      }
    }
  }
  upgrades.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir.localeCompare(b.dir)));
  return { upgrades, notExact, unknown };
}

/**
 * Packages that must move together: when the same-major target of one of them
 * differs from the others, `npm install` would leave them out of step (for
 * example @capacitor/core and @capacitor/ios, or react and react-dom).
 */
export const LOCKSTEP_GROUPS: ReadonlyArray<readonly string[]> = [
  ["react", "react-dom"],
  ["@capacitor/core", "@capacitor/ios", "@capacitor/cli"],
  ["next", "eslint-config-next"],
];

/** Lockstep groups whose members are pinned to different versions, or would be after the plan. */
export function lockstepProblems(
  packages: ReadonlyArray<{ dir: string; pkg: Json }>,
  plan: UpgradePlan,
): string[] {
  const out: string[] = [];
  for (const { dir, pkg } of packages) {
    const all: Record<string, string> = {};
    for (const section of ["dependencies", "devDependencies"]) {
      Object.assign(all, (pkg[section] ?? {}) as Record<string, string>);
    }
    for (const group of LOCKSTEP_GROUPS) {
      const present = group.filter((n) => all[n] !== undefined);
      if (present.length < 2) continue;
      const after = present.map((n) => {
        const u = plan.upgrades.find((x) => x.dir === dir && x.name === n);
        return `${n}@${u?.sameMajor ?? all[n]}`;
      });
      const versions = new Set(after.map((a) => a.slice(a.lastIndexOf("@") + 1)));
      if (versions.size > 1) out.push(`${dir}: ${after.join(", ")} would be out of step; move them in one PR to one version`);
    }
  }
  return out;
}

/** The plan in plain English, as the monthly review reads it. */
export function describeUpgradePlan(plan: UpgradePlan, lockstep: readonly string[] = []): string {
  const lines: string[] = [];
  const same = plan.upgrades.filter((u) => u.sameMajor);
  const majors = plan.upgrades.filter((u) => u.nextMajor && !u.majorHeld);
  const held = plan.upgrades.filter((u) => u.nextMajor && u.majorHeld);
  const waiting = plan.upgrades.filter((u) => u.tooNew.length > 0 && !u.sameMajor);
  const deprecated = plan.upgrades.filter((u) => u.currentDeprecated);
  lines.push(`Patch and minor upgrades (take together in one Greenway Dev PR): ${same.length}`);
  for (const u of same) lines.push(`  ${u.dir} ${u.name} ${u.current} -> ${u.sameMajor} (${u.sameMajorKind})`);
  lines.push(`Major upgrades (each in its own slice, after reading the release notes): ${majors.length}`);
  for (const u of majors) lines.push(`  ${u.dir} ${u.name} ${u.current} -> ${u.nextMajor}`);
  if (held.length > 0) {
    lines.push(`Majors held on purpose: ${held.length}`);
    for (const u of held) lines.push(`  ${u.dir} ${u.name} ${u.current} -> ${u.nextMajor}: ${u.majorHeld}`);
  }
  if (waiting.length > 0) {
    lines.push(`Newer releases still inside the ${UPGRADE_COOLDOWN_DAYS}-day wait: ${waiting.length}`);
    for (const u of waiting) lines.push(`  ${u.dir} ${u.name} ${u.current} -> ${u.tooNew.join(", ")}`);
  }
  if (deprecated.length > 0) {
    lines.push(`Pinned versions the registry marks deprecated: ${deprecated.length}`);
    for (const u of deprecated) lines.push(`  ${u.dir} ${u.name} ${u.current}: ${u.currentDeprecated}`);
  }
  if (lockstep.length > 0) {
    lines.push("Must move together:");
    for (const l of lockstep) lines.push(`  ${l}`);
  }
  if (plan.notExact.length > 0) {
    lines.push(`Not pinned to one exact version (fix first, G-71e): ${plan.notExact.length}`);
    for (const n of plan.notExact) lines.push(`  ${n.dir} ${n.name} "${n.spec}"`);
  }
  if (plan.unknown.length > 0) {
    lines.push(`The registry did not answer for: ${plan.unknown.map((u) => `${u.dir} ${u.name}`).join(", ")}`);
  }
  if (same.length === 0 && majors.length === 0 && waiting.length === 0 && deprecated.length === 0) {
    lines.push("Everything is on the newest release.");
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runUpgradePlanTests(): { passed: number; failed: number; failures: string[] } {
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
  const sv = (v: string) => parseSemver(v)!;

  // parseSemver
  ok(parseSemver("1.2.3")?.patch === 3, "parses x.y.z");
  ok(parseSemver("1.2.3-beta.1")?.pre === "beta.1", "parses prerelease");
  ok(parseSemver("1.2.3+build.5")?.pre === null, "build metadata ignored");
  ok(parseSemver("^1.2.3") === null, "range is not a version");
  ok(parseSemver("1.2") === null, "x.y is not a version");
  ok(parseSemver("latest") === null, "tag is not a version");
  ok(parseSemver(" 2.0.0 ")?.major === 2, "trims");

  // compareSemver
  ok(compareSemver(sv("1.2.3"), sv("1.2.4")) < 0, "patch order");
  ok(compareSemver(sv("1.10.0"), sv("1.9.9")) > 0, "numeric, not text, order");
  ok(compareSemver(sv("2.0.0"), sv("2.0.0-rc.1")) > 0, "release newer than its rc");
  ok(compareSemver(sv("2.0.0-rc.2"), sv("2.0.0-rc.10")) < 0, "numeric prerelease parts");
  ok(compareSemver(sv("2.0.0-alpha"), sv("2.0.0-beta")) < 0, "text prerelease parts");
  ok(compareSemver(sv("2.0.0-rc.1"), sv("2.0.0-rc.1.1")) < 0, "longer prerelease is newer");
  ok(compareSemver(sv("3.1.4"), sv("3.1.4")) === 0, "equal");

  // upgradeKind
  ok(upgradeKind(sv("1.2.3"), sv("1.2.9")) === "patch", "patch");
  ok(upgradeKind(sv("1.2.3"), sv("1.5.0")) === "minor", "minor");
  ok(upgradeKind(sv("1.2.3"), sv("2.0.0")) === "major", "major");
  ok(upgradeKind(sv("0.12.7"), sv("0.13.0")) === "major", "0.x minor is breaking");
  ok(upgradeKind(sv("0.12.7"), sv("0.12.9")) === "patch", "0.x patch is a patch");

  // planPackage
  const now = new Date("2026-11-01T12:00:00Z");
  const old = "2026-09-01T00:00:00Z";
  const info: RegistryInfo = {
    versions: ["5.9.0", "5.9.2", "5.9.3", "5.10.0", "5.10.1", "5.11.0-beta", "6.0.0", "7.0.2"],
    latest: "7.0.2",
    time: { "5.9.3": old, "5.10.0": old, "5.10.1": "2026-10-30T00:00:00Z", "6.0.0": old, "7.0.2": old },
  };
  const p = planPackage("/", "devDependencies", "typescript", "5.9.3", info, now)!;
  ok(p.sameMajor === "5.10.0", "newest same-major release past the wait");
  ok(p.sameMajorKind === "minor", "kind is minor");
  ok(p.tooNew.length === 1 && p.tooNew[0] === "5.10.1", "release younger than 7 days held back");
  ok(p.nextMajor === "7.0.2", "latest major offered");
  ok(planPackage("/", "d", "typescript", "5.9.3", info, now, 0)?.sameMajor === "5.10.1", "cooldown 0 offers the newest");
  ok(planPackage("/", "d", "x", "7.0.2", { versions: ["7.0.2"], latest: "7.0.2" }, now) === null, "up to date: nothing");
  ok(planPackage("/", "d", "x", "^1.0.0", info, now) === null, "range spec skipped");
  const noTimes: RegistryInfo = { versions: ["1.0.0", "1.0.5"], latest: "1.0.5" };
  ok(planPackage("/", "d", "x", "1.0.0", noTimes, now)?.sameMajor === "1.0.5", "no publish times: offered");
  ok(planPackage("/", "d", "x", "1.0.0", noTimes, now)?.sameMajorKind === "patch", "patch kind");
  const above: RegistryInfo = { versions: ["1.0.0", "1.1.0", "1.2.0"], latest: "1.1.0" };
  ok(planPackage("/", "d", "x", "1.0.0", above, now)?.sameMajor === "1.1.0", "never above dist-tags.latest");
  const dep: RegistryInfo = { versions: ["1.0.0", "1.0.1", "1.0.2"], latest: "1.0.2", deprecated: { "1.0.2": "broken" } };
  ok(planPackage("/", "d", "x", "1.0.0", dep, now)?.sameMajor === "1.0.1", "deprecated release skipped");
  const curDep: RegistryInfo = { versions: ["1.0.0"], latest: "1.0.0", deprecated: { "1.0.0": "use 2" } };
  ok(planPackage("/", "d", "x", "1.0.0", curDep, now)?.currentDeprecated === "use 2", "deprecated pin reported");
  const preLatest: RegistryInfo = { versions: ["1.0.0", "2.0.0-rc.1"], latest: "2.0.0-rc.1" };
  ok(planPackage("/", "d", "x", "1.0.0", preLatest, now) === null, "prerelease latest is not offered");
  const zero: RegistryInfo = { versions: ["0.12.7", "0.12.9", "0.13.0"], latest: "0.13.0" };
  const z = planPackage("/", "d", "@supabase/ssr", "0.12.7", zero, now)!;
  ok(z.sameMajor === "0.12.9" && z.nextMajor === "0.13.0", "0.x: 0.12.9 with the batch, 0.13 on its own");

  // planUpgrades
  const reg = new Map<string, RegistryInfo>([
    ["typescript", info],
    ["a", { versions: ["1.0.0"], latest: "1.0.0" }],
  ]);
  const plan = planUpgrades(
    [
      { dir: "/", pkg: { dependencies: { a: "1.0.0", gone: "1.0.0" }, devDependencies: { typescript: "5.9.3" } } },
      { dir: "/merch-site", pkg: { devDependencies: { typescript: "5.9.3", b: "^2.0.0" } } },
    ],
    reg,
    now,
  );
  ok(plan.upgrades.length === 2, "one upgrade per directory");
  ok(plan.upgrades[0].dir === "/" && plan.upgrades[1].dir === "/merch-site", "sorted by directory");
  ok(plan.notExact.length === 1 && plan.notExact[0].name === "b", "range reported, not planned");
  ok(plan.unknown.length === 1 && plan.unknown[0].name === "gone", "no registry answer reported");

  // lockstep
  const lsPkgs = [{ dir: "/", pkg: { dependencies: { "@capacitor/core": "8.5.3", "@capacitor/ios": "8.5.3", react: "19.2.4", "react-dom": "19.2.4" } } }];
  const lsPlan: UpgradePlan = {
    upgrades: [
      { dir: "/", name: "@capacitor/core", section: "dependencies", current: "8.5.3", sameMajor: "8.6.0", sameMajorKind: "minor", nextMajor: null, tooNew: [], currentDeprecated: null, majorHeld: null },
    ],
    notExact: [],
    unknown: [],
  };
  const ls = lockstepProblems(lsPkgs, lsPlan);
  ok(ls.length === 1 && ls[0].includes("@capacitor/ios@8.5.3"), "core moving without ios is flagged");
  ok(lockstepProblems(lsPkgs, { upgrades: [], notExact: [], unknown: [] }).length === 0, "in step: clean");
  ok(lockstepProblems([{ dir: "/", pkg: { dependencies: { react: "19.2.4", "react-dom": "19.2.3" } } }], { upgrades: [], notExact: [], unknown: [] }).length === 1, "already out of step flagged");

  // holds
  const tn: RegistryInfo = { versions: ["24.19.2", "24.20.0", "26.6.6"], latest: "26.6.6" };
  const holds = defaultMajorHolds(24);
  const hp = planUpgrades([{ dir: "/", pkg: { devDependencies: { "@types/node": "24.19.2" } } }], new Map([["@types/node", tn]]), now, 7, holds);
  ok(hp.upgrades[0]?.sameMajor === "24.20.0", "@types/node still gets same-major patches");
  ok(hp.upgrades[0]?.majorHeld?.includes("24.x") === true, "@types/node 26 held with the reason");
  const ht = describeUpgradePlan(hp);
  ok(ht.includes("Majors held on purpose: 1") && ht.includes("Major upgrades (each in its own slice, after reading the release notes): 0"), "held major not offered");
  ok(planPackage("/", "d", "x", "1.0.0", noTimes, now, 7, "why")?.majorHeld === null, "hold reason only when there is a major");

  // describe
  const text = describeUpgradePlan(plan, ls);
  ok(text.includes("typescript 5.9.3 -> 5.10.0 (minor)"), "same-major line");
  ok(text.includes("typescript 5.9.3 -> 7.0.2"), "major line");
  ok(text.includes("Must move together"), "lockstep section");
  ok(text.includes('"^2.0.0"'), "range section");
  ok(text.includes("gone"), "unknown section");
  ok(describeUpgradePlan({ upgrades: [], notExact: [], unknown: [] }).includes("Everything is on the newest release."), "nothing to do sentence");

  return { passed, failed, failures };
}
