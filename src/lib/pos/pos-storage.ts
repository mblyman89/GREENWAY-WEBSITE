/**
 * pos/pos-storage — the ONE storage entry point for the register client.
 *
 * Every register read/write goes through `posStorage` instead of touching
 * `window.localStorage` directly. That single seam is what lets the SAME
 * source code run in two places, exactly like `posFetch()` did for the network:
 *
 *   - Browser PWA at /pos   -> the localStorage backend -> byte-for-byte the
 *                              behavior the register has always had.
 *   - Packaged iPad app     -> a durable native backend (SQLCipher-encrypted
 *                              SQLite) installed at boot, with no change to a
 *                              single call site.
 *
 * All rules live in the PURE `pos-storage-core` module (99 self-tests). This
 * file holds only the small amount of mutable state needed to serve
 * synchronous reads.
 *
 * WHY A SYNCHRONOUS FACADE OVER AN ASYNC BACKEND
 * ----------------------------------------------
 * `RegisterShell.tsx` reads storage synchronously in 38 places and
 * `SaleFlow.tsx` in 4 more — inside render paths and mount effects. Every
 * Capacitor storage API is asynchronous. Converting 42 call sites to promises
 * would rewrite the money path, the medical gate and the offline queue in one
 * change, which is exactly how a register breaks at the counter.
 *
 * Instead this seam keeps an in-memory MIRROR of every registered key:
 *
 *   - `hydrate()` fills the mirror once at boot (await it before rendering
 *     the register).
 *   - `getItem()` answers from the mirror — synchronous, no await, no change
 *     to any existing call site.
 *   - `setItem()` writes the mirror FIRST (so the very next synchronous read
 *     is correct even if the disk write is still in flight) and then persists
 *     through the backend.
 *
 * The mirror is not a cache that can miss: it is the authoritative in-process
 * copy, and the backend is the durable copy behind it. That is the same shape
 * the register already relied on — localStorage was always a synchronous
 * mirror of a file on disk — so nothing about the shell's assumptions changes.
 *
 * FAILURE POSTURE
 * A backend write that throws must NEVER unmount the React tree. Failures are
 * caught, recorded, and surfaced as plain-English alerts chosen by
 * `writeFailureAlert()`; the in-memory value keeps serving so the register can
 * finish the sale in front of it.
 */
import {
  allStorageKeys,
  corruptionOutcome,
  findKeySpec,
  hydrationPlan,
  plannedWrite,
  readinessVerdict,
  writeFailureAlert,
  writeFailureBlocksSales,
  type ReadinessVerdict,
} from "./pos-storage-core";

/**
 * What a durable backend must provide. Deliberately tiny and async so a native
 * plugin fits without adapting anything: three methods, string in/out.
 *
 * Phase 1.1 ships the web backend. The native SQLCipher backend lands behind
 * this same interface, which is why no call site changes when it does.
 */
export type PosStorageBackend = {
  /** Human-readable name for diagnostics ("browser storage", "encrypted database"). */
  readonly name: string;
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

// ---------------------------------------------------------------------------
// The localStorage backend (web PWA — today's behavior, unchanged)
// ---------------------------------------------------------------------------

/**
 * True when a usable Web Storage exists. Guarded rather than assumed: SSR has
 * no `window`, and Safari private mode can make `localStorage` throw on ACCESS
 * rather than returning null.
 */
function hasLocalStorage(): boolean {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch {
    return false;
  }
}

/** Backend used by the browser PWA. Every method mirrors what the shell did before. */
export const localStorageBackend: PosStorageBackend = {
  name: "browser storage",
  async getItem(key: string): Promise<string | null> {
    if (!hasLocalStorage()) return null;
    return window.localStorage.getItem(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    if (!hasLocalStorage()) return;
    window.localStorage.setItem(key, value);
  },
  async removeItem(key: string): Promise<void> {
    if (!hasLocalStorage()) return;
    window.localStorage.removeItem(key);
  },
};

/**
 * A backend that persists nothing. Used on the server (SSR) and as the safe
 * default before `hydrate()` installs a real one, so a stray read during
 * pre-render can never throw.
 */
export const memoryOnlyBackend: PosStorageBackend = {
  name: "memory only",
  async getItem(): Promise<string | null> {
    return null;
  },
  async setItem(): Promise<void> {
    /* nothing to do — the mirror already holds it */
  },
  async removeItem(): Promise<void> {
    /* nothing to do */
  },
};

// ---------------------------------------------------------------------------
// Seam state
// ---------------------------------------------------------------------------

let backend: PosStorageBackend = hasLocalStorage() ? localStorageBackend : memoryOnlyBackend;
let mirror = new Map<string, string>();
let hydrated = false;
/** Keys whose value could not be read at boot. */
let failedKeys: string[] = [];
/** Newest write-failure alert, or null. Shown by the shell. */
let writeAlert: string | null = null;
/** True when a CRITICAL value failed to persist — the shell must stop sales. */
let writeBlocksSales = false;

/**
 * Install a durable backend. Called once at boot BEFORE `hydrate()`.
 * The native app calls this with the encrypted-database backend; the browser
 * PWA never calls it and keeps localStorage.
 */
export function configurePosStorage(next: PosStorageBackend): void {
  backend = next;
}

/** The backend currently in use (diagnostics / the status footer). */
export function describePosStorage(): string {
  return backend.name;
}

/**
 * Load every registered key into the in-memory mirror.
 *
 * Ordered by `hydrationPlan()` so that if the app is killed mid-launch the
 * values that matter most are already in memory. A key that cannot be read is
 * recorded and DISCARDED (per `corruptionOutcome`) rather than left to fail
 * on every future boot.
 *
 * Safe to call more than once; the second call re-reads and replaces the
 * mirror atomically, so a partial failure never leaves a half-empty mirror in
 * place of a good one.
 */
export async function hydratePosStorage(): Promise<ReadinessVerdict> {
  const next = new Map<string, string>();
  const failed: string[] = [];

  for (const key of hydrationPlan()) {
    try {
      const raw = await backend.getItem(key);
      if (raw !== null && raw !== undefined) next.set(key, raw);
    } catch {
      // Reading threw (quota, corrupt store, plugin error). Degrade exactly
      // the way parseQueue does: record it, drop the bytes, keep booting.
      const outcome = corruptionOutcome(key);
      failed.push(key);
      if (outcome.discardStored) {
        try {
          await backend.removeItem(key);
        } catch {
          /* nothing more we can do; the value simply stays unreadable */
        }
      }
    }
  }

  mirror = next;
  failedKeys = failed;
  hydrated = true;
  return readinessVerdict(true, failedKeys);
}

/** Whether the mirror has been filled. */
export function isPosStorageHydrated(): boolean {
  return hydrated;
}

/** Current readiness — drives the "do not ring sales" banner. */
export function posStorageReadiness(): ReadinessVerdict {
  return readinessVerdict(hydrated, failedKeys);
}

/** The newest write-failure alert, or null when writes are healthy. */
export function posStorageWriteAlert(): string | null {
  return writeAlert;
}

/** True when a critical value failed to persist and sales must stop. */
export function posStorageWriteBlocksSales(): boolean {
  return writeBlocksSales;
}

/** Clear a write alert once a later write to the same tier succeeds. */
export function clearPosStorageWriteAlert(): void {
  writeAlert = null;
  writeBlocksSales = false;
}

// ---------------------------------------------------------------------------
// The synchronous facade — what every call site uses
// ---------------------------------------------------------------------------

/**
 * Read a value. Synchronous, so it is a drop-in for
 * `window.localStorage.getItem(...)` at all 42 existing call sites.
 *
 * Before hydration this answers from whatever the mirror already holds (empty
 * at first). The shell must not ring sales until `posStorageReadiness().mayRing`
 * is true, which is precisely what that verdict exists to enforce.
 */
export function posStorageGet(key: string): string | null {
  return mirror.get(key) ?? null;
}

/**
 * Write a value. The mirror is updated synchronously so the next read is
 * correct; the durable write happens in the background.
 *
 * Returns immediately. Persistence failures surface through
 * `posStorageWriteAlert()` rather than by throwing, because throwing here
 * would unmount the register mid-sale.
 */
export function posStorageSet(key: string, value: string): void {
  const plan = plannedWrite(key, value);
  if (plan.rejected) {
    // A programming error, not a runtime condition: refuse loudly in dev.
    console.error(`pos-storage: ${plan.rejected}`);
    return;
  }
  if (plan.writeMemory) mirror.set(key, value);
  if (plan.writeDurable) {
    void backend.setItem(key, value).catch(() => {
      writeAlert = writeFailureAlert(key);
      if (writeFailureBlocksSales(key)) writeBlocksSales = true;
    });
  }
}

/** Remove a value. Same contract as `posStorageSet`. */
export function posStorageRemove(key: string): void {
  const plan = plannedWrite(key, null);
  if (plan.rejected) {
    console.error(`pos-storage: ${plan.rejected}`);
    return;
  }
  if (plan.writeMemory) mirror.delete(key);
  if (plan.writeDurable) {
    void backend.removeItem(key).catch(() => {
      writeAlert = writeFailureAlert(key);
      if (writeFailureBlocksSales(key)) writeBlocksSales = true;
    });
  }
}

/**
 * Await the durable write for a value that MUST be on disk before continuing
 * (the queue after a completed sale). Returns true when it landed.
 *
 * The synchronous `posStorageSet` is right for almost everything, but a
 * completed sale is money: the caller may want to know the bytes are safe.
 */
export async function posStorageFlush(key: string): Promise<boolean> {
  const value = mirror.get(key);
  try {
    if (value === undefined) await backend.removeItem(key);
    else await backend.setItem(key, value);
    return true;
  } catch {
    writeAlert = writeFailureAlert(key);
    if (writeFailureBlocksSales(key)) writeBlocksSales = true;
    return false;
  }
}

/**
 * Reset the seam. TEST-ONLY: lets a test start from a known state without
 * reaching into module internals.
 */
export function __resetPosStorageForTests(): void {
  backend = memoryOnlyBackend;
  mirror = new Map();
  hydrated = false;
  failedKeys = [];
  writeAlert = null;
  writeBlocksSales = false;
}

/** Snapshot of the mirror. TEST-ONLY / diagnostics. */
export function __posStorageSnapshotForTests(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of allStorageKeys()) {
    const v = mirror.get(key);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

/** The spec behind a key, re-exported so call sites need only this module. */
export { findKeySpec };
