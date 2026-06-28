"use client";

/**
 * Route-level error boundary for the entire /admin section.
 *
 * Next.js renders this (instead of a blank crash screen) whenever a server or
 * client component under /admin throws during render. We show a calm, branded,
 * plain-language card with a "Try again" button (calls reset()) and a link back
 * to the dashboard — never a scary stack trace.
 */
import { useEffect } from "react";
import Link from "next/link";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log for debugging; the user only ever sees the friendly card.
    console.error("[admin] route error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-2xl border border-[#ffd700]/30 bg-[#ffd700]/[0.04] p-8 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-[#ffd700]/40 bg-[#ffd700]/10 text-2xl">
          ℹ️
        </div>
        <h1 className="mt-5 text-xl font-semibold text-white">
          This page hit a snag
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-white/70">
          Don&apos;t worry — nothing was lost and your live website is fine.
          This is usually a brief hiccup. Try loading the page again, and if it
          keeps happening, head back to the dashboard.
        </p>

        {error?.message && (
          <p className="mt-4 break-words rounded-lg bg-black/40 px-3 py-2 text-left font-mono text-xs text-white/50">
            {error.message}
            {error.digest ? ` (ref: ${error.digest})` : ""}
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-lg bg-[#7ed957] px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-[#94e570]"
          >
            Try again
          </button>
          <Link
            href="/admin"
            className="rounded-lg border border-white/15 px-5 py-2.5 text-sm font-medium text-white/80 transition hover:bg-white/5"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
