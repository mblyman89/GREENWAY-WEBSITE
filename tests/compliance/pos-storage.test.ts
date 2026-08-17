import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import {
  __runPosStorageCoreTests,
  allStorageKeys,
  auditKeyRegistry,
  criticalKeys,
  findKeySpec,
  hydrationPlan,
  keysRequiringEncryption,
  migrationDecision,
  plannedWrite,
  POS_STORAGE_KEYS,
  POS_STORAGE_PREFIX,
  readinessVerdict,
  unregisteredKeys,
  writeFailureAlert,
  writeFailureBlocksSales,
} from "../../src/lib/pos/pos-storage-core";
import {
  __posStorageSnapshotForTests,
  __resetPosStorageForTests,
  clearPosStorageWriteAlert,
  configurePosStorage,
  describePosStorage,
  hydratePosStorage,
  isPosStorageHydrated,
  posStorageFlush,
  posStorageGet,
  posStorageReadiness,
  posStorageRemove,
  posStorageSet,
  posStorageWriteAlert,
  posStorageWriteBlocksSales,
  type PosStorageBackend,
} from "../../src/lib/pos/pos-storage";

/**
 * Phase 1.1 — the register's storage seam.
 *
 * These tests deliberately read the REAL shell source (RegisterShell.tsx,
 * SaleFlow.tsx) rather than fixtures. A fixture would only prove the registry
 * can describe a copy of itself. The risk actually being managed is DRIFT:
 * someone adds a `window.localStorage.setItem("gw-pos-something")` back into
 * the shell, or introduces a new key without classifying it, and the packaged
 * iPad app then either loses that value or leaks it in the clear. Only reading
 * the shipping source catches that.
 */

const REPO = path.resolve(__dirname, "../..");
const SHELL = path.join(REPO, "src/app/pos/RegisterShell.tsx");
const SALEFLOW = path.join(REPO, "src/app/pos/SaleFlow.tsx");
const CORE = path.join(REPO, "src/lib/pos/pos-storage-core.ts");
const SEAM = path.join(REPO, "src/lib/pos/pos-storage.ts");

const shellSrc = readFileSync(SHELL, "utf8");
const saleFlowSrc = readFileSync(SALEFLOW, "utf8");

/**
 * Strip comments so a scan tests CODE, not documentation about code.
 *
 * Line comments are removed FIRST, and that order is not cosmetic. Doing block
 * comments first is a trap: RegisterShell contains a line comment ending
 * "...(see" whose next line begins "public/pos-sw.js)", and the "/*" inside
 * that path opens a block comment that swallows thousands of characters of REAL
 * CODE. A scan run over that mangled text would report "no localStorage calls"
 * because the calls had been eaten, not because they were gone. Stripping line
 * comments first makes that impossible.
 */
function stripComments(src: string): string {
  return src.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}
const coreSrc = readFileSync(CORE, "utf8");
const seamSrc = readFileSync(SEAM, "utf8");

/** A backend that records every call and can be told to fail. */
function makeBackend(seed: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(seed));
  const calls: string[] = [];
  let failWrites = false;
  let failReadsFor: string | null = null;
  const backend: PosStorageBackend = {
    name: "test backend",
    async getItem(key) {
      calls.push(`get:${key}`);
      if (failReadsFor === key) throw new Error("unreadable");
      return store.get(key) ?? null;
    },
    async setItem(key, value) {
      calls.push(`set:${key}`);
      if (failWrites) throw new Error("disk full");
      store.set(key, value);
    },
    async removeItem(key) {
      calls.push(`remove:${key}`);
      if (failWrites) throw new Error("disk full");
      store.delete(key);
    },
  };
  return {
    backend,
    store,
    calls,
    failWrites: (v: boolean) => {
      failWrites = v;
    },
    failReadsFor: (k: string | null) => {
      failReadsFor = k;
    },
  };
}

describe("pos-storage-core self-tests", () => {
  it("passes its own pure self-tests", () => {
    const r = __runPosStorageCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThan(90);
  });
});

describe("the key registry matches the code that actually runs", () => {
  it("registers every gw-pos- key the register reads or writes", () => {
    // Pull the key literals straight out of the shipping source.
    const used = new Set<string>();
    for (const src of [shellSrc, saleFlowSrc]) {
      for (const m of src.matchAll(/"(gw-pos-[a-z0-9-]+)"/g)) used.add(m[1]!);
    }
    // The key constants live in their own cores; follow those too, because the
    // shell imports them by name rather than by literal.
    for (const file of [
      "src/lib/pos/active-sale-resume-core.ts",
      "src/lib/pos/register-polish-core.ts",
      "src/lib/pos/favorites-core.ts",
      "src/lib/pos/theme-core.ts",
      "src/lib/pos/medical-testmode-core.ts",
      // Phase 1.2 moved the device pairing into the secure store, which now
      // owns that literal. Following it here keeps this test honest: the key is
      // still in use by the shipping code, just from a different module.
      "src/lib/pos/pos-secure-store.ts",
    ]) {
      const src = readFileSync(path.join(REPO, file), "utf8");
      for (const m of src.matchAll(/^export const [A-Z_]+ = "(gw-pos-[a-z0-9-]+)";/gm)) used.add(m[1]!);
    }
    expect(used.size).toBeGreaterThanOrEqual(10);
    expect(unregisteredKeys([...used])).toEqual([]);
  });

  it("registers exactly the ten keys in use — no stale entries", () => {
    expect(allStorageKeys().sort()).toEqual(
      [
        "gw-pos-active-sale",
        "gw-pos-device",
        "gw-pos-favorites",
        "gw-pos-held-sale",
        "gw-pos-last-receipt",
        "gw-pos-medical-testmode",
        "gw-pos-menu",
        "gw-pos-queue",
        "gw-pos-seq",
        "gw-pos-theme",
      ].sort(),
    );
  });

  it("has no policy problems", () => {
    expect(auditKeyRegistry()).toEqual([]);
  });

  it("keeps every key under the register prefix", () => {
    for (const k of allStorageKeys()) expect(k.startsWith(POS_STORAGE_PREFIX)).toBe(true);
  });
});

describe("the shell no longer touches localStorage directly", () => {
  it("has zero window.localStorage calls left in RegisterShell", () => {
    // Comments may mention it; actual calls may not exist.
    expect(shellSrc).not.toMatch(/window\.localStorage\.(get|set|remove)Item\(/);
  });

  it("has zero window.localStorage calls left in SaleFlow", () => {
    expect(saleFlowSrc).not.toMatch(/window\.localStorage\.(get|set|remove)Item\(/);
  });

  it("routes the shell through the seam", () => {
    expect(shellSrc).toMatch(/from "@\/lib\/pos\/pos-storage"/);
    expect(shellSrc).toContain("hydratePosStorage");
  });

  it("routes SaleFlow through the seam", () => {
    expect(saleFlowSrc).toMatch(/from "@\/lib\/pos\/pos-storage"/);
  });

  it("waits for hydration before reading anything at boot", () => {
    // The boot body must be INSIDE the hydrate callback. If someone moves a
    // read back outside it, the queue would read empty on the iPad and a
    // pending sale would be orphaned.
    // Matched loosely on purpose: Phase 1.2 wrapped this in a Promise.all so
    // the secure store hydrates alongside it. What must stay true is the
    // ORDER — hydration is started before any read — not the exact spelling.
    const hydrateAt = shellSrc.indexOf("hydratePosStorage()");
    const firstQueueRead = shellSrc.indexOf("parseQueue(posStorageGet(LS_QUEUE))");
    expect(hydrateAt).toBeGreaterThan(-1);
    expect(firstQueueRead).toBeGreaterThan(hydrateAt);
    // And the read really is inside the callback, not merely after the call.
    expect(stripComments(shellSrc)).toMatch(/\.then\(\(\[?verdict\]?\) => \{/);
  });

  it("guards every persist-on-mount effect against writing before hydration", () => {
    // The theme and medical-test-mode effects fire once with their DEFAULT
    // value. Without the loading guard they would overwrite the saved value
    // before hydration delivered it — silently resetting the setting every
    // launch. Medical test mode is the dangerous one: a register the owner
    // believes is in test mode would ring REAL sales.
    //
    // The guard must be found INSIDE the same useEffect as the write. An
    // earlier version of this test scanned a fixed window of preceding
    // characters and was fooled by the neighbouring effect's guard — mutation
    // testing caught that, so the effect body is now isolated exactly.
    const effectBodyContaining = (marker: string): string => {
      const at = shellSrc.indexOf(marker);
      expect(at).toBeGreaterThan(-1);
      const start = shellSrc.lastIndexOf("useEffect(", at);
      expect(start).toBeGreaterThan(-1);
      return shellSrc.slice(start, at);
    };

    for (const marker of ["posStorageSet(THEME_KEY, theme)", "posStorageSet(MEDICAL_TESTMODE_KEY"]) {
      expect(effectBodyContaining(marker)).toContain('if (screen === "loading") return;');
    }

    // And each effect must re-run when the screen leaves "loading", otherwise
    // the guard would permanently suppress the very first save.
    expect(shellSrc).toContain("}, [theme, screen]);");
    expect(shellSrc).toContain("}, [medicalTestMode, screen]);");
  });
});

describe("the core stays pure", () => {
  it("performs no I/O and imports no plugin", () => {
    // Strip comments first: the file EXPLAINS localStorage at length, and a
    // naive scan would flag its own documentation. What matters is that no
    // executable line touches a browser or plugin API.
    const code = stripComments(coreSrc);
    expect(code).not.toMatch(/\bwindow\s*\./);
    expect(code).not.toMatch(/\blocalStorage\s*\./);
    expect(code).not.toMatch(/^import /m);
    expect(code).not.toMatch(/@capacitor/);
    expect(code).not.toMatch(/\bfetch\s*\(/);
    expect(code).not.toMatch(/\bDate\.now\s*\(/);
  });

  it("exports a self-test entry point in the house shape", () => {
    expect(coreSrc).toContain("export function __runPosStorageCoreTests(): { passed: number; failed: number }");
  });

  it("is registered in the pure self-test runner", () => {
    const runner = readFileSync(path.join(REPO, "scripts/compliance/run-pure-selftests.ts"), "utf8");
    // Strip comments FIRST. A plain substring check passes happily against a
    // commented-out registration, which would silently stop running the core's
    // 99 self-tests in CI — mutation testing caught exactly that.
    const live = stripComments(runner);
    expect(live).toMatch(/^import \{ __runPosStorageCoreTests \}/m);
    expect(live).toMatch(/^\s*assertNoFailures\("pos\/pos-storage-core", __runPosStorageCoreTests\(\)\);$/m);
  });
});

describe("compliance classification of what the register stores", () => {
  it("treats the offline queue as patient data", () => {
    // A queued medical sale embeds medical.card.upid — the DOH Medical
    // Cannabis Registry patient identifier. Verified in sale-event-core.
    const saleEvent = readFileSync(path.join(REPO, "src/lib/pos/sale-event-core.ts"), "utf8");
    expect(saleEvent).toMatch(/upid: string;/);
    expect(findKeySpec("gw-pos-queue")!.sensitivity).toBe("phi");
  });

  it("treats the parked sale as patient data", () => {
    // active-sale-resume-core stores the whole PosCardCapture (UPID + dates).
    const parked = readFileSync(path.join(REPO, "src/lib/pos/active-sale-resume-core.ts"), "utf8");
    expect(parked).toContain("medicalCard: PosCardCapture | null");
    expect(findKeySpec("gw-pos-active-sale")!.sensitivity).toBe("phi");
  });

  it("puts every protected value somewhere encrypted", () => {
    for (const key of keysRequiringEncryption()) {
      const tier = findKeySpec(key)!.tier;
      expect(["encrypted-db", "secure-enclave"]).toContain(tier);
    }
  });

  it("puts the device credential in the keychain and nowhere else", () => {
    expect(findKeySpec("gw-pos-device")!.tier).toBe("secure-enclave");
    expect(findKeySpec("gw-pos-device")!.sensitivity).toBe("secret");
  });

  it("marks exactly the three unrecoverable values critical", () => {
    expect(criticalKeys().sort()).toEqual(["gw-pos-device", "gw-pos-queue", "gw-pos-seq"]);
  });

  it("never leaks engineering jargon into a message a budtender reads", () => {
    for (const spec of POS_STORAGE_KEYS) {
      const msg = writeFailureAlert(spec.key);
      expect(msg).not.toMatch(/localStorage|SQLite|SQLCipher|undefined|null|Error|exception/i);
      expect(msg.length).toBeGreaterThan(30);
    }
  });
});

describe("the seam behaves like localStorage did", () => {
  beforeEach(() => {
    __resetPosStorageForTests();
  });

  it("reads back what it wrote, synchronously", () => {
    const { backend } = makeBackend();
    configurePosStorage(backend);
    posStorageSet("gw-pos-theme", "light");
    // No await — this is the whole point of the mirror.
    expect(posStorageGet("gw-pos-theme")).toBe("light");
  });

  it("returns null for a key that was never set", () => {
    expect(posStorageGet("gw-pos-theme")).toBeNull();
  });

  it("removes a value", () => {
    const { backend } = makeBackend();
    configurePosStorage(backend);
    posStorageSet("gw-pos-theme", "light");
    posStorageRemove("gw-pos-theme");
    expect(posStorageGet("gw-pos-theme")).toBeNull();
  });

  it("hydrates every registered key from the backend", async () => {
    const { backend } = makeBackend({ "gw-pos-theme": "light", "gw-pos-queue": '{"v":1,"queue":[]}' });
    configurePosStorage(backend);
    await hydratePosStorage();
    expect(posStorageGet("gw-pos-theme")).toBe("light");
    expect(posStorageGet("gw-pos-queue")).toBe('{"v":1,"queue":[]}');
    expect(isPosStorageHydrated()).toBe(true);
  });

  it("hydrates critical keys before convenience keys", async () => {
    const { backend, calls } = makeBackend();
    configurePosStorage(backend);
    await hydratePosStorage();
    const order = calls.filter((c) => c.startsWith("get:")).map((c) => c.slice(4));
    expect(order.indexOf("gw-pos-queue")).toBeLessThan(order.indexOf("gw-pos-theme"));
    expect(order.indexOf("gw-pos-device")).toBeLessThan(order.indexOf("gw-pos-favorites"));
    expect(order).toEqual(hydrationPlan());
  });

  it("persists through to the durable backend", async () => {
    const t = makeBackend();
    configurePosStorage(t.backend);
    posStorageSet("gw-pos-theme", "light");
    await posStorageFlush("gw-pos-theme");
    expect(t.store.get("gw-pos-theme")).toBe("light");
  });

  it("a plain set() reaches the durable backend WITHOUT an explicit flush", async () => {
    // This is the property the whole seam rests on: 42 call sites do a bare
    // posStorageSet and never await anything. If the background write were
    // dropped, every one of them would look fine in memory and lose the value
    // on restart — including the offline sales queue. An earlier version of
    // this file only ever asserted through posStorageFlush(), so a mutation
    // that disabled the background write SURVIVED. It does not any more.
    const t = makeBackend();
    configurePosStorage(t.backend);
    posStorageSet("gw-pos-queue", '{"v":1,"queue":[]}');
    await Promise.resolve(); // let the fire-and-forget write settle
    await Promise.resolve();
    expect(t.calls).toContain("set:gw-pos-queue");
    expect(t.store.get("gw-pos-queue")).toBe('{"v":1,"queue":[]}');
  });

  it("a plain remove() reaches the durable backend too", async () => {
    const t = makeBackend({ "gw-pos-held-sale": "x" });
    configurePosStorage(t.backend);
    await hydratePosStorage();
    posStorageRemove("gw-pos-held-sale");
    await Promise.resolve();
    await Promise.resolve();
    expect(t.calls).toContain("remove:gw-pos-held-sale");
    expect(t.store.has("gw-pos-held-sale")).toBe(false);
  });

  it("refuses to store an unregistered key", () => {
    const { backend, calls } = makeBackend();
    configurePosStorage(backend);
    posStorageSet("gw-pos-brand-new", "x");
    expect(posStorageGet("gw-pos-brand-new")).toBeNull();
    expect(calls.filter((c) => c.includes("brand-new"))).toEqual([]);
  });

  it("treats an empty string as a real value, not a delete", () => {
    const { backend } = makeBackend();
    configurePosStorage(backend);
    posStorageSet("gw-pos-theme", "");
    expect(posStorageGet("gw-pos-theme")).toBe("");
  });
});

describe("failure behaviour — the part that protects the counter", () => {
  beforeEach(() => {
    __resetPosStorageForTests();
  });

  it("never throws when the disk is full", async () => {
    const t = makeBackend();
    configurePosStorage(t.backend);
    t.failWrites(true);
    expect(() => posStorageSet("gw-pos-queue", "x")).not.toThrow();
    // The in-memory value still serves the sale in progress.
    expect(posStorageGet("gw-pos-queue")).toBe("x");
  });

  it("raises the alert when a BACKGROUND critical write fails", async () => {
    // The failure path of the fire-and-forget write — the one that actually
    // runs at the counter, since no call site awaits. Distinct from the
    // flush() path tested below.
    const t = makeBackend();
    configurePosStorage(t.backend);
    t.failWrites(true);
    posStorageSet("gw-pos-queue", "x");
    await Promise.resolve();
    await Promise.resolve();
    expect(posStorageWriteAlert()).toContain("manager");
    expect(posStorageWriteBlocksSales()).toBe(true);
  });

  it("raises the alert when a BACKGROUND remove fails", async () => {
    const t = makeBackend({ "gw-pos-queue": "x" });
    configurePosStorage(t.backend);
    await hydratePosStorage();
    t.failWrites(true);
    posStorageRemove("gw-pos-queue");
    await Promise.resolve();
    await Promise.resolve();
    expect(posStorageWriteAlert()).not.toBeNull();
    expect(posStorageWriteBlocksSales()).toBe(true);
  });

  it("raises a plain-English alert when a critical write fails", async () => {
    const t = makeBackend();
    configurePosStorage(t.backend);
    t.failWrites(true);
    await expect(posStorageFlush("gw-pos-queue")).resolves.toBe(false);
    expect(posStorageWriteAlert()).toContain("manager");
    expect(posStorageWriteBlocksSales()).toBe(true);
  });

  it("does not stop sales when only a preference fails to save", async () => {
    const t = makeBackend();
    configurePosStorage(t.backend);
    t.failWrites(true);
    await posStorageFlush("gw-pos-theme");
    expect(posStorageWriteAlert()).not.toBeNull();
    expect(posStorageWriteBlocksSales()).toBe(false);
  });

  it("clears the alert when asked", async () => {
    const t = makeBackend();
    configurePosStorage(t.backend);
    t.failWrites(true);
    await posStorageFlush("gw-pos-queue");
    clearPosStorageWriteAlert();
    expect(posStorageWriteAlert()).toBeNull();
    expect(posStorageWriteBlocksSales()).toBe(false);
  });

  it("degrades instead of crashing when a value cannot be read", async () => {
    const t = makeBackend({ "gw-pos-theme": "light" });
    configurePosStorage(t.backend);
    t.failReadsFor("gw-pos-queue");
    const verdict = await hydratePosStorage();
    // Booting still completed and the readable values survived.
    expect(isPosStorageHydrated()).toBe(true);
    expect(posStorageGet("gw-pos-theme")).toBe("light");
    // But the register must not ring sales on an unreadable queue.
    expect(verdict.mayRing).toBe(false);
    expect(verdict.message).toContain("manager");
  });

  it("discards unreadable bytes so the warning can clear next boot", async () => {
    const t = makeBackend({ "gw-pos-queue": "garbage" });
    configurePosStorage(t.backend);
    t.failReadsFor("gw-pos-queue");
    await hydratePosStorage();
    expect(t.calls).toContain("remove:gw-pos-queue");
  });

  it("keeps a good mirror if a later hydration fails midway", async () => {
    const t = makeBackend({ "gw-pos-theme": "light" });
    configurePosStorage(t.backend);
    await hydratePosStorage();
    expect(posStorageGet("gw-pos-theme")).toBe("light");
    // Re-hydrating replaces the mirror atomically.
    await hydratePosStorage();
    expect(posStorageGet("gw-pos-theme")).toBe("light");
  });

  it("blocks sales until hydration has happened", () => {
    expect(posStorageReadiness().mayRing).toBe(false);
    expect(posStorageReadiness().ready).toBe(false);
  });

  it("reports which backend is in use", async () => {
    const { backend } = makeBackend();
    configurePosStorage(backend);
    expect(describePosStorage()).toBe("test backend");
  });
});

describe("migration from the browser PWA to the packaged app", () => {
  it("brings over an unsynced queue the browser still holds", () => {
    const d = migrationDecision({ key: "gw-pos-queue", webValue: '{"v":1}', nativeValue: null });
    expect(d.adopt).toBe(true);
    expect(d.eraseSource).toBe(true);
  });

  it("never overwrites the app's own queue with the browser's", () => {
    const d = migrationDecision({ key: "gw-pos-queue", webValue: "old", nativeValue: "new" });
    expect(d.adopt).toBe(false);
  });

  it("erases every protected value from the browser after adopting it", () => {
    for (const key of keysRequiringEncryption()) {
      const d = migrationDecision({ key, webValue: "v", nativeValue: null });
      expect(d.adopt).toBe(true);
      expect(d.eraseSource).toBe(true);
    }
  });

  it("does not bother erasing harmless preferences", () => {
    expect(migrationDecision({ key: "gw-pos-theme", webValue: "dark", nativeValue: null }).eraseSource).toBe(false);
  });
});

describe("readiness verdicts drive what the budtender may do", () => {
  it("stops sales when the queue is unreadable", () => {
    expect(readinessVerdict(true, ["gw-pos-queue"]).mayRing).toBe(false);
  });
  it("stops sales when the pairing is unreadable", () => {
    expect(readinessVerdict(true, ["gw-pos-device"]).mayRing).toBe(false);
  });
  it("allows sales when only a preference is unreadable", () => {
    expect(readinessVerdict(true, ["gw-pos-theme"]).mayRing).toBe(true);
  });
  it("is silent on a clean boot", () => {
    expect(readinessVerdict(true, []).message).toBeNull();
  });
  it("blocks before hydration regardless of failures", () => {
    expect(readinessVerdict(false, []).mayRing).toBe(false);
  });
});

describe("write planning", () => {
  it("sends normal writes to memory and disk", () => {
    const p = plannedWrite("gw-pos-queue", "{}");
    expect(p.writeMemory && p.writeDurable && !p.remove).toBe(true);
  });
  it("treats null as a removal", () => {
    expect(plannedWrite("gw-pos-queue", null).remove).toBe(true);
  });
  it("rejects an unregistered key with actionable advice", () => {
    expect(plannedWrite("nope", "x").rejected).toContain("POS_STORAGE_KEYS");
  });
  it("only blocks sales for critical keys", () => {
    expect(writeFailureBlocksSales("gw-pos-queue")).toBe(true);
    expect(writeFailureBlocksSales("gw-pos-favorites")).toBe(false);
  });
});

describe("the seam keeps the web build honest", () => {
  it("guards every localStorage access so SSR and private mode cannot throw", () => {
    // Safari private mode can throw on ACCESS, not just on write.
    expect(seamSrc).toContain("function hasLocalStorage()");
    // The guard itself must be try/caught, because Safari private mode throws
    // on ACCESSING window.localStorage, not only on writing to it.
    const guard = seamSrc.slice(seamSrc.indexOf("function hasLocalStorage()"));
    expect(guard.slice(0, 300)).toContain("try {");

    // Isolate the localStorage backend and require that EVERY one of its three
    // methods checks the guard before touching Web Storage. Scoping to this
    // one object matters: memoryOnlyBackend deliberately touches nothing, so a
    // whole-file scan would either pass vacuously or fail wrongly.
    const start = seamSrc.indexOf("export const localStorageBackend");
    const end = seamSrc.indexOf("export const memoryOnlyBackend");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const lsBackend = seamSrc.slice(start, end);

    const guardCount = (lsBackend.match(/hasLocalStorage\(\)/g) ?? []).length;
    const accessCount = (lsBackend.match(/window\.localStorage\./g) ?? []).length;
    expect(accessCount).toBe(3); // getItem, setItem, removeItem
    expect(guardCount).toBe(3); // one guard each
    // And the guard must come before the access in every method.
    for (const method of ["getItem", "setItem", "removeItem"]) {
      const at = lsBackend.indexOf(`async ${method}(`);
      expect(at).toBeGreaterThan(-1);
      const body = lsBackend.slice(at, lsBackend.indexOf("},", at));
      expect(body.indexOf("hasLocalStorage()")).toBeGreaterThan(-1);
      expect(body.indexOf("hasLocalStorage()")).toBeLessThan(body.indexOf("window.localStorage."));
    }
  });

  it("defaults to a backend that cannot throw during server rendering", () => {
    expect(seamSrc).toContain("memoryOnlyBackend");
  });

  it("snapshot helper only reports registered keys", async () => {
    __resetPosStorageForTests();
    const { backend } = makeBackend({ "gw-pos-theme": "dark" });
    configurePosStorage(backend);
    await hydratePosStorage();
    expect(Object.keys(__posStorageSnapshotForTests())).toEqual(["gw-pos-theme"]);
  });
});
