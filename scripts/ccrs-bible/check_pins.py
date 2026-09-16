"""Cross-check every spec pin in the hand-written bible parts against lcb/*.txt.
Prints pins whose line is out of range, and for pins that sit next to a quoted
string, checks the quote appears within the pinned line range (+-1 line)."""
import re, glob, os
ROOT = os.environ.get("CCRS_SOURCE_ROOT", "/workspace")
REPO = os.environ.get("CCRS_REPO", os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
SRC = {"G": "lcb/guide.txt", "FAQ": "lcb/faq.txt", "API": "lcb/api.txt",
       "LOGIN": "lcb/login.txt", "ADMIN": "lcb/admin-guide.txt", "SAW": "lcb/saw-guide.txt",
       "MANI": "lcb/manifests.txt"}
lines = {k: open(os.path.join(ROOT, v), encoding="utf-8", errors="replace").read().split("\n") for k, v in SRC.items()}
pin_re = re.compile(r"\[(G|FAQ|API|LOGIN|ADMIN|SAW|MANI) L(\d{4})(?:-L(\d{4}))?\]")
bad, checked, quote_miss = 0, 0, 0
for f in sorted(glob.glob(os.path.join(REPO, "docs/ccrs-bible/*.md"))):
    if os.path.basename(f)[:2] in ("02", "03"):
        continue
    text = open(f, encoding="utf-8").read()
    for m in pin_re.finditer(text):
        src, a, b = m.group(1), int(m.group(2)), int(m.group(3) or m.group(2))
        checked += 1
        n = len(lines[src])
        if a < 1 or b > n or a > b:
            bad += 1
            print(f"RANGE {os.path.basename(f)}: {m.group(0)} (file has {n} lines)")
            continue
        # look for a quote immediately before the pin: "..." `[pin]`
        pre = text[max(0, m.start()-400):m.start()]
        q = re.findall(r"\"([^\"]{12,})\"\s*`?$", pre.rstrip("` "))
        if q:
            quote = q[-1]
            frag = re.sub(r"\s+", " ", quote[:40]).lower()
            window = " ".join(lines[src][max(0, a-2):b+1])
            window = re.sub(r"\s+", " ", window).lower()
            if frag not in window:
                quote_miss += 1
                print(f"QUOTE? {os.path.basename(f)}: {m.group(0)} :: \"{quote[:60]}\"")
print(f"pins checked={checked} range_errors={bad} quote_mismatches={quote_miss}")
