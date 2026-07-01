"use client";

// Client-side passkey manager for Settings → Security. Lets a signed-in staffer
// register a new Face ID / Touch ID passkey on the current device, and rename or
// remove existing ones. Registration runs the WebAuthn ceremony then refreshes
// the server component so the new passkey appears in the list.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supportsPasskeys, registerPasskey } from "@/lib/auth/webauthn-client";
import { renamePasskeyAction, deletePasskeyAction } from "@/app/admin/settings/security/actions";

export type PasskeyItem = {
  id: string;
  label: string | null;
  deviceType: string | null;
  backedUp: boolean;
  lastUsedAt: string | null;
  createdAt: string;
};

function fmt(iso: string | null): string {
  if (!iso) return "never";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function PasskeyManager({ passkeys }: { passkeys: PasskeyItem[] }) {
  const router = useRouter();
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Browser-only detection, deferred out of the effect body to avoid a
    // synchronous cascading render.
    const id = requestAnimationFrame(() => setSupported(supportsPasskeys()));
    return () => cancelAnimationFrame(id);
  }, []);

  async function addPasskey() {
    setError(null);
    setMsg(null);
    setBusy(true);
    try {
      await registerPasskey();
      setMsg("Passkey added. You can now sign in with Face ID / Touch ID on this device.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add a passkey.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {!supported && (
        <div className="rounded-lg border border-white/10 bg-black/40 p-4 text-sm text-white/60">
          This device or browser doesn&apos;t support biometric passkeys. Try Safari or Chrome on a
          device with Face ID, Touch ID, or Windows Hello.
        </div>
      )}

      {msg && (
        <div className="rounded-lg border border-[#7ed957]/30 bg-[#7ed957]/10 p-3 text-sm text-white/80">
          {msg}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-[#ff7f00]/40 bg-[#ff7f00]/10 p-3 text-sm text-[#ff7f00]">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={addPasskey}
        disabled={!supported || busy}
        className="flex items-center gap-2 rounded-full bg-[#7ed957] px-5 py-2.5 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-60"
      >
        <span aria-hidden>➕</span>
        {busy ? "Follow the prompt on your device…" : "Add Face ID / Touch ID on this device"}
      </button>

      {passkeys.length === 0 ? (
        <p className="text-sm text-white/45">
          No passkeys yet. Add one above to sign in with your face or fingerprint next time.
        </p>
      ) : (
        <ul className="space-y-2">
          {passkeys.map((pk) => (
            <li
              key={pk.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-[#0a0a0a] p-3"
            >
              <span className="text-xl" aria-hidden>
                🔑
              </span>
              <div className="min-w-[10rem] flex-1">
                <form action={renamePasskeyAction} className="flex items-center gap-2">
                  <input type="hidden" name="id" value={pk.id} />
                  <input
                    name="label"
                    defaultValue={pk.label ?? "Passkey"}
                    className="w-full max-w-xs rounded-lg border border-white/15 bg-black px-2 py-1 text-sm text-white outline-none focus:border-[#7ed957]"
                  />
                  <button
                    type="submit"
                    className="rounded-lg border border-white/15 px-2.5 py-1 text-xs font-semibold text-white/70 hover:bg-white/10"
                  >
                    Save
                  </button>
                </form>
                <p className="mt-1 text-[0.7rem] text-white/40">
                  {pk.backedUp ? "Synced" : "This device"} · added {fmt(pk.createdAt)} · last used{" "}
                  {fmt(pk.lastUsedAt)}
                </p>
              </div>
              <form action={deletePasskeyAction}>
                <input type="hidden" name="id" value={pk.id} />
                <button
                  type="submit"
                  className="rounded-lg border border-[#ff7f00]/40 px-3 py-1.5 text-xs font-bold text-[#ff7f00] hover:bg-[#ff7f00]/10"
                >
                  Remove
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
