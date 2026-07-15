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
import type { Metadata, Viewport } from "next";
import { RegisterShell } from "./RegisterShell";

export const metadata: Metadata = {
  title: "Register",
  robots: { index: false, follow: false },
  // POS B11 — installable Home-Screen app on the counter iPads. Safari reads
  // the manifest + apple-touch icon; `appleWebApp.capable` renders the
  // apple-mobile-web-app meta so the installed app runs standalone
  // (no browser chrome) with a dark status bar matching the register UI.
  manifest: "/pos/manifest.webmanifest",
  icons: {
    apple: "/pos/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    title: "Register",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  // B35 — matches the POS canvas token (--pos-canvas) so the standalone app's
  // status bar blends into the branded register backdrop.
  themeColor: "#060807",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export const dynamic = "force-dynamic";

export default function PosPage() {
  return <RegisterShell />;
}
