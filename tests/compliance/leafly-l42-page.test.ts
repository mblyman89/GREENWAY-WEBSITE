/**
 * SLICE L-42 -- the Leafly page, reorganised, with one simple POST.
 *
 * The owner asked for four things, each pinned here:
 *
 *   1. "Remove the AI drafter."
 *   2. "Remove the drop down menu to select POST or PUT and remove the push
 *      post and push put buttons since they throw errors when pressed."
 *   3. "per leaflys docs, we have to prove we can successfully complete every
 *      action. So we will need to have a successful push post ... Unless the
 *      auto sync does a push post command" -- it only does when nothing is
 *      held back (auto-sync-core A1), so a simple POST button must exist.
 *   4. "Explain what PUT means."
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { planReplaceMenu, __runLeaflyReplaceMenuTests } from "@/lib/leafly/replace-menu-core";
import { planAutomaticTransmission } from "@/lib/leafly/auto-sync-core";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const DIR = "src/app/admin/integrations/leafly";
const CLIENT = `${DIR}/leafly-client.tsx`;
const PANEL = `${DIR}/replace-menu-panel.tsx`;
const ACTIONS = `${DIR}/actions.ts`;
const SERVER = "src/lib/leafly/replace-menu-server.ts";

describe("ask 1: the Leafly AI drafter is gone", () => {
  it("no drafter component, action or library remains on the Leafly page", () => {
    expect(code(CLIENT)).not.toMatch(/DescriptionDrafter/);
    expect(code(ACTIONS)).not.toMatch(/draftLeaflyDescription/);
    expect(existsSync(join(ROOT, "src/lib/leafly/ai.ts"))).toBe(false);
  });
});

describe("ask 2: no method dropdown, no all-or-nothing push button", () => {
  it("the client has no method select and no pushLeaflyAction", () => {
    const c = code(CLIENT);
    expect(c).not.toMatch(/leafly-method/);
    expect(c).not.toMatch(/<Select\b/);
    expect(c).not.toMatch(/pushLeaflyAction/);
    expect(c).not.toMatch(/Push \{method\}/);
  });
  it("the old action no longer exists on the server", () => {
    expect(code(ACTIONS)).not.toMatch(/export async function pushLeaflyAction\b/);
    expect(code(ACTIONS)).not.toMatch(/\bpushLeaflyMenu\s*\(/);
  });
  it("the read-only checks are kept", () => {
    const c = read(CLIENT);
    expect(c).toContain("Check integration status");
    expect(c).toContain("Read the menu back from Leafly and check it");
    expect(c).toContain("fetchLeaflyStatusAction");
    expect(c).toContain("fetchLeaflyMenuReadbackAction");
  });
});

describe("ask 3: there is a simple, working POST", () => {
  it("automation alone cannot prove POST when anything is held back (why the button exists)", () => {
    const common = {
      kind: "daily_full" as const,
      planProceeds: true,
      planNarrative: "",
      send: [
        { id: "a", hash: "1-changed" },
        { id: "b", hash: "2" },
      ],
      previous: new Map([
        ["a", "1"],
        ["b", "2"],
        ["c", "3"],
      ]),
      forceResend: false,
    };
    // Something held back -> the daily run is downgraded away from POST.
    const held = planAutomaticTransmission({ ...common, withheldIds: ["c"] });
    expect(held.action).not.toBe("post");
    expect(held.postIds).toEqual([]);
    expect(held.postDowngraded).toBe(true);
    // Nothing held back -> the daily run does POST (control).
    const clean = planAutomaticTransmission({ ...common, withheldIds: [] });
    expect(clean.action).toBe("post");
    expect(clean.postIds.length).toBeGreaterThan(0);
  });

  it("the panel is mounted on the page and calls the POST action", () => {
    expect(code(CLIENT)).toMatch(/<ReplaceMenuPanel\b/);
    const p = code(PANEL);
    expect(p).toMatch(/replaceLeaflyMenuAction\(/);
    expect(p).toMatch(/previewReplaceLeaflyMenuAction\(/);
    expect(read(PANEL)).toContain("Replace my whole Leafly menu (POST)");
  });

  it("the action is gated, confirmed, and recorded as a POST run", () => {
    const a = code(ACTIONS);
    const fn = /export async function replaceLeaflyMenuAction\([\s\S]*?\n}\n/.exec(a);
    expect(fn).not.toBeNull();
    const body = fn![0];
    expect(body).toContain('requirePermission("settings.manage")');
    expect(body).toContain("await requireLeaflyReady()");
    expect(body).toMatch(/if \(!input\?\.confirm\)/);
    expect(body).toContain("beginManualRun");
    expect(body).toMatch(/method: "POST"/);
    expect(body).toContain("recordSyndicationLog");
    expect(body).toContain("recordAudit");
  });

  it("the server sends POST through the shared transport, not a private fetch", () => {
    const s = code(SERVER);
    expect(s).toMatch(/sendLeaflyMenuRequest\(\{\s*method: "POST"/);
    expect(s).not.toMatch(/leaflyFetchWithDeadline/);
    expect(s).not.toMatch(/\bfetch\(/);
    expect(s).toContain("planReplaceMenu(");
  });

  it("the panel asks for the held-back count, not a bare yes", () => {
    const p = code(PANEL);
    expect(p).toMatch(/acknowledgedWithheldCount:\s*heldCount === 0 \? 0 : acknowledged \? heldCount : null/);
  });

  it("the plan refuses a stale acknowledgement and never posts an empty menu", () => {
    const base = {
      planProceeds: true,
      planNarrative: "",
      sendIds: ["a"],
      withheldIds: ["b", "c"],
      previousIds: ["a", "b"],
      confirm: true,
    };
    expect(planReplaceMenu({ ...base, acknowledgedWithheldCount: 1 }).proceed).toBe(false);
    expect(planReplaceMenu({ ...base, acknowledgedWithheldCount: 2 }).proceed).toBe(true);
    expect(
      planReplaceMenu({ ...base, sendIds: [], acknowledgedWithheldCount: 2 }).proceed,
    ).toBe(false);
    expect(__runLeaflyReplaceMenuTests().failed).toBe(0);
  });
});

describe("ask 4: every verb is explained, and every tool has one home", () => {
  it("the guide names all four actions in plain English", () => {
    const c = read(CLIENT);
    expect(c).toContain("What each kind of send does");
    expect(c).toMatch(/verb: "PUT",\s*plain: "Adds new products and updates existing ones\. Never deletes anything\."/);
    expect(c).toMatch(/verb: "POST",\s*plain: "Replaces the whole menu\./);
    expect(c).toMatch(/verb: "DELETE"/);
    expect(c).toMatch(/verb: "GET"/);
  });
  it("order: checks + whole-menu PUT, then POST, then removals", () => {
    const c = code(CLIENT);
    const full = c.indexOf("<FullMenuPanel");
    const post = c.indexOf("<ReplaceMenuPanel");
    const browser = c.indexOf("<LeaflyMenuBrowser");
    const del = c.indexOf("<DeleteFromLeafly");
    expect(full).toBeGreaterThan(-1);
    expect(full).toBeLessThan(post);
    expect(post).toBeLessThan(browser);
    expect(browser).toBeLessThan(del);
  });
  it("no copy still points at the removed 'Live push to Leafly' card", () => {
    for (const f of [
      "src/components/admin/syndication/LeaflySchedulePanel.tsx",
      "src/components/admin/syndication/SyncSettingsPanel.tsx",
      `${DIR}/page.tsx`,
    ]) {
      expect(read(f)).not.toContain("Live push to Leafly");
      expect(read(f)).not.toContain("dropdown on the push card");
    }
  });
});
