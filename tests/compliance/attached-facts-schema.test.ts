/**
 * tests/compliance/attached-facts-schema.test.ts  (S08)
 *
 * Pins migration 0235_attached_facts.sql to its TypeScript half
 * (src/lib/catalog/attach-facts-core.ts) and to the doctrine the owner relies
 * on:
 *
 *   - the source CHECK and FACT_SOURCES are the SAME list, in both
 *     directions (spec test: an invalid source is rejected by the check);
 *   - the provenance table has exactly PROVENANCE_COLUMNS, and every CHECK
 *     buildProvenanceRow() mirrors is really in the SQL;
 *   - the table is append-only BY TRIGGER (update, delete, truncate);
 *   - it has NO foreign keys, and the factory reset KEEPS it;
 *   - RLS is on with no policy, and nothing is granted to anon/authenticated;
 *   - every statement is idempotent (spec test: re-runnable migration);
 *   - the precheck refuses to run before 0234;
 *   - the file survives the Supabase SQL editor paste;
 *   - nothing in src/ reads or writes the new schema yet (acceptance: "no app
 *     change until S07/S11");
 *   - the real-Postgres scenario script is committed and covers the spec
 *     tests.
 *
 * EXECUTION on a real Postgres is covered by the CI `migrations` job
 * (verify-migrations-execute.ts applies every migration and re-applies the
 * last one) and by scripts/recon/attached-facts-pg-check.sql. This file is the
 * static contract.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  ATTACHED_FACTS_MIGRATION,
  DRAFT_FACT_COLUMNS,
  DRAFT_FACT_SELECT,
  mergeDraftAttachedFacts,
  FACT_FIELD_KEY_RE,
  FACT_SOURCES,
  PROVENANCE_COLUMNS,
  PROVENANCE_SELECT,
  PROVENANCE_TABLE,
  __runAttachFactsCoreTests,
  buildProvenanceRow,
  isFactSource,
  isMissingAttachedFactsError,
  sourceCheckSqlList,
  toStoredConfidence,
} from "@/lib/catalog/attach-facts-core";
import { classifyTable } from "@/lib/accounting/factory-reset-core";
import { SCHEMA_TABLES } from "@/lib/admin/schema-tables";
import {
  stripSqlComments,
  transitHazards,
} from "../../scripts/compliance/strip-comments-for-sql-editor";

const ROOT = path.resolve(__dirname, "../..");
const MIGRATION_PATH = path.join(ROOT, "supabase/migrations", ATTACHED_FACTS_MIGRATION);
const PG_CHECK_PATH = path.join(ROOT, "scripts/recon/attached-facts-pg-check.sql");
const SQL = readFileSync(MIGRATION_PATH, "utf8");
const CODE = stripSqlComments(SQL);
/** CODE with '...' literals blanked, so words inside COMMENT strings never count as SQL. */
const BARE = CODE.replace(/'(?:[^']|'')*'/g, "''");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** Body of `create table if not exists public.product_fact_provenance ( ... );` (balanced parens). */
function tableBody(): string {
  const head = /create\s+table\s+if\s+not\s+exists\s+public\.product_fact_provenance\s*\(/i.exec(CODE);
  if (!head) return "";
  let depth = 1;
  let i = head.index + head[0].length;
  const start = i;
  while (i < CODE.length && depth > 0) {
    if (CODE[i] === "(") depth++;
    else if (CODE[i] === ")") depth--;
    i++;
  }
  return CODE.slice(start, i - 1);
}

/** Top-level comma split (ignores commas inside parens). */
function topLevelParts(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of body) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

const BODY = tableBody();
const PARTS = topLevelParts(BODY);
const COLUMN_PARTS = PARTS.filter((p) => !/^constraint\s/i.test(p));
const CONSTRAINTS = PARTS.filter((p) => /^constraint\s/i.test(p));

function srcFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...srcFiles(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("S08 pure core", () => {
  it("embedded self-tests pass and are registered with a floor", () => {
    const r = __runAttachFactsCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(89);
    expect(read("scripts/compliance/run-pure-selftests.ts")).toMatch(
      /assertRan\("attach-facts-core", __runAttachFactsCoreTests\(\), 89\)/, // S11 raised the floor (section 6: the draft merge)
    );
  });
});

describe("S08 migration 0235 - source vocabulary parity (spec test: invalid source rejected)", () => {
  const check = CONSTRAINTS.find((c) => /pfp_source_known/.test(c)) ?? "";
  const sqlSources = [...check.matchAll(/'([^']*)'/g)].map((m) => m[1]);

  it("the CHECK exists and is named pfp_source_known", () => {
    expect(check).toMatch(/^constraint\s+pfp_source_known\s+check\s*\(\s*source\s+in\s*\(/i);
  });

  it("SQL list == FACT_SOURCES, same order, both directions", () => {
    expect(sqlSources).toEqual([...FACT_SOURCES]);
    expect(check.replace(/\s+/g, " ")).toContain(sourceCheckSqlList());
  });

  it("matches the S08 spec vocabulary exactly (bible S08.3)", () => {
    expect([...FACT_SOURCES]).toEqual(["manifest", "coa", "kb_published", "kb_draft", "gemini", "human", "remembered", "cultivera"]);
  });

  it("source is NOT NULL, so a missing source cannot slip past the CHECK", () => {
    expect(COLUMN_PARTS.find((p) => /^source\s/.test(p))).toMatch(/^source\s+text\s+not\s+null$/i);
  });

  it("TS refuses exactly what the DB refuses (case, whitespace, unknown)", () => {
    for (const s of sqlSources) expect(isFactSource(s)).toBe(true);
    for (const bad of ["Gemini", " gemini", "ai", "kb", "", "openai"]) expect(isFactSource(bad)).toBe(false);
  });
});

describe("S08 migration 0235 - product_fact_provenance shape", () => {
  it("columns == PROVENANCE_COLUMNS (same order)", () => {
    expect(COLUMN_PARTS.map((p) => p.split(/\s+/)[0])).toEqual([...PROVENANCE_COLUMNS]);
    expect(PROVENANCE_SELECT).toBe(PROVENANCE_COLUMNS.join(", "));
  });

  it("types and nullability match the spec (plus created_at NOT NULL)", () => {
    const def = (c: string) => (COLUMN_PARTS.find((p) => p.split(/\s+/)[0] === c) ?? "").replace(/\s+/g, " ");
    expect(def("id")).toBe("id uuid primary key default gen_random_uuid()");
    expect(def("identity_key")).toBe("identity_key text not null");
    expect(def("field")).toBe("field text not null");
    expect(def("created_at")).toBe("created_at timestamptz not null default now()");
    for (const c of ["kb_product_id", "draft_id", "lot_id", "actor_id"]) expect(def(c)).toBe(`${c} uuid`);
    expect(def("pos_product_key")).toBe("pos_product_key text");
    expect(def("value_json")).toBe("value_json jsonb");
    expect(def("confidence")).toBe("confidence numeric");
    expect(def("source_urls")).toBe("source_urls text[]");
  });

  it("carries the four named CHECKs the TS builder mirrors", () => {
    const names = CONSTRAINTS.map((c) => c.split(/\s+/)[1]);
    expect(names).toEqual(["pfp_source_known", "pfp_identity_not_blank", "pfp_field_key", "pfp_confidence_unit"]);
    const flat = CONSTRAINTS.join(" ").replace(/\s+/g, " ");
    expect(flat).toContain("check (btrim(identity_key) <> '')");
    expect(flat).toContain("check (field ~ '^[a-z][a-z0-9_]*$')");
    expect(flat).toContain("check (confidence is null or (confidence >= 0 and confidence <= 1))");
  });

  it("the field-key regex in SQL is the same one TS uses", () => {
    const m = /field\s*~\s*'([^']+)'/.exec(CONSTRAINTS.join(" "));
    expect(m?.[1]).toBe(FACT_FIELD_KEY_RE.source);
  });

  it("the TS builder refuses every row a CHECK would refuse (no 23514 in production)", () => {
    const base = { identityKey: "acme|flower|blue dream", field: "description", value: "x", source: "gemini" };
    expect(buildProvenanceRow(base).ok).toBe(true);
    expect(buildProvenanceRow({ ...base, source: "ai" }).ok).toBe(false);
    expect(buildProvenanceRow({ ...base, identityKey: "  " }).ok).toBe(false);
    expect(buildProvenanceRow({ ...base, field: "Description" }).ok).toBe(false);
    expect(buildProvenanceRow({ ...base, confidence: 95 }).ok).toBe(false);
    expect(buildProvenanceRow({ ...base, confidence: toStoredConfidence(95) }).ok).toBe(true);
  });

  it("the recall index is (identity_key, field, created_at desc), as specified", () => {
    expect(CODE.replace(/\s+/g, " ")).toContain(
      "create index if not exists idx_pfp_identity on public.product_fact_provenance (identity_key, field, created_at desc);",
    );
  });

  it("declares NO foreign keys (kept table; draft/lot ids are stamps)", () => {
    expect(BODY).not.toMatch(/\breferences\b/i);
    expect(BARE).not.toMatch(/foreign\s+key/i);
    expect(BARE).not.toMatch(/on\s+delete/i);
    expect(BARE).not.toMatch(/\breferences\b/i);
  });

  it("creates nothing unique beyond the primary key (history has duplicates by design)", () => {
    expect(BARE).not.toMatch(/\bunique\b/i);
  });
});

describe("S08 migration 0235 - append-only is enforced, not promised", () => {
  const flat = CODE.replace(/\s+/g, " ");

  it("a trigger refuses UPDATE and DELETE row by row", () => {
    expect(flat).toContain(
      "create trigger trg_pfp_append_only before update or delete on public.product_fact_provenance for each row execute function public.product_fact_provenance_append_only();",
    );
  });

  it("a statement trigger refuses TRUNCATE", () => {
    expect(flat).toContain(
      "create trigger trg_pfp_no_truncate before truncate on public.product_fact_provenance for each statement execute function public.product_fact_provenance_append_only();",
    );
  });

  it("the function raises (never returns a row) with a greppable prefix", () => {
    const fn = /create or replace function public\.product_fact_provenance_append_only\(\)([\s\S]*?)\$fn\$;/i.exec(CODE)?.[1] ?? "";
    expect(fn).toMatch(/raise exception 'PROVENANCE_IMMUTABLE:/);
    expect(fn).not.toMatch(/return\s+(new|old)/i);
    expect(fn).toMatch(/set search_path = public/);
  });

  it("the insert path is NOT blocked (no insert trigger)", () => {
    expect(flat).not.toMatch(/before insert[^;]*product_fact_provenance/i);
  });
});

describe("S08 migration 0235 - draft columns (chosen_* doctrine)", () => {
  it("adds exactly DRAFT_FACT_COLUMNS as nullable jsonb with no default", () => {
    const m = /alter table public\.catalog_product_drafts([\s\S]*?);/i.exec(CODE);
    const cols = [...(m?.[1] ?? "").matchAll(/add column if not exists (\w+)\s+([^,]+)/gi)].map((x) => [x[1], x[2].trim()]);
    expect(cols).toEqual(DRAFT_FACT_COLUMNS.map((c) => [c, "jsonb"]));
    expect(m?.[1]).not.toMatch(/default|not null/i);
  });

  it("alters no other existing table", () => {
    const altered = [...CODE.matchAll(/alter\s+table\s+public\.(\w+)/gi)].map((x) => x[1]);
    expect([...new Set(altered)].sort()).toEqual(["catalog_product_drafts", "product_fact_provenance"]);
  });

  it("the attached_facts comment carries the spec doctrine verbatim (precedence + raw untouched)", () => {
    expect(SQL).toContain("Per-field facts married at onboarding: {field:{value, source, confidence, at}}.");
    expect(SQL).toContain("Human > coa/manifest > kb_published > gemini(auto >=90) > gemini(review). Raw manifest values untouched.");
  });

  it("every new column and the table have an in-catalog comment", () => {
    for (const c of DRAFT_FACT_COLUMNS) expect(CODE).toMatch(new RegExp(`comment on column public\\.catalog_product_drafts\\.${c} is`));
    expect(CODE).toMatch(/comment on table public\.product_fact_provenance is/);
    for (const c of ["identity_key", "source", "confidence"]) {
      expect(CODE).toMatch(new RegExp(`comment on column public\\.product_fact_provenance\\.${c} is`));
    }
  });
});

describe("S08 migration 0235 - security", () => {
  it("RLS on, no policy, anon/authenticated revoked, function not public", () => {
    expect(CODE).toMatch(/alter table public\.product_fact_provenance enable row level security;/);
    expect(BARE).not.toMatch(/create\s+policy/i);
    expect(BARE).not.toMatch(/\bgrant\b/i);
    expect(CODE).toMatch(/revoke all on public\.product_fact_provenance from anon, authenticated;/);
    expect(CODE).toMatch(/revoke all on function public\.product_fact_provenance_append_only\(\) from public;/);
  });
});

describe("S08 migration 0235 - re-runnable (spec test) and ordered", () => {
  it("every create / add is guarded", () => {
    const creates = CODE.match(/create\s+(table|index)\s+(?!if not exists)/gi) ?? [];
    expect(creates).toEqual([]);
    expect(CODE.match(/add\s+column\s+(?!if not exists)/gi) ?? []).toEqual([]);
    expect(CODE).toMatch(/create or replace function/);
    expect(CODE.match(/create trigger/gi)?.length).toBe(2);
    expect(CODE.match(/drop trigger if exists/gi)?.length).toBe(2);
  });

  it("each trigger is dropped right before it is created (so a re-run replaces it)", () => {
    for (const t of ["trg_pfp_append_only", "trg_pfp_no_truncate"]) {
      const d = CODE.indexOf(`drop trigger if exists ${t}`);
      const c = CODE.indexOf(`create trigger ${t}`);
      expect(d).toBeGreaterThan(-1);
      expect(c).toBeGreaterThan(d);
    }
  });

  it("no data is rewritten: no update / delete / insert / drop table / drop column", () => {
    expect(BARE).not.toMatch(/\bupdate\s+public\./i);
    expect(BARE).not.toMatch(/\bdelete\s+from\b/i);
    expect(BARE).not.toMatch(/\binsert\s+into\b/i);
    expect(BARE).not.toMatch(/drop\s+(table|column)/i);
    expect(BARE.length).toBeGreaterThan(2000); // guard: blanking must not eat the file
  });

  it("the precheck refuses before 0026 (drafts) and before 0234 (identity)", () => {
    const pre = /do \$precheck\$([\s\S]*?)\$precheck\$;/.exec(CODE)?.[1] ?? "";
    expect(pre).toMatch(/to_regclass\('public\.catalog_product_drafts'\) is null/);
    expect(pre).toMatch(/column_name = 'identity_key'/);
    expect(pre).toMatch(/MIGRATION_OUT_OF_ORDER: 0235 depends on the product identity added by 0234_product_identity\.sql/);
    expect(CODE.indexOf("$precheck$")).toBeLessThan(CODE.indexOf("alter table"));
  });

  it("is numbered right after 0234 (S15 0236 now follows it)", () => {
    const files = readdirSync(path.join(ROOT, "supabase/migrations")).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
    const at = files.indexOf(ATTACHED_FACTS_MIGRATION);
    expect(at).toBeGreaterThan(0);
    expect(files[at - 1]).toBe("0234_product_identity.sql");
    expect(files[at + 1]).toBe("0236_publish_archive_rule.sql");
  });
});

describe("S08 migration 0235 - survives the Supabase SQL editor paste", () => {
  it("has zero transit hazards (no editor-safe copy needed)", () => {
    const h = transitHazards(SQL);
    expect(h.oddApostrophe).toBe(0);
    expect(h.withSemicolon).toBe(0);
    expect(h.bareRelationWord).toBe(0);
    expect(h.nonAscii).toBe(0);
    expect(h.semicolonInString).toBe(0);
  });
});

describe("S08 - factory reset and schema snapshot", () => {
  it("the factory reset KEEPS product_fact_provenance (product knowledge, like kb_* / product_enrichments)", () => {
    const c = classifyTable(PROVENANCE_TABLE);
    expect(c?.disposition).toBe("KEEP");
    expect(classifyTable("product_enrichments")?.disposition).toBe("KEEP");
    // It references nothing, so KEEP can never leave a dangling link, and it
    // must stay that way: the drafts it stamps ARE wiped.
    expect(classifyTable("catalog_product_drafts")?.disposition).toBe("WIPE");
  });

  it("the runtime schema snapshot lists the new table", () => {
    expect(SCHEMA_TABLES).toContain(PROVENANCE_TABLE);
  });
});

describe("S08 - no app change until S07/S11 (acceptance)", () => {
  it("nothing in src/ names the new columns or table except the core", () => {
    const hits = srcFiles(path.join(ROOT, "src"))
      .filter((f) => !f.endsWith(path.join("catalog", "attach-facts-core.ts")))
      .filter((f) => !f.endsWith(path.join("admin", "schema-tables.ts")))
      .filter((f) => !f.endsWith(path.join("accounting", "factory-reset-core.ts")))
      // S07 (Round 17) is the write door this test was waiting for. It writes
      // through the core's PROVENANCE_TABLE constant (pinned below).
      .filter((f) => !f.endsWith(path.join("catalog", "attach-facts.ts")))
      // S12 (Round 19): the golden record READS attached_facts on approve so
      // the counted description / strain type reach the menu row. Read-only;
      // pinned by the next test.
      .filter((f) => !f.endsWith(path.join("catalog", "golden-record-core.ts")))
      .filter((f) => !f.endsWith(path.join("catalog", "golden-record-server.ts")))
      .filter((f) => /attached_facts|product_fact_provenance/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(ROOT, f));
    expect(hits).toEqual([]);
  });

  it("S12: the golden record only READS attached_facts (one named-column select; no write, no provenance)", () => {
    const server = readFileSync(path.join(ROOT, "src/lib/catalog/golden-record-server.ts"), "utf8");
    const core = readFileSync(path.join(ROOT, "src/lib/catalog/golden-record-core.ts"), "utf8");
    expect(server).toMatch(/\.select\(`id, \$\{GOLDEN_FACTS_COLUMN\}`\)/);
    expect(core).toMatch(/export const GOLDEN_FACTS_COLUMN = "attached_facts";/);
    for (const src of [server, core]) {
      expect(src).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
      expect(src).not.toMatch(/product_fact_provenance|PROVENANCE_TABLE/);
    }
  });

  it("S07: the write door inserts provenance only via the core's constant and tolerates a missing 0235", () => {
    const door = readFileSync(path.join(ROOT, "src/lib/catalog/attach-facts.ts"), "utf8");
    expect(door).toContain("await admin.from(PROVENANCE_TABLE).insert(provRows);");
    expect(door).toContain("isMissingAttachedFactsError(error)");
    expect(door).not.toMatch(/from\("product_fact_provenance"\)/);
    expect(door).not.toMatch(/attached_facts/);
  });

  it("S11: the door writes the draft's two fact columns ONLY through the core's constants, after provenance, tolerating a missing 0235", () => {
    const door = readFileSync(path.join(ROOT, "src/lib/catalog/attach-facts.ts"), "utf8");
    // Read with the named select, write with the merged patch keyed by DRAFT_FACT_COLUMNS.
    expect(door).toContain('.from("catalog_product_drafts").select(DRAFT_FACT_SELECT).eq("id", sf.draftId).maybeSingle()');
    expect(door).toContain('.from("catalog_product_drafts").update(merged.patch).eq("id", sf.draftId)');
    expect(door).toContain("existingFacts: row[DRAFT_FACT_COLUMNS[0]]");
    expect(door).toContain("existingProvenance: row[DRAFT_FACT_COLUMNS[1]]");
    // Only landed facts, only a draft context.
    expect(door).toContain("if (sf.draftId && landed.size > 0) {");
    // Step order: provenance insert -> draft copy -> audit.
    const prov = door.indexOf("await admin.from(PROVENANCE_TABLE).insert(provRows);");
    const draft = door.indexOf("update(merged.patch)");
    const audit = door.indexOf("await recordAudit({");
    expect(prov).toBeGreaterThan(-1);
    expect(draft).toBeGreaterThan(prov);
    expect(audit).toBeGreaterThan(draft);
    // Both the read and the write tolerate 0235 not being applied.
    const step = door.slice(door.indexOf("// ---- 4b."), audit);
    expect(step.match(/isMissingAttachedFactsError\((cur\.)?error\)/g)?.length).toBe(2);
  });

  it("S11: the core's merge emits exactly the two 0235 draft columns", () => {
    const m = mergeDraftAttachedFacts({
      existingFacts: null,
      existingProvenance: null,
      landed: [{ field: "description", value: "x", source: "gemini", confidence: 0.95 }],
      at: "2026-05-01T00:00:00.000Z",
      by: null,
      urls: [],
    });
    expect(Object.keys(m.patch ?? {}).sort()).toEqual([...DRAFT_FACT_COLUMNS].sort());
    expect(DRAFT_FACT_SELECT).toBe(DRAFT_FACT_COLUMNS.join(", "));
  });

  it("the not-applied detector is narrow (an unrelated missing column still surfaces)", () => {
    expect(isMissingAttachedFactsError({ code: "42703", message: 'column "attached_facts" does not exist' })).toBe(true);
    expect(isMissingAttachedFactsError({ code: "42P01", message: 'relation "public.product_fact_provenance" does not exist' })).toBe(true);
    expect(isMissingAttachedFactsError({ code: "42703", message: 'column "identity_key" does not exist' })).toBe(false);
    expect(isMissingAttachedFactsError({ code: "23514", message: 'violates check constraint "pfp_source_known" on product_fact_provenance' })).toBe(false);
  });
});

describe("S08 - the real-Postgres scenario script is committed and covers the spec tests", () => {
  const pg = existsSync(PG_CHECK_PATH) ? readFileSync(PG_CHECK_PATH, "utf8") : "";

  it("exists, runs in a rolled-back transaction, and ends with the all-clear notice", () => {
    expect(pg.length).toBeGreaterThan(2000);
    expect(pg).toMatch(/^begin;$/m);
    expect(pg.trimEnd().endsWith("rollback;")).toBe(true);
    expect(pg).toContain("raise notice 'ATTACHED FACTS CHECK PASSED'");
  });

  it("proves an invalid source is rejected BY pfp_source_known (not by accident)", () => {
    expect(pg).toMatch(/exception when check_violation/);
    expect(pg).toMatch(/assert plan = 'pfp_source_known'/);
    for (const s of FACT_SOURCES) expect(pg).toContain(`'${s}'`);
  });

  it("proves append-only (update, delete, truncate) and the index use", () => {
    expect(pg).toMatch(/UPDATE must be refused/);
    expect(pg).toMatch(/DELETE must be refused/);
    expect(pg).toMatch(/TRUNCATE must be refused/);
    expect(pg).toMatch(/recall uses idx_pfp_identity/);
  });

  it("the migrations doc tells the owner what to run and how to check it", () => {
    const doc = read("docs/MIGRATIONS_TO_RUN.md");
    expect(doc).toContain("0235_attached_facts.sql");
    expect(doc).toMatch(/Run 0234 first/i);
  });
});
