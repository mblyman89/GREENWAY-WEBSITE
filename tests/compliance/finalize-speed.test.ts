/**
 * tests/compliance/finalize-speed.test.ts — SLICE 103.
 *
 * Owner: "the finalize button takes a few minutes to process… speed this up
 * or make it more efficient somehow? Or give us a better progress bar, the
 * one we have now gives up well before it finalizes."
 *
 * Two halves, both pinned here:
 *  1. SPEED — finalizeManifestDispositions (intake-store.ts) must batch its
 *     writes (one .in() update per group + ONE bulk adjustments insert
 *     instead of two round trips per lot) and must run its six independent
 *     follow-up chores CONCURRENTLY via Promise.allSettled instead of
 *     awaiting them one after another.
 *  2. HONEST PROGRESS BAR — pending-core.ts must give FORM saves a 5-minute
 *     ceiling (the old 20s one is why the bar "gives up well before it
 *     finalizes") while link navigations keep the tight 20s guard, and
 *     pendingHint must produce the "Still working" line for long form saves.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  PENDING_SAFETY_TIMEOUT_MS,
  PENDING_FORM_SAFETY_TIMEOUT_MS,
  PENDING_STILL_WORKING_MS,
  pendingHint,
  shouldClearPending,
} from "@/lib/admin/pending-core";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("SLICE 103 — kind-aware safety timeout", () => {
  const base = {
    hrefAtStart: "https://shop.example/admin/inventory/intake/m1",
    hrefNow: "https://shop.example/admin/inventory/intake/m1",
    submitterConnected: true,
    submitterDisabled: false,
  };

  it("form ceiling is 5 minutes; nav ceiling stays 20s", () => {
    expect(PENDING_FORM_SAFETY_TIMEOUT_MS).toBe(300_000);
    expect(PENDING_SAFETY_TIMEOUT_MS).toBe(20_000);
    expect(PENDING_FORM_SAFETY_TIMEOUT_MS).toBeGreaterThan(PENDING_SAFETY_TIMEOUT_MS);
  });

  it("a FORM save at 20s keeps the bar alive (the old bug: it gave up here)", () => {
    expect(
      shouldClearPending({ ...base, elapsedMs: PENDING_SAFETY_TIMEOUT_MS, kind: "form" }),
    ).toEqual({ clear: false, reason: "" });
  });

  it("a FORM save at 3 minutes still shows the bar", () => {
    expect(shouldClearPending({ ...base, elapsedMs: 180_000, kind: "form" })).toEqual({
      clear: false,
      reason: "",
    });
  });

  it("a FORM save finally hits the 5-minute stuck-UI guard", () => {
    expect(
      shouldClearPending({ ...base, elapsedMs: PENDING_FORM_SAFETY_TIMEOUT_MS, kind: "form" }),
    ).toEqual({ clear: true, reason: "timeout" });
  });

  it("a nav click still times out at 20s", () => {
    expect(
      shouldClearPending({ ...base, elapsedMs: PENDING_SAFETY_TIMEOUT_MS, kind: "nav" }),
    ).toEqual({ clear: true, reason: "timeout" });
  });

  it("omitting kind behaves like nav (old callers/tests unchanged)", () => {
    expect(shouldClearPending({ ...base, elapsedMs: PENDING_SAFETY_TIMEOUT_MS })).toEqual({
      clear: true,
      reason: "timeout",
    });
  });

  it("real clear signals still win instantly for forms", () => {
    expect(
      shouldClearPending({
        ...base,
        hrefNow: "https://shop.example/admin/inventory/intake",
        elapsedMs: 45_000,
        kind: "form",
      }),
    ).toEqual({ clear: true, reason: "navigated" });
    expect(
      shouldClearPending({
        ...base,
        submitterConnected: false,
        elapsedMs: 45_000,
        kind: "form",
      }),
    ).toEqual({ clear: true, reason: "replaced" });
  });
});

describe("SLICE 103 — pendingHint (the honest 'Still working' line)", () => {
  it("quiet while a form save is young", () => {
    expect(pendingHint("form", 0)).toBeNull();
    expect(pendingHint("form", PENDING_STILL_WORKING_MS - 1)).toBeNull();
  });

  it("speaks up at 10s with the elapsed seconds", () => {
    const hint = pendingHint("form", PENDING_STILL_WORKING_MS);
    expect(hint).toContain("Still working — 10s");
    expect(hint).toContain("finalizing a manifest");
    expect(hint).toContain("leave this page open");
  });

  it("counts up as the save runs", () => {
    expect(pendingHint("form", 125_400)).toContain("Still working — 125s");
  });

  it("never nags about link navigations", () => {
    expect(pendingHint("nav", 15_000)).toBeNull();
    expect(pendingHint("nav", 250_000)).toBeNull();
  });
});

describe("SLICE 103 — PendingKeeper wiring pins", () => {
  const src = read("src/components/admin/ux/PendingKeeper.tsx");

  it("form submits are tagged kind form; link clicks kind nav", () => {
    expect(src).toContain('kind: "form"');
    expect(src).toContain('kind: "nav"');
  });

  it("the poll passes the kind to shouldClearPending", () => {
    expect(src).toContain("kind: rec.kind");
  });

  it("the hint renders under the bar", () => {
    expect(src).toContain("pendingHint(rec.kind, elapsedMs)");
    expect(src).toContain("gw-pending-hint");
  });

  it("the hint has a style block in globals.css", () => {
    expect(read("src/app/globals.css")).toContain(".gw-pending-hint");
  });
});

describe("SLICE 103 — finalize batching wiring pins (intake-store.ts)", () => {
  const src = read("src/lib/inventory/intake-store.ts");

  it("activations land as one batched .in() update", () => {
    expect(src).toContain('.in("id", activatedLotIds)');
  });

  it("rejections land as one batched .in() update", () => {
    expect(src).toContain('.in("id", rejectedLotIds)');
  });

  it("receive adjustments land as ONE bulk insert preserving per-lot qty", () => {
    expect(src).toContain("activatedLotIds.map((lotId) => ({");
    expect(src).toContain("qty_delta: qtyByLot.get(lotId) ?? 0");
  });

  it("the six follow-up chores run concurrently via Promise.allSettled", () => {
    expect(src).toContain("await Promise.allSettled([");
    expect(src).toContain("seedDraftsForManifest(manifestId, actorId),");
    expect(src).toContain("archiveCoasForManifest(manifestId),");
    expect(src).toContain("promoteManifestToKb(manifestId, actorId),");
    expect(src).toContain("rememberVendorUsualTransport(manifestId, actorId),");
    expect(src).toContain("seedIncomingSampleEvents(manifestId, actorId),");
    expect(src).toContain("autoReceiveManifestPo(manifestId, activatedLotIds),");
  });

  it("per-chore error isolation survives (draft failures still hit the timeline)", () => {
    expect(src).toContain('draftsRes.status === "fulfilled"');
    expect(src).toContain('"draft_seed_error"');
    expect(src).toContain('poRes.status === "fulfilled"');
    expect(src).toContain('"po_auto_receive"');
  });

  it("SLICE 101 partial-accept behavior is untouched", () => {
    expect(src).toContain("deriveManifestStatus(activated, rejected, blocked.length)");
    expect(src).toContain("Why partial:");
    expect(src).toContain("Partial acceptance:");
  });
});
