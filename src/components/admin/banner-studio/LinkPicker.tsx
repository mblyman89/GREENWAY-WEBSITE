"use client";

/**
 * R41 S2 — "Pick a link…" dialog (bible PART 5.8, Q25/Q26).
 *
 * Builds button links without typing URLs: a menu link filtered by category /
 * strain / special / sort / price / search, a category page, a specific blog
 * post or newsletter, a website page, a phone number / email, an outside
 * website, or a section on the same page. Every result is checked with
 * `checkHref` (a "block" result disables "Use this link") and described in
 * plain English with `describeHref`.
 *
 * Rendered in a portal on <body> so the inputs are NOT inside the section's
 * <form> (pressing Enter here must never submit the banner).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  MENU_CATEGORIES,
  MENU_SORTS,
  MENU_SPECIALS,
  MENU_STRAINS,
  PUBLIC_PAGES,
  buildBlogHref,
  buildCategoryHref,
  buildMenuHref,
  checkHref,
  describeHref,
  emptyMenuFilters,
  linkKindOf,
  parseMenuHref,
  type MenuFilters,
} from "@/lib/cms/link-target-core";
import { studioInput, studioLabel } from "./controls";

export type PickerPost = { slug: string; title: string; newsletter: boolean };

type Tab = "menu" | "category" | "blog" | "page" | "contact" | "external" | "anchor";

const TABS: { id: Tab; label: string }[] = [
  { id: "menu", label: "🛒 Menu (filtered)" },
  { id: "category", label: "🗂 Category page" },
  { id: "blog", label: "📰 Blog / newsletter" },
  { id: "page", label: "📄 Website page" },
  { id: "contact", label: "📞 Phone / email" },
  { id: "external", label: "🌐 Outside website" },
  { id: "anchor", label: "⚓ Section on this page" },
];

function tabFor(href: string): Tab {
  switch (linkKindOf(href)) {
    case "menu":
    case "special":
      return "menu";
    case "category":
      return "category";
    case "blog":
      return "blog";
    case "contact":
      return "contact";
    case "external":
      return "external";
    case "anchor":
      return "anchor";
    default:
      return "page";
  }
}

function toggle(list: string[], v: string): string[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={
        active
          ? "rounded-full bg-[var(--admin-accent)] px-2.5 py-1 text-xs font-semibold text-black"
          : "rounded-full bg-white/10 px-2.5 py-1 text-xs text-white/75 hover:bg-white/20"
      }
    >
      {children}
    </button>
  );
}

export function LinkPicker({
  value,
  posts,
  onPick,
  onClose,
}: {
  value: string;
  posts: PickerPost[];
  onPick: (href: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>(() => tabFor(value));
  const initialMenu = parseMenuHref(value)?.filters ?? emptyMenuFilters();
  const [menu, setMenu] = useState<MenuFilters>(initialMenu);
  const [category, setCategory] = useState(() => (linkKindOf(value) === "category" ? decodeURIComponent(value.replace(/^\/menu\//, "").replace(/\/$/, "")) : MENU_CATEGORIES[0]?.value ?? ""));
  const [blogSlug, setBlogSlug] = useState(() => (linkKindOf(value) === "blog" ? value.replace(/^\/blog\//, "").split(/[?#/]/)[0] : ""));
  const [blogQuery, setBlogQuery] = useState("");
  const [page, setPage] = useState(() => (linkKindOf(value) === "page" ? value : "/"));
  const [contactKind, setContactKind] = useState<"tel" | "mailto">(() => (/^mailto:/i.test(value) ? "mailto" : "tel"));
  const [contact, setContact] = useState(() => (linkKindOf(value) === "contact" ? value.replace(/^(tel|mailto):/i, "") : ""));
  const [external, setExternal] = useState(() => (linkKindOf(value) === "external" ? value : "https://"));
  const [anchor, setAnchor] = useState(() => (linkKindOf(value) === "anchor" ? value.slice(1) : ""));
  const dialogRef = useRef<HTMLDivElement>(null);

  // Escape closes; focus the dialog on open (keyboard users).
  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const blogTitles = useMemo(() => Object.fromEntries(posts.map((p) => [p.slug, p.title])), [posts]);

  const href = useMemo(() => {
    switch (tab) {
      case "menu":
        return buildMenuHref(menu);
      case "category":
        return category ? buildCategoryHref(category) : "";
      case "blog":
        return blogSlug ? buildBlogHref(blogSlug) : "";
      case "page":
        return page;
      case "contact": {
        const raw = contact.trim();
        if (!raw) return "";
        return contactKind === "tel" ? `tel:${raw.replace(/[^0-9+().-]/g, "")}` : `mailto:${raw}`;
      }
      case "external":
        return external.trim();
      case "anchor":
        return anchor.trim() ? `#${anchor.trim().replace(/^#/, "").replace(/\s+/g, "-")}` : "";
    }
  }, [tab, menu, category, blogSlug, page, contact, contactKind, external, anchor]);

  const check = checkHref(href);
  const description = href ? describeHref(href, { blogTitles }) : "Choose where the button goes.";

  const filteredPosts = posts.filter((p) => !blogQuery.trim() || `${p.title} ${p.slug}`.toLowerCase().includes(blogQuery.trim().toLowerCase()));

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Pick where this button goes"
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-[var(--admin-radius-lg)] border border-[var(--admin-border)] bg-[var(--admin-surface)] shadow-2xl outline-none"
      >
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <h2 className="text-sm font-bold text-white">Pick where this button goes</h2>
          <button type="button" onClick={onClose} className="rounded px-2 py-1 text-white/60 hover:bg-white/10" aria-label="Close">
            ✕
          </button>
        </div>
        <div className="flex flex-wrap gap-1 border-b border-white/10 px-3 py-2" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={
                tab === t.id
                  ? "rounded-[var(--admin-radius-sm)] bg-[var(--admin-accent-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--admin-accent)]"
                  : "rounded-[var(--admin-radius-sm)] px-2.5 py-1 text-xs text-white/65 hover:bg-white/10"
              }
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {tab === "menu" ? (
            <>
              <p className="text-xs text-white/55">Tick what the menu should show. Leave everything blank for the whole menu.</p>
              <div>
                <span className={studioLabel}>Categories</span>
                <div className="flex flex-wrap gap-1.5">
                  {MENU_CATEGORIES.map((c) => (
                    <Chip key={c.value} active={menu.categories.includes(c.value)} onClick={() => setMenu({ ...menu, categories: toggle(menu.categories, c.value) })}>
                      {c.label}
                    </Chip>
                  ))}
                </div>
              </div>
              <div>
                <span className={studioLabel}>Strain type</span>
                <div className="flex flex-wrap gap-1.5">
                  {MENU_STRAINS.map((s) => (
                    <Chip key={s.value} active={menu.strains.includes(s.value)} onClick={() => setMenu({ ...menu, strains: toggle(menu.strains, s.value) })}>
                      {s.label}
                    </Chip>
                  ))}
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label>
                  <span className={studioLabel}>Special / sale lane</span>
                  <select className={studioInput} value={menu.special ?? ""} onChange={(e) => setMenu({ ...menu, special: e.target.value || null })}>
                    <option value="">— none —</option>
                    {MENU_SPECIALS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className={studioLabel}>Sort</span>
                  <select className={studioInput} value={menu.sort ?? "featured-shuffle"} onChange={(e) => setMenu({ ...menu, sort: e.target.value === "featured-shuffle" ? null : e.target.value })}>
                    {MENU_SORTS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                        {s.value === "featured-shuffle" ? " (default)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className={studioLabel}>Max price ($)</span>
                  <input
                    type="number"
                    min={0}
                    className={studioInput}
                    value={menu.maxPrice ?? ""}
                    onChange={(e) => setMenu({ ...menu, maxPrice: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) })}
                  />
                </label>
                <label>
                  <span className={studioLabel}>Search words</span>
                  <input className={studioInput} value={menu.search} onChange={(e) => setMenu({ ...menu, search: e.target.value })} placeholder="e.g. gummies" />
                </label>
              </div>
              {menu.brands.length || menu.vendors.length || menu.weights.length || menu.maxThc !== null || menu.maxCbd !== null ? (
                <p className="text-xs text-white/55">
                  This link also keeps filters set elsewhere (brand / vendor / size / THC / CBD). They stay as they were.
                </p>
              ) : null}
              <button type="button" className="text-xs text-white/60 underline" onClick={() => setMenu(emptyMenuFilters())}>
                Clear all filters
              </button>
            </>
          ) : null}

          {tab === "category" ? (
            <div className="flex flex-wrap gap-1.5">
              {MENU_CATEGORIES.map((c) => (
                <Chip key={c.value} active={category === c.value} onClick={() => setCategory(c.value)}>
                  {c.label}
                </Chip>
              ))}
            </div>
          ) : null}

          {tab === "blog" ? (
            <>
              <input className={studioInput} value={blogQuery} onChange={(e) => setBlogQuery(e.target.value)} placeholder="Search posts…" aria-label="Search posts" />
              {posts.length === 0 ? (
                <p className="text-xs text-white/55">No published posts were found. Publish a post in Blog first, then come back.</p>
              ) : (
                <ul className="max-h-72 space-y-1 overflow-y-auto">
                  {filteredPosts.map((p) => (
                    <li key={p.slug}>
                      <button
                        type="button"
                        onClick={() => setBlogSlug(p.slug)}
                        className={`w-full rounded px-2 py-1.5 text-left text-sm ${blogSlug === p.slug ? "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]" : "text-white/80 hover:bg-white/10"}`}
                      >
                        {p.newsletter ? "📰 " : "📝 "}
                        {p.title}
                        <span className="ml-2 text-xs text-white/40">/blog/{p.slug}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : null}

          {tab === "page" ? (
            <div className="grid gap-1 sm:grid-cols-2">
              {PUBLIC_PAGES.map((p) => (
                <button
                  key={p.path}
                  type="button"
                  onClick={() => setPage(p.path)}
                  className={`rounded px-2 py-1.5 text-left text-sm ${page === p.path ? "bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]" : "text-white/80 hover:bg-white/10"}`}
                >
                  {p.label} <span className="text-xs text-white/40">{p.path}</span>
                </button>
              ))}
            </div>
          ) : null}

          {tab === "contact" ? (
            <div className="space-y-2">
              <div className="flex gap-1.5">
                <Chip active={contactKind === "tel"} onClick={() => setContactKind("tel")}>
                  Phone call
                </Chip>
                <Chip active={contactKind === "mailto"} onClick={() => setContactKind("mailto")}>
                  Email
                </Chip>
              </div>
              <input
                className={studioInput}
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder={contactKind === "tel" ? "e.g. 360-555-0123" : "e.g. hello@greenwaymarijuana.com"}
              />
            </div>
          ) : null}

          {tab === "external" ? (
            <div className="space-y-2">
              <input className={studioInput} value={external} onChange={(e) => setExternal(e.target.value)} placeholder="https://…" />
              <p className="text-xs text-white/55">Outside links open the other website. Tick “Open in a new tab” on the button if you want visitors to keep your site open.</p>
            </div>
          ) : null}

          {tab === "anchor" ? (
            <div className="space-y-2">
              <input className={studioInput} value={anchor} onChange={(e) => setAnchor(e.target.value)} placeholder="e.g. shop-by-category" />
              <p className="text-xs text-white/55">Jumps down to a part of the same page that has this id.</p>
            </div>
          ) : null}
        </div>

        <div className="space-y-2 border-t border-white/10 px-4 py-3">
          <p className="text-sm text-white">
            <span className="text-white/50">Goes to:</span> {description}
          </p>
          <p className="font-mono text-xs text-white/45">{href || "—"}</p>
          {href && check.level !== "ok" ? (
            <p className={`text-xs ${check.level === "block" ? "text-red-400" : "text-[var(--admin-gold)]"}`}>
              {check.level === "block" ? "⛔ " : "⚠️ "}
              {check.message}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-full bg-white/10 px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-white/80 hover:bg-white/20">
              Cancel
            </button>
            <button
              type="button"
              disabled={!href || check.level === "block"}
              onClick={() => {
                onPick(href);
                onClose();
              }}
              className="rounded-full bg-[var(--admin-accent)] px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-black disabled:cursor-not-allowed disabled:opacity-40"
            >
              Use this link
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
