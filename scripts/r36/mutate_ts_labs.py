#!/usr/bin/env python3
"""
R36 #4 mutation harness - tests the TESTS of the Cultivera / testing-labs work.

Each mutant is (file, original snippet, mutated snippet). The snippet must
occur EXACTLY once (else INVALID - a stale harness can never pass silently).
For each mutant the file is patched, the killers run, and the mutant is KILLED
when any killer fails. The file is always restored (try/finally).

Killers:
  1. npx tsx scripts/r36/run-labs-selftests.ts  (the pure self-tests)
  2. npx vitest run <the R36 + R28 COA suites>

Usage (repo root):  python3 scripts/r36/mutate_ts_labs.py [group]
"""
import subprocess
import sys
from pathlib import Path

PURE = ["npx", "tsx", "scripts/r36/run-labs-selftests.ts"]
VITEST = [
    "npx", "vitest", "run",
    "tests/compliance/r36-cultivera-coa.test.ts",
    "tests/compliance/r36-testing-labs.test.ts",
    "tests/compliance/r28-coa-extract-server.test.ts",
]

TL = "src/lib/inventory/testing-labs-core.ts"
EX = "src/lib/inventory/coa-extract-core.ts"
PT = "src/lib/inventory/coa-pdf-text-core.ts"
FC = "src/lib/inventory/coa-facts-core.ts"
SV = "src/lib/inventory/coa-extract.ts"
ST = "src/lib/inventory/testing-labs-store.ts"

MUTANTS = {
    "core": [
        # allow-list
        (TL, '{ host: "files.cultivera.com", labNumber: null,', '{ host: "files.cultivera.org", labNumber: null,'),
        (EX, "  if (!allow.includes(host)) {", "  if (false) {"),
        (EX, "const allow = mergeHosts([{ coaHosts: extraHosts }]);", "const allow = mergeHosts([]);"),
        (EX, "return !isBuiltInHost(new URL(url).hostname.toLowerCase());", "return false;"),
        (EX, "    next = new URL(location, current).toString();", "    next = location;"),
        (EX, "  if (!location) return { ok: false, reason: \"redirect with no Location\" };", ""),
        (EX, "  const bad = addresses.filter((a) => !isPublicAddress(a));", "  const bad = addresses.filter(() => false);"),
        (EX, "  if (addresses.length === 0) return { ok: false, reason: `${host} did not resolve` };", ""),
        # host validator
        (TL, 'if (u.protocol !== "https:") return { ok: false, reason: `Only https', 'if (false) return { ok: false, reason: `Only https'),
        (TL, 'if (u.port && u.port !== "443") return', 'if (false) return'),
        (TL, 'if (/^\\d+(\\.\\d+){0,3}$/.test(host) || /^0x[0-9a-f]+$/i.test(host))', 'if (/^0x[0-9a-f]+$/i.test(host))'),
        (TL, 'if (labels.length < 2) return', 'if (labels.length < 1) return'),
        (TL, 'if (host === "localhost" || INTERNAL_SUFFIXES.some((x) => host.endsWith(x)))', 'if (host === "localhost")'),
        (TL, 'if (/[*]/.test(s)) return', 'if (false) return'),
        (TL, 'if (u.username || u.password) return { ok: false, reason:', 'if (false) return { ok: false, reason:'),
        (TL, 'if (u.username || u.password) return { ok: false, error:', 'if (false) return { ok: false, error:'),
        # public-address
        (TL, "if (x === 169 && y === 254) return false;", ""),
        (TL, "if (x === 172 && y >= 16 && y <= 31) return false;", "if (x === 172 && y >= 16 && y <= 32) return false;"),
        (TL, "if (x === 100 && y >= 64 && y <= 127) return false;", ""),
        (TL, "if ((h & 0xfe00) === 0xfc00) return false;", ""),
        (TL, "if (mapped) return isPublicAddress(mapped[1]);", ""),
        (TL, "if (x === 0 || x === 10 || x === 127) return false;", "if (x === 0 || x === 127) return false;"),
        # owner host edits
        (TL, "if (isBuiltInHost(n.host)) return { ok: false, error:", "if (false) return { ok: false, error:"),
        (TL, "if (current.length >= MAX_HOSTS_PER_LAB) return", "if (current.length > MAX_HOSTS_PER_LAB) return"),
        (TL, "if (current.includes(n.host)) return { ok: false, error: `${n.host} is already on this lab.` };", ""),
        (TL, "const h = String(host ?? \"\").trim().toLowerCase();", "const h = String(host ?? \"\");"),
        # lab form
        (TL, "if (existing.some((e) => e.name.trim().toLowerCase() === key)) return", "if (existing.some((e) => e.name === name)) return"),
        (TL, "if (labNumber !== null && existing.some((e) => e.labNumber === labNumber)) return", "if (false) return"),
        (TL, 'if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, error: "The website must be an http or https link." };', ""),
        (TL, "if (!/^[a-z][a-z0-9+.-]*:/i.test(website) ||", "if (true ||"),
        # seed
        (TL, 'status: "historical", certStart: "2016-10-26"', 'status: "active", certStart: "2016-10-26"'),
        (TL, 'status: "platform",', 'status: "owner_added",'),
    ],
    "creds": [
        (TL, 'if (u.username || u.password) return { ok: false, reason:', 'if (false) return { ok: false, reason:'),
        (TL, 'if (u.username || u.password) return { ok: false, error:', 'if (false) return { ok: false, error:'),
        (TL, "if (!/^[a-z][a-z0-9+.-]*:/i.test(website) ||", "if (true ||"),
    ],
    "readers": [
        # template detection + Confidence 7
        (PT, 'if (POTENCY_HEADER_7.test(text) && /Confidence Analytics/i.test(text)) return "confidence-7";', ""),
        # (EQUIVALENT, not run: dropping `tok === LOQ_TOKEN` from cell() changes
        #  nothing - Number("<LOQ") is NaN, which cell() already maps to null.)
        (PT, 'const seg = variant === "7" ? seg0.replace(LIMIT_PAIR_7, "$2") : seg0;', 'const seg = variant === "7" ? seg0.replace(LIMIT_PAIR_7, "$1") : seg0;'),
        (PT, "if (m[2] === LOQ_TOKEN) belowLoq.push(key);", ""),
        # Testing Technologies
        (PT, "const DECARB = WA_ACID_FACTOR;", "const DECARB = 1;"),
        (PT, "const TOL = 0.05 * (1 + DECARB) + 0.05 + 1e-9;", "const TOL = 5;"),
        (PT, '[String.raw`(?<![\\w-]|Total )CBD(?![\\w-])`, "cbd"],', '[String.raw`CBD`, "cbd"],'),
        (PT, '[String.raw`(?<![\\w-])THC-A`, "thca"],', '[String.raw`(?<![\\w-])THC-A`, "cbda"],'),
        (PT, "const inv = text.match(/Inventory ID: (?:[^0-9]{0,80}?)?(\\d{16,})/);", "const inv = text.match(/Inventory ID: (\\d{20,})/);"),
        (PT, "/Test Results I-502 Limits Status Method/.test(text)", "true"),
        # re-host proof
        (FC, "if (json.sampleId !== inv || json.labResultId !== inv) return null;", "if (json.sampleId !== inv) return null;"),
        (FC, "if (json.sampleId !== inv || json.labResultId !== inv) return null;", "if (json.labResultId !== inv) return null;"),
        (FC, "if (!pdf.auth.startsWith(m[1]) || pdf.labSampleId !== m[2]) return null;", "if (pdf.labSampleId !== m[2]) return null;"),
        (FC, "if (!pdf.auth.startsWith(m[1]) || pdf.labSampleId !== m[2]) return null;", "if (!pdf.auth.startsWith(m[1])) return null;"),
        (FC, "ok: same || rehost !== null,", "ok: true,"),
        (FC, "ok: same || rehost !== null,", "ok: same,"),
    ],
    "server": [
        (SV, '        redirect: "manual",', '        redirect: "follow",'),
        (SV, "      const dnsErr = await dnsGuard(url);\n      if (dnsErr) return { bytes: null, error: dnsErr };", "      const dnsErr = null;"),
        (SV, "      if (!next.ok) return { bytes: null, error: next.reason };", ""),
        (SV, "  const safe = safeCoaUrl(raw, ctx.extraHosts);", "  const safe = safeCoaUrl(raw);"),
        (SV, "  const hosts = rows.length ? await loadHostContext() : BUILT_INS_ONLY;", "  const hosts = BUILT_INS_ONLY;"),
        (SV, "if (hop === COA_MAX_REDIRECTS) return { bytes: null, error: `more than ${COA_MAX_REDIRECTS} redirects` };", ""),
        (SV, "      if (res.status < 300 || res.status > 399) break;", "      break;"),
        (SV, "    const answers = await lookup(host, { all: true, verbatim: true });", "    const answers = [await lookup(host)];"),
        (SV, "  if (!needsDnsCheck(url)) return null;", "  return null;"),
    ],
    "store": [
        (ST, "    .eq(\"updated_at\", got.row.updated_at)\n", ""),
        (ST, "  if (expectedUpdatedAt && got.row.updated_at !== expectedUpdatedAt) {", "  if (false) {"),
        (ST, "  if (!((data as unknown[] | null) ?? []).length) {", "  if (false) {"),
        (ST, "    return { hosts: all.filter((h) => !builtIns.includes(h)), note: null };", "    return { hosts: all, note: null };"),
        (ST, "    if (error) return { hosts: [], note: isMissingLabsSchema(error) ? null :", "    if (error) return { hosts: [], note: true ? null :"),
        (ST, "  return (missingTable || missingColumn) && msg.includes(\"testing_labs\");", "  return missingTable || missingColumn;"),
        (ST, "      status: \"owner_added\",\n", "      status: \"active\",\n"),
        (ST, "  if (!/^[0-9a-f-]{36}$/i.test(id)) return", "  if (false) return"),
        (ST, "    if (String(error.code ?? \"\") === \"23514\") return", "    if (false) return"),
        (ST, "    .range(0, MAX_ROWS - 1);\n  if (error) {\n    if (isMissingLabsSchema(error)) return { ok: false, migrated: false", "    .limit(MAX_ROWS);\n  if (error) {\n    if (isMissingLabsSchema(error)) return { ok: false, migrated: false"),
    ],
}


def killers_pass() -> bool:
    """True = every killer passed (the mutant SURVIVED)."""
    for cmd in (PURE, VITEST):
        try:
            p = subprocess.run(cmd, capture_output=True, text=True, timeout=400)
        except subprocess.TimeoutExpired:
            return False
        if p.returncode != 0:
            return False
    return True


def main() -> int:
    groups = sys.argv[1:] or list(MUTANTS)
    if not killers_pass():
        print("baseline FAILED - fix the tests before mutating")
        return 2
    total_bad = 0
    for g in groups:
        killed, survived, invalid = 0, [], []
        for n, (rel, old, new) in enumerate(MUTANTS[g], 1):
            path = Path(rel)
            src = path.read_text()
            if src.count(old) != 1:
                invalid.append(n)
                print(f"[{g} {n}] INVALID (snippet found {src.count(old)}x): {old[:70]!r}", flush=True)
                continue
            try:
                path.write_text(src.replace(old, new, 1))
                alive = killers_pass()
            finally:
                path.write_text(src)
            if alive:
                survived.append(n)
                print(f"[{g} {n}] SURVIVED  {old[:80]!r}", flush=True)
            else:
                killed += 1
                print(f"[{g} {n}] killed", flush=True)
        print(f"\n{g}: {len(MUTANTS[g])} mutants, {killed} killed, {len(survived)} survived, {len(invalid)} invalid\n", flush=True)
        total_bad += len(survived) + len(invalid)
    return 0 if total_bad == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
