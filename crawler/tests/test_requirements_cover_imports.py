"""Every third-party module the crawler imports must be installable in the image.

Regression guard: openpyxl was imported (lazily, inside the harvest's "batch
dates" stage) but missing from requirements.txt, so the Railway image did not
have it and the harvest failed at stage 7 with ModuleNotFoundError. Lazy imports
hide this from start-up, so we scan the source with `ast` instead of importing.

No network, no installs: pure static check of crawler/app vs requirements.txt.
"""
from __future__ import annotations

import ast
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
REQS = ROOT / "requirements.txt"
DOCKERFILE = ROOT / "Dockerfile"

# import name -> distribution name, where they differ.
IMPORT_TO_DIST = {
    "bs4": "beautifulsoup4",
    "pydantic_settings": "pydantic-settings",
    "dotenv": "python-dotenv",
}
# Provided by the Docker base image (mcr.microsoft.com/playwright/python), not pip.
FROM_BASE_IMAGE = {"playwright"}


def _norm(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def third_party_imports() -> dict[str, set[str]]:
    """Top-level module -> files importing it, excluding stdlib and the app package."""
    stdlib = set(sys.stdlib_module_names)
    found: dict[str, set[str]] = {}
    for f in sorted(APP.rglob("*.py")):
        tree = ast.parse(f.read_text(encoding="utf-8"), filename=str(f))
        for node in ast.walk(tree):
            mods: list[str] = []
            if isinstance(node, ast.Import):
                mods = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                mods = [node.module]
            for m in mods:
                top = m.split(".")[0]
                if top in stdlib or top in ("app", "__future__"):
                    continue
                found.setdefault(top, set()).add(f.relative_to(ROOT).as_posix())
    return found


def declared_dists() -> set[str]:
    out = set()
    for line in REQS.read_text(encoding="utf-8").splitlines():
        line = line.split("#", 1)[0].strip()
        if not line:
            continue
        name = re.split(r"[\[<>=!~ ;]", line, maxsplit=1)[0]
        out.add(_norm(name))
    return out


def test_every_third_party_import_is_declared():
    declared = declared_dists()
    missing = {
        mod: sorted(files)
        for mod, files in third_party_imports().items()
        if mod not in FROM_BASE_IMAGE and _norm(IMPORT_TO_DIST.get(mod, mod)) not in declared
    }
    assert not missing, f"imported but not in crawler/requirements.txt: {missing}"


def test_openpyxl_is_declared_for_the_batch_dates_stage():
    assert "openpyxl" in third_party_imports(), "scanner no longer sees openpyxl import"
    assert "openpyxl" in declared_dists()


def test_base_image_really_provides_the_exempt_modules():
    # The exemption is only honest while the Dockerfile still uses the Playwright image.
    assert "mcr.microsoft.com/playwright/python" in DOCKERFILE.read_text(encoding="utf-8")


def test_scanner_detects_lazy_imports_inside_functions():
    # The original bug was a function-local import; prove ast.walk sees those.
    src = "def f():\n    from openpyxl import load_workbook\n    import zzz_not_real.sub\n"
    mods = {n.module if isinstance(n, ast.ImportFrom) else n.names[0].name
            for n in ast.walk(ast.parse(src)) if isinstance(n, (ast.Import, ast.ImportFrom))}
    assert mods == {"openpyxl", "zzz_not_real.sub"}


def _uses_zoneinfo() -> list[str]:
    hits = []
    for f in sorted(APP.rglob("*.py")):
        for node in ast.walk(ast.parse(f.read_text(encoding="utf-8"))):
            if isinstance(node, ast.ImportFrom) and node.module == "zoneinfo":
                hits.append(f.relative_to(ROOT).as_posix())
            elif isinstance(node, ast.Import) and any(a.name == "zoneinfo" for a in node.names):
                hits.append(f.relative_to(ROOT).as_posix())
    return hits


def test_zoneinfo_users_ship_tzdata():
    # zoneinfo is stdlib, but its DATA is not: it reads /usr/share/zoneinfo or the
    # `tzdata` pip package. The Playwright base image has no /usr/share/zoneinfo,
    # so ZoneInfo("America/Los_Angeles") at import time crashed the app on boot
    # (Railway: healthcheck "service unavailable"). Require tzdata whenever used.
    if _uses_zoneinfo():
        assert "tzdata" in declared_dists(), f"zoneinfo used in {_uses_zoneinfo()} but tzdata not declared"


def test_zoneinfo_scanner_sees_the_harvester():
    assert "app/cultivera_pos.py" in _uses_zoneinfo()


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
