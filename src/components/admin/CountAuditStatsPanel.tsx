/**
 * R74 S50 — the count's audit statistics (count-audit-stats-core), dark admin theme.
 * Overview first (grade, accuracy, variance in units and dollars, coverage), then the detail:
 * by category, by vendor, by counter, top shrink / overage, unknown barcodes, uncounted lots and the
 * comparison with the published menu. Server component, no client JS.
 */
import { money, type AuditStats, type GroupRow } from "@/lib/pos/count-audit-stats-core";

const n = (v: number) => v.toLocaleString("en-US");
const signed = (v: number) => (v > 0 ? `+${n(v)}` : n(v));
const pctText = (v: number | null) => (v == null ? "—" : `${v}%`);

function Tile({ label, value, sub, tone = "plain" }: { label: string; value: string; sub?: string; tone?: "good" | "ok" | "bad" | "plain" }) {
  const color = tone === "good" ? "text-emerald-300" : tone === "ok" ? "text-amber-300" : tone === "bad" ? "text-red-300" : "text-white";
  return (
    <div className="rounded-lg border border-white/10 bg-black/40 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-white/40">{label}</p>
      <p className={`text-lg font-bold ${color}`}>{value}</p>
      {sub && <p className="text-[11px] text-white/50">{sub}</p>}
    </div>
  );
}

function Bar({ pct, tone }: { pct: number | null; tone: "good" | "ok" | "bad" | "none" }) {
  const w = Math.max(0, Math.min(100, pct ?? 0));
  const c = tone === "good" ? "bg-emerald-500" : tone === "ok" ? "bg-amber-400" : tone === "bad" ? "bg-red-500" : "bg-white/20";
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
      <div className={`h-2 ${c}`} style={{ width: `${w}%` }} />
    </div>
  );
}

const toneOf = (p: number | null): "good" | "ok" | "bad" | "none" => (p == null ? "none" : p >= 95 ? "good" : p >= 90 ? "ok" : "bad");

function GroupTable({ title, rows, keyLabel }: { title: string; rows: GroupRow[]; keyLabel: string }) {
  if (rows.length === 0) return null;
  return (
    <details open={rows.length <= 12} className="rounded-lg border border-white/10 bg-black/30 p-3">
      <summary className="cursor-pointer text-xs font-semibold text-white/80">{title} ({rows.length})</summary>
      <table className="mt-2 w-full text-left text-xs text-white/70">
        <thead className="text-white/40">
          <tr><th>{keyLabel}</th><th>Lots</th><th>Compared</th><th>Accuracy</th><th>System</th><th>Counted</th><th>Short</th><th>Over</th><th>Net</th><th>Value</th></tr>
        </thead>
        <tbody>
          {rows.map((g) => (
            <tr key={g.key} className="border-t border-white/5">
              <td className="py-1 text-white">{g.key}</td>
              <td>{n(g.lots)}</td>
              <td>{n(g.compared)}</td>
              <td className="w-32">
                <div className="flex items-center gap-2"><span className="w-10">{pctText(g.accuracyPct)}</span><Bar pct={g.accuracyPct} tone={toneOf(g.accuracyPct)} /></div>
              </td>
              <td>{n(g.system)}</td>
              <td>{n(g.counted)}</td>
              <td className={g.shrink ? "text-red-300" : ""}>{g.shrink ? `−${n(g.shrink)}` : "0"}</td>
              <td className={g.over ? "text-amber-300" : ""}>{g.over ? `+${n(g.over)}` : "0"}</td>
              <td>{signed(g.net)}</td>
              <td className={g.valueCents < 0 ? "text-red-300" : g.valueCents > 0 ? "text-amber-300" : ""}>{money(g.valueCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

export function CountAuditStatsPanel({ stats, title = "Audit statistics", note }: { stats: AuditStats; title?: string; note?: string }) {
  const o = stats.overview;
  const g = o.grade;
  const leftAlone = Object.entries(o.leftAlone);
  return (
    <section className="space-y-4 rounded-xl border border-white/10 bg-[#0a0a0a] p-5" data-testid="count-audit-stats">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <span
          className={`rounded-full px-3 py-1 text-xs font-bold ${
            g.tone === "good" ? "bg-emerald-500/20 text-emerald-300" : g.tone === "ok" ? "bg-amber-500/20 text-amber-300" : g.tone === "bad" ? "bg-red-500/20 text-red-300" : "bg-white/10 text-white/60"
          }`}
          title={g.why}
        >
          {g.tone === "good" ? "✓ " : ""}{g.label}
        </span>
      </div>
      <p className="text-xs text-white/50">{g.why}{note ? ` ${note}` : ""}</p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        <Tile label="Lot accuracy" value={pctText(o.lotAccuracyPct)} sub={`${n(o.exact)} of ${n(o.compared)} counted lots exact`} tone={o.lotAccuracyPct == null ? "plain" : toneOf(o.lotAccuracyPct) === "none" ? "plain" : (toneOf(o.lotAccuracyPct) as "good" | "ok" | "bad")} />
        <Tile label="Unit accuracy" value={pctText(o.unitAccuracyPct)} sub={`${n(o.grossUnits)} units off either way`} tone={o.unitAccuracyPct == null ? "plain" : (toneOf(o.unitAccuracyPct) as "good" | "ok" | "bad")} />
        <Tile label="System units" value={n(o.systemUnits)} sub={`${n(o.lotsInScope)} lots in scope`} />
        <Tile label="Counted units" value={n(o.countedUnits)} sub={o.soldAfterCount ? `${n(o.soldAfterCount)} sold after the count` : `${n(o.lotsCounted)} lots counted`} />
        <Tile label="Net variance" value={signed(o.netUnits)} sub={money(o.netCents)} tone={o.netUnits < 0 ? "bad" : o.netUnits > 0 ? "ok" : "good"} />
        <Tile label="Coverage" value={pctText(o.coveragePct)} sub={`${n(o.uncountedLots)} lots with stock not counted`} tone={o.coveragePct == null ? "plain" : o.coveragePct >= 99 ? "good" : o.coveragePct >= 90 ? "ok" : "bad"} />
        <Tile label="Shrink (short)" value={`−${n(o.shrinkUnits)}`} sub={money(-o.shrinkCents)} tone={o.shrinkUnits ? "bad" : "good"} />
        <Tile label="Overage" value={`+${n(o.overUnits)}`} sub={money(o.overCents)} tone={o.overUnits ? "ok" : "good"} />
        <Tile label="Inventory value (cost)" value={money(o.systemCents)} sub={`variance ${o.valueVariancePct == null ? "—" : `${o.valueVariancePct}%`}`} />
        <Tile label="Cost known for" value={pctText(o.costCoveragePct)} sub="of system units (rest show —)" />
        <Tile label="Unknown barcodes" value={n(o.unknownBarcodes)} sub={`${n(o.unknownUnits)} units, not in the system`} tone={o.unknownBarcodes ? "bad" : "good"} />
        <Tile label="Left alone" value={n(leftAlone.reduce((a, [, v]) => a + v, 0))} sub={leftAlone.length ? leftAlone.map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`).join(", ") : "none"} tone={leftAlone.length ? "ok" : "good"} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {stats.topShrink.length > 0 && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
            <p className="text-xs font-semibold text-red-200">Biggest shortages (recount these first)</p>
            <table className="mt-2 w-full text-left text-xs text-white/70">
              <thead className="text-white/40"><tr><th>Product</th><th>System</th><th>Shelf</th><th>Diff</th><th>Value</th><th>Counted by</th></tr></thead>
              <tbody>
                {stats.topShrink.map((v) => (
                  <tr key={v.code} className="border-t border-white/5"><td className="py-1"><span className="text-white">{v.product || v.code}</span><br /><span className="font-mono text-[10px] text-white/40">{v.code} · {v.category}</span></td><td>{v.system}</td><td>{v.shelf}</td><td className="text-red-300">{v.variance}</td><td>{money(v.valueCents)}</td><td className="text-white/50">{v.counters}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {stats.topOver.length > 0 && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
            <p className="text-xs font-semibold text-amber-200">Biggest overages (double scans or unreceived stock?)</p>
            <table className="mt-2 w-full text-left text-xs text-white/70">
              <thead className="text-white/40"><tr><th>Product</th><th>System</th><th>Shelf</th><th>Diff</th><th>Value</th><th>Counted by</th></tr></thead>
              <tbody>
                {stats.topOver.map((v) => (
                  <tr key={v.code} className="border-t border-white/5"><td className="py-1"><span className="text-white">{v.product || v.code}</span><br /><span className="font-mono text-[10px] text-white/40">{v.code} · {v.category}</span></td><td>{v.system}</td><td>{v.shelf}</td><td className="text-amber-300">+{v.variance}</td><td>{money(v.valueCents)}</td><td className="text-white/50">{v.counters}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <GroupTable title="By category" rows={stats.byCategory} keyLabel="Category" />
      <GroupTable title="By vendor (top by value)" rows={stats.byVendor} keyLabel="Vendor" />

      {stats.byCounter.length > 0 && (
        <details open className="rounded-lg border border-white/10 bg-black/30 p-3">
          <summary className="cursor-pointer text-xs font-semibold text-white/80">By counter ({stats.byCounter.length})</summary>
          <table className="mt-2 w-full text-left text-xs text-white/70">
            <thead className="text-white/40"><tr><th>Counter</th><th>Units</th><th>Different products</th><th>Share</th><th>Not-in-system units</th></tr></thead>
            <tbody>
              {stats.byCounter.map((c) => (
                <tr key={c.counter} className="border-t border-white/5">
                  <td className="py-1 text-white">{c.counter}</td><td>{n(c.units)}</td><td>{n(c.lots)}</td>
                  <td className="w-40"><div className="flex items-center gap-2"><span className="w-10">{c.sharePct}%</span><Bar pct={c.sharePct} tone="none" /></div></td>
                  <td className={c.unknownUnits ? "text-red-300" : ""}>{n(c.unknownUnits)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      {(stats.unknown.length > 0 || stats.uncounted.length > 0) && (
        <div className="grid gap-3 lg:grid-cols-2">
          {stats.unknown.length > 0 && (
            <div className="rounded-lg border border-white/10 bg-black/30 p-3">
              <p className="text-xs font-semibold text-white/80">Scanned but not in the system</p>
              <ul className="mt-1 space-y-0.5 text-xs text-white/60">
                {stats.unknown.map((u) => <li key={u.code}><span className="font-mono text-white">{u.code}</span> · {u.units} unit(s) · {u.counters}</li>)}
              </ul>
            </div>
          )}
          {stats.uncounted.length > 0 && (
            <div className="rounded-lg border border-white/10 bg-black/30 p-3">
              <p className="text-xs font-semibold text-white/80">Has stock in the system, nobody counted it (go and look)</p>
              <ul className="mt-1 space-y-0.5 text-xs text-white/60">
                {stats.uncounted.map((u) => <li key={u.code}><span className="text-white">{u.product || u.code}</span> · {u.system} in system · {money(u.valueCents)} · <span className="font-mono text-white/40">{u.code}</span></li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="rounded-lg border border-white/10 bg-black/30 p-3 text-xs text-white/70">
        <p className="font-semibold text-white/80">Compared with the menu in the system (published version)</p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Tile label="Lots on a menu card" value={n(stats.menu.lotsOnMenu)} />
          <Tile label="Lots with no menu card" value={n(stats.menu.lotsNotOnMenu)} tone={stats.menu.lotsNotOnMenu ? "ok" : "good"} />
          <Tile label="Cards: menu stock = shelf" value={`${n(stats.menu.cardsMatching)} / ${n(stats.menu.cardsCompared)}`} tone={stats.menu.cardsCompared && stats.menu.cardsMatching === stats.menu.cardsCompared ? "good" : stats.menu.cardsCompared ? "ok" : "plain"} />
          <Tile label="Hidden cards with stock counted" value={n(stats.menu.hiddenCounted.length)} tone={stats.menu.hiddenCounted.length ? "ok" : "good"} />
        </div>
        {stats.menu.cardMismatches.length > 0 && (
          <table className="mt-2 w-full text-left">
            <thead className="text-white/40"><tr><th>Menu card</th><th>Menu stock</th><th>Shelf</th><th>Diff</th></tr></thead>
            <tbody>
              {stats.menu.cardMismatches.map((m) => <tr key={m.card} className="border-t border-white/5"><td className="py-1 text-white">{m.card}</td><td>{m.menuStock}</td><td>{m.shelf}</td><td className={m.diff < 0 ? "text-red-300" : "text-amber-300"}>{signed(m.diff)}</td></tr>)}
            </tbody>
          </table>
        )}
        {stats.menu.hiddenCounted.length > 0 && <p className="mt-2 text-white/50">Hidden on the menu but on the shelf: {stats.menu.hiddenCounted.map((h) => `${h.product || h.code} (${h.shelf})`).join(", ")}.</p>}
        {stats.menu.notOnMenu.length > 0 && <p className="mt-1 text-white/50">Counted with no menu card: {stats.menu.notOnMenu.map((h) => `${h.product || h.code} (${h.shelf})`).join(", ")}.</p>}
        <p className="mt-2 text-white/40">Menu stock is compared only for cards whose every lot was counted. Applying the count moves the menu stock with the lots.</p>
      </div>
    </section>
  );
}
