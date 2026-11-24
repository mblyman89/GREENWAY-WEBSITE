"use client";

/**
 * src/components/site/IntentLink.tsx — USAGE-7a.
 *
 * A drop-in for `next/link` on the public site: it does NOT prefetch when it
 * scrolls into view, only when the shopper shows intent (hover, keyboard
 * focus, touch). The pattern is Next.js's documented "Hover-triggered
 * prefetch" (node_modules/next/dist/docs/01-app/02-guides/prefetching.md);
 * the decision lives in `src/lib/site/intent-prefetch-core.ts`.
 *
 * Public files import it under the same name — `import Link from
 * "@/components/site/IntentLink"` — so every `<Link …>` stays exactly as it
 * was. An explicit `prefetch` prop from a caller still wins.
 */
import NextLink from "next/link";
import { useState, type ComponentProps } from "react";
import { intentPrefetch } from "@/lib/site/intent-prefetch-core";

type IntentLinkProps = ComponentProps<typeof NextLink>;

export default function IntentLink({ prefetch, onMouseEnter, onFocus, onTouchStart, ...rest }: IntentLinkProps) {
  const [active, setActive] = useState(false);
  return (
    <NextLink
      {...rest}
      prefetch={prefetch !== undefined ? prefetch : intentPrefetch(active)}
      onMouseEnter={(e) => {
        if (!active) setActive(true);
        onMouseEnter?.(e);
      }}
      onFocus={(e) => {
        if (!active) setActive(true);
        onFocus?.(e);
      }}
      onTouchStart={(e) => {
        if (!active) setActive(true);
        onTouchStart?.(e);
      }}
    />
  );
}
