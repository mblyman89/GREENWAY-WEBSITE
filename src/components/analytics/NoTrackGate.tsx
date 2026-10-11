"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { isNoTrackPath } from "@/lib/analytics/no-track-paths";

/**
 * Renders its children (the analytics scripts) everywhere except the
 * private no-track pages (R39 S7: the vendor signing link, whose URL holds
 * a secret token). See src/lib/analytics/no-track-paths.ts.
 */
export function NoTrackGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (isNoTrackPath(pathname)) return null;
  return <>{children}</>;
}
