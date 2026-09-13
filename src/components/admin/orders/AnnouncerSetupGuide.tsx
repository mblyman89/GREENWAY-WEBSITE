/**
 * src/components/admin/orders/AnnouncerSetupGuide.tsx
 *
 * The speaker setup walkthrough, rendered where the owner actually stands.
 *
 * WHY THIS EXISTS
 * ---------------
 * The owner asked, verbatim:
 *
 *   "will you make sure the instructions for doing everything is included in
 *    the back office so I dont need to search everywhere to find the steps. I
 *    want them laid out for me in the back office... it should be in the
 *    online orders in the back office."
 *
 * Before this, the complete walkthrough existed only as Markdown files inside
 * the source repository. That is fine for a developer with a checkout and
 * useless for the person holding the Pi. This puts it on the Online Orders
 * page, next to the speaker cards it talks about.
 *
 * A SERVER component, and layout only. Every word, every command, and every
 * decision — including whether to tell him to pass a pairing code — was made
 * by announcer-setup-core.ts, which is pure, self-tested (53 checks) and
 * mutation-tested (8 mutants, 0 survivors). Nothing is decided here.
 *
 * THE ONE THING THIS SCREEN MUST GET RIGHT
 * ----------------------------------------
 * Every command shown is complete and copyable as-is, with the real site
 * address and the real pairing code already filled in. No placeholders. A
 * command you have to edit before running is a trap: it fails a few minutes
 * later with an error that looks like a hardware fault.
 */
import {
  SETUP_CHEAT_SHEET,
  SETUP_HARDWARE,
  buildSetupGuide,
} from "@/lib/announcer/announcer-setup-core";
import type { SetupCommand } from "@/lib/announcer/announcer-setup-core";
import { CopyCommandButton } from "./CopyCommandButton";

/** A command in a black box, with a button that copies the exact bytes. */
function CommandLine({ entry }: { entry: SetupCommand }) {
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

export function AnnouncerSetupGuide({
  siteUrl,
  pairingCode,
  hasPairedSpeaker,
}: {
  siteUrl: string;
  pairingCode: string | null;
  hasPairedSpeaker: boolean;
}) {
  const sections = buildSetupGuide({ siteUrl, pairingCode, hasPairedSpeaker });

  return (
    <details className="mt-3 rounded-[var(--admin-radius-lg)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/[0.06] px-3.5 py-3">
      <summary className="cursor-pointer text-sm font-bold text-[var(--admin-text)]">
        📖 Set up a speaker — full step-by-step guide
      </summary>

      {/* ── Read this first ──────────────────────────────────────────── */}
      <div className="mt-3 rounded-[var(--admin-radius-sm,8px)] border border-[var(--admin-border)] bg-[var(--admin-surface-1)] px-3 py-2.5">
        <p className="text-sm font-bold text-[var(--admin-text)]">
          Everything you need is on this page. You do not need to look anywhere else.
        </p>
        <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
          Work top to bottom. Every command below is already filled in with your real website
          address{pairingCode ? " and your live pairing code" : ""} — copy it exactly as it is and
          do not edit it. Each step tells you what you should see when it worked, and what to do
          when it does not.
        </p>
        {hasPairedSpeaker ? (
          <p className="mt-2 rounded-[var(--admin-radius-sm,8px)] border border-[var(--admin-accent)]/40 bg-[var(--admin-accent)]/10 px-2.5 py-2 text-xs font-bold text-[var(--admin-text)]">
            You already have a speaker paired. Do NOT delete it. Re-running the installer without a
            code keeps your existing setup — the steps below are written for that.
          </p>
        ) : null}
      </div>

      {/* ── The walkthrough ──────────────────────────────────────────── */}
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

      {/* ── Shopping list ────────────────────────────────────────────── */}
      <section className="mt-4">
        <h4 className="text-[0.72rem] font-bold uppercase tracking-[0.08em] text-[var(--admin-accent)]">
          What to buy
        </h4>
        <p className="mt-0.5 text-xs text-[var(--admin-text-muted)]">
          The two marked MUST BE RIGHT cause almost every &quot;the Pi turned itself off&quot;
          problem. The rest you can substitute.
        </p>
        <ul className="mt-2 space-y-2">
          {SETUP_HARDWARE.map((item) => (
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

      {/* ── Cheat sheet ──────────────────────────────────────────────── */}
      <section className="mt-4">
        <h4 className="text-[0.72rem] font-bold uppercase tracking-[0.08em] text-[var(--admin-accent)]">
          Commands worth keeping
        </h4>
        <p className="mt-0.5 text-xs text-[var(--admin-text-muted)]">
          Once it is running, these are the only commands you are likely to need again.
        </p>
        <div className="mt-1">
          {SETUP_CHEAT_SHEET.map((entry) => (
            <CommandLine key={entry.command} entry={entry} />
          ))}
        </div>
      </section>
    </details>
  );
}
