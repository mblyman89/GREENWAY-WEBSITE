/**
 * tests/compliance/r23-onboarding-waiting-facts.test.tsx  (Round 23, items 2, 5 and 6)
 *
 * Owner (verbatim): "what I would like to see happen after the AI lookup is
 * finished, for all the facts to be shown in the ai card section in the
 * product row. with the ability to attach them there, rather than needing to
 * approve everything" ... "if the onboarding page shows facts available, I
 * would like to attach them in onboarding instead of enrichment." ... "I cant
 * see the expanded row after approving a product in onboarding."
 *
 * Layers:
 *   A. the pure cores (waiting-facts-core, approved-row-core) - exact counts,
 *      registered in the runner, plus behaviour pins from the outside;
 *   B. the REAL attachWaitingFactAction against mocks: the browser only names
 *      the fact, the server re-reads + re-gates it, the door is called as a
 *      person's confirmation, and only a fully-attached sensory/effects
 *      suggestion is closed;
 *   C. the panel markup (plain forms, no JS) and the page wiring.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  PICK_BAD_FIELD,
  PICK_GONE,
  PICK_OTHER_PRODUCT,
  WAITING_EMPTY_COPY,
  WAITING_HEADING,
  buildWaitingFacts,
  suggestionClosable,
  waitingResultBanner,
  __runWaitingFactsCoreTests,
  type WaitingSuggestionRow,
} from "@/lib/catalog/waiting-facts-core";
import {
  APPROVED_BANNER_LINK_TEXT,
  approvedBannerLink,
  approvedRowCopy,
  __runApprovedRowCoreTests,
} from "@/lib/catalog/approved-row-core";
import { itemRowCopy } from "@/lib/catalog/lookup-job-core";
import { WaitingFactsPanel } from "@/components/admin/catalog/WaitingFactsPanel";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const D = "22222222-2222-4222-8222-222222222222";
const M = "11111111-1111-4111-8111-111111111111";
const S = "33333333-3333-4333-8333-333333333333";
const KEY = "LOT-1";
const AT = "2026-01-01T00:00:00.000Z";

// -- Mocks for the REAL server action --------------------------------------------
const net = vi.hoisted(() => ({
  calls: [] as string[],
  draft: null as null | { status: string; key: string | null; row: Record<string, unknown> },
  draftAfter: null as null | { status: string; key: string | null; row: Record<string, unknown> },
  suggestion: null as null | Record<string, unknown>,
  memory: null as null | Record<string, unknown>,
  attachInput: null as null | Record<string, unknown>,
  attach: null as null | Record<string, unknown>,
  reviewed: [] as [string, string][],
  audits: [] as Record<string, unknown>[],
  reads: 0,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => net.calls.push(`revalidate:${p}`) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    net.calls.push(`redirect:${url}`);
    const e = new Error("NEXT_REDIRECT") as Error & { digest: string };
    e.digest = `NEXT_REDIRECT;${url}`;
    throw e;
  },
  unstable_rethrow: (e: unknown) => {
    if (e instanceof Error && e.message === "NEXT_REDIRECT") throw e;
  },
}));
vi.mock("@/lib/auth/session", () => ({
  requirePermission: async (p: string) => {
    net.calls.push(`perm:${p}`);
    return { userId: "u1", email: "m@x", profile: { role: "owner" } };
  },
}));
vi.mock("@/lib/auth/audit", () => ({ recordAudit: async (e: Record<string, unknown>) => void net.audits.push(e) }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({}) }));
vi.mock("@/lib/ai/kb/retrieval", () => ({ loadBannedPhrases: async () => [{ phrase: "miracle", severity: "block", reason: "medical claim" }] }));
vi.mock("@/lib/ai/kb/store", () => ({ upsertKbStrain: async () => ({}) }));
vi.mock("@/lib/ai/suggestions", () => ({
  listSuggestions: async () => [],
  persistSuggestion: async () => {},
  reviewSuggestion: async (id: string, status: string) => void net.reviewed.push([id, status]),
}));
vi.mock("@/lib/catalog/fact-memory", () => ({ recallForDraft: async () => net.memory }));
vi.mock("@/lib/catalog/waiting-facts-server", () => ({
  readDraftForWaiting: async () => {
    net.reads += 1;
    return net.reads > 1 && net.draftAfter ? net.draftAfter : net.draft;
  },
  readWaitingSuggestion: async () => net.suggestion,
}));
vi.mock("@/lib/catalog/attach-facts", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    attachProductFacts: async (input: Record<string, unknown>) => {
      net.attachInput = input;
      return net.attach;
    },
  };
});

const { attachWaitingFactAction } = await import("@/app/admin/inventory/drafts/ai-lookup-actions");

function form(over: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const base: Record<string, string> = {
    draft_id: D,
    field: "effects",
    origin: "suggestion",
    suggestion_id: S,
    return_manifest: M,
    return_status: "draft",
    ...over,
  };
  for (const [k, v] of Object.entries(base)) fd.set(k, v);
  return fd;
}
const lastRedirect = () => [...net.calls].reverse().find((c) => c.startsWith("redirect:")) ?? "";
const params = () => new URL(lastRedirect().slice("redirect:".length), "http://x").searchParams;
const okReceipt = (field: string) => ({
  ok: true,
  mode: "shadow",
  sentence: `Attached 1 fact to Blue Dream.`,
  notes: [],
  receipt: { attached: [{ field, to: ["product record"] }], queued: [], skipped: [] },
});
const humanFact = (value: unknown) => ({ value, source: "human" as const, confidence: null, at: AT });

beforeEach(() => {
  net.calls = [];
  net.draft = { status: "draft", key: KEY, row: { id: D } };
  net.draftAfter = null;
  net.suggestion = {
    id: S,
    entity_id: KEY,
    field_key: "effects",
    suggested_value: "relaxed, happy",
    status: "pending",
    confidence: 0.9,
    source: "model:batch-lookup",
    created_at: AT,
  };
  net.memory = null;
  net.attachInput = null;
  net.attach = okReceipt("effects");
  net.reviewed = [];
  net.audits = [];
  net.reads = 0;
});

// === A. Pure cores ================================================================
describe("R23 A. pure cores", () => {
  it("waiting-facts-core self-tests: exact count, registered at that floor", () => {
    const r = __runWaitingFactsCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBe(72);
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("waiting-facts-core", __runWaitingFactsCoreTests(), 72);');
  });
  it("approved-row-core self-tests: exact count, registered at that floor", () => {
    const r = __runApprovedRowCoreTests();
    expect(r.failed).toBe(0);
    // R27 pin update (on purpose): 11 -> 15 - the truthful leads for a
    // product kept off the menu (withheld) or held for a fact check.
    expect(r.passed).toBe(15);
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("approved-row-core", __runApprovedRowCoreTests(), 15);');
  });
  it("only THIS product's pending facts show, minus what a person already answered", () => {
    const rows: WaitingSuggestionRow[] = [
      { id: "a", entity_id: KEY, field_key: "effects", suggested_value: "relaxed", status: "pending", confidence: 0.9, created_at: AT },
      { id: "b", entity_id: "OTHER", field_key: "effects", suggested_value: "sleepy", status: "pending", confidence: 0.9, created_at: AT },
      { id: "c", entity_id: KEY, field_key: "description", suggested_value: "Smooth.", status: "accepted", confidence: 0.9, created_at: AT },
      { id: "d", entity_id: KEY, field_key: "sensory", suggested_value: JSON.stringify({ aroma_notes: ["pine"], flavor_notes: ["citrus"] }), status: "pending", confidence: 0.8, created_at: AT },
    ];
    const v = buildWaitingFacts({ suggestionKey: KEY, suggestions: rows, memory: null, attached: { flavor: humanFact(["lime"]) } });
    expect(v.facts.map((f) => `${f.field}:${f.suggestionId}`).sort()).toEqual(["aroma:d", "effects:a"]);
    expect(v.answered).toEqual(["flavor"]);
    expect(v.emptyLine).toBeNull();
    const none = buildWaitingFacts({ suggestionKey: null, suggestions: rows, memory: null, attached: null });
    expect(none.facts).toEqual([]);
    expect(none.emptyLine).toBe(WAITING_EMPTY_COPY);
  });
  it("suggestionClosable: sensory closes only when EVERY part is a person's answer with the same value; prose never", () => {
    const sens = { field_key: "sensory", suggested_value: JSON.stringify({ aroma_notes: ["pine"], flavor_notes: ["citrus"] }) };
    expect(suggestionClosable(sens, { aroma: humanFact(["pine"]) })).toBe(false);
    expect(suggestionClosable(sens, { aroma: humanFact(["pine"]), flavor: humanFact(["citrus"]) })).toBe(true);
    expect(suggestionClosable(sens, { aroma: humanFact(["pine"]), flavor: { ...humanFact(["citrus"]), source: "gemini" as const } })).toBe(false);
    expect(suggestionClosable({ field_key: "description", suggested_value: "Smooth." }, { description: humanFact("Smooth.") })).toBe(false);
  });
  it("the batch row line now points at the row, not Product Enrichment", () => {
    const line = itemRowCopy({ status: "done", error: null, result: { outcome: "review", attached: 0, queued: 2 } } as unknown as Parameters<typeof itemRowCopy>[0]);
    expect(line).toBe("Batch lookup: 2 facts waiting for you - attach them below");
    expect(line).not.toContain("Product Enrichment");
  });
  it("approved banner link: the Approved tab, pinned to the product; a forged id gives no link", () => {
    const href = approvedBannerLink(D, M)!;
    expect(href).toContain("status=approved");
    expect(href).toContain(`draft=${D}`);
    expect(href).toContain(`manifest=${M}`);
    expect(approvedBannerLink("not-a-uuid", M)).toBeNull();
    expect(approvedBannerLink("javascript:alert(1)", M)).toBeNull();
    expect(approvedRowCopy({ priceMinorUnits: 2500, categoryLabel: "Flower", strainLabel: null, houseType: null }).lines).toEqual([
      ["Price", "$25.00"],
      ["Category", "Flower"],
    ]);
  });
  it("result banner: closed code vocabulary, message capped", () => {
    expect(waitingResultBanner("attached", "x")).toEqual({ tone: "ok", text: "x" });
    expect(waitingResultBanner("error", "")?.tone).toBe("error");
    expect(waitingResultBanner("<script>", "x")).toBeNull();
    expect(waitingResultBanner("skipped", "a".repeat(999))?.text.length).toBe(300);
  });
});

// === B. The real server action ====================================================
describe("R23 B. attachWaitingFactAction", () => {
  it("re-reads the suggestion on the server, gates it, and calls the door as a PERSON's confirmation", async () => {
    await expect(attachWaitingFactAction(form())).rejects.toThrow("NEXT_REDIRECT");
    expect(net.calls[0]).toBe("perm:inventory.manage");
    expect(net.attachInput).not.toBeNull();
    expect(net.attachInput!.confirmedBy).toBe("human");
    expect(net.attachInput!.context).toEqual({ kind: "draft", draftId: D });
    expect(net.attachInput!.suggestionSource).toBe("human:onboarding-attach");
    const safe = net.attachInput!.safe as { effects: string[]; description: string; aromaNotes: string[] };
    expect(safe.effects).toEqual(["relaxed", "happy"]);
    expect(safe.description).toBe("");
    expect(safe.aromaNotes).toEqual([]);
    expect(params().get("wf")).toBe("attached");
    expect(params().get("draft")).toBe(D);
    expect(params().get("manifest")).toBe(M);
    expect(net.calls).toContain("revalidate:/admin/inventory/drafts");
    expect(net.audits.at(-1)).toMatchObject({ action: "catalog_draft.waiting_fact_attach", entityId: D });
  });

  it("the browser cannot smuggle a value: a posted 'value' is ignored, the server's suggestion text is used", async () => {
    await expect(attachWaitingFactAction(form({ value: "cures cancer" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(JSON.stringify(net.attachInput!.safe)).not.toContain("cures");
  });

  it("a suggestion filed on ANOTHER product is refused before the door", async () => {
    net.suggestion = { ...net.suggestion!, entity_id: "OTHER-KEY" };
    await expect(attachWaitingFactAction(form())).rejects.toThrow("NEXT_REDIRECT");
    expect(net.attachInput).toBeNull();
    expect(params().get("wf")).toBe("error");
    expect(params().get("wf_msg")).toBe(PICK_OTHER_PRODUCT);
  });

  it("a suggestion already reviewed is refused (no double attach)", async () => {
    net.suggestion = { ...net.suggestion!, status: "accepted" };
    await expect(attachWaitingFactAction(form())).rejects.toThrow("NEXT_REDIRECT");
    expect(net.attachInput).toBeNull();
    expect(params().get("wf_msg")).toBe(PICK_GONE);
  });

  it("an unknown field is refused before any read", async () => {
    await expect(attachWaitingFactAction(form({ field: "strain_type" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(net.reads).toBe(0);
    expect(net.attachInput).toBeNull();
    expect(params().get("wf_msg")).toBe(PICK_BAD_FIELD);
  });

  it("a dismissed product attaches nothing", async () => {
    net.draft = { status: "dismissed", key: KEY, row: { id: D } };
    await expect(attachWaitingFactAction(form())).rejects.toThrow("NEXT_REDIRECT");
    expect(net.attachInput).toBeNull();
    expect(params().get("wf")).toBe("error");
  });

  it("a value that fails the compliance gate is skipped, never sent to the door", async () => {
    net.suggestion = { ...net.suggestion!, field_key: "description", suggested_value: "A miracle strain." };
    await expect(attachWaitingFactAction(form({ field: "description" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(net.attachInput).toBeNull();
    expect(params().get("wf")).toBe("skipped");
  });

  it("an effects suggestion fully attached by a person is closed (accepted); a partial sensory one is not", async () => {
    net.draftAfter = { status: "draft", key: KEY, row: { id: D, attached_facts: { effects: humanFact(["relaxed", "happy"]) } } };
    await expect(attachWaitingFactAction(form())).rejects.toThrow("NEXT_REDIRECT");
    expect(net.reviewed).toEqual([[S, "accepted"]]);

    net.reads = 0;
    net.reviewed = [];
    net.suggestion = { ...net.suggestion!, field_key: "sensory", suggested_value: JSON.stringify({ aroma_notes: ["pine"], flavor_notes: ["citrus"] }) };
    net.attach = okReceipt("aroma");
    net.draftAfter = { status: "draft", key: KEY, row: { id: D, attached_facts: { aroma: humanFact(["pine"]) } } };
    await expect(attachWaitingFactAction(form({ field: "aroma" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(net.reviewed).toEqual([]);
  });

  it("a fact the door kept (not landed) reports skipped with the door's reason and closes nothing", async () => {
    net.attach = { ok: true, mode: "shadow", sentence: "Nothing attached.", notes: [], receipt: { attached: [], queued: [], skipped: [{ field: "effects", reason: "Kept the product record's own value." }] } };
    await expect(attachWaitingFactAction(form())).rejects.toThrow("NEXT_REDIRECT");
    expect(params().get("wf")).toBe("skipped");
    expect(params().get("wf_msg")).toBe("Kept the product record's own value.");
    expect(net.reviewed).toEqual([]);
  });

  it("memory origin: re-recalled on the server when KB-first is on; refused when off", async () => {
    const saved = process.env.KB_FIRST_ONBOARDING;
    try {
      process.env.KB_FIRST_ONBOARDING = "on";
      net.memory = { facts: [{ field: "aroma", value: ["pine", "earth"], source: "approved", at: AT }] };
      await expect(attachWaitingFactAction(form({ field: "aroma", origin: "memory", suggestion_id: "" }))).rejects.toThrow("NEXT_REDIRECT");
      expect((net.attachInput!.safe as { aromaNotes: string[] }).aromaNotes).toEqual(["pine", "earth"]);
      expect(net.reviewed).toEqual([]);

      net.attachInput = null;
      process.env.KB_FIRST_ONBOARDING = "off";
      await expect(attachWaitingFactAction(form({ field: "aroma", origin: "memory", suggestion_id: "" }))).rejects.toThrow("NEXT_REDIRECT");
      expect(net.attachInput).toBeNull();
      expect(params().get("wf")).toBe("error");
    } finally {
      if (saved === undefined) delete process.env.KB_FIRST_ONBOARDING;
      else process.env.KB_FIRST_ONBOARDING = saved;
    }
  });

  it("returns to the tab it came from (Approved rows stay on Approved)", async () => {
    net.draft = { status: "approved", key: KEY, row: { id: D } };
    await expect(attachWaitingFactAction(form({ return_status: "approved" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(params().get("status")).toBe("approved");
    expect(params().get("wf")).toBe("attached");
  });
});

// === C. Panel markup + page wiring ================================================
describe("R23 C. panel + page", () => {
  const view = buildWaitingFacts({
    suggestionKey: KEY,
    suggestions: [{ id: S, entity_id: KEY, field_key: "effects", suggested_value: "relaxed", status: "pending", confidence: 0.9, source: "model:batch-lookup", created_at: AT }],
    memory: null,
    attached: null,
  });
  const noop = async () => {};

  it("each fact is a plain form naming the fact only (no value field), with an Attach button", () => {
    const html = renderToStaticMarkup(createElement(WaitingFactsPanel, { draftId: D, view, action: noop, returnManifest: M, returnStatus: "draft" }));
    expect(html).toContain(WAITING_HEADING);
    expect(html.match(/data-testid="waiting-fact"/g)?.length).toBe(1);
    expect(html).toContain('data-field="effects"');
    expect(html).toContain('data-origin="suggestion"');
    for (const n of ["draft_id", "field", "origin", "suggestion_id", "return_manifest", "return_status"]) expect(html).toContain(`name="${n}"`);
    expect(html).not.toContain('name="value"');
    expect(html).toContain('data-testid="waiting-fact-attach"');
  });

  it("a failed read is never shown as 'nothing waiting'", () => {
    const empty = buildWaitingFacts({ suggestionKey: KEY, suggestions: [], memory: null, attached: null });
    const html = renderToStaticMarkup(createElement(WaitingFactsPanel, { draftId: D, view: empty, action: noop, returnManifest: null, returnStatus: "draft", readFailed: true }));
    expect(html).toContain('data-testid="waiting-facts-read-failed"');
    expect(html).not.toContain('data-testid="waiting-facts-empty"');
  });

  const page = read("src/app/admin/inventory/drafts/page.tsx");
  it("the page mounts the panel inside the row's AI card (lookupPanel), once", () => {
    const lp = page.slice(page.indexOf("const lookupPanel = ("), page.indexOf("<AiLookupPanel"));
    expect(lp).toContain("<WaitingFactsPanel");
    expect(lp).toContain("action={attachWaitingFactAction}");
    expect(lp).toContain("readFailed={!waitingRead.ok}");
    expect(page.match(/<WaitingFactsPanel/g)?.length).toBe(1);
    expect(page.match(/<AiLookupPanel/g)?.length).toBe(1);
  });

  it("the page reads pending suggestions ONCE for every row on the page", () => {
    expect(page.match(/loadWaitingSuggestions\(/g)?.length).toBe(1);
    expect(page).toContain("waitingKeyForDraft(d)");
  });

  it("Approved rows get the same toggle testid the CSS keys on, and the detail row with the read-only summary zone", () => {
    const approvedBranch = page.slice(page.indexOf('{view !== "draft" && ('), page.indexOf("<OnboardingDetailRow"));
    expect(approvedBranch).toContain('{v2Row && view === "approved" && (');
    expect(approvedBranch).toContain('data-testid="draft-row-details"');
    expect(approvedBranch).toContain("{APPROVED_TOGGLE_OPEN}");
    expect(page).toContain('approve={view === "approved" ? approvedZone : approveForm}');
    expect(page).toContain('data-testid="approved-zone"');
    const css = read("src/app/globals.css");
    expect(css).toContain('tr:has(details[data-testid="draft-row-details"][open]) + tr.draft-detail-row');
  });

  it("the Approved banner links to the product (validated UUID only)", () => {
    expect(page).toContain("approvedBannerLink(sp.approved_draft, focus.manifestId)");
    expect(page).toContain('data-testid="approved-banner-link"');
    expect(page).toContain("{APPROVED_BANNER_LINK_TEXT}");
    expect(APPROVED_BANNER_LINK_TEXT).toBe("Open it on the Approved tab");
    const actions = read("src/app/admin/inventory/drafts/actions.ts");
    expect(actions).toContain('redirect(backTo(formData, { approved: "1", approved_draft: draftId }));');
  });

  it("the action is permission-gated and never trusts a posted value", () => {
    const src = read("src/app/admin/inventory/drafts/ai-lookup-actions.ts");
    const fn = src.slice(src.indexOf("export async function attachWaitingFactAction"));
    expect(fn).toContain('requirePermission("inventory.manage")');
    expect(fn).not.toMatch(/str\(formData, "value"\)/);
    expect(fn).toContain('confirmedBy: "human"');
    expect(fn).toContain("unstable_rethrow(err)");
  });
});
