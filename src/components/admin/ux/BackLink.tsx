import Link from "next/link";
import { backHref } from "@/lib/admin/back-link-core";

/**
 * BackLink (GW-029) — a "Back to ..." link that restores the list page
 * exactly as the user left it (filters, search, sort, page) via the `back`
 * search param carried by `withBackParam` on the list's row links. Falls
 * back to the bare route when no state was carried. Server component — no
 * hooks, no client JS.
 *
 * Usage (detail page):
 *   const sp = await searchParams;
 *   <BackLink fallback="/admin/orders" back={sp.back} className="...">
 *     Back to orders
 *   </BackLink>
 */
export function BackLink({
  fallback,
  back,
  children,
  className,
}: {
  /** The bare list route, e.g. "/admin/orders". */
  fallback: string;
  /** The raw `back` searchParam value from the detail page. */
  back?: string | string[];
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link href={backHref(fallback, back)} className={className}>
      {children}
    </Link>
  );
}
