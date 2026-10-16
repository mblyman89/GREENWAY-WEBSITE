"use client";

/**
 * R58-S3 — countdown & auto deal badge controls for a text box, plus the
 * one-click "Live badges" row (Shapes tab, next to the badge stickers).
 * The box's words become a template: {left} {clock} {offer} {deal} {ends}.
 */
import { MAX_TEXT_BOXES, defaultTextBox, nextId, type BannerDesign, type DesignTextBox } from "@/lib/cms/banner-design-core";
import { LIVE_PRESETS, LIVE_TOKENS, type LiveText } from "@/lib/cms/banner-live-core";
import { offerLabelFor } from "@/lib/promotions/published-rules-core";
import { usePublishedRules } from "@/components/promotions/PublishedRulesProvider";
import { Row, Segmented, studioInput } from "./controls";
import type { StudioSelection } from "./StudioCanvas";

/** Default target for a new countdown (event-time only). */
function daysFromNow(n: number): string {
  return new Date(Date.now() + n * 86400e3).toISOString();
}

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** ISO → value for <input type="datetime-local"> (visitor's local time = the owner's). */
function toLocalInput(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function LiveFields({ box, patch }: { box: DesignTextBox; patch: (p: Partial<DesignTextBox>) => void }) {
  const rules = usePublishedRules();
  const live = box.live;
  const set = (l: Partial<LiveText> | null) => patch({ live: l === null ? undefined : ({ ...(live ?? { mode: "countdown" }), ...l } as LiveText) });
  return (
    <details className="rounded-md border border-white/10 p-2" open={!!live}>
      <summary className="cursor-pointer text-xs font-semibold text-white/70">⏱ Countdown &amp; auto deal badge</summary>
      <div className="mt-2 space-y-3">
        <Segmented<"off" | "countdown" | "deal">
          label="Live words"
          value={live?.mode ?? "off"}
          options={[
            { value: "off", label: "Off" },
            { value: "countdown", label: "Countdown" },
            { value: "deal", label: "Auto deal", title: "Fills in from Promotions" },
          ]}
          onChange={(m) => {
            if (m === "off") return set(null);
            const p = LIVE_PRESETS.find((x) => x.live.mode === m)!;
            patch({ live: m === "countdown" ? { mode: "countdown", daily: true } : { ...p.live }, text: box.text.includes("{") ? box.text : p.text, bind: null });
          }}
        />
        {live ? (
          <>
            <p className="text-[11px] leading-snug text-white/55">
              Type these into the words — they fill in and tick on the site:{" "}
              {LIVE_TOKENS.map((t) => (
                <button key={t} type="button" className="mr-1 rounded bg-white/10 px-1 font-mono text-[10px] text-[#ffd700] hover:bg-white/20" onClick={() => patch({ text: `${box.text}${box.text ? " " : ""}${t}`.trim() })} title={`Add ${t}`}>
                  {t}
                </button>
              ))}
              <br />
              {"{left}"} 3h 12m · {"{clock}"} 03:12:45 · {"{offer}"} 20% off · {"{deal}"} deal name · {"{ends}"} “Ends tonight”
            </p>
            {live.mode === "countdown" ? (
              <>
                <Segmented<"daily" | "date">
                  label="Count down to"
                  value={live.daily ? "daily" : "date"}
                  options={[
                    { value: "daily", label: "End of today", title: "Midnight store time — resets every day" },
                    { value: "date", label: "A date & time" },
                  ]}
                  onChange={(v) => set(v === "daily" ? { daily: true, to: undefined } : { daily: undefined, to: daysFromNow(1) })}
                />
                {!live.daily ? (
                  <Row label="Date & time (your time)">
                    <input
                      type="datetime-local"
                      className={studioInput}
                      value={toLocalInput(live.to)}
                      onChange={(e) => {
                        const t = new Date(e.target.value);
                        if (Number.isFinite(t.getTime())) set({ to: t.toISOString(), daily: undefined });
                      }}
                    />
                  </Row>
                ) : null}
              </>
            ) : (
              <Row label="Which deal">
                <select className={studioInput} value={live.promo ?? "today"} onChange={(e) => set({ promo: e.target.value })}>
                  <option value="today">Whatever deal is running right now</option>
                  {rules.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.title} — {offerLabelFor(r) || "deal"}
                      {r.weekday != null ? ` (${WD[r.weekday]})` : r.endsAt ? " (flash sale)" : ""}
                    </option>
                  ))}
                </select>
              </Row>
            )}
            <Row label="After it ends show">
              <input className={studioInput} value={live.expired ?? ""} maxLength={80} placeholder="(nothing — the badge disappears)" onChange={(e) => set({ expired: e.target.value || undefined })} />
            </Row>
            <p className="text-[11px] text-white/45">
              {live.mode === "deal"
                ? "Edit or publish deals in Promotions and every banner updates by itself. No deal running → the badge hides."
                : "Times use the store’s clock (Pacific). Visitors see it tick every second."}
            </p>
          </>
        ) : null}
      </div>
    </details>
  );
}

/** One-click live badges (pill text box with live words). */
export function LiveBadges({ design, onChange, onSelect }: { design: BannerDesign; onChange: (d: BannerDesign) => void; onSelect: (s: StudioSelection) => void }) {
  const full = design.boxes.length >= MAX_TEXT_BOXES;
  function add(i: number) {
    const p = LIVE_PRESETS[i];
    if (full) return;
    const box = defaultTextBox("badge", {
      id: nextId(design, `live-${p.id}`),
      text: p.text,
      live: { ...p.live, ...(p.live.mode === "countdown" && !p.live.daily ? { to: daysFromNow(3) } : {}) },
      x: 62,
      y: 8,
      w: 32,
      wrap: "nowrap",
      weight: 900,
    });
    onChange({ ...design, boxes: [...design.boxes, box], ...(design.order ? { order: [...design.order, box.id] } : {}) });
    onSelect({ target: "box", id: box.id });
  }
  return (
    <div className="space-y-2 rounded-lg border border-white/10 p-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-white/70">⏱ Countdown &amp; auto badges</span>
        <span className="text-[0.65rem] text-white/45">They tick live on the site</span>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {LIVE_PRESETS.map((p, i) => (
          <button key={p.id} type="button" disabled={full} onClick={() => add(i)} title={p.hint} className="rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-left text-[0.7rem] text-white/75 hover:border-[var(--admin-accent)] disabled:opacity-40">
            <span className="block font-semibold">{p.label}</span>
            <span className="block truncate font-mono text-[0.6rem] text-[#ffd700]/80">{p.text}</span>
          </button>
        ))}
      </div>
      {full ? <p className="text-[0.65rem] text-white/45">Banner has the most text boxes it can hold — remove one first.</p> : null}
    </div>
  );
}
