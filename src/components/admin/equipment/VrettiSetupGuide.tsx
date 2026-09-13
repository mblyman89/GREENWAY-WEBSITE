/**
 * src/components/admin/equipment/VrettiSetupGuide.tsx
 *
 * The vretti receipt-printer walkthrough, rendered where the owner stands.
 *
 * WHY THIS EXISTS
 * ---------------
 * The owner asked, verbatim:
 *
 *   "I need you to revamp the back office and make it all about the vretti and
 *    how to set it up and use it and all that. please be thorough and precise.
 *    step by step, hold my hand."
 *
 * A SERVER component, and LAYOUT ONLY. Every word, every command and every
 * decision — including what to do when no token exists yet — is made by
 * vretti-setup-core.ts, which is pure and self-tested. Nothing is decided here,
 * which is what lets the tests assert the content without rendering React.
 *
 * THE ONE THING THIS SCREEN MUST GET RIGHT
 * ----------------------------------------
 * Every command shown is complete and copyable as-is, with the real site
 * address and real token already filled in. A command you have to edit first
 * is a trap: it fails minutes later with an error that looks like a hardware
 * fault. When the token genuinely does not exist yet, the guide says so out
 * loud rather than printing a convincing fake.
 */
import {
  VRETTI_FACTS,
  PRINTER_HARDWARE,
  PRINTER_CHEAT_SHEET,
  PRINTER_TROUBLESHOOTING,
  buildPrinterSetupGuide,
  type PrinterSetupCommand,
} from "@/lib/printing/vretti-setup-core";
import { CopyCommandButton } from "@/components/admin/orders/CopyCommandButton";

/** A command in a black box, with a button that copies the exact bytes. */
function CommandLine({ entry }: { entry: PrinterSetupCommand }) {
  return (
    <div className="mt-2 rounded-[var(--admin-radius-sm,8px)] border border-[var(--admin-border)] bg-black/40 px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        {/*
          break-all, not truncate. A command that is visually cut off is a
          command somebody copies half of. It must all be on screen even on a
          phone, however ugly the wrap.
        */}
        <code className="min-w-0 break-all font-mono text-[0.78rem] leading-relaxed text-[var(--admin-accent)]">
          {entry.command}
        </code>
        <CopyCommandButton command={entry.command} />
      </div>
      <p className="mt-1 text-[0.68rem] text-[var(--admin-text-faint)]">{entry.purpose}</p>
    </div>
  );
}

export function VrettiSetupGuide({
  siteUrl,
  pollToken,
  hasPolled,
}: {
  siteUrl: string;
  pollToken: string | null;
  hasPolled: boolean;
}) {
  const sections = buildPrinterSetupGuide({ siteUrl, pollToken, hasPolled });
  const hasToken = Boolean((pollToken ?? "").trim());

  return (
    <details
      className="rounded-[var(--admin-radius-lg)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/[0.06] px-3.5 py-3"
      open={!hasPolled}
    >
      <summary className="cursor-pointer text-sm font-bold text-[var(--admin-text)]">
        📖 Set up the vretti printer — full step-by-step guide
      </summary>

      {/* ── Read this first ──────────────────────────────────────────────── */}
      <div className="mt-3 rounded-[var(--admin-radius-sm,8px)] border border-[var(--admin-border)] bg-[var(--admin-surface-1)] px-3 py-2.5">
        <p className="text-sm font-bold text-[var(--admin-text)]">
          Everything you need is on this page. You do not need to look anywhere else.
        </p>
        <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
          Work top to bottom. Every command below is already filled in with your real website
          address{hasToken ? " and your live printer token" : ""} — copy it exactly as it is and do
          not edit it. Each step tells you what you should see when it worked, and what to do when
          it does not.
        </p>
        {!hasToken ? (
          <p className="mt-2 rounded-[var(--admin-radius-sm,8px)] border border-[var(--admin-warning,#d99a2b)]/50 bg-[var(--admin-warning,#d99a2b)]/10 px-2.5 py-2 text-xs font-bold text-[var(--admin-text)]">
            You have no printer token yet, so nothing can print. Press “Generate token” in the
            Connection card above first — the commands below will then fill in the real value
            automatically.
          </p>
        ) : null}
      </div>

      {/* ── What this printer actually is ────────────────────────────────── */}
      <section className="mt-4">
        <h4 className="text-[0.72rem] font-bold uppercase tracking-[0.08em] text-[var(--admin-accent)]">
          What you have
        </h4>
        <p className="mt-0.5 text-xs text-[var(--admin-text-muted)]">
          The vretti is a plain USB printer. It has no web page and no setup app — the Raspberry Pi
          does all the talking to this website.
        </p>
        <dl className="mt-2 grid gap-1.5 sm:grid-cols-2">
          {VRETTI_FACTS.map((fact) => (
            <div
              key={fact.label}
              className="rounded-[var(--admin-radius-sm,8px)] border border-[var(--admin-border)] bg-[var(--admin-surface-1)] px-3 py-2"
            >
              <dt className="text-[0.62rem] font-bold uppercase tracking-wide text-[var(--admin-text-faint)]">
                {fact.label}
              </dt>
              <dd className="mt-0.5 font-mono text-[0.72rem] text-[var(--admin-text)]">
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ── The walkthrough ──────────────────────────────────────────────── */}
      {sections.map((section) => (
        <section key={section.id} className="mt-4">
          <h4 className="text-[0.72rem] font-bold uppercase tracking-[0.08em] text-[var(--admin-accent)]">
            {section.title}
          </h4>
          <p className="mt-0.5 text-xs text-[var(--admin-text-muted)]">{section.summary}</p>

          <ol className="mt-2 space-y-3">
            {section.steps.map((step) => (
              <li
                key={step.number}
                className="rounded-[var(--admin-radius-sm,8px)] border border-[var(--admin-border)] bg-[var(--admin-surface-1)] px-3 py-2.5"
              >
                <div className="flex items-baseline gap-2">
                  <span className="shrink-0 rounded-full bg-[var(--admin-accent)]/20 px-2 py-0.5 font-mono text-[0.7rem] font-bold text-[var(--admin-accent)]">
                    {step.number}
                  </span>
                  <h5 className="text-sm font-bold text-[var(--admin-text)]">{step.title}</h5>
                </div>

                <p className="mt-1.5 text-xs leading-relaxed text-[var(--admin-text-muted)]">
                  {step.body}
                </p>

                {step.commands.map((entry) => (
                  <CommandLine key={entry.command} entry={entry} />
                ))}

                {step.expect ? (
                  <p className="mt-2 text-[0.7rem] text-[var(--admin-text-muted)]">
                    <span className="font-bold text-[var(--admin-accent)]">✓ You should see: </span>
                    {step.expect}
                  </p>
                ) : null}

                {step.ifItGoesWrong ? (
                  <p className="mt-1 text-[0.7rem] text-[var(--admin-text-muted)]">
                    <span className="font-bold text-[var(--admin-warning,#d99a2b)]">
                      ⚠ If it goes wrong:{" "}
                    </span>
                    {step.ifItGoesWrong}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ))}

      {/* ── Shopping list ────────────────────────────────────────────────── */}
      <section className="mt-4">
        <h4 className="text-[0.72rem] font-bold uppercase tracking-[0.08em] text-[var(--admin-accent)]">
          What you need
        </h4>
        <p className="mt-0.5 text-xs text-[var(--admin-text-muted)]">
          The two marked MUST BE RIGHT cause almost every &quot;the printer is broken&quot; call.
        </p>
        <ul className="mt-2 space-y-2">
          {PRINTER_HARDWARE.map((item) => (
            <li
              key={item.item}
              className={`rounded-[var(--admin-radius-sm,8px)] border px-3 py-2 ${
                item.critical
                  ? "border-[var(--admin-warning,#d99a2b)]/50 bg-[var(--admin-warning,#d99a2b)]/10"
                  : "border-[var(--admin-border)] bg-[var(--admin-surface-1)]"
              }`}
            >
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-bold text-[var(--admin-text)]">{item.item}</span>
                <span className="font-mono text-[0.7rem] text-[var(--admin-text-faint)]">
                  {item.spec}
                </span>
                {item.critical ? (
                  <span className="rounded-full bg-[var(--admin-warning,#d99a2b)]/25 px-2 py-0.5 text-[0.62rem] font-bold uppercase tracking-wide text-[var(--admin-warning,#d99a2b)]">
                    Must be right
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 text-[0.7rem] leading-relaxed text-[var(--admin-text-muted)]">
                {item.why}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Troubleshooting ──────────────────────────────────────────────── */}
      <section className="mt-4">
        <h4 className="text-[0.72rem] font-bold uppercase tracking-[0.08em] text-[var(--admin-accent)]">
          When something is wrong
        </h4>
        <p className="mt-0.5 text-xs text-[var(--admin-text-muted)]">
          Find the symptom, not the cause. These are in order of how often they actually happen.
        </p>
        <ul className="mt-2 space-y-2">
          {PRINTER_TROUBLESHOOTING.map((row) => (
            <li
              key={row.symptom}
              className="rounded-[var(--admin-radius-sm,8px)] border border-[var(--admin-border)] bg-[var(--admin-surface-1)] px-3 py-2"
            >
              <p className="text-sm font-bold text-[var(--admin-text)]">{row.symptom}</p>
              <p className="mt-0.5 text-[0.7rem] leading-relaxed text-[var(--admin-text-muted)]">
                <span className="font-bold">Why: </span>
                {row.cause}
              </p>
              <p className="mt-0.5 text-[0.7rem] leading-relaxed text-[var(--admin-text-muted)]">
                <span className="font-bold text-[var(--admin-accent)]">Fix: </span>
                {row.fix}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Cheat sheet ──────────────────────────────────────────────────── */}
      <section className="mt-4">
        <h4 className="text-[0.72rem] font-bold uppercase tracking-[0.08em] text-[var(--admin-accent)]">
          Commands worth keeping
        </h4>
        <p className="mt-0.5 text-xs text-[var(--admin-text-muted)]">
          Once it is running, these are the only commands you are likely to need again.
        </p>
        <div className="mt-1">
          {PRINTER_CHEAT_SHEET.map((entry) => (
            <CommandLine key={entry.command} entry={entry} />
          ))}
        </div>
      </section>
    </details>
  );
}
