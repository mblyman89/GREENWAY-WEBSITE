import Link from "next/link";

type Accent = "green" | "gold" | "orange" | "muted";

const ACCENTS: Record<Accent, string> = {
  green: "text-[#7ed957]",
  gold: "text-[#ffd700]",
  orange: "text-[#ff7f00]",
  muted: "text-white/70",
};

export function StatCard({
  label,
  value,
  hint,
  accent = "muted",
  href,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  accent?: Accent;
  href?: string;
}) {
  const inner = (
    <div className="rounded-xl border border-white/10 bg-[#0a0a0a] p-5 transition hover:border-white/25">
      <p className="text-xs font-medium uppercase tracking-wide text-white/45">
        {label}
      </p>
      <p className={`mt-2 text-3xl font-bold ${ACCENTS[accent]}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-white/40">{hint}</p>}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}
