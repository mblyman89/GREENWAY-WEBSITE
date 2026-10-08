#!/usr/bin/env python3
"""
R28 mutation harness for the pure TS cores.

Each mutant is (file, original snippet, mutated snippet). The snippet must
occur EXACTLY once in the file (else the mutant is reported as INVALID, so a
stale harness can never pass silently). For every mutant the file is patched,
the pure runner command is executed, and the mutant is KILLED when the runner
exits non-zero (a self-test failed or the code threw). The file is always
restored, even on Ctrl-C.

Usage (from the repo root):
    python3 scripts/r28/mutate_ts_core.py panel     # coa-panel-core
    python3 scripts/r28/mutate_ts_core.py extract   # coa-extract-core R28 additions

The runner is scripts/r28/run-core-selftests.ts, which exits 1 when any of the
R28 cores reports a failure.
"""
import subprocess
import sys
from pathlib import Path

RUNNER = ["npx", "tsx", "scripts/r28/run-core-selftests.ts"]

PANEL = "src/lib/inventory/coa-panel-core.ts"
EXTRACT = "src/lib/inventory/coa-extract-core.ts"

MUTANTS = {
    "panel": [
        (PANEL, 'if (!lab) return { state: "no-lab" };', 'if (!lab) return { state: "unread", reason: "x" };'),
        (PANEL, 'if (!opts.migrated || !("coa_extract_json" in lab))', 'if (!("coa_extract_json" in lab))'),
        (PANEL, 'if (!opts.migrated || !("coa_extract_json" in lab))', 'if (!opts.migrated)'),
        (PANEL, "const links = lab.wcia_json_url || lab.coa_url;", "const links = lab.wcia_json_url;"),
        (PANEL, "const badId = ex.identity.filter((c) => !c.ok);", "const badId = ex.identity.filter((c) => !c.ok && false);"),
        (PANEL, "const cannabinoids = profile\n    ? profile.cannabinoids", "const cannabinoids = true\n    ? (profile ?? { cannabinoids: [{ key: \"cbd\", pct: 1, mgPerServing: 1 }] }).cannabinoids"),
        (PANEL, '(j !== undefined ? j : p ?? null)', '(p ?? null)'),
        (PANEL, 'if (thc !== null) totals.push', 'if (thc === null) totals.push'),
        (PANEL, "` (${v} mg per serving)`", "` (${v} mg)`"),
        (PANEL, "servingWeightG: profile ? ex.pdf?.servingWeightG ?? null : null,", "servingWeightG: ex.pdf?.servingWeightG ?? null,"),
        (PANEL, "amended: ex.pdf?.amended ?", "amended: false ?"),
        (PANEL, "terpenes: profile?.terpenes ?? [],", "terpenes: profile?.terpenes.slice().reverse() ?? [],"),
        (PANEL, "failedChecks: checks.filter((c) => !c.ok).length,", "failedChecks: 0,"),
        (PANEL, 'unpdf: "the PDF\'s text layer",', 'unpdf: "LlamaParse",'),
        (PANEL, 'if (!f.usable && f.reasons.length === 0) return { state: "not-dosed" };', ''),
        (PANEL, 'held: f.reasons.length > 0,', 'held: false,'),
        (PANEL, 'transferCbdPct: lab?.total_cbd_pct ?? lab?.cbd_pct ?? null,', 'transferCbdPct: null,'),
        (PANEL, 'if (f.cbdNotDetected) rows.push', 'if (false) rows.push'),
        (PANEL, 'value: m.packageMg !== null ? `${m.packageMg} mg` : "-",', 'value: `${m.mgPerServing} mg`,'),
        (PANEL, 'if (v === null || v === undefined || v === "") continue;', 'if (v === null || v === undefined) continue;'),
        (PANEL, 'source: p ? FACT_SOURCE_LABEL[p] ?? p : "not recorded"', 'source: p ? FACT_SOURCE_LABEL[p] ?? "not recorded" : "not recorded"'),
        (PANEL, 'coa: "lab certificate",', 'coa: "certificate",'),
        (PANEL, '${UUID}$`, "i");', '${UUID}`, "i");'),
        (PANEL, 'new RegExp(`^/admin/', 'new RegExp(`/admin/'),
        (PANEL, '(?:inventory|knowledge-base/products)', '(?:inventory|knowledge-base/products|settings)'),
        (PANEL, 'const s = raw.trim();', 'const s = raw;'),
        (PANEL, 'if (!run.migrated) return "unmigrated";', ''),
        (PANEL, 'if (run.failed > 0) return "failed";\n  if (run.partial > 0) return "partial";', 'if (run.partial > 0) return "partial";\n  if (run.failed > 0) return "failed";'),
        (PANEL, 'if (run.partial > 0) return "partial";\n  if (run.ok > 0) return "ok";', 'if (run.ok > 0) return "ok";\n  if (run.partial > 0) return "partial";'),
        (PANEL, 'if (run.ok > 0) return "ok";\n  return "error";', 'return "ok";'),
        (PANEL, 'if (run.errors.some((e) => e === "this lot has no lab result")) return "nolab";', ''),
        (PANEL, '(COA_REREAD_CODES as readonly string[]).includes(raw)', 'raw.length > 0'),
        (PANEL, 'const then = restaged ? " The delivery', 'const then = true ? " The delivery'),
        (PANEL, 'return "The lab certificate could not be read - the reasons are below. Set the facts by hand if the lab cannot be reached.";', 'return "The lab certificate could not be read." + then;'),
        (PANEL, 'r.manifest_id && r.pos_product_key && r.status !== "dismissed"', 'r.manifest_id && r.status !== "dismissed"'),
        (PANEL, 'r.manifest_id && r.pos_product_key && r.status !== "dismissed"', 'r.manifest_id && r.pos_product_key'),
        (PANEL, '(r.status === "approved" ? 0 : 1)', '0'),
        (PANEL, 'String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? ""))', 'String(a.updated_at ?? "").localeCompare(String(b.updated_at ?? ""))'),
        (PANEL, 'code === "partial" || code === "nolab" ? "warn" : "bad"', 'code === "partial" ? "warn" : "bad"'),
        (PANEL, 'coaRereadCopy(code, rawRestaged === "1")', 'coaRereadCopy(code, Boolean(rawRestaged))'),
    ],
    "extract": [
        (EXTRACT, 'if (u.protocol !== "https:")', 'if (false)'),
        (EXTRACT, 'if (u.username || u.password)', 'if (false)'),
        (EXTRACT, 'if (u.port && u.port !== "443")', 'if (false)'),
        (EXTRACT, 'if (!(COA_HOST_ALLOW as readonly string[]).includes(host))', 'if (false)'),
        (EXTRACT, 'ct.includes("application/pdf") || ct.includes("application/octet-stream")', 'true'),
        (EXTRACT, 'return ct.includes("json") || ct.includes("text/plain");', 'return true;'),
        (EXTRACT, 'bytes[4] === 0x2d', 'true'),
        (EXTRACT, 'if (r.ok && r.doc.potencyReadable) return false;', 'if (r.ok) return false;'),
        (EXTRACT, 'if (!c.text || !c.text.trim()) continue;\n    const r = parseCoaPdfText(c.text);\n    if (r.ok && r.doc.potencyReadable) return false;\n  }\n  return true;', 'if (!c.text || !c.text.trim()) continue;\n    const r = parseCoaPdfText(c.text);\n    if (r.ok && r.doc.potencyReadable) return false;\n  }\n  return false;'),
        (EXTRACT, 'const score = !r.ok ? 0 : r.doc.potencyReadable ? 2 + Math.min(r.doc.potency.length, 50) / 100 : 1;', 'const score = !r.ok ? 0 : 1;'),
        (EXTRACT, 'if (!best || score > best.score)', 'if (!best || score >= best.score)'),
        (EXTRACT, 'e.code === "PGRST204"', 'e.code === "PGRST999"'),
        (EXTRACT, 'e.code === "42703"', 'e.code === "00000"'),
        (EXTRACT, 'return /column .* does not exist|could not find the .* column/i.test(e.message ?? "");', 'return false;'),
        (EXTRACT, 'if (run.pending === 0 && run.errors.length === 0) return null;', ''),
        (EXTRACT, 'run.errors.slice(0, 3)', 'run.errors.slice(0, 5)'),
        (EXTRACT, 'if (run.partial > 0 || run.failed > 0) note +=', 'if (run.failed > 0) note +='),
        (EXTRACT, 'if (run.deferred > 0) parts.push', 'if (false) parts.push'),
        (EXTRACT, 'if (!MG_FACT_TYPES.has((d.inventory_type ?? "").trim())) continue;', ''),
        (EXTRACT, 'transferCbdPct: lab.total_cbd_pct ?? lab.cbd_pct,', 'transferCbdPct: lab.total_cbd_pct,'),
        (EXTRACT, 'if (extract.identity.some((c) => !c.ok)) return none(', 'if (false) return none('),
        (EXTRACT, 'if (extract.status === "failed") return none(', 'if (false) return none('),
        (EXTRACT, 'terpenes: t.added.length > 0 ? t.next : null,', 'terpenes: t.next,'),
    ],
}


def run_runner() -> bool:
    """True = runner passed (mutant SURVIVED)."""
    try:
        p = subprocess.run(RUNNER, capture_output=True, text=True, timeout=200)
    except subprocess.TimeoutExpired:
        return False
    return p.returncode == 0


def main() -> int:
    group = sys.argv[1] if len(sys.argv) > 1 else "panel"
    mutants = MUTANTS[group]
    if not run_runner():
        print("baseline runner FAILED - fix the tests before mutating")
        return 2
    killed, survived, invalid = 0, [], []
    for n, (rel, old, new) in enumerate(mutants, 1):
        path = Path(rel)
        src = path.read_text()
        if src.count(old) != 1:
            invalid.append((n, old[:70]))
            print(f"[{n}] INVALID (snippet found {src.count(old)}x)")
            continue
        try:
            path.write_text(src.replace(old, new, 1))
            alive = run_runner()
        finally:
            path.write_text(src)
        if alive:
            survived.append((n, old[:70]))
            print(f"[{n}] SURVIVED  {old[:70]!r}")
        else:
            killed += 1
            print(f"[{n}] killed")
    print(f"\n{group}: {len(mutants)} mutants, {killed} killed, {len(survived)} survived, {len(invalid)} invalid")
    return 0 if not survived and not invalid else 1


if __name__ == "__main__":
    sys.exit(main())
