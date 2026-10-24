"use client";
/** R74 S40 - every finding of one comparison: filter by area/finding, search, page. */
import { useMemo, useState } from "react";
import { bucketMeta, type CompareArea, type CompareItem } from "@/lib/compliance/ccrs-records-compare-core";

const AREA_LABEL: Record<CompareArea, string> = { lots: "Our lots", ledger: "Ledger", filings: "Our filings" };
const PAGE = 100;

export function CcrsFindingsExplorer({ items, verifyMeaning, initialBucket }: { items: CompareItem[]; verifyMeaning: Record<string, string>; initialBucket?: string }) {
  const [area, setArea] = useState<CompareArea | "all">(initialBucket ? (initialBucket.split(":")[0] as CompareArea) : "all");
  const [bucket, setBucket] = useState<string>(initialBucket ?? "all");
  const [problemsOnly, setProblemsOnly] = useState(!initialBucket);
  const [type, setType] = useState("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);

  const bucketsInArea = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items) if (area === "all" || i.area === area) m.set(`${i.area}:${i.bucket}`, (m.get(`${i.area}:${i.bucket}`) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [items, area]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((i) =>
      (area === "all" || i.area === area) &&
      (bucket === "all" || `${i.area}:${i.bucket}` === bucket) &&
      (!problemsOnly || i.problem) &&
      (type === "all" || i.t === type) &&
      (!needle || `${i.id} ${i.label} ${i.ours} ${i.ccrs} ${i.detail}`.toLowerCase().includes(needle)),
    );
  }, [items, area, bucket, problemsOnly, type, q]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const p = Math.min(page, pages - 1);
  const shown = filtered.slice(p * PAGE, p * PAGE + PAGE);
  const reset = () => setPage(0);
  const sel = "rounded-lg border border-white/15 bg-black/30 px-2.5 py-1.5 text-xs text-white";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-lg border border-white/15 text-xs">
          {(["all", "lots", "ledger", "filings"] as const).map((a) => (
            <button key={a} type="button" onClick={() => { setArea(a); setBucket("all"); reset(); }} className={`px-3 py-1.5 font-semibold ${area === a ? "bg-emerald-500/25 text-emerald-100" : "text-white/60 hover:bg-white/5"}`}>
              {a === "all" ? "All" : AREA_LABEL[a]}
            </button>
          ))}
        </div>
        <select value={bucket} onChange={(e) => { setBucket(e.target.value); reset(); }} className={sel}>
          <option value="all">Every finding</option>
          {bucketsInArea.map(([k, n]) => {
            const [a, b] = k.split(":");
            return <option key={k} value={k}>{AREA_LABEL[a as CompareArea]}: {bucketMeta(a as CompareArea, b, verifyMeaning).label} ({n.toLocaleString()})</option>;
          })}
        </select>
        <select value={type} onChange={(e) => { setType(e.target.value); reset(); }} className={sel}>
          <option value="all">All types</option>
          {["Inventory", "Product", "Strain", "Area"].map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-white/60">
          <input type="checkbox" checked={problemsOnly} onChange={(e) => { setProblemsOnly(e.target.checked); reset(); }} /> Needs action only
        </label>
        <input value={q} onChange={(e) => { setQ(e.target.value); reset(); }} placeholder="Search id, name, detail..." className={`${sel} min-w-[200px] flex-1`} />
      </div>
      {bucket !== "all" ? (
        <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/60">
          {bucketMeta(bucket.split(":")[0] as CompareArea, bucket.split(":")[1], verifyMeaning).meaning}
        </div>
      ) : null}
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[820px] text-left text-xs">
          <thead className="bg-white/[0.04] text-[10px] uppercase tracking-wider text-white/45">
            <tr>
              <th className="px-3 py-2">Finding</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Id / name</th>
              <th className="px-3 py-2">Ours</th>
              <th className="px-3 py-2">CCRS</th>
              <th className="px-3 py-2">Detail</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {shown.map((i, n) => (
              <tr key={`${i.area}:${i.bucket}:${i.t}:${i.id}:${n}`} className="hover:bg-white/[0.03]">
                <td className="px-3 py-2">
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${i.problem ? "bg-amber-400/15 text-amber-200" : "bg-white/10 text-white/60"}`}>
                    {i.problem ? "●" : "○"} {bucketMeta(i.area, i.bucket, verifyMeaning).label}
                  </span>
                  <div className="mt-0.5 text-[10px] text-white/35">{AREA_LABEL[i.area]}</div>
                </td>
                <td className="px-3 py-2 text-white/60">{i.t}</td>
                <td className="px-3 py-2">
                  <div className="font-mono text-white/85">{i.id}</div>
                  {i.label ? <div className="max-w-[240px] truncate text-white/45" title={i.label}>{i.label}</div> : null}
                </td>
                <td className="max-w-[200px] truncate px-3 py-2 text-white/70" title={i.ours}>{i.ours}</td>
                <td className="max-w-[200px] truncate px-3 py-2 text-white/70" title={i.ccrs}>{i.ccrs}</td>
                <td className="max-w-[320px] truncate px-3 py-2 text-white/50" title={i.detail}>{i.detail}</td>
              </tr>
            ))}
            {shown.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-white/40">Nothing matches these filters.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between text-xs text-white/50">
        <span>{filtered.length.toLocaleString()} finding(s){filtered.length > PAGE ? ` · showing ${p * PAGE + 1}-${Math.min(filtered.length, p * PAGE + PAGE)}` : ""}</span>
        {pages > 1 ? (
          <div className="flex gap-1">
            <button type="button" disabled={p === 0} onClick={() => setPage(p - 1)} className="rounded border border-white/15 px-2 py-1 disabled:opacity-30">‹ Prev</button>
            <span className="px-2 py-1">{p + 1} / {pages}</span>
            <button type="button" disabled={p >= pages - 1} onClick={() => setPage(p + 1)} className="rounded border border-white/15 px-2 py-1 disabled:opacity-30">Next ›</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
