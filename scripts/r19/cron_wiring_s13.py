"""R19 S13: idempotent cron wiring (vercel.json, cadence pins, AGENTS rule 12 schedule)."""
import json, io
NL = chr(10)

def sub(path, old, new):
    s = io.open(path, encoding="utf-8").read()
    if new in s:
        return
    assert s.count(old) == 1, (path, old[:60])
    io.open(path, "w", encoding="utf-8").write(s.replace(old, new))

# vercel.json
p = "vercel.json"
cfg = json.load(io.open(p, encoding="utf-8"))
if not any(c["path"] == "/api/cron/lookup-jobs" for c in cfg["crons"]):
    cfg["crons"].append({"path": "/api/cron/lookup-jobs", "schedule": "* * * * *"})
    io.open(p, "w", encoding="utf-8").write(json.dumps(cfg, indent=2) + NL)

t = "tests/compliance/leafly-certification.test.ts"
sub(t,
    "    // The two Leafly crons are the only sub-daily jobs. Everything else is a" + NL,
    "    // The two Leafly crons and the S13 batch lookup worker are the only" + NL +
    "    // sub-daily jobs (the worker runs every minute and an idle tick is one" + NL +
    "    // indexed query; R19 S13). Everything else is a" + NL)
sub(t,
    '      "/api/cron/leafly-menu-sync": 96, //  every 15 minutes' + NL,
    '      "/api/cron/leafly-menu-sync": 96, //  every 15 minutes' + NL +
    '      "/api/cron/lookup-jobs": 1440, //    every minute (S13 batch lookup worker)' + NL)

u = "tests/compliance/usage-5-preview-builds-off.test.ts"
sub(u, "    expect(crons.length).toBe(5);" + NL,
       "    expect(crons.length).toBe(6); // R19 S13 added /api/cron/lookup-jobs" + NL)

a = "AGENTS.md"
sub(a, "`leafly-menu-sync` every 15 min (= the finest interval the owner can pick); ",
       "`leafly-menu-sync` every 15 min (= the finest interval the owner can pick); `lookup-jobs` every minute (R19 S13: the \"Look up all N products\" worker; leased by compare-and-swap, an idle tick is one indexed query); ")
print("ok")
