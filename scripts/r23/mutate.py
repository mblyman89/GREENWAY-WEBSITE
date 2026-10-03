#!/usr/bin/env python3
"""
Round 23 mutation testing: testing the tests.

Owner (verbatim): "follow the standing rules, never guess, never assume.
test it, test the tests."

Each mutant deliberately BREAKS one rule from Round 23, and the R23 suites
must FAIL:
  A   - fix 1: finalize-banner-core + the one banner on the intake page
  B   - fixes 2/6: the human-confirmed attach (planner + S07 door)
  C   - fixes 2/6: waiting-facts-core (list, picks, gate helpers, closing)
  D   - fixes 2/6: waiting-facts-server + attachWaitingFactAction
  E   - fix 5: approved-row-core + page wiring + approve redirect
  F   - fix 7: masters-filter-core
  G   - fixes 3/10: sensory-fill-core (layers, KB match action)
  H   - fix 4: seo-draft-core
  I   - fixes 8/9: the pipeline bar and the home/specials images
Same discipline as scripts/r22/mutate.py: every anchor must appear exactly
once, the baseline must be green, and every file is restored afterwards.
"""
import signal
import subprocess
import sys

FBC = "src/lib/inventory/finalize-banner-core.ts"
INT = "src/app/admin/inventory/intake/[id]/page.tsx"
APC = "src/lib/catalog/attach-plan-core.ts"
APF = "src/lib/catalog/attach-facts.ts"
WFC = "src/lib/catalog/waiting-facts-core.ts"
WFS = "src/lib/catalog/waiting-facts-server.ts"
ACT = "src/app/admin/inventory/drafts/ai-lookup-actions.ts"
WFP = "src/components/admin/catalog/WaitingFactsPanel.tsx"
ARC = "src/lib/catalog/approved-row-core.ts"
PAGE = "src/app/admin/inventory/drafts/page.tsx"
DACT = "src/app/admin/inventory/drafts/actions.ts"
LJC = "src/lib/catalog/lookup-job-core.ts"
MFC = "src/lib/products/masters-filter-core.ts"
SFC = "src/lib/enrichment/sensory-fill-core.ts"
SEO = "src/lib/enrichment/seo-draft-core.ts"
HOME = "src/app/page.tsx"
SPEC = "src/app/specials/page.tsx"

MUTANTS = [
    # ==================================================================== A ==
    ("THE BUG: a finalize with rejected=0 is a whole-manifest reject again", FBC,
     "  const finalized = typeof p.finalized === \"string\" && p.finalized.trim() !== \"\" ? p.finalized.trim() : null;",
     "  const finalized = null as string | null;"),
    ("a refused line is not mentioned after finalize", FBC,
     "    if (rejected > 0) {\n      details.push(",
     "    if (false) {\n      details.push("),
    ("held lots are not mentioned after finalize", FBC,
     "    if (held > 0) {\n      details.push(",
     "    if (false) {\n      details.push("),
    ("a clean accept is gold, not green", FBC,
     "    if (finalized === \"accepted\") {\n      return {\n        kind: \"finalized\",\n        tone: \"green\",",
     "    if (finalized === \"accepted\") {\n      return {\n        kind: \"finalized\",\n        tone: \"gold\","),
    ("garbage counts parse (negative)", FBC,
     "  if (typeof raw !== \"string\" || !/^\\d{1,9}$/.test(raw.trim())) return 0;",
     "  if (typeof raw !== \"string\") return 0;"),
    ("the intake banner is red again", INT,
     "                : finalBanner.tone === \"gold\"\n                  ? \"rounded-[var(--admin-radius)] border border-[var(--admin-gold)]/40 bg-[var(--admin-gold-soft)] px-4 py-2 text-sm text-[var(--admin-text)]\"",
     "                : finalBanner.tone === \"gold\"\n                  ? \"rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 px-4 py-2 text-sm text-[var(--admin-danger)]\""),

    # ==================================================================== B ==
    ("human guard: a person's attach still obeys the shadow ring", APC,
     "  const act = input.mode === \"act\" || human;",
     "  const act = input.mode === \"act\";"),
    ("human guard: a person's attach files suggestions", APC,
     "  if (input.posProductKey && !human) {",
     "  if (input.posProductKey) {"),
    ("human guard: a person's attach may write the strain library", APC,
     "  const blocked = (input.strainBlockedReason ?? \"\").trim() || (human ? SKIP.human_no_strain : \"\");",
     "  const blocked = (input.strainBlockedReason ?? \"\").trim();"),
    ("human guard: the verdict source is gemini", APC,
     "    decide(f.field, { source: human ? \"human\" : \"gemini\", value: f.value, confidence: f.confidence }, {",
     "    decide(f.field, { source: \"gemini\", value: f.value, confidence: f.confidence }, {"),
    ("human guard: confirming what the record holds is not counted", APC,
     "    if (productLanded.has(f) || (human && productKept.has(f))) live.push(\"product record\");",
     "    if (productLanded.has(f)) live.push(\"product record\");"),
    ("confirmedBy guard: a product (enrichment) context may claim a person", APF,
     "  const human = input.confirmedBy === \"human\" && input.context.kind === \"draft\";",
     "  const human = input.confirmedBy === \"human\";"),
    ("confirmedBy guard: provenance says gemini for a person's attach", APF,
     "  const factSource = human ? (\"human\" as const) : (\"gemini\" as const);",
     "  const factSource = \"gemini\" as const;"),
    ("confirmedBy guard: the door reads (and may write) the strain for a person", APF,
     "  if (slug && !strainWriteDisabled && !human) {",
     "  if (slug && !strainWriteDisabled) {"),
    ("confirmedBy guard: the planner is never told it is a person", APF,
     "    confirmedBy: human ? \"human\" : null,\n  });",
     "    confirmedBy: null,\n  });"),

    # ==================================================================== C ==
    ("waiting list: another product's suggestion shows", WFC,
     "      if (String(row.entity_id ?? \"\").trim() !== key) continue;",
     "      if (false) continue;"),
    ("waiting list: an already-reviewed suggestion shows", WFC,
     "      if (row.status !== undefined && row.status !== null && row.status !== \"pending\") continue;",
     "      if (false) continue;"),
    ("waiting list: a field a person answered still shows candidates", WFC,
     "    if (answeredSet.has(f)) return;",
     "    if (false) return;"),
    ("waiting list: a value already held still shows", WFC,
     "    if (!vk || heldKey.get(f) === vk) return;",
     "    if (!vk) return;"),
    ("waiting list: never says 'nothing waiting'", WFC,
     "  return { facts, answered, emptyLine: facts.length === 0 ? WAITING_EMPTY_COPY : null };",
     "  return { facts, answered, emptyLine: null };"),
    ("waiting pick: a reviewed suggestion can be attached", WFC,
     "  if (!row || row.status !== \"pending\") return { ok: false, reason: PICK_GONE };",
     "  if (!row) return { ok: false, reason: PICK_GONE };"),
    ("waiting pick: another product's suggestion can be attached", WFC,
     "  if (!key || String(row.entity_id ?? \"\").trim() !== key) return { ok: false, reason: PICK_OTHER_PRODUCT };",
     "  if (!key) return { ok: false, reason: PICK_OTHER_PRODUCT };"),
    ("waiting pick: any field may be picked from a suggestion", WFC,
     "  expectedKey: string | null | undefined,\n): PickResult {\n  if (!isWaitingField(field)) return { ok: false, reason: PICK_BAD_FIELD };",
     "  expectedKey: string | null | undefined,\n): PickResult {"),
    ("waiting pick: a missing memory fact is attachable", WFC,
     "  if (!m) return { ok: false, reason: PICK_NO_MEMORY };",
     "  if (!m) return { ok: true, value: \"\" };"),
    ("gate helper: effects are fed in as aroma", WFC,
     "    effects: field === \"effects\" ? list : [],",
     "    effects: field === \"aroma\" ? list : [],"),
    ("suggestionClosable: prose suggestions get closed", WFC,
     "  if (row.field_key !== \"sensory\" && row.field_key !== \"effects\") return false;",
     "  if (false) return false;"),
    ("suggestionClosable: a partial sensory attach closes it", WFC,
     "  return fields.every((f) => {\n    const a = attachedAfter?.[f];",
     "  return fields.some((f) => {\n    const a = attachedAfter?.[f];"),
    ("suggestionClosable: a machine-held value counts as a person's", WFC,
     "    return !!a && a.source === \"human\" && valueKey(a.value) === valueKey(vals[f]);",
     "    return !!a && valueKey(a.value) === valueKey(vals[f]);"),
    ("result banner: any code renders", WFC,
     "  if (typeof code !== \"string\" || !(WAITING_RESULT_CODES as readonly string[]).includes(code)) return null;",
     "  if (typeof code !== \"string\") return null;"),
    ("result banner: message not capped", WFC,
     "  const m = typeof msg === \"string\" ? msg.replace(/\\s+/g, \" \").trim().slice(0, 300) : \"\";",
     "  const m = typeof msg === \"string\" ? msg.replace(/\\s+/g, \" \").trim() : \"\";"),

    # ==================================================================== D ==
    ("server read: every status, not just pending", WFS,
     "      .eq(\"status\", \"pending\")\n      .in(\"entity_id\", uniq)",
     "      .in(\"entity_id\", uniq)"),
    ("server read: unbounded", WFS,
     "      .limit(WAITING_SUGGESTION_LIMIT);",
     "      ;"),
    ("server read: a failed read looks like 'nothing waiting'", WFS,
     "    if (error) return { ok: false, rows: [] };",
     "    if (error) return { ok: true, rows: [] };"),
    ("server re-read: any entity type", WFS,
     ".eq(\"id\", v).eq(\"entity_type\", \"product\").maybeSingle();",
     ".eq(\"id\", v).maybeSingle();"),
    ("action: no permission check", ACT,
     "export async function attachWaitingFactAction(formData: FormData): Promise<void> {\n  const session = await requirePermission(\"inventory.manage\");",
     "export async function attachWaitingFactAction(formData: FormData): Promise<void> {\n  const session = { userId: \"x\", email: \"x\" };"),
    ("action: a dismissed product can be attached to", ACT,
     "    } else if (draft.status !== \"draft\" && draft.status !== \"approved\") {",
     "    } else if (false) {"),
    ("action: the compliance gate is skipped", ACT,
     "        if ((Array.isArray(gated) && gated.length === 0) || gated === \"\") {",
     "        if (false) {"),
    ("action: the door is not told it is a person", ACT,
     "            actor: { userId: session.userId, email: session.email },\n            confirmedBy: \"human\",",
     "            actor: { userId: session.userId, email: session.email },"),
    ("action: the suggestion is closed without checking it is fully attached", ACT,
     "              if (after && suggestionClosable(suggestionRow, attachedFactsOf(after.row))) {",
     "              if (after) {"),
    ("action: memory is used even when KB-first is off", ACT,
     "        pick = kbFirst ? pickMemoryValue(await recallForDraft(draftId), field) : { ok: false, reason: PICK_NO_MEMORY };",
     "        pick = pickMemoryValue(await recallForDraft(draftId), field);"),
    ("action: returns to the wrong tab", ACT,
     "  return draftsHref({ status, manifestId: manifest || null, draftId, extra: { wf: code, ...(msg ? { wf_msg: msg.slice(0, 300) } : {}) } });",
     "  return draftsHref({ status: \"draft\", manifestId: manifest || null, draftId, extra: { wf: code, ...(msg ? { wf_msg: msg.slice(0, 300) } : {}) } });"),
    ("panel: the form posts the value (the browser could smuggle text)", WFP,
     "                <input type=\"hidden\" name=\"field\" value={f.field} />",
     "                <input type=\"hidden\" name=\"field\" value={f.field} />\n                <input type=\"hidden\" name=\"value\" value={f.preview} />"),
    ("panel: a failed read is shown as 'nothing waiting'", WFP,
     "      {view.emptyLine && !readFailed ? (",
     "      {view.emptyLine ? ("),
    ("page: the waiting panel is not mounted in the AI card", PAGE,
     "                    {waitingView && (\n                      <WaitingFactsPanel",
     "                    {false && waitingView && (\n                      <WaitingFactsPanel"),
    ("batch row line still sends the owner to Product Enrichment", LJC,
     "waiting for you - attach them below`;",
     "waiting for you in Product Enrichment`;"),

    # ==================================================================== E ==
    ("approvedBannerLink: a forged id makes a link", ARC,
     "  if (!isUuid(draftId)) return null;",
     "  if (!draftId) return null;"),
    ("approvedBannerLink: links to the review tab", ARC,
     "  return draftsHref({ status: \"approved\", manifestId: manifestId ?? null, draftId });",
     "  return draftsHref({ status: \"draft\", manifestId: manifestId ?? null, draftId });"),
    ("approvedRowCopy: a zero price is shown", ARC,
     "  if (typeof p === \"number\" && Number.isFinite(p) && p > 0) lines.push([\"Price\", money(p)]);",
     "  if (typeof p === \"number\") lines.push([\"Price\", money(p)]);"),
    ("page: the detail row is review-tab only again", PAGE,
     "                    {v2Row && rowsOpen && (\n                      <OnboardingDetailRow",
     "                    {v2Row && view === \"draft\" && (\n                      <OnboardingDetailRow"),
    ("page: the Approved tab has no toggle", PAGE,
     "                              {v2Row && view === \"approved\" && (\n                                <details",
     "                              {false && (\n                                <details"),
    ("page: the Approved toggle uses a testid the CSS ignores", PAGE,
     "                                  className=\"group flex flex-col items-end\"\n                                  data-testid=\"draft-row-details\"\n                                >\n                                  <summary\n                                    className=\"flex cursor-pointer list-none items-center",
     "                                  className=\"group flex flex-col items-end\"\n                                  data-testid=\"approved-row-details\"\n                                >\n                                  <summary\n                                    className=\"flex cursor-pointer list-none items-center"),
    ("page: an Approved row shows the approve form", PAGE,
     "approve={view === \"approved\" ? approvedZone : approveForm}",
     "approve={approveForm}"),
    ("page: rowsOpen excludes the Approved tab", PAGE,
     "  const rowsOpen = view === \"draft\" || view === \"approved\";",
     "  const rowsOpen = view === \"draft\";"),
    ("page: the banner link reads the raw parameter", PAGE,
     "  const approvedLink = approved ? approvedBannerLink(sp.approved_draft, focus.manifestId) : null;",
     "  const approvedLink = approved ? (sp.approved_draft ?? null) : null;"),
    ("approve redirect does not name the draft", DACT,
     "  redirect(backTo(formData, { approved: \"1\", approved_draft: draftId }));",
     "  redirect(backTo(formData, { approved: \"1\" }));"),
    ("approve redirect pins the row on the review tab", DACT,
     "  redirect(backTo(formData, { approved: \"1\", approved_draft: draftId }));",
     "  redirect(backTo(formData, { approved: \"1\", approved_draft: draftId }, draftId));"),

    # ==================================================================== F ==
    ("masters filter: vendor facet ignored", MFC,
     "    if (f.vendor && vendorKey(c.vendor) !== f.vendor) return false;",
     "    if (false) return false;"),
    ("masters filter: an unreadable manifest shows everything", MFC,
     "      if (!manifestKeys) return false;",
     "      if (!manifestKeys) return true;"),
    ("masters filter: a non-uuid manifest is passed through", MFC,
     "  return { vendor, manifest: UUID_RE.test(m) ? m.toLowerCase() : \"\" };",
     "  return { vendor, manifest: m.toLowerCase() };"),
    ("masters filter: a rejected manifest is offered", MFC,
     "  return s === \"accepted\" || s === \"partially_accepted\";",
     "  return s !== \"\";"),
    ("masters filter: a master with a non-matching member passes", MFC,
     "  return members.some((m) => m.card !== null && passingKeys.has(m.card.key));",
     "  return members.length > 0;"),

    # ==================================================================== G ==
    ("sensory layers: a ladder list is replaced by a layer", SFC,
     "    if (lists[key].length > 0) continue;\n    for (const layer of layers) {",
     "    for (const layer of layers) {"),
    ("sensory layers: the last layer wins instead of the first", SFC,
     "      lists[key] = got;\n      origins[f] = label;\n      break;",
     "      lists[key] = got;\n      origins[f] = label;"),
    ("KB match: an already-linked row offers the action again", SFC,
     "  if (input.linked) return { kind: \"linked\", label: \"Linked to this card\" };",
     "  if (false) return { kind: \"linked\", label: \"Linked to this card\" };"),
    ("KB match: curated prose is overwritten", SFC,
     "    if (typeof cur === \"string\" && cur.trim() !== \"\") return null;\n    const t = typeof next",
     "    const t = typeof next"),
    ("KB match: non-compliant prose is used", SFC,
     "    if (!input.proseOk(t)) {\n      refused.push(name);\n      return null;\n    }",
     "    if (false) {\n      refused.push(name);\n      return null;\n    }"),

    # ==================================================================== H ==
    ("seo: a half-empty pair is filed", SEO,
     "  if (!title || !description) return null;\n  return JSON.stringify(",
     "  if (!title && !description) return null;\n  return JSON.stringify("),
    ("seo: a stored row is not re-cleaned", SEO,
     "  const title = cleanSeoTitle(r.seo_title);\n  const description = cleanSeoMeta(r.seo_description);\n  if (!title || !description) return null;\n  return { title, description };",
     "  const title = String(r.seo_title ?? \"\");\n  const description = String(r.seo_description ?? \"\");\n  if (!title || !description) return null;\n  return { title, description };"),

    # ==================================================================== I ==
    ("home page: card images not resolved again", HOME,
     "    loadLiveMenuItemsCached().then((items) => withMenuProfile(items)).then((items) => withResolvedImages(items)),",
     "    loadLiveMenuItemsCached().then((items) => withMenuProfile(items)),"),
    ("specials page: card images not resolved", SPEC,
     "    loadLiveMenuItemsCached().then((items) => withMenuProfile(items)).then((items) => withResolvedImages(items)),",
     "    loadLiveMenuItemsCached().then((items) => withMenuProfile(items)),"),
]

SUITES = [
    "tests/compliance/r23-finalize-banner.test.ts",
    "tests/compliance/r23-onboarding-waiting-facts.test.tsx",
    "tests/compliance/r23-waiting-facts-server.test.ts",
    "tests/compliance/r23-masters-filter.test.tsx",
    "tests/compliance/r23-sensory-kb-match.test.tsx",
    "tests/compliance/r23-seo-draft.test.ts",
    "tests/compliance/s07-attach-product-facts.test.ts",
    "tests/compliance/s11-onboarding-row.test.ts",
    "tests/compliance/s14-onboarding-list.test.ts",
    "tests/compliance/pipeline-fix-links-connected.test.ts",
    "tests/compliance/s02-deep-link-fix-messages.test.ts",
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


# ---------------------------------------------------------------- PRE-FLIGHT
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

# ------------------------------------------------------------------- BASELINE
print("BASELINE: the suites must be green before we break anything")
r = run_suites()
if r.returncode != 0:
    print("ABORT - baseline is already failing.")
    print(r.stdout[-3000:])
    sys.exit(1)
print("  OK - baseline green\n")


# ------------------------------------------------------------------- MUTATE
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
        write(path, originals[path])  # restore immediately
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
