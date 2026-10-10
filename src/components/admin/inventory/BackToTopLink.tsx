"use client";

/**
 * R38 S3 — "a return to the top of the list button at the bottom".
 *
 * A real anchor link first (works with JavaScript off: the browser jumps to
 * the anchor above the table). With JavaScript on, it ALSO scrolls the
 * table's own scroll box back to the first row — the table scrolls inside a
 * frame so its header and first column stay pinned, and a page-level jump
 * alone would leave that frame scrolled to the bottom.
 */
export function BackToTopLink({ targetId }: { targetId: string }) {
  return (
    <a
      href={`#${targetId}`}
      data-testid="inventory-back-to-top"
      className="admin-focus ml-2 inline-flex items-center gap-1 rounded border border-[var(--admin-accent)] px-2 py-1 font-semibold text-[var(--admin-accent)] hover:bg-white/10"
      onClick={(e) => {
        const target = document.getElementById(targetId);
        if (!target) return; // let the plain anchor do its job
        e.preventDefault();
        document.querySelectorAll<HTMLElement>("[data-table-scroll]").forEach((el) => el.scrollTo({ top: 0, left: 0, behavior: "smooth" }));
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        history.replaceState(null, "", `#${targetId}`);
      }}
    >
      {"\u2191"} Back to top
    </a>
  );
}

export default BackToTopLink;
