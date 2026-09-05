import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  typescript: {
    // WHY THE BUILD USES A DIFFERENT TSCONFIG (this is the Vercel fix)
    //
    // NOT ignoreBuildErrors. Type errors in application code still fail the
    // build exactly as before. This only changes WHICH FILES are loaded.
    //
    // The root tsconfig.json includes "**/*.ts", which pulls all 563 files in
    // tests/ into the program. next build then hands that whole file list to
    // typescript.createProgram() and only afterwards throws the test
    // diagnostics away, via an ignoreRegex in
    // next/dist/lib/typescript/runTypeCheck.js covering *.test.ts, __tests__
    // and __mocks__. So the build paid full type-checking memory for ~9,000
    // lines of compliance assertions whose results it had already decided to
    // discard. Pure waste, and it grew with every slice.
    //
    // That waste is what broke Vercel. Node's default heap is roughly half of
    // system RAM, so on Vercel's documented 8192 MB build container it lands
    // near 4 GB, while our CI build job explicitly sets
    // --max-old-space-size=6144. CI was therefore testing with ~50% more heap
    // than the machine that actually deploys, which is why the build job kept
    // passing on commits Vercel could not build. Reproduced locally: with the
    // heap capped, `next build` prints "Compiled successfully" and then dies
    // in the "Running TypeScript" phase with "Ineffective mark-compacts near
    // heap limit" - compile fine, type-check OOM. Same signature Vercel shows.
    //
    // Coverage is NOT reduced. tests/ is still fully type-checked by
    // `npm run typecheck` (tsc --noEmit on the root config) in the compliance
    // CI job, which is the gate added alongside this and is pinned by
    // tests/compliance/ci-runs-the-typechecker.test.ts. Checking those files
    // once, in the job built for it, instead of twice - once uselessly, inside
    // the memory-constrained build.
    tsconfigPath: "tsconfig.build.json",
  },
  // @simplewebauthn/server depends on cbor-x, whose native require() path breaks
  // under Vercel's bundler. Disabling native acceleration avoids the
  // "extractStrings is not a function" verify error (per SimpleWebAuthn docs).
  env: {
    CBOR_NATIVE_ACCELERATION_DISABLED: "true",
  },
  // The LIQ-1295 excise-return route reads the official .xlsx template at
  // runtime via fs. Next's tracer doesn't follow that dynamic read, so include
  // the template explicitly in the route's serverless bundle.
  outputFileTracingIncludes: {
    "/admin/reports/compliance/excise-export/route": [
      "./src/lib/compliance/templates/LIQ-1295-template.xlsx",
    ],
  },
  images: {
    // Banner/hero images chosen in the Site Content editor can come from the
    // Supabase Storage public bucket (media library). Allow next/image to
    // optimize those remote URLs. Site-relative paths under /public still work
    // as before. The pattern matches any Supabase project storage object.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
  experimental: {
    serverActions: {
      // POS exports (PRODUCTS.xlsx + INVENTORIES.xlsx) are uploaded together via
      // a Server Action. Next.js caps Server Action request bodies at 1 MB by
      // default, and two real POS spreadsheets routinely exceed that (~1.2 MB+),
      // which the framework rejects *before* our action runs — bypassing every
      // try/catch guard and surfacing as the generic error screen. Each file is
      // independently capped at 25 MB in the action, so 50 MB covers two large
      // exports with headroom while staying safely bounded.
      bodySizeLimit: "50mb",
    },
  },
};

export default nextConfig;
