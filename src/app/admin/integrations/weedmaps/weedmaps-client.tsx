"use client";

import { useState, useTransition } from "react";
import { Badge, Button, Card, Field, Input, Select, Textarea } from "@/components/admin/ui";
import {
  pushWeedmapsAction,
  verifyWeedmapsAccessAction,
  draftWeedmapsDescriptionAction,
} from "./actions";

const CATEGORIES = [
  "flower",
  "preroll",
  "infused-preroll",
  "cartridge",
  "concentrate",
  "edible-solid",
  "edible-liquid",
  "tincture",
  "topical",
  "rso",
  "accessories",
];

export function WeedmapsPushClient({
  configured,
  itemCount,
}: {
  configured: boolean;
  itemCount: number;
}) {
  const [pending, startTransition] = useTransition();
  const [confirmArmed, setConfirmArmed] = useState(false);
  const [pushMsg, setPushMsg] = useState<string | null>(null);
  const [pushOk, setPushOk] = useState<boolean | null>(null);

  const [accessMsg, setAccessMsg] = useState<string | null>(null);

  function doPush() {
    setPushMsg(null);
    setPushOk(null);
    const fd = new FormData();
    fd.set("confirm", "true");
    startTransition(async () => {
      const res = await pushWeedmapsAction(fd);
      if (res.ok) {
        setPushOk(res.result.ok);
        setPushMsg(
          res.result.ok
            ? `Sync sent. HTTP ${res.result.httpStatus}, ${res.result.itemCount} items.`
            : `WeedMaps returned HTTP ${res.result.httpStatus}. ${res.result.message ?? ""}`,
        );
      } else {
        setPushOk(false);
        setPushMsg(res.error);
      }
      setConfirmArmed(false);
    });
  }

  function doAccess() {
    setAccessMsg(null);
    startTransition(async () => {
      const res = await verifyWeedmapsAccessAction();
      if (res.ok) {
        setAccessMsg(
          `HTTP ${res.httpStatus} (${res.state}): ${JSON.stringify(res.body).slice(0, 400)}`,
        );
      } else {
        setAccessMsg(res.error);
      }
    });
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <h2 className="mb-2 text-sm font-bold text-[var(--admin-text)]">Live push to WeedMaps</h2>
        <p className="mb-3 text-xs text-[var(--admin-text-muted)]">
          Sends the published menu to WeedMaps via{" "}
          <span className="font-mono">POST /partners/menus/&#123;menu_id&#125;/items</span>. Items are
          keyed by a stable <span className="font-mono">external_id</span> so curated WeedMaps data
          is preserved across syncs.
        </p>

        <p className="mb-3 rounded-md border border-[var(--admin-border)] bg-[var(--admin-surface-2)] p-2 text-[11px] text-[var(--admin-text-muted)]">
          The item price/variant write schema is confirmed against WeedMaps&rsquo; live API
          examples; review the preview payload below before enabling live writes.
        </p>

        {!configured ? (
          <Badge tone="orange">Add credentials to enable live push</Badge>
        ) : !confirmArmed ? (
          <Button variant="primary" size="sm" onClick={() => setConfirmArmed(true)} disabled={pending}>
            Push to WeedMaps&hellip;
          </Button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-[var(--admin-danger)]">
              Send {itemCount} items now?
            </span>
            <Button variant="danger" size="sm" onClick={doPush} disabled={pending}>
              {pending ? "Sending\u2026" : "Yes, push now"}
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
          <Button variant="neutral" size="sm" onClick={doAccess} disabled={pending || !configured}>
            Verify menu access
          </Button>
          {accessMsg ? (
            <p className="mt-2 break-words text-xs text-[var(--admin-text-muted)]">{accessMsg}</p>
          ) : null}
        </div>
      </Card>

      <DescriptionDrafter />
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
      const res = await draftWeedmapsDescriptionAction({
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
        Drafts a plain-text WeedMaps description. <strong>Draft only</strong> &mdash; review, edit,
        and approve before using it.
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
          {pending ? "Drafting\u2026" : "Draft description"}
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
