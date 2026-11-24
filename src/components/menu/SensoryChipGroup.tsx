"use client";

/**
 * USAGE-10d: the PDP sensory pills (Experience / Terpenes / Aroma / Flavor).
 * As a server tree every pill put a ~110-byte class string and an inline
 * style object into the page's RSC payload; as a client component each group
 * ships only {label, chips, accent}. SSR HTML identical.
 */
export function ChipGroup({ label, chips, accent }: { label: string; chips: string[]; accent: string }) {
  if (!chips.length) return null;
  return (
    <div>
      <p className="text-[0.62rem] font-black uppercase tracking-[0.22em] text-zinc-500">{label}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {chips.map((chip) => (
          <span
            key={`${label}-${chip}`}
            className="inline-flex items-center rounded-full border px-2.5 py-1 text-[0.72rem] font-semibold capitalize text-zinc-200"
            style={{ borderColor: accent, backgroundColor: "rgba(255,255,255,0.04)" }}
          >
            {chip}
          </span>
        ))}
      </div>
    </div>
  );
}
