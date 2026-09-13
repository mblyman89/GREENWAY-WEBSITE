import { HelpPanel, EmptyState } from "@/components/admin/ux";
import { StatCard } from "@/components/admin/StatCard";
import { Badge, Button, Card, Field, Input, Select, Textarea } from "@/components/admin/ui";
import {
  getPrinterSettings,
  listRecentJobs,
  isPrinterOnline,
  formatReceiptTimestamp,
  type ReceiptJobStatus,
} from "@/lib/printing/printer-store";
import {
  savePrinterSettingsAction,
  rotatePollTokenAction,
  testPrintAction,
  cancelJobAction,
  requeueJobAction,
} from "@/app/admin/equipment/printer-actions";
import { getPrinterDiagnostics } from "@/lib/printing/printer-assistant";
import { isAiConfigured } from "@/lib/ai/provider";
import { PrinterDiagnosticChat } from "@/components/admin/settings/PrinterDiagnosticChat";
import type { DiagnosticSeverity } from "@/lib/printing/printer-diagnostics-core";
import { VrettiSetupGuide } from "./VrettiSetupGuide";
import { buildTestPrintBody } from "@/lib/printing/receipt-escpos-core";
import { getPosReceiptConfig } from "@/lib/pos/receipt-config-store";

/** Severity → dark-token alert styling (no light red-50/orange-50 surfaces). */
function severityStyles(sev: DiagnosticSeverity): { box: string; dot: string; label: string } {
  switch (sev) {
    case "error":
      return {
        box: "border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)]",
        dot: "bg-[var(--admin-danger)]",
        label: "text-[var(--admin-danger)]",
      };
    case "warning":
      return {
        box: "border-[var(--admin-orange)]/40 bg-[var(--admin-orange-soft)]",
        dot: "bg-[var(--admin-orange)]",
        label: "text-[var(--admin-orange)]",
      };
    case "info":
      return {
        box: "border-[var(--admin-border-strong)] bg-[var(--admin-surface-2)]",
        dot: "bg-[var(--admin-text-muted)]",
        label: "text-[var(--admin-text)]",
      };
    default:
      return {
        box: "border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)]",
        dot: "bg-[var(--admin-accent)]",
        label: "text-[var(--admin-accent)]",
      };
  }
}

function jobTone(status: ReceiptJobStatus): "green" | "gold" | "orange" | "neutral" | "danger" {
  if (status === "printed") return "green";
  if (status === "printing") return "gold";
  if (status === "queued") return "neutral";
  if (status === "failed") return "danger";
  return "orange";
}

export type PrinterPanelBanners = {
  saved?: string;
  token?: string;
  test?: string;
  error?: string;
};

/**
 * The full receipt-printer management UI — setup guide, live diagnostics,
 * poll-token rotation, test print, settings form, AI assistant, and recent
 * jobs. Rendered inside the Equipment page's "Receipt Printer" tab so all
 * hardware management lives in one location.
 */
export async function ReceiptPrinterPanel({ banners }: { banners: PrinterPanelBanners }) {
  const [settings, jobs, diag, receiptConfig] = await Promise.all([
    getPrinterSettings(),
    listRecentJobs(25),
    getPrinterDiagnostics(),
    // Never let a settings read cost us the whole page: the preview degrades
    // to built-in defaults rather than throwing.
    getPosReceiptConfig().catch(() => null),
  ]);
  const online = isPrinterOnline(settings?.last_poll_at ?? null);

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
  const pollUrl = siteUrl ? `${siteUrl}/api/cloudprnt` : "/api/cloudprnt";

  const queuedCount = jobs.filter((j) => j.status === "queued").length;
  const failedCount = jobs.filter((j) => j.status === "failed").length;
  const printedToday = jobs.filter(
    (j) =>
      j.status === "printed" &&
      j.printed_at &&
      new Date(j.printed_at).toDateString() === new Date().toDateString(),
  ).length;

  // The preview is built by the SAME renderer the printer receives, using the
  // owner's real settings, so what is shown here is what comes out of the
  // machine. A fixed timestamp is used so the preview does not change on every
  // page load for no reason.
  const receiptPreview = buildTestPrintBody({
    columns: settings?.paper_columns,
    headerText: settings?.header_text ?? receiptConfig?.headerText ?? null,
    footerText: settings?.footer_text ?? receiptConfig?.footerText ?? null,
    addressText: receiptConfig?.addressText ?? null,
    placedAt: "2024-01-15T21:05:00.000Z",
    note: "Sample preview \u2014 a real order shows the customer's note here.",
  });

  const codeCls =
    "mt-1 block break-all rounded-[var(--admin-radius-sm)] bg-[var(--admin-surface-2)] px-2 py-1 text-[var(--admin-text)]";
  const inlineCode = "rounded bg-[var(--admin-surface-2)] px-1 text-[var(--admin-text)]";
  const detailsCls =
    "rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3";
  const summaryCls = "cursor-pointer font-semibold text-[var(--admin-text)]";
  const olCls = "mt-2 list-decimal space-y-1 pl-5 text-[13px] text-[var(--admin-text-muted)]";

  return (
    <div className="space-y-6">
      {banners.saved && (
        <Card className="border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] p-4 text-sm text-[var(--admin-accent)]">
          Settings saved.
        </Card>
      )}
      {banners.token && (
        <Card className="border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] p-4 text-sm text-[var(--admin-accent)]">
          New poll token generated. Re-enter it in the printer&rsquo;s setup utility.
        </Card>
      )}
      {banners.test && (
        <Card className="border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] p-4 text-sm text-[var(--admin-accent)]">
          Test print queued. It will print at the printer&rsquo;s next poll (usually within a few seconds).
        </Card>
      )}
      {banners.error && (
        <Card className="border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] p-4 text-sm text-[var(--admin-danger)]">
          {banners.error}
        </Card>
      )}

      <HelpPanel
        id="receipt-printer-help"
        title="How the receipt printer works"
        steps={[
          "Your printer is a vretti 80mm USB thermal printer. It plugs into the Raspberry Pi by USB \u2014 it has no network port, no web page and no setup app of its own.",
          "The Pi runs a small service that checks this website every few seconds and prints whatever is waiting. The printer only ever hears from the Pi.",
          "Generate a Poll token below, then run the one installer command on the Pi (full step-by-step guide is on this page).",
          "Press \u2018Send test print\u2019. After that every online pickup order prints automatically, laid out exactly like a receipt from the register.",
        ]}
      />

      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard
          label="Printer status"
          value={online ? "Online" : "Not seen"}
          hint={settings?.last_poll_at ? `Last poll ${formatReceiptTimestamp(settings.last_poll_at)}` : "Never polled"}
          accent={online ? "green" : "muted"}
        />
        <StatCard label="Queued now" value={String(queuedCount)} accent={queuedCount > 0 ? "gold" : "muted"} />
        <StatCard
          label="Failed"
          value={String(failedCount)}
          hint={failedCount > 0 ? "Gave up after repeated attempts — see the queue below" : undefined}
          accent={failedCount > 0 ? "orange" : "muted"}
        />
        <StatCard label="Printed today" value={String(printedToday)} accent="green" />
      </div>

      {/* Live diagnostics — deterministic checks against the real state. */}
      <Card className="p-5">
        <h2 className="mb-1 text-sm font-semibold text-[var(--admin-text)]">Live diagnostics</h2>
        <p className="mb-3 text-xs text-[var(--admin-text-muted)]">
          Automatic checks against the printer&apos;s current status. Fix anything flagged in red
          or orange first.
        </p>
        <div className="space-y-2">
          {diag.findings.map((f, i) => {
            const st = severityStyles(f.severity);
            return (
              <div key={i} className={`flex gap-3 rounded-[var(--admin-radius)] border px-3 py-2 ${st.box}`}>
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${st.dot}`} aria-hidden />
                <div>
                  <div className={`text-sm font-semibold ${st.label}`}>{f.title}</div>
                  <div className="text-xs text-[var(--admin-text-muted)]">{f.detail}</div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Connection details */}
      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold text-[var(--admin-text)]">Connection</h2>
        <div className="space-y-3 text-sm">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-[var(--admin-text-faint)]">Poll URL (the Pi checks this address)</div>
            <code className={codeCls}>{pollUrl}</code>
            {!siteUrl && (
              <p className="mt-1 text-xs text-[var(--admin-orange)]">
                Set <code>NEXT_PUBLIC_SITE_URL</code> to your public site URL so this shows the full address (e.g. https://greenway&hellip; ).
              </p>
            )}
          </div>
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-[var(--admin-text-faint)]">Poll token (the Pi&rsquo;s password)</div>
            <code className={codeCls}>{settings?.poll_token ?? "\u2014 not set \u2014"}</code>
            {!settings?.poll_token && (
              <p className="mt-1 text-xs text-[var(--admin-orange)]">
                No token yet &mdash; nothing can print until you generate one. Press the button below,
                then follow the setup guide on this page.
              </p>
            )}
            <form action={rotatePollTokenAction} className="mt-2">
              <Button type="submit" variant="neutral" size="sm">
                {settings?.poll_token ? "Rotate token" : "Generate token"}
              </Button>
            </form>
            {settings?.poll_token && (
              <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
                Rotating takes effect immediately, so the Pi stops printing until you re-pair it with
                the new token.
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-[var(--admin-text-faint)]">Pi last seen as</span>
            <Badge tone="neutral">{settings?.printer_mac ?? "not seen yet"}</Badge>
          </div>
          <form action={testPrintAction}>
            <Button type="submit" variant="save" size="sm">Send test print</Button>
          </form>
        </div>
      </Card>

      {/* Settings form */}
      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold text-[var(--admin-text)]">Settings</h2>
        <form action={savePrinterSettingsAction} className="space-y-4">
          <Field label="Printer label" help="A friendly name for this device.">
            <Input name="printer_label" defaultValue={settings?.printer_label ?? "Front counter receipt printer"} />
          </Field>
          <Field label="Auto-print online orders" help="Queue a receipt automatically whenever an online pickup order is placed.">
            <label className="flex items-center gap-2 text-sm text-[var(--admin-text-muted)]">
              <input
                type="checkbox"
                name="auto_print_orders"
                defaultChecked={settings?.auto_print_orders ?? true}
                className="h-4 w-4"
              />
              Print a receipt on every new online order
            </label>
          </Field>
          <Field label="Paper width" help="The vretti is an 80mm printer, so leave this on 48 columns unless you have deliberately loaded narrower paper.">
            <Select name="paper_columns" defaultValue={String(settings?.paper_columns ?? 48)}>
              <option value="48">80mm (48 columns) &mdash; the vretti</option>
              <option value="32">58mm (32 columns)</option>
            </Select>
          </Field>
          <Field label="Receipt header" help="Printed centered at the top. Leave blank to use the header from your register receipt settings.">
            <Textarea name="header_text" rows={2} defaultValue={settings?.header_text ?? ""} />
          </Field>
          <Field label="Receipt footer" help="Printed centered at the bottom. Leave blank to use the footer from your register receipt settings.">
            <Textarea name="footer_text" rows={2} defaultValue={settings?.footer_text ?? ""} />
          </Field>
          <Button type="submit" variant="save" size="sm">Save settings</Button>
        </form>
      </Card>

      {/* What a receipt will actually look like */}
      <Card className="p-5">
        <h2 className="mb-1 text-sm font-semibold text-[var(--admin-text)]">
          What a receipt looks like
        </h2>
        <p className="mb-3 text-xs text-[var(--admin-text-muted)]">
          This is the exact text that gets sent to the printer &mdash; character for character, at
          your current paper width. Online pickup orders now print in the{" "}
          <strong>same style as a sale at the register</strong>: the same item detail line, the same
          separate excise and sales-tax rows, the same savings and return policy. Change the wording
          or the toggles under{" "}
          <strong>Point of Sale &rarr; Receipt settings</strong> and this preview follows.
        </p>
        <pre className="overflow-x-auto rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-black/40 px-3 py-3 font-mono text-[11px] leading-[1.45] text-[var(--admin-text)]">
{receiptPreview}
        </pre>
        <p className="mt-2 text-xs text-[var(--admin-text-muted)]">
          A real order also shows the customer&apos;s name, phone and any note they left for staff.
        </p>
      </Card>

      {/*
        The full vretti walkthrough. Content comes entirely from the pure,
        self-tested vretti-setup-core; this is only where it is mounted.
      */}
      <VrettiSetupGuide
        siteUrl={siteUrl}
        pollToken={settings?.poll_token ?? null}
        hasPolled={Boolean(settings?.last_poll_at)}
      />

      {/* How it works & security */}
      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold text-[var(--admin-text)]">How it works &amp; security</h2>
        <div className="space-y-3 text-sm text-[var(--admin-text-muted)]">
          <details className={detailsCls} open>
            <summary className={summaryCls}>What actually talks to what</summary>
            <ol className={olCls}>
              <li>An online order is placed, and a receipt is queued here on the website.</li>
              <li>The <strong>Raspberry Pi</strong> checks <code className={inlineCode}>/api/cloudprnt</code> every few seconds. That check is the &ldquo;Last poll&rdquo; heartbeat on the status card above.</li>
              <li>When a receipt is waiting, the Pi downloads it as plain text, converts it to ESC/POS (the language this printer speaks) and writes it to <code className={inlineCode}>/dev/usb/lp0</code> &mdash; the printer on the end of the USB cable.</li>
              <li>The Pi then confirms the job, which is what moves it to &ldquo;printed&rdquo; in the queue below.</li>
            </ol>
            <p className="mt-2 text-[13px]">
              The printer itself is never on the network. If the internet drops, jobs simply wait in
              the queue and print when the Pi reconnects.
            </p>
          </details>
          <details className={detailsCls}>
            <summary className={summaryCls}>About the poll token</summary>
            <p className="mt-2 text-[13px] text-[var(--admin-text-muted)]">
              The <strong>Poll token</strong> is the password the Pi sends on every request. A wrong
              token gets a 401 and nothing prints. Treat it like any other password &mdash; anyone
              holding it could send print jobs to your shop.
            </p>
            <p className="mt-2 text-[13px] text-[var(--admin-text-muted)]">
              Rotating the token takes effect <strong>immediately</strong>, so the Pi will stop
              printing until you re-run the pairing command with the new token (Step 6 in the guide
              above). That is deliberate: it is how you cut off a token you think has leaked.
            </p>
          </details>
        </div>
      </Card>

      {/* AI diagnostic assistant */}
      <Card className="p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-[var(--admin-text)]">Diagnostic assistant</h2>
          <Badge tone={isAiConfigured ? "green" : "neutral"}>{isAiConfigured ? "AI ready" : "AI not configured"}</Badge>
        </div>
        <p className="mb-3 text-xs text-[var(--admin-text-muted)]">
          Describe the problem in plain language. The assistant is grounded on this exact printer
          setup and your printer&apos;s live status &mdash; it won&apos;t invent settings.
        </p>
        <PrinterDiagnosticChat aiEnabled={isAiConfigured} />
      </Card>

      {/* Recent jobs */}
      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold text-[var(--admin-text)]">Recent print jobs</h2>
        {jobs.length === 0 ? (
          <EmptyState title="No print jobs yet" description="Receipts will appear here once orders arrive or you send a test print." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                  <th className="px-2 py-1">Job</th>
                  <th className="px-2 py-1">Status</th>
                  <th className="px-2 py-1">Queued</th>
                  <th className="px-2 py-1">Printed</th>
                  <th className="px-2 py-1"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--admin-border)]">
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td className="px-2 py-2 text-[var(--admin-text)]">
                      {j.title ?? j.order_number ?? "Receipt"}
                      {j.status === "failed" && j.error_note && (
                        <div className="mt-0.5 text-xs text-[var(--admin-orange)]">{j.error_note}</div>
                      )}
                    </td>
                    <td className="px-2 py-2"><Badge tone={jobTone(j.status)}>{j.status}</Badge></td>
                    <td className="px-2 py-2 text-[var(--admin-text-muted)]">{formatReceiptTimestamp(j.queued_at)}</td>
                    <td className="px-2 py-2 text-[var(--admin-text-muted)]">{j.printed_at ? formatReceiptTimestamp(j.printed_at) : "\u2014"}</td>
                    <td className="px-2 py-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {j.status === "failed" && (
                          <form action={requeueJobAction}>
                            <input type="hidden" name="job_id" value={j.id} />
                            <Button type="submit" variant="save" size="sm">Re-queue</Button>
                          </form>
                        )}
                        {(j.status === "queued" || j.status === "failed") && (
                          <form action={cancelJobAction}>
                            <input type="hidden" name="job_id" value={j.id} />
                            <Button type="submit" variant="neutral" size="sm">Cancel</Button>
                          </form>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
