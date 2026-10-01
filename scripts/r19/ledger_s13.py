"""R19 S13: idempotent env-ledger + .env.example update for MANIFEST_BATCH_LOOKUP and LOOKUP_ITEMS_PER_TICK."""
import io
NL = chr(10)
L = "docs/INTAKE_PIPELINE_ENV_LEDGER.md"
s = io.open(L, encoding="utf-8").read()

def r(a, b, marker):
    global s
    if marker in s:
        return
    assert s.count(a) == 1, a[:80]
    s = s.replace(a, b)

golden_row = [l for l in s.split(NL) if l.startswith("| `GOLDEN_RECORD_ON_APPROVE` | S12 |")][0]
row1 = ("| `MANIFEST_BATCH_LOOKUP` | S13 | on | `on` \u00b7 same off-words | On Product Onboarding, a delivery's Needs review tab shows "
        "**\"Look up all N products on this manifest\"**. Pressing it only saves a job (migration 0242: `lookup_jobs` + `lookup_job_items`). "
        "The every-minute worker `/api/cron/lookup-jobs` then looks the products up on the server, one at a time, the same way the row's AI Lookup + Save selected does: "
        "what is already on file first (S09), the paid web lookup only for the gaps, then the single write door under your attach setting (S07/S10). "
        "So you can close the tab. The page shows \"9 of 14 looked up \u00b7 31 facts attached \u00b7 6 need your eye\", the number of paid AI web lookups, and one line on each row. "
        "Pressing it again only looks up what is left. Stop the batch lookup cancels the products not started yet. "
        "A failed product never stops the others; the AI budget cap stops the rest. Before migration 0242 the button explains it and the worker does nothing. "
        "An idle worker tick is one indexed read. Needs `CRON_SECRET` (as every cron route does), an AI key, and `ATTACH_FACTS_V2` on. "
        "| Set `off` (no button, no panel; the worker returns before any database read; AI Lookup on each row is unchanged) |")
row2 = ("| `LOOKUP_ITEMS_PER_TICK` | S13 | `12` | `1`\u2013`12` (junk, `0` or negative \u2192 `12`; above 12 \u2192 `12`) | "
        "Bible S13.8, \"chunk size configurable\": how many products one worker run may start. Each run also stops starting products once one more could not finish inside its 800-second limit, so 12 is a ceiling, not a target. "
        "Lower it (for example `3`) if the AI provider starts refusing for rate limits. "
        "| Unset (back to `12`) |")
r(golden_row + NL, golden_row + NL + row1 + NL + row2 + NL, "| `MANIFEST_BATCH_LOOKUP` | S13 |")

r("`GOLDEN_RECORD_ENV` (`src/lib/catalog/golden-record-core.ts`), ",
  "`GOLDEN_RECORD_ENV` (`src/lib/catalog/golden-record-core.ts`), `MANIFEST_BATCH_LOOKUP_ENV` and `LOOKUP_ITEMS_PER_TICK_ENV` (`src/lib/catalog/lookup-job-core.ts`), ",
  "`MANIFEST_BATCH_LOOKUP_ENV` and `LOOKUP_ITEMS_PER_TICK_ENV`")

r("| S13 | \"Feature flag; per-row lookup remains\" | named in S13 |" + NL, "", "S13 shipped in Round 19")

r("S12 (`GOLDEN_RECORD_ON_APPROVE`), S17",
  "S12 (`GOLDEN_RECORD_ON_APPROVE`), S13 (`MANIFEST_BATCH_LOOKUP`, `LOOKUP_ITEMS_PER_TICK`), S17",
  "S13 (`MANIFEST_BATCH_LOOKUP`, `LOOKUP_ITEMS_PER_TICK`)")

shipped12 = "So the S12 planned row left \u00a74." + NL
r(shipped12, shipped12 + NL +
  "S13 shipped in Round 19. Its bible rollback line, \"Feature flag; per-row lookup remains\", is the `MANIFEST_BATCH_LOOKUP` row in \u00a71 (name chosen in the S13 PR, as \u00a74 promised). "
  "With the flag off, the button and the progress panel are hidden and the worker returns before any database read; AI Lookup on each row never changed. "
  "Its risk line, \"chunk size configurable\" (S13.8), is the `LOOKUP_ITEMS_PER_TICK` row. So the S13 planned row left \u00a74." + NL,
  "S13 shipped in Round 19")

r("S12 added `GOLDEN_RECORD_ON_APPROVE` in Round 19; S14",
  "S12 added `GOLDEN_RECORD_ON_APPROVE` and S13 added `MANIFEST_BATCH_LOOKUP` and `LOOKUP_ITEMS_PER_TICK` in Round 19; S14",
  "S13 added `MANIFEST_BATCH_LOOKUP` and `LOOKUP_ITEMS_PER_TICK` in Round 19")

gl = [l for l in s.split(NL) if l.startswith("- `GOLDEN_RECORD_ON_APPROVE` = `on` (same as unset).")][0]
r(gl + NL, gl + NL +
  "- `MANIFEST_BATCH_LOOKUP` = `on` (same as unset), after migration 0242 is applied. A delivery's Needs review tab gets \"Look up all N products on this manifest\"; the every-minute worker does the lookups on the server, so no tab has to stay open. Needs `CRON_SECRET` set (it already guards the other crons) and an AI key. `off` hides the button and stops the worker.\n"
  "- `LOOKUP_ITEMS_PER_TICK`: leave unset (`12`). Lower it only if the AI provider refuses for rate limits.\n",
  "- `MANIFEST_BATCH_LOOKUP` = `on`")
io.open(L, "w", encoding="utf-8").write(s)

E = ".env.example"
e = io.open(E, encoding="utf-8").read()
anchor = "# GOLDEN_RECORD_ON_APPROVE=on" + NL + "#" + NL
block = ("# SLICE S13 - look up a whole delivery with one button. ON by default (needs\n"
         "# migration 0242, an AI key and CRON_SECRET): a delivery's Needs review tab\n"
         "# shows \"Look up all N products on this manifest\"; the every-minute worker\n"
         "# /api/cron/lookup-jobs does the lookups on the server. Set to off (or 0 /\n"
         "# false / no / disabled) to hide the button and stop the worker; AI Lookup on\n"
         "# each row is unchanged.\n"
         "# MANIFEST_BATCH_LOOKUP=on\n"
         "#\n"
         "# S13.8 \"chunk size configurable\": products one worker run may start (1-12;\n"
         "# junk / 0 / negative = 12, above 12 = 12). Lower it if the AI provider\n"
         "# refuses for rate limits.\n"
         "# LOOKUP_ITEMS_PER_TICK=12\n"
         "#\n")
if "# MANIFEST_BATCH_LOOKUP=on" not in e:
    assert e.count(anchor) == 1
    e = e.replace(anchor, anchor + block)
    io.open(E, "w", encoding="utf-8").write(e)
print("ok")
