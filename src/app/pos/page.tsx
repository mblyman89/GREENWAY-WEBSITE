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
import { resolveBuildVersion } from "@/lib/pos/sw-core";
import { RegisterShell } from "./RegisterShell";

export const metadata: Metadata = {
  title: "Register",
  robots: { index: false, follow: false },
  // POS B11 — installable Home-Screen app on the counter iPads. Safari reads
  // the manifest + apple-touch icon; `appleWebApp.capable` renders the
  // apple-mobile-web-app meta so the installed app runs standalone
  // (no browser chrome). AO-5: light is the register default (theme-core
  // DEFAULT_THEME), so the status bar uses "default" (dark text on light) —
  // the old "black-translucent" floated white clock digits over the light
  // canvas, unreadable.
  manifest: "/pos/manifest.webmanifest",
  icons: {
    apple: "/pos/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    title: "Register",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  // B35/AO-5 — matches the LIGHT --pos-canvas token (the register's default
  // theme since Task AO) so the standalone app's status bar blends into the
  // register backdrop. Devices toggled to dark simply show a light bar.
  themeColor: "#f4f6f9",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export const dynamic = "force-dynamic";

export default function PosPage() {
  // AN-0 — the deploy's short commit SHA ("dev" locally), shown in the status
  // footer so a stale installed app is visible at a glance. Same resolver the
  // service-worker route uses, so footer version and worker version agree.
  return <RegisterShell buildVersion={resolveBuildVersion(process.env)} />;
}
