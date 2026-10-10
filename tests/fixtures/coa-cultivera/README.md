# Cultivera-hosted lab certificates (R36)

Real documents the owner's vendor (Quality Green Trees / Freddy's Fuego) links
in its WCIA transfers. Every link in the owner sample transfers that is not on
certs.conflabs.com / gglabs-j.github.io is on **files.cultivera.com** (70 of 70
lab-result links in back-office/source-materials, measured R36).

Downloaded 2026 (R36) with curl; `sources.json` records each URL and the PDF
byte size. The PDFs themselves are not committed (1.3 MB each); the text
layers are, produced exactly the way production reads them:

- `*.unpdf.txt`  - unpdf `extractText(mergePages: true)` (production path)
- `*.layout.txt` - `pdftotext -layout`
- `*.wcia.json`  - the lab JSON from the transfer's `lab_result_link`

Survey of all 35 distinct Cultivera COA PDFs (live, R36):

| Layout | Count | Lab (read from the PDF) |
|---|---|---|
| Confidence Analytics "Template Version: 6.0" | 10 | Confidence Analytics (footer) - page 1 header "Medical Compliance Testing" |
| Confidence Analytics "Template Version: 7.0" | 21 | same (3 say "Medical Compliance Test Report") |
| Testing Technologies (one page, no template version) | 4 | Testing Technologies, Poulsbo (WSLCB lab #7, historical) |

Every file was served 200 with `application/pdf` / `application/json`, no
redirect. Two of the four Testing Technologies JSON links arrive doubled
(`https://files.cultivera.com/https://files.cultivera.com/...`); the doubled
form answers 403, the collapsed form 200 (cleanUrl in intake-parser).

## File names

Every certificate is `cvNN` (cv00-cv34, in the order of `sources.json`).
`*.layout.txt` exists only for cv00, cv13, cv28 and cv32 (one per layout, plus
cv28, the certificate with a `<LOQ` cell); production never reads it.

| Layout | Stems |
|---|---|
| Confidence Analytics Template 6.0 | cv00, cv01, cv02, cv03, cv04, cv05, cv06, cv07, cv08, cv10 |
| Confidence Analytics Template 7.0 | cv09, cv11, cv12, cv13, cv14, cv15, cv16, cv17, cv18, cv19, cv20, cv21, cv22, cv23, cv24, cv25, cv26, cv27, cv28, cv29, cv30 |
| Testing Technologies | cv31, cv32, cv33, cv34 |

Tested by `tests/compliance/r36-cultivera-coa.test.ts` (every PDF number is
compared with the lab JSON: 270 of 270 agree).
