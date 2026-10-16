/**
 * src/components/admin/media/MediaFolderTree.tsx — R65 S3.
 *
 * The Media Library's left-hand smart-folder tree (server-rendered, no JS:
 * native <details> so folders open/close, and the path to the open folder is
 * expanded automatically). Each folder shows its live count.
 */
import Link from "next/link";
import type { FolderNode } from "@/lib/media/folders-core";

function Node({ node, active, hrefFor, depth }: { node: FolderNode; active: string; hrefFor: (id: string) => string; depth: number }) {
  const on = active === node.id;
  const onPath = active === node.id || active.startsWith(`${node.id}/`);
  const row = (
    <Link
      href={hrefFor(node.id)}
      title={node.hint}
      aria-current={on ? "page" : undefined}
      className={`flex min-w-0 flex-1 items-center gap-1.5 rounded px-1.5 py-1 text-[13px] ${
        on ? "bg-[var(--admin-accent-soft)] font-semibold text-[var(--admin-accent)]" : "text-[var(--admin-text)] hover:bg-white/5"
      }`}
    >
      <span aria-hidden>{node.icon}</span>
      <span className="truncate">{node.label}</span>
      <span className="ml-auto shrink-0 rounded bg-white/5 px-1.5 text-[11px] tabular-nums text-[var(--admin-text-muted)]">{node.count}</span>
    </Link>
  );
  if (node.children.length === 0) {
    return <li style={{ paddingLeft: depth ? 14 : 0 }} className="flex">{row}</li>;
  }
  return (
    <li style={{ paddingLeft: depth ? 14 : 0 }}>
      <details open={onPath || depth === 0 && node.id === "products"} className="group">
        <summary className="flex cursor-pointer list-none items-center gap-0.5 [&::-webkit-details-marker]:hidden">
          <span aria-hidden className="w-3 shrink-0 text-[10px] text-[var(--admin-text-faint)] transition group-open:rotate-90">▶</span>
          {row}
        </summary>
        <ul className="mt-0.5 space-y-0.5">
          {node.children.map((c) => (
            <Node key={c.id} node={c} active={active} hrefFor={hrefFor} depth={depth + 1} />
          ))}
        </ul>
      </details>
    </li>
  );
}

export function MediaFolderTree({ tree, total, active, hrefFor }: { tree: FolderNode[]; total: number; active: string; hrefFor: (id: string) => string }) {
  return (
    <nav aria-label="Media folders" className="space-y-0.5">
      <ul className="space-y-0.5">
        <li className="flex pl-3.5">
          <Link
            href={hrefFor("all")}
            aria-current={active === "all" ? "page" : undefined}
            className={`flex flex-1 items-center gap-1.5 rounded px-1.5 py-1 text-[13px] ${
              active === "all" ? "bg-[var(--admin-accent-soft)] font-semibold text-[var(--admin-accent)]" : "text-[var(--admin-text)] hover:bg-white/5"
            }`}
          >
            <span aria-hidden>🗂️</span>
            <span>Everything</span>
            <span className="ml-auto rounded bg-white/5 px-1.5 text-[11px] tabular-nums text-[var(--admin-text-muted)]">{total}</span>
          </Link>
        </li>
        {tree.map((n) => (
          <Node key={n.id} node={n} active={active} hrefFor={hrefFor} depth={0} />
        ))}
      </ul>
    </nav>
  );
}
