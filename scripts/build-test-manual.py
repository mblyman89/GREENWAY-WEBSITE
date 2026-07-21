#!/usr/bin/env python3
"""Build the interactive test manual (docs/audit/test-manual/index.html)
from docs/audit/TEST-PLAN.md. Self-contained single file: no network, no
dependencies at view time. Progress is stored in the browser's localStorage.

Run from repo root:  python3 scripts/build-test-manual.py
"""
import html
import json
import re
from pathlib import Path

import markdown  # pip install markdown

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "docs/audit/TEST-PLAN.md"
OUT_DIR = ROOT / "docs/audit/test-manual"
OUT = OUT_DIR / "index.html"

md_text = SRC.read_text(encoding="utf-8")

# ---- Split the markdown into sections keyed by the top-level anchors ----
# Section boundaries: lines like `<a id="phase-3"></a>` followed by `## ...`,
# plus the leading "Part A" / trailing "Part B" heading anchors already in the doc.

# Collect test ids for the tracker (both `#### T-###` and list-item `**T-###`)
test_ids = re.findall(r"^#### (T-\d+)", md_text, flags=re.M)
test_ids += re.findall(r"^- \*\*(T-\d+)", md_text, flags=re.M)
seen = set()
ordered_ids = [t for t in test_ids if not (t in seen or seen.add(t))]

# Map each test id -> the phase anchor it belongs to (for per-phase progress)
phase_of: dict[str, str] = {}
current_anchor = "part-a"
for line in md_text.splitlines():
    m = re.match(r'<a id="([a-z0-9-]+)"></a>', line.strip())
    if m:
        current_anchor = m.group(1)
        continue
    m = re.match(r"^#### (T-\d+)", line) or re.match(r"^- \*\*(T-\d+)", line)
    if m:
        phase_of[m.group(1)] = current_anchor

# Convert markdown to HTML
body_html = markdown.markdown(
    md_text,
    extensions=["tables", "fenced_code", "toc", "sane_lists"],
)

# Inject test-tracker widgets after every test heading.
# #### headings became <h4 id="...">T-0xx — title</h4> (the toc extension adds ids)
def add_widget_h4(m: re.Match) -> str:
    tid = m.group(2)
    return m.group(0) + f'\n<div class="tracker" data-test="{tid}"></div>'

body_html = re.sub(r"<h4(\s[^>]*)?>(T-\d+)[^<]*</h4>", add_widget_h4, body_html)

# List-item tests (Phase 12) became <li><strong>T-140 ...:</strong> ...</li>
# Keep the original label text and append an inline tracker right after it.
def add_widget_li(m: re.Match) -> str:
    tid = m.group(2)
    return m.group(1) + f'<span class="tracker inline" data-test="{tid}"></span> '

body_html = re.sub(r"(<li>\s*<strong>(T-\d+)[^<]*</strong>)", add_widget_li, body_html)

# Sidebar structure (anchor -> label). Keep in the doc's order.
NAV = [
    ("part-a--read-me-first", "Part A — Read me first"),
    ("phase-0", "Phase 0 — Setup verification"),
    ("phase-1", "Phase 1 — Logins & roles"),
    ("phase-2", "Phase 2 — The register"),
    ("phase-3", "Phase 3 — Ringing a sale"),
    ("phase-4", "Phase 4 — Offline & sync"),
    ("phase-5", "Phase 5 — Returns, voids, holds"),
    ("phase-6", "Phase 6 — Medical"),
    ("phase-7", "Phase 7 — Loyalty"),
    ("phase-8", "Phase 8 — Menu & website orders"),
    ("phase-9", "Phase 9 — Inventory"),
    ("phase-10", "Phase 10 — Staffing & payroll"),
    ("phase-11", "Phase 11 — Reports & CCRS"),
    ("phase-12", "Phase 12 — BREAK-IT DAY"),
    ("phase-13", "Phase 13 — Dress rehearsal"),
    ("part-b--the-results-log", "Part B — Results log"),
]
# The markdown "toc" extension slugs the `## Part A — Read me first` heading;
# our explicit <a id="phase-N"> anchors survive as-is. Fix Part A/B targets to
# the ids python-markdown generated.
body_html = body_html.replace('<h2 id="part-a-read-me-first">', '<h2 id="part-a--read-me-first">')
body_html = body_html.replace('<h2 id="part-b-the-results-log-reporting-back">', '<h2 id="part-b--the-results-log">')

nav_items = "\n".join(
    f'<a class="nav-item" href="#{anchor}" data-phase="{anchor}">{html.escape(label)}'
    f'<span class="phase-progress" data-phase-progress="{anchor}"></span></a>'
    for anchor, label in NAV
)

phase_map_json = json.dumps(phase_of)
test_ids_json = json.dumps(ordered_ids)

page = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Greenway POS — Owner's Testing Manual</title>
<style>
  :root {{
    --green: #7ed957; --gold: #ffd700; --orange: #ff7f00; --red: #ff5a5a;
    --purple: #c084fc;
    --canvas: #060807; --surface: #0c0e0d; --surface2: #121514;
    --text: #f5f7f5; --muted: rgba(245,247,245,.62); --border: rgba(255,255,255,.09);
  }}
  * {{ box-sizing: border-box; }}
  html {{ scroll-behavior: smooth; }}
  body {{
    margin: 0; background: var(--canvas); color: var(--text);
    font: 16px/1.65 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }}
  a {{ color: var(--green); }}
  .layout {{ display: flex; min-height: 100vh; }}
  /* ---------- sidebar ---------- */
  nav {{
    width: 290px; flex: 0 0 290px; background: var(--surface);
    border-right: 1px solid var(--border); padding: 18px 14px 40px;
    position: sticky; top: 0; height: 100vh; overflow-y: auto;
  }}
  nav h1 {{
    font-size: 15px; letter-spacing: .14em; text-transform: uppercase;
    color: var(--green); margin: 4px 6px 2px; font-weight: 900;
  }}
  nav .sub {{ font-size: 11px; color: var(--muted); margin: 0 6px 14px; }}
  .nav-item {{
    display: flex; justify-content: space-between; align-items: center; gap: 8px;
    padding: 8px 10px; margin: 2px 0; border-radius: 10px; text-decoration: none;
    color: var(--text); font-size: 13px; font-weight: 600;
  }}
  .nav-item:hover {{ background: var(--surface2); }}
  .nav-item.active {{ background: var(--green); color: #000; }}
  .nav-item.active .phase-progress {{ color: rgba(0,0,0,.7); }}
  .phase-progress {{ font-size: 11px; color: var(--muted); font-weight: 700; white-space: nowrap; }}
  .globalbar {{ margin: 12px 6px 16px; }}
  .globalbar .label {{ font-size: 11px; color: var(--muted); margin-bottom: 4px; }}
  .bar {{ height: 10px; border-radius: 999px; background: var(--surface2); overflow: hidden; }}
  .bar > div {{ height: 100%; background: linear-gradient(90deg, var(--green), var(--gold)); width: 0%; transition: width .3s; }}
  #search {{
    width: 100%; margin: 0 0 12px; padding: 9px 12px; border-radius: 10px;
    border: 1px solid var(--border); background: var(--surface2); color: var(--text);
    font-size: 13px; outline: none;
  }}
  #search:focus {{ border-color: var(--green); }}
  .toolbtn {{
    display: block; width: 100%; margin: 6px 0; padding: 9px 12px; border-radius: 999px;
    border: 0; font-weight: 900; font-size: 12px; letter-spacing: .08em;
    text-transform: uppercase; cursor: pointer;
  }}
  .toolbtn.export {{ background: var(--gold); color: #000; }}
  .toolbtn.reset {{ background: var(--surface2); color: var(--muted); }}
  /* ---------- main ---------- */
  main {{ flex: 1; min-width: 0; padding: 30px clamp(18px, 5vw, 70px) 120px; max-width: 980px; }}
  main h1 {{ font-size: 30px; line-height: 1.2; }}
  main h2 {{
    font-size: 23px; margin-top: 56px; padding-top: 18px;
    border-top: 2px solid var(--green); color: var(--green);
  }}
  main h3 {{ font-size: 18px; margin-top: 34px; color: var(--gold); }}
  main h4 {{
    font-size: 16px; margin: 30px 0 6px; padding: 10px 14px; border-radius: 12px;
    background: var(--surface); border: 1px solid var(--border); border-left: 4px solid var(--orange);
  }}
  main code {{ background: var(--surface2); padding: 2px 6px; border-radius: 6px; font-size: 13.5px; }}
  main pre {{ background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; overflow-x: auto; font-size: 13px; }}
  main pre code {{ background: none; padding: 0; }}
  main blockquote {{
    margin: 14px 0; padding: 10px 18px; border-left: 4px solid var(--gold);
    background: var(--surface); border-radius: 0 12px 12px 0; color: var(--muted);
  }}
  main table {{ border-collapse: collapse; width: 100%; font-size: 14px; }}
  main th, main td {{ border: 1px solid var(--border); padding: 7px 10px; text-align: left; }}
  main th {{ background: var(--surface2); }}
  main li {{ margin: 4px 0; }}
  main strong {{ color: #fff; }}
  .li-test {{ display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; }}
  /* ---------- tracker widget ---------- */
  .tracker {{ display: flex; gap: 6px; align-items: center; margin: 4px 0 10px; }}
  .tracker.inline {{ display: inline-flex; margin: 0; }}
  .tracker button {{
    border: 1px solid var(--border); background: var(--surface2); color: var(--muted);
    font-size: 11px; font-weight: 900; letter-spacing: .06em; text-transform: uppercase;
    border-radius: 999px; padding: 4px 12px; cursor: pointer;
  }}
  .tracker button.on-pass {{ background: var(--green); color: #000; border-color: var(--green); }}
  .tracker button.on-fail {{ background: var(--red); color: #000; border-color: var(--red); }}
  .tracker button.on-blocked {{ background: var(--gold); color: #000; border-color: var(--gold); }}
  .tracker .bugcard-btn {{ background: var(--purple); color: #000; border-color: var(--purple); display: none; }}
  .tracker .bugcard-btn.show {{ display: inline-block; }}
  .hl-hit {{ outline: 2px solid var(--gold); border-radius: 8px; }}
  .hidden-by-search {{ display: none !important; }}
  /* ---------- bug card modal ---------- */
  dialog {{
    background: var(--surface); color: var(--text); border: 1px solid var(--border);
    border-radius: 16px; max-width: 640px; width: 92vw; padding: 22px;
  }}
  dialog::backdrop {{ background: rgba(0,0,0,.7); }}
  dialog textarea {{
    width: 100%; height: 320px; background: var(--surface2); color: var(--text);
    border: 1px solid var(--border); border-radius: 10px; padding: 12px; font: 13px/1.5 monospace;
  }}
  dialog .row {{ display: flex; gap: 10px; margin-top: 12px; justify-content: flex-end; }}
  dialog button {{
    border: 0; border-radius: 999px; padding: 9px 18px; font-weight: 900;
    text-transform: uppercase; letter-spacing: .06em; font-size: 12px; cursor: pointer;
  }}
  dialog .copy {{ background: var(--green); color: #000; }}
  dialog .close {{ background: var(--surface2); color: var(--muted); }}
  /* ---------- mobile ---------- */
  #menu-toggle {{ display: none; }}
  @media (max-width: 860px) {{
    nav {{ position: fixed; z-index: 40; transform: translateX(-100%); transition: transform .25s; }}
    nav.open {{ transform: none; }}
    #menu-toggle {{
      display: block; position: fixed; z-index: 50; top: 12px; left: 12px;
      background: var(--green); color: #000; border: 0; border-radius: 999px;
      padding: 10px 16px; font-weight: 900; cursor: pointer;
    }}
    main {{ padding-top: 64px; }}
  }}
  @media print {{
    nav, #menu-toggle, .tracker {{ display: none !important; }}
    body {{ background: #fff; color: #000; }}
    main h2 {{ color: #000; border-color: #000; }}
    main h4 {{ background: #f3f3f3; border-left-color: #888; }}
  }}
</style>
</head>
<body>
<button id="menu-toggle">☰ Menu</button>
<div class="layout">
  <nav id="sidebar">
    <h1>Greenway POS</h1>
    <p class="sub">Owner's Testing Manual — interactive edition</p>
    <div class="globalbar">
      <div class="label"><span id="global-count">0 / 0</span> tests recorded</div>
      <div class="bar"><div id="global-fill"></div></div>
    </div>
    <input id="search" type="search" placeholder="Search tests… (e.g. offline, void, T-060)">
    {nav_items}
    <button class="toolbtn export" id="export-log">Export results log</button>
    <button class="toolbtn reset" id="reset-log">Reset all progress</button>
  </nav>
  <main id="content">
{body_html}
  </main>
</div>

<dialog id="bugcard-modal">
  <h3 style="margin-top:0">Bug Card — <span id="bc-test"></span></h3>
  <p style="font-size:13px;color:var(--muted)">Fill in the blanks, then Copy. Paste it into your results log / back to the AI.</p>
  <textarea id="bc-text" spellcheck="false"></textarea>
  <div class="row">
    <button class="close" onclick="document.getElementById('bugcard-modal').close()">Close</button>
    <button class="copy" id="bc-copy">Copy to clipboard</button>
  </div>
</dialog>

<script>
const TEST_IDS = {test_ids_json};
const PHASE_OF = {phase_map_json};
const KEY = "gw-test-manual-v1";

function loadState() {{
  try {{ return JSON.parse(localStorage.getItem(KEY) || "{{}}"); }} catch (e) {{ return {{}}; }}
}}
function saveState(s) {{ localStorage.setItem(KEY, JSON.stringify(s)); }}
let state = loadState();

// ---- build tracker widgets ----
document.querySelectorAll(".tracker").forEach(el => {{
  const tid = el.dataset.test;
  el.innerHTML = `
    <button data-v="pass">Pass</button>
    <button data-v="fail">Fail</button>
    <button data-v="blocked">Blocked</button>
    <button class="bugcard-btn" data-v="bug">Bug card</button>`;
  el.querySelectorAll("button[data-v]").forEach(btn => {{
    btn.addEventListener("click", () => {{
      const v = btn.dataset.v;
      if (v === "bug") return openBugCard(tid);
      const cur = state[tid] && state[tid].verdict;
      if (cur === v) {{ delete state[tid]; }}
      else {{ state[tid] = {{ verdict: v, at: new Date().toISOString().slice(0,16).replace("T"," ") }}; }}
      saveState(state); render();
    }});
  }});
}});

function render() {{
  let done = 0;
  const perPhase = {{}};
  TEST_IDS.forEach(tid => {{
    const ph = PHASE_OF[tid] || "part-a";
    perPhase[ph] = perPhase[ph] || {{ total: 0, done: 0, fail: 0 }};
    perPhase[ph].total++;
    const rec = state[tid];
    if (rec) {{ done++; perPhase[ph].done++; if (rec.verdict === "fail") perPhase[ph].fail++; }}
  }});
  document.querySelectorAll(".tracker").forEach(el => {{
    const rec = state[el.dataset.test];
    el.querySelectorAll("button[data-v]").forEach(btn => {{
      btn.classList.remove("on-pass","on-fail","on-blocked");
      if (rec && btn.dataset.v === rec.verdict) btn.classList.add("on-" + rec.verdict);
    }});
    el.querySelector(".bugcard-btn").classList.toggle("show", !!(rec && rec.verdict === "fail"));
  }});
  document.getElementById("global-count").textContent = done + " / " + TEST_IDS.length;
  document.getElementById("global-fill").style.width = (TEST_IDS.length ? (100*done/TEST_IDS.length) : 0) + "%";
  document.querySelectorAll("[data-phase-progress]").forEach(el => {{
    const p = perPhase[el.dataset.phaseProgress];
    el.textContent = p ? (p.done + "/" + p.total + (p.fail ? " ✗" + p.fail : "")) : "";
  }});
}}
render();

// ---- bug card ----
function openBugCard(tid) {{
  const now = new Date();
  const stamp = now.toISOString().slice(0,10) + ", " + now.toTimeString().slice(0,5);
  document.getElementById("bc-test").textContent = tid;
  document.getElementById("bc-text").value =
`BUG CARD ————————————————————————————————————————
Test ID:        ${{tid}}
Date & time:    ${{stamp}}
Where:          (register name / back-office page URL / website page)
Who:            (which login / which employee PIN was in use)
What I did:     (the exact steps, numbered)
What I expected:(copy the Expected line from the test)
What happened:  (EXACTLY what you saw — quote on-screen text word for word)
Screen photo:   (taken? yes/no)
Can I repeat it?(yes / no / sometimes — tried once more?)
Impact:         (blocked me / worked around it / cosmetic)
—————————————————————————————————————————————————`;
  document.getElementById("bugcard-modal").showModal();
}}
document.getElementById("bc-copy").addEventListener("click", () => {{
  navigator.clipboard.writeText(document.getElementById("bc-text").value);
  document.getElementById("bc-copy").textContent = "Copied ✓";
  setTimeout(() => document.getElementById("bc-copy").textContent = "Copy to clipboard", 1200);
}});

// ---- export results log ----
document.getElementById("export-log").addEventListener("click", () => {{
  const lines = TEST_IDS.map(tid => {{
    const rec = state[tid];
    if (!rec) return tid + " | (not run)";
    return tid + " | " + rec.at + " | " + rec.verdict.toUpperCase();
  }});
  const blob = new Blob([lines.join("\\n") + "\\n"], {{ type: "text/plain" }});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "greenway-test-results-" + new Date().toISOString().slice(0,10) + ".txt";
  a.click();
}});
document.getElementById("reset-log").addEventListener("click", () => {{
  if (confirm("Erase ALL recorded test results on this device?")) {{
    state = {{}}; saveState(state); render();
  }}
}});

// ---- search ----
const searchBox = document.getElementById("search");
searchBox.addEventListener("input", () => {{
  const q = searchBox.value.trim().toLowerCase();
  document.querySelectorAll("main h4").forEach(h4 => {{
    // group = heading + following siblings until next h2/h3/h4
    const group = [h4];
    let n = h4.nextElementSibling;
    while (n && !/^H[234]$/.test(n.tagName)) {{ group.push(n); n = n.nextElementSibling; }}
    const text = group.map(e => e.textContent).join(" ").toLowerCase();
    const hide = q && !text.includes(q);
    group.forEach(e => e.classList.toggle("hidden-by-search", hide));
  }});
}});

// ---- active nav highlight ----
const anchors = Array.from(document.querySelectorAll("a[id], h2[id]"));
window.addEventListener("scroll", () => {{
  let current = null;
  for (const a of anchors) {{
    if (a.getBoundingClientRect().top < 120) current = a.id;
  }}
  document.querySelectorAll(".nav-item").forEach(item => {{
    item.classList.toggle("active", item.dataset.phase === current);
  }});
}}, {{ passive: true }});

// ---- mobile menu ----
document.getElementById("menu-toggle").addEventListener("click", () =>
  document.getElementById("sidebar").classList.toggle("open"));
document.querySelectorAll(".nav-item").forEach(a =>
  a.addEventListener("click", () => document.getElementById("sidebar").classList.remove("open")));
</script>
</body>
</html>
"""

OUT_DIR.mkdir(parents=True, exist_ok=True)
OUT.write_text(page, encoding="utf-8")
print(f"wrote {OUT} ({OUT.stat().st_size//1024} KB) — {len(ordered_ids)} tests tracked")
