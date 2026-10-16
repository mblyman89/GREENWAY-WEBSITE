"use client";

/**
 * R59-S2 — "Entrance" controls for one text box, button, shape or icon:
 * 18 effects in 4 groups, delay, length and feel, ▶ preview. Written only when
 * an effect is chosen (designs without entrances stay byte-identical).
 */
import { ENTER_EASES, ENTER_FX, ENTER_LIMITS, enterDur, normalizeEnter, type Enter, type EnterEase, type EnterFx } from "@/lib/cms/banner-enter-core";
import { NumberSlider, Segmented } from "./controls";

/** Ask the Studio to replay entrances + smoke (BannerStudio listens). */
export const studioReplay = () => window.setTimeout(() => window.dispatchEvent(new Event("gw-studio-replay")), 30);

const chip = (on: boolean) =>
  on
    ? "rounded-[var(--admin-radius-sm)] bg-[var(--admin-accent-soft)] px-2 py-1 text-xs font-semibold text-[var(--admin-accent)] ring-1 ring-[var(--admin-accent)]/40"
    : "rounded-[var(--admin-radius-sm)] bg-black/30 px-2 py-1 text-xs text-white/70 hover:bg-white/10";
const GROUPS = [...new Set(ENTER_FX.map((f) => f.group))];

export function EnterFields({ enter, onChange, reveal }: { enter?: Enter; onChange: (e: Enter | undefined) => void; reveal?: number }) {
  const set = (p: Partial<Enter> | null) => {
    const next = p === null ? undefined : normalizeEnter({ ...(enter ?? { fx: "rise" }), ...p });
    onChange(next);
    if (next) studioReplay();
  };
  return (
    <details className="rounded-md border border-white/10 p-2" open={!!enter}>
      <summary className="cursor-pointer text-[0.7rem] font-semibold uppercase tracking-wide text-white/60">
        ✨ Entrance {enter ? `— ${ENTER_FX.find((f) => f.id === enter.fx)?.label}` : "(none)"}
      </summary>
      <div className="mt-2 space-y-2">
        <div className="flex flex-wrap gap-1">
          <button type="button" className={chip(!enter)} onClick={() => set(null)}>
            None
          </button>
        </div>
        {GROUPS.map((g) => (
          <div key={g}>
            <p className="mb-1 text-[0.65rem] text-white/45">{g}</p>
            <div className="flex flex-wrap gap-1">
              {ENTER_FX.filter((f) => f.group === g).map((f) => (
                <button key={f.id} type="button" className={chip(enter?.fx === f.id)} onClick={() => set({ fx: f.id as EnterFx, dur: undefined })}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        ))}
        {enter ? (
          <>
            <NumberSlider
              label="Wait before it starts"
              value={enter.delay ?? 0}
              min={0}
              max={ENTER_LIMITS.delayMax}
              step={0.05}
              unit="s"
              onChange={(v) => set({ delay: v })}
              hint={reveal ? `Counted after the ${reveal}s words-wait / curtain.` : "Stagger items by giving each a little more wait."}
            />
            <NumberSlider label="Length" value={enterDur(enter)} min={ENTER_LIMITS.durMin} max={ENTER_LIMITS.durMax} step={0.05} unit="s" onChange={(v) => set({ dur: v })} />
            {enter.fx !== "type" && enter.fx !== "glitch" && enter.fx !== "neon" ? (
              <Segmented<EnterEase> label="Feel" value={enter.ease ?? "smooth"} options={ENTER_EASES.map((e) => ({ value: e.id, label: e.label }))} onChange={(v) => set({ ease: v })} />
            ) : null}
            <button type="button" onClick={studioReplay} className="rounded-full bg-[var(--admin-accent)] px-3 py-1 text-xs font-bold text-black">
              ▶ Preview
            </button>
          </>
        ) : null}
        <p className="text-[0.65rem] text-white/45">Plays when the slide shows (every time the carousel comes back to it). Visitors who ask for less motion see it already in place.</p>
      </div>
    </details>
  );
}
