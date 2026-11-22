"use client";

/**
 * D263 S7 — page tabs (front/back, multi-page flyers). The page being edited
 * lives in draft.design / draft.imageSrc; the others wait in draft.pages.
 */
import type { BannerDesign } from "@/lib/cms/banner-design-core";
import { MAX_PAGES, addPage, blankLike, movePage, removePage, type PrintPage } from "@/lib/printing/print-doc-core";

export type PagedDraft = { design: BannerDesign; imageSrc: string; pages?: PrintPage[]; cur?: number };

/** Every page with the live one filled in. */
export function allPages<T extends PagedDraft>(d: T): PrintPage[] {
  if (!d.pages?.length) return [{ label: "Front", design: d.design, imageSrc: d.imageSrc }];
  const cur = Math.min(d.cur ?? 0, d.pages.length - 1);
  return d.pages.map((p, i) => (i === cur ? { ...p, design: d.design, imageSrc: d.imageSrc } : p));
}

/** Replace all pages and open page `cur`. */
export function setPages<T extends PagedDraft>(d: T, pages: PrintPage[], cur: number): T {
  const c = Math.max(0, Math.min(pages.length - 1, cur));
  if (pages.length === 1) {
    const { pages: _p, cur: _c, ...rest } = d;
    void _p;
    void _c;
    return { ...(rest as T), design: pages[0].design, imageSrc: pages[0].imageSrc };
  }
  return { ...d, pages, cur: c, design: pages[c].design, imageSrc: pages[c].imageSrc };
}

const chip = "rounded border px-2 py-1 text-xs";

export function PrintPages<T extends PagedDraft>({ draft, onChange }: { draft: T; onChange: (d: T) => void }) {
  const pages = allPages(draft);
  const cur = Math.min(draft.cur ?? 0, pages.length - 1);
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="mr-1 text-xs text-white/60">Pages:</span>
      {pages.map((p, i) => (
        <button key={i} type="button" onClick={() => onChange(setPages(draft, pages, i))} className={`${chip} ${i === cur ? "border-[var(--admin-accent)] bg-[var(--admin-accent)] font-bold text-black" : "border-white/20 text-white/80"}`}>
          {p.label}
        </button>
      ))}
      {pages.length < MAX_PAGES ? (
        <>
          <button type="button" className={`${chip} border-white/20 text-white/80`} onClick={() => onChange(setPages(draft, addPage(pages, cur + 1, { label: "Page", design: blankLike(draft.design), imageSrc: "" }), cur + 1))}>
            + {pages.length === 1 ? "Back" : "Blank page"}
          </button>
          <button type="button" className={`${chip} border-white/20 text-white/80`} onClick={() => onChange(setPages(draft, addPage(pages, cur + 1, { ...pages[cur], label: "Page" }), cur + 1))}>
            ⧉ Duplicate
          </button>
        </>
      ) : null}
      {pages.length > 1 ? (
        <>
          <button type="button" aria-label="Move page left" disabled={cur === 0} className={`${chip} border-white/20 text-white/80 disabled:opacity-40`} onClick={() => onChange(setPages(draft, movePage(pages, cur, -1), cur - 1))}>
            ◀
          </button>
          <button type="button" aria-label="Move page right" disabled={cur === pages.length - 1} className={`${chip} border-white/20 text-white/80 disabled:opacity-40`} onClick={() => onChange(setPages(draft, movePage(pages, cur, 1), cur + 1))}>
            ▶
          </button>
          <button
            type="button"
            className={`${chip} border-red-400/40 text-red-300`}
            onClick={() => {
              if (window.confirm(`Delete ${pages[cur].label}?`)) onChange(setPages(draft, removePage(pages, cur), Math.max(0, cur - 1)));
            }}
          >
            Delete page
          </button>
        </>
      ) : null}
    </div>
  );
}
