/**
 * R41 S2: the one "ACH settings do not match Timberland" notice. Every page
 * that can start an ACH file shows the SAME list of problems that
 * originatorReadiness() returned, so the page and the builder never disagree.
 */
import Link from "next/link";

export function OriginatorNotReady({ problems, tail }: { problems: readonly string[]; tail?: string }) {
  if (!problems.length) return null;
  return (
    <div
      role="alert"
      className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)] bg-[var(--admin-danger-soft,rgba(220,38,38,0.08))] px-4 py-3 text-sm text-[var(--admin-danger)]"
    >
      <p className="font-semibold">The company ACH settings do not match Timberland&apos;s setup, so no ACH file can be made.</p>
      <ul className="mt-1 list-disc pl-5">
        {problems.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      <p className="mt-1">
        Fix them on{" "}
        <Link href="/admin/settings/banking?tab=company" className="underline">
          Banking &gt; My banking
        </Link>
        {tail ? ` ${tail}` : "."}
      </p>
    </div>
  );
}
