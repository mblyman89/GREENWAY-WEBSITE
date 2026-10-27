import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

// PERF-S2: required once the app has multiple root layouts ((site) + admin)
// and no top-level app/layout.tsx. Unmatched URLs render this full document.
export const metadata: Metadata = {
  title: "Page not found | Greenway Marijuana",
  robots: { index: false, follow: true },
};

export default function GlobalNotFound() {
  return (
    <html lang="en">
      <body className="antialiased">
        <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-4 p-8 text-center">
          <h1 className="text-3xl font-bold">Page not found</h1>
          <p>Sorry, we couldn&apos;t find that page.</p>
          <Link href="/menu" className="underline">
            Browse the menu
          </Link>
          <Link href="/" className="underline">
            Go to the home page
          </Link>
        </main>
      </body>
    </html>
  );
}
