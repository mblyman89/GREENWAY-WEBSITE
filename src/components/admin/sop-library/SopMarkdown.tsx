/**
 * SopMarkdown — renders a parsed SOP (markdown-core Block tree) with the
 * back-office design tokens. Server component: no hooks, no HTML injection.
 * Print styles produce clean black-on-white pages.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import type { Align, Block, Inline } from "@/lib/sop-library/markdown-core";
import { plainText } from "@/lib/sop-library/markdown-core";
import { resolveSopLink } from "@/lib/sop-library/catalog-core";

function renderInline(nodes: Inline[], key = "i"): ReactNode[] {
  return nodes.map((n, i) => {
    const k = `${key}-${i}`;
    switch (n.t) {
      case "text":
        return n.v;
      case "code":
        return (
          <code
            key={k}
            className="rounded bg-white/[0.07] px-1.5 py-0.5 font-mono text-[0.85em] text-[var(--admin-gold)] print:bg-black/5 print:text-black"
          >
            {n.v}
          </code>
        );
      case "strong":
        return (
          <strong key={k} className="font-semibold text-[var(--admin-text)] print:text-black">
            {renderInline(n.c, k)}
          </strong>
        );
      case "em":
        return (
          <em key={k} className="italic">
            {renderInline(n.c, k)}
          </em>
        );
      case "link": {
        const r = resolveSopLink(n.href);
        const cls = "text-[var(--admin-accent)] underline decoration-[var(--admin-accent)]/30 underline-offset-2 hover:decoration-[var(--admin-accent)] print:text-black";
        if (!r) return <span key={k}>{renderInline(n.c, k)}</span>;
        if (r.kind === "external")
          return (
            <a key={k} href={r.href} target="_blank" rel="noopener noreferrer" className={cls}>
              {renderInline(n.c, k)}
            </a>
          );
        if (r.kind === "anchor")
          return (
            <a key={k} href={r.href} className={cls}>
              {renderInline(n.c, k)}
            </a>
          );
        return (
          <Link key={k} href={r.href} className={cls}>
            {renderInline(n.c, k)}
          </Link>
        );
      }
    }
  });
}

const alignClass = (a: Align | undefined) =>
  a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left";

/** Callout tone from the first bold words of a blockquote. */
function calloutTone(b: Extract<Block, { t: "quote" }>): { ring: string; bar: string; label: string | null } {
  const first = b.c[0];
  const lead = first && first.t === "paragraph" ? plainText(first.c).slice(0, 80).toLowerCase() : "";
  if (/(stop|never|warning|danger|do not|s1\b|critical|important|one thing to know)/.test(lead))
    return { ring: "border-[var(--admin-orange)]/35 bg-[var(--admin-orange-soft)]", bar: "bg-[var(--admin-orange)]", label: null };
  if (/(living|owner|what the owner asked|why this sop)/.test(lead))
    return { ring: "border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)]", bar: "bg-[var(--admin-gold)]", label: null };
  return { ring: "border-[var(--admin-accent)]/25 bg-[var(--admin-accent-soft)]", bar: "bg-[var(--admin-accent)]", label: null };
}

const HEADING_CLS: Record<number, string> = {
  1: "text-2xl font-bold sm:text-3xl",
  2: "mt-12 border-b border-[var(--admin-border)] pb-2 text-xl font-bold sm:text-2xl print:mt-8 print:border-black/20",
  3: "mt-9 text-lg font-semibold print:mt-6",
  4: "mt-7 text-base font-semibold",
  5: "mt-6 text-sm font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]",
  6: "mt-6 text-sm font-semibold text-[var(--admin-text-muted)]",
};

function renderBlocks(blocks: Block[], key: string, tight = false): ReactNode[] {
  return blocks.map((b, i) => {
    const k = `${key}-${i}`;
    switch (b.t) {
      case "heading": {
        const Tag = `h${Math.min(b.level, 6)}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
        return (
          <Tag
            key={k}
            id={b.id}
            className={`group scroll-mt-28 text-[var(--admin-text)] print:break-after-avoid print:text-black ${HEADING_CLS[b.level]}`}
          >
            {renderInline(b.c, k)}
            {b.level >= 2 && b.level <= 4 ? (
              <a
                href={`#${b.id}`}
                aria-label={`Link to ${b.text}`}
                className="ml-2 align-middle text-[0.7em] text-[var(--admin-text-faint)] opacity-0 transition group-hover:opacity-100 focus:opacity-100 print:hidden"
              >
                #
              </a>
            ) : null}
          </Tag>
        );
      }
      case "paragraph":
        return (
          <p key={k} className={`${tight ? "" : "mt-4"} leading-relaxed text-[var(--admin-text-muted)] print:text-black/85`}>
            {renderInline(b.c, k)}
          </p>
        );
      case "list": {
        const cls = `mt-3 space-y-1.5 pl-6 leading-relaxed text-[var(--admin-text-muted)] marker:text-[var(--admin-text-faint)] print:text-black/85 ${
          b.ordered ? "list-decimal marker:font-semibold" : "list-disc"
        }`;
        const items = b.items.map((it, j) => (
          <li key={`${k}-${j}`} className="pl-1 [&>p:first-child]:mt-0">
            {renderBlocks(it, `${k}-${j}`, it.length === 1)}
          </li>
        ));
        return b.ordered ? (
          <ol key={k} start={b.start} className={cls}>
            {items}
          </ol>
        ) : (
          <ul key={k} className={cls}>
            {items}
          </ul>
        );
      }
      case "table":
        return (
          <div
            key={k}
            className="mt-5 overflow-x-auto rounded-[var(--admin-radius)] border border-[var(--admin-border)] print:overflow-visible print:rounded-none print:border-black/30"
          >
            <table className="w-full border-collapse text-sm">
              {b.head.some((c) => c.length) ? (
                <thead className="bg-white/[0.04] print:bg-black/5">
                  <tr>
                    {b.head.map((c, j) => (
                      <th
                        key={j}
                        scope="col"
                        className={`border-b border-[var(--admin-border-strong)] px-3 py-2.5 align-bottom text-xs font-bold uppercase tracking-wide text-[var(--admin-text)] print:border-black/30 print:text-black ${alignClass(b.align[j])}`}
                      >
                        {renderInline(c, `${k}-h${j}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
              ) : null}
              <tbody>
                {b.rows.map((r, ri) => (
                  <tr key={ri} className="border-b border-[var(--admin-border)] last:border-0 even:bg-white/[0.015] hover:bg-white/[0.03] print:border-black/15">
                    {r.map((c, j) => (
                      <td
                        key={j}
                        className={`px-3 py-2.5 align-top leading-relaxed text-[var(--admin-text-muted)] print:text-black/85 ${alignClass(b.align[j])}`}
                      >
                        {renderInline(c, `${k}-${ri}-${j}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case "quote": {
        const tone = calloutTone(b);
        return (
          <aside
            key={k}
            className={`relative mt-5 overflow-hidden rounded-[var(--admin-radius)] border py-3.5 pl-5 pr-4 print:border-black/30 print:bg-transparent ${tone.ring}`}
          >
            <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${tone.bar} print:bg-black/40`} />
            <div className="[&>*:first-child]:mt-0">{renderBlocks(b.c, k)}</div>
          </aside>
        );
      }
      case "code":
        return (
          <pre
            key={k}
            className="mt-5 overflow-x-auto rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-black/40 p-4 font-mono text-[0.78rem] leading-snug text-[var(--admin-text)] print:whitespace-pre-wrap print:border-black/30 print:bg-white print:text-black"
          >
            {b.v}
          </pre>
        );
      case "hr":
        return <hr key={k} className="my-10 border-[var(--admin-border)] print:border-black/20" />;
    }
  });
}

export function SopMarkdown({ blocks, skipTitle = true }: { blocks: Block[]; skipTitle?: boolean }) {
  // The reader shows its own title header; skip the document's H1, and the
  // metadata table directly under it (shown as the reader's info card).
  let body = blocks;
  if (skipTitle) {
    const h1 = body.findIndex((b) => b.t === "heading" && b.level === 1);
    if (h1 !== -1) {
      body = body.slice(h1 + 1);
      if (body[0]?.t === "table") body = body.slice(1);
    }
  }
  return <div className="sop-prose text-[0.95rem]">{renderBlocks(body, "b")}</div>;
}
