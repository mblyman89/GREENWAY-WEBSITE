import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
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
