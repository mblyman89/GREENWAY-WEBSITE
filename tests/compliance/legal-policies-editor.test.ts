/**
 * SLICE 105b — Legal Policies editor (Privacy · Terms · Consumer Health Data).
 *
 * Michael: edit the privacy policy, terms of use, and consumer health data
 * pages and text — all elements editable in an intelligent way. Make a page
 * called "Legal Policies". Do it safely — don't break anything.
 *
 * Pins:
 *   - policy-doc-core pure logic (heading rule, serialize/parse, fallback),
 *   - the 3 new "richdoc" body blocks seeded BYTE-IDENTICAL to the hardcoded
 *     paragraph arrays (so the public pages don't change until edited),
 *   - the render fallback can never blank a page (malformed/empty -> hardcoded),
 *   - the public pages render from getPolicyRowsForRender with the fallback,
 *   - the new "richdoc" field type + Legal Policies editor/nav are wired,
 *   - publish revalidates the right legal route (PAGE_TO_PATH + legal actions).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { CONTENT_BLOCK_SEEDS } from "@/lib/cms/content-blocks-seed";
import {
  POLICY_DOCS,
  POLICY_DOC_KEYS,
  __runPolicyDocCoreTests,
  isPolicyHeading,
  isPolicyDocBlock,
  parsePolicyDoc,
  resolvePolicyRows,
  rowsFromParagraphs,
  serializePolicyDoc,
} from "@/lib/cms/policy-doc-core";
import { privacyPolicyParagraphs } from "@/content/privacy-policy";
import { termsOfUseParagraphs } from "@/content/terms-of-use";
import { consumerHealthDataParagraphs } from "@/content/consumer-health-data";

const read = (p: string) => readFileSync(p, "utf8");

describe("policy-doc-core", () => {
  it("passes its full self-test suite", () => {
    const { passed } = __runPolicyDocCoreTests();
    expect(passed).toBeGreaterThan(20);
  });

  it("heading rule matches the exact patterns the pages used", () => {
    expect(isPolicyHeading("I. Information We Collect")).toBe(true);
    expect(isPolicyHeading("1. Foo")).toBe(true);
    expect(isPolicyHeading("a. Bar")).toBe(true);
    expect(isPolicyHeading("IX. Contact Us")).toBe(true);
    expect(isPolicyHeading("Effective Date: June 20, 2026")).toBe(false);
  });

  it("serialize -> parse round-trips and rejects bad input", () => {
    const rows = rowsFromParagraphs(["A", "1. B"], "privacy.body.doc");
    const back = parsePolicyDoc(serializePolicyDoc(rows));
    expect(back).not.toBeNull();
    expect(back!.length).toBe(2);
    expect(parsePolicyDoc("garbage")).toBeNull();
    expect(parsePolicyDoc('[{"id":"x","kind":"bad","text":"y"}]')).toBeNull();
  });

  it("resolvePolicyRows never blanks a page (empty/malformed -> fallback)", () => {
    const fb = ["A", "1. B", "C"];
    expect(resolvePolicyRows(null, fb, "k").length).toBe(3);
    expect(resolvePolicyRows("[]", fb, "k").length).toBe(3);
    expect(resolvePolicyRows("nope", fb, "k").length).toBe(3);
  });

  it("registry has the three documents", () => {
    expect(POLICY_DOC_KEYS).toEqual([
      "privacy.body.doc",
      "terms.body.doc",
      "chd.body.doc",
    ]);
    expect(isPolicyDocBlock("privacy.body.doc")).toBe(true);
    expect(isPolicyDocBlock("home.hero.title")).toBe(false);
    expect(POLICY_DOCS["consumer-health-data"].heroBlockKeys).toHaveLength(2);
  });
});

describe("seed blocks are byte-identical to the hardcoded bodies", () => {
  const cases: [keyof typeof POLICY_DOCS, readonly string[]][] = [
    ["privacy-policy", privacyPolicyParagraphs],
    ["terms-of-use", termsOfUseParagraphs],
    ["consumer-health-data", consumerHealthDataParagraphs],
  ];

  it.each(cases)("%s seed round-trips to the original paragraphs", (policyId, arr) => {
    const docKey = POLICY_DOCS[policyId].docKey;
    const seed = CONTENT_BLOCK_SEEDS.find((s) => s.block_key === docKey);
    expect(seed).toBeTruthy();
    expect(seed!.field_type).toBe("richdoc");
    const parsed = parsePolicyDoc(seed!.defaultValue);
    expect(parsed).not.toBeNull();
    expect(parsed!.map((r) => r.text)).toEqual([...arr]);
  });

  it("privacy=63, terms=81, chd=49 rows (verified counts)", () => {
    expect(privacyPolicyParagraphs.length).toBe(63);
    expect(termsOfUseParagraphs.length).toBe(81);
    expect(consumerHealthDataParagraphs.length).toBe(49);
  });
});

describe("public pages render from the editable document", () => {
  const pages = [
    ["src/app/privacy-policy/page.tsx", "privacy-policy"],
    ["src/app/terms-of-use/page.tsx", "terms-of-use"],
    ["src/app/consumer-health-data/page.tsx", "consumer-health-data"],
  ] as const;

  it.each(pages)("%s uses getPolicyRowsForRender with fallback", (path, policyId) => {
    const src = read(path);
    expect(src).toContain("getPolicyRowsForRender");
    expect(src).toContain("POLICY_DOCS");
    // still uses the cross-reference linkifier for paragraphs
    expect(src).toContain("renderPolicyParagraph");
    // async server component
    expect(src).toContain("export default async function");
    // renders heading vs paragraph by the row kind
    expect(src).toContain('row.kind === "heading"');
    expect(src).toContain(`"${policyId}"`);
  });
});

describe("field type + render helper wiring", () => {
  it('types.ts adds the "richdoc" field type', () => {
    expect(read("src/lib/cms/types.ts")).toContain('"richdoc"');
  });
  it("render-content exposes getPolicyRowsForRender (draft-aware + fallback)", () => {
    const src = read("src/lib/cms/render-content.ts");
    expect(src).toContain("getPolicyRowsForRender");
    expect(src).toContain("resolvePolicyRows");
  });
  it("pure runner registers policy-doc-core", () => {
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain(
      "__runPolicyDocCoreTests",
    );
  });
});

describe("Legal Policies editor + nav + revalidation", () => {
  it("editor page has three tabs, gated, seeds lazily", () => {
    const src = read("src/app/admin/legal-policies/page.tsx");
    expect(src).toContain('requirePermission("content.edit")');
    expect(src).toContain("PolicyDocEditor");
    expect(src).toContain("ensureContentBlocksSeeded");
    expect(src).toContain("privacy-policy");
    expect(src).toContain("terms-of-use");
    expect(src).toContain("consumer-health-data");
  });

  it("PolicyDocEditor is a client row editor with reorder/add/remove + caution", () => {
    const src = read("src/components/admin/PolicyDocEditor.tsx");
    expect(src).toContain('"use client"');
    expect(src).toContain("serializePolicyDoc");
    expect(src).toContain("moveRow");
    expect(src).toContain("removeRow");
    expect(src).toContain("addRow");
    expect(src).toContain("legal wording");
    expect(src).toContain("Publish");
  });

  it("legal actions reuse the content-block store and revalidate the right route", () => {
    const src = read("src/app/admin/legal-policies/actions.ts");
    expect(src).toContain("saveContentDraft");
    expect(src).toContain("publishContentBlock");
    expect(src).toContain("restoreContentRevisionToDraft");
    expect(src).toContain("/privacy-policy");
    expect(src).toContain("/terms-of-use");
    expect(src).toContain("/consumer-health-data");
  });

  it("PAGE_TO_PATH maps the legal pages (publish revalidates public route)", () => {
    const src = read("src/app/admin/content/actions.ts");
    expect(src).toContain('"legal-privacy": "/privacy-policy"');
    expect(src).toContain('"legal-terms": "/terms-of-use"');
    expect(src).toContain('"legal-chd": "/consumer-health-data"');
  });

  it("nav has the Legal Policies item under Website", () => {
    const src = read("src/components/admin/admin-nav-data.ts");
    expect(src).toContain('href: "/admin/legal-policies"');
    expect(src).toContain('label: "Legal Policies"');
  });
});
