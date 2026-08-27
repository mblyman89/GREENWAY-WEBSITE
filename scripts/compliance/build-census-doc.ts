/**
 * Generates docs/LEDGER_REACHABILITY_CENSUS.md from the census data.
 *
 * GENERATED, not written. The document is the census rendered for a human
 * reader; if it were maintained by hand it would drift from the data within a
 * slice or two, and a map that disagrees with the territory is worse than no
 * map. `tests/compliance/ledger-census.test.ts` asserts the file on disk
 * matches what this script produces, so a stale doc fails a gate.
 *
 * Run: npx tsx scripts/compliance/build-census-doc.ts
 * Check only (no write): npx tsx scripts/compliance/build-census-doc.ts --check
 */
import { writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  CENSUS_LAYERS,
  EVENT_FAMILIES,
  FAMILY_TITLES,
  LAYER_TITLES,
  LAYER_RATIONALE,
  summariseCensus,
  censusMessage,
  type CensusRow,
  type LayerStatus,
} from "../../src/lib/accounting/ledger-census-core";
import { buildLedgerCensus } from "../../src/lib/accounting/ledger-census-data";

const REPO = join(__dirname, "..", "..");
const OUT = join(REPO, "docs", "LEDGER_REACHABILITY_CENSUS.md");

/** The chart of accounts, read from every migration that seeds accounts. */
function coaCodes(): string[] {
  const dir = join(REPO, "supabase", "migrations");
  const codes = new Set<string>();
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(dir, f), "utf8");
    for (const m of sql.matchAll(/\('(\d{5})',/g)) codes.add(m[1]);
    for (const m of sql.matchAll(/gl_upsert_account\(\s*'(\d{5})'/g)) codes.add(m[1]);
  }
  return [...codes];
}

const MARK: Record<LayerStatus, string> = {
  PRESENT: "yes",
  MISSING: "NO",
  PARTIAL: "part",
  NOT_APPLICABLE: "n/a",
  UNKNOWN: "?",
};

function esc(s: string): string {
  return s.replace(/\|/g, "\\|");
}

function build(): string {
  const census = buildLedgerCensus(coaCodes());
  const s = summariseCensus(census);
  const L: string[] = [];

  L.push("# Ledger reachability census");
  L.push("");
  L.push(
    "**This file is generated.** Edit `src/lib/accounting/ledger-census-data.ts` and re-run",
  );
  L.push("`npx tsx scripts/compliance/build-census-doc.ts`. A stale copy fails a test.");
  L.push("");
  L.push("## What this is");
  L.push("");
  L.push(
    "Every event in the business that moves money, and an honest answer to one question",
  );
  L.push(
    "for each: does it actually reach the accounting books? Not *should* it, and not *is",
  );
  L.push(
    "there code for it* -- does a real click by a real person land a real journal entry.",
  );
  L.push("");
  L.push("The answer is measured, never assumed. Each cell cites what was checked.");
  L.push("");
  L.push("## The headline");
  L.push("");
  L.push("> " + censusMessage(s));
  L.push("");
  L.push("| | count |");
  L.push("|---|---:|");
  L.push(`| Money events catalogued | ${s.total} |`);
  L.push(`| Proven on all six layers | ${s.fullyProven} |`);
  L.push(`| Cannot reach the books at all | ${s.unreachable} |`);
  L.push(`| Have nothing that even builds the entry | ${s.noBuilder} |`);
  L.push(`| Layers that could not be measured | ${s.unknown} |`);
  L.push("");
  L.push("## The six layers");
  L.push("");
  L.push(
    "A thing can be broken in six different places between a click and a correct set of",
  );
  L.push("books. Each is checked separately, because each fails separately.");
  L.push("");
  L.push("| layer | question | why it is checked on its own |");
  L.push("|---|---|---|");
  for (const l of CENSUS_LAYERS) {
    L.push(`| \`${l}\` | ${esc(LAYER_TITLES[l])} | ${esc(LAYER_RATIONALE[l])} |`);
  }
  L.push("");
  L.push("Legend: `yes` proven, `NO` missing, `part` partial, `n/a` not applicable, `?` unmeasured.");
  L.push("");
  L.push("## Where the gaps are, by layer");
  L.push("");
  L.push("| layer | rows missing |");
  L.push("|---|---:|");
  for (const l of CENSUS_LAYERS) {
    L.push(`| \`${l}\` | ${s.byLayer[l]} of ${s.total} |`);
  }
  L.push("");

  for (const fam of EVENT_FAMILIES) {
    const rows = census.byFamily(fam);
    L.push(`## ${FAMILY_TITLES[fam]}`);
    L.push("");
    L.push("| event | " + CENSUS_LAYERS.map((l) => `${l}`).join(" | ") + " | defect |");
    L.push("|---|" + CENSUS_LAYERS.map(() => ":---:").join("|") + "|:---:|");
    for (const r of rows) {
      const cells = CENSUS_LAYERS.map((l) => MARK[r.layers[l].status]).join(" | ");
      L.push(
        `| \`${r.key.split(".")[1]}\` | ${cells} | ${r.defectId === null ? "--" : r.defectId} |`,
      );
    }
    L.push("");
    for (const r of rows) {
      L.push(`### \`${r.key}\``);
      L.push("");
      L.push(r.event);
      L.push("");
      L.push(`- Accounts: ${r.accountCodes.map((c) => `\`${c}\``).join(", ")}`);
      L.push(`- Builds the entry: ${r.builder === null ? "**nothing**" : `\`${r.builder}\``}`);
      L.push(`- Posts the entry: ${r.poster === null ? "**nothing**" : `\`${r.poster}\``}`);
      L.push("");
      for (const l of CENSUS_LAYERS) {
        const v = r.layers[l];
        const reason = v.reason === undefined ? "" : ` _${v.reason}_`;
        L.push(`- **${l}: ${v.status}** -- ${v.evidence}${reason}`);
      }
      L.push("");
      L.push(`**If this stays broken:** ${r.consequence}`);
      L.push("");
    }
  }

  L.push("## What nothing can build yet");
  L.push("");
  L.push(
    "These rows are not a wiring job. There is no code that produces the journal entry at",
  );
  L.push("all, so the work is to write it, then wire it.");
  L.push("");
  for (const r of census.all().filter((r: CensusRow) => r.builder === null)) {
    L.push(`- \`${r.key}\`${r.defectId === null ? "" : ` (${r.defectId})`}`);
  }
  L.push("");
  L.push("## Where a builder already exists and nothing calls it");
  L.push("");
  L.push(
    "The cheapest real progress available. The accounting logic is written and tested; only",
  );
  L.push("the path from the screen to the ledger is absent.");
  L.push("");
  for (const r of census
    .all()
    .filter((r: CensusRow) => r.builder !== null && r.layers.reachable.status === "MISSING")) {
    L.push(`- \`${r.key}\`${r.defectId === null ? "" : ` (${r.defectId})`} -- \`${r.builder}\``);
  }
  L.push("");
  L.push("## What is deliberately not posted");
  L.push("");
  L.push(
    "A `n/a` is a decision, not an omission, and it is recorded so nobody wires it by",
  );
  L.push("mistake later.");
  L.push("");
  for (const r of census.all()) {
    for (const l of CENSUS_LAYERS) {
      const v = r.layers[l];
      if (v.status !== "NOT_APPLICABLE") continue;
      L.push(`- \`${r.key}\` / \`${l}\`: ${v.reason ?? ""}`);
    }
  }
  L.push("");
  return L.join("\n") + "\n";
}

const text = build();
const check = process.argv.includes("--check");

if (check) {
  if (!existsSync(OUT)) {
    console.error("MISSING: docs/LEDGER_REACHABILITY_CENSUS.md has not been generated.");
    process.exit(1);
  }
  if (readFileSync(OUT, "utf8") !== text) {
    console.error("STALE: docs/LEDGER_REACHABILITY_CENSUS.md does not match the census data.");
    process.exit(1);
  }
  console.log("docs/LEDGER_REACHABILITY_CENSUS.md is current.");
} else {
  writeFileSync(OUT, text, "utf8");
  console.log(`wrote docs/LEDGER_REACHABILITY_CENSUS.md (${text.split("\n").length} lines)`);
}
