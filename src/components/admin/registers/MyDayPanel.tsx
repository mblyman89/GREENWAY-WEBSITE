/**
 * MyDayPanel (D185, round slice S8): "this is the step you are on".
 *
 * A server component. The full form (on /admin/registers/my-day) shows every
 * shift's list; the compact form (admin home) shows only the headline, the
 * loud steps and the one step to do next, with a link to the full list.
 * Read-only: every step links to the screen where the work is done.
 */
import Link from "next/link";
import { myDayNow } from "@/lib/registers/role-checklist-store";
import { MY_DAY_PAGE, SHIFT_LABELS, type MyDay, type RoleStep, type ShiftBlock } from "@/lib/registers/role-checklist-core";

const ICON: Record<RoleStep["state"], string> = { done: "\u2705", todo: "\u25fb\ufe0f", loud: "\ud83d\udea8", unknown: "\u2753" };

export function MyDayPanel({ day, isOwner, compact = false }: { day: MyDay; isOwner: boolean; compact?: boolean }) {
  const tone = day.loud.length
    ? "border-[var(--admin-danger)]/60 bg-[var(--admin-danger)]/10"
    : day.shiftDone
      ? "border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)]"
      : "border-[var(--admin-gold)]/60 bg-[var(--admin-gold-soft)]";

  if (compact && day.shiftDone && !day.loud.length) return null;

  return (
    <section data-testid="my-day" aria-label="My day" className="space-y-3">
      <div role={day.loud.length ? "alert" : "status"} data-testid="my-day-headline" className={`rounded-[var(--admin-radius)] border-2 px-4 py-3 ${tone}`}>
        <p className="text-xs font-bold uppercase tracking-wide text-[var(--admin-text-muted)]">
          My day · now: {SHIFT_LABELS[day.now]}
        </p>
        <p className={`mt-1 text-base font-bold ${day.loud.length ? "text-[var(--admin-danger)]" : day.shiftDone ? "text-[var(--admin-accent)]" : "text-[var(--admin-text)]"}`}>
          {day.shiftDone && !day.loud.length ? "\ud83c\udf89 " : ""}
          {day.headline}
        </p>
        {day.loud.length ? (
          <ul className="mt-2 space-y-1 text-sm" data-testid="my-day-loud">
            {day.loud.map((s) => (
              <li key={s.key}>
                {ICON.loud}{" "}
                <Link href={s.href} className="font-semibold underline">
                  {s.text}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        {day.next && !day.loud.length ? (
          <p className="mt-2 text-sm" data-testid="my-day-next">
            👉{" "}
            <Link href={day.next.href} className="font-semibold underline">
              Do this now: {day.next.text}
            </Link>
          </p>
        ) : null}
        {compact ? (
          <p className="mt-2 text-xs">
            <Link href={MY_DAY_PAGE} className="underline">
              See the whole list for every shift
            </Link>
          </p>
        ) : null}
      </div>
      {compact ? null : day.blocks.map((b) => <Block key={b.shift} block={b} isNow={b.shift === day.now} nextKey={day.next?.key ?? null} isOwner={isOwner} />)}
    </section>
  );
}

function Block({ block, isNow, nextKey, isOwner }: { block: ShiftBlock; isNow: boolean; nextKey: string | null; isOwner: boolean }) {
  return (
    <div
      data-testid={`my-day-${block.shift}`}
      className={`rounded-[var(--admin-radius)] border px-4 py-3 ${isNow ? "border-2 border-[var(--admin-accent)]/60" : "border-[var(--admin-border)]"}`}
    >
      <p className="text-sm font-bold text-[var(--admin-text)]">
        {block.label}
        {isNow ? " · now" : ""}
        {block.shift === "owner" && isOwner ? " (you)" : ""}
        <span className={`ml-2 text-xs font-semibold ${block.done ? "text-[var(--admin-accent)]" : "text-[var(--admin-text-muted)]"}`}>
          {block.done ? "\u2705 Done" : `${block.open} left`}
        </span>
      </p>
      <ol className="mt-2 space-y-1 text-sm">
        {block.steps.map((s) => {
          const isNext = s.key === nextKey;
          return (
            <li
              key={s.key}
              data-state={s.state}
              className={`flex items-start gap-2 ${s.state === "done" ? "text-[var(--admin-text-faint)]" : s.state === "loud" ? "font-semibold text-[var(--admin-danger)]" : "text-[var(--admin-text)]"}`}
            >
              <span aria-hidden className="w-5 shrink-0 text-center">{isNext && s.state !== "done" ? "\ud83d\udc49" : ICON[s.state]}</span>
              <span className={isNext ? "font-semibold" : ""}>
                {s.state === "done" ? (
                  s.text
                ) : (
                  <Link href={s.href} className="underline decoration-dotted underline-offset-2">
                    {s.text}
                  </Link>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** The admin-home version: reads the live facts itself; hidden when the shift is done and nothing is loud. */
export async function MyDayHomePanel({ isOwner }: { isOwner: boolean }) {
  const { day } = await myDayNow();
  return <MyDayPanel day={day} isOwner={isOwner} compact />;
}
