import path from "node:path";
import type { NextConfig } from "next";
import { CATEGORY_ALIASES } from "./lib/catalog-core";

/**
 * greenwaymerch.com (Greenway Merchandising LLC, dba Greenway Glass & Goods).
 * Separate Vercel project - Root Directory = merch-site.
 */
const nextConfig: NextConfig = {
  // This app lives INSIDE the cannabis repo (Vercel Root Directory = merch-site).
  // The tracing root must be the REPO ROOT (one level up), not this folder:
  // Next 16 records relativeAppDir = relative(tracingRoot, appDir) and Vercel's
  // post-build step looks for <repo>/<relativeAppDir>/.next. With the root set
  // to this folder relativeAppDir was "" and every deploy failed AFTER a good
  // build with "ENOENT lstat /vercel/path0/.next/package.json"
  // (vercel/vercel#15937). Both values must match (Next warns otherwise).
  // The build uses webpack (`next build --webpack` in package.json): with the
  // root one level up, Turbopack also picks up the PARENT app's
  // src/middleware.ts and fails (verified locally); webpack only compiles this
  // app (verified: relativeAppDir "merch-site", no middleware, 20 pages).
  turbopack: { root: path.resolve(__dirname, "..") },
  outputFileTracingRoot: path.resolve(__dirname, ".."),
  async redirects() {
    return [
      // /hoodie -> /hoodies, /hat -> /hats, /t-shirts -> /tees ... (permanent)
      ...Object.entries(CATEGORY_ALIASES).map(([from, to]) => ({ source: `/${from}`, destination: `/${to}`, permanent: true })),
      // The cannabis site's old in-site merch routes, if anyone carries one over.
      { source: "/merch", destination: "/", permanent: true },
      { source: "/shop", destination: "/", permanent: true },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
      // Print PNGs are fetched by Printful; don't let search engines index them.
      { source: "/print/:file*", headers: [{ key: "X-Robots-Tag", value: "noindex" }] },
      // Owner-only order desk: never indexed, never cached.
      { source: "/admin/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }, { key: "Cache-Control", value: "no-store" }] },
    ];
  },
};

export default nextConfig;
