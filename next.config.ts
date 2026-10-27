import type { NextConfig } from "next";
import { buildSiteRedirects } from "./src/lib/site/site-domain-core";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  // R40 domain go-live: bare greenwaymarijuana.com -> www (308, path and query
  // kept) plus the old WordPress pages (/about-us/, /contact-us/, /partners/,
  // /insta/, /facebook/ ...). See src/lib/site/site-domain-core.ts and
  // docs/DOMAIN_GO_LIVE.md. IMPORTANT: in Vercel make WWW the primary domain;
  // never set "www redirects to the bare domain" or the two rules would loop.
  async redirects() {
    return buildSiteRedirects();
  },
  // R56-S2: owner-uploaded fonts are served SAME-ORIGIN. Browsers only load a
  // cross-origin font when the response carries CORS headers (CSS Fonts 4,
  // "font fetching requirements"); proxying /gw-fonts/* to the public media
  // bucket removes that dependency entirely. Keys are never reused, so the
  // storage cache (1 year) stays correct.
  async rewrites() {
    const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
    if (!/^https?:\/\//.test(base)) return [];
    return [{ source: "/gw-fonts/:file", destination: `${base}/storage/v1/object/public/media/fonts/:file` }];
  },
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
    // R45-S2: serve AVIF to browsers that accept it, WebP to the rest, and
    // the original format to anything else. The Next 16 docs (next/image >
    // formats) say order matters: first match in the Accept header wins.
    // AVIF is about 20% smaller than WebP but encodes about 50% slower on the
    // first request; after that the cached copy is served. Each format is
    // cached separately, so expect somewhat more Vercel image cache writes.
    // Animated sources (GIFs) keep their original format, and our GIFs are
    // already unoptimized (R43).
    formats: ["image/avif", "image/webp"],
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
    // PERF-S2: the app now has two root layouts ((site) and admin) and no
    // top-level layout, so unmatched URLs need app/global-not-found.tsx.
    globalNotFound: true,
    // PERF-S4: reuse a visited dynamic page from the client Router Cache for
    // 30 s (default 0) so back/forward and tab-hopping in the back office do
    // not re-run every server query. Server Actions still refresh what they
    // change (revalidatePath / router.refresh), so saves stay accurate.
    staleTimes: { dynamic: 30, static: 180 },
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
