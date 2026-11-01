/**
 * scripts/platform/upgrade-plan.ts  (G-74, owner message 16, D116)
 *
 * Owner (verbatim): "Can we go back to the old way of merging pr’s?"
 *
 * Replaces Dependabot. Reads package.json and merch-site/package.json (exact
 * versions, G-71e), asks the npm registry what each package has published,
 * and prints the plan from src/lib/platform/upgrade-plan-core.ts:
 *   - patch and minor releases at least 7 days old -> one Greenway Dev PR;
 *   - majors -> each in its own slice, after reading the release notes
 *     (@types/node is held to the Node major production runs);
 *   - packages that must move together, deprecated pins, anything unpinned.
 *
 * Run at the monthly platform review (standing rule 16), then follow rule 17.
 *
 * Usage:  npx tsx scripts/platform/upgrade-plan.ts          (plain English)
 *         npx tsx scripts/platform/upgrade-plan.ts --json   (machine readable)
 *
 * Read-only: it changes no file. Network: registry.npmjs.org only.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { PRODUCTION_NODE_MAJOR } from "../../src/lib/platform/version-pins-core";
import {
  defaultMajorHolds,
  describeUpgradePlan,
  lockstepProblems,
  planUpgrades,
  type RegistryInfo,
} from "../../src/lib/platform/upgrade-plan-core";

const ROOT = path.resolve(__dirname, "../..");
const DIRS = ["/", "/merch-site"];

type Json = Record<string, unknown>;

function readPkg(dir: string): Json | null {
  const file = path.join(ROOT, dir === "/" ? "" : dir.slice(1), "package.json");
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Json) : null;
}

async function fetchInfo(name: string): Promise<RegistryInfo | null> {
  const url = `https://registry.npmjs.org/${name.replace("/", "%2F")}`;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const doc = (await res.json()) as {
        "dist-tags"?: Record<string, string>;
        versions?: Record<string, { deprecated?: string }>;
        time?: Record<string, string>;
      };
      const versions = Object.keys(doc.versions ?? {});
      const deprecated: Record<string, string> = {};
      for (const [v, meta] of Object.entries(doc.versions ?? {})) {
        if (meta && typeof meta.deprecated === "string" && meta.deprecated) deprecated[v] = meta.deprecated;
      }
      return { versions, latest: doc["dist-tags"]?.latest ?? null, time: doc.time ?? {}, deprecated };
    } catch (e) {
      if (attempt === 3) {
        console.error(`registry: ${name}: ${(e as Error).message}`);
        return null;
      }
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  return null;
}

async function main(): Promise<void> {
  const packages = DIRS.map((dir) => ({ dir, pkg: readPkg(dir) })).filter(
    (p): p is { dir: string; pkg: Json } => p.pkg !== null,
  );
  const names = new Set<string>();
  for (const { pkg } of packages) {
    for (const s of ["dependencies", "devDependencies", "optionalDependencies"]) {
      for (const n of Object.keys((pkg[s] ?? {}) as Record<string, string>)) names.add(n);
    }
  }
  const registry = new Map<string, RegistryInfo>();
  const list = [...names];
  const CONCURRENCY = 6;
  for (let i = 0; i < list.length; i += CONCURRENCY) {
    const part = list.slice(i, i + CONCURRENCY);
    const infos = await Promise.all(part.map(fetchInfo));
    part.forEach((n, j) => {
      const info = infos[j];
      if (info) registry.set(n, info);
    });
  }
  const plan = planUpgrades(packages, registry, new Date(), undefined, defaultMajorHolds(PRODUCTION_NODE_MAJOR));
  const lockstep = lockstepProblems(packages, plan);
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ ...plan, lockstep }, null, 2));
  } else {
    console.log(describeUpgradePlan(plan, lockstep));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
