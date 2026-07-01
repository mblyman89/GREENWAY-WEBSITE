"use client";

/**
 * AuditTimeline — the filterable, searchable activity-log timeline.
 *
 * Slice 62 upgrade: in addition to free-text / actor / tone, this now offers
 *   - a date range (from / to, inclusive by calendar day)
 *   - an action category (grounded via audit-anomaly-core.categorize, computed
 *     server-side and passed in per entry)
 *   - an entity-type filter
 *   - a "sensitive only" toggle (security-relevant actions)
 * plus a live result count.
 *
 * Data is loaded server-side and passed in already humanized + classified, so
 * this remains a pure presentation/filter layer — no extra fetching, no PII
 * leaves the page.
 */
import { useMemo, useState } from "react";

export type AuditEntry = {
  id: string | number;
  actorEmail: string | null;
  phrase: string;
  icon: string;
  tone: string;
  toneBadge: string;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
  dayLabel: string;
  timeLabel: string;
  /** Grounded action category (from audit-anomaly-core.categorize). */
  category: string;
  /** Whether this action is security-relevant (audit-anomaly-core.isSensitive). */
  sensitive: boolean;
};

type Props = { entries: AuditEntry[] };

function initials(email: string | null): string {
  if (!email) return "?";
  const name = email.split("@")[0];
  const parts = name.split(/[.\-_]/).filter(Boolean);
  return (parts[0]?.[0] ?? name[0] ?? "?").toUpperCase() + (parts[1]?.[0]?.toUpperCase() ?? "");
}

/** Local calendar-day key (YYYY-MM-DD) for a timestamp. */
function dayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const selectClass =
  "rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white/80 outline-none focus:border-[#7ed957]";

export function AuditTimeline({ entries }: Props) {
  const [q, setQ] = useState("");
  const [actor, setActor] = useState("all");
  const [tone, setTone] = useState("all");
  const [category, setCategory] = useState("all");
  const [entityType, setEntityType] = useState("all");
  const [sensitiveOnly, setSensitiveOnly] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const actors = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) if (e.actorEmail) set.add(e.actorEmail);
    return Array.from(set).sort();
  }, [entries]);

  const tones = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) set.add(e.tone);
    return Array.from(set).sort();
  }, [entries]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) set.add(e.category);
    return Array.from(set).sort();
  }, [entries]);

  const entityTypes = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) if (e.entityType) set.add(e.entityType);
    return Array.from(set).sort();
  }, [entries]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return entries.filter((e) => {
      if (actor !== "all" && e.actorEmail !== actor) return false;
      if (tone !== "all" && e.tone !== tone) return false;
      if (category !== "all" && e.category !== category) return false;
      if (entityType !== "all" && e.entityType !== entityType) return false;
      if (sensitiveOnly && !e.sensitive) return false;
      if (from || to) {
        const k = dayKey(e.createdAt);
        if (from && k < from) return false;
        if (to && k > to) return false;
      }
      if (!query) return true;
      const hay = `${e.actorEmail ?? ""} ${e.phrase} ${e.entityType ?? ""} ${e.entityId ?? ""} ${e.category}`.toLowerCase();
      return hay.includes(query);
    });
  }, [entries, q, actor, tone, category, entityType, sensitiveOnly, from, to]);

  // Re-group filtered entries by day for the timeline.
  const groups = useMemo(() => {
    const out: { day: string; items: AuditEntry[] }[] = [];
    for (const e of filtered) {
      const last = out[out.length - 1];
      if (last && last.day === e.dayLabel) last.items.push(e);
      else out.push({ day: e.dayLabel, items: [e] });
    }
    return out;
  }, [filtered]);

  const hasFilters =
    q.trim() !== "" ||
    actor !== "all" ||
    tone !== "all" ||
    category !== "all" ||
    entityType !== "all" ||
    sensitiveOnly ||
    from !== "" ||
    to !== "";

  function clearAll() {
    setQ("");
    setActor("all");
    setTone("all");
    setCategory("all");
    setEntityType("all");
    setSensitiveOnly(false);
    setFrom("");
    setTo("");
  }

  return (
    <div>
      {/* Filter bar */}
      <div className="mb-5 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search who, what, or which item…"
            className="min-w-[14rem] flex-1 rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
          />
          <select value={actor} onChange={(e) => setActor(e.target.value)} className={selectClass}>
            <option value="all">Everyone</option>
            {actors.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={selectClass}>
            <option value="all">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={tone}
            onChange={(e) => setTone(e.target.value)}
            className={`${selectClass} capitalize`}
          >
            <option value="all">All action types</option>
            {tones.map((t) => (
              <option key={t} value={t} className="capitalize">
                {t}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {entityTypes.length > 0 && (
            <select
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
              className={selectClass}
            >
              <option value="all">All record types</option>
              {entityTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          )}
          <label className="flex items-center gap-1.5 text-xs text-white/50">
            <span>From</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-lg border border-white/15 bg-black px-2 py-1.5 text-xs text-white/80 outline-none focus:border-[#7ed957]"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-white/50">
            <span>To</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-lg border border-white/15 bg-black px-2 py-1.5 text-xs text-white/80 outline-none focus:border-[#7ed957]"
            />
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/15 px-3 py-2 text-xs text-white/60 hover:bg-white/5">
            <input
              type="checkbox"
              checked={sensitiveOnly}
              onChange={(e) => setSensitiveOnly(e.target.checked)}
              className="accent-[#7ed957]"
            />
            <span>Sensitive only</span>
          </label>
          {hasFilters && (
            <button
              type="button"
              onClick={clearAll}
              className="rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-white/60 hover:bg-white/10"
            >
              Clear
            </button>
          )}
          <span className="ml-auto text-xs text-white/40">
            {filtered.length} of {entries.length}
          </span>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-[#0a0a0a] px-4 py-10 text-center text-sm text-white/45">
          No activity matches your filters.
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map((group) => (
            <section key={group.day}>
              <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-white/40">
                {group.day}
              </h2>
              <div className="relative space-y-3 border-l border-white/10 pl-5">
                {group.items.map((log) => (
                  <div key={log.id} className="relative">
                    <span className="absolute -left-[1.45rem] top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-white/10 bg-[#0a0a0a] text-[10px]">
                      {log.icon}
                    </span>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-white/10 bg-[#0a0a0a] px-3 py-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#7ed957]/15 text-[10px] font-bold text-[#7ed957]">
                        {initials(log.actorEmail)}
                      </span>
                      <span className="text-sm text-white/85">
                        <strong className="font-semibold text-white">
                          {log.actorEmail ?? "Someone"}
                        </strong>{" "}
                        {log.phrase}
                      </span>
                      {log.sensitive && (
                        <span className="rounded-full border border-amber-400/40 bg-amber-400/15 px-1.5 py-0.5 text-[9px] font-medium text-amber-200">
                          sensitive
                        </span>
                      )}
                      {log.entityType && (
                        <span className="text-xs text-white/35">
                          ({log.entityType}
                          {log.entityId ? `:${log.entityId.slice(0, 8)}` : ""})
                        </span>
                      )}
                      <span
                        className={`ml-auto rounded-full border px-2 py-0.5 text-[10px] font-medium ${log.toneBadge}`}
                      >
                        {log.timeLabel}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
