"""
scripts/compliance/mutate-fix-p3-1a.py

Fix Phase 3.1a (emailed COAs attach to the delivery's lines). Owner, message 6,
verbatim:
"The last one the system auto fetched had every detailed needed, but for some
reason didn't or couldn't attach the coa lab results to the products in the
receiving detail page. So I can't accept it nor move it to onboarding. We need
a supremely robust table and fetcher, it needs to work every time for every
invoice and manifest"

Rule 13c: a test that cannot fail is worse than no test. Rule 137: every
anchor must match EXACTLY once or the harness fails.

Usage:  python3 scripts/compliance/mutate-fix-p3-1a.py
"""
import io
import subprocess
import sys

CORE = "src/lib/inventory/coa-bundle-core.ts"
WCIA = "src/lib/inventory/cultivera-wcia-core.ts"
ARCH = "src/lib/inventory/coa-archive.ts"
INBOUND = "src/lib/inbound-email/inbound-store.ts"

TESTS = [
    "tests/compliance/fix-p3-1a-coa-bundle.test.ts",
    "tests/compliance/r26-qgt-email-e2e.test.ts",
    "tests/compliance/s29-accounting-tab.test.tsx",
    "tests/compliance/fix-p3-1a-coa-archive.test.ts",
]

# (label, file, find, replace)
MUTATIONS = [
    ("core: generic product words identify a product", CORE,
     "    if (isGenericPhrase(n)) continue; // a kind of product never identifies one",
     "    // generic skip removed"),
    ("core: several id hits treated as one", CORE,
     "    if (byId.length === 1) {", "    if (byId.length >= 1) {"),
    # The fold's own `line.lab` guard sits behind the plan's hasLab check (a
    # second layer, unreachable from the public API); the control is hasLab.
    ("core: an emailed certificate replaces an existing lab", CORE,
     "    hasLab: l.lab != null,\n  }));", "    hasLab: false,\n  }));"),
    ("core: a manifest page counts as a certificate", CORE,
     "  if (/\\bManifest ID:|Transported Items|Internal Shipping Document|\\bINVOICE\\b/i.test(t) && !/Certificate of Analysis/i.test(t)) return false;",
     "  if (false) return false;"),
    ("core: a label run (many ids) read as one certificate", CORE,
     "    const isCert = looksLikeCertificate(text) && ids.length <= MAX_IDS_PER_CERT;",
     "    const isCert = looksLikeCertificate(text);"),
    ("core: a phrase hitting several certificates is not ambiguous", CORE,
     "    } else if (exact.multi.size > 0 || tier.multi.size > 0) {",
     "    } else if (false) {"),
    ("core: lines that already had a lab are counted as needing one", CORE,
     "    if (line.hasLab) {\n      plan.alreadyHadLab += 1;",
     "    if (false) {\n      plan.alreadyHadLab += 1;"),
    ("core: an unread lab document still reports complete", CORE,
     "  if (unreadDocs > 0) return COA_ATTACH_INCOMPLETE_EVENT;",
     "  if (unreadDocs > 999) return COA_ATTACH_INCOMPLETE_EVENT;"),
    ("core: a destroyed lot asks for a COA", CORE,
     '    hasLab: l.lab_result_id != null || l.status === "destroyed",',
     "    hasLab: l.lab_result_id != null,"),
    ("core: a name match no longer says verify", CORE,
     '  if (p.matchedBy === "name") return { text: "\\u2705 matched by name \\u2014 verify", verify: true };',
     '  if (p.matchedBy === "name") return { text: "\\u2705", verify: false };'),
    ("core: a stale pick attaches a different certificate", CORE,
     "  if (!id || id !== shownLabtestId) return",
     "  if (!id) return"),
    ("wcia: emailed certificate labelled as the manifest's lab", WCIA,
     "    return EMAILED_COA_SOURCE;\n  }\n  return labSourceFor(format);",
     "    return labSourceFor(format);\n  }\n  return labSourceFor(format);"),
    ("archive: a PDF filed under every lab of the delivery", ARCH,
     "    if (only && !(lab.labtest_external_identifier && only.has(lab.labtest_external_identifier))) continue;",
     "    // only-filter removed"),
    ("inbound: JSON path never reads the COAs", INBOUND,
     "    const jsonCoa = foldCoas(manifest);\n    manifest = jsonCoa.manifest;",
     "    const jsonCoa = { manifest, fold: null };\n    manifest = jsonCoa.manifest;"),
    ("inbound: each PDF archived with no id list", INBOUND,
     "          await archiveEmailedCoaForManifest(manifestId, r.att.base64 as string, ids);",
     "          await archiveEmailedCoaForManifest(manifestId, r.att.base64 as string);"),
    ("inbound: the COA outcome goes only to the console", INBOUND,
     "      await logManifestEvent(manifestId, coaAttachEventType(fold?.plan ?? null, coaUnread.length), note, actorId);",
     "      console.warn(note);"),
]


def run_tests() -> bool:
    proc = subprocess.run(
        ["./node_modules/.bin/vitest", "run", *TESTS],
        capture_output=True,
        text=True,
    )
    return proc.returncode == 0


def main() -> int:
    caught, survived = 0, []

    for label, path, find, repl in MUTATIONS:
        original = io.open(path, encoding="utf-8").read()
        hits = original.count(find)
        # Rule 137: exactly one, or this is not a probe.
        if hits != 1:
            print(f"  ERROR  {label}")
            print(f"         anchor matched {hits} times in {path}; expected exactly 1")
            print("         FAILING rather than skipping (rules 48, 137).")
            return 2

        io.open(path, "w", encoding="utf-8").write(original.replace(find, repl, 1))
        try:
            if run_tests():
                survived.append(label)
                print(f"  SURVIVED  {label}", flush=True)
            else:
                caught += 1
                print(f"  caught    {label}", flush=True)
        finally:
            io.open(path, "w", encoding="utf-8").write(original)

    total = len(MUTATIONS)
    print(f"\n{caught}/{total} mutations caught")
    if survived:
        print("\nSURVIVORS (these are holes in the tests):")
        for s in survived:
            print(f"  - {s}")
        return 1
    print("Every deliberate break was noticed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
