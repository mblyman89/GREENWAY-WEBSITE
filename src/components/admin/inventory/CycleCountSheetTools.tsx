"use client";

/**
 * CycleCountSheetTools — Beautification B5
 *
 * The "scan to Excel" workstation for an OPEN cycle count:
 *   • Rich filter + sort controls. Applying them updates the page's query
 *     string (so the on-screen line table AND the export reflect the same view)
 *     and builds the export download URL.
 *   • Export the current (filtered/sorted) view to .xlsx or .csv with a blank
 *     Counted Qty column.
 *   • Import a filled sheet: shows a NON-DESTRUCTIVE validation preview
 *     (matched / changed / unmatched / invalid) and only writes counts after
 *     the operator clicks Approve.
 *
 * Solid brand-color buttons, dark admin tokens, no transparent/white surfaces.
 */
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Button, Field, Input, Select, Badge } from "@/components/admin/ui";
import { useToast } from "@/components/admin/ux";
import {
  previewCountSheetAction,
  applyCountSheetAction,
  type CountSheetPreviewResult,
} from "@/app/admin/inventory/cycle-counts/actions";
import type { ImportPreview } from "@/lib/inventory/cycle-count-sheet-core";

type FilterOptions = {
  /** OUR website category labels (primary, converted-to-our-convention filter). */
  categories: string[];
  /** RAW LCB inventory_category values (reference filter, kept available). */
  lcbCategories: string[];
  types: string[];
  vendors: string[];
  brands: string[];
};

// Styled to match the shared Button pills (solid fill, uppercase, rounded-full)
// for plain download anchors that must NOT use client-side routing.
const DOWNLOAD_BTN_BASE =
  "inline-flex items-center justify-center gap-2 rounded-full font-black uppercase tracking-[0.1em] px-5 py-2.5 text-xs transition hover:brightness-110 active:brightness-95";
const DOWNLOAD_BTN_SAVE = `${DOWNLOAD_BTN_BASE} bg-[var(--admin-gold)] text-black`;
const DOWNLOAD_BTN_NEUTRAL = `${DOWNLOAD_BTN_BASE} bg-[var(--admin-surface-2)] text-[var(--admin-text)] hover:bg-[var(--admin-surface-hover)]`;

const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: "product", label: "Product name" },
  { value: "lot", label: "Lot code" },
  { value: "category", label: "Category" },
  { value: "vendor", label: "Vendor" },
  { value: "brand", label: "Brand" },
  { value: "system", label: "System qty" },
  { value: "counted", label: "Counted qty" },
  { value: "variance", label: "Variance" },
];

export function CycleCountSheetTools({
  countId,
  options,
  totalLines,
  shownLines,
}: {
  countId: string;
  options: FilterOptions;
  totalLines: number;
  shownLines: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { toast } = useToast();

  // Controlled from the current query so the tools mirror the visible table.
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [category, setCategory] = useState(sp.get("category") ?? "");
  const [lcbCategory, setLcbCategory] = useState(sp.get("lcbcategory") ?? "");
  const [type, setType] = useState(sp.get("type") ?? "");
  const [vendor, setVendor] = useState(sp.get("vendor") ?? "");
  const [brand, setBrand] = useState(sp.get("brand") ?? "");
  const [counted, setCounted] = useState(sp.get("counted") ?? "all");
  const [sample, setSample] = useState(sp.get("sample") ?? "all");
  const [medical, setMedical] = useState(sp.get("medical") ?? "all");
  const [sort, setSort] = useState(sp.get("sort") ?? "product");
  const [dir, setDir] = useState(sp.get("dir") ?? "asc");

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (category) p.set("category", category);
    if (lcbCategory) p.set("lcbcategory", lcbCategory);
    if (type) p.set("type", type);
    if (vendor) p.set("vendor", vendor);
    if (brand) p.set("brand", brand);
    if (counted !== "all") p.set("counted", counted);
    if (sample !== "all") p.set("sample", sample);
    if (medical !== "all") p.set("medical", medical);
    if (sort !== "product") p.set("sort", sort);
    if (dir !== "asc") p.set("dir", dir);
    return p;
  }, [q, category, lcbCategory, type, vendor, brand, counted, sample, medical, sort, dir]);

  function applyFilters() {
    const s = query.toString();
    router.push(s ? `${pathname}?${s}` : pathname);
  }

  function resetFilters() {
    setQ(""); setCategory(""); setLcbCategory(""); setType(""); setVendor(""); setBrand("");
    setCounted("all"); setSample("all"); setMedical("all"); setSort("product"); setDir("asc");
    router.push(pathname);
  }

  const exportHref = (format: "xlsx" | "csv") => {
    const p = new URLSearchParams(query);
    p.set("format", format);
    return `${pathname}/export?${p.toString()}`;
  };

  // ---- Import flow -------------------------------------------------------
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [previewPending, startPreview] = useTransition();
  const [applyPending, startApply] = useTransition();

  function onFileChosen(files: FileList | null) {
    if (!files || files.length === 0) return;
    const fd = new FormData();
    fd.set("file", files[0]);
    setPreview(null);
    startPreview(async () => {
      const res: CountSheetPreviewResult = await previewCountSheetAction(countId, fd);
      if (res.ok) {
        setPreview(res.preview);
        toast({ tone: "info", message: `Read ${res.preview.matched} matched, ${res.preview.unmatched} unmatched, ${res.preview.invalid} invalid row(s). Review, then approve.` });
      } else {
        toast({ tone: "error", message: res.error });
      }
      if (fileRef.current) fileRef.current.value = "";
    });
  }

  function approveImport() {
    if (!preview) return;
    const entries = preview.results
      .filter((r): r is Extract<ImportPreview["results"][number], { status: "matched" }> => r.status === "matched" && r.changed)
      .map((r) => ({ lineId: r.lineId, countedQty: r.countedQty }));
    if (entries.length === 0) {
      toast({ tone: "info", message: "No changed counts to apply." });
      return;
    }
    startApply(async () => {
      const res = await applyCountSheetAction(countId, entries);
      if (res.ok) {
        toast({ tone: "success", message: `Applied ${res.applied} count(s)${res.failed ? `, ${res.failed} failed` : ""}. Table updated.` });
        setPreview(null);
        router.refresh();
      } else {
        toast({ tone: "error", message: res.error });
      }
    });
  }

  const changedCount = preview
    ? preview.results.filter((r) => r.status === "matched" && r.changed).length
    : 0;

  return (
    <section className="space-y-4 rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-black uppercase tracking-[0.14em] text-[var(--admin-text)]">
          Scan to Excel
        </h2>
        <span className="text-xs text-[var(--admin-text-faint)]">
          Showing {shownLines.toLocaleString()} of {totalLines.toLocaleString()} lots
        </span>
      </div>

      {/* Filters */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Search" help="Product, strain, lot code, or POS key">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. blue dream" />
        </Field>
        <Field label="Category" help="Our website category (converted from LCB)">
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {options.categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="LCB category" help="Raw LCB/CCRS classification (reference)">
          <Select value={lcbCategory} onChange={(e) => setLcbCategory(e.target.value)}>
            <option value="">All LCB categories</option>
            {options.lcbCategories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="LCB inventory type" help="Raw LCB/CCRS inventory type (reference)">
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All types</option>
            {options.types.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </Select>
        </Field>
        <Field label="Vendor">
          <Select value={vendor} onChange={(e) => setVendor(e.target.value)}>
            <option value="">All vendors</option>
            {options.vendors.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </Select>
        </Field>
        <Field label="Brand">
          <Select value={brand} onChange={(e) => setBrand(e.target.value)}>
            <option value="">All brands</option>
            {options.brands.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </Select>
        </Field>
        <Field label="Counted status">
          <Select value={counted} onChange={(e) => setCounted(e.target.value)}>
            <option value="all">All lots</option>
            <option value="uncounted">Not counted yet</option>
            <option value="counted">Already counted</option>
          </Select>
        </Field>
        <Field label="Trade samples">
          <Select value={sample} onChange={(e) => setSample(e.target.value)}>
            <option value="all">Include samples</option>
            <option value="exclude">Exclude samples</option>
            <option value="only">Only samples</option>
          </Select>
        </Field>
        <Field label="Medical">
          <Select value={medical} onChange={(e) => setMedical(e.target.value)}>
            <option value="all">Include medical</option>
            <option value="exclude">Exclude medical</option>
            <option value="only">Only medical</option>
          </Select>
        </Field>
        <Field label="Sort by">
          <div className="flex gap-2">
            <Select value={sort} onChange={(e) => setSort(e.target.value)}>
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </Select>
            <Select value={dir} onChange={(e) => setDir(e.target.value)} className="w-24">
              <option value="asc">Asc</option>
              <option value="desc">Desc</option>
            </Select>
          </div>
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="confirm" onClick={applyFilters}>Apply filters</Button>
        <Button variant="neutral" onClick={resetFilters}>Reset</Button>
        <span className="mx-1 h-5 w-px bg-[var(--admin-border-strong)]" aria-hidden />
        {/* Downloads to a route handler — use a plain anchor (no client routing). */}
        <a href={exportHref("xlsx")} className={DOWNLOAD_BTN_SAVE}>Export to Excel</a>
        <a href={exportHref("csv")} className={DOWNLOAD_BTN_NEUTRAL}>Export CSV</a>
      </div>

      {/* Import */}
      <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-canvas)] p-4">
        <div className="mb-1 flex items-center justify-between gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]">
            Import a scanned sheet
          </h3>
          {preview ? (
            <span className="text-xs text-[var(--admin-text-faint)]">
              {preview.matched} matched · {preview.unmatched} unmatched · {preview.invalid} invalid
            </span>
          ) : null}
        </div>
        <p className="mb-3 text-xs text-[var(--admin-text-faint)]">
          Upload the filled count sheet (.xlsx or .csv). We match every row back to a lot and show a preview — nothing
          is written until you approve.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
          className="hidden"
          onChange={(e) => onFileChosen(e.target.files)}
        />
        <Button variant="primary" onClick={() => fileRef.current?.click()} disabled={previewPending}>
          {previewPending ? "Reading…" : "Choose scanned sheet"}
        </Button>

        {preview ? (
          <div className="mt-4 space-y-3">
            {preview.duplicates > 0 ? (
              <p className="rounded-lg border border-[var(--admin-gold)]/30 bg-[var(--admin-gold-soft)] px-3 py-2 text-xs text-[var(--admin-gold)]">
                {preview.duplicates} row(s) matched a lot already matched by another row — the last value wins.
              </p>
            ) : null}

            <div className="max-h-72 overflow-auto rounded-lg border border-[var(--admin-border)]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-[var(--admin-surface-2)]">
                  <tr className="text-left text-[11px] uppercase tracking-wider text-[var(--admin-text-faint)]">
                    <th className="px-3 py-2">Row</th>
                    <th className="px-3 py-2">Lot / key</th>
                    <th className="px-3 py-2">Product</th>
                    <th className="px-3 py-2 text-right">New count</th>
                    <th className="px-3 py-2 text-right">Was</th>
                    <th className="px-3 py-2 text-right">Variance</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--admin-border)]">
                  {preview.results.map((r, i) => {
                    if (r.status === "matched") {
                      return (
                        <tr key={`m-${i}`} className="text-[var(--admin-text)]">
                          <td className="px-3 py-2 text-[var(--admin-text-faint)]">{i + 1}</td>
                          <td className="px-3 py-2 font-mono text-[11px]">{r.lotCode ?? "—"}</td>
                          <td className="px-3 py-2">{r.productName ?? "—"}</td>
                          <td className="px-3 py-2 text-right font-semibold">{r.countedQty}</td>
                          <td className="px-3 py-2 text-right text-[var(--admin-text-muted)]">{r.previousQty ?? "—"}</td>
                          <td className="px-3 py-2 text-right">
                            {r.variance === 0 ? (
                              <Badge tone="green">match</Badge>
                            ) : (
                              <Badge tone={r.variance > 0 ? "gold" : "danger"}>{r.variance > 0 ? `+${r.variance}` : r.variance}</Badge>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {r.changed ? <Badge tone="orange">will update</Badge> : <Badge tone="neutral">no change</Badge>}
                          </td>
                        </tr>
                      );
                    }
                    if (r.status === "unmatched") {
                      return (
                        <tr key={`u-${i}`} className="text-[var(--admin-text-muted)]">
                          <td className="px-3 py-2 text-[var(--admin-text-faint)]">{r.rowIndex}</td>
                          <td className="px-3 py-2 font-mono text-[11px]">{r.key}</td>
                          <td className="px-3 py-2">—</td>
                          <td className="px-3 py-2 text-right">{r.countedQty ?? "—"}</td>
                          <td className="px-3 py-2 text-right">—</td>
                          <td className="px-3 py-2 text-right">—</td>
                          <td className="px-3 py-2"><Badge tone="neutral">not in count</Badge></td>
                        </tr>
                      );
                    }
                    return (
                      <tr key={`i-${i}`} className="text-[var(--admin-text-muted)]">
                        <td className="px-3 py-2 text-[var(--admin-text-faint)]">{r.rowIndex}</td>
                        <td className="px-3 py-2 font-mono text-[11px]">{r.key}</td>
                        <td className="px-3 py-2" colSpan={4}>{r.reason}</td>
                        <td className="px-3 py-2"><Badge tone="danger">invalid</Badge></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="confirm" onClick={approveImport} disabled={applyPending || changedCount === 0}>
                {applyPending ? "Applying…" : `Approve & apply ${changedCount} change${changedCount === 1 ? "" : "s"}`}
              </Button>
              <Button variant="neutral" onClick={() => setPreview(null)} disabled={applyPending}>
                Discard
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
