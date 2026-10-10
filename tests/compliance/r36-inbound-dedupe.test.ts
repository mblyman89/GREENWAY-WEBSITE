/**
 * tests/compliance/r36-inbound-dedupe.test.ts  (R36 #2)
 *
 * The owner: "two identical rows appeared in the receiving table, one broke,
 * the other not ... the broken one was assigned the correct invoice number,
 * and the not broken one was not ... maybe we need a smarter receiving table
 * that immediately sifts out the duplicates instead of marking them rejected,
 * or give me a manual button to dismiss a duplicate rather than rejecting it."
 *
 * Root cause (sourced): Resend delivers through Svix; an attempt not answered
 * 2xx in time is retried with the SAME svix-id while our first run is still
 * inside LlamaParse, and staging was read-then-insert.
 *
 * Layers pinned here:
 *   1. delivery claim  (deliveryKey / decideClaim / claimResponse + route wiring)
 *   2. atomic manifest key (dedupeKeyFor / isDedupeKeyConflict + oldest twin)
 *   3. Dismiss duplicate (findDuplicateTwins / checkDismiss / describeDismissResult
 *      + dismissed stage hidden from both table views + action/page wiring)
 * The SQL function itself is tested against real Postgres by
 * scripts/r36/dismiss-duplicate.selftest.sql (+ 18-mutation harness).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  CLAIM_STALE_MS,
  DISMISSABLE_STATUSES,
  checkDismiss,
  claimResponse,
  decideClaim,
  deliveryKey,
  describeDismissResult,
  dismissErrorMessage,
  findDuplicateTwins,
  isDedupeKeyConflict,
  isDeliveryKeyConflict,
  isDismissableStatus,
  type TwinRow,
} from "@/lib/inventory/inbound-dedupe-core";
import {
  BLOCKING_STATUSES,
  buildManifestIdentity,
  dedupeKeyFor,
  findBlockingDuplicate,
  isBlockingStatus,
} from "@/lib/inventory/manifest-dedupe-core";
import {
  applyIntakeView,
  countProcessedRows,
  isDismissedManifest,
  isProcessedManifest,
  movingBadge,
} from "@/lib/inventory/manifest-table-core";
import {
  countStages,
  groupPipeline,
  isOpenStage,
  normalizeStage,
} from "@/lib/inventory/manifest-pipeline-core";

const read = (p: string) => readFileSync(p, "utf8");

// ── 1. Delivery claim ──────────────────────────────────────────────────────
describe("deliveryKey", () => {
  it("prefers the Resend email_id (same on Svix retry AND dashboard replay)", () => {
    expect(deliveryKey({ emailId: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c", svixId: "msg_2abc" })).toBe(
      "resend:email:4ef9a417-02e9-4d39-ad75-9611e0fcc33c",
    );
  });
  it("falls back to the svix-id when there is no email_id", () => {
    expect(deliveryKey({ emailId: null, svixId: "msg_2abc" })).toBe("svix:msg_2abc");
    expect(deliveryKey({ emailId: "   ", svixId: "msg_2abc" })).toBe("svix:msg_2abc");
  });
  it("trims, and the two namespaces never collide", () => {
    expect(deliveryKey({ emailId: "  e1 " })).toBe("resend:email:e1");
    expect(deliveryKey({ svixId: "e1" })).toBe("svix:e1");
    expect(deliveryKey({ emailId: "e1" })).not.toBe(deliveryKey({ svixId: "e1" }));
  });
  it("is null (claim skipped, old behaviour) with no usable id", () => {
    expect(deliveryKey({})).toBeNull();
    expect(deliveryKey({ emailId: null, svixId: null })).toBeNull();
    expect(deliveryKey({ emailId: "", svixId: "" })).toBeNull();
  });
  it("refuses hostile ids: spaces/control/non-ASCII inside, or over 200 chars", () => {
    expect(deliveryKey({ emailId: "a b" })).toBeNull();
    expect(deliveryKey({ emailId: "a\u0000b" })).toBeNull();
    expect(deliveryKey({ emailId: "caf\u00e9" })).toBeNull();
    expect(deliveryKey({ emailId: "x".repeat(200) })).toBe(`resend:email:${"x".repeat(200)}`);
    expect(deliveryKey({ emailId: "x".repeat(201) })).toBeNull();
    // a bad email_id still falls back to a good svix-id
    expect(deliveryKey({ emailId: "x".repeat(201), svixId: "msg_1" })).toBe("svix:msg_1");
  });
  it("ignores non-string inputs", () => {
    expect(deliveryKey({ emailId: 42 as unknown as string, svixId: {} as unknown as string })).toBeNull();
  });
});

describe("decideClaim", () => {
  const now = new Date("2026-05-01T12:00:00.000Z");
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

  it("a finished delivery (any final disposition) is done", () => {
    for (const d of ["staged", "duplicate", "parse_failed", "no_manifest", "ignored", " STAGED "]) {
      expect(decideClaim({ disposition: d, claimed_at: ago(1000) }, now).kind).toBe("done");
    }
  });
  it("an in-flight claim younger than the stale limit is in_flight", () => {
    const d = decideClaim({ disposition: "received", claimed_at: ago(14_000) }, now);
    expect(d).toEqual({ kind: "in_flight", ageMs: 14_000 });
    expect(decideClaim({ disposition: "received", claimed_at: ago(CLAIM_STALE_MS - 1) }, now).kind).toBe("in_flight");
  });
  it("exactly at the stale limit (and beyond) it is taken over", () => {
    expect(decideClaim({ disposition: "received", claimed_at: ago(CLAIM_STALE_MS) }, now)).toEqual({
      kind: "take_over",
      ageMs: CLAIM_STALE_MS,
    });
    expect(decideClaim({ disposition: "Received", claimed_at: ago(CLAIM_STALE_MS * 10) }, now).kind).toBe("take_over");
  });
  it("a released/undatable claim is taken over (never blocks the email forever)", () => {
    expect(decideClaim({ disposition: "received", claimed_at: null }, now).kind).toBe("take_over");
    expect(decideClaim({ disposition: "received", claimed_at: "not a date" }, now).kind).toBe("take_over");
    expect(decideClaim({ disposition: null, claimed_at: null }, now).kind).toBe("take_over");
  });
  it("a clock-skewed future claim counts as age 0 (in flight)", () => {
    expect(decideClaim({ disposition: "received", claimed_at: ago(-60_000) }, now)).toEqual({
      kind: "in_flight",
      ageMs: 0,
    });
  });
  it("the stale window outlives the route's maxDuration (300 s) - a slow healthy run is never doubled", () => {
    expect(CLAIM_STALE_MS).toBe(6 * 60 * 1000);
    expect(CLAIM_STALE_MS).toBeGreaterThan(300_000);
    // Svix retries at 5 s and 5 min both land inside the window.
    expect(decideClaim({ disposition: "received", claimed_at: ago(5_000) }, now).kind).toBe("in_flight");
    expect(decideClaim({ disposition: "received", claimed_at: ago(300_000) }, now).kind).toBe("in_flight");
    // The 30-minute retry finds a dead claim and takes it over.
    expect(decideClaim({ disposition: "received", claimed_at: ago(1_800_000) }, now).kind).toBe("take_over");
  });
  it("honours a custom stale limit", () => {
    expect(decideClaim({ disposition: "received", claimed_at: ago(10) }, now, 5).kind).toBe("take_over");
  });
});

describe("claimResponse", () => {
  it("done -> 200 (Svix stops retrying; nothing staged again)", () => {
    const r = claimResponse({ kind: "done" });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.duplicateDelivery).toBe(true);
  });
  it("in flight / take_over -> 409 (non-2xx, so Svix retries later)", () => {
    expect(claimResponse({ kind: "in_flight", ageMs: 1 }).status).toBe(409);
    expect(claimResponse({ kind: "take_over", ageMs: 1 }).status).toBe(409);
    expect(claimResponse({ kind: "in_flight", ageMs: 1 }).body.ok).toBe(false);
  });
});

describe("error classifiers are narrow", () => {
  it("dedupe-key conflict only on 23505 + that index/column", () => {
    expect(isDedupeKeyConflict({ code: "23505", message: 'duplicate key value violates unique constraint "inbound_manifests_dedupe_key_uidx"' })).toBe(true);
    expect(isDedupeKeyConflict({ code: "23505", message: "x", details: "Key (dedupe_key)=(A|B) already exists." })).toBe(true);
    expect(isDedupeKeyConflict({ code: "23505", message: 'violates "inbound_manifests_pkey"' })).toBe(false);
    expect(isDedupeKeyConflict({ code: "23503", message: "inbound_manifests_dedupe_key_uidx" })).toBe(false);
    expect(isDedupeKeyConflict(null)).toBe(false);
    expect(isDedupeKeyConflict(undefined)).toBe(false);
  });
  it("delivery-key conflict only on 23505 + that index/column", () => {
    expect(isDeliveryKeyConflict({ code: "23505", message: 'unique constraint "inbound_email_log_delivery_key_uidx"' })).toBe(true);
    expect(isDeliveryKeyConflict({ code: "23505", details: "Key (delivery_key)=(svix:1) already exists." })).toBe(true);
    expect(isDeliveryKeyConflict({ code: "23505", message: 'unique constraint "inbound_manifests_dedupe_key_uidx"' })).toBe(false);
    expect(isDeliveryKeyConflict({ code: "42703", message: "inbound_email_log_delivery_key_uidx" })).toBe(false);
  });
  it("the two never cross-match", () => {
    const a = { code: "23505", message: "inbound_manifests_dedupe_key_uidx" };
    const b = { code: "23505", message: "inbound_email_log_delivery_key_uidx" };
    expect(isDeliveryKeyConflict(a)).toBe(false);
    expect(isDedupeKeyConflict(b)).toBe(false);
  });
});

describe("dismissErrorMessage", () => {
  it("shows the SQL refusal in plain English", () => {
    expect(dismissErrorMessage({ code: "P0001", message: "DISMISS: this duplicate was already dismissed" })).toBe(
      "This duplicate was already dismissed.",
    );
    expect(dismissErrorMessage({ code: "P0001", message: "DISMISS: lots have history!" })).toBe("Lots have history!");
  });
  it("keeps a multi-line refusal intact", () => {
    expect(dismissErrorMessage({ message: "DISMISS: line one\nline two" })).toBe("Line one\nline two.");
  });
  it("names migration 0255 when the function is missing", () => {
    expect(dismissErrorMessage({ code: "PGRST202", message: "Could not find the function" })).toMatch(/0255/);
    expect(dismissErrorMessage({ code: "42883", message: "function does not exist" })).toMatch(/0255/);
    expect(dismissErrorMessage({ message: "function public.dismiss_duplicate_manifest does not exist" })).toMatch(/0255/);
  });
  it("never dresses an unexpected failure up as a refusal", () => {
    const m = dismissErrorMessage({ code: "57014", message: "canceling statement due to statement timeout" });
    expect(m).toMatch(/nothing was changed/);
    expect(m).toMatch(/statement timeout/);
    expect(dismissErrorMessage(null)).toMatch(/unknown error/);
    expect(dismissErrorMessage({ message: "x".repeat(500) }).length).toBeLessThan(320);
  });
});

// ── 2. Atomic manifest key + oldest twin ───────────────────────────────────
describe("manifest identity / dedupe key", () => {
  it("dedupeKeyFor is NUMBER|VENDOR, normalized, null without a number", () => {
    expect(dedupeKeyFor(buildManifestIdentity({ manifest_number: " wa-1 ", vendor_label: "Acme  Farms" }))).toBe("WA-1|ACME FARMS");
    expect(dedupeKeyFor(buildManifestIdentity({ manifest_number: "wa-1", vendor_label: null }))).toBe("WA-1|");
    expect(dedupeKeyFor(buildManifestIdentity({ manifest_number: "  ", vendor_label: "x" }))).toBeNull();
    expect(dedupeKeyFor(null)).toBeNull();
  });
  it("JS whitespace (NBSP, ideographic, BOM) collapses - the SQL twin matches (selftest pins it)", () => {
    expect(dedupeKeyFor(buildManifestIdentity({ manifest_number: "wa\u00a0123", vendor_label: "acme\u3000farms\ufeff" }))).toBe(
      "WA 123|ACME FARMS",
    );
  });
  it("received and partially_accepted now block a re-stage; rejected/dismissed do not", () => {
    expect([...BLOCKING_STATUSES]).toEqual(["pending", "in_transit", "received", "accepted", "partially_accepted"]);
    expect(isBlockingStatus("received")).toBe(true);
    expect(isBlockingStatus(" Partially_Accepted ")).toBe(true);
    expect(isBlockingStatus("rejected")).toBe(false);
    expect(isBlockingStatus("dismissed")).toBe(false);
  });
  it("the duplicate path targets the OLDEST live twin (deterministic - the invoice # bug)", () => {
    const id = buildManifestIdentity({ manifest_number: "WA-1", vendor_label: "Acme" })!;
    const rows = [
      { id: "b-new", manifest_number: "WA-1", vendor_label: "Acme", status: "pending", created_at: "2026-05-01T10:00:05Z" },
      { id: "a-old", manifest_number: "WA-1", vendor_label: "Acme", status: "pending", created_at: "2026-05-01T10:00:00Z" },
      { id: "z-rej", manifest_number: "WA-1", vendor_label: "Acme", status: "rejected", created_at: "2026-04-01T10:00:00Z" },
    ];
    expect(findBlockingDuplicate(id, rows)).toBe("a-old");
    expect(findBlockingDuplicate(id, [...rows].reverse())).toBe("a-old");
    // same timestamp -> id order, still deterministic
    const tie = rows.map((r) => ({ ...r, created_at: "2026-05-01T10:00:00Z" }));
    expect(findBlockingDuplicate(id, tie)).toBe("a-old");
    expect(findBlockingDuplicate(id, [...tie].reverse())).toBe("a-old");
  });
});

// ── 3. Twins + Dismiss ─────────────────────────────────────────────────────
const row = (id: string, status: string, created_at: string, num = "WA-1", vendor = "Acme"): TwinRow => ({
  id,
  manifest_number: num,
  vendor_label: vendor,
  status,
  created_at,
});

describe("findDuplicateTwins", () => {
  it("the owner's pair: EACH row offers Dismiss pointing at the other", () => {
    const m = findDuplicateTwins([row("healthy", "pending", "2026-05-01T10:00:00Z"), row("broken", "pending", "2026-05-01T10:00:06Z")]);
    expect(m.get("healthy")).toBe("broken");
    expect(m.get("broken")).toBe("healthy");
  });
  it("three twins: each points at the oldest live row other than itself", () => {
    const m = findDuplicateTwins([
      row("c", "pending", "2026-05-01T10:00:10Z"),
      row("a", "pending", "2026-05-01T10:00:00Z"),
      row("b", "in_transit", "2026-05-01T10:00:05Z"),
    ]);
    expect(m.get("a")).toBe("b");
    expect(m.get("b")).toBe("a");
    expect(m.get("c")).toBe("a");
  });
  it("a rejected twin is dismissable (his case) - but only while a live twin exists", () => {
    const m = findDuplicateTwins([row("live", "pending", "2026-05-01T10:00:00Z"), row("rej", "rejected", "2026-05-01T10:00:01Z")]);
    expect(m.get("rej")).toBe("live");
    expect(m.has("live")).toBe(false); // nothing live to keep instead
    expect(findDuplicateTwins([row("r1", "rejected", "2026-05-01T10:00:00Z"), row("r2", "rejected", "2026-05-01T10:00:01Z")]).size).toBe(0);
  });
  it("an accepted row is never offered (real receipt) but can be the kept row", () => {
    const m = findDuplicateTwins([row("acc", "accepted", "2026-05-01T10:00:00Z"), row("dup", "pending", "2026-05-01T10:00:01Z")]);
    expect(m.get("dup")).toBe("acc");
    expect(m.has("acc")).toBe(false);
  });
  it("dismissed rows take no part; different vendor/number is not a twin; no number is never a twin", () => {
    expect(findDuplicateTwins([row("a", "pending", "1"), row("d", "dismissed", "0")]).size).toBe(0);
    expect(findDuplicateTwins([row("a", "pending", "1"), row("b", "pending", "2", "WA-1", "Other")]).size).toBe(0);
    expect(findDuplicateTwins([row("a", "pending", "1"), row("b", "pending", "2", "WA-2")]).size).toBe(0);
    expect(findDuplicateTwins([row("a", "pending", "1", ""), row("b", "pending", "2", "")]).size).toBe(0);
  });
  it("matches across case/whitespace the same way staging does", () => {
    const m = findDuplicateTwins([row("a", "pending", "1", "wa-1", "acme  farms"), row("b", "pending", "2", " WA-1", "ACME FARMS ")]);
    expect(m.get("b")).toBe("a");
  });
  it("DISMISSABLE_STATUSES never includes a stock-activating stage", () => {
    expect([...DISMISSABLE_STATUSES]).toEqual(["pending", "in_transit", "received", "rejected"]);
    expect(isDismissableStatus("accepted")).toBe(false);
    expect(isDismissableStatus("partially_accepted")).toBe(false);
    expect(isDismissableStatus("dismissed")).toBe(false);
    expect(isDismissableStatus(" Rejected ")).toBe(true);
  });
});

describe("checkDismiss", () => {
  const keep = row("k", "pending", "1");
  it("allows the owner's case", () => {
    expect(checkDismiss(row("d", "pending", "2"), keep)).toEqual({ ok: true });
    expect(checkDismiss(row("d", "rejected", "2"), keep)).toEqual({ ok: true });
  });
  it("refuses: missing rows, self, already dismissed, accepted dup, dead keep, different transfer", () => {
    expect(checkDismiss(null, keep)).toMatchObject({ ok: false });
    expect(checkDismiss(keep, null)).toMatchObject({ ok: false });
    expect(checkDismiss(keep, keep)).toMatchObject({ ok: false, reason: expect.stringMatching(/itself/) });
    expect(checkDismiss(row("d", "dismissed", "2"), keep)).toMatchObject({ ok: false, reason: expect.stringMatching(/already/) });
    expect(checkDismiss(row("d", "accepted", "2"), keep)).toMatchObject({ ok: false, reason: expect.stringMatching(/accepted/) });
    expect(checkDismiss(row("d", "partially_accepted", "2"), keep)).toMatchObject({ ok: false });
    expect(checkDismiss(row("d", "pending", "2"), row("k", "rejected", "1"))).toMatchObject({ ok: false, reason: expect.stringMatching(/live/) });
    expect(checkDismiss(row("d", "pending", "2"), row("k", "dismissed", "1"))).toMatchObject({ ok: false });
    expect(checkDismiss(row("d", "pending", "2", "WA-2"), keep)).toMatchObject({ ok: false, reason: expect.stringMatching(/not the same/) });
    expect(checkDismiss(row("d", "pending", "2", ""), row("k", "pending", "1", ""))).toMatchObject({ ok: false });
  });
});

describe("describeDismissResult", () => {
  it("summarises every carried fact", () => {
    expect(
      describeDismissResult({ lots_removed: 2, labs_removed: 1, drafts_dismissed: 1, docs_moved: 3, invoice_carried: true, transport_fields_carried: 1 }),
    ).toBe(
      "2 never-received lines removed (nothing reaches Inventory); invoice # moved to the kept manifest; 3 documents moved to the kept manifest; 1 empty transport field filled on the kept manifest; 1 onboarding draft dismissed.",
    );
  });
  it("singular/plural and the empty case", () => {
    expect(describeDismissResult({ lots_removed: 1 })).toBe("1 never-received line removed (nothing reaches Inventory).");
    expect(describeDismissResult({})).toBe("no lines to remove.");
    expect(describeDismissResult({ lots_removed: -3, docs_moved: null })).toBe("no lines to remove.");
  });
});

describe("the dismissed stage leaves the receiving table entirely", () => {
  const rows = [{ status: "pending" }, { status: "rejected" }, { status: "dismissed" }, { status: "partially_accepted" }];
  it("is in NEITHER view and not counted as hidden-processed", () => {
    expect(applyIntakeView(rows, "action").map((r) => r.status)).toEqual(["pending"]);
    expect(applyIntakeView(rows, "all").map((r) => r.status)).toEqual(["pending", "rejected", "partially_accepted"]);
    expect(countProcessedRows(rows)).toBe(2);
    expect(isDismissedManifest(" Dismissed ")).toBe(true);
    expect(isDismissedManifest("rejected")).toBe(false);
  });
  it("R36 #1: rejected and partially accepted rows leave Needs attention", () => {
    expect(isProcessedManifest("rejected")).toBe(true);
    expect(isProcessedManifest("partially_accepted")).toBe(true);
    expect(isProcessedManifest("accepted")).toBe(true);
    expect(isProcessedManifest("pending")).toBe(false);
    expect(isProcessedManifest("received")).toBe(false);
  });
  it("pipeline stage: dismissed is its own closed stage, counted separately", () => {
    expect(normalizeStage("dismissed")).toBe("dismissed");
    expect(isOpenStage("dismissed")).toBe(false);
    const c = countStages(["pending", "dismissed", "dismissed", "rejected"]);
    expect(c.dismissed).toBe(2);
    expect(c.rejected).toBe(1);
    const g = groupPipeline([
      { id: "1", status: "dismissed" },
      { id: "2", status: "pending" },
    ] as never);
    expect((g as unknown as { dismissed: { id: string }[] }).dismissed.map((r) => r.id)).toEqual(["1"]);
    expect(movingBadge("dismissed", null).label).toMatch(/Dismissed/);
  });
});

// ── Wiring (source pins: the pure rules are actually used) ─────────────────
describe("wiring", () => {
  const route = read("src/app/api/webhooks/inbound-email/route.ts");
  const store = read("src/lib/inbound-email/inbound-store.ts");
  const intake = read("src/lib/inventory/intake-store.ts");
  const actions = read("src/app/admin/inventory/intake/actions.ts");
  const list = read("src/app/admin/inventory/intake/page.tsx");
  const detail = read("src/app/admin/inventory/intake/[id]/page.tsx");
  const table = read("src/components/admin/inventory/EmailIntakeTable.tsx");

  it("the webhook claims the delivery BEFORE the slow fetch/parse, and completes the same row", () => {
    expect(route).toMatch(/export const maxDuration = 300;/);
    const claimAt = route.indexOf("claimInboundDelivery({");
    const enrichAt = route.indexOf("await enrichResendInbound(raw)");
    expect(claimAt).toBeGreaterThan(0);
    expect(enrichAt).toBeGreaterThan(claimAt);
    expect(route).toMatch(/deliveryKey\(\{ emailId: extractEmailIdFromWebhook\(raw\), svixId \}\)/);
    expect(route).toMatch(/claimResponse\(claim\.decision\)/);
    expect(route).toMatch(/releaseInboundDelivery\(logId\)/);
    // every log write in finish() completes the claim row
    const fin = route.slice(route.indexOf("async function finish("));
    const calls = fin.split("await logInboundEmail({").length - 1;
    const withId = (fin.match(/\n\s+logId,\n/g) ?? []).length;
    expect(calls).toBeGreaterThanOrEqual(5);
    expect(withId).toBe(calls);
  });
  it("the claim is insert-first on the unique key, falls back safely, takes over conditionally", () => {
    const c = store.slice(store.indexOf("export async function claimInboundDelivery"), store.indexOf("export async function releaseInboundDelivery"));
    expect(c).toMatch(/disposition: "received",\s+delivery_key: params\.key/);
    expect(c).toMatch(/isDeliveryKeyConflict\(ins\.error\)/);
    expect(c).toMatch(/isMissingColumnError\(ins\.error\)/);
    expect(c).toMatch(/decideClaim\(holder, now\)/);
    expect(c).toMatch(/\.eq\("disposition", "received"\)/);
    expect(c).toMatch(/q\.eq\("claimed_at", holder\.claimed_at\)/);
    expect(store).toMatch(/if \(params\.logId\) \{[\s\S]*?\.update\(row\)[\s\S]*?\.eq\("id", params\.logId\)/);
  });
  it("a duplicate e-mail hands its documents to an EMPTY existing row (both paths)", () => {
    expect((store.match(/await archiveDocsToExistingIfNone\(staged\.existingManifestId, email\.attachments\)/g) ?? []).length).toBe(2);
    expect(store).toMatch(/if \(meta === null \|\| meta\.length > 0 \|\| attachments\.length === 0\) return 0;/);
  });
  it("staging writes the dedupe_key and resolves a conflict to the holder", () => {
    expect(intake).toMatch(/dedupe_key/);
    expect(intake).toMatch(/isDedupeKeyConflict\(/);
    expect(intake).toMatch(/admin\.rpc\("dismiss_duplicate_manifest"/);
  });
  it("the Dismiss action is permission-gated and the pages render it", () => {
    const a = actions.slice(actions.indexOf("export async function dismissDuplicateManifestAction"));
    expect(a.slice(0, 1500)).toMatch(/requirePermission\("inventory\.manage"\)/);
    expect(list).toMatch(/findDuplicateTwinsFor\(/);
    expect(list).toMatch(/dismissDuplicateManifestAction/);
    expect(detail).toMatch(/DismissDuplicateForm/);
    expect(detail).toMatch(/data-testid="duplicate-warning"/);
    expect(table).toMatch(/data-testid="duplicate-flag"/);
  });
  it("a successful dismissal is written to Settings -> Audit log (and only a successful one)", () => {
    const start = actions.indexOf("export async function dismissDuplicateManifestAction");
    const a = actions.slice(start, actions.indexOf("\n}\n", start));
    const okAt = a.indexOf("if (res.ok) {");
    const elseAt = a.indexOf("} else {", okAt);
    const auditAt = a.indexOf("await recordAudit({");
    expect(okAt).toBeGreaterThan(0);
    // inside the success branch, before the refusal branch
    expect(auditAt).toBeGreaterThan(okAt);
    expect(auditAt).toBeLessThan(elseAt);
    expect(a).toMatch(/action: "manifest\.dismiss_duplicate"/);
    expect(a).toMatch(/entityId: duplicateId/);
    expect(a).toMatch(/duplicateOf: keepId/);
    expect(a).toMatch(/actorId: session\.userId/);
  });
  it("the KB bridge and intake scans skip dismissed rows like rejected ones", () => {
    expect(read("src/lib/inventory/manifest-kb-bridge.ts")).toMatch(/\.not\("status", "in", "\(rejected,dismissed\)"\)/);
    expect((actions.match(/\.not\("status", "in", "\(rejected,dismissed\)"\)/g) ?? []).length).toBe(1);
    expect(actions).not.toMatch(/\.neq\("status", "rejected"\)/);
  });
});
