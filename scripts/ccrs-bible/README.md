# CCRS bible generators

These three scripts produce and verify the reference volumes of `docs/ccrs-bible/`.
**Never hand-edit Parts 02 or 03 — regenerate them.**

| Script | Produces / does | Inputs |
|---|---|---|
| `build_spec_part.py` | `docs/ccrs-bible/02-authoritative-spec.md` — verbatim LCB text, every line pinned `L####` | the LCB downloads under `$CCRS_SOURCE_ROOT/lcb/` (see `docs/ccrs-bible/13-sources.md` for URLs + md5s) |
| `build_atlas_part.py` | `docs/ccrs-bible/03-code-anchor-atlas.md` — verbatim code snippets with line numbers, stamped with the git commit | this working tree |
| `check_pins.py` | Verifies every `[G L####]` / `[FAQ L####]` / … pin in the hand-written parts resolves to a real line, and that quotes next to a pin appear at that line | both |

## Running

```bash
# From the repo root. CCRS_REPO defaults to the repo this script lives in.
python3 scripts/ccrs-bible/build_atlas_part.py          # always runnable
python3 scripts/ccrs-bible/check_pins.py                # needs the LCB sources

# The spec generator needs the LCB text files. Default source root is /workspace
# (i.e. /workspace/lcb/guide.txt). Override if they live elsewhere:
CCRS_SOURCE_ROOT=/path/that/contains/lcb python3 scripts/ccrs-bible/build_spec_part.py
```

`check_pins.py` must report `range_errors=0`. Quote mismatches are advisory — a few are
expected where a quotation is elided with `…` or where the pin sits inside a code block.

## Re-fetching the LCB sources

If `lcb/` is missing, re-download per `docs/ccrs-bible/13-sources.md` §A/§B, then:

```bash
pdftotext -layout lcb/guide-2026-02.pdf lcb/guide.txt
md5sum lcb/*.txt lcb/templates/*.csv    # compare against Part 13 before regenerating
```

A changed md5 means the LCB revised the document: every pin in Parts 04–13 must be
re-verified before any code that relies on it is shipped.
