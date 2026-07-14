"use client";

/**
 * RegisterShell (POS Slice B5) — the on-device register app shell.
 *
 * Screens:
 *   setup  — one-time device provisioning (device id + key from the back
 *            office; verified with an empty heartbeat flush, then stored).
 *   locked — the PIN lock screen. Whoever unlocks owns the session
 *            (research §6.1). Clock in/out lives here too.
 *   home   — the unlocked register: identity strip, drawer status, offline
 *            queue health, manual sync, and the sale entry point (Slice B6).
 *
 * Offline-first: every fact is enqueued locally (append-only, client-UUID
 * idempotent) and flushed to /api/pos/sync whenever online. Durable ACKs
 * (processed/duplicate/exception) clear queue rows; rejected rows are kept
 * and surfaced. The shell AUTO-LOCKS after every completed sale and after
 * an idle timeout so no sale can ride on someone else's PIN.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildEnvelope,
  applyAcks,
  nextFlushBatch,
  serializeQueue,
  parseQueue,
  highestSequence,
  type QueuedPosEvent,
} from "@/lib/pos/register-client-core";
import type { PosSyncAck } from "@/lib/pos/sync-core";
import type { PosEventType } from "@/lib/pos/sale-event-core";
import type { PosCartEntry, PosMenuBundle } from "@/lib/pos/sale-flow-core";
import {
  buildNoSaleSlipHtml,
  buildPassPrntUrl,
  buildPosReceiptHtml,
  receiptNumber,
  type PosReceiptInput,
} from "@/lib/pos/receipt-core";
import { normalizePosReceiptConfig, receiptAddressLines } from "@/lib/pos/receipt-config-core";
import { DENOM_FIELDS, EMPTY_DENOMS, denomTotalMinor, formatCents, type DenomCounts } from "@/lib/registers/cash";
import { dollarsToMinor } from "@/lib/pos/till-core";
import {
  LAST_RECEIPT_KEY,
  HELD_SALE_KEY,
  ageLabel,
  holdFromCart,
  parseHeldSale,
  parseLastReceipt,
  rebuildHeldCart,
  serializeHeldSale,
  serializeLastReceipt,
  type HeldSale,
} from "@/lib/pos/register-polish-core";
import { SaleFlow } from "./SaleFlow";

// ---------------------------------------------------------------------------
// Local storage keys (device-scoped; every durable fact lives server-side)
// ---------------------------------------------------------------------------

const LS_DEVICE = "gw-pos-device"; // { deviceId, deviceKey, name, registerId }
const LS_QUEUE = "gw-pos-queue"; // serialized offline queue
const LS_SEQ = "gw-pos-seq"; // last used sequence (monotonic)
const LS_MENU = "gw-pos-menu"; // cached PosMenuBundle (offline sales use the last download)
// B17 — LAST_RECEIPT_KEY ("gw-pos-last-receipt") and HELD_SALE_KEY
// ("gw-pos-held-sale") are defined in register-polish-core next to their
// serialize/parse validators so the key and the shape can never drift apart.

const IDLE_LOCK_MS = 2 * 60 * 1000; // auto-lock after 2 minutes of inactivity

type DeviceCreds = { deviceId: string; deviceKey: string; name: string; registerId: string | null };

type UnlockedEmployee = { id: string; fullName: string; jobRole: string; clockedIn: boolean };
type DrawerInfo = { sessionId: string; openedAt: string | null; businessDay: string } | null;

type Screen = "setup" | "locked" | "home";

function loadCreds(): DeviceCreds | null {
  try {
    const raw = window.localStorage.getItem(LS_DEVICE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DeviceCreds;
    if (!parsed?.deviceId || !parsed?.deviceKey) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function RegisterShell() {
  const [screen, setScreen] = useState<Screen | "loading">("loading");
  const [creds, setCreds] = useState<DeviceCreds | null>(null);
  const [employee, setEmployee] = useState<UnlockedEmployee | null>(null);
  const [drawer, setDrawer] = useState<DrawerInfo>(null);
  const [queue, setQueue] = useState<QueuedPosEvent[]>([]);
  const [rejected, setRejected] = useState<QueuedPosEvent[]>([]);
  const [online, setOnline] = useState(true);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [saleActive, setSaleActive] = useState(false);
  const [menuBundle, setMenuBundle] = useState<PosMenuBundle | null>(null);
  const [menuLoading, setMenuLoading] = useState(false);
  // B17 — the last frozen receipt snapshot (survives the post-sale auto-lock)
  // and the parked sale, both hydrated from localStorage at boot.
  const [lastReceipt, setLastReceipt] = useState<PosReceiptInput | null>(null);
  const [heldSale, setHeldSale] = useState<HeldSale | null>(null);
  // B17 — the cart a resumed hold seeds into the next SaleFlow mount.
  const [resumeCart, setResumeCart] = useState<PosCartEntry[] | null>(null);
  // B17 — no-sale modal visibility (manager PIN approval happens inside).
  const [noSaleOpen, setNoSaleOpen] = useState(false);
  // B21 — register-side till action in progress (count-in / drop / blind close).
  const [tillMode, setTillMode] = useState<"open" | "drop" | "close" | null>(null);
  const seqRef = useRef(0);
  const queueRef = useRef<QueuedPosEvent[]>([]);
  const flushingRef = useRef(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── boot: restore creds + queue ──
  // Mount-time hydration from localStorage (an external store). The one-time
  // setState burst here is intentional: SSR cannot read localStorage, the
  // component renders a "loading" screen until this runs, and reading window
  // in a useState initializer would cause a hydration mismatch instead.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    // POS B11 — register the tiny shell service worker so the Home-Screen
    // app boots offline. Scoped to "/pos" so it never collides with the
    // admin push worker (push-sw.js at scope "/"): a controlled /pos page
    // still routes ALL of its fetches — including /_next/static assets —
    // through this worker, and it never intercepts /api/* (see
    // public/pos-sw.js). Best-effort: registration failure (private mode,
    // old iPadOS) leaves the register fully online-only.
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/pos-sw.js", { scope: "/pos" }).catch(() => {});
    }
    const c = loadCreds();
    const parsed = parseQueue(window.localStorage.getItem(LS_QUEUE));
    const seqStored = Number(window.localStorage.getItem(LS_SEQ) ?? "0");
    seqRef.current = highestSequence(parsed.queue, Number.isFinite(seqStored) ? seqStored : 0);
    setQueue(parsed.queue.filter((r) => !r.rejectedReason));
    setRejected(parsed.queue.filter((r) => !!r.rejectedReason));
    if (parsed.droppedRows > 0) {
      setBanner(`${parsed.droppedRows} corrupted queue row(s) were dropped on startup — check recent activity in the back office.`);
    }
    setCreds(c);
    setScreen(c ? "locked" : "setup");
    setOnline(navigator.onLine);
    // B17 — last receipt + held sale survive restarts; validators return
    // null on any corruption so a bad blob can never garbage-print.
    setLastReceipt(parseLastReceipt(window.localStorage.getItem(LAST_RECEIPT_KEY)));
    setHeldSale(parseHeldSale(window.localStorage.getItem(HELD_SALE_KEY)));
    // Cached menu bundle (offline sales use the last download until refresh).
    try {
      const rawMenu = window.localStorage.getItem(LS_MENU);
      if (rawMenu) {
        const cached = JSON.parse(rawMenu) as PosMenuBundle;
        if (cached && Array.isArray(cached.products)) setMenuBundle(cached);
      }
    } catch {
      // Corrupted cache — the online refresh replaces it.
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // ── persist queue on change (and mirror into the ref flush() reads) ──
  useEffect(() => {
    queueRef.current = queue;
    if (screen === "loading") return;
    window.localStorage.setItem(LS_QUEUE, serializeQueue([...queue, ...rejected]));
    window.localStorage.setItem(LS_SEQ, String(seqRef.current));
  }, [queue, rejected, screen]);

  // ── enqueue + flush ──
  const enqueue = useCallback(
    (eventType: PosEventType, payload: Record<string, unknown>, employeeId: string): string | null => {
      if (!creds?.registerId) return null;
      const clientUuid = crypto.randomUUID();
      const { envelope, nextSequence } = buildEnvelope({
        clientUuid,
        deviceId: creds.deviceId,
        registerId: creds.registerId,
        employeeId,
        lastSequence: seqRef.current,
        eventType,
        payload,
        nowIso: new Date().toISOString(),
      });
      seqRef.current = nextSequence;
      setQueue((q) => [...q, envelope]);
      return clientUuid;
    },
    [creds],
  );

  const flush = useCallback(async () => {
    if (flushingRef.current || !creds) return;
    flushingRef.current = true;
    try {
      // queueRef mirrors the queue state (kept in sync by the persist effect),
      // so flush() always reads the freshest rows without impure setState tricks.
      const toSend = nextFlushBatch(queueRef.current);
      if (toSend.length === 0) return;
      const res = await fetch("/api/pos/sync", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-pos-device-id": creds.deviceId,
          "x-pos-device-key": creds.deviceKey,
        },
        body: JSON.stringify({ events: toSend }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        if (res.status === 401) setBanner(body?.error ?? "Device credentials rejected — see a manager.");
        return;
      }
      const { acks } = (await res.json()) as { acks: PosSyncAck[] };
      setQueue((q) => {
        const applied = applyAcks(q, acks);
        if (applied.rejected.length > 0) {
          setRejected((r) => [...r, ...applied.rejected]);
          setBanner(
            `${applied.rejected.length} event(s) were rejected by the server and kept for review: ${applied.rejected[0].rejectedReason ?? ""}`,
          );
        }
        return applied.remaining;
      });
      setLastSyncAt(new Date().toISOString());
    } catch {
      // Network hiccup — queue stays; the interval retries.
    } finally {
      flushingRef.current = false;
    }
  }, [creds]);

  // ── online/offline listeners (reconnect triggers an immediate flush) ──
  useEffect(() => {
    const up = () => {
      setOnline(true);
      void flush();
    };
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, [flush]);

  // ── background flush loop ──
  useEffect(() => {
    if (!creds) return;
    const id = setInterval(() => {
      if (navigator.onLine) void flush();
    }, 15_000);
    return () => clearInterval(id);
  }, [creds, flush]);

  // ── menu bundle: refresh when online, cache for offline sales ──
  const refreshMenu = useCallback(async () => {
    if (!creds || menuLoading) return;
    setMenuLoading(true);
    try {
      const res = await fetch("/api/pos/menu", {
        headers: {
          "x-pos-device-id": creds.deviceId,
          "x-pos-device-key": creds.deviceKey,
        },
      });
      if (!res.ok) return;
      const bundle = (await res.json()) as PosMenuBundle;
      setMenuBundle(bundle);
      try {
        window.localStorage.setItem(LS_MENU, JSON.stringify(bundle));
      } catch {
        // Cache write failure is non-fatal — the in-memory bundle still works.
      }
    } catch {
      // Offline — the cached bundle (loaded below) covers the sale.
    } finally {
      setMenuLoading(false);
    }
  }, [creds, menuLoading]);

  // Refresh the bundle from the server once creds exist (cached copy was
  // hydrated in the boot effect; offline sales use it until this succeeds).
  // The setState inside refreshMenu is a busy-flag around a network fetch
  // (external system), deferred to a microtask so the effect body stays pure.
  useEffect(() => {
    if (!creds) return;
    const t = setTimeout(() => void refreshMenu(), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creds]);

  // ── auto-lock on idle ──
  const lock = useCallback(() => {
    setEmployee(null);
    setSaleActive(false);
    setResumeCart(null);
    setNoSaleOpen(false);
    setScreen("locked");
  }, []);

  const touchIdle = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(lock, IDLE_LOCK_MS);
  }, [lock]);

  useEffect(() => {
    if (screen !== "home") return;
    touchIdle();
    const events = ["pointerdown", "keydown"] as const;
    events.forEach((e) => window.addEventListener(e, touchIdle));
    return () => {
      events.forEach((e) => window.removeEventListener(e, touchIdle));
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [screen, touchIdle]);

  // ── screen renders ──
  const pendingCount = queue.length;

  if (screen === "loading") {
    return <main className="flex min-h-screen items-center justify-center bg-neutral-950 text-neutral-400">Loading register…</main>;
  }

  if (screen === "setup" || !creds) {
    return (
      <SetupScreen
        onProvisioned={(c) => {
          window.localStorage.setItem(LS_DEVICE, JSON.stringify(c));
          setCreds(c);
          setScreen("locked");
        }}
      />
    );
  }

  if (screen === "locked") {
    return (
      <LockScreen
        creds={creds}
        online={online}
        pendingCount={pendingCount}
        banner={banner}
        onClearBanner={() => setBanner(null)}
        onUnlocked={(emp, drawerInfo, registerId) => {
          setEmployee(emp);
          setDrawer(drawerInfo);
          setCreds((c) => (c && c.registerId !== registerId ? { ...c, registerId } : c));
          setScreen("home");
        }}
        onPunch={(emp) => {
          const intent = emp.clockedIn ? "out" : "in";
          enqueue("punch", { intent }, emp.id);
          setBanner(`${emp.fullName}: clock-${intent} recorded${navigator.onLine ? "" : " (offline — will sync)"}.`);
          void flush();
        }}
      />
    );
  }

  if (saleActive && employee && drawer && menuBundle) {
    return (
      <SaleFlow
        bundle={menuBundle}
        drawerSessionId={drawer.sessionId}
        registerName={creds.name}
        employeeName={employee.fullName}
        initialCart={resumeCart ?? undefined}
        onHold={
          // One parked sale at a time (unless THIS sale is the resumed one —
          // it may be re-parked, replacing its own snapshot).
          heldSale && !resumeCart
            ? undefined
            : (cartLines) => {
                const hold = holdFromCart(cartLines, employee.fullName, new Date().toISOString());
                if (hold.lines.length === 0) return;
                try {
                  window.localStorage.setItem(HELD_SALE_KEY, serializeHeldSale(hold));
                } catch {
                  // Storage full — the in-memory hold still works this session.
                }
                setHeldSale(hold);
                setResumeCart(null);
                setSaleActive(false);
                setBanner(`Sale on hold (${hold.lines.reduce((s, l) => s + l.quantity, 0)} item(s)) — resume it from the home screen.`);
              }
        }
        onReceiptFrozen={(frozen) => {
          // B17 — persist the frozen snapshot so "reprint last receipt"
          // survives the post-sale auto-lock (and app restarts).
          try {
            window.localStorage.setItem(LAST_RECEIPT_KEY, serializeLastReceipt(frozen));
          } catch {
            // Storage full — reprint just won't survive a restart.
          }
          setLastReceipt(frozen);
          // A completed sale consumes the hold it was resumed from.
          if (resumeCart) {
            try {
              window.localStorage.removeItem(HELD_SALE_KEY);
            } catch {
              // Best-effort.
            }
            setHeldSale(null);
          }
        }}
        onMemberLookup={async (q) => {
          // POS B14 — member lookup is ONLINE-ONLY (no customer book is ever
          // cached on the iPad). Offline: ring the sale without the member.
          if (!navigator.onLine) {
            return { ok: false as const, error: "Offline — ring the sale without the member, or reconnect first." };
          }
          try {
            const res = await fetch(`/api/pos/member?q=${encodeURIComponent(q)}`, {
              headers: { "x-pos-device-id": creds.deviceId, "x-pos-device-key": creds.deviceKey },
            });
            const body = (await res.json().catch(() => null)) as
              | { members?: { customerId: string; label: string; points: number; tierName: string | null }[]; error?: string }
              | null;
            if (!res.ok || !body?.members) {
              return { ok: false as const, error: body?.error ?? "Lookup failed — try again." };
            }
            return { ok: true as const, members: body.members };
          } catch {
            return { ok: false as const, error: "Network error — try again or ring without the member." };
          }
        }}
        onEnqueue={(eventType, payload) => {
          const uuid = enqueue(eventType, payload, employee.id);
          void flush();
          return uuid ?? "";
        }}
        onComplete={() => {
          // Owner decision: the register locks after EVERY sale so the next
          // sale is PIN-attributed to whoever actually rings it.
          setBanner(null);
          lock();
          void flush();
        }}
        onCancel={() => {
          // A cancelled resume leaves the hold parked (nothing was sold).
          setResumeCart(null);
          setSaleActive(false);
        }}
      />
    );
  }

  return (
    <>
      <HomeScreen
        creds={creds}
        employee={employee!}
        drawer={drawer}
        online={online}
        pendingCount={pendingCount}
        rejectedCount={rejected.length}
        lastSyncAt={lastSyncAt}
        banner={banner}
        menuReady={!!menuBundle}
        menuFetchedAt={menuBundle?.fetchedAt ?? null}
        lastReceipt={lastReceipt}
        heldSale={heldSale}
        onStartSale={() => {
          setResumeCart(null);
          setSaleActive(true);
        }}
        onResumeHold={
          heldSale && menuBundle
            ? () => {
                // Rebuild against the CURRENT bundle: fresh prices, and
                // vanished/out-of-stock lines are dropped + reported.
                const rebuilt = rebuildHeldCart(heldSale, menuBundle.products);
                if (rebuilt.cart.length === 0) {
                  try {
                    window.localStorage.removeItem(HELD_SALE_KEY);
                  } catch {
                    // Best-effort.
                  }
                  setHeldSale(null);
                  setBanner("The held items are no longer sellable — the hold was cleared.");
                  return;
                }
                if (rebuilt.dropped.length > 0) {
                  setBanner(`Restored the held cart, but dropped: ${rebuilt.dropped.join(", ")}.`);
                }
                setResumeCart(rebuilt.cart);
                setSaleActive(true);
              }
            : undefined
        }
        onDiscardHold={
          heldSale
            ? () => {
                try {
                  window.localStorage.removeItem(HELD_SALE_KEY);
                } catch {
                  // Best-effort.
                }
                setHeldSale(null);
                setBanner("Held sale discarded.");
              }
            : undefined
        }
        onReprintLast={
          lastReceipt
            ? () => {
                const html = buildPosReceiptHtml(lastReceipt);
                const backUrl = window.location.origin + window.location.pathname;
                // Reprint NEVER pops the drawer — no cash moves on a reprint.
                window.location.href = buildPassPrntUrl(html, { backUrl, openDrawer: false });
              }
            : undefined
        }
        onNoSale={() => setNoSaleOpen(true)}
        onTill={(mode) => setTillMode(mode)}
        onRefreshMenu={() => void refreshMenu()}
        onClearBanner={() => setBanner(null)}
        onLock={lock}
        onSyncNow={() => void flush()}
        onPunch={() => {
          if (!employee) return;
          const intent = employee.clockedIn ? "out" : "in";
          enqueue("punch", { intent }, employee.id);
          setEmployee({ ...employee, clockedIn: !employee.clockedIn });
          setBanner(`Clock-${intent} recorded${navigator.onLine ? "" : " (offline — will sync)"}.`);
          void flush();
        }}
      />
      {noSaleOpen && employee ? (
        <NoSaleModal
          creds={creds}
          employeeName={employee.fullName}
          onClose={() => setNoSaleOpen(false)}
          onApproved={(reason, approver) => {
            // Queue the audited no_sale event (validated + audited at sync),
            // then print the slip — PassPRNT's drawer kick fires AFTER the
            // print, so the drawer only ever opens behind this paper record.
            enqueue("no_sale", { reason, approvedByEmployeeId: approver.id }, employee.id);
            void flush();
            setNoSaleOpen(false);
            const bundleReceipt = menuBundle ? normalizePosReceiptConfig(menuBundle.receipt) : null;
            const html = buildNoSaleSlipHtml({
              registerLabel: creds.name,
              openedAtIso: new Date().toISOString(),
              reason,
              openedByName: employee.fullName,
              approvedByName: approver.fullName,
              headerText: bundleReceipt?.headerText ?? null,
              addressLines: bundleReceipt ? receiptAddressLines(bundleReceipt) : [],
            });
            const backUrl = window.location.origin + window.location.pathname;
            window.location.href = buildPassPrntUrl(html, { backUrl, openDrawer: true });
          }}
        />
      ) : null}
      {tillMode && employee ? (
        <TillModal
          creds={creds}
          mode={tillMode}
          employeeName={employee.fullName}
          onClose={() => setTillMode(null)}
          onDone={(mode, drawerInfo, message) => {
            setTillMode(null);
            if (mode === "open") setDrawer(drawerInfo);
            if (mode === "close") setDrawer(null);
            setBanner(message);
          }}
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Setup screen — one-time device provisioning
// ---------------------------------------------------------------------------

function SetupScreen({ onProvisioned }: { onProvisioned: (c: DeviceCreds) => void }) {
  const [deviceId, setDeviceId] = useState("");
  const [deviceKey, setDeviceKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/pos/sync", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-pos-device-id": deviceId.trim(),
          "x-pos-device-key": deviceKey.trim(),
        },
        body: JSON.stringify({ events: [] }),
      });
      const body = (await res.json().catch(() => null)) as
        | { device?: { name: string; registerId: string | null }; error?: string }
        | null;
      if (!res.ok || !body?.device) {
        setError(body?.error ?? "Verification failed — check the id and key.");
        return;
      }
      onProvisioned({
        deviceId: deviceId.trim(),
        deviceKey: deviceKey.trim(),
        name: body.device.name,
        registerId: body.device.registerId,
      });
    } catch {
      setError("Could not reach the server — connect to the internet for first-time setup.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-950 p-6 text-neutral-100">
      <div className="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900 p-8">
        <h1 className="text-xl font-semibold">Register setup</h1>
        <p className="mt-2 text-sm text-neutral-400">
          A manager provisions this iPad in the back office (Register Activity → POS devices) and
          enters the device id + one-time key here. The key is stored only on this device.
        </p>
        <label className="mt-6 block text-xs font-semibold uppercase tracking-wide text-neutral-400">Device id</label>
        <input
          className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-3 font-mono text-sm"
          value={deviceId}
          onChange={(e) => setDeviceId(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-neutral-400">Device key</label>
        <input
          className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-3 font-mono text-sm"
          value={deviceKey}
          onChange={(e) => setDeviceKey(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        {error ? <p className="mt-4 rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-300">{error}</p> : null}
        <button
          type="button"
          onClick={() => void verify()}
          disabled={busy || !deviceId.trim() || !deviceKey.trim()}
          className="mt-6 w-full rounded-xl bg-emerald-600 py-3 text-base font-semibold text-white disabled:opacity-40"
        >
          {busy ? "Verifying…" : "Verify & save"}
        </button>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Lock screen — PIN pad + clock in/out
// ---------------------------------------------------------------------------

function LockScreen({
  creds,
  online,
  pendingCount,
  banner,
  onClearBanner,
  onUnlocked,
  onPunch,
}: {
  creds: DeviceCreds;
  online: boolean;
  pendingCount: number;
  banner: string | null;
  onClearBanner: () => void;
  onUnlocked: (emp: UnlockedEmployee, drawer: DrawerInfo, registerId: string) => void;
  onPunch: (emp: UnlockedEmployee) => void;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"unlock" | "clock">("unlock");

  const submit = async () => {
    if (pin.length < 4 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/pos/unlock", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-pos-device-id": creds.deviceId,
          "x-pos-device-key": creds.deviceKey,
        },
        body: JSON.stringify({ pin }),
      });
      const body = (await res.json().catch(() => null)) as
        | {
            employee?: UnlockedEmployee;
            register?: { id: string };
            drawer?: DrawerInfo;
            error?: string;
          }
        | null;
      if (!res.ok || !body?.employee || !body.register) {
        setError(body?.error ?? "Unlock failed.");
        setPin("");
        return;
      }
      if (mode === "clock") {
        onPunch(body.employee);
        setPin("");
        setMode("unlock");
        return;
      }
      onUnlocked(body.employee, body.drawer ?? null, body.register.id);
      setPin("");
    } catch {
      setError(
        online
          ? "Could not reach the server."
          : "Offline — unlock requires a connection in this build. (Offline PIN cache ships with the Capacitor app.)",
      );
    } finally {
      setBusy(false);
    }
  };

  const press = (d: string) => {
    setError(null);
    if (d === "⌫") setPin((p) => p.slice(0, -1));
    else if (pin.length < 6) setPin((p) => p + d);
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-neutral-950 p-6 text-neutral-100">
      <StatusChips online={online} pendingCount={pendingCount} name={creds.name} />
      {banner ? (
        <button type="button" onClick={onClearBanner} className="mb-4 max-w-md rounded-lg bg-amber-950/70 px-4 py-2 text-sm text-amber-200">
          {banner} <span className="underline">dismiss</span>
        </button>
      ) : null}
      <h1 className="text-2xl font-semibold">{mode === "unlock" ? "Enter PIN to unlock" : "Enter PIN to clock in / out"}</h1>
      <div className="mt-4 flex gap-3" aria-label="PIN">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <span
            key={i}
            className={`h-4 w-4 rounded-full ${i < pin.length ? "bg-emerald-400" : "bg-neutral-700"}`}
          />
        ))}
      </div>
      {error ? <p className="mt-4 max-w-sm rounded-lg bg-red-950/60 px-3 py-2 text-center text-sm text-red-300">{error}</p> : null}
      <div className="mt-6 grid grid-cols-3 gap-3">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "GO"].map((k) =>
          k === "GO" ? (
            <button
              key={k}
              type="button"
              onClick={() => void submit()}
              disabled={pin.length < 4 || busy}
              className="h-16 w-20 rounded-xl bg-emerald-600 text-lg font-bold text-white disabled:opacity-40"
            >
              {busy ? "…" : "GO"}
            </button>
          ) : (
            <button
              key={k}
              type="button"
              onClick={() => press(k)}
              className="h-16 w-20 rounded-xl bg-neutral-800 text-xl font-semibold active:bg-neutral-700"
            >
              {k}
            </button>
          ),
        )}
      </div>
      <button
        type="button"
        onClick={() => {
          setMode((m) => (m === "unlock" ? "clock" : "unlock"));
          setPin("");
          setError(null);
        }}
        className="mt-6 text-sm text-neutral-400 underline"
      >
        {mode === "unlock" ? "Clock in / out instead" : "Back to unlock"}
      </button>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Home screen — unlocked register
// ---------------------------------------------------------------------------

function HomeScreen({
  creds,
  employee,
  drawer,
  online,
  pendingCount,
  rejectedCount,
  lastSyncAt,
  banner,
  menuReady,
  menuFetchedAt,
  lastReceipt,
  heldSale,
  onStartSale,
  onResumeHold,
  onDiscardHold,
  onReprintLast,
  onNoSale,
  onTill,
  onRefreshMenu,
  onClearBanner,
  onLock,
  onSyncNow,
  onPunch,
}: {
  creds: DeviceCreds;
  employee: UnlockedEmployee;
  drawer: DrawerInfo;
  online: boolean;
  pendingCount: number;
  rejectedCount: number;
  lastSyncAt: string | null;
  banner: string | null;
  menuReady: boolean;
  menuFetchedAt: string | null;
  /** B17 — the last frozen receipt (null until the first sale). */
  lastReceipt: PosReceiptInput | null;
  /** B17 — the parked sale (null = nothing on hold). */
  heldSale: HeldSale | null;
  onStartSale: () => void;
  /** B17 — resume the parked sale (undefined when none / menu not ready). */
  onResumeHold?: () => void;
  /** B17 — discard the parked sale. */
  onDiscardHold?: () => void;
  /** B17 — reprint the last receipt (undefined until a sale exists). */
  onReprintLast?: () => void;
  /** B17 — open the manager-approved no-sale drawer flow. */
  onNoSale: () => void;
  /** B21 — open a register-side till action (count-in / drop / blind close). */
  onTill: (mode: "open" | "drop" | "close") => void;
  onRefreshMenu: () => void;
  onClearBanner: () => void;
  onLock: () => void;
  onSyncNow: () => void;
  onPunch: () => void;
}) {
  const syncLabel = useMemo(() => {
    if (!lastSyncAt) return "never this session";
    return new Date(lastSyncAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }, [lastSyncAt]);

  return (
    <main className="flex min-h-screen flex-col bg-neutral-950 p-6 text-neutral-100">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{creds.name}</h1>
          <p className="text-sm text-neutral-400">
            {employee.fullName} ({employee.jobRole}) · {employee.clockedIn ? "clocked in" : "NOT clocked in"}
          </p>
        </div>
        <StatusChips online={online} pendingCount={pendingCount} name={null} />
      </header>

      {banner ? (
        <button type="button" onClick={onClearBanner} className="mt-4 rounded-lg bg-amber-950/70 px-4 py-2 text-left text-sm text-amber-200">
          {banner} <span className="underline">dismiss</span>
        </button>
      ) : null}

      <section className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">Cash drawer</h2>
          {drawer ? (
            <>
              <p className="mt-2 text-sm">
                Open session for {drawer.businessDay}
                {drawer.openedAt ? ` since ${new Date(drawer.openedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : ""}.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => onTill("drop")}
                  className="rounded-lg bg-neutral-800 px-4 py-2 text-sm font-semibold"
                >
                  Cash drop
                </button>
                <button
                  type="button"
                  onClick={() => onTill("close")}
                  className="rounded-lg bg-neutral-800 px-4 py-2 text-sm font-semibold"
                >
                  Close drawer (blind count)
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="mt-2 text-sm text-amber-300">
                No open drawer on this register — count in your starting float before ringing sales.
              </p>
              <button
                type="button"
                onClick={() => onTill("open")}
                className="mt-3 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white"
              >
                Count in drawer
              </button>
            </>
          )}
        </div>
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">Sync</h2>
          <p className="mt-2 text-sm">
            {pendingCount} pending · last sync {syncLabel}
            {rejectedCount > 0 ? ` · ${rejectedCount} rejected (see back office)` : ""}
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            Menu:{" "}
            {menuFetchedAt
              ? `downloaded ${new Date(menuFetchedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
              : "not downloaded yet"}
          </p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={onSyncNow} className="rounded-lg bg-neutral-800 px-4 py-2 text-sm font-semibold">
              Sync now
            </button>
            <button type="button" onClick={onRefreshMenu} className="rounded-lg bg-neutral-800 px-4 py-2 text-sm font-semibold">
              Refresh menu
            </button>
          </div>
        </div>
      </section>

      <section className="mt-6 grid gap-4 sm:grid-cols-3">
        <button
          type="button"
          disabled={!drawer || !employee.clockedIn || !menuReady}
          onClick={onStartSale}
          title={
            !drawer
              ? "Open a drawer first"
              : !employee.clockedIn
                ? "Clock in first"
                : !menuReady
                  ? "Menu not downloaded yet — connect to the internet once"
                  : undefined
          }
          className="rounded-2xl bg-emerald-600 p-8 text-left text-xl font-bold text-white disabled:opacity-40"
        >
          Start sale
          <span className="mt-1 block text-sm font-normal text-emerald-100">
            ID check → cart → cash tender
          </span>
        </button>
        <button type="button" onClick={onPunch} className="rounded-2xl bg-neutral-800 p-8 text-left text-xl font-semibold">
          {employee.clockedIn ? "Clock out" : "Clock in"}
          <span className="mt-1 block text-sm font-normal text-neutral-400">Recorded as a register punch</span>
        </button>
        <button type="button" onClick={onLock} className="rounded-2xl bg-neutral-800 p-8 text-left text-xl font-semibold">
          Lock register
          <span className="mt-1 block text-sm font-normal text-neutral-400">Auto-locks after 2 minutes idle</span>
        </button>
      </section>

      {heldSale ? (
        <section className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-900/60 bg-amber-950/30 p-4">
          <div>
            <h2 className="text-sm font-semibold text-amber-200">
              Sale on hold — {heldSale.lines.reduce((s, l) => s + l.quantity, 0)} item(s)
            </h2>
            <p className="text-xs text-amber-200/70">
              Held by {heldSale.heldByName} {ageLabel(heldSale.heldAtIso, new Date())}. Resuming re-runs the ID check
              and reprices against the current menu.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onResumeHold}
              disabled={!onResumeHold || !drawer || !employee.clockedIn || !menuReady}
              className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
            >
              Resume
            </button>
            <button
              type="button"
              onClick={onDiscardHold}
              className="rounded-lg bg-neutral-800 px-4 py-2 text-sm font-semibold text-neutral-300"
            >
              Discard
            </button>
          </div>
        </section>
      ) : null}

      <section className="mt-4 grid gap-4 sm:grid-cols-2">
        <button
          type="button"
          onClick={onReprintLast}
          disabled={!onReprintLast}
          title={onReprintLast ? undefined : "No receipt stored yet — completes with the first sale"}
          className="rounded-2xl bg-neutral-900 border border-neutral-800 p-5 text-left text-base font-semibold disabled:opacity-40"
        >
          Reprint last receipt
          <span className="mt-1 block text-xs font-normal text-neutral-500">
            {lastReceipt
              ? `Receipt ${receiptNumber(lastReceipt.saleClientUuid)} · ${ageLabel(lastReceipt.soldAtIso, new Date())} — prints without opening the drawer`
              : "Available after the first sale on this device"}
          </span>
        </button>
        <button
          type="button"
          onClick={onNoSale}
          disabled={!drawer}
          title={!drawer ? "Open a drawer first" : undefined}
          className="rounded-2xl bg-neutral-900 border border-neutral-800 p-5 text-left text-base font-semibold disabled:opacity-40"
        >
          No sale — open drawer
          <span className="mt-1 block text-xs font-normal text-neutral-500">
            Needs a reason + a manager&rsquo;s PIN; prints an audit slip, then the drawer pops
          </span>
        </button>
      </section>

      <footer className="mt-auto pt-8 text-center text-xs text-neutral-600">
        Every action is tied to the person whose PIN unlocked the register. Sales re-run the full
        compliance gate on the server — an offline sale that fails there goes to the manager
        exception queue, never silently through.
      </footer>
    </main>
  );
}

// ---------------------------------------------------------------------------
// B17 — No-sale modal: reason + manager PIN approval, then slip + drawer pop
// ---------------------------------------------------------------------------

/**
 * The audited no-sale drawer open. Two humans are on the hook: the session
 * owner (whose PIN unlocked the register) types WHY, and a manager or lead
 * approves with THEIR PIN — verified server-side by /api/pos/approve (same
 * scrypt + throttle as the lock screen; role-gated). The approver's PIN
 * never rides in the queue payload — only their employees.id does, which
 * validateNoSalePayload requires and the sync audit records. ONLINE-ONLY:
 * a PIN can't be verified offline, and an unverifiable approval would be
 * theater. Reasons are preset-first (fast + consistent) with a free-text
 * option, matching how the big POS players do drawer accountability.
 */
function NoSaleModal({
  creds,
  employeeName,
  onClose,
  onApproved,
}: {
  creds: DeviceCreds;
  employeeName: string;
  onClose: () => void;
  onApproved: (reason: string, approver: { id: string; fullName: string }) => void;
}) {
  const PRESETS = [
    "Change for a large bill",
    "Change fund swap with the safe",
    "Stuck bill / jammed drawer",
    "Drawer count check (manager)",
  ];
  const [preset, setPreset] = useState<string | null>(null);
  const [custom, setCustom] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reason = (preset ?? custom).trim();
  const reasonOk = reason.length >= 3 && reason.length <= 500;

  const approve = async () => {
    if (!reasonOk || pin.length < 4 || busy) return;
    if (!navigator.onLine) {
      setError("Offline — manager approval needs a connection to verify the PIN.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/pos/approve", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-pos-device-id": creds.deviceId,
          "x-pos-device-key": creds.deviceKey,
        },
        body: JSON.stringify({ pin }),
      });
      const body = (await res.json().catch(() => null)) as
        | { approver?: { id: string; fullName: string }; error?: string }
        | null;
      if (!res.ok || !body?.approver) {
        setError(body?.error ?? "Approval failed.");
        setPin("");
        return;
      }
      onApproved(reason, body.approver);
    } catch {
      setError("Could not reach the server — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-2xl border border-neutral-700 bg-neutral-900 p-6 text-neutral-100">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">No sale — open drawer</h2>
          <button type="button" onClick={onClose} className="rounded-lg bg-neutral-800 px-3 py-1.5 text-sm">
            Cancel
          </button>
        </div>
        <p className="mt-2 text-xs text-neutral-400">
          Opened by {employeeName}. Pick a reason, then a manager or lead approves with their PIN.
          An audit slip prints and the drawer pops after the print.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                setPreset(preset === p ? null : p);
                setCustom("");
              }}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                preset === p ? "bg-emerald-600 text-white" : "bg-neutral-800 text-neutral-300"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
        <input
          className="mt-3 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2.5 text-sm"
          placeholder="Or type another reason (3–500 characters)…"
          value={custom}
          maxLength={500}
          onChange={(e) => {
            setCustom(e.target.value);
            if (e.target.value) setPreset(null);
          }}
        />

        <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Manager / lead PIN
        </label>
        <input
          className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2.5 text-center font-mono text-lg tracking-[0.5em]"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={pin}
          maxLength={6}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
        />

        {error ? <p className="mt-3 rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-300">{error}</p> : null}

        <button
          type="button"
          onClick={() => void approve()}
          disabled={!reasonOk || pin.length < 4 || busy}
          className="mt-5 w-full rounded-xl bg-emerald-600 py-3 text-base font-semibold text-white disabled:opacity-40"
        >
          {busy ? "Verifying…" : "Approve, print slip & open drawer"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// B21 — Till modal: count-in / cash drop / BLIND close, done at the register
// ---------------------------------------------------------------------------

/**
 * The cashier's hands-on drawer work (owner's direction: this belongs on the
 * iPad, not the back office). Every action is PIN-attributed and lands on
 * /api/pos/till (device-authenticated). ONLINE-ONLY: a PIN cannot be
 * verified offline, and cash custody must be durable the moment cash moves.
 *
 * Blind discipline: the CLOSE screen shows the cashier their own running
 * count (they need it to count accurately) but the server NEVER returns
 * expected cash or variance — the manager reveals over/short at reconcile.
 */
function TillModal({
  creds,
  mode,
  employeeName,
  onClose,
  onDone,
}: {
  creds: DeviceCreds;
  mode: "open" | "drop" | "close";
  employeeName: string;
  onClose: () => void;
  onDone: (mode: "open" | "drop" | "close", drawer: DrawerInfo, message: string) => void;
}) {
  const [denoms, setDenoms] = useState<DenomCounts>({ ...EMPTY_DENOMS });
  const [amount, setAmount] = useState("");
  const [dropWindow, setDropWindow] = useState<"afternoon" | "night" | "other">("afternoon");
  const [witnessPin, setWitnessPin] = useState("");
  const [notes, setNotes] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const countedMinor = denomTotalMinor(denoms);
  const amountMinor = dollarsToMinor(amount);

  const ready =
    pin.length >= 4 &&
    (mode === "open" ? countedMinor > 0 : mode === "drop" ? amountMinor !== null : true);

  const TITLES = {
    open: "Count in drawer",
    drop: "Cash drop to safe",
    close: "Close drawer — blind count",
  } as const;

  const submit = async () => {
    if (!ready || busy) return;
    if (!navigator.onLine) {
      setError("Offline — drawer actions need a connection to verify your PIN and record the cash.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body =
        mode === "drop"
          ? {
              action: "drop",
              pin,
              amountMinor,
              window: dropWindow,
              ...(witnessPin ? { witnessPin } : {}),
              ...(notes.trim() ? { notes: notes.trim() } : {}),
            }
          : { action: mode, pin, denoms };
      const res = await fetch("/api/pos/till", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-pos-device-id": creds.deviceId,
          "x-pos-device-key": creds.deviceKey,
        },
        body: JSON.stringify(body),
      });
      const resBody = (await res.json().catch(() => null)) as
        | { ok?: boolean; drawer?: NonNullable<DrawerInfo>; error?: string }
        | null;
      if (!res.ok || !resBody?.ok) {
        setError(resBody?.error ?? "Till action failed — try again.");
        setPin("");
        return;
      }
      if (mode === "open") {
        onDone("open", resBody.drawer ?? null, `Drawer counted in at ${formatCents(countedMinor)} — ready to ring sales.`);
      } else if (mode === "drop") {
        onDone("drop", null, `${formatCents(amountMinor ?? 0)} dropped to the safe (${dropWindow}).`);
      } else {
        onDone("close", null, "Blind count recorded — a manager reconciles it in the back office.");
      }
    } catch {
      setError("Could not reach the server — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-neutral-700 bg-neutral-900 p-6 text-neutral-100">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{TITLES[mode]}</h2>
          <button type="button" onClick={onClose} className="rounded-lg bg-neutral-800 px-3 py-1.5 text-sm">
            Cancel
          </button>
        </div>
        <p className="mt-2 text-xs text-neutral-400">
          {mode === "open"
            ? `Count every bill and coin going into the drawer. The total is your starting float, recorded under ${employeeName}'s PIN.`
            : mode === "drop"
              ? `Cash pulled from the drawer into the safe. Recorded under ${employeeName}'s PIN; a second person can witness with theirs.`
              : `Count what's in the drawer right now. You will NOT see the expected amount — a manager reveals over/short at reconcile. That protects you.`}
        </p>

        {mode === "drop" ? (
          <>
            <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Amount dropped
            </label>
            <input
              className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2.5 text-lg"
              inputMode="decimal"
              placeholder="$0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Drop window
            </label>
            <div className="mt-1 flex gap-2">
              {(["afternoon", "night", "other"] as const).map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setDropWindow(w)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold capitalize ${
                    dropWindow === w ? "bg-emerald-600 text-white" : "bg-neutral-800 text-neutral-300"
                  }`}
                >
                  {w}
                </button>
              ))}
            </div>
            <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Witness PIN (optional, second person)
            </label>
            <input
              className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2.5 text-center font-mono text-lg tracking-[0.5em]"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={witnessPin}
              maxLength={6}
              onChange={(e) => setWitnessPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
            />
            <input
              className="mt-3 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2.5 text-sm"
              placeholder="Notes (optional)…"
              value={notes}
              maxLength={500}
              onChange={(e) => setNotes(e.target.value)}
            />
          </>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {DENOM_FIELDS.map(({ key, label }) => (
                <label key={key} className="flex items-center justify-between gap-2 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2">
                  <span className="text-sm font-semibold text-neutral-300">{label}</span>
                  <input
                    className="w-20 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-right text-sm"
                    inputMode="numeric"
                    value={denoms[key] === 0 ? "" : String(denoms[key])}
                    placeholder="0"
                    onChange={(e) => {
                      const n = Math.max(0, Math.floor(Number(e.target.value.replace(/\D/g, "")) || 0));
                      setDenoms((d) => ({ ...d, [key]: n }));
                    }}
                  />
                </label>
              ))}
            </div>
            <p className="mt-3 rounded-lg bg-neutral-950 px-3 py-2 text-right text-base font-bold">
              Counted: {formatCents(countedMinor)}
            </p>
          </>
        )}

        <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Your PIN
        </label>
        <input
          className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2.5 text-center font-mono text-lg tracking-[0.5em]"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={pin}
          maxLength={6}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
        />

        {error ? <p className="mt-3 rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-300">{error}</p> : null}

        <button
          type="button"
          onClick={() => void submit()}
          disabled={!ready || busy}
          className="mt-5 w-full rounded-xl bg-emerald-600 py-3 text-base font-semibold text-white disabled:opacity-40"
        >
          {busy
            ? "Recording…"
            : mode === "open"
              ? `Open drawer with ${formatCents(countedMinor)}`
              : mode === "drop"
                ? `Record drop${amountMinor !== null ? ` of ${formatCents(amountMinor)}` : ""}`
                : "Record blind count & close"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared status chips
// ---------------------------------------------------------------------------

function StatusChips({ online, pendingCount, name }: { online: boolean; pendingCount: number; name: string | null }) {
  return (
    <div className="mb-4 flex items-center gap-2 text-xs">
      {name ? <span className="rounded-full bg-neutral-800 px-3 py-1 text-neutral-300">{name}</span> : null}
      <span className={`rounded-full px-3 py-1 font-semibold ${online ? "bg-emerald-950 text-emerald-300" : "bg-red-950 text-red-300"}`}>
        {online ? "Online" : "Offline"}
      </span>
      <span className="rounded-full bg-neutral-800 px-3 py-1 text-neutral-300">{pendingCount} queued</span>
    </div>
  );
}
