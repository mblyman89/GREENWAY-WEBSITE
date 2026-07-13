/**
 * /pos — the register shell (POS Slice B5).
 *
 * A deliberately standalone, full-screen surface for the counter iPads. It is
 * NOT behind the admin middleware: the iPad authenticates as a provisioned
 * DEVICE (key from /admin/registers/devices, scrypt-hashed server-side) and
 * humans identify per-action by clock PIN on the lock screen. All state that
 * matters lives server-side after sync; the device holds only its offline
 * queue (append-only, idempotent client UUIDs — see register-client-core).
 */
import type { Metadata } from "next";
import { RegisterShell } from "./RegisterShell";

export const metadata: Metadata = {
  title: "Register",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function PosPage() {
  return <RegisterShell />;
}
