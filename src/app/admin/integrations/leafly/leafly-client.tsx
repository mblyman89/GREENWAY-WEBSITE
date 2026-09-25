"use client";

import { useState, useTransition } from "react";
import { Badge, Button, Card, Field, Textarea } from "@/components/admin/ui";
import {
  deleteLeaflyItemsAction,
  fetchLeaflyStatusAction,
  fetchLeaflyMenuReadbackAction,
  type MenuReadbackActionResult,
} from "./actions";
import {
  MAX_DELETE_IDS,
  parseDeleteIds,
  describeDeleteProblems,
} from "@/lib/leafly/delete-request-core";
import { LeaflyMenuBrowser } from "./menu-browser-client";
import { FullMenuPanel } from "./full-menu-panel";
import { ReplaceMenuPanel } from "./replace-menu-panel";

/**
 * SLICE L-42 -- the Leafly tools, reorganised.
 *
 * The owner: "Remove the drop down menu to select POST or PUT and remove the
 * push post and push put buttons since they throw errors when pressed", and
 * later "we have to prove we can successfully complete every action. So we
 * will need to have a successful push post". So the dropdown and the old
 * all-or-nothing push are gone, and each Menu API verb now has exactly one
 * clearly named home, grouped by what it does to the live menu:
 *
 *   Check (reads only)  GET /status, GET /menu     -> "Checks" card
 *   Add / update (PUT)  whole menu, or picked      -> FullMenuPanel, picker
 *   Replace (POST)      the certification POST     -> ReplaceMenuPanel
 *   Remove (DELETE)     by name, or by ID          -> browser, DeleteFromLeafly
 */
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
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [statusOk, setStatusOk] = useState<boolean | null>(null);
  const [readback, setReadback] = useState<MenuReadbackActionResult | null>(null);

  function doReadback() {
    setReadback(null);
    startTransition(async () => {
      setReadback(await fetchLeaflyMenuReadbackAction());
    });
  }

  function doStatus() {
    setStatusMsg(null);
    setStatusOk(null);
    startTransition(async () => {
      const res = await fetchLeaflyStatusAction();
      if (res.ok) {
        setStatusOk(res.httpStatus >= 200 && res.httpStatus < 300);
        setStatusMsg(`HTTP ${res.httpStatus}: ${JSON.stringify(res.body).slice(0, 400)}`);
      } else {
        setStatusOk(false);
        setStatusMsg(res.error);
      }
    });
  }

  return (
    <div className="space-y-4">
      <VerbGuide itemCount={itemCount} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <h2 className="mb-1 text-sm font-bold text-[var(--admin-text)]">Checks (read only)</h2>
        <p className="mb-3 text-xs text-[var(--admin-text-muted)]">
          These two buttons only read from Leafly. They never change your menu.
        </p>
        <div>
          <Button variant="neutral" size="sm" onClick={doStatus} disabled={pending || !configured}>
            Check integration status
          </Button>
          {!configured ? (
            <span className="ml-2 text-[0.7rem] text-[var(--admin-text-muted)]">
              Add your Leafly credentials first.
            </span>
          ) : null}
          {statusMsg ? (
            <p
              className={`mt-2 break-words text-xs ${
                statusOk ? "text-[var(--admin-accent)]" : "text-[var(--admin-text-muted)]"
              }`}
            >
              {statusMsg}
            </p>
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

      {/*
        TASK J asks 3 + 4. The everyday path, reached first: whole-menu PUT
        that holds back only the products Leafly would refuse, never deletes.
      */}
      <FullMenuPanel configured={configured} />
      </div>

      <GroupHeading
        title="Replace (POST)"
        body="Sends your whole menu and removes from Leafly anything not in the send. Needed once for certification; rarely needed day to day."
      />
      <ReplaceMenuPanel configured={configured} />

      <GroupHeading
        title="Remove (DELETE)"
        body="Take specific products off Leafly. Find them by name first; use the ID box only when you already have an exact ID."
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {/*
        ROADMAP R8 (owner ask 6). The browser is the PRIMARY way to remove a
        product: see the menu, find the product by name/vendor/barcode, tick
        it, confirm by name. It is placed ABOVE the id textarea deliberately
        -- the usable path should be the one you reach first.
      */}
      <LeaflyMenuBrowser configured={configured} />

      <DeleteFromLeafly configured={configured} />
      </div>
    </div>
  );
}

function GroupHeading({ title, body }: { title: string; body: string }) {
  return (
    <div className="border-t border-[var(--admin-border)] pt-4">
      <h2 className="text-xs font-black uppercase tracking-[0.14em] text-[var(--admin-text)]">{title}</h2>
      <p className="mt-1 text-xs text-[var(--admin-text-muted)]">{body}</p>
    </div>
  );
}

/**
 * SLICE L-42 owner ask 4: "explain what PUT means". The four verbs of the
 * Menu API in one sentence each, in terms of what they do to the storefront.
 */
function VerbGuide({ itemCount }: { itemCount: number }) {
  const rows: { verb: string; plain: string; where: string }[] = [
    {
      verb: "GET",
      plain: "Reads only. Nothing on Leafly changes.",
      where: "Check integration status \u00b7 Read the menu back",
    },
    {
      verb: "PUT",
      plain: "Adds new products and updates existing ones. Never deletes anything.",
      where: "Send my whole menu, hold back only the bad ones \u00b7 Send only certain products",
    },
    {
      verb: "POST",
      plain: "Replaces the whole menu. Anything not in the send is deleted from Leafly.",
      where: "Replace my whole Leafly menu (POST)",
    },
    {
      verb: "DELETE",
      plain: "Removes the specific products you choose.",
      where: "What is on your Leafly menu \u00b7 Remove by product ID (advanced)",
    },
  ];
  return (
    <Card>
      <h2 className="text-sm font-bold text-[var(--admin-text)]">What each kind of send does</h2>
      <p className="mt-1 text-xs text-[var(--admin-text-muted)]">
        Leafly&rsquo;s Menu API has four actions. Every button below is labelled with the one
        it uses. Your menu currently has {itemCount} publishable products.
      </p>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {rows.map((r) => (
          <div
            key={r.verb}
            className="rounded border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-2.5 text-xs"
          >
            <div className="flex items-center gap-2">
              <Badge tone={r.verb === "POST" || r.verb === "DELETE" ? "orange" : "green"}>{r.verb}</Badge>
              <span className="font-semibold text-[var(--admin-text)]">{r.plain}</span>
            </div>
            <p className="mt-1 text-[var(--admin-text-muted)]">{r.where}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

/**
 * TASK I -- remove specific products from the Leafly menu.
 *
 * WHY THIS IS A SEPARATE CARD AND NOT A MODE ON THE PUSH CARD.
 *
 * The old push card's dangerous control was a dropdown, and adding "DELETE"
 * as a third option would have put an irreversible action one mis-click from a
 * routine one. Removal gets its own card, its own text box that must be filled in by
 * hand, and its own confirmation. None of that is decoration: a product
 * silently vanishing from a live menu is exactly the class of fault Leafly
 * grades an integration on.
 *
 * The parse runs LOCALLY as the owner types, so the count he is about to
 * confirm is the real, de-duplicated count rather than a guess at how many
 * lines he pasted. The server re-parses the same text with the same pure
 * function and does not trust this number -- the client copy is for the
 * owner's eyes, not for the request.
 */
function DeleteFromLeafly({ configured }: { configured: boolean }) {
  const [pending, startTransition] = useTransition();
  const [ids, setIds] = useState("");
  const [armed, setArmed] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const [ok, setOk] = useState<boolean | null>(null);

  const parsed = parseDeleteIds(ids);
  const localProblem = ids.trim().length > 0 ? describeDeleteProblems(parsed) : null;
  const canArm = configured && parsed.ok && !pending;

  function doDelete() {
    setMsg(null);
    setWarn(null);
    setOk(null);
    const fd = new FormData();
    fd.set("confirm", "true");
    fd.set("ids", ids);
    startTransition(async () => {
      const res = await deleteLeaflyItemsAction(fd);
      if (res.ok) {
        setOk(true);
        setMsg(res.message);
        setWarn(res.warning);
        setIds("");
      } else {
        setOk(false);
        setMsg(res.error);
      }
      setArmed(false);
    });
  }

  return (
    <Card>
      <h2 className="mb-2 text-sm font-bold text-[var(--admin-text)]">
        Remove by product ID (advanced)
      </h2>
      <p className="mb-3 text-xs text-[var(--admin-text-muted)]">
        Most of the time you should use <strong>What is on your Leafly menu</strong> above,
        where you can find products by name, vendor or barcode and tick them. This box is
        the fallback for when you already have an exact product ID &mdash; for example one
        copied out of an error message or a support ticket from Leafly. Paste IDs one per
        line, or separated by commas, up to {MAX_DELETE_IDS} at a time. This cannot be
        undone; to put a product back you push it again.
      </p>

      <div className="mb-3">
        <Field
          label="Product IDs to remove"
          htmlFor="leafly-delete-ids"
          help={
            parsed.ids.length > 0
              ? `${parsed.ids.length} ID${parsed.ids.length === 1 ? "" : "s"} ready${
                  parsed.duplicates.length > 0
                    ? ` \u00b7 ${parsed.duplicates.length} duplicate${
                        parsed.duplicates.length === 1 ? "" : "s"
                      } ignored`
                    : ""
                }`
              : "Find an ID in the product list, a push payload, or the menu read-back."
          }
        >
          <Textarea
            id="leafly-delete-ids"
            rows={4}
            value={ids}
            placeholder={"pos-45c6e282e0e8-cca24072824d\npos-45c6e282e0e8-00de6c9e8f2c"}
            onChange={(e) => {
              setIds(e.target.value);
              setArmed(false);
            }}
            disabled={pending}
          />
        </Field>
      </div>

      {localProblem ? (
        <p className="mb-2 text-xs text-[var(--admin-danger)]">{localProblem}</p>
      ) : null}

      {!configured ? (
        <Badge tone="orange">Add credentials to enable removals</Badge>
      ) : !armed ? (
        <Button variant="neutral" size="sm" onClick={() => setArmed(true)} disabled={!canArm}>
          Remove {parsed.ids.length > 0 ? parsed.ids.length : ""} from Leafly&hellip;
        </Button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-[var(--admin-danger)]">
            Permanently remove {parsed.ids.length} product
            {parsed.ids.length === 1 ? "" : "s"} from the live Leafly menu?
          </span>
          <Button variant="danger" size="sm" onClick={doDelete} disabled={pending}>
            {pending ? "Removing\u2026" : "Yes, remove now"}
          </Button>
          <Button variant="neutral" size="sm" onClick={() => setArmed(false)} disabled={pending}>
            Cancel
          </Button>
        </div>
      )}

      {msg ? (
        <p
          className={`mt-3 text-xs ${
            ok ? "text-[var(--admin-accent)]" : "text-[var(--admin-danger)]"
          }`}
        >
          {msg}
        </p>
      ) : null}

      {/*
        Shown SEPARATELY from the success message and in a warning tone on
        purpose. Leafly answers a removal for an id that was never on the menu
        with a success, so "it worked" and "your typo did nothing" look
        identical from the response. This is the only place that difference
        surfaces.
      */}
      {warn ? (
        <p className="mt-2 rounded border border-[var(--admin-warning,orange)] px-2 py-1.5 text-xs text-[var(--admin-warning,orange)]">
          {warn}
        </p>
      ) : null}
    </Card>
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

      {/*
        WHAT THIS WAS COMPARED AGAINST.

        FIELD-REPORTED. The owner's first targeted push of 8 products succeeded
        completely and this panel told him he had nineteen problems, because
        the comparison silently used the whole 2,562-item feed as its baseline.
        He had no way to discover that from the screen -- the report looked
        authoritative and was answering a question he had not asked.

        A comparison is only as trustworthy as its baseline, so the baseline is
        now stated on the face of the report rather than buried in the code.
        The "live-preview" fallback carries its own warning, because that is
        the one case where a partial push genuinely will look wrong.
      */}
      {report.baseline ? (
        <p
          className={
            report.baseline.source === "live-preview"
              ? "mb-2 rounded border border-[var(--admin-warning,orange)] px-2 py-1.5 text-xs text-[var(--admin-warning,orange)]"
              : "mb-2 text-xs text-[var(--admin-text-muted)]"
          }
        >
          <strong>What this was checked against:</strong> {report.baseline.explanation}
        </p>
      ) : null}

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
