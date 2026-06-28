import { redirect } from "next/navigation";

/**
 * The Home Carousel manager moved into the unified per-page builder at
 * /admin/pages/home (Carousel tab). Keep this route as a permanent redirect so
 * old links/bookmarks still work.
 */
export const dynamic = "force-dynamic";

export default function CarouselManagerRedirect() {
  redirect("/admin/pages/home?tab=carousel");
}
