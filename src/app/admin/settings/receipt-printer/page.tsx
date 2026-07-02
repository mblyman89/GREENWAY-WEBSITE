import { requirePermission } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Breadcrumbs, HelpPanel, EmptyState } from "@/components/admin/ux";
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
} from "./actions";
import { getPrinterDiagnostics } from "@/lib/printing/printer-assistant";
import { isAiConfigured } from "@/lib/ai/provider";
import { PrinterDiagnosticChat } from "@/components/admin/settings/PrinterDiagnosticChat";
import type { DiagnosticSeverity } from "@/lib/printing/printer-diagnostics-core";

export const dynamic = "force-dynamic";

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

export default async function ReceiptPrinterSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; token?: string; test?: string; error?: string }>;
}) {
  await requirePermission("settings.manage");
  const sp = await searchParams;

  const [settings, jobs, diag] = await Promise.all([
    getPrinterSettings(),
    listRecentJobs(25),
    getPrinterDiagnostics(),
  ]);
  const online = isPrinterOnline(settings?.last_poll_at ?? null);

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
  const pollUrl = siteUrl ? `${siteUrl}/api/cloudprnt` : "/api/cloudprnt";

  const queuedCount = jobs.filter((j) => j.status === "queued").length;
  const printedToday = jobs.filter(
    (j) =>
      j.status === "printed" &&
      j.printed_at &&
      new Date(j.printed_at).toDateString() === new Date().toDateString(),
  ).length;

  const codeCls =
    "mt-1 block break-all rounded-[var(--admin-radius-sm)] bg-[var(--admin-surface-2)] px-2 py-1 text-[var(--admin-text)]";
  const inlineCode = "rounded bg-[var(--admin-surface-2)] px-1 text-[var(--admin-text)]";
  const detailsCls =
    "rounded-[var(--admin-radius)] border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3";
  const summaryCls = "cursor-pointer font-semibold text-[var(--admin-text)]";
  const listCls = "mt-2 list-disc space-y-1 pl-5 text-[13px] text-[var(--admin-text-muted)]";
  const olCls = "mt-2 list-decimal space-y-1 pl-5 text-[13px] text-[var(--admin-text-muted)]";

  return (
    <div>
      <AdminPageHeader
        title="Receipt Printer"
        subtitle="Star Micronics TSP143IV via CloudPRNT — auto-prints online pickup orders"
        breadcrumbs={<Breadcrumbs items={[{ label: "Settings" }, { label: "Receipt Printer" }]} />}
      />

      <div className="space-y-6 px-5 py-6 sm:px-8">
        {sp.saved && (
          <Card className="border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] p-4 text-sm text-[var(--admin-accent)]">
            Settings saved.
          </Card>
        )}
        {sp.token && (
          <Card className="border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] p-4 text-sm text-[var(--admin-accent)]">
            New poll token generated. Re-enter it in the printer’s setup utility.
          </Card>
        )}
        {sp.test && (
          <Card className="border-[var(--admin-accent)]/40 bg-[var(--admin-accent-soft)] p-4 text-sm text-[var(--admin-accent)]">
            Test print queued. It will print at the printer’s next poll (usually within a few seconds).
          </Card>
        )}
        {sp.error && (
          <Card className="border-[var(--admin-danger)]/40 bg-[var(--admin-danger-soft)] p-4 text-sm text-[var(--admin-danger)]">
            {sp.error}
          </Card>
        )}

        <HelpPanel
          id="receipt-printer-help"
          title="How the receipt printer works"
          steps={[
            "Buy the recommended printer: Star Micronics TSP143IV (Ethernet + USB-C, CloudPRNT). Part # 39473010 (gray) or 39473110 (white).",
            "Plug it into the store router with the included Ethernet cable and power it on.",
            "In the printer’s Star Quick Setup Utility, set the CloudPRNT Server URL to the Poll URL shown below, and set the password to the Poll Token below (rotate one if empty).",
            "Click ‘Send test print’. It prints at the next poll. After that, every online pickup order prints automatically (if auto-print is on).",
          ]}
        />

        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            label="Printer status"
            value={online ? "Online" : "Not seen"}
            hint={settings?.last_poll_at ? `Last poll ${formatReceiptTimestamp(settings.last_poll_at)}` : "Never polled"}
            accent={online ? "green" : "muted"}
          />
          <StatCard label="Queued now" value={String(queuedCount)} accent={queuedCount > 0 ? "gold" : "muted"} />
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
              <div className="text-xs font-medium uppercase tracking-wide text-[var(--admin-text-faint)]">Poll URL (set in printer)</div>
              <code className={codeCls}>{pollUrl}</code>
              {!siteUrl && (
                <p className="mt-1 text-xs text-[var(--admin-orange)]">
                  Set <code>NEXT_PUBLIC_SITE_URL</code> to your public site URL so this shows the full address (e.g. https://greenway… ).
                </p>
              )}
            </div>
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-[var(--admin-text-faint)]">Poll token (printer password)</div>
              <code className={codeCls}>{settings?.poll_token ?? "— not set —"}</code>
              <form action={rotatePollTokenAction} className="mt-2">
                <Button type="submit" variant="neutral" size="sm">
                  {settings?.poll_token ? "Rotate token" : "Generate token"}
                </Button>
              </form>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-[var(--admin-text-faint)]">Registered MAC</span>
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
            <Field label="Paper width" help="TSP143IV ships with 80mm paper (48 columns).">
              <Select name="paper_columns" defaultValue={String(settings?.paper_columns ?? 48)}>
                <option value="48">80mm (48 columns)</option>
                <option value="32">58mm (32 columns)</option>
              </Select>
            </Field>
            <Field label="Receipt header" help="Printed centered at the top. Leave blank for the default store name.">
              <Textarea name="header_text" rows={2} defaultValue={settings?.header_text ?? ""} />
            </Field>
            <Field label="Receipt footer" help="Printed centered at the bottom (e.g. hours, thank-you).">
              <Textarea name="footer_text" rows={2} defaultValue={settings?.footer_text ?? ""} />
            </Field>
            <Button type="submit" variant="save" size="sm">Save settings</Button>
          </form>
        </Card>

        {/* Detailed end-to-end setup guide */}
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-[var(--admin-text)]">Full setup guide (end to end)</h2>
          <div className="space-y-3 text-sm text-[var(--admin-text-muted)]">
            <details className={detailsCls} open>
              <summary className={summaryCls}>1. Hardware &amp; paper</summary>
              <ul className={listCls}>
                <li>Printer: Star Micronics <strong>TSP143IV</strong> (native CloudPRNT). Part 39473010 gray / 39473110 white.</li>
                <li>Connect by <strong>Ethernet</strong> for online-order auto-print (USB-C also exists). No PC driver and no Star cloud subscription needed.</li>
                <li>Paper: 80mm thermal (48 columns, default) or 58mm (32 columns).</li>
              </ul>
            </details>
            <details className={detailsCls}>
              <summary className={summaryCls}>2. Physical setup</summary>
              <ol className={olCls}>
                <li>Place near the pickup counter within reach of the router.</li>
                <li>Plug the Ethernet cable into the router, connect power, turn it on.</li>
                <li>Load the paper roll (paper feeds off the bottom) and close the lid firmly.</li>
                <li>Wait ~30s for the printer to get an IP address.</li>
                <li>Print the self-test slip (hold <strong>FEED</strong> while powering on) to find the printer&apos;s IP address.</li>
              </ol>
            </details>
            <details className={detailsCls}>
              <summary className={summaryCls}>3. Point the printer at our website</summary>
              <div className="mt-2 space-y-2 text-[13px] text-[var(--admin-text-muted)]">
                <p>Copy the <strong>Poll URL</strong> and <strong>Poll token</strong> from the Connection card above (Generate a token if it&apos;s blank), then enter them into the printer <strong>either way</strong>:</p>
                <p className="font-medium text-[var(--admin-text)]">Option A — the printer&apos;s built-in web page:</p>
                <ol className="list-decimal space-y-1 pl-5">
                  <li>On a device on the same network, browse to the printer&apos;s IP (e.g. <code className={inlineCode}>http://192.168.1.50</code>).</li>
                  <li>Log in (often user <code className={inlineCode}>root</code> / password <code className={inlineCode}>public</code> — change it after).</li>
                  <li>Open <strong>CloudPRNT</strong>, turn it <strong>ON</strong>.</li>
                  <li><strong>Server URL</strong> = the Poll URL (include <code className={inlineCode}>https://</code> and <code className={inlineCode}>/api/cloudprnt</code>).</li>
                  <li><strong>Poll interval</strong> ≈ 5 seconds. <strong>Password</strong> = the Poll token. Save.</li>
                </ol>
                <p className="font-medium text-[var(--admin-text)]">Option B — Star Quick Setup Utility:</p>
                <p>Install Star&apos;s free app, let it discover the printer, open CloudPRNT settings, and enter the same Server URL, poll interval, and password (Poll token). Save.</p>
              </div>
            </details>
            <details className={detailsCls}>
              <summary className={summaryCls}>4. Confirm &amp; go live</summary>
              <ol className={olCls}>
                <li>Watch the <strong>Printer status</strong> card flip to <strong>Online</strong> (shows Last poll + MAC).</li>
                <li>Click <strong>Send test print</strong> — a receipt prints within a few seconds.</li>
                <li>Make sure <strong>Auto-print online orders</strong> is checked. Done — receipts now print automatically.</li>
              </ol>
            </details>
            <details className={detailsCls}>
              <summary className={summaryCls}>How it works &amp; security</summary>
              <p className="mt-2 text-[13px] text-[var(--admin-text-muted)]">
                The printer polls our single <code className={inlineCode}>/api/cloudprnt</code> endpoint every few seconds
                (that&apos;s the &ldquo;Last poll&rdquo; heartbeat). When a receipt is waiting it fetches and prints it, then confirms.
                The <strong>Poll token</strong> is sent on every request as the CloudPRNT password; a wrong token returns
                401 and nothing prints. If you ever rotate the token, immediately re-enter the new one in the printer.
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
            setup and your printer&apos;s live status — it won&apos;t invent settings.
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
                      <td className="px-2 py-2 text-[var(--admin-text)]">{j.title ?? j.order_number ?? "Receipt"}</td>
                      <td className="px-2 py-2"><Badge tone={jobTone(j.status)}>{j.status}</Badge></td>
                      <td className="px-2 py-2 text-[var(--admin-text-muted)]">{formatReceiptTimestamp(j.queued_at)}</td>
                      <td className="px-2 py-2 text-[var(--admin-text-muted)]">{j.printed_at ? formatReceiptTimestamp(j.printed_at) : "—"}</td>
                      <td className="px-2 py-2 text-right">
                        {(j.status === "queued" || j.status === "failed") && (
                          <form action={cancelJobAction}>
                            <input type="hidden" name="job_id" value={j.id} />
                            <Button type="submit" variant="neutral" size="sm">Cancel</Button>
                          </form>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
