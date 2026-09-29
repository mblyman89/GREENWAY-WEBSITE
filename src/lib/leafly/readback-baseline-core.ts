/**
 * src/lib/leafly/readback-baseline-core.ts
 *
 * WHICH PAYLOAD SHOULD THE READBACK BE COMPARED AGAINST?
 *
 * FIELD-REPORTED, and the whole reason this module exists. The owner made his
 * first targeted push -- 8 products, chosen on purpose, everything else left
 * alone -- and it worked perfectly. Leafly accepted all 8. The readback then
 * told him he had nineteen problems, leading with:
 *
 *     We sent "1937 - 3.5g Flower - Blackberry - 3.5g" but Leafly's menu does
 *     not contain it.
 *
 * We never sent it. `getLeaflyMenu()` built a fresh WHOLE-FEED preview (2,562
 * items) and diffed it against the 8 items Leafly holds, so 2,554 untouched
 * products were each reported as a failure. A successful push was rendered as
 * a catastrophe, and the one tool whose job is to tell the owner whether his
 * menu is right became the tool he cannot trust.
 *
 * THE RULE THIS MODULE ENCODES
 * ----------------------------
 * A readback must be compared against WHAT WE ACTUALLY SENT, not against what
 * we would send if we pushed again right now. Those are the same thing only
 * after a full sync, which is precisely why the bug hid: it is correct in the
 * one case anybody had tested.
 *
 * `syndication_logs` already stores the exact payload of every live push, so
 * "what did we actually send" is recoverable rather than needing to be
 * invented. This module is the pure decision half: given the recent log rows,
 * decide which baseline to use and what the comparison is entitled to
 * conclude. It performs no I/O so CI can prove the rule without a database.
 *
 * WHY A SEPARATE FILE RATHER THAN A HELPER IN push.ts
 * ---------------------------------------------------
 * push.ts is `server-only` and reaches the network. The decision "which
 * baseline, and what may it conclude?" is the part that must never be wrong,
 * and it is exactly the part that is cheapest to test in isolation. Keeping it
 * pure means every branch below is provable from a plain object literal.
 */

import type { LeaflyItem, LeaflyItemsPayload } from "./payload-core";
import type { LeaflyReconcileScope } from "./readback-core";
import { hashPayload } from "../syndication/sync-plan-core";

/**
 * The fields of a syndication log row this decision depends on. Deliberately a
 * structural subset of `SyndicationLog` rather than an import of it: this core
 * must stay free of anything that reaches a database, and narrowing the input
 * also documents precisely which columns the rule actually reads.
 */
export type ReadbackLogRow = {
  /** "live" pushes transmitted; "preview" rows never touched Leafly. */
  mode: string;
  /** "ok" | "error" | "skipped". Only a successful transmission is a baseline. */
  status: string;
  /** The exact payload sent, as stored at push time. */
  payload: unknown;
  /** Free text. Targeted pushes are prefixed by selection-actions.ts. */
  message?: string | null;
  /** ISO timestamp, newest first when listed. */
  created_at?: string | null;
};

export type ReadbackBaseline = {
  /** The payload to diff against, or null when nothing usable was found. */
  payload: LeaflyItemsPayload | null;
  /** What the resulting comparison is entitled to conclude. */
  scope: LeaflyReconcileScope;
  /**
   * How the baseline was obtained. Shown to the owner, because a comparison is
   * only as trustworthy as the thing it compares against, and he should never
   * have to read source code to find out which one he is looking at.
   */
  source: "targeted-push-log" | "full-sync-log" | "sync-state-rebuild" | "live-preview" | "none";
  /** One sentence a non-engineer can act on. Always present. */
  explanation: string;
  /**
   * SLICE L-52. Ids we have on record as being AT Leafly, but whose exact sent
   * copy cannot be reconstructed any more (the product changed since it was
   * last sent, or it is no longer in the feed). Only the `sync-state-rebuild`
   * source fills this. The reconciler counts these ids as "held at Leafly, not
   * checked" rather than flagging them as unexpected extras, because our own
   * records say Leafly SHOULD hold them. Absent/empty for every other source.
   */
  unverifiableIds?: readonly string[];
};

/**
 * SLICE L-52 -- the input for the `sync-state-rebuild` baseline.
 *
 * `items` is the menu as the automatic sync would build it right now (the
 * same builder, settings and size repair it sends with). `storedHashes` is the
 * sync-state map (item id -> hash of the exact item last sent), which every
 * full/automatic/replace/legacy writer records and every delete prunes.
 */
export type SyncStateRebuildInput = {
  items: readonly LeaflyItem[];
  storedHashes: ReadonlyMap<string, string>;
};

/** What `rebuildFromSyncState` could and could not prove. */
export type SyncStateRebuild = {
  /** Rebuilt items whose hash is IDENTICAL to what was recorded as sent. */
  proven: LeaflyItem[];
  /** On record at Leafly, but the product has changed since it was sent. */
  changedSinceSent: string[];
  /** On record at Leafly, but no longer in the menu we would build. */
  notInCurrentMenu: string[];
  /** In the menu we would build, but not on record as ever sent. */
  notYetSent: string[];
};

/**
 * Marker written by the targeted push when it records its log row.
 *
 * Exported and shared rather than typed as a literal in two places: if the
 * wording in selection-actions.ts ever drifts from the wording matched here,
 * every targeted push silently reverts to being judged as a full sync -- which
 * is the exact bug this module exists to fix, returning in disguise. A test
 * asserts the writer uses this constant.
 */
export const TARGETED_PUSH_LOG_PREFIX = "Targeted push";

/**
 * Is this stored payload a usable `{ items: [...] }`?
 *
 * Defensive on purpose. The column is `jsonb`, so it can legitimately hold
 * null (a skipped push), and a row written by an older build may not match
 * today's shape. Returning null for anything unrecognised is what lets the
 * caller fall back honestly instead of comparing against nonsense.
 */
export function readPayloadItems(payload: unknown): LeaflyItemsPayload | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const items = (payload as { items?: unknown }).items;
  if (!Array.isArray(items)) return null;
  return { items } as LeaflyItemsPayload;
}

/**
 * SLICE L-52 -- the prefix the menu-browser delete writes into its log line
 * (actions.ts). That writer stores NO payload, so the message is the only way
 * to recognise the row.
 */
export const MENU_BROWSER_DELETE_LOG_PREFIX = "Leafly delete (from menu browser)";

/**
 * SLICE L-52 -- is this successful live row a transmission whose items are
 * deliberately NOT stored in the log?
 *
 * FIELD-REPORTED. The owner's read-back said "No record of a previous push was
 * available" although automatic syncs had been running for days. The reason:
 * the automatic sync (auto-sync-server.ts) logs a COMPACT payload on purpose --
 * `{ automatic, method, sentIds, deleteIds, ... }` -- because a full menu body
 * every fifteen minutes would bloat the log. The old chooser saw "no items",
 * treated the row as corrupt, and dropped to the live preview, which is built
 * a different way (no settings, no size repair, nothing held back) and so
 * reported 811 items against Leafly's 753.
 *
 * The same is true of the two delete writers: `{ ids }` (the delete tool) and
 * no payload at all (the menu browser). A delete changes what Leafly holds, so
 * an older full-sync payload is no longer an exact description either.
 *
 * None of these rows is corrupt. They are real, successful changes whose exact
 * result is recorded somewhere else: the sync-state hash map. Recognising them
 * is what lets the chooser go there instead of guessing.
 */
export function isCompactTransmissionLog(row: ReadbackLogRow): boolean {
  const p = row.payload;
  if (p && typeof p === "object" && !Array.isArray(p)) {
    const o = p as Record<string, unknown>;
    if (typeof o.automatic === "string" && Array.isArray(o.sentIds)) return true;
    if (Array.isArray(o.ids) && !("items" in o)) return true;
  }
  return typeof row.message === "string" && row.message.startsWith(MENU_BROWSER_DELETE_LOG_PREFIX);
}

/**
 * SLICE L-52 -- rebuild "what Leafly should hold" from the sync-state record.
 *
 * Every writer that changes the whole menu stores `hashPayload(item)` of the
 * EXACT item it transmitted, keyed by id, and every delete removes the id. So
 * for any item we can rebuild today, an identical hash is proof -- not a
 * likelihood -- that the rebuilt item is byte-for-byte what Leafly was sent.
 *
 * Items that cannot be proven are NOT compared and NOT reported as problems;
 * they are counted, so the owner can see how much was checked. Pretending a
 * changed product is "what we sent" would manufacture differences that are
 * simply the next sync's work.
 */
export function rebuildFromSyncState(input: SyncStateRebuildInput): SyncStateRebuild {
  const proven: LeaflyItem[] = [];
  const changedSinceSent: string[] = [];
  const notYetSent: string[] = [];
  const builtIds = new Set<string>();
  for (const item of input.items) {
    const id = String(item.id);
    builtIds.add(id);
    const stored = input.storedHashes.get(id);
    if (stored === undefined) {
      notYetSent.push(id);
    } else if (stored === hashPayload(item)) {
      proven.push(item);
    } else {
      changedSinceSent.push(id);
    }
  }
  const notInCurrentMenu: string[] = [];
  for (const id of input.storedHashes.keys()) {
    if (!builtIds.has(id)) notInCurrentMenu.push(id);
  }
  return { proven, changedSinceSent, notInCurrentMenu, notYetSent };
}

function syncStateBaseline(input: SyncStateRebuildInput | null | undefined): ReadbackBaseline | null {
  if (!input || input.storedHashes.size === 0) return null;
  const r = rebuildFromSyncState(input);
  if (r.proven.length === 0) return null;
  const unverifiable = [...r.changedSinceSent, ...r.notInCurrentMenu];
  const skipped =
    unverifiable.length === 0
      ? ""
      : ` ${unverifiable.length} other product(s) on your Leafly menu have changed here since ` +
        "they were last sent (usually just a stock count), so they are left for the next " +
        "automatic sync and not checked this time.";
  const pending =
    r.notYetSent.length === 0
      ? ""
      : ` ${r.notYetSent.length} product(s) have not been sent yet and were not expected on Leafly.`;
  return {
    payload: { items: r.proven } as LeaflyItemsPayload,
    scope: "full",
    source: "sync-state-rebuild",
    explanation:
      `Compared against the ${r.proven.length} product(s) our sync records prove were sent ` +
      "to Leafly exactly as they are today (your automatic syncs do not store a full copy " +
      `of the menu, so it was rebuilt and matched against the sync fingerprints).${skipped}${pending}`,
    unverifiableIds: unverifiable,
  };
}

/** Did this log row come from the targeted item picker? */
export function isTargetedPushLog(row: ReadbackLogRow): boolean {
  return typeof row.message === "string" && row.message.startsWith(TARGETED_PUSH_LOG_PREFIX);
}

/**
 * Choose the baseline for a readback comparison.
 *
 * Rows are expected newest-first, which is how `listSyndicationLogs` returns
 * them. The search stops at the most recent SUCCESSFUL LIVE push because that,
 * and only that, describes the state Leafly should currently be in. Older
 * pushes have been superseded; previews and failures never reached Leafly at
 * all, and treating either as a baseline would invent a menu that never
 * existed.
 *
 * @param rows        Recent syndication log rows, newest first.
 * @param livePreview The whole-feed payload we would send right now. Used only
 *                    as a last resort, and labelled as such.
 * @param syncState   SLICE L-52. The current build plus the sync-state hashes.
 *                    Used when the newest transmission did not store its
 *                    items (automatic syncs, deletes), or when no transmission
 *                    is in the recent log at all.
 */
export function chooseReadbackBaseline(
  rows: readonly ReadbackLogRow[],
  livePreview: LeaflyItemsPayload | null,
  syncState?: SyncStateRebuildInput | null,
): ReadbackBaseline {
  let sawCorrupt = false;
  for (const row of rows) {
    // Only a successful live transmission describes what Leafly holds.
    if (row.mode !== "live" || row.status !== "ok") continue;

    // SLICE L-52. An automatic sync or a delete is a real, successful change
    // whose items are recorded in the sync state rather than the log. Go there.
    if (isCompactTransmissionLog(row)) {
      const rebuilt = syncStateBaseline(syncState);
      if (rebuilt) return rebuilt;
      break;
    }

    const payload = readPayloadItems(row.payload);
    // A successful push whose payload we cannot read is a dead end rather than
    // a reason to keep searching: an OLDER push is not a safer baseline, it is
    // a staler one, and silently reaching past the most recent push would
    // compare against a menu that has since been replaced.
    if (!payload) {
      sawCorrupt = true;
      break;
    }

    if (isTargetedPushLog(row)) {
      return {
        payload,
        scope: "targeted",
        source: "targeted-push-log",
        explanation:
          `Compared against the ${payload.items.length} product(s) your last targeted push ` +
          "actually sent. Everything else on your Leafly menu was not part of that push, " +
          "so it is not checked here and is not a problem.",
      };
    }

    return {
      payload,
      scope: "full",
      source: "full-sync-log",
      explanation:
        `Compared against the ${payload.items.length} item(s) your last full sync actually ` +
        "sent.",
    };
  }

  // No usable transmission in the recent log (or the newest one did not store
  // its items). The sync-state rebuild is PROVEN where it matches, so it beats
  // the live preview -- except after an unreadable row, where we keep the old,
  // conservative behaviour rather than trust anything newer we cannot read.
  if (!sawCorrupt) {
    const rebuilt = syncStateBaseline(syncState);
    if (rebuilt) return rebuilt;
  }

  if (livePreview) {
    return {
      payload: livePreview,
      scope: "full",
      source: "live-preview",
      explanation:
        "No record of a previous push was available, so this was compared against the " +
        "whole menu as it stands right now. If you have pushed only some products, " +
        "expect the rest to show as missing -- that is this comparison's limitation, " +
        "not a fault with your menu.",
    };
  }

  return {
    payload: null,
    scope: "full",
    source: "none",
    explanation: "There was nothing to compare against, so no comparison was made.",
  };
}

// ---------------------------------------------------------------------------
// Self-tests (house rule 5)
// ---------------------------------------------------------------------------

export function __runLeaflyReadbackBaselineTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const check = (name: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`[readback-baseline] FAIL: ${name}`);
    }
  };

  const pay = (n: number): unknown => ({
    items: Array.from({ length: n }, (_, i) => ({ id: `SKU-${i}` })),
  });

  const targetedRow: ReadbackLogRow = {
    mode: "live",
    status: "ok",
    payload: pay(8),
    message: "Targeted push — Sent 8 product(s) to Leafly.",
    created_at: "2026-09-20T12:00:00Z",
  };
  const fullRow: ReadbackLogRow = {
    mode: "live",
    status: "ok",
    payload: pay(1876),
    message: "Full sync sent (1876 created).",
    created_at: "2026-09-19T12:00:00Z",
  };
  const preview: LeaflyItemsPayload = pay(2562) as LeaflyItemsPayload;

  // --- the exact field failure ---------------------------------------------
  const t = chooseReadbackBaseline([targetedRow, fullRow], preview);
  check("a targeted push is recognised", t.source === "targeted-push-log");
  check("a targeted push yields targeted scope", t.scope === "targeted");
  check("a targeted push compares against the 8 sent", t.payload?.items.length === 8);
  check(
    "the explanation says the rest is not a problem",
    t.explanation.includes("not a problem"),
  );
  // The regression in one line: it must NOT pick the 2,562-item live preview.
  check("a targeted push does NOT use the whole feed", t.payload?.items.length !== 2562);

  // --- a full sync keeps the old, correct behaviour -------------------------
  const f = chooseReadbackBaseline([fullRow], preview);
  check("a full sync is recognised", f.source === "full-sync-log");
  check("a full sync yields full scope", f.scope === "full");
  check("a full sync compares against what it sent", f.payload?.items.length === 1876);

  // --- newest wins ----------------------------------------------------------
  const order = chooseReadbackBaseline([fullRow, targetedRow], preview);
  check("the most recent push wins (full first)", order.scope === "full");
  const order2 = chooseReadbackBaseline([targetedRow, fullRow], preview);
  check("the most recent push wins (targeted first)", order2.scope === "targeted");

  // --- rows that never reached Leafly are not baselines ---------------------
  const previewRow: ReadbackLogRow = {
    mode: "preview",
    status: "ok",
    payload: pay(5),
    message: "Dry run",
  };
  const errorRow: ReadbackLogRow = {
    mode: "live",
    status: "error",
    payload: pay(3),
    message: "Targeted push failed — HTTP 500",
  };
  const skippedRow: ReadbackLogRow = {
    mode: "live",
    status: "skipped",
    payload: null,
    message: "Nothing to send",
  };
  const ignored = chooseReadbackBaseline([previewRow, errorRow, skippedRow, targetedRow], preview);
  check("a dry run is never a baseline", ignored.payload?.items.length === 8);
  check("a failed push is never a baseline", ignored.scope === "targeted");

  // A failed push must not be mistaken for a targeted baseline even though its
  // message also begins with the marker.
  const onlyFailed = chooseReadbackBaseline([errorRow], preview);
  check("a failed targeted push falls through to the preview", onlyFailed.source === "live-preview");

  // --- honest fallback ------------------------------------------------------
  const none = chooseReadbackBaseline([], preview);
  check("with no history we fall back to the live preview", none.source === "live-preview");
  check("the fallback is full scope", none.scope === "full");
  check(
    "the fallback WARNS that partial pushes will look wrong",
    none.explanation.includes("expect the rest to show as missing"),
  );

  const nothing = chooseReadbackBaseline([], null);
  check("with nothing at all we report none", nothing.source === "none");
  check("with nothing at all the payload is null", nothing.payload === null);

  // --- unreadable stored payloads ------------------------------------------
  check("null payload is unreadable", readPayloadItems(null) === null);
  check("a string payload is unreadable", readPayloadItems("{}") === null);
  check("an array payload is unreadable", readPayloadItems([1, 2]) === null);
  check("a payload without items is unreadable", readPayloadItems({ nope: 1 }) === null);
  check("items must be an array", readPayloadItems({ items: "no" }) === null);
  check("an empty item list is still readable", readPayloadItems({ items: [] })?.items.length === 0);

  // An empty-but-valid payload is a real state (a push that sent nothing) and
  // must not silently fall through to the whole feed.
  const emptySent = chooseReadbackBaseline(
    [{ mode: "live", status: "ok", payload: { items: [] }, message: "Targeted push — none" }],
    preview,
  );
  check("an empty sent payload is used, not skipped", emptySent.source === "targeted-push-log");
  check("an empty sent payload compares zero items", emptySent.payload?.items.length === 0);

  // A corrupt newest row must not silently reach past to an older push: that
  // would compare against a menu that has since been replaced.
  const corruptNewest = chooseReadbackBaseline(
    [{ mode: "live", status: "ok", payload: "corrupt", message: "Targeted push — x" }, fullRow],
    preview,
  );
  check(
    "a corrupt newest push does not fall back to an older one",
    corruptNewest.source === "live-preview",
  );

  // --- the marker is shared, not retyped ------------------------------------
  check("the marker is a non-empty constant", TARGETED_PUSH_LOG_PREFIX.length > 0);
  check(
    "isTargetedPushLog matches the marker",
    isTargetedPushLog({ mode: "live", status: "ok", payload: null, message: "Targeted push — x" }),
  );
  check(
    "isTargetedPushLog does not match a full sync",
    !isTargetedPushLog({ mode: "live", status: "ok", payload: null, message: "Full sync sent" }),
  );
  check(
    "isTargetedPushLog tolerates a missing message",
    !isTargetedPushLog({ mode: "live", status: "ok", payload: null }),
  );

  // Every branch must produce a usable sentence: a blank explanation would
  // render as an empty box in the admin UI.
  check(
    "every baseline carries a real explanation",
    [t, f, none, nothing].every((b) => b.explanation.trim().length > 20),
  );

  // --- SLICE L-52: compact automatic rows, deletes, sync-state rebuild -------
  // The live field state: automatic syncs log `{ automatic, sentIds, ... }`
  // with no items, so the old chooser fell to the live preview and reported
  // "No record of a previous push" after days of successful syncs.
  const mk = (id: string, inv: number): LeaflyItem =>
    ({
      id,
      type: "Cartridge",
      name: `Item ${id}`,
      variants: [{ id: `${id}-v`, amount: 1, unit: "g", price: 1000, inventoryLevel: inv, medical: false }],
    }) as unknown as LeaflyItem;
  const a = mk("A", 5);
  const b = mk("B", 5);
  const c = mk("C", 5);
  const bNow = mk("B", 3); // B's stock changed since it was sent
  const stored = new Map<string, string>([
    ["A", hashPayload(a)],
    ["B", hashPayload(b)],
    ["GONE", "deadbeef"], // at Leafly, no longer in the feed
  ]);
  const syncInput: SyncStateRebuildInput = { items: [a, bNow, c], storedHashes: stored };

  const rb = rebuildFromSyncState(syncInput);
  check("rebuild: an identical hash is proven", rb.proven.length === 1 && rb.proven[0].id === "A");
  check("rebuild: a changed product is not treated as sent", rb.changedSinceSent.join() === "B");
  check("rebuild: an id no longer in the feed is counted", rb.notInCurrentMenu.join() === "GONE");
  check("rebuild: a never-sent product is counted separately", rb.notYetSent.join() === "C");
  check(
    "rebuild: the hash is key-order independent (stable stringify)",
    rebuildFromSyncState({
      items: [{ variants: a.variants, name: a.name, type: a.type, id: "A" } as LeaflyItem],
      storedHashes: stored,
    }).proven.length === 1,
  );

  const autoRow: ReadbackLogRow = {
    mode: "live",
    status: "ok",
    payload: { automatic: "intraday_delta", method: "PUT", sentIds: ["B"], deleteIds: [] },
    message: "Automatic in-between update: sent 1 (1 changed).",
  };
  check("a compact automatic row is recognised", isCompactTransmissionLog(autoRow));
  check(
    "a delete-tool row is recognised",
    isCompactTransmissionLog({ mode: "live", status: "ok", payload: { ids: ["X"] } }),
  );
  check(
    "a menu-browser delete row (no payload) is recognised",
    isCompactTransmissionLog({
      mode: "live",
      status: "ok",
      payload: null,
      message: `${MENU_BROWSER_DELETE_LOG_PREFIX} \u2014 removed 1: X`,
    }),
  );
  check("a full sync row is NOT compact", !isCompactTransmissionLog(fullRow));
  check("a corrupt row is NOT compact", !isCompactTransmissionLog({ mode: "live", status: "ok", payload: "x" }));

  const afterAuto = chooseReadbackBaseline([autoRow, fullRow], preview, syncInput);
  check("after an automatic sync the sync-state rebuild is used", afterAuto.source === "sync-state-rebuild");
  check("the rebuild compares only the proven items", afterAuto.payload?.items.length === 1);
  check("the rebuild is full scope", afterAuto.scope === "full");
  check(
    "the rebuild lists the unprovable ids for the reconciler",
    (afterAuto.unverifiableIds ?? []).slice().sort().join() === "B,GONE",
  );
  check("the rebuild does NOT reach past to the older full sync", afterAuto.payload?.items.length !== 1876);
  check("the rebuild does NOT use the live preview", afterAuto.payload?.items.length !== 2562);
  check(
    "the rebuild explanation is plain English",
    afterAuto.explanation.length > 30 && !/payload|reconcile|scope/i.test(afterAuto.explanation),
  );

  // A full sync NEWER than the automatic row keeps its exact stored body.
  const fullFirst = chooseReadbackBaseline([fullRow, autoRow], preview, syncInput);
  check("a newer full sync still wins over the rebuild", fullFirst.source === "full-sync-log");

  // Without sync-state input the compact row falls to the (labelled) preview.
  const noState = chooseReadbackBaseline([autoRow], preview);
  check("a compact row with no sync state falls back honestly", noState.source === "live-preview");

  // An empty sync-state map proves nothing.
  const emptyState = chooseReadbackBaseline([autoRow], preview, { items: [a], storedHashes: new Map() });
  check("an empty sync state is not a baseline", emptyState.source === "live-preview");

  // No log history at all, but a sync state: the rebuild beats the preview.
  const noLogs = chooseReadbackBaseline([], preview, syncInput);
  check("with no log history the proven rebuild beats the preview", noLogs.source === "sync-state-rebuild");

  // The corrupt-newest rule is preserved: nothing newer we cannot read is trusted.
  const corruptWithState = chooseReadbackBaseline(
    [{ mode: "live", status: "ok", payload: "corrupt" }, fullRow],
    preview,
    syncInput,
  );
  check("a corrupt newest row still refuses the rebuild", corruptWithState.source === "live-preview");

  // Previews (read-backs) and failures between do not interfere.
  const withNoise = chooseReadbackBaseline([previewRow, errorRow, autoRow], preview, syncInput);
  check("read-backs and failures are skipped before the compact row", withNoise.source === "sync-state-rebuild");

  // Other sources carry no unverifiable ids.
  check("a full sync carries no unverifiable ids", (f.unverifiableIds ?? []).length === 0);

  return { passed, failed };
}
