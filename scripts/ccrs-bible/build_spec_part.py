#!/usr/bin/env python3
"""Generate docs/ccrs-bible/02-authoritative-spec.md from the on-disk LCB sources.
Every quoted line carries its source file + line number so future agents can cite it.
Run from /workspace. Sources: lcb/guide.txt, lcb/faq.txt, lcb/api.txt, lcb/login.txt,
lcb/admin-guide.txt, lcb/saw-guide.txt, lcb/manifests.txt, lcb/templates/*.csv
"""
import os, re, datetime, glob

# Repo-portable paths. CCRS_SOURCE_ROOT holds the LCB downloads (default /workspace,
# i.e. /workspace/lcb/*). CCRS_REPO defaults to this script's repo root.
ROOT = os.environ.get("CCRS_SOURCE_ROOT", "/workspace")
REPO = os.environ.get("CCRS_REPO", os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
OUT = f"{REPO}/docs/ccrs-bible/02-authoritative-spec.md"

def lines(path):
    with open(path, encoding="utf-8", errors="replace") as f:
        return f.read().split("\n")

def block(path, start, end, label):
    """Return a fenced block of lines start..end (1-based inclusive) with L-prefix."""
    ls = lines(path)
    rel = os.path.relpath(path, ROOT)
    out = [f"#### {label}", "", f"Source: `{rel}` L{start}-L{end} (1-based). Form-feeds (`\\f`) mark PDF page breaks.", "", "```text"]
    for i in range(start, min(end, len(ls)) + 1):
        txt = ls[i - 1].replace("\f", "<PAGEBREAK>").rstrip()
        out.append(f"L{i:04d}| {txt}")
    out += ["```", ""]
    return out

GUIDE = f"{ROOT}/lcb/guide.txt"
# page -> first line, verified in session 2 (see ccrs-notes.md section H)
# Footer "…CCRS Upload User Guide   Page N" is the LAST line of page N. Derive page ranges from the file itself.
_FOOT = {}
for _i, _l in enumerate(lines(GUIDE), 1):
    _m = re.search(r"CCRS Upload User Guide\s+Page (\d+)", _l)
    if _m: _FOOT[int(_m.group(1))] = _i
def prange(a, b=None):
    """content line range for pages a..b inclusive"""
    b = b or a
    start = _FOOT[a-1] + 1 if a-1 in _FOOT else 1
    return start, _FOOT[b]
PAGE_MAP = {p: prange(p)[0] for p in sorted(_FOOT)}

doc = []
A = doc.append
A("# 02 — Authoritative Specification (VERBATIM, PINNED)")
A("")
A(f"Generated {datetime.datetime.utcnow().strftime('%Y-%m-%d %H:%MZ')} by `build_spec_part.py` from the LCB documents saved under `/workspace/lcb/`.")
A("This part is **transcription, not interpretation**. Interpretation lives in Parts 04–09 and must cite this part by `L####` pin.")
A("")
A("## 0. How to cite from this part")
A("")
A("- Cite as `[G L0124]` (Upload User Guide, guide.txt line 124), `[FAQ L0039]`, `[API L####]`, `[LOGIN L####]`, `[ADMIN L####]`, `[SAW L####]`, `[MANI L####]`, `[TPL Inventory R4]` (template file, row 4).")
A("- The Upload User Guide PDF is `lcb/guide-2026-02.pdf` (`CCRS Upload User Guide 2-26 word.pdf` from https://lcb.wa.gov/ccrs/resources). `guide.txt` is `pdftotext -layout` output; page → first CONTENT line map (footer Page N is the LAST line of page N; derived from the footers, not hand-typed):")
A("")
A("| Page | First line | Page | First line |")
A("|---|---|---|---|")
pm = sorted(PAGE_MAP.items())
for i in range(0, len(pm), 2):
    a = pm[i]; b = pm[i+1] if i+1 < len(pm) else ("", "")
    A(f"| p.{a[0]} | L{a[1]} | {('p.'+str(b[0])) if b[0] != '' else ''} | {('L'+str(b[1])) if b[1] != '' else ''} |")
A("")
A("- Pages 19–29 (Plant, PlantTransfer, PlantDestruction, LabTest, Manifest) are producer/processor/lab files. Retailers do not file them (Table 1, p.3). They are intentionally NOT transcribed here; consult `lcb/guide.txt` L648-L1047 if ever needed.")
A("- RULE: if a future agent finds a newer guide on the Resources page, re-download, regenerate this part, and diff. Do not hand-edit this file.")
A("")

A("## 1. CCRS Upload User Guide — retailer-relevant pages, verbatim")
A("")
doc += block(GUIDE, 1, _FOOT[2], "1.0 Pages 1–2 — Title and table of contents")
doc += block(GUIDE, *prange(3), "1.1 Page 3 — Introduction, upload steps 1–8, Table 1 (which files each licensee type files)")
doc += block(GUIDE, *prange(4), "1.2 Page 4 — Upload groups / dependency order (Group 1 → 10 min → Group 2 → Group 3) and workflow steps 1–8")
doc += block(GUIDE, *prange(5), "1.3 Page 5 — Workflow steps (cont.) incl. retailer step 9/10 and the 'receiving licensee submits inventory transfer' rule")
doc += block(GUIDE, *prange(6), "1.4 Page 6 — Portal upload UI")
doc += block(GUIDE, *prange(7), "1.5 Page 7 — File header (SubmittedBy / SubmittedDate / NumberRecords)")
doc += block(GUIDE, *prange(8), "1.6 Page 8 — Common fields (ExternalIdentifier, CreatedBy/Date, UpdatedBy/Date, Operation)")
doc += block(GUIDE, *prange(9,10), "1.7 Pages 9–10 — Area file")
doc += block(GUIDE, *prange(11,12), "1.8 Pages 11–12 — Strain file")
doc += block(GUIDE, *prange(13,15), "1.9 Pages 13–15 — Product file (categories, Table 2, UnitWeightGrams, Description)")
doc += block(GUIDE, *prange(16,18), "1.10 Pages 16–18 — Inventory file")
doc += block(GUIDE, *prange(30,32), "1.11 Pages 30–32 — Inventory Adjustment file (reasons, AdjustmentDetail, Table 5)")
doc += block(GUIDE, *prange(33,35), "1.12 Pages 33–35 — Inventory Transfer file ('required weekly by any licensed facility that receives inventory')")
doc += block(GUIDE, *prange(36,41), "1.13 Pages 36–41 — Sale file (SaleType, taxes, Duplicate Sale note, Table 6 retail required fields)")

A("## 2. CCRS FAQ — verbatim (https://lcb.wa.gov/ccrs/faq)")
A("")
faq = f"{ROOT}/lcb/faq.txt"
doc += block(faq, 1, len(lines(faq)), "2.1 Full FAQ text (navigation stripped)")

A("## 3. CCRS Integrator API Guide (Aug 2026) — verbatim")
A("")
api = f"{ROOT}/lcb/api.txt"
doc += block(api, 1, len(lines(api)), "3.1 Full API guide text (`lcb/api-2026-08.pdf`). NOTE: integrator-only; the licensee weekly flow is the portal upload in §1.")

A("## 4. Getting Started and Login Guide — verbatim")
A("")
lg = f"{ROOT}/lcb/login.txt"
doc += block(lg, 1, len(lines(lg)), "4.1 Full login guide text (`lcb/login.pdf`)")

A("## 5. License Administrator Guide (Aug 9 2024) — verbatim")
A("")
ad = f"{ROOT}/lcb/admin-guide.txt"
doc += block(ad, 1, len(lines(ad)), "5.1 Full text (`lcb/admin-guide.pdf`). This is the ONLY documented control for adding/removing an integrator (Cultivera) from the license.")

A("## 6. SAW User Guide (Aug 9 2024) — verbatim")
A("")
sw = f"{ROOT}/lcb/saw-guide.txt"
doc += block(sw, 1, len(lines(sw)), "6.1 Full text (`lcb/saw-guide.pdf`). Superseded by WA.gov in October 2026 per FAQ; keep for the transition window.")

A("## 7. Transportation Manifests page — verbatim (https://lcb.wa.gov/ccrs/manifests)")
A("")
mn = f"{ROOT}/lcb/manifests.txt"
doc += block(mn, 1, len(lines(mn)), "7.1 Full text. Retailers do not file Manifest.csv (Table 1) but RECEIVE the CCRS-generated manifest PDF; its item rows carry the vendor's InventoryExternalIdentifier that becomes FromInventoryExternalIdentifier in InventoryTransfer.csv.")

A("## 8. Official CSV templates — byte-exact (https://lcb.wa.gov/ccrs/resources)")
A("")
A("Downloaded 2026-09-15. Each file is CRLF-terminated. Shown with `<CR>` markers so trailing-comma padding on the three header rows is visible. **Compare against `assembleCcrsFile` (`src/lib/compliance/ccrs-batch-core.ts` L632-L660) which emits `SubmittedBy,<value>` with NO padding — see Part 12 U-03.**")
A("")
for p in sorted(glob.glob(f"{ROOT}/lcb/templates/*.csv")):
    name = os.path.basename(p)
    A(f"#### 8.{name}")
    A("")
    A("```text")
    with open(p, "rb") as f:
        raw = f.read().decode("utf-8", errors="replace")
    for i, row in enumerate(raw.split("\n"), 1):
        if row == "" and i > 1:
            continue
        A(f"R{i}| {row.replace(chr(13), '<CR>')}")
    A("```")
    A("")
    cols = raw.split("\n")[3].replace("\r", "").split(",") if len(raw.split("\n")) > 3 else []
    A(f"Column count (row 4): **{len(cols)}**. Columns: `{'`, `'.join(cols)}`.")
    A("")

A("## 9. Environments and endpoints (collected, each with its source)")
A("")
A("| Item | Value | Source |")
A("|---|---|---|")
A("| Production portal | https://cannabisreporting.lcb.wa.gov | [G] p.3 step 1; [ADMIN] 'Make a Payment' step 1; [SAW] step 1 |")
A('| PREproduction portal | https://precannabisreporting.lcb.wa.gov | [API L0070] "(Pre-Production) precannabisreporting.lcb.wa.gov"; also [API L0074] |')
A("| PREprod availability | 'The LCB provides all cannabis licensees, labs and integrators access to the PREproduction CCRS environment for training and testing.' | [FAQ] Integrators Q1 |")
A("| PREprod isolation | 'These environments are autonomous and do not share administration or reporting data.' | [FAQ] Integrators Q5 |")
A("| Login (now) | SecureAccess Washington (SAW) via the portal URL, never directly | [SAW] step 1 |")
A("| Login (Oct 2026 →) | WA.gov; 'All users need to manually set up a new account.' https://manage.login.wa.gov/create/enter-email.html | [FAQ] WA.gov Transition |")
A("| Examiners | examiner@lcb.wa.gov (send CSV + forwarded error email) | [FAQ] Data Quality Q3 |")
A("| Licensing admin email change | customerservicelicensing@lcb.wa.gov from current admin email | [FAQ] General |")
A("| Integrator API token (PREprod) | https://test-login.wa.gov/oauth/token, audience lcb.ccrs.api.pre | [API] |")
A("| Integrator API token (prod) | https://www.login.wa.gov/oauth/token, audience lcb.ccrs.api.prod | [API] |")
A("| Integrator API upload | POST /api/v1/upload multipart `files=@…`, headers Authorization: Bearer, X-Uploader-Email | [API] |")
A("| File size | '≤1GB' recommended, 2GB accepted | [FAQ] Data Quality Q2 |")
A("| Reporting week | 'Sunday - Saturday … expected by no later than Sunday for the previous week. Reporting more frequently than weekly is allowed.' | [FAQ] Data Reporting |")
A("| Filename time zone | 'the file name should be referenced in PST' | [FAQ] General |")
A("")

with open(OUT, "w", encoding="utf-8") as f:
    f.write("\n".join(doc) + "\n")
print(OUT, len(doc), "lines")
