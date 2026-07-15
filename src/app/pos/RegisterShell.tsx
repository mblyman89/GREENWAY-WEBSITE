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
import { changeBreakdown, formatChangeBreakdown } from "@/lib/pos/change-calc-core";
import { lowStockCount } from "@/lib/pos/low-stock-core";
import { applyLocalStockFlag } from "@/lib/pos/stock-flag-core";
import { THEME_KEY, parseTheme, themeToggleLabel, toggleTheme, type PosTheme } from "@/lib/pos/theme-core";
import { checkSetupCredentials } from "@/lib/pos/device-setup-core";
import { VOID_REASON_PRESETS } from "@/lib/pos/void-sale-core";
import { CUSTOMER_RETURN_REASONS } from "@/lib/inventory/disposition-core";
import type { PickupQueueEntry } from "@/lib/pos/pickup-core";
import type { MemberHistory } from "@/lib/pos/member-history-core";
import type { PosLoyaltyGrant } from "@/lib/pos/register-loyalty-core";
import { buildDayReportSlipHtml, type DaySummary, type DrawerDaySummary } from "@/lib/pos/day-report-core";
import { medalFor } from "@/lib/pos/leaderboard-core";
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
  // B22 — X/Z day report modal (manager PIN inside).
  const [dayReportOpen, setDayReportOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false); // B27
  const [returnsOpen, setReturnsOpen] = useState(false); // AM-C
  const [leaderboardOpen, setLeaderboardOpen] = useState(false); // B34
  const [pickupOpen, setPickupOpen] = useState(false); // B28
  // B28 — live count of website pickup orders (polled while unlocked+online).
  const [pickupCount, setPickupCount] = useState<number | null>(null);
  // B30 — whether the server's email provider is configured (checked once
  // after creds bind; null = unknown). Gates the email-receipt option.
  const [emailReceiptReady, setEmailReceiptReady] = useState<boolean | null>(null);
  // B44 — per-device display mode (localStorage, like favorites). Dark is
  // the default; hydrated in the boot effect below.
  const [theme, setTheme] = useState<PosTheme>("dark");
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
    // B44 — per-device display mode (parseTheme degrades corruption to dark).
    setTheme(parseTheme(window.localStorage.getItem(THEME_KEY)));
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

  // ── B44: apply + persist the display mode ──
  // The attribute lives on <html> so the ONE globals.css override block
  // (html[data-pos-theme="light"]) re-tints every --pos-* token at once.
  // Removed on unmount so navigating away never leaves the attribute behind.
  useEffect(() => {
    document.documentElement.setAttribute("data-pos-theme", theme);
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Best-effort — a full disk just means the choice doesn't survive restart.
    }
    return () => {
      document.documentElement.removeAttribute("data-pos-theme");
    };
  }, [theme]);

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

  // ── B30: one-time email-provider capability check (device-authed). When
  //    the provider isn't configured the email-receipt option never renders —
  //    no dead buttons at the counter. Deferred like the menu refresh.
  useEffect(() => {
    if (!creds) return;
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch("/api/pos/email-receipt", {
          headers: { "x-pos-device-id": creds.deviceId, "x-pos-device-key": creds.deviceKey },
        });
        const body = (await res.json().catch(() => null)) as { configured?: boolean } | null;
        if (!cancelled) setEmailReceiptReady(res.ok && body?.configured === true);
      } catch {
        if (!cancelled) setEmailReceiptReady(false);
      }
    };
    const t = setTimeout(() => void check(), 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [creds]);

  // ── B28: pickup-queue badge poll (unlocked + online only; 45s cadence).
  //    The badge itself is gated on `online` at render time, so no state
  //    reset is needed here when connectivity drops.
  useEffect(() => {
    if (screen !== "home" || !creds || !online) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch("/api/pos/pickup", {
          headers: { "x-pos-device-id": creds.deviceId, "x-pos-device-key": creds.deviceKey },
        });
        const body = (await res.json().catch(() => null)) as { queue?: unknown[] } | null;
        if (!cancelled) setPickupCount(res.ok && Array.isArray(body?.queue) ? body.queue.length : null);
      } catch {
        if (!cancelled) setPickupCount(null);
      }
    };
    const t0 = setTimeout(() => void poll(), 0);
    const t = setInterval(() => void poll(), 45_000);
    return () => {
      cancelled = true;
      clearTimeout(t0);
      clearInterval(t);
    };
  }, [screen, creds, online]);

  // ── auto-lock on idle ──
  const lock = useCallback(() => {
    setEmployee(null);
    setSaleActive(false);
    setResumeCart(null);
    setNoSaleOpen(false);
    setPickupOpen(false);
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
    return (
      <main className="pos-shell flex min-h-screen flex-col items-center justify-center gap-4">
        {/* Plain <img>, NOT next/image: the /pos service worker caches /pos/*
            cache-first so the wordmark renders on OFFLINE boot; the
            /_next/image optimizer endpoint is never cached. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/pos/wordmark.png" alt="Greenway Marijuana" className="h-10 w-auto opacity-90" />
        <p className="text-sm text-[var(--pos-text-faint)]">Loading register…</p>
      </main>
    );
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
                setBanner(`Sale saved (${hold.lines.reduce((s, l) => s + l.quantity, 0)} item(s)) — load it from the home screen.`);
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
        onApprove={async (pin) => {
          // POS B24 — manager PIN verify for a price override: the SAME
          // /api/pos/approve endpoint the no-sale flow uses (scrypt PIN +
          // shared throttle + manager/lead role gate). ONLINE-ONLY; the PIN
          // never rides in any queue payload — only the approver's id does.
          if (!navigator.onLine) {
            return { ok: false as const, error: "Offline — manager approval needs a connection to verify the PIN." };
          }
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
              return { ok: false as const, error: body?.error ?? "Approval failed." };
            }
            return { ok: true as const, approver: body.approver };
          } catch {
            return { ok: false as const, error: "Could not reach the server — try again." };
          }
        }}
        onStockFlag={async (productId, reason) => {
          // POS B43 — Toast-style "86 it". ONLINE-ONLY (an offline register
          // can't change the shared menu). On success the item leaves this
          // device's cached bundle immediately — the same exclusion the next
          // menu download would apply — and every other register drops it on
          // its next refresh.
          if (!navigator.onLine) {
            return { ok: false as const, error: "Offline — flagging stock needs a connection (it changes the shared menu)." };
          }
          try {
            const res = await fetch("/api/pos/stock-flag", {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-pos-device-id": creds.deviceId,
                "x-pos-device-key": creds.deviceKey,
              },
              body: JSON.stringify({ productId, reason, flaggedByName: employee?.fullName ?? "" }),
            });
            const body = (await res.json().catch(() => null)) as { flagged?: boolean; error?: string } | null;
            if (!res.ok || !body?.flagged) {
              return { ok: false as const, error: body?.error ?? "Could not flag the item — try again." };
            }
            setMenuBundle((prev) => {
              if (!prev) return prev;
              const next = applyLocalStockFlag(prev, productId);
              try {
                window.localStorage.setItem(LS_MENU, JSON.stringify(next));
              } catch {
                // Cache write failure is non-fatal — the in-memory bundle still works.
              }
              return next;
            });
            return { ok: true as const };
          } catch {
            return { ok: false as const, error: "Could not reach the server — try again." };
          }
        }}
        onLoyalty={async (req) => {
          // Task AM-B — loyalty redemption at the register. ONLINE-ONLY:
          // the server holds the live balance and the legal price floors.
          if (!navigator.onLine) {
            return { ok: false as const, error: "Offline — loyalty redemption needs a connection. Ring the sale without it, or reconnect." };
          }
          try {
            const res = await fetch("/api/pos/loyalty", {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-pos-device-id": creds.deviceId,
                "x-pos-device-key": creds.deviceKey,
              },
              body: JSON.stringify(req),
            });
            const body = (await res.json().catch(() => null)) as
              | (Partial<PosLoyaltyGrant> & { error?: string; released?: boolean })
              | null;
            if (req.action === "release") {
              // Best-effort cleanup — the caller never blocks on it.
              return { ok: true as const, grant: { redemptionId: "", code: "", valueMinor: 0, appliedMinor: 0, pointsSpent: 0, source: "points" as const, perVariant: {} } };
            }
            if (
              !res.ok ||
              !body ||
              typeof body.redemptionId !== "string" ||
              typeof body.code !== "string" ||
              !Number.isInteger(body.appliedMinor) ||
              !body.perVariant ||
              typeof body.perVariant !== "object"
            ) {
              return { ok: false as const, error: body?.error ?? "Loyalty request failed — try again." };
            }
            return {
              ok: true as const,
              grant: {
                redemptionId: body.redemptionId,
                code: body.code,
                valueMinor: body.valueMinor ?? 0,
                appliedMinor: body.appliedMinor as number,
                pointsSpent: body.pointsSpent ?? 0,
                source: body.source === "code" ? ("code" as const) : ("points" as const),
                perVariant: body.perVariant as Record<string, number>,
              },
            };
          } catch {
            return { ok: false as const, error: "Could not reach the server — try again." };
          }
        }}
        onProductImage={async (productId) => {
          // POS B42 — the info card's photo, ONLINE-ONLY and best-effort:
          // offline/failed = no photo, the card still shows every cached fact.
          if (!navigator.onLine) return null;
          try {
            const res = await fetch(`/api/pos/product-image?productId=${encodeURIComponent(productId)}`, {
              headers: { "x-pos-device-id": creds.deviceId, "x-pos-device-key": creds.deviceKey },
            });
            const body = (await res.json().catch(() => null)) as
              | { image?: { url: string; isFallback: boolean } | null }
              | null;
            return res.ok ? (body?.image ?? null) : null;
          } catch {
            return null;
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
        onEmailReceipt={
          emailReceiptReady
            ? async (email, receipt) => {
                // POS B30 — opt-in digital receipt. ONLINE-ONLY (an email
                // can't leave an offline device; paper always works).
                if (!navigator.onLine) {
                  return { ok: false as const, error: "Offline — print the paper receipt instead." };
                }
                try {
                  const res = await fetch("/api/pos/email-receipt", {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      "x-pos-device-id": creds.deviceId,
                      "x-pos-device-key": creds.deviceKey,
                    },
                    body: JSON.stringify({ email, receipt }),
                  });
                  const body = (await res.json().catch(() => null)) as
                    | { sent?: boolean; receiptNumber?: string; error?: string }
                    | null;
                  if (!res.ok || !body?.sent) {
                    return { ok: false as const, error: body?.error ?? "Email failed — offer the paper receipt." };
                  }
                  return { ok: true as const, receiptNumber: body.receiptNumber ?? "" };
                } catch {
                  return { ok: false as const, error: "Network error — print the paper receipt instead." };
                }
              }
            : undefined
        }
        onMemberHistory={async (customerId) => {
          // POS B29 — privacy-budgeted purchase history for the attached
          // member ("the usual?"). ONLINE-ONLY, same discipline as lookup.
          if (!navigator.onLine) {
            return { ok: false as const, error: "Offline — history needs a connection." };
          }
          try {
            const res = await fetch(`/api/pos/member-history?customerId=${encodeURIComponent(customerId)}`, {
              headers: { "x-pos-device-id": creds.deviceId, "x-pos-device-key": creds.deviceKey },
            });
            const body = (await res.json().catch(() => null)) as
              | { history?: MemberHistory; error?: string }
              | null;
            if (!res.ok || !body?.history) {
              return { ok: false as const, error: body?.error ?? "Could not load history." };
            }
            return { ok: true as const, history: body.history };
          } catch {
            return { ok: false as const, error: "Network error — try again." };
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
        lowStock={menuBundle ? lowStockCount(menuBundle.products) : 0}
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
                setBanner("Saved sale discarded.");
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
        onDayReport={() => setDayReportOpen(true)}
        onVoidSale={online ? () => setVoidOpen(true) : undefined}
        onReturnSale={online ? () => setReturnsOpen(true) : undefined}
        onLeaderboard={online ? () => setLeaderboardOpen(true) : undefined}
        pickupCount={online ? pickupCount : null}
        onPickupQueue={online && drawer ? () => setPickupOpen(true) : undefined}
        themeLabel={themeToggleLabel(theme)}
        onToggleTheme={() => setTheme((t) => toggleTheme(t))}
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
      {dayReportOpen && employee ? (
        <DayReportModal
          creds={creds}
          receiptConfig={menuBundle ? normalizePosReceiptConfig(menuBundle.receipt) : null}
          onClose={() => setDayReportOpen(false)}
        />
      ) : null}
      {leaderboardOpen ? (
        <LeaderboardModal creds={creds} onClose={() => setLeaderboardOpen(false)} />
      ) : null}
      {voidOpen && employee ? (
        <VoidSaleModal
          creds={creds}
          employeeName={employee.fullName}
          onClose={() => setVoidOpen(false)}
          onVoided={(slipHtml, message) => {
            setVoidOpen(false);
            setBanner(message);
            // Print the void slip; the drawer POPS — the cash goes back out.
            const backUrl = window.location.origin + window.location.pathname;
            window.location.href = buildPassPrntUrl(slipHtml, { backUrl, openDrawer: true });
          }}
        />
      ) : null}
      {returnsOpen && employee ? (
        <ReturnsModal
          creds={creds}
          employeeName={employee.fullName}
          onClose={() => setReturnsOpen(false)}
          onReturned={(receiptHtml, message) => {
            setReturnsOpen(false);
            setBanner(message);
            // Print the refund receipt; the drawer POPS — the refund cash goes out.
            const backUrl = window.location.origin + window.location.pathname;
            window.location.href = buildPassPrntUrl(receiptHtml, { backUrl, openDrawer: true });
          }}
        />
      ) : null}
      {pickupOpen && employee && drawer ? (
        <PickupQueueModal
          creds={creds}
          employee={employee}
          drawerSessionId={drawer.sessionId}
          onClose={() => setPickupOpen(false)}
          onCompleted={(receiptHtml, message) => {
            setPickupOpen(false);
            setBanner(message);
            setPickupCount((c) => (typeof c === "number" && c > 0 ? c - 1 : c));
            // Print the pickup receipt; the drawer POPS — cash just came in.
            const backUrl = window.location.origin + window.location.pathname;
            window.location.href = buildPassPrntUrl(receiptHtml, { backUrl, openDrawer: true });
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
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const verify = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    // B25 — shape-check BEFORE the network call. The device id is a UUID and
    // the key is a 32-char random string; a swap (the exact field mix-up that
    // blocked first provisioning) is detected and corrected here, and a
    // malformed id gets a human explanation instead of the server's terse 401.
    const checked = checkSetupCredentials(deviceId, deviceKey);
    if (checked.swapped) {
      setDeviceId(checked.deviceId);
      setDeviceKey(checked.deviceKey);
      setNotice("The id and key were in each other's fields — swapped them back for you.");
    }
    if (checked.problem) {
      setError(checked.problem);
      setBusy(false);
      return;
    }
    try {
      const res = await fetch("/api/pos/sync", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-pos-device-id": checked.deviceId,
          "x-pos-device-key": checked.deviceKey,
        },
        body: JSON.stringify({ events: [] }),
      });
      const body = (await res.json().catch(() => null)) as
        | { device?: { name: string; registerId: string | null }; error?: string }
        | null;
      if (!res.ok || !body?.device) {
        // B26 — a shape-valid key the server still refuses means the key
        // doesn't match this device row's hash: a stale key (rotated since
        // it was copied) or credentials from a different device row.
        const raw = body?.error ?? "Verification failed — check the id and key.";
        setError(
          raw === "Device key rejected."
            ? "Device key rejected — the key doesn't match this device id. The key is CASE-SENSITIVE and " +
                "only the NEWEST key works (rotating invalidates all older ones). In Admin → Registers → " +
                "POS devices: rotate the key on the SAME device row as this id, then copy BOTH values " +
                "shown together and paste them here without retyping."
            : raw,
        );
        return;
      }
      onProvisioned({
        deviceId: checked.deviceId,
        deviceKey: checked.deviceKey,
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
    <main className="pos-shell flex min-h-screen flex-col items-center justify-center p-6">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/pos/wordmark.png" alt="Greenway Marijuana" className="mb-6 h-9 w-auto opacity-90" />
      <div className="w-full max-w-md rounded-2xl border border-[var(--pos-border)] bg-[var(--pos-surface)] p-8 shadow-[var(--admin-shadow)]">
        <h1 className="text-xl font-semibold">Register setup</h1>
        <p className="mt-2 text-sm text-[var(--pos-text-muted)]">
          A manager provisions this iPad in the back office (Register Activity → POS devices) and
          enters the device id + one-time key here. The key is stored only on this device.
        </p>
        {/* B26 — autoCapitalize/autoCorrect OFF: the key is case-sensitive
            base64url and iOS silently capitalizes the first letter and
            autocorrects typed keys, which the server then (correctly)
            rejects. spellCheck alone does not stop either behavior. */}
        <label className="mt-6 block text-xs font-semibold uppercase tracking-wide text-[var(--pos-text-muted)]">Device id</label>
        <input
          className="mt-1 w-full rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-3 py-3 font-mono text-sm"
          value={deviceId}
          onChange={(e) => setDeviceId(e.target.value)}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-[var(--pos-text-muted)]">Device key</label>
        <input
          className="mt-1 w-full rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-3 py-3 font-mono text-sm"
          value={deviceKey}
          onChange={(e) => setDeviceKey(e.target.value)}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        {notice ? <p className="mt-4 rounded-lg bg-[var(--pos-info-soft)] px-3 py-2 text-sm text-[var(--pos-info)]">{notice}</p> : null}
        {error ? <p className="mt-4 rounded-lg bg-[var(--pos-danger-soft)] px-3 py-2 text-sm text-[var(--pos-danger)]">{error}</p> : null}
        <button
          type="button"
          onClick={() => void verify()}
          disabled={busy || !deviceId.trim() || !deviceKey.trim()}
          className="pos-tile mt-6 w-full rounded-xl bg-[var(--pos-accent)] py-3 text-base font-bold text-[var(--pos-accent-ink)] disabled:opacity-40"
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
    <main className="pos-shell flex min-h-screen flex-col items-center justify-center p-6">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/pos/wordmark.png" alt="Greenway Marijuana" className="mb-5 h-10 w-auto opacity-90" />
      <StatusChips online={online} pendingCount={pendingCount} name={creds.name} />
      {banner ? (
        <button type="button" onClick={onClearBanner} className="mb-4 max-w-md rounded-lg bg-[var(--pos-warn-soft)] px-4 py-2 text-sm text-[var(--pos-warn)]">
          {banner} <span className="underline">dismiss</span>
        </button>
      ) : null}
      <h1 className="text-2xl font-semibold">{mode === "unlock" ? "Enter PIN to unlock" : "Enter PIN to clock in / out"}</h1>
      <div className="mt-4 flex gap-3" aria-label="PIN">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <span
            key={i}
            className={`h-4 w-4 rounded-full ${i < pin.length ? "bg-[var(--pos-accent)]" : "bg-[var(--pos-surface-hover)]"}`}
          />
        ))}
      </div>
      {error ? <p className="mt-4 max-w-sm rounded-lg bg-[var(--pos-danger-soft)] px-3 py-2 text-center text-sm text-[var(--pos-danger)]">{error}</p> : null}
      <div className="mt-6 grid grid-cols-3 gap-3">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "GO"].map((k) =>
          k === "GO" ? (
            <button
              key={k}
              type="button"
              onClick={() => void submit()}
              disabled={pin.length < 4 || busy}
              className="pos-tile h-16 w-20 rounded-xl bg-[var(--pos-accent)] text-lg font-bold text-[var(--pos-accent-ink)] disabled:opacity-40"
            >
              {busy ? "…" : "GO"}
            </button>
          ) : (
            <button
              key={k}
              type="button"
              onClick={() => press(k)}
              className="pos-tile h-16 w-20 rounded-xl border border-[var(--pos-border)] bg-[var(--pos-surface-2)] text-xl font-semibold active:bg-[var(--pos-surface-hover)]"
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
        className="mt-6 text-sm text-[var(--pos-text-muted)] underline"
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
  lowStock,
  lastReceipt,
  heldSale,
  onStartSale,
  onResumeHold,
  onDiscardHold,
  onReprintLast,
  onNoSale,
  onTill,
  onDayReport,
  onVoidSale,
  onReturnSale,
  onLeaderboard,
  pickupCount,
  onPickupQueue,
  themeLabel,
  onToggleTheme,
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
  /** B32 — products flagged low/last-units in the downloaded menu (0 = none). */
  lowStock: number;
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
  /** B22 — open the manager-gated X/Z day-report flow. */
  onDayReport: () => void;
  /** B27 — open the manager-gated same-day void flow (undefined offline). */
  onVoidSale?: () => void;
  /** AM-C — open the manager-gated counter-return flow (undefined offline). */
  onReturnSale?: () => void;
  /** B34 — open the budtender leaderboard (undefined offline — it reads the server ledger). */
  onLeaderboard?: () => void;
  /** B28 — live website-pickup count (null offline / not yet fetched). */
  pickupCount: number | null;
  /** B28 — open the pickup queue (undefined offline or with no open drawer). */
  onPickupQueue?: () => void;
  /** B44 — the display mode the toggle would SWITCH TO ("Light mode" / "Dark mode"). */
  themeLabel: string;
  /** B44 — flip this device's display mode (persists per device). */
  onToggleTheme: () => void;
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
    <main className="pos-shell flex min-h-screen flex-col p-6">
      {/* Header: store identity + who's on this register. Square-style: the
          brand owns the top-left, the live status chips own the top-right. */}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/pos/wordmark.png" alt="Greenway Marijuana" className="h-8 w-auto opacity-90" />
          <div className="hidden h-9 w-px bg-[var(--pos-border-strong)] sm:block" aria-hidden />
          <div>
            <h1 className="text-lg font-semibold leading-tight">{creds.name}</h1>
            <p className="text-sm text-[var(--pos-text-muted)]">
              {employee.fullName} ({employee.jobRole}) ·{" "}
              {employee.clockedIn ? (
                <span className="font-semibold text-[var(--pos-accent)]">clocked in</span>
              ) : (
                <span className="font-semibold text-[var(--pos-warn)]">NOT clocked in</span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <StatusChips online={online} pendingCount={pendingCount} name={null} />
          {/* B44 — per-device display mode. Offline-friendly (pure localStorage). */}
          <button
            type="button"
            onClick={onToggleTheme}
            className="pos-tile rounded-full border border-[var(--pos-border)] bg-[var(--pos-surface-2)] px-3 py-1.5 text-xs font-semibold text-[var(--pos-text-muted)]"
          >
            {themeLabel === "Light mode" ? "☀️" : "🌙"} {themeLabel}
          </button>
        </div>
      </header>

      {banner ? (
        <button type="button" onClick={onClearBanner} className="mt-4 rounded-lg bg-[var(--pos-warn-soft)] px-4 py-2 text-left text-sm text-[var(--pos-warn)]">
          {banner} <span className="underline">dismiss</span>
        </button>
      ) : null}

      {heldSale ? (
        <section className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--pos-warn-border)] bg-[var(--pos-warn-soft)] p-4">
          <div>
            <h2 className="text-sm font-semibold text-[var(--pos-warn)]">
              Saved sale — {heldSale.lines.reduce((s, l) => s + l.quantity, 0)} item(s)
            </h2>
            <p className="text-xs text-[var(--pos-warn-muted)]">
              Saved by {heldSale.heldByName} {ageLabel(heldSale.heldAtIso, new Date())}. Loading re-runs the ID check
              and reprices against the current menu.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onResumeHold}
              disabled={!onResumeHold || !drawer || !employee.clockedIn || !menuReady}
              className="pos-tile rounded-lg bg-[var(--pos-warn-solid)] px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
            >
              Load sale
            </button>
            <button
              type="button"
              onClick={onDiscardHold}
              className="pos-tile rounded-lg border border-[var(--pos-border)] bg-[var(--pos-surface-2)] px-4 py-2 text-sm font-semibold text-[var(--pos-text-muted)]"
            >
              Discard
            </button>
          </div>
        </section>
      ) : null}

      {/* Big action tiles — color-coded to the brand: green sells, gold hands
          off website orders, orange is the time clock, charcoal locks up.
          AL-C: the biggest button is the most frequent action (payment-UX
          research) — Start sale is the hero, double-width at lg+. */}
      <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
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
          className="pos-tile rounded-2xl bg-[var(--pos-accent)] p-6 text-left text-2xl font-bold text-[var(--pos-accent-ink)] shadow-[var(--admin-shadow)] disabled:opacity-40 lg:col-span-2"
        >
          <span className="block text-4xl" aria-hidden>
            🛒
          </span>
          <span className="mt-2 block">Start sale</span>
          <span className="mt-1 block text-sm font-semibold opacity-80">ID check → cart → cash tender</span>
        </button>
        <button
          type="button"
          onClick={onPickupQueue}
          disabled={!onPickupQueue}
          title={
            onPickupQueue
              ? undefined
              : !drawer
                ? "Open a drawer first — pickup orders take cash"
                : "Pickup orders need a connection — the queue lives on the server"
          }
          className="pos-tile relative rounded-2xl border border-[var(--pos-gold-border)] bg-[var(--pos-gold-soft)] p-6 text-left text-xl font-bold text-[var(--pos-gold)] disabled:opacity-40"
        >
          <span className="block text-3xl" aria-hidden>
            🛍️
          </span>
          <span className="mt-2 block">Pickup orders</span>
          {typeof pickupCount === "number" && pickupCount > 0 ? (
            <span className="absolute right-4 top-4 flex h-9 min-w-9 items-center justify-center rounded-full bg-[var(--pos-gold)] px-2 text-base font-extrabold text-[var(--pos-gold-ink)]">
              {pickupCount}
            </span>
          ) : null}
          <span className="mt-1 block text-sm font-normal text-[var(--pos-text-muted)]">
            {typeof pickupCount === "number"
              ? pickupCount === 0
                ? "No website orders waiting"
                : `${pickupCount} website order${pickupCount === 1 ? "" : "s"} waiting`
              : "Website orders — ID check at handover"}
          </span>
        </button>
        <button
          type="button"
          onClick={onPunch}
          className="pos-tile rounded-2xl border border-[var(--pos-orange-border)] bg-[var(--pos-orange-soft)] p-6 text-left text-xl font-semibold text-[var(--pos-orange)]"
        >
          <span className="block text-3xl" aria-hidden>
            ⏱️
          </span>
          <span className="mt-2 block">{employee.clockedIn ? "Clock out" : "Clock in"}</span>
          <span className="mt-1 block text-sm font-normal text-[var(--pos-text-muted)]">Recorded as a register punch</span>
        </button>
        <button
          type="button"
          onClick={onLock}
          className="pos-tile rounded-2xl border border-[var(--pos-border)] bg-[var(--pos-surface-2)] p-6 text-left text-xl font-semibold"
        >
          <span className="block text-3xl" aria-hidden>
            🔒
          </span>
          <span className="mt-2 block">Lock register</span>
          <span className="mt-1 block text-sm font-normal text-[var(--pos-text-muted)]">Auto-locks after 2 minutes idle</span>
        </button>
      </section>

      {/* Status strip — drawer / sync / menu / queue at a glance, each with a
          colored state dot and its actions right where the status is.
          AL-C: DEMOTED below the action tiles (Dynamics welcome-screen
          pattern — the hero action leads; status is glanceable, not the
          headline). */}
      <section className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-[var(--pos-border)] bg-[var(--pos-surface)] p-4">
          <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--pos-text-muted)]">
            <span className={`h-2 w-2 rounded-full ${drawer ? "bg-[var(--pos-accent)]" : "bg-[var(--pos-warn-dot)]"}`} aria-hidden />
            Cash drawer
          </h2>
          {drawer ? (
            <>
              <p className="mt-2 text-sm">
                Open for {drawer.businessDay}
                {drawer.openedAt ? ` since ${new Date(drawer.openedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : ""}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onTill("drop")}
                  className="pos-tile rounded-lg border border-[var(--pos-border)] bg-[var(--pos-surface-2)] px-3 py-2 text-sm font-semibold"
                >
                  Cash drop
                </button>
                <button
                  type="button"
                  onClick={() => onTill("close")}
                  className="pos-tile rounded-lg border border-[var(--pos-border)] bg-[var(--pos-surface-2)] px-3 py-2 text-sm font-semibold"
                >
                  Close (blind count)
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="mt-2 text-sm text-[var(--pos-warn)]">
                No open drawer — count in your starting float before ringing sales.
              </p>
              <button
                type="button"
                onClick={() => onTill("open")}
                className="pos-tile mt-3 rounded-lg bg-[var(--pos-accent)] px-3 py-2 text-sm font-bold text-[var(--pos-accent-ink)]"
              >
                Count in drawer
              </button>
            </>
          )}
        </div>
        <div className="rounded-2xl border border-[var(--pos-border)] bg-[var(--pos-surface)] p-4">
          <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--pos-text-muted)]">
            <span
              className={`h-2 w-2 rounded-full ${!online ? "bg-[var(--pos-danger)]" : pendingCount > 0 ? "bg-[var(--pos-warn-dot)]" : "bg-[var(--pos-accent)]"}`}
              aria-hidden
            />
            Sync
          </h2>
          <p className="mt-2 text-sm">
            {pendingCount} pending · last sync {syncLabel}
          </p>
          <button
            type="button"
            onClick={onSyncNow}
            className="pos-tile mt-3 rounded-lg border border-[var(--pos-border)] bg-[var(--pos-surface-2)] px-3 py-2 text-sm font-semibold"
          >
            Sync now
          </button>
        </div>
        <div className="rounded-2xl border border-[var(--pos-border)] bg-[var(--pos-surface)] p-4">
          <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--pos-text-muted)]">
            <span className={`h-2 w-2 rounded-full ${menuReady ? "bg-[var(--pos-accent)]" : "bg-[var(--pos-warn-dot)]"}`} aria-hidden />
            Menu
          </h2>
          <p className="mt-2 text-sm">
            {menuFetchedAt
              ? `Downloaded ${new Date(menuFetchedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
              : "Not downloaded yet"}
          </p>
          {lowStock > 0 ? (
            <p className="mt-1 text-xs font-semibold text-[var(--pos-warn)]">
              {lowStock} item{lowStock === 1 ? "" : "s"} running low — flagged on the sale screen
            </p>
          ) : null}
          <button
            type="button"
            onClick={onRefreshMenu}
            className="pos-tile mt-3 rounded-lg border border-[var(--pos-border)] bg-[var(--pos-surface-2)] px-3 py-2 text-sm font-semibold"
          >
            Refresh menu
          </button>
        </div>
        <div className="rounded-2xl border border-[var(--pos-border)] bg-[var(--pos-surface)] p-4">
          <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--pos-text-muted)]">
            <span className={`h-2 w-2 rounded-full ${rejectedCount > 0 ? "bg-[var(--pos-danger)]" : "bg-[var(--pos-accent)]"}`} aria-hidden />
            Queue health
          </h2>
          {rejectedCount > 0 ? (
            <p className="mt-2 text-sm font-semibold text-[var(--pos-danger)]">
              {rejectedCount} rejected event{rejectedCount === 1 ? "" : "s"} — a manager reviews these in the back office.
            </p>
          ) : (
            <p className="mt-2 text-sm text-[var(--pos-text-muted)]">
              All clear — nothing rejected on this device.
            </p>
          )}
        </div>
      </section>

      <section className="mt-4 grid gap-4 sm:grid-cols-3">
        <button
          type="button"
          onClick={onReprintLast}
          disabled={!onReprintLast}
          title={onReprintLast ? undefined : "No receipt stored yet — completes with the first sale"}
          className="pos-tile rounded-2xl border border-[var(--pos-border)] bg-[var(--pos-surface)] p-5 text-left text-base font-semibold disabled:opacity-40"
        >
          <span aria-hidden>🧾</span> Reprint last receipt
          <span className="mt-1 block text-xs font-normal text-[var(--pos-text-faint)]">
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
          className="pos-tile rounded-2xl border border-[var(--pos-border)] bg-[var(--pos-surface)] p-5 text-left text-base font-semibold disabled:opacity-40"
        >
          <span aria-hidden>💵</span> No sale — open drawer
          <span className="mt-1 block text-xs font-normal text-[var(--pos-text-faint)]">
            Needs a reason + a manager&rsquo;s PIN; prints an audit slip, then the drawer pops
          </span>
        </button>
        <button
          type="button"
          onClick={onDayReport}
          className="pos-tile rounded-2xl border border-[var(--pos-border)] bg-[var(--pos-surface)] p-5 text-left text-base font-semibold"
        >
          <span aria-hidden>📊</span> Day report (X/Z)
          <span className="mt-1 block text-xs font-normal text-[var(--pos-text-faint)]">
            Manager PIN required — prints the day&rsquo;s totals; never pops the drawer
          </span>
        </button>
        <button
          type="button"
          onClick={onVoidSale}
          disabled={!onVoidSale}
          title={onVoidSale ? undefined : "Voids need a connection — the server reverses the sale"}
          className="pos-tile rounded-2xl border border-[var(--pos-border)] bg-[var(--pos-surface)] p-5 text-left text-base font-semibold disabled:opacity-40"
        >
          <span aria-hidden>↩️</span> Void a sale (today)
          <span className="mt-1 block text-xs font-normal text-[var(--pos-text-faint)]">
            Same-day mistakes only — manager PIN; restocks stock and returns the cash. Older sales: returns desk
          </span>
        </button>
        <button
          type="button"
          onClick={onReturnSale}
          disabled={!onReturnSale}
          title={onReturnSale ? undefined : "Returns need a connection — the server moves inventory and queues the CCRS correction"}
          className="pos-tile rounded-2xl border border-[var(--pos-border)] bg-[var(--pos-surface)] p-5 text-left text-base font-semibold disabled:opacity-40"
        >
          <span aria-hidden>📦</span> Return an item
          <span className="mt-1 block text-xs font-normal text-[var(--pos-text-faint)]">
            Loyalty members, 15-day window — manager PIN; exact refund from the receipt, restock or destroy
          </span>
        </button>
        <button
          type="button"
          onClick={onLeaderboard}
          disabled={!onLeaderboard}
          title={onLeaderboard ? undefined : "The leaderboard needs a connection — it reads the store's ledger"}
          className="pos-tile rounded-2xl border border-[var(--pos-border)] bg-[var(--pos-surface)] p-5 text-left text-base font-semibold disabled:opacity-40"
        >
          <span aria-hidden>🏆</span> Leaderboard
          <span className="mt-1 block text-xs font-normal text-[var(--pos-text-faint)]">
            Today&rsquo;s top budtenders by sales + this week&rsquo;s champions — whole store competes
          </span>
        </button>
      </section>

      <footer className="mt-auto pt-8 text-center text-xs text-[var(--pos-text-faint)]">
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
      <div className="w-full max-w-md rounded-2xl border border-[var(--pos-border)] bg-[var(--pos-surface)] p-6 text-[var(--pos-text)]">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">No sale — open drawer</h2>
          <button type="button" onClick={onClose} className="pos-tile rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-3 py-1.5 text-sm">
            Cancel
          </button>
        </div>
        <p className="mt-2 text-xs text-[var(--pos-text-muted)]">
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
                preset === p ? "bg-[var(--pos-accent)] text-[var(--pos-accent-ink)]" : "border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] text-[var(--pos-text-muted)]"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
        <input
          className="mt-3 w-full rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-3 py-2.5 text-sm"
          placeholder="Or type another reason (3–500 characters)…"
          value={custom}
          maxLength={500}
          onChange={(e) => {
            setCustom(e.target.value);
            if (e.target.value) setPreset(null);
          }}
        />

        <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-[var(--pos-text-muted)]">
          Manager / lead PIN
        </label>
        <input
          className="mt-1 w-full rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-3 py-2.5 text-center font-mono text-lg tracking-[0.5em]"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={pin}
          maxLength={6}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
        />

        {error ? <p className="mt-3 rounded-lg bg-[var(--pos-danger-soft)] px-3 py-2 text-sm text-[var(--pos-danger)]">{error}</p> : null}

        <button
          type="button"
          onClick={() => void approve()}
          disabled={!reasonOk || pin.length < 4 || busy}
          className="mt-5 pos-tile w-full rounded-xl bg-[var(--pos-accent)] py-3 text-base font-semibold text-[var(--pos-accent-ink)] disabled:opacity-40"
        >
          {busy ? "Verifying…" : "Approve, print slip & open drawer"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// B27 — Void sale modal: receipt lookup → reason + manager PIN → reversal
// ---------------------------------------------------------------------------

/**
 * Void a SAME-DAY sale. Two steps: (1) type the receipt number and the
 * server shows exactly what would be voided (lines + cash back) or the
 * complete list of policy failures; (2) a reason + a manager/lead PIN
 * processes the reversal server-side (/api/pos/void — lifecycle, restock,
 * loyalty clawback, audit) and hands back a void slip. The drawer POPS on
 * print: the customer's cash goes back out. ONLINE-ONLY — a void reverses
 * durable server facts; there is nothing sensible to queue offline.
 */
function VoidSaleModal({
  creds,
  employeeName,
  onClose,
  onVoided,
}: {
  creds: DeviceCreds;
  employeeName: string;
  onClose: () => void;
  onVoided: (slipHtml: string, message: string) => void;
}) {
  const PRESETS = VOID_REASON_PRESETS;
  const [receipt, setReceipt] = useState("");
  const [sale, setSale] = useState<{
    receiptNumber: string;
    orderNumber: string;
    totalMinor: number;
    lines: { productName: string; quantity: number }[];
  } | null>(null);
  const [preset, setPreset] = useState<string | null>(null);
  const [custom, setCustom] = useState("");
  const [pin, setPin] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const reason = (preset ?? custom).trim();
  const reasonOk = reason.length >= 3 && reason.length <= 500;

  const call = async (body: Record<string, unknown>) => {
    const res = await fetch("/api/pos/void", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-pos-device-id": creds.deviceId,
        "x-pos-device-key": creds.deviceKey,
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return { ok: res.ok, json };
  };

  const lookup = async () => {
    if (busy || receipt.trim().length < 4) return;
    setBusy(true);
    setErrors([]);
    try {
      const { ok, json } = await call({ receipt: receipt.trim() });
      if (!ok || !json?.sale) {
        const errs = Array.isArray(json?.errors) ? (json.errors as string[]) : [String(json?.error ?? "Lookup failed.")];
        setErrors(errs);
        setSale(null);
        return;
      }
      setSale(json.sale as typeof sale);
    } catch {
      setErrors(["Could not reach the server — try again."]);
    } finally {
      setBusy(false);
    }
  };

  const processVoid = async () => {
    if (busy || !sale || !reasonOk || pin.length < 4) return;
    setBusy(true);
    setErrors([]);
    try {
      const { ok, json } = await call({
        receipt: sale.receiptNumber,
        reason,
        pin,
        processedByName: employeeName,
      });
      if (!ok || !json?.slipHtml) {
        setErrors([String(json?.error ?? "Void failed.")]);
        setPin("");
        return;
      }
      const refund = Number(json.refundMinor ?? 0);
      const points = Number(json.pointsClawed ?? 0);
      onVoided(
        String(json.slipHtml),
        `Sale ${sale.receiptNumber} voided — hand back $${(refund / 100).toFixed(2)} cash${points > 0 ? `; ${points} points reversed` : ""}.`,
      );
    } catch {
      setErrors(["Could not reach the server — try again."]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-[var(--pos-border)] bg-[var(--pos-surface)] p-6 text-[var(--pos-text)]">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Void a sale (today)</h2>
          <button type="button" onClick={onClose} className="pos-tile rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-3 py-1.5 text-sm">
            Cancel
          </button>
        </div>
        <p className="mt-2 text-xs text-[var(--pos-text-muted)]">
          Same-day mistakes only — the whole sale reverses: stock goes back, points come back off, and the
          customer gets their cash. Older sales belong at the returns desk (back office).
        </p>

        <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-[var(--pos-text-muted)]">
          Receipt number
        </label>
        <div className="mt-1 flex gap-2">
          <input
            className="w-full rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-3 py-2.5 font-mono text-lg uppercase"
            value={receipt}
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={8}
            placeholder="8 characters"
            onChange={(e) => {
              setReceipt(e.target.value.toUpperCase());
              setSale(null);
            }}
          />
          <button
            type="button"
            onClick={() => void lookup()}
            disabled={busy || receipt.trim().length < 4}
            className="pos-tile rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-4 py-2 text-sm font-semibold disabled:opacity-40"
          >
            {busy && !sale ? "…" : "Find"}
          </button>
        </div>

        {sale ? (
          <>
            <div className="mt-4 rounded-xl border border-[var(--pos-border)] bg-[var(--pos-surface-2)] p-4">
              <p className="text-sm font-semibold">
                Order {sale.orderNumber} · {formatCents(sale.totalMinor)} cash back
              </p>
              <ul className="mt-2 space-y-1 text-xs text-[var(--pos-text-muted)]">
                {sale.lines.map((l, i) => (
                  <li key={i}>
                    {l.quantity}x {l.productName}
                  </li>
                ))}
              </ul>
            </div>

            <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-[var(--pos-text-muted)]">Reason</label>
            <div className="mt-2 flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => {
                    setPreset(preset === p ? null : p);
                    setCustom("");
                  }}
                  className={`rounded-lg px-3 py-2 text-xs font-semibold ${
                    preset === p ? "bg-[var(--pos-accent)] text-[var(--pos-accent-ink)]" : "border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] text-[var(--pos-text-muted)]"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
            <input
              className="mt-2 w-full rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-3 py-2.5 text-sm"
              placeholder="…or type a reason"
              value={custom}
              onChange={(e) => {
                setCustom(e.target.value);
                if (e.target.value) setPreset(null);
              }}
            />

            <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-[var(--pos-text-muted)]">
              Manager / lead PIN
            </label>
            <input
              className="mt-1 w-full rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-3 py-2.5 text-center font-mono text-lg tracking-[0.5em]"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              maxLength={6}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
            />
          </>
        ) : null}

        {errors.length > 0 ? (
          <ul className="mt-3 space-y-1 rounded-lg bg-[var(--pos-danger-soft)] px-3 py-2 text-sm text-[var(--pos-danger)]">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        ) : null}

        {sale ? (
          <button
            type="button"
            onClick={() => void processVoid()}
            disabled={!reasonOk || pin.length < 4 || busy}
            className="mt-5 w-full rounded-xl bg-[var(--pos-danger-solid)] py-3 text-base font-semibold text-white disabled:opacity-40"
          >
            {busy ? "Voiding…" : `Void sale & return ${formatCents(sale.totalMinor)}`}
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AM-C — Counter returns at the register: receipt-first, policy-gated,
// manager PIN, exact refund from the stored paid price, restock/destroy
// ---------------------------------------------------------------------------

/** Human labels for the compliance reason codes (values stay canonical). */
const RETURN_REASON_LABELS: Record<string, string> = {
  defective: "Defective",
  wrong_item: "Wrong item",
  adverse_reaction: "Adverse reaction",
  quality: "Quality issue",
  mislabeled: "Mislabeled",
  other: "Other",
};

type ReturnableSale = {
  receiptNumber: string;
  orderNumber: string;
  purchasedAtIso: string;
  memberLabel: string;
  daysRemaining: number;
  orderTotalMinor: number;
  lines: {
    lineId: string;
    productName: string;
    quantity: number;
    priceMinorUnits: number;
    alreadyReturned: number;
    remainingReturnable: number;
  }[];
};

/**
 * Return an item at the register. Same machinery as the back-office returns
 * desk (B16) — receipt lookup with the COMPLETE policy verdict, pick the
 * line + quantity, reason, restock/destroy, the two WAC 314-55-079(12)
 * attestations (original packaging + legible lot ID), then a manager/lead
 * PIN processes it server-side (/api/pos/returns → Task Q pipeline, CCRS
 * correction queue, proportional loyalty clawback) and hands back a refund
 * receipt. The drawer POPS on print: the refund cash goes out. ONLINE-ONLY.
 */
function ReturnsModal({
  creds,
  employeeName,
  onClose,
  onReturned,
}: {
  creds: DeviceCreds;
  employeeName: string;
  onClose: () => void;
  onReturned: (receiptHtml: string, message: string) => void;
}) {
  const [receipt, setReceipt] = useState("");
  const [sale, setSale] = useState<ReturnableSale | null>(null);
  const [lineId, setLineId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState<string | null>(null);
  const [detail, setDetail] = useState("");
  const [disposition, setDisposition] = useState<"restock" | "destroy" | null>(null);
  const [originalPackaging, setOriginalPackaging] = useState(false);
  const [lotIdLegible, setLotIdLegible] = useState(false);
  const [pin, setPin] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const line = sale?.lines.find((l) => l.lineId === lineId) ?? null;
  const maxQty = line?.remainingReturnable ?? 0;
  const refundPreviewMinor = line ? line.priceMinorUnits * Math.min(quantity, maxQty) : 0;
  const ready =
    !!sale && !!line && quantity >= 1 && quantity <= maxQty && !!reason && !!disposition &&
    originalPackaging && lotIdLegible && pin.length >= 4;

  const call = async (body: Record<string, unknown>) => {
    const res = await fetch("/api/pos/returns", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-pos-device-id": creds.deviceId,
        "x-pos-device-key": creds.deviceKey,
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return { ok: res.ok, json };
  };

  const lookup = async () => {
    if (busy || receipt.trim().length < 4) return;
    setBusy(true);
    setErrors([]);
    setSale(null);
    setLineId(null);
    try {
      const { ok, json } = await call({ receipt: receipt.trim() });
      if (!ok || !json?.sale) {
        const errs = Array.isArray(json?.errors) ? (json.errors as string[]) : [String(json?.error ?? "Lookup failed.")];
        setErrors(errs);
        return;
      }
      const found = json.sale as ReturnableSale;
      setSale(found);
      const returnable = found.lines.filter((l) => l.remainingReturnable > 0);
      if (returnable.length === 1) {
        setLineId(returnable[0].lineId);
        setQuantity(1);
      }
    } catch {
      setErrors(["Could not reach the server — try again."]);
    } finally {
      setBusy(false);
    }
  };

  const processReturn = async () => {
    if (busy || !ready || !sale || !line) return;
    setBusy(true);
    setErrors([]);
    try {
      const { ok, json } = await call({
        receipt: sale.receiptNumber,
        orderLineId: line.lineId,
        quantity,
        reason,
        detail: detail.trim(),
        disposition,
        originalPackaging,
        lotIdLegible,
        pin,
        processedByName: employeeName,
      });
      if (!ok || !json?.receiptHtml) {
        setErrors([String(json?.error ?? "Return failed.")]);
        setPin("");
        return;
      }
      const refund = Number(json.refundMinor ?? 0);
      const points = Number(json.pointsClawed ?? 0);
      onReturned(
        String(json.receiptHtml),
        `Return processed — hand back ${formatCents(refund)} cash${points > 0 ? `; ${points} points reversed` : ""}.${disposition === "destroy" ? " Product goes to the quarantine bin." : ""}`,
      );
    } catch {
      setErrors(["Could not reach the server — try again."]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-[var(--pos-border)] bg-[var(--pos-surface)] p-6 text-[var(--pos-text)]">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Return an item</h2>
          <button type="button" onClick={onClose} className="pos-tile rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-3 py-1.5 text-sm">
            Cancel
          </button>
        </div>
        <p className="mt-2 text-xs text-[var(--pos-text-muted)]">
          Loyalty members within the 15-day window. The refund is the exact price paid on the receipt —
          nothing is typed by hand. Product must be in its original packaging with the lot ID fully legible
          (state law), or the return must be refused.
        </p>

        <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-[var(--pos-text-muted)]">
          Receipt number
        </label>
        <div className="mt-1 flex gap-2">
          <input
            className="w-full rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-3 py-2.5 font-mono text-lg uppercase"
            value={receipt}
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={8}
            placeholder="8 characters"
            onChange={(e) => {
              setReceipt(e.target.value.toUpperCase());
              setSale(null);
              setLineId(null);
            }}
          />
          <button
            type="button"
            onClick={() => void lookup()}
            disabled={busy || receipt.trim().length < 4}
            className="pos-tile rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-4 py-2 text-sm font-semibold disabled:opacity-40"
          >
            {busy && !sale ? "…" : "Find"}
          </button>
        </div>

        {sale ? (
          <>
            <div className="mt-4 rounded-xl border border-[var(--pos-border)] bg-[var(--pos-surface-2)] p-4">
              <p className="text-sm font-semibold">
                Order {sale.orderNumber} · {sale.memberLabel}
              </p>
              <p className="mt-1 text-xs text-[var(--pos-text-muted)]">
                {sale.daysRemaining} day{sale.daysRemaining === 1 ? "" : "s"} left in the return window
              </p>
            </div>

            <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-[var(--pos-text-muted)]">
              Item being returned
            </label>
            <div className="mt-2 space-y-2">
              {sale.lines.map((l) => {
                const selectable = l.remainingReturnable > 0;
                const selected = lineId === l.lineId;
                return (
                  <button
                    key={l.lineId}
                    type="button"
                    disabled={!selectable}
                    onClick={() => {
                      setLineId(selected ? null : l.lineId);
                      setQuantity(1);
                    }}
                    className={`w-full rounded-lg px-3 py-2.5 text-left text-sm disabled:opacity-40 ${
                      selected
                        ? "bg-[var(--pos-accent)] font-semibold text-[var(--pos-accent-ink)]"
                        : "border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)]"
                    }`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span>{l.productName}</span>
                      <span className="font-mono">{formatCents(l.priceMinorUnits)}</span>
                    </span>
                    <span className={`mt-0.5 block text-xs ${selected ? "" : "text-[var(--pos-text-muted)]"}`}>
                      {selectable
                        ? `${l.remainingReturnable} of ${l.quantity} returnable${l.alreadyReturned > 0 ? ` (${l.alreadyReturned} already returned)` : ""}`
                        : "Fully returned"}
                    </span>
                  </button>
                );
              })}
            </div>

            {line ? (
              <>
                {maxQty > 1 ? (
                  <>
                    <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-[var(--pos-text-muted)]">
                      Quantity (max {maxQty})
                    </label>
                    <div className="mt-2 flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                        className="pos-tile h-11 w-11 rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] text-xl font-bold"
                      >
                        −
                      </button>
                      <span className="min-w-[2ch] text-center font-mono text-xl font-semibold">{quantity}</span>
                      <button
                        type="button"
                        onClick={() => setQuantity((q) => Math.min(maxQty, q + 1))}
                        className="pos-tile h-11 w-11 rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] text-xl font-bold"
                      >
                        +
                      </button>
                    </div>
                  </>
                ) : null}

                <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-[var(--pos-text-muted)]">Reason</label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {CUSTOMER_RETURN_REASONS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setReason(reason === r ? null : r)}
                      className={`rounded-lg px-3 py-2 text-xs font-semibold ${
                        reason === r
                          ? "bg-[var(--pos-accent)] text-[var(--pos-accent-ink)]"
                          : "border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] text-[var(--pos-text-muted)]"
                      }`}
                    >
                      {RETURN_REASON_LABELS[r] ?? r}
                    </button>
                  ))}
                </div>
                <input
                  className="mt-2 w-full rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-3 py-2.5 text-sm"
                  placeholder="Detail (optional — required context for CCRS on 'Other')"
                  value={detail}
                  onChange={(e) => setDetail(e.target.value)}
                />

                <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-[var(--pos-text-muted)]">
                  What happens to the product
                </label>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setDisposition("restock")}
                    className={`rounded-lg px-3 py-2.5 text-sm font-semibold ${
                      disposition === "restock"
                        ? "bg-[var(--pos-accent)] text-[var(--pos-accent-ink)]"
                        : "border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] text-[var(--pos-text-muted)]"
                    }`}
                  >
                    Restock — sellable
                  </button>
                  <button
                    type="button"
                    onClick={() => setDisposition("destroy")}
                    className={`rounded-lg px-3 py-2.5 text-sm font-semibold ${
                      disposition === "destroy"
                        ? "bg-[var(--pos-danger-solid)] text-white"
                        : "border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] text-[var(--pos-text-muted)]"
                    }`}
                  >
                    Destroy — quarantine
                  </button>
                </div>

                <div className="mt-4 space-y-2 rounded-xl border border-[var(--pos-border)] bg-[var(--pos-surface-2)] p-3">
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-5 w-5"
                      checked={originalPackaging}
                      onChange={(e) => setOriginalPackaging(e.target.checked)}
                    />
                    <span>Product is in its ORIGINAL packaging</span>
                  </label>
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-5 w-5"
                      checked={lotIdLegible}
                      onChange={(e) => setLotIdLegible(e.target.checked)}
                    />
                    <span>Lot / batch ID on the package is FULLY LEGIBLE</span>
                  </label>
                  <p className="text-xs text-[var(--pos-text-faint)]">
                    Both are required by WAC 314-55-079(12) — if either fails, refuse the return.
                  </p>
                </div>

                <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-[var(--pos-text-muted)]">
                  Manager / lead PIN
                </label>
                <input
                  className="mt-1 w-full rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-3 py-2.5 text-center font-mono text-lg tracking-[0.5em]"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  value={pin}
                  maxLength={6}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                />
              </>
            ) : null}
          </>
        ) : null}

        {errors.length > 0 ? (
          <ul className="mt-3 space-y-1 rounded-lg bg-[var(--pos-danger-soft)] px-3 py-2 text-sm text-[var(--pos-danger)]">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        ) : null}

        {sale && line ? (
          <button
            type="button"
            onClick={() => void processReturn()}
            disabled={!ready || busy}
            className="mt-5 w-full rounded-xl bg-[var(--pos-accent)] py-3 text-base font-semibold text-[var(--pos-accent-ink)] disabled:opacity-40"
          >
            {busy ? "Processing…" : `Process return & refund ${formatCents(refundPreviewMinor)}`}
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// B28 — Pickup queue modal: website orders → ID check at handover → cash →
// the SAME server completion gate every sale runs → receipt + drawer pop
// ---------------------------------------------------------------------------

type PickupDetail = {
  orderId: string;
  orderNumber: string;
  customerLabel: string;
  status: string;
  itemCount: number;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  customerNote: string | null;
  placedAtIso: string;
  lines: { productName: string; variantLabel: string | null; quantity: number; priceMinor: number }[];
};

/**
 * The register's window into the website order queue. Three panes in one
 * modal: the queue (ready-first, oldest-first), one order's lines, and the
 * handover (explicit ID attestation checkbox → cash tendered → complete).
 * The server re-runs EVERYTHING (evaluatePickupCompletion + the full
 * completion gate), so this UI can never hand over what the law wouldn't.
 * ONLINE-ONLY; requires an open drawer (the cash goes into it).
 */
function PickupQueueModal({
  creds,
  employee,
  drawerSessionId,
  onClose,
  onCompleted,
}: {
  creds: DeviceCreds;
  employee: UnlockedEmployee;
  drawerSessionId: string;
  onClose: () => void;
  onCompleted: (receiptHtml: string, message: string) => void;
}) {
  const [queue, setQueue] = useState<PickupQueueEntry[] | null>(null);
  const [detail, setDetail] = useState<PickupDetail | null>(null);
  const [idConfirmed, setIdConfirmed] = useState(false);
  const [tendered, setTendered] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const headers = useMemo(
    () => ({
      "content-type": "application/json",
      "x-pos-device-id": creds.deviceId,
      "x-pos-device-key": creds.deviceKey,
    }),
    [creds],
  );

  const loadQueue = useCallback(async () => {
    setErrors([]);
    try {
      const res = await fetch("/api/pos/pickup", { headers });
      const body = (await res.json().catch(() => null)) as { queue?: PickupQueueEntry[]; error?: string } | null;
      if (!res.ok || !Array.isArray(body?.queue)) {
        setErrors([body?.error ?? "Could not load the pickup queue."]);
        setQueue([]);
        return;
      }
      setQueue(body.queue);
    } catch {
      setErrors(["Could not reach the server — try again."]);
      setQueue([]);
    }
  }, [headers]);

  useEffect(() => {
    // Deferred a tick (same pattern as the shell's menu refresh) so the
    // effect body never sets state synchronously during mount.
    const t = setTimeout(() => void loadQueue(), 0);
    return () => clearTimeout(t);
  }, [loadQueue]);

  const openOrder = async (orderId: string) => {
    if (busy) return;
    setBusy(true);
    setErrors([]);
    try {
      const res = await fetch("/api/pos/pickup", { method: "POST", headers, body: JSON.stringify({ orderId }) });
      const body = (await res.json().catch(() => null)) as { order?: PickupDetail; error?: string } | null;
      if (!res.ok || !body?.order) {
        setErrors([body?.error ?? "Could not load the order."]);
        return;
      }
      setDetail(body.order);
      setIdConfirmed(false);
      setTendered("");
    } catch {
      setErrors(["Could not reach the server — try again."]);
    } finally {
      setBusy(false);
    }
  };

  const tenderedMinor = dollarsToMinor(tendered);
  const canComplete =
    !!detail && idConfirmed && tenderedMinor !== null && tenderedMinor >= detail.totalMinor && !busy;

  const complete = async () => {
    if (!detail || !canComplete || tenderedMinor === null) return;
    setBusy(true);
    setErrors([]);
    try {
      const res = await fetch("/api/pos/pickup", {
        method: "POST",
        headers,
        body: JSON.stringify({
          orderId: detail.orderId,
          complete: { employeeId: employee.id, tenderedMinor, idConfirmed, drawerSessionId },
        }),
      });
      const body = (await res.json().catch(() => null)) as
        | { changeMinor?: number; receiptHtml?: string; orderNumber?: string; errors?: string[]; error?: string }
        | null;
      if (!res.ok || !body?.receiptHtml) {
        setErrors(Array.isArray(body?.errors) ? body.errors : [body?.error ?? "Completion failed."]);
        return;
      }
      const change = Number(body.changeMinor ?? 0);
      onCompleted(
        body.receiptHtml,
        `Order ${body.orderNumber ?? detail.orderNumber} handed over — give ${formatCents(change)} change.`,
      );
    } catch {
      setErrors(["Could not reach the server — try again."]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[var(--pos-border)] bg-[var(--pos-surface)] p-6 text-[var(--pos-text)]">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {detail ? `Order ${detail.orderNumber} — ${detail.customerLabel}` : "Pickup orders"}
          </h2>
          <div className="flex gap-2">
            {detail ? (
              <button
                type="button"
                onClick={() => {
                  setDetail(null);
                  setErrors([]);
                  void loadQueue();
                }}
                className="pos-tile rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-3 py-1.5 text-sm"
              >
                Back
              </button>
            ) : null}
            <button type="button" onClick={onClose} className="pos-tile rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-3 py-1.5 text-sm">
              Close
            </button>
          </div>
        </div>

        {!detail ? (
          <>
            <p className="mt-2 text-xs text-[var(--pos-text-muted)]">
              Website orders, ready first. Tap one to hand it over — the ID check happens HERE, at the counter,
              and the sale runs the same compliance gate as every register sale.
            </p>
            {queue === null ? (
              <p className="mt-6 text-center text-sm text-[var(--pos-text-faint)]">Loading…</p>
            ) : queue.length === 0 ? (
              <p className="mt-6 rounded-xl border border-[var(--pos-border)] bg-[var(--pos-surface-2)] p-6 text-center text-sm text-[var(--pos-text-faint)]">
                No website orders waiting. New orders appear here the moment they&rsquo;re placed.
              </p>
            ) : (
              <ul className="mt-4 space-y-2">
                {queue.map((q) => (
                  <li key={q.orderId}>
                    <button
                      type="button"
                      onClick={() => void openOrder(q.orderId)}
                      disabled={busy}
                      className={`w-full rounded-xl border p-4 text-left disabled:opacity-40 ${
                        q.status === "ready"
                          ? "border-[var(--pos-accent-border)] bg-[var(--pos-accent-soft)]"
                          : "border-[var(--pos-border)] bg-[var(--pos-surface-2)]"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold">
                          {q.orderNumber} · {q.customerLabel}
                        </span>
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                            q.status === "ready" ? "bg-[var(--pos-accent)] text-[var(--pos-accent-ink)]" : "border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] text-[var(--pos-text-muted)]"
                          }`}
                        >
                          {q.statusLabel}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-[var(--pos-text-muted)]">
                        {q.itemCount} item{q.itemCount === 1 ? "" : "s"} · {formatCents(q.totalMinor)} · waiting{" "}
                        {q.minutesWaiting < 60
                          ? `${q.minutesWaiting} min`
                          : `${Math.floor(q.minutesWaiting / 60)}h ${q.minutesWaiting % 60}m`}
                        {q.hasCustomerNote ? " · has a note" : ""}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <>
            <div className="mt-4 rounded-xl border border-[var(--pos-border)] bg-[var(--pos-surface-2)] p-4">
              <ul className="space-y-1.5 text-sm">
                {detail.lines.map((l, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-3">
                    <span>
                      {l.quantity}x {l.productName}
                      {l.variantLabel ? ` (${l.variantLabel})` : ""}
                    </span>
                    <span className="shrink-0 font-mono text-[var(--pos-text)]">{formatCents(l.priceMinor * l.quantity)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 border-t border-[var(--pos-border)] pt-2 text-sm">
                <div className="flex justify-between text-[var(--pos-text-muted)]">
                  <span>Subtotal</span>
                  <span className="font-mono">{formatCents(detail.subtotalMinor)}</span>
                </div>
                <div className="flex justify-between text-[var(--pos-text-muted)]">
                  <span>Tax</span>
                  <span className="font-mono">{formatCents(detail.taxMinor)}</span>
                </div>
                <div className="mt-1 flex justify-between text-base font-bold">
                  <span>Total due (cash)</span>
                  <span className="font-mono">{formatCents(detail.totalMinor)}</span>
                </div>
              </div>
            </div>

            {detail.customerNote ? (
              <p className="mt-3 rounded-lg bg-[var(--pos-info-soft)] px-3 py-2 text-xs text-[var(--pos-info)]">
                Customer note: {detail.customerNote}
              </p>
            ) : null}

            <label className="mt-4 flex items-start gap-3 rounded-xl border border-[var(--pos-warn-border)] bg-[var(--pos-warn-soft)] p-4">
              <input
                type="checkbox"
                checked={idConfirmed}
                onChange={(e) => setIdConfirmed(e.target.checked)}
                className="mt-0.5 h-5 w-5"
              />
              <span className="text-sm text-[var(--pos-warn)]">
                I checked <strong>{detail.customerLabel}</strong>&rsquo;s ID at the counter — valid, photo matches,
                21+ (WAC 314-55-150). Age verification happens at handover, not at checkout.
              </span>
            </label>

            <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-[var(--pos-text-muted)]">
              Cash tendered
            </label>
            <input
              className="mt-1 w-full rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-3 py-2.5 font-mono text-lg"
              inputMode="decimal"
              autoComplete="off"
              placeholder={`at least ${formatCents(detail.totalMinor)}`}
              value={tendered}
              onChange={(e) => setTendered(e.target.value)}
            />
            {tenderedMinor !== null && tenderedMinor >= detail.totalMinor ? (
              <>
                <p className="mt-1 text-sm text-[var(--pos-accent)]">
                  Change due: {formatCents(tenderedMinor - detail.totalMinor)}
                </p>
                {/* B31 — count-back plan (fewest bills/coins) for the handover. */}
                {tenderedMinor > detail.totalMinor ? (
                  <p className="mt-1 text-sm font-semibold text-[var(--pos-text)]">
                    {formatChangeBreakdown(changeBreakdown(tenderedMinor - detail.totalMinor) ?? [])}
                  </p>
                ) : null}
              </>
            ) : null}

            <button
              type="button"
              onClick={() => void complete()}
              disabled={!canComplete}
              className="mt-5 pos-tile w-full rounded-xl bg-[var(--pos-accent)] py-3 text-base font-semibold text-[var(--pos-accent-ink)] disabled:opacity-40"
            >
              {busy ? "Completing…" : `Complete pickup — ${formatCents(detail.totalMinor)} cash`}
            </button>
          </>
        )}

        {errors.length > 0 ? (
          <ul className="mt-3 space-y-1 rounded-lg bg-[var(--pos-danger-soft)] px-3 py-2 text-sm text-[var(--pos-danger)]">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// B22 — Day report modal: manager PIN → X/Z slip printed on the Star
// ---------------------------------------------------------------------------

/**
 * X/Z day report for THIS register. MANAGER-GATED: the slip reveals gross
 * cash + opening float − drops (the expected drawer figure the blind close
 * hides), so /api/pos/day-report requires a manager/lead PIN — same role
 * gate as /api/pos/approve. The server returns DATA; the slip is built
 * here (576px, same family as receipts) and printed with the drawer kick
 * OFF — a report never pops the drawer. ONLINE-ONLY (PIN verification).
 */
function DayReportModal({
  creds,
  receiptConfig,
  onClose,
}: {
  creds: DeviceCreds;
  receiptConfig: ReturnType<typeof normalizePosReceiptConfig> | null;
  onClose: () => void;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (pin.length < 4 || busy) return;
    if (!navigator.onLine) {
      setError("Offline — the day report needs a connection to verify the PIN and read the day's ledger.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/pos/day-report", {
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
            ok?: boolean;
            kind?: "X" | "Z";
            businessDay?: string;
            requestedByName?: string;
            summary?: DaySummary;
            drawer?: DrawerDaySummary | null;
            error?: string;
          }
        | null;
      if (!res.ok || !body?.ok || !body.summary || !body.kind || !body.businessDay) {
        setError(body?.error ?? "Day report failed — try again.");
        setPin("");
        return;
      }
      const html = buildDayReportSlipHtml({
        kind: body.kind,
        registerLabel: creds.name,
        businessDay: body.businessDay,
        printedAtIso: new Date().toISOString(),
        requestedByName: body.requestedByName ?? "Manager",
        summary: body.summary,
        drawer: body.drawer ?? null,
        headerText: receiptConfig?.headerText ?? null,
        addressLines: receiptConfig ? receiptAddressLines(receiptConfig) : [],
      });
      onClose();
      const backUrl = window.location.origin + window.location.pathname;
      // A report NEVER pops the drawer.
      window.location.href = buildPassPrntUrl(html, { backUrl, openDrawer: false });
    } catch {
      setError("Could not reach the server — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-2xl border border-[var(--pos-border)] bg-[var(--pos-surface)] p-6 text-[var(--pos-text)]">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Day report (X/Z)</h2>
          <button type="button" onClick={onClose} className="pos-tile rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-3 py-1.5 text-sm">
            Cancel
          </button>
        </div>
        <p className="mt-2 text-xs text-[var(--pos-text-muted)]">
          Prints this register&rsquo;s totals for today: sales, tax, medical exemptions, no-sales, drops,
          and reconciled over/short. X while a drawer is open, Z once the day is closed. Manager or lead
          PIN required — this slip reveals expected drawer cash.
        </p>

        <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-[var(--pos-text-muted)]">
          Manager / lead PIN
        </label>
        <input
          className="mt-1 w-full rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-3 py-2.5 text-center font-mono text-lg tracking-[0.5em]"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={pin}
          maxLength={6}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
        />

        {error ? <p className="mt-3 rounded-lg bg-[var(--pos-danger-soft)] px-3 py-2 text-sm text-[var(--pos-danger)]">{error}</p> : null}

        <button
          type="button"
          onClick={() => void run()}
          disabled={pin.length < 4 || busy}
          className="mt-5 pos-tile w-full rounded-xl bg-[var(--pos-accent)] py-3 text-base font-semibold text-[var(--pos-accent-ink)] disabled:opacity-40"
        >
          {busy ? "Building report…" : "Print day report"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// B34 — Budtender leaderboard: today by SALES (no dollars — blind-count
// discipline), trailing week by GROSS. Whole store competes; no PIN needed.
// ---------------------------------------------------------------------------

type LeaderboardEntry = {
  rank: number;
  name: string;
  saleCount: number;
  itemCount: number;
  grossMinor?: number;
};

function LeaderboardModal({ creds, onClose }: { creds: DeviceCreds; onClose: () => void }) {
  const [tab, setTab] = useState<"today" | "week">("today");
  const [boards, setBoards] = useState<{ today: LeaderboardEntry[]; week: LeaderboardEntry[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/pos/leaderboard", {
          headers: { "x-pos-device-id": creds.deviceId, "x-pos-device-key": creds.deviceKey },
        });
        const body = (await res.json().catch(() => null)) as
          | { ok?: boolean; today?: LeaderboardEntry[]; week?: LeaderboardEntry[]; error?: string }
          | null;
        if (cancelled) return;
        if (!res.ok || !body?.ok || !body.today || !body.week) {
          setError(body?.error ?? "Leaderboard failed — try again.");
          return;
        }
        setBoards({ today: body.today, week: body.week });
      } catch {
        if (!cancelled) setError("Could not reach the server — try again.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [creds]);

  const entries = boards ? (tab === "today" ? boards.today : boards.week) : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-[var(--pos-border)] bg-[var(--pos-surface)] p-6 text-[var(--pos-text)]">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Leaderboard 🏆</h2>
          <button type="button" onClick={onClose} className="pos-tile rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-3 py-1.5 text-sm">
            Close
          </button>
        </div>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => setTab("today")}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${tab === "today" ? "bg-[var(--pos-accent)] text-[var(--pos-accent-ink)]" : "border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] text-[var(--pos-text-muted)]"}`}
          >
            Today — by sales
          </button>
          <button
            type="button"
            onClick={() => setTab("week")}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${tab === "week" ? "bg-[var(--pos-accent)] text-[var(--pos-accent-ink)]" : "border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] text-[var(--pos-text-muted)]"}`}
          >
            This week — by dollars
          </button>
        </div>
        <p className="mt-2 text-xs text-[var(--pos-text-faint)]">
          {tab === "today"
            ? "Ranked by completed sales across every register today. Dollar totals stay off the same-day board so drawer counts stay blind."
            : "Ranked by gross sales across the trailing 7 days — every register counts."}
        </p>

        {error ? <p className="mt-4 rounded-lg bg-[var(--pos-danger-soft)] px-3 py-2 text-sm text-[var(--pos-danger)]">{error}</p> : null}
        {!boards && !error ? <p className="mt-4 text-sm text-[var(--pos-text-muted)]">Loading the standings…</p> : null}
        {boards && entries.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--pos-text-muted)]">
            No completed sales {tab === "today" ? "yet today" : "this week"} — the board starts with the first sale.
          </p>
        ) : null}

        {entries.length > 0 ? (
          <ul className="mt-4 space-y-2">
            {entries.slice(0, 10).map((e) => (
              <li
                key={`${e.rank}-${e.name}`}
                className={`flex items-center justify-between rounded-xl px-4 py-3 ${
                  e.rank === 1 ? "border border-[var(--pos-warn-border)] bg-[var(--pos-warn-soft)]" : "border border-[var(--pos-border)] bg-[var(--pos-surface-2)]"
                }`}
              >
                <span className="flex items-center gap-3">
                  <span className="w-8 text-lg font-bold text-[var(--pos-text-muted)]">
                    {medalFor(e.rank) || `#${e.rank}`}
                  </span>
                  <span className="text-base font-semibold">{e.name}</span>
                </span>
                <span className="text-right text-sm text-[var(--pos-text)]">
                  {tab === "week" && typeof e.grossMinor === "number" ? (
                    <span className="block text-base font-bold text-[var(--pos-accent)]">{formatCents(e.grossMinor)}</span>
                  ) : null}
                  {e.saleCount} sale{e.saleCount === 1 ? "" : "s"} · {e.itemCount} item{e.itemCount === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
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
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[var(--pos-border)] bg-[var(--pos-surface)] p-6 text-[var(--pos-text)]">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{TITLES[mode]}</h2>
          <button type="button" onClick={onClose} className="pos-tile rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-3 py-1.5 text-sm">
            Cancel
          </button>
        </div>
        <p className="mt-2 text-xs text-[var(--pos-text-muted)]">
          {mode === "open"
            ? `Count every bill and coin going into the drawer. The total is your starting float, recorded under ${employeeName}'s PIN.`
            : mode === "drop"
              ? `Cash pulled from the drawer into the safe. Recorded under ${employeeName}'s PIN; a second person can witness with theirs.`
              : `Count what's in the drawer right now. You will NOT see the expected amount — a manager reveals over/short at reconcile. That protects you.`}
        </p>

        {mode === "drop" ? (
          <>
            <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-[var(--pos-text-muted)]">
              Amount dropped
            </label>
            <input
              className="mt-1 w-full rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-3 py-2.5 text-lg"
              inputMode="decimal"
              placeholder="$0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-[var(--pos-text-muted)]">
              Drop window
            </label>
            <div className="mt-1 flex gap-2">
              {(["afternoon", "night", "other"] as const).map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setDropWindow(w)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold capitalize ${
                    dropWindow === w ? "bg-[var(--pos-accent)] text-[var(--pos-accent-ink)]" : "border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] text-[var(--pos-text-muted)]"
                  }`}
                >
                  {w}
                </button>
              ))}
            </div>
            <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-[var(--pos-text-muted)]">
              Witness PIN (optional, second person)
            </label>
            <input
              className="mt-1 w-full rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-3 py-2.5 text-center font-mono text-lg tracking-[0.5em]"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={witnessPin}
              maxLength={6}
              onChange={(e) => setWitnessPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
            />
            <input
              className="mt-3 w-full rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-3 py-2.5 text-sm"
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
                <label key={key} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--pos-border)] bg-[var(--pos-surface-2)] px-3 py-2">
                  <span className="text-sm font-semibold text-[var(--pos-text)]">{label}</span>
                  <input
                    className="w-20 rounded-md border border-[var(--pos-border-strong)] bg-[var(--pos-surface)] px-2 py-1.5 text-right text-sm"
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
            <p className="mt-3 rounded-lg bg-[var(--pos-surface-2)] px-3 py-2 text-right text-base font-bold">
              Counted: {formatCents(countedMinor)}
            </p>
          </>
        )}

        <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-[var(--pos-text-muted)]">
          Your PIN
        </label>
        <input
          className="mt-1 w-full rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-surface-2)] px-3 py-2.5 text-center font-mono text-lg tracking-[0.5em]"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={pin}
          maxLength={6}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
        />

        {error ? <p className="mt-3 rounded-lg bg-[var(--pos-danger-soft)] px-3 py-2 text-sm text-[var(--pos-danger)]">{error}</p> : null}

        <button
          type="button"
          onClick={() => void submit()}
          disabled={!ready || busy}
          className="mt-5 pos-tile w-full rounded-xl bg-[var(--pos-accent)] py-3 text-base font-semibold text-[var(--pos-accent-ink)] disabled:opacity-40"
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
      {name ? (
        <span className="rounded-full border border-[var(--pos-border)] bg-[var(--pos-surface-2)] px-3 py-1 text-[var(--pos-text-muted)]">
          {name}
        </span>
      ) : null}
      <span
        className={`rounded-full border px-3 py-1 font-semibold ${
          online
            ? "border-[var(--pos-accent-border)] bg-[var(--pos-accent-soft)] text-[var(--pos-accent)]"
            : "border-[var(--pos-danger-border)] bg-[var(--pos-danger-soft)] text-[var(--pos-danger)]"
        }`}
      >
        {online ? "Online" : "Offline"}
      </span>
      <span className="rounded-full border border-[var(--pos-border)] bg-[var(--pos-surface-2)] px-3 py-1 text-[var(--pos-text-muted)]">
        {pendingCount} queued
      </span>
    </div>
  );
}
