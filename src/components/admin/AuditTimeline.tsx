"use client";

/**
 * AuditTimeline — the filterable, searchable activity-log timeline (PR E).
 * Wraps the previously server-only timeline render with:
 *   - a free-text search (matches actor email, action phrase, entity type/id)
 *   - an actor filter (everyone who appears in the loaded window)
 *   - a tone filter (create / update / delete / publish / etc.)
 *   - a live result count
 *
 * The data is loaded server-side and passed in already humanized, so this is a
 * pure presentation/filter layer — no extra fetching, no PII leaves the page.
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
};

type Props = { entries: AuditEntry[] };

function initials(email: string | null): string {
  if (!email) return "?";
  const name = email.split("@")[0];
  const parts = name.split(/[.\-_]/).filter(Boolean);
  return (parts[0]?.[0] ?? name[0] ?? "?").toUpperCase() + (parts[1]?.[0]?.toUpperCase() ?? "");
}

export function AuditTimeline({ entries }: Props) {
  const [q, setQ] = useState("");
  const [actor, setActor] = useState("all");
  const [tone, setTone] = useState("all");

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

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return entries.filter((e) => {
      if (actor !== "all" && e.actorEmail !== actor) return false;
      if (tone !== "all" && e.tone !== tone) return false;
      if (!query) return true;
      const hay = `${e.actorEmail ?? ""} ${e.phrase} ${e.entityType ?? ""} ${e.entityId ?? ""}`.toLowerCase();
      return hay.includes(query);
    });
  }, [entries, q, actor, tone]);

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

  const hasFilters = q.trim() !== "" || actor !== "all" || tone !== "all";

  return (
    <div>
      {/* Filter bar */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search who, what, or which item…"
          className="min-w-[14rem] flex-1 rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#7ed957]"
        />
        <select
          value={actor}
          onChange={(e) => setActor(e.target.value)}
          className="rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white/80 outline-none focus:border-[#7ed957]"
        >
          <option value="all">Everyone</option>
          {actors.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <select
          value={tone}
          onChange={(e) => setTone(e.target.value)}
          className="rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white/80 outline-none focus:border-[#7ed957] capitalize"
        >
          <option value="all">All actions</option>
          {tones.map((t) => (
            <option key={t} value={t} className="capitalize">
              {t}
            </option>
          ))}
        </select>
        {hasFilters && (
          <button
            type="button"
            onClick={() => {
              setQ("");
              setActor("all");
              setTone("all");
            }}
            className="rounded-lg border border-white/15 px-3 py-2 text-sm font-semibold text-white/60 hover:bg-white/10"
          >
            Clear
          </button>
        )}
        <span className="ml-auto text-xs text-white/40">
          {filtered.length} of {entries.length}
        </span>
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
