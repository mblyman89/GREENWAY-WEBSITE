"use client";

/**
 * PushRemindersPanel (Task W) — the "never miss the deadline" notification
 * switch for the Compliance Command Center.
 *
 * Lets each staff browser opt into Web Push deadline reminders:
 *   1. Fetches /api/admin/push for the VAPID public key (staff-gated).
 *   2. Registers /push-sw.js and subscribes via PushManager.
 *   3. POSTs the subscription so the daily cron can reach this browser.
 * Turning it off unsubscribes locally AND deletes the server row.
 *
 * Degrades honestly: unsupported browser, denied permission, or unconfigured
 * VAPID keys each show a plain-language explanation instead of a dead button.
 */
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/admin/ui";

type PushState =
  | "loading"
  | "unsupported"
  | "unconfigured"
  | "denied"
  | "off"
  | "on"
  | "busy";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export function PushRemindersPanel() {
  const [state, setState] = useState<PushState>("loading");
  const [publicKey, setPublicKey] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (typeof window === "undefined") return;
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        if (!cancelled) setState("unsupported");
        return;
      }
      try {
        const res = await fetch("/api/admin/push", { cache: "no-store" });
        if (!res.ok) throw new Error("Could not load push settings.");
        const data = (await res.json()) as { configured: boolean; publicKey: string };
        if (cancelled) return;
        if (!data.configured || !data.publicKey) {
          setState("unconfigured");
          return;
        }
        setPublicKey(data.publicKey);
        if (Notification.permission === "denied") {
          setState("denied");
          return;
        }
        const reg = await navigator.serviceWorker.getRegistration("/push-sw.js");
        const sub = reg ? await reg.pushManager.getSubscription() : null;
        if (!cancelled) setState(sub ? "on" : "off");
      } catch {
        if (!cancelled) setState("off");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useCallback(async () => {
    setState("busy");
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.register("/push-sw.js");
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as BufferSource,
      });
      const res = await fetch("/api/admin/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      if (!res.ok) throw new Error("The server could not save this browser's subscription.");
      setState("on");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not enable notifications.");
      setState("off");
    }
  }, [publicKey]);

  const disable = useCallback(async () => {
    setState("busy");
    setError(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/push-sw.js");
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        await fetch("/api/admin/push", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setState("off");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not turn notifications off.");
      setState("on");
    }
  }, []);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-white">Deadline push notifications</h2>
          <p className="mt-1 text-xs text-white/50">
            Get a notification on this device for every CCRS deadline stage — Thursday heads-up,
            Saturday wrap-up, Sunday due-day, and daily overdue alerts — plus the monthly LIQ-1295
            deadline. Email reminders go out in parallel to the staff list.
          </p>
        </div>

        {state === "loading" && <span className="text-xs text-white/40">Checking…</span>}
        {state === "busy" && <span className="text-xs text-white/40">Working…</span>}
        {state === "unsupported" && (
          <span className="text-xs text-amber-300/80">
            This browser doesn&apos;t support push notifications.
          </span>
        )}
        {state === "unconfigured" && (
          <span className="text-xs text-amber-300/80">
            Push isn&apos;t configured yet — an admin must set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY
            (generate with <code>npx web-push generate-vapid-keys</code>).
          </span>
        )}
        {state === "denied" && (
          <span className="text-xs text-amber-300/80">
            Notifications are blocked for this site — allow them in the browser&apos;s site settings,
            then reload.
          </span>
        )}
        {state === "off" && (
          <Button type="button" onClick={enable} variant="confirm">
            Enable on this device
          </Button>
        )}
        {state === "on" && (
          <div className="flex items-center gap-3">
            <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-300">
              ✓ Enabled on this device
            </span>
            <Button type="button" onClick={disable} variant="neutral" size="sm">
              Turn off
            </Button>
          </div>
        )}
      </div>
      {error ? <p className="mt-2 text-xs text-red-400">{error}</p> : null}
    </div>
  );
}
