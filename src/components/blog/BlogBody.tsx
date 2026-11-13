/**
 * D239 N-7 (G-117, F-22-15): renders a post body as blocks. Old posts are
 * plain paragraphs and render exactly as before. No hooks, so the admin
 * editor's live preview uses the same renderer as the public page.
 */
import { parseBlogBody, type BlogBlock } from "@/lib/blog/blog-blocks-core";

function isExternal(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

function linkProps(href: string) {
  return isExternal(href) ? { href, target: "_blank", rel: "noopener noreferrer nofollow" } : { href };
}

function hostOf(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return href;
  }
}

function Block({ b, compact }: { b: BlogBlock; compact: boolean }) {
  switch (b.type) {
    case "paragraph":
      return <p>{b.text}</p>;
    case "heading":
      return <h2 className={`font-black leading-tight tracking-tight text-white ${compact ? "pt-1 text-lg" : "pt-2 text-2xl md:text-3xl"}`}>{b.text}</h2>;
    case "image":
      return (
        <figure className="overflow-hidden rounded-2xl border border-white/10 bg-zinc-900">
          {/* eslint-disable-next-line @next/next/no-img-element -- library images come from storage or /public; sizes vary */}
          <img src={b.src} alt={b.alt} loading="lazy" decoding="async" className="h-auto w-full" />
          {b.caption ? <figcaption className="px-4 py-2 text-sm text-zinc-400">{b.caption}</figcaption> : null}
        </figure>
      );
    case "product": {
      const inner = (
        <>
          {b.image ? (
            // eslint-disable-next-line @next/next/no-img-element -- product photo from the library
            <img src={b.image} alt={b.name} loading="lazy" decoding="async" className="h-24 w-24 shrink-0 rounded-xl object-cover" />
          ) : null}
          <span className="min-w-0">
            <span className="block text-[0.65rem] font-black uppercase tracking-[0.16em] text-[var(--greenway,#7ed957)]">Product</span>
            <span className="block text-lg font-black leading-tight text-white">{b.name}</span>
            {b.note ? <span className="mt-1 block text-sm leading-6 text-zinc-300">{b.note}</span> : null}
          </span>
        </>
      );
      const cls = "flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4";
      return b.href ? (
        <a {...linkProps(b.href)} className={`${cls} transition hover:border-[var(--greenway,#7ed957)]`} data-block="product">
          {inner}
        </a>
      ) : (
        <div className={cls} data-block="product">
          {inner}
        </div>
      );
    }
    case "quote":
      return (
        <blockquote className="rounded-2xl border-l-4 border-[var(--orange,#ff7f00)] bg-white/[0.04] px-5 py-4" data-block="quote">
          <p className="italic text-white">“{b.text}”</p>
          {b.name || b.href ? (
            <footer className="mt-2 text-sm font-bold text-zinc-400">
              {b.name ? `— ${b.name}` : null}
              {b.href ? (
                <>
                  {b.name ? " · " : null}
                  <a {...linkProps(b.href)} className="underline hover:text-[var(--orange,#ff7f00)]">
                    {/google|g\.page|goo\.gl/i.test(b.href) ? "Read on Google" : "Source"}
                  </a>
                </>
              ) : null}
            </footer>
          ) : null}
        </blockquote>
      );
    case "button":
      return (
        <p>
          <a
            {...linkProps(b.href)}
            data-block="button"
            className="inline-flex items-center rounded-full bg-[var(--orange,#ff7f00)] px-6 py-3 text-sm font-black uppercase tracking-[0.12em] text-black transition hover:brightness-110"
          >
            {b.label}
          </a>
        </p>
      );
    case "sources":
      return (
        <div className="rounded-2xl border border-white/10 px-4 py-3 text-sm" data-block="sources">
          <p className="text-[0.65rem] font-black uppercase tracking-[0.16em] text-zinc-400">{b.links.length === 1 ? "Source" : "Sources"}</p>
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-zinc-300">
            {b.links.map((l) => (
              <li key={l}>
                <a {...linkProps(l)} className="break-all underline hover:text-[var(--orange,#ff7f00)]">
                  {hostOf(l)}
                </a>
              </li>
            ))}
          </ol>
        </div>
      );
  }
}

export function BlogBody({ paragraphs, compact = false }: { paragraphs: readonly string[]; compact?: boolean }) {
  const blocks = parseBlogBody(paragraphs);
  return (
    <>
      {blocks.map((b, i) => (
        <Block key={i} b={b} compact={compact} />
      ))}
    </>
  );
}
