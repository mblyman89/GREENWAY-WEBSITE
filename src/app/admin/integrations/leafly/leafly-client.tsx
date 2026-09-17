"use client";

import { useState, useTransition } from "react";
import { Badge, Button, Card, Field, Input, Select, Textarea } from "@/components/admin/ui";
import {
  pushLeaflyAction,
  fetchLeaflyStatusAction,
  fetchLeaflyMenuReadbackAction,
  draftLeaflyDescriptionAction,
  type MenuReadbackActionResult,
} from "./actions";

const CATEGORIES = [
  "flower",
  "preroll",
  "cartridge",
  "concentrate",
  "edible-solid",
  "edible-liquid",
  "tincture",
  "topical",
  "rso",
  "accessories",
];

export function LeaflyPushClient({
  configured,
  itemCount,
  sandbox,
}: {
  configured: boolean;
  itemCount: number;
  /** Slice L-4: the read-back endpoint is sandbox-only (Leafly returns 405 elsewhere). */
  sandbox: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [confirmArmed, setConfirmArmed] = useState(false);
  const [method, setMethod] = useState<"POST" | "PUT">("POST");
  const [pushMsg, setPushMsg] = useState<string | null>(null);
  const [pushOk, setPushOk] = useState<boolean | null>(null);

  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [readback, setReadback] = useState<MenuReadbackActionResult | null>(null);

  function doReadback() {
    setReadback(null);
    startTransition(async () => {
      setReadback(await fetchLeaflyMenuReadbackAction());
    });
  }

  function doPush() {
    setPushMsg(null);
    setPushOk(null);
    const fd = new FormData();
    fd.set("confirm", "true");
    fd.set("method", method);
    startTransition(async () => {
      const res = await pushLeaflyAction(fd);
      if (res.ok) {
        setPushOk(res.result.ok);
        setPushMsg(
          res.result.skipped
            ? (res.result.message ?? "Skipped — no changes since the last successful sync.")
            : res.result.ok
              ? `Sync sent (${res.result.method}${res.result.planSummary ? ` — ${res.result.planSummary}` : ""}). ${res.result.message ?? ""}`
              : `Leafly returned HTTP ${res.result.httpStatus}. ${res.result.message ?? ""}`,
        );
      } else {
        setPushOk(false);
        setPushMsg(res.error);
      }
      setConfirmArmed(false);
    });
  }

  function doStatus() {
    setStatusMsg(null);
    startTransition(async () => {
      const res = await fetchLeaflyStatusAction();
      if (res.ok) {
        setStatusMsg(`HTTP ${res.httpStatus}: ${JSON.stringify(res.body).slice(0, 400)}`);
      } else {
        setStatusMsg(res.error);
      }
    });
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <h2 className="mb-2 text-sm font-bold text-[var(--admin-text)]">Live push to Leafly</h2>
        <p className="mb-3 text-xs text-[var(--admin-text-muted)]">
          {method === "POST"
            ? "POST is a full sync — it replaces the Leafly menu and deletes items not in this feed."
            : "PUT upserts items without deleting anything omitted from the feed."}
        </p>

        <div className="mb-3">
          <Field label="Method" htmlFor="leafly-method" help="POST = full sync · PUT = upsert only">
            <Select
              id="leafly-method"
              value={method}
              onChange={(e) => setMethod(e.target.value === "PUT" ? "PUT" : "POST")}
            >
              <option value="POST">POST — full sync ({itemCount} items)</option>
              <option value="PUT">PUT — upsert items</option>
            </Select>
          </Field>
        </div>

        {!configured ? (
          <Badge tone="orange">Add credentials to enable live push</Badge>
        ) : !confirmArmed ? (
          <Button variant="primary" size="sm" onClick={() => setConfirmArmed(true)} disabled={pending}>
            Push {method} to Leafly…
          </Button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-[var(--admin-danger)]">
              Send {itemCount} items via {method} now?
            </span>
            <Button variant="danger" size="sm" onClick={doPush} disabled={pending}>
              {pending ? "Sending…" : "Yes, push now"}
            </Button>
            <Button variant="neutral" size="sm" onClick={() => setConfirmArmed(false)} disabled={pending}>
              Cancel
            </Button>
          </div>
        )}

        {pushMsg ? (
          <p
            className={`mt-3 text-xs ${
              pushOk ? "text-[var(--admin-accent)]" : "text-[var(--admin-danger)]"
            }`}
          >
            {pushMsg}
          </p>
        ) : null}

        <div className="mt-4 border-t border-[var(--admin-border)] pt-3">
          <Button variant="neutral" size="sm" onClick={doStatus} disabled={pending || !configured}>
            Check integration status
          </Button>
          {statusMsg ? (
            <p className="mt-2 break-words text-xs text-[var(--admin-text-muted)]">{statusMsg}</p>
          ) : null}
        </div>

        {/*
          SLICE L-4 (finding L-14) -- read the menu back and CHECK it.

          A successful push only proves our JSON parsed. Slice L-2 found eight field
          defects that a 200 response would never have revealed, and a field we believe
          we send but do not produces a cheerful 200 and a wrong storefront. This button
          fetches Leafly's own copy of the menu and compares it, item by item, against
          what we would send right now.

          Sandbox only -- Leafly answers 405 anywhere else, and the server action refuses
          to dial rather than spend a logged request earning one.
        */}
        <div className="mt-4 border-t border-[var(--admin-border)] pt-3">
          <Button
            variant="neutral"
            size="sm"
            onClick={doReadback}
            disabled={pending || !configured || !sandbox}
          >
            Read the menu back from Leafly and check it
          </Button>
          <p className="mt-2 text-xs text-[var(--admin-text-muted)]">
            {sandbox
              ? "Read-only. Fetches Leafly's copy of your menu and lists anything that does not match what we send."
              : "Available in the sandbox only \u2014 Leafly returns 405 Method Not Allowed in production."}
          </p>
          {readback ? <ReadbackReport report={readback} /> : null}
        </div>
      </Card>

      <DescriptionDrafter />
    </div>
  );
}

/**
 * The read-back result, in the owner's language.
 *
 * Ordered errors-first because that is the order in which things need fixing, and the
 * `unverifiable` list is shown at the bottom precisely BECAUSE it is easy to forget: two
 * fields cannot be checked yet, and a report that silently omitted them would read as a
 * clean bill of health it has not earned.
 */
function ReadbackReport({ report }: { report: MenuReadbackActionResult }) {
  if (!report.ok) {
    return <p className="mt-2 text-xs text-[var(--admin-danger)]">{report.error}</p>;
  }

  const errors = report.reconcile?.issues.filter((i) => i.severity === "error") ?? [];
  const warnings = report.reconcile?.issues.filter((i) => i.severity === "warning") ?? [];
  const infos = report.reconcile?.issues.filter((i) => i.severity === "info") ?? [];
  const clean = report.reconcile?.ok === true && warnings.length === 0;

  return (
    <div className="mt-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge tone={clean ? "green" : errors.length > 0 ? "danger" : "orange"}>
          {clean ? "Matches" : errors.length > 0 ? `${errors.length} problem(s)` : "Check these"}
        </Badge>
        <span className="text-xs text-[var(--admin-text-muted)]">
          HTTP {report.httpStatus} &middot; {report.itemsAtLeafly} item(s) on Leafly
        </span>
      </div>

      {/*
        Finding L-19. Leafly needs up to ~2.5 minutes in sandbox to ingest a push, so a
        comparison run sooner can show the OLD menu. This banner sits ABOVE the issue
        lists on purpose: the wrong reaction to phantom differences is to re-push, which
        manufactures the erratic request pattern Leafly's certification grades against.
      */}
      {report.timing.tooSoon ? (
        <p className="mb-2 rounded border border-[var(--admin-warning,orange)] px-2 py-1.5 text-xs text-[var(--admin-warning,orange)]">
          <strong>Wait before acting on this.</strong> {report.timing.message}
        </p>
      ) : null}

      <p className="mb-2 text-xs text-[var(--admin-text)]">{report.summary}</p>

      {errors.length > 0 ? (
        <ul className="mb-2 space-y-1">
          {errors.map((issue, i) => (
            <li key={`e${i}`} className="text-xs text-[var(--admin-danger)]">
              &bull; {issue.message}
            </li>
          ))}
        </ul>
      ) : null}

      {warnings.length > 0 ? (
        <ul className="mb-2 space-y-1">
          {warnings.map((issue, i) => (
            <li key={`w${i}`} className="text-xs text-[var(--admin-warning,orange)]">
              &bull; {issue.message}
            </li>
          ))}
        </ul>
      ) : null}

      {infos.length > 0 ? (
        <ul className="mb-2 space-y-1">
          {infos.map((issue, i) => (
            <li key={`i${i}`} className="text-xs text-[var(--admin-text-muted)]">
              &bull; {issue.message}
            </li>
          ))}
        </ul>
      ) : null}

      {report.parseWarnings.length > 0 ? (
        <ul className="mb-2 space-y-1">
          {report.parseWarnings.map((w, i) => (
            <li key={`p${i}`} className="text-xs text-[var(--admin-text-muted)]">
              &bull; {w}
            </li>
          ))}
        </ul>
      ) : null}

      {report.reconcile && report.reconcile.unverifiable.length > 0 ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-medium text-[var(--admin-text-muted)]">
            {report.reconcile.unverifiable.length} thing(s) this check deliberately does
            not verify
          </summary>
          <div className="mt-2 space-y-2">
            {report.reconcile.unverifiable.map((u) => (
              <div key={u.readbackField} className="text-xs text-[var(--admin-text-muted)]">
                <strong className="text-[var(--admin-text)]">
                  {u.readbackField} vs {u.suspectedWriteField}
                </strong>
                <br />
                {u.missingFact}
                <br />
                <em>Ask Leafly: {u.askLeafly}</em>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function DescriptionDrafter() {
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [category, setCategory] = useState("flower");
  const [strainName, setStrainName] = useState("");
  const [thc, setThc] = useState("");
  const [existing, setExisting] = useState("");
  const [draft, setDraft] = useState<string | null>(null);
  const [flags, setFlags] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function doDraft() {
    setError(null);
    setDraft(null);
    setFlags([]);
    setCopied(false);
    startTransition(async () => {
      const res = await draftLeaflyDescriptionAction({
        name,
        brand: brand || null,
        category,
        strainName: strainName || null,
        thc: thc || null,
        existing: existing || null,
      });
      if (res.ok) {
        setDraft(res.description);
        setFlags(res.flags);
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <Card>
      <h2 className="mb-1 text-sm font-bold text-[var(--admin-text)]">AI description drafter</h2>
      <p className="mb-3 text-xs text-[var(--admin-text-muted)]">
        Drafts a plain-text Leafly description. <strong>Draft only</strong> — review, edit, and
        approve before using it.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Product name" htmlFor="d-name" required>
          <Input id="d-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Brand" htmlFor="d-brand">
          <Input id="d-brand" value={brand} onChange={(e) => setBrand(e.target.value)} />
        </Field>
        <Field label="Category" htmlFor="d-cat" required>
          <Select id="d-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Strain" htmlFor="d-strain">
          <Input id="d-strain" value={strainName} onChange={(e) => setStrainName(e.target.value)} />
        </Field>
        <Field label="THC" htmlFor="d-thc" help="e.g. 24.1%">
          <Input id="d-thc" value={thc} onChange={(e) => setThc(e.target.value)} />
        </Field>
      </div>
      <div className="mt-3">
        <Field label="Existing copy to refine (optional)" htmlFor="d-existing">
          <Textarea
            id="d-existing"
            rows={2}
            value={existing}
            onChange={(e) => setExisting(e.target.value)}
          />
        </Field>
      </div>

      <div className="mt-3">
        <Button variant="save" size="sm" onClick={doDraft} disabled={pending || !name}>
          {pending ? "Drafting…" : "Draft description"}
        </Button>
      </div>

      {error ? <p className="mt-3 text-xs text-[var(--admin-danger)]">{error}</p> : null}

      {draft ? (
        <div className="mt-4 rounded-md border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--admin-text-muted)]">Draft</span>
            <Button
              variant="neutral"
              size="sm"
              onClick={() => {
                navigator.clipboard?.writeText(draft);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="text-sm text-[var(--admin-text)]">{draft}</p>
          {flags.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {flags.map((f) => (
                <Badge key={f} tone="orange">
                  {f}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
