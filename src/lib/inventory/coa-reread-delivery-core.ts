/**
 * R37 S4 - "Re-read this delivery's lab certificates with LlamaParse" on
 * Product Onboarding, in the AI section at the top of the page.
 *
 * Owner: "add a button that allows me to rerun llama parse on the onboarding
 * page to re read the COA's. I want this button at the top of the page with
 * the ai look up section."
 *
 * The press reads EVERY certificate of the delivery again (forced - already
 * read ones too), always asking LlamaParse as well as the PDF's own text so
 * the best reading wins (the same path as the lot page's R28 re-read), then
 * marries the reads to the onboarding rows (R30 attach) and rebuilds the
 * delivery's menu update. This module is the PURE half: the outcome code,
 * the redirect params, and the banner (fixed wording; a crafted URL cannot
 * add words - only numbers are echoed, clamped).
 */
import type { CoaExtractRun } from "./coa-extract-core";

export const DELIVERY_COA_CODES = ["ok", "partial", "failed", "none", "unmigrated", "error"] as const;
export type DeliveryCoaCode = (typeof DELIVERY_COA_CODES)[number];

export const DELIVERY_COA_EVENT = "coa_reread_all";
export const DELIVERY_COA_AUDIT = "intake_manifest.coa_reread_all";

/** Most cautious outcome first - one failed read is never reported as "ok". */
export function deliveryCoaCode(run: CoaExtractRun, labCount: number): DeliveryCoaCode {
  if (!run.migrated) return "unmigrated";
  if (labCount === 0) return "none";
  if (run.read === 0) return "error";
  if (run.failed > 0) return "failed";
  if (run.partial > 0) return "partial";
  if (run.ok > 0) return "ok";
  return "error";
}

export type DeliveryCoaOutcome = {
  code: DeliveryCoaCode;
  labs: number;
  run: CoaExtractRun;
  factsAttached: number;
  restaged: boolean;
};

const clampInt = (n: unknown): number => {
  const v = typeof n === "number" ? n : Number(n);
  return Number.isFinite(v) && v >= 0 ? Math.min(Math.floor(v), 9999) : 0;
};

/** Query params for the redirect back to the delivery (numbers only). */
export function deliveryCoaParams(o: DeliveryCoaOutcome): Record<string, string> {
  const p: Record<string, string> = {
    coa_all: o.code,
    coa_n: String(clampInt(o.labs)),
    coa_read: String(clampInt(o.run.read)),
    coa_ok: String(clampInt(o.run.ok)),
    coa_partial: String(clampInt(o.run.partial)),
    coa_failed: String(clampInt(o.run.failed)),
    coa_facts: String(clampInt(o.factsAttached)),
  };
  if (o.run.deferred > 0) p.coa_more = String(clampInt(o.run.deferred));
  if (o.restaged) p.restaged = "1";
  return p;
}

export type DeliveryCoaBanner = { tone: "ok" | "warn" | "bad"; text: string };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The banner for ?coa_all=...; unknown codes render nothing. */
export function deliveryCoaBanner(sp: Record<string, unknown>): DeliveryCoaBanner | null {
  const code = typeof sp.coa_all === "string" && (DELIVERY_COA_CODES as readonly string[]).includes(sp.coa_all) ? (sp.coa_all as DeliveryCoaCode) : null;
  if (!code) return null;
  const n = clampInt(sp.coa_n);
  const read = clampInt(sp.coa_read);
  const ok = clampInt(sp.coa_ok);
  const partial = clampInt(sp.coa_partial);
  const failed = clampInt(sp.coa_failed);
  const facts = clampInt(sp.coa_facts);
  const more = clampInt(sp.coa_more);
  const restaged = sp.restaged === "1";
  if (code === "unmigrated") return { tone: "bad", text: "Lab certificates cannot be read yet: the database is missing migration 0252 (lab certificate reading)." };
  if (code === "none") return { tone: "warn", text: "No product on this delivery has a lab result attached, so there was no certificate to read." };
  if (code === "error") return { tone: "bad", text: "Reading the lab certificates failed. Try again in a minute." };
  const parts: string[] = [];
  parts.push(`Read ${read} of ${plural(n, "lab certificate", "lab certificates")} again with LlamaParse:`);
  const counts = [ok ? `${ok} fully` : null, partial ? `${partial} partly` : null, failed ? `${failed} could not be read` : null].filter(Boolean);
  parts.push(counts.length ? counts.join(", ") + "." : "nothing came back.");
  if (facts > 0) parts.push(`${plural(facts, "fact was", "facts were")} filled in on the products below.`);
  else parts.push("No new facts - the products already had everything the certificates say.");
  if (restaged) parts.push("The delivery's menu update was rebuilt with what they say.");
  if (more > 0) parts.push(`${more} more did not fit in this press - press again to read them.`);
  if (failed > 0) parts.push("The reasons are on each product's lab certificate panel.");
  return { tone: code === "ok" ? "ok" : code === "partial" ? "warn" : "bad", text: parts.join(" ") };
}

/** The line under the button (never claims LlamaParse when it is not set up). */
export function deliveryCoaHelp(llamaOn: boolean): string {
  return llamaOn
    ? "Reads every lab certificate on this delivery again - the PDF's own text and LlamaParse - keeps the best reading, fills empty facts on the products below and rebuilds the menu update. Facts you set by hand are never replaced."
    : "LlamaParse is not set up (LLAMA_CLOUD_API_KEY), so the certificates are read again from their own text only. Facts you set by hand are never replaced.";
}

export const DELIVERY_COA_BUTTON = "Re-read lab certificates (LlamaParse)";

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runCoaRereadDeliveryTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.log("  FAIL coa-reread-delivery-core: " + m);
    }
  };
  const run = (o: Partial<CoaExtractRun>): CoaExtractRun => ({ migrated: true, pending: 0, deferred: 0, read: 0, ok: 0, partial: 0, failed: 0, kbFilled: 0, errors: [], ...o });
  ok(deliveryCoaCode(run({ migrated: false }), 5) === "unmigrated", "unmigrated first");
  ok(deliveryCoaCode(run({}), 0) === "none", "no labs -> none");
  ok(deliveryCoaCode(run({ read: 0 }), 3) === "error", "labs but nothing read -> error");
  ok(deliveryCoaCode(run({ read: 3, ok: 2, failed: 1 }), 3) === "failed", "one failure beats ok");
  ok(deliveryCoaCode(run({ read: 3, ok: 2, partial: 1 }), 3) === "partial", "partial beats ok");
  ok(deliveryCoaCode(run({ read: 3, ok: 3 }), 3) === "ok", "all ok");
  const p = deliveryCoaParams({ code: "partial", labs: 4, run: run({ read: 3, ok: 2, partial: 1, deferred: 1 }), factsAttached: 7, restaged: true });
  ok(p.coa_all === "partial" && p.coa_n === "4" && p.coa_read === "3" && p.coa_facts === "7" && p.coa_more === "1" && p.restaged === "1", "params");
  ok(!("coa_more" in deliveryCoaParams({ code: "ok", labs: 1, run: run({ read: 1, ok: 1 }), factsAttached: 0, restaged: false })), "no deferred -> no coa_more");
  const b = deliveryCoaBanner(p);
  ok(b !== null && b.tone === "warn", "partial -> warn");
  ok(b!.text.startsWith("Read 3 of 4 lab certificates again with LlamaParse: 2 fully, 1 partly."), `banner counts: ${b!.text}`);
  ok(b!.text.includes("7 facts were filled in") && b!.text.includes("menu update was rebuilt") && b!.text.includes("1 more did not fit"), "banner facts / rebuild / more");
  const one = deliveryCoaBanner({ coa_all: "ok", coa_n: "1", coa_read: "1", coa_ok: "1", coa_facts: "1" });
  ok(one!.tone === "ok" && one!.text.includes("Read 1 of 1 lab certificate again") && one!.text.includes("1 fact was filled"), "singulars");
  const none = deliveryCoaBanner({ coa_all: "ok", coa_n: "2", coa_read: "2", coa_ok: "2", coa_facts: "0" });
  ok(none!.text.includes("No new facts") && !none!.text.includes("rebuilt"), "no facts, no rebuild claim");
  const bad = deliveryCoaBanner({ coa_all: "failed", coa_n: "2", coa_read: "2", coa_ok: "1", coa_failed: "1" });
  ok(bad!.tone === "bad" && bad!.text.includes("1 could not be read") && bad!.text.includes("reasons are on each product"), "failed");
  ok(deliveryCoaBanner({ coa_all: "<script>" }) === null && deliveryCoaBanner({}) === null, "unknown code -> nothing");
  const crafted = deliveryCoaBanner({ coa_all: "ok", coa_n: "hello world", coa_read: "-5", coa_ok: "1e9" });
  ok(crafted!.text.includes("Read 0 of 0") && !crafted!.text.includes("hello") && crafted!.text.includes("9999 fully"), "crafted numbers clamped, words dropped");
  ok(deliveryCoaBanner({ coa_all: "none" })!.text.includes("no certificate to read"), "none copy");
  ok(deliveryCoaBanner({ coa_all: "unmigrated" })!.text.includes("0252"), "unmigrated copy");
  ok(deliveryCoaBanner({ coa_all: "error" })!.tone === "bad", "error copy");
  ok(deliveryCoaHelp(true).includes("LlamaParse") && deliveryCoaHelp(true).includes("never replaced"), "help on");
  ok(deliveryCoaHelp(false).includes("not set up") && deliveryCoaHelp(false).includes("LLAMA_CLOUD_API_KEY"), "help off is honest");
  return { passed, failed };
}
