#!/usr/bin/env python3
"""
Round 26 mutation testing: LlamaParse invoice/order # + transportation-
manifest delivery details (markdown normalizer, text-layer grounding,
Contingency-Manifest positional reader, multi-document invoice #, fill-only
merge of matching donors, migration 0245 writer + display precedence).

Owner (verbatim): "All I really want it to do is find the invoice number or
order number. If it doesn't have one of those, it should fall back to using
the manifest number. ... Test it, test the tests."

Same discipline as scripts/r25/mutate_c.py: every anchor must match exactly
once (pre-flight), the baseline must be green, every mutant must be KILLED,
and every file is restored (also on SIGTERM/SIGINT).

Equivalent mutants found by the first run and RESOLVED by deleting the dead
code they guarded (behaviour still pinned by tests):
  - manifest-merge-core mergeMatchingDonors `out.arrived_at = null` (the
    fill-only merge never copies arrived_at);
  - invoice-number-core selectInvoiceNumber's COA filter (invoiceNumberFromDoc
    already returns null for a COA);
  - doc-transport-core's post-merge arrived_at reset (same reason).
The other two first-run survivors were REAL holes and found a REAL bug
(grounding ran after the fill-only merge, so a hallucinated layout value
blocked the page's real value and then was dropped, leaving the field blank;
the PDF-primary route staged the raw layout transport). Both fixed + tested.
"""
import signal
import subprocess
import sys

MD = "src/lib/inventory/markdown-fields-core.ts"
GR = "src/lib/inventory/extraction-grounding-core.ts"
CM = "src/lib/inventory/pdf-contingency-manifest-core.ts"
DT = "src/lib/inventory/doc-transport-core.ts"
INV = "src/lib/inventory/invoice-number-core.ts"
MT = "src/lib/inventory/manifest-table-core.ts"
MM = "src/lib/inventory/manifest-merge-core.ts"
TF = "src/lib/inventory/transport-fields-core.ts"
IS = "src/lib/inventory/intake-store.ts"
EL = "src/lib/inventory/manifest-event-labels-core.ts"
IB = "src/lib/inbound-email/inbound-store.ts"
ACT = "src/app/admin/inventory/intake/actions.ts"
RUN = "scripts/compliance/run-pure-selftests.ts"

MUTANTS = [
    # markdown-fields-core
    ("md: bold not stripped", MD, '  t = t.replace(/\\*\\*([^*\\n]+?)\\*\\*/g, "$1");', '  t = t;'),
    ("md: escapes kept", MD, '  t = t.replace(/\\\\([#*_|[\\]()\\-.!+`~>])/g, "$1");', '  t = t;'),
    ("md: entities not decoded", MD, '  t = decodeEntities(t);', '  t = t;'),
    ("md: label may start with digit", MD, '  if (!/^[A-Za-z]/.test(c)) return false;', '  if (false) return false;'),
    ("md: plain text rewritten", MD, '  if (!hasMarkdownStructure(text)) return text;', '  if (false) return text;'),
    ("md: pair rows ignored", MD, '  if (isPairRow(row)) {', '  if (false) {'),
    ("md: header columns ignored", MD, '      if (h && v && /[A-Za-z]/.test(h)) out.push({ label: cleanLabel(h), value: v });', '      void h;'),
    ("md: html tables ignored", MD, '    htmlTables.push(parseHtmlTable(inner));', '    htmlTables.push({ header: null, rows: [] });'),
    ("md: blank form field kept as value", MD, "    if (!value || /^[A-Za-z][A-Za-z .'/#-]{0,40}:/.test(value)) continue;", '    if (!value) continue;'),
    ("md: separator row not detected", MD, '  return nonEmpty.length > 0 && nonEmpty.every((c) => /^:?-{2,}:?$/.test(c));', '  return false;'),
    ("md: heading marker kept", MD, '  t = t.replace(/^\\s*#{1,6}\\s+/, ""); // heading marker', '  // heading marker'),
    # extraction-grounding-core
    ("gr: min layer 0", GR, 'export const MIN_LAYER_CHARS = 40;', 'export const MIN_LAYER_CHARS = 0;'),
    ("gr: min layer off-by-one", GR, '  return (layerText ?? "").replace(/\\s+/g, "").length >= MIN_LAYER_CHARS;', '  return (layerText ?? "").replace(/\\s+/g, "").length > MIN_LAYER_CHARS;'),
    ("gr: case sensitive", GR, '  return s.toLowerCase().replace(/\\s+/g, "");', '  return s.replace(/\\s+/g, "");'),
    ("gr: two-digit years ignored", GR, '    out.add(`20${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`);', '    void m;'),
    ("gr: tokens any instead of every", GR, '  return toks.every((t) => hay.includes(squash(t)));', '  return toks.some((t) => hay.includes(squash(t)));'),
    ("gr: hallucinations kept", GR, '      t[field] = null;\n', '\n'),
    ("gr: dates compared as values", GR, '    const ok = DATE_FIELDS.has(field)', '    const ok = false'),
    ("gr: scan reported grounded", GR, '  if (!hasUsableLayer(layerText)) return { transport: t, groundedBy: "vision-only", dropped: [] };', '  if (!hasUsableLayer(layerText)) return { transport: t, groundedBy: "text-layer", dropped: [] };'),
    ("gr: groundValue never rejects", GR, '    : { value: null, groundedBy: "rejected" };\n}', '    : { value: v, groundedBy: "vision-only" };\n}'),
    # pdf-contingency-manifest-core
    ("cm: page size not checked", CM, '  if (!page || Math.round(page.width) !== 612 || Math.round(page.height) !== 792) return null;', '  if (!page) return null;'),
    ("cm: y tolerance widened", CM, 'const Y_TOL = 4;', 'const Y_TOL = 12;'),
    ("cm: footer not required", CM, '  if (!label) return null;', '  if (!label) return "0";'),
    ("cm: dates not required", CM, '  if (!dateTime(cell(page.items, 171, LEFT)) || !dateTime(cell(page.items, 170, RIGHT))) return null;', ''),
    ("cm: arrival stored as eta datetime", CM, '  t.eta_date = arrival ? arrival.slice(0, 10) : null;', '  t.eta_date = arrival;'),
    ("cm: vin column swapped", CM, '  t.vehicle_vin = plausibleVin(cell(it, 111, RIGHT));', '  t.vehicle_vin = plausibleVin(cell(it, 111, LEFT));'),
    ("cm: color dropped", CM, '  const parts = [color, make, model]', '  const parts = [make, model]'),
    # doc-transport-core
    ("dt: positions not read", DT, '  if (cont) take("contingency-positions", cont.manifest_number, cont.transport);', ''),
    ("dt: vision text skipped", DT, '    ["vision", r.visionText],\n', '\n'),
    ("dt: grounding after merge (pre-R26 order)", DT, '    const g = groundTransport(tr, r.layerText);\n', '    const g = groundTransport(tr, null);\n'),
    ("dt: drops not reported", DT, '      if (!dropped.some((x) => x.field === d.field && x.value === d.value)) dropped.push(d);', '      void d;'),
    ("dt: drops duplicated", DT, '      if (!dropped.some((x) => x.field === d.field && x.value === d.value)) dropped.push(d);', '      dropped.push(d);'),
    ("dt: fully-dropped read credited", DT, '    if (!transportHasData(g.transport)) return;\n', '\n'),
    ("dt: groundedBy always text-layer", DT, '    groundedBy: hasUsableLayer(r.layerText) ? "text-layer" : "vision-only",', '    groundedBy: "text-layer",'),
    ("dt: last manifest # wins", DT, '    if (!manifestNumber && n) manifestNumber = n;', '    if (n) manifestNumber = n;'),
    ("dt: layout # not grounded", DT, '  let manifestNumber: string | null = groundValue(r.layoutManifestNumber, r.layerText).value;', '  let manifestNumber: string | null = r.layoutManifestNumber ?? null;'),
    ("dt: reader # not grounded", DT, '    const n = groundValue(num, r.layerText).value;', '    const n = num;'),
    # invoice-number-core
    ("inv: coa not excluded (doc)", INV, '  if (doc.role === "coa") return null;', '  if (false) return null;'),
    ("inv: rank ignored", INV, '    .sort((a, b) => ROLE_RANK[a.d.role] - ROLE_RANK[b.d.role] || a.i - b.i);', '    .sort((a, b) => a.i - b.i);'),
    ("inv: unstable within role", INV, '    .sort((a, b) => ROLE_RANK[a.d.role] - ROLE_RANK[b.d.role] || a.i - b.i);', '    .sort((a, b) => ROLE_RANK[a.d.role] - ROLE_RANK[b.d.role] || b.i - a.i);'),
    ("inv: manifest outranks invoice", INV, '  invoice: 1,\n  manifest: 2,', '  invoice: 2,\n  manifest: 1,'),
    ("inv: ungrounded vision accepted", INV, '    const g = groundValue(fromText, layer);', '    const g = groundValue(fromText, null);'),
    ("inv: layer not rescanned", INV, '  if (usable && layer !== text) {', '  if (false) {'),
    ("inv: json role ignored", INV, '    return v ? { value: v, source: src("json"), groundedBy: "json" } : null;', '    return null;'),
    ("inv: email body grounded", INV, '    if (doc.role === "email-body") {', '    if (false) {'),
    ("inv: label not truncated", INV, '  return t.length > 60 ? `${t.slice(0, 57)}...` : t;', '  return t;'),
    ("inv: role map case-sensitive", INV, '  switch ((role ?? "").toLowerCase()) {', '  switch (role ?? "") {'),
    # manifest-table-core (display precedence + markdown scan)
    ("mt: detected ignored", MT, '  if (detected) return detected;', '  if (false) return detected;'),
    ("mt: detected beats override", MT, '  const override = (row.invoice_number_override ?? "").trim();\n  if (override) return override;', '  const override = (row.invoice_number_detected ?? row.invoice_number_override ?? "").trim();\n  if (override) return override;'),
    ("mt: blank detected not trimmed", MT, '  const detected = (row.invoice_number_detected ?? "").trim();', '  const detected = row.invoice_number_detected ?? "";'),
    ("mt: markdown not normalized", MT, '  const flat = normalizeMarkdownFields(text).replace(/\\s+/g, " ").trim();', '  const flat = text.replace(/\\s+/g, " ").trim();'),
    # manifest-merge-core
    ("mm: only first exact donor", MM, '  for (const d of exact) out = mergeTransportFillEmpty(out, d.transport).transport;', '  for (const d of exact.slice(0, 1)) out = mergeTransportFillEmpty(out, d.transport).transport;'),
    ("mm: non-matching donors folded", MM, '    ? donors.filter((d) => transportHasData(d.transport) && norm(d.manifest_number) === target)', '    ? donors.filter((d) => transportHasData(d.transport))'),
    ("mm: spaces not normalized", MM, '  donors: readonly TransportDonor[],\n): ParsedTransport | null {\n  const norm = (v: string | null | undefined): string | null => {\n    const t = (v ?? "").replace(/\\s+/g, "").trim();', '  donors: readonly TransportDonor[],\n): ParsedTransport | null {\n  const norm = (v: string | null | undefined): string | null => {\n    const t = (v ?? "").trim();'),
    # transport-fields-core (driver license reader)
    ("tf: markdown not normalized", TF, '  return normalizeMarkdownFields(text).replace(/\\s+/g, " ");', '  return text.replace(/\\s+/g, " ");'),
    # intake-store writer
    ("is: blank pick written", IS, '  if (!value) return "none";', '  if (false) return "none";'),
    ("is: unchanged rewritten", IS, '    if (current === value) return "unchanged";', '    if (false) return "unchanged";'),
    ("is: missing column reported as error", IS, '      return code === "42703" || code === "PGRST204" ? "missing-column" : "error";\n    }\n    if (!data) return "error";', '      return "error";\n    }\n    if (!data) return "error";'),
    ("is: unknown id saved", IS, '    if (!data) return "error";', '    if (!data) return "saved";'),
    ("is: update unscoped", IS, '        updated_by: actorId,\n      })\n      .eq("id", manifestId);\n    if (error) {\n      const code', '        updated_by: actorId,\n      })\n      .neq("id", "");\n    if (error) {\n      const code'),
    ("is: source not stored", IS, '        invoice_number_source: pick?.source ?? null,', ''),
    ("is: no event logged", IS, '      "invoice_number_detected",\n      current', '      "note",\n      current'),
    # event label
    ("el: label changed", EL, 'invoice_number_detected: { label: "Invoice # found in the documents", group: "delivery", problem: false },', 'invoice_number_detected: { label: "Invoice # found", group: "delivery", problem: false },'),
    # inbound-store wiring
    ("ib: no layer read", IB, '        layerText: layer.text,\n        page1: layer.page1,', '        layerText: null,\n        page1: null,'),
    ("ib: json not first", IB, '      { role: "transfer-json", label: att.filename ?? "transfer.json", payload: rawPayload },\n      ...invoiceDocs,', '      ...invoiceDocs,\n      { role: "transfer-json", label: att.filename ?? "transfer.json", payload: rawPayload },'),
    ("ib: email body not an invoice source", IB, '    invoiceDocs.push({ role: "email-body", label: "email body", text: email.bodyText });', ''),
    ("ib: invoice donors dropped", IB, '    pdfDonors.push(...invoiceDonors);', ''),
    ("ib: grounding-read ignored for layout pdf", IB, '          transport: read.donor?.transport ?? parsed.manifest.transport ?? null,', '          transport: parsed.manifest.transport ?? null,'),
    ("ib: grounded read not kept per attachment", IB, '      groundedByAtt.set(att, read.donor?.transport ?? null);', ''),
    ("ib: pdf primary keeps raw layout transport", IB, '        primary = { manifest: { ...parsed.manifest, transport: grounded }, text: parsed.text };', '        primary = { manifest: parsed.manifest, text: parsed.text };'),
    ("ib: json route single donor", IB, '    const donor = mergeMatchingDonors(manifest.manifest_number, pdfDonors);', '    const donor = mergeMatchingDonors(manifest.manifest_number, pdfDonors.slice(0, 1));'),
    # Run AI extract
    ("act: coa read", ACT, '    if (doc.role === "coa") continue; // a lab report is never transport / invoice', ''),
    ("act: pick not saved", ACT, '    await recordInvoiceNumberDetected(manifestId, invoicePick, session.userId);', ''),
    ("act: summary ignores pick", ACT, '  const readInvoice: string | null = invoicePick?.value ?? manifest.manifest_number ?? null;', '  const readInvoice: string | null = manifest.manifest_number ?? null;'),
    ("act: json not an invoice source", ACT, '        role: "transfer-json",\n        label: doc.filename,', '        role: "other",\n        label: doc.filename,'),
    ("act: first donor only", ACT, '  const transport = mergeMatchingDonors(manifest.manifest_number, donors);', '  const transport = donors[0]?.transport ?? null;'),
    # runner floors
    ("runner: md floor lowered", RUN, 'assertRan("markdown-fields-core", __runMarkdownFieldsTests(), 37);', 'assertRan("markdown-fields-core", __runMarkdownFieldsTests(), 36);'),
    ("runner: dt floor lowered", RUN, 'assertRan("doc-transport-core", __runDocTransportTests(), 39);', 'assertRan("doc-transport-core", __runDocTransportTests(), 38);'),
    ("runner: inv floor lowered", RUN, 'assertRan("invoice-number-core", __runInvoiceNumberCoreTests(), 18);', 'assertRan("invoice-number-core", __runInvoiceNumberCoreTests(), 17);'),
]

SUITES = [
    "tests/compliance/r26-cores.test.ts",
    "tests/compliance/r26-qgt-email-e2e.test.ts",
    "tests/compliance/r26-invoice-number-store.test.ts",
    "tests/compliance/r26-run-ai-extract.test.ts",
    "tests/compliance/intake-roadmap-decisions.test.ts",
    "tests/compliance/transport-fields-core.test.ts",
    "tests/compliance/manifest-merge.test.ts",
    "tests/compliance/manifest-table.test.ts",
    "tests/compliance/s29-accounting-tab.test.tsx",
    "tests/compliance/inbound-strict-gate.test.ts",
    "tests/compliance/inbound-attachments-fetch.test.ts",
    "tests/compliance/vendor-goldminer.test.ts",
    "tests/compliance/intake-transport.test.ts",
]


def read(p):
    with open(p, encoding="utf-8") as fh:
        return fh.read()


def write(p, s):
    with open(p, "w", encoding="utf-8") as fh:
        fh.write(s)


class Hung:
    """A mutant that makes the suite hang is caught: a hang is a failure, never a pass."""
    returncode = 124
    stdout = "TIMEOUT"


def run_suites(timeout=300):
    try:
        return subprocess.run(["npx", "vitest", "run", *SUITES], capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        subprocess.run(["pkill", "-f", "vitest"], capture_output=True)
        return Hung()


print("PRE-FLIGHT: verifying every anchor matches exactly once")
originals = {}
problems = []
for name, path, old, new in MUTANTS:
    if path not in originals:
        originals[path] = read(path)
    n = originals[path].count(old)
    if n != 1:
        problems.append(f"  {name}: anchor appears {n}x in {path}")
    if old == new:
        problems.append(f"  {name}: mutant is identical to the original")
names = [m[0] for m in MUTANTS]
for dup in sorted({n for n in names if names.count(n) > 1}):
    problems.append(f"  duplicate mutant name: {dup}")
if problems:
    print("ABORT - anchors are not unique. Nothing was run:")
    for p in problems:
        print(p)
    sys.exit(1)
print(f"  OK - all {len(MUTANTS)} anchors unique\n")
if "--preflight" in sys.argv:
    sys.exit(0)

print("BASELINE: the suites must be green before we break anything")
r = run_suites()
if r.returncode != 0:
    print("ABORT - baseline is already failing.")
    print(r.stdout[-3000:])
    sys.exit(1)
print("  OK - baseline green\n")


def _restore_and_exit(signum, frame):
    for path, src in originals.items():
        write(path, src)
    print("\nsignal: all files restored")
    sys.exit(130)


signal.signal(signal.SIGTERM, _restore_and_exit)
signal.signal(signal.SIGINT, _restore_and_exit)
only = [a for a in sys.argv[1:] if not a.startswith("--")]
survivors = []
ran = 0
try:
    for i, (name, path, old, new) in enumerate(MUTANTS, 1):
        if only and not any(o in name for o in only):
            continue
        ran += 1
        write(path, originals[path].replace(old, new))
        r = run_suites()
        write(path, originals[path])
        if r.returncode == 0:
            survivors.append(name)
            print(f"  [{i:2}/{len(MUTANTS)}] SURVIVED  <-- HOLE: {name}", flush=True)
        else:
            print(f"  [{i:2}/{len(MUTANTS)}] killed    {name}", flush=True)
finally:
    for path, src in originals.items():
        write(path, src)
    print("\nall files restored")

print()
if survivors:
    print(f"{len(survivors)} MUTANT(S) SURVIVED - the tests do not cover:")
    for s in survivors:
        print("  - " + s)
    sys.exit(1)
print(f"ALL {ran} MUTANTS KILLED" + (f" (filtered: {ran} of {len(MUTANTS)} run)" if ran != len(MUTANTS) else ""))
