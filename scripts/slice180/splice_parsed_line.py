#!/usr/bin/env python3
"""
SLICE 18-0 - verified-anchor splice.

Adds the four compliance-classification fields to every ParsedLine
construction site. They are ALWAYS null: a WA transfer manifest carries no
route-of-administration field and no per-container THC figure, so there is
literally nothing to read. The human answer is collected later, at Product
Onboarding.

DISCIPLINE: every anchor is located by (file, line-number-of-`expires_on`,
expected-exact-text). If ANY anchor fails to match exactly once, NOTHING is
written to disk at all. A partial splice across eight parsers is far worse
than no splice.
"""
import sys

# (path, 1-based line number of the `expires_on` line, expected stripped text)
TARGETS = [
    ("src/lib/inventory/intake-parser.ts", 427, "expires_on,"),
    ("src/lib/inventory/intake-parser.ts", 495, "expires_on: null,"),
    ("src/lib/inventory/intake-parser.ts", 613, "expires_on,"),
    ("src/lib/inventory/manifest-merge-core.ts", 406, "expires_on: null,"),
    ("src/lib/inventory/pdf-growflow-manifest-core.ts", 149, "expires_on: null,"),
    ("src/lib/inventory/pdf-manifest-core.ts", 58, "expires_on: null,"),
    ("src/lib/inventory/pdf-openthc-manifest-core.ts", 188, "expires_on: null,"),
    ("src/lib/inventory/pdf-transferlog-core.ts", 151, "expires_on: null,"),
]

BLOCK = [
    "// SLICE 18-0: compliance classification is never read from a manifest",
    "// (WA manifests carry no such field). Collected at Product Onboarding.",
    "low_thc_liquid: null,",
    "unit_thc_mg: null,",
    "otherwise_taken: null,",
    "units_per_package: null,",
]

buffers = {}
failures = []

for path, lineno, expected in TARGETS:
    if path not in buffers:
        with open(path, "r", encoding="utf-8") as fh:
            buffers[path] = fh.read().split("\n")
    lines = buffers[path]
    idx = lineno - 1
    if idx >= len(lines):
        failures.append(f"{path}:{lineno} out of range")
        continue
    actual = lines[idx].strip()
    if actual != expected:
        failures.append(f"{path}:{lineno} expected {expected!r} got {actual!r}")
        continue
    # Guard against double-application.
    if any("low_thc_liquid" in l for l in lines[idx : idx + 8]):
        failures.append(f"{path}:{lineno} already spliced")

if failures:
    print("ABORT - no files written:")
    for f in failures:
        print("  " + f)
    sys.exit(1)

# Insert from the bottom up so earlier line numbers stay valid.
by_file = {}
for path, lineno, _ in TARGETS:
    by_file.setdefault(path, []).append(lineno)

for path, linenos in by_file.items():
    lines = buffers[path]
    for lineno in sorted(linenos, reverse=True):
        idx = lineno - 1
        indent = lines[idx][: len(lines[idx]) - len(lines[idx].lstrip())]
        lines[idx + 1 : idx + 1] = [indent + b for b in BLOCK]
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))
    print(f"spliced {path}: {len(linenos)} site(s)")

print("OK")
