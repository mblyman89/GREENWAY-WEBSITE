/**
 * src/lib/enrichment/vendor-pick-core.ts
 *
 * D244 R-16 (owner, round 6): "I would like a way to either queue up every
 * vendor, or select multiple vendors more efficiently. also when I select a
 * vendor, it only shows the number of products added to the batch, it does
 * not tell me the vendors added. more details would be great to have." and
 * "does it start right away after I add to the overnight batch and click the
 * button?"
 *
 * Pure helpers for the Bulk AI picker (live + overnight share it):
 *   - pickByVendors: ticked products + any number of vendors + "every vendor"
 *   - pickSummary: the flash line - which vendors, how many each, what was
 *     skipped (already waiting / over the cap)
 *   - batchVendorBreakdown: per-vendor waiting / at Google / drafted / failed
 *   - batchTimingText: when the overnight batch actually leaves (the 2-minute
 *     gather, then the next free minute of the every-minute worker) and when
 *     the answers come back (Google: within 24 hours)
 *   - requeueFailed: the failed products back in line (a person's click)
 *
 * Nothing here writes or publishes. Self-tests at the bottom.
 */

export type PickRow = { key: string; name: string; vendor: string | null };
export type PickInput = { ticked: readonly string[]; vendors: readonly string[]; allVendors: boolean };

const clean = (v: string | null | undefined) => (v ?? "").trim();

/** Every live row that a tick, a picked vendor, or "every vendor" selects (menu order, no repeats). */
export function pickByVendors(rows: readonly PickRow[], p: PickInput): PickRow[] {
  const ticked = new Set(p.ticked.map(clean).filter(Boolean));
  const vendors = new Set(p.vendors.map(clean).filter(Boolean));
  const seen = new Set<string>();
  const out: PickRow[] = [];
  for (const r of rows) {
    const k = clean(r.key);
    if (!k || seen.has(k)) continue;
    const v = clean(r.vendor);
    if (ticked.has(k) || (p.allVendors && v !== "") || (v !== "" && vendors.has(v))) {
      seen.add(k);
      out.push({ key: k, name: r.name, vendor: v || null });
    }
  }
  return out;
}

/** Nothing ticked and no vendor -> the plain error the page shows. */
export function pickIsEmpty(p: PickInput): boolean {
  return !p.allVendors && p.ticked.map(clean).filter(Boolean).length === 0 && p.vendors.map(clean).filter(Boolean).length === 0;
}

/** Products per vendor, biggest first then A-Z ("No vendor" last). */
export function vendorCounts(rows: readonly PickRow[]): { vendor: string; n: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) {
    const v = clean(r.vendor) || "No vendor";
    m.set(v, (m.get(v) ?? 0) + 1);
  }
  return [...m.entries()]
    .map(([vendor, n]) => ({ vendor, n }))
    .sort((a, b) => (a.vendor === "No vendor" ? 1 : b.vendor === "No vendor" ? -1 : b.n - a.n || a.vendor.localeCompare(b.vendor)));
}

/**
 * The flash line after a press: which vendors went in and how many each.
 * `addedKeys` are the products actually added (not already waiting, under the cap).
 */
export function pickSummary(picked: readonly PickRow[], addedKeys: readonly string[], o: { already: number; capped: boolean; cap: number; mode: "live" | "overnight" }): string {
  const added = new Set(addedKeys);
  const inRows = picked.filter((r) => added.has(r.key));
  const left = picked.filter((r) => !added.has(r.key));
  const by = vendorCounts(inRows);
  const icon = o.mode === "live" ? "⚡" : "🌙";
  const where = o.mode === "live" ? "for a live all-fields AI draft" : "to the overnight batch";
  const n = inRows.length;
  const head = `${icon} Added ${n} product${n === 1 ? "" : "s"} from ${by.length} vendor${by.length === 1 ? "" : "s"} ${where}`;
  const list = by.length ? `: ${by.slice(0, 40).map((v) => `${v.vendor} (${v.n})`).join(", ")}${by.length > 40 ? `, and ${by.length - 40} more vendors` : ""}.` : ".";
  const bits = [head + list];
  if (o.already) bits.push(`${o.already} already waiting.`);
  if (o.capped) {
    const notIn = vendorCounts(left).map((v) => v.vendor);
    bits.push(`Only ${o.cap} fit in one press; not added yet: ${left.length} product${left.length === 1 ? "" : "s"}${notIn.length ? ` (${notIn.slice(0, 12).join(", ")}${notIn.length > 12 ? ", …" : ""})` : ""}. Press again after these are sent.`);
  }
  return bits.join(" ");
}

// ---------------------------------------------------------------------------
// The overnight batch, per vendor and in time
// ---------------------------------------------------------------------------

export type BatchItemLite = { key: string; name: string; vendor: string | null; status: "queued" | "sent" | "done" | "failed" | "canceled"; at: string | null; error: string | null };

export type VendorBreakdown = { vendor: string; waiting: number; atGoogle: number; drafted: number; failed: number; total: number };

/** Per vendor: waiting to be sent / at Google / drafted / failed (canceled left out). */
export function batchVendorBreakdown(items: readonly BatchItemLite[]): VendorBreakdown[] {
  const m = new Map<string, VendorBreakdown>();
  for (const i of items) {
    if (i.status === "canceled") continue;
    const v = clean(i.vendor) || "No vendor";
    const row = m.get(v) ?? { vendor: v, waiting: 0, atGoogle: 0, drafted: 0, failed: 0, total: 0 };
    row.total += 1;
    if (i.status === "queued") row.waiting += 1;
    else if (i.status === "sent") row.atGoogle += 1;
    else if (i.status === "done") row.drafted += 1;
    else if (i.status === "failed") row.failed += 1;
    m.set(v, row);
  }
  return [...m.values()].sort((a, b) => (a.vendor === "No vendor" ? 1 : b.vendor === "No vendor" ? -1 : a.vendor.localeCompare(b.vendor)));
}

export function vendorBreakdownLine(v: VendorBreakdown): string {
  const bits = [v.waiting ? `${v.waiting} waiting` : null, v.atGoogle ? `${v.atGoogle} at Google` : null, v.drafted ? `${v.drafted} drafted` : null, v.failed ? `${v.failed} failed` : null].filter(Boolean);
  return `${v.vendor}: ${v.total} product${v.total === 1 ? "" : "s"} · ${bits.join(" · ") || "nothing yet"}`;
}

/**
 * When does it go? The answer to "does it start right away?": no - presses
 * within GATHER_MS of each other are gathered into one batch, then the
 * every-minute worker sends it on its next free minute; Google answers
 * within 24 hours (usually a few). `gatherMs` / `sendMax` / `maxOpen` are
 * passed in so this file needs no other import.
 */
export function batchTimingText(items: readonly BatchItemLite[], o: { nowMs: number; gatherMs: number; sendMax: number; openBatches: number; maxOpen: number; backoffUntil: string | null }): string | null {
  const queued = items.filter((i) => i.status === "queued");
  const sent = items.filter((i) => i.status === "sent").length;
  if (!queued.length) return sent ? `${sent} product${sent === 1 ? " is" : "s are"} at Google. Google answers within 24 hours (usually a few); the drafts land in the review grid by themselves.` : null;
  const lines: string[] = [];
  if (o.backoffUntil && Date.parse(o.backoffUntil) > o.nowMs) {
    lines.push(`Google refused the last send, so the worker waits until ${hhmm(Date.parse(o.backoffUntil))} before trying again.`);
  } else if (o.openBatches >= o.maxOpen) {
    lines.push(`${o.maxOpen} batches are already at Google; the next ${Math.min(queued.length, o.sendMax)} go as soon as one comes back.`);
  } else {
    const oldest = Math.min(...queued.map((i) => (i.at ? Date.parse(i.at) : o.nowMs)));
    const leaves = oldest + o.gatherMs;
    if (queued.length < o.sendMax && leaves > o.nowMs) lines.push(`Not yet - it gathers presses for ${Math.round(o.gatherMs / 60_000)} minutes, so the first batch leaves for Google at about ${hhmm(leaves)} (the next free minute of the background worker after that).`);
    else lines.push("Ready to go: the background worker sends it on its next free minute (usually within a few minutes).");
  }
  const batches = Math.ceil(queued.length / o.sendMax);
  if (batches > 1) lines.push(`${queued.length} are waiting, so they go as ${batches} batches of up to ${o.sendMax} (at most ${o.maxOpen} at Google at once).`);
  lines.push("Google answers within 24 hours (usually a few hours). You can close this tab.");
  return lines.join(" ");
}

function hhmm(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit" });
}

/** The failed products back in line (fresh tries), others untouched. */
export function requeueFailed<T extends { status: string; attempts: number; error: string | null; at: string | null; batchId: string | null; req: unknown }>(items: readonly T[], nowIso: string): { items: T[]; requeued: number } {
  let requeued = 0;
  const out = items.map((i) => {
    if (i.status !== "failed") return i;
    requeued += 1;
    return { ...i, status: "queued", attempts: 0, error: null, at: nowIso, batchId: null, req: null };
  });
  return { items: out, requeued };
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runVendorPickTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, label: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`  FAIL vendor-pick-core: ${label}`);
    }
  };
  const rows: PickRow[] = [
    { key: "a", name: "A", vendor: "Phat Panda" },
    { key: "b", name: "B", vendor: "Phat Panda" },
    { key: "c", name: "C", vendor: "Hollingsworth" },
    { key: "d", name: "D", vendor: " Fifty Fold " },
    { key: "e", name: "E", vendor: null },
    { key: "a", name: "A dup", vendor: "Phat Panda" },
  ];
  ok(pickByVendors(rows, { ticked: [], vendors: ["Phat Panda", "Fifty Fold"], allVendors: false }).map((r) => r.key).join() === "a,b,d", "two vendors at once (trimmed names, no repeats)");
  ok(pickByVendors(rows, { ticked: [], vendors: [], allVendors: true }).map((r) => r.key).join() === "a,b,c,d", "every vendor = every row with a vendor");
  ok(pickByVendors(rows, { ticked: ["e", "c"], vendors: ["Phat Panda"], allVendors: false }).map((r) => r.key).join() === "a,b,c,e", "ticks + vendors together, menu order");
  ok(pickByVendors(rows, { ticked: ["forged"], vendors: ["Nobody"], allVendors: false }).length === 0, "a forged key / unknown vendor selects nothing");
  ok(pickIsEmpty({ ticked: [" "], vendors: [""], allVendors: false }) && !pickIsEmpty({ ticked: [], vendors: [], allVendors: true }), "empty pick");
  const vc = vendorCounts(rows.slice(0, 5));
  ok(vc[0].vendor === "Phat Panda" && vc[0].n === 2 && vc.at(-1)!.vendor === "No vendor", "counts: biggest first, No vendor last");
  const picked = pickByVendors(rows, { ticked: [], vendors: [], allVendors: true });
  const s1 = pickSummary(picked, ["a", "b", "c"], { already: 1, capped: true, cap: 3, mode: "overnight" });
  ok(s1.startsWith("🌙 Added 3 products from 2 vendors to the overnight batch: Phat Panda (2), Hollingsworth (1).") && s1.includes("1 already waiting.") && s1.includes("not added yet: 1 product (Fifty Fold)"), "summary names the vendors, counts, the cap leftovers");
  ok(pickSummary(picked.slice(0, 1), ["a"], { already: 0, capped: false, cap: 9, mode: "live" }) === "⚡ Added 1 product from 1 vendor for a live all-fields AI draft: Phat Panda (1).", "live summary");
  const T = Date.parse("2026-05-01T20:00:00Z");
  const iso = (ms: number) => new Date(ms).toISOString();
  const items: BatchItemLite[] = [
    { key: "a", name: "A", vendor: "Phat Panda", status: "queued", at: iso(T), error: null },
    { key: "b", name: "B", vendor: "Phat Panda", status: "done", at: iso(T), error: null },
    { key: "c", name: "C", vendor: "Hollingsworth", status: "failed", at: iso(T), error: "x" },
    { key: "d", name: "D", vendor: "Hollingsworth", status: "sent", at: iso(T), error: null },
    { key: "e", name: "E", vendor: null, status: "canceled", at: iso(T), error: null },
  ];
  const bd = batchVendorBreakdown(items);
  ok(bd.length === 2 && bd[0].vendor === "Hollingsworth" && bd[0].failed === 1 && bd[0].atGoogle === 1 && bd[1].waiting === 1 && bd[1].drafted === 1, "breakdown per vendor, canceled left out");
  ok(vendorBreakdownLine(bd[1]) === "Phat Panda: 2 products · 1 waiting · 1 drafted", "breakdown line");
  const base = { nowMs: T + 30_000, gatherMs: 120_000, sendMax: 200, openBatches: 0, maxOpen: 3, backoffUntil: null };
  const t1 = batchTimingText(items, base)!;
  ok(t1.startsWith("Not yet - it gathers presses for 2 minutes") && t1.includes("within 24 hours"), "gathering: says not yet + when");
  ok(batchTimingText(items, { ...base, nowMs: T + 200_000 })!.startsWith("Ready to go"), "after the gather: next free minute");
  ok(batchTimingText(items, { ...base, openBatches: 3 })!.startsWith("3 batches are already at Google"), "max open");
  ok(batchTimingText(items, { ...base, backoffUntil: iso(T + 3_600_000) })!.startsWith("Google refused the last send"), "back-off");
  const many: BatchItemLite[] = Array.from({ length: 450 }, (_, i) => ({ key: `k${i}`, name: "", vendor: "V", status: "queued", at: iso(T), error: null }));
  ok(batchTimingText(many, base)!.includes("go as 3 batches of up to 200"), "big runs go as several batches");
  ok(batchTimingText([items[3]], base)!.startsWith("1 product is at Google") && batchTimingText([items[1]], base) === null, "only at Google / nothing waiting");
  const rq = requeueFailed([{ key: "c", status: "failed", attempts: 2, error: "x", at: null, batchId: "B", req: {} }, { key: "b", status: "done", attempts: 1, error: null, at: null, batchId: "B", req: null }], iso(T));
  ok(rq.requeued === 1 && rq.items[0].status === "queued" && rq.items[0].attempts === 0 && rq.items[0].error === null && rq.items[0].batchId === null && rq.items[1].status === "done", "re-queue the failed only, fresh tries");
  return { passed, failed };
}
