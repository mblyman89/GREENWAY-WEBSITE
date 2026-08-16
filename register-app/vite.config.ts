/**
 * register-app/vite.config.ts — the packaged register's build.
 *
 * WHAT THIS IS
 * Greenway's register exists as ONE React component, src/app/pos/RegisterShell.tsx.
 * Next.js serves it at /pos for the browser PWA. This Vite build wraps that
 * SAME file — not a copy — into a plain static bundle (HTML + JS + CSS) that
 * Capacitor drops inside the iPad app "Greenway Point of Transaction".
 *
 * WHY A SECOND BUILD AND NOT A COPY
 * A copy would drift. The day someone fixes a sales-limit rounding bug in the
 * browser register and forgets the copy, the iPads keep selling with the old
 * rule — and a mis-computed limit is a compliance failure, not a cosmetic one.
 * There is exactly one register in this repo and both builds compile it.
 *
 * WHY THIS IS SAFE TO DO
 * Verified, not assumed: the register's full transitive import graph is 60
 * files, every one of them a pure module under src/lib/**, and the only
 * external package in the whole graph is `react`. There is no next/* import,
 * no "server-only", and no node builtin anywhere in it. That is precisely why
 * the earlier slices moved API-base handling and the --pos-* tokens into
 * shared, framework-free files.
 *
 * THE ONE THING THIS BUILD MUST GET RIGHT
 * Inside the app the page is served from capacitor://localhost, where a
 * relative "/api/pos/sync" resolves to a file in the bundle that does not
 * exist. So the server address is baked in at build time via REGISTER_API_BASE
 * and validated at boot by src/lib/pos/register-host-core.ts, which REFUSES to
 * start a packaged register that has no usable address rather than letting it
 * fail on a customer.
 */
import { cpSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Copy the register's images from the ONE place they live.
 *
 * The register needs four images: the Greenway wordmark it shows on every
 * screen, and the app icons. They already exist at public/pos/ for the browser
 * PWA. Committing a second copy inside register-app/ would be exactly the
 * drift trap this whole build exists to avoid — the day the wordmark is
 * updated the website would change and the iPads would quietly keep the old
 * one, and nobody would notice until a customer saw a stale logo on a receipt
 * screen.
 *
 * So they are copied at build time instead. Vite's own `publicDir` cannot do
 * this: it flattens its contents into the root of dist/, but RegisterShell
 * asks for "/pos/wordmark.png", so the files have to land in dist/pos/ with
 * that folder name intact.
 */
function copyRegisterAssets(): Plugin {
  return {
    name: "greenway-copy-register-assets",
    apply: "build",
    // "writeBundle" runs after Vite has emitted dist/, so nothing we copy can
    // be wiped by emptyOutDir.
    writeBundle() {
      const dest = here("./dist/pos");
      mkdirSync(dest, { recursive: true });
      cpSync(here("../public/pos"), dest, { recursive: true });
    },
  };
}

export default defineConfig(({ mode }) => ({
  root: here("."),

  // Capacitor serves the bundle from the app's own root and the app is never
  // hosted under a sub-path, so relative asset URLs are the correct choice —
  // they also make the built files openable straight off disk for testing.
  base: "./",

  plugins: [react(), tailwindcss(), copyRegisterAssets()],

  resolve: {
    alias: {
      // The same "@/..." specifier the Next build resolves, pointed at the
      // SAME src/ tree. This is the whole trick: one copy of the register.
      "@": here("../src"),
      // Safety net. Nothing in the register's verified graph imports
      // "server-only", and a guard test fails the build if that ever changes,
      // but this turns a cryptic bundling error into an obvious stub.
      "server-only": here("./src/server-only-stub.ts"),
    },
  },

  // The register reads its server address and build id from these compile-time
  // constants rather than import.meta.env, so the exact same source compiles
  // under Vite, under Next, and in vitest with no bundler-specific globals.
  define: {
    __REGISTER_API_BASE__: JSON.stringify(process.env.REGISTER_API_BASE ?? ""),
    __REGISTER_BUILD_VERSION__: JSON.stringify(
      process.env.REGISTER_BUILD_VERSION ??
        process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ??
        "dev",
    ),
  },

  // This app has no public/ folder of its own — see copyRegisterAssets() above
  // for why the images are copied from the website's public/pos instead.
  publicDir: false,

  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Counter iPads are modern; this keeps the bundle small and avoids
    // transpiling code the Next build already ships as ES2017.
    target: "es2020",
    // No source maps in a released app; keep them for local debugging.
    sourcemap: mode !== "production",
    // The register is a single screen — one chunk boots fastest offline.
    chunkSizeWarningLimit: 1500,
  },

  server: {
    port: 5173,
    strictPort: true,
    // The register source deliberately lives one level up in ../src, which is
    // outside Vite's default serving allow-list during dev.
    fs: { allow: [here("..")] },
  },
}));
