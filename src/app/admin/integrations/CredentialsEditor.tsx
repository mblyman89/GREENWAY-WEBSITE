"use client";

/**
 * Back-office credential editor for Leafly + WeedMaps (Slice 60).
 *
 * Secrets are shown MASKED (••••1234); leaving a masked value untouched keeps
 * the stored secret. Typing a new value replaces it; clearing the field removes
 * it. Non-secret fields (client id, menu id, scope, token url) are shown in the
 * clear. Only owner/admin (settings.manage) reach this page.
 */
import { useState, useTransition } from "react";
import { Badge, Button, Card, Field, Input, Select } from "@/components/admin/ui";
import type { CredentialsView } from "@/lib/integrations/integration-credentials-core";
import {
  saveLeaflyCredentialsAction,
  saveWeedmapsCredentialsAction,
} from "./credential-actions";

type Source = "database" | "environment" | "unset";

function SourceBadge({ source }: { source: Source }) {
  if (source === "database") return <Badge tone="green">Saved here</Badge>;
  if (source === "environment") return <Badge tone="gold">From server env</Badge>;
  return <Badge tone="neutral">Not set</Badge>;
}

function Note() {
  return (
    <p className="mt-1 text-[11px] text-[var(--admin-text-faint)]">
      Secret shown masked. Leave it as-is to keep the saved value, type a new value to
      replace it, or clear it to remove it.
    </p>
  );
}

export function LeaflyCredentialsForm({ view }: { view: CredentialsView["leafly"] }) {
  const [pending, startTransition] = useTransition();
  const [env, setEnv] = useState(view.environment);
  const [key, setKey] = useState(view.menuIntegrationKey);
  const [clientId, setClientId] = useState(view.clientId);
  const [secret, setSecret] = useState(view.clientSecret);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function save() {
    setMsg(null);
    const fd = new FormData();
    fd.set("leaflyEnvironment", env);
    fd.set("leaflyMenuIntegrationKey", key);
    fd.set("leaflyClientId", clientId);
    fd.set("leaflyClientSecret", secret);
    startTransition(async () => {
      const res = await saveLeaflyCredentialsAction(fd);
      setMsg(
        res.ok
          ? { ok: true, text: "Leafly credentials saved." }
          : { ok: false, text: res.error },
      );
    });
  }

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold text-[var(--admin-text)]">🍃 Leafly credentials</h2>
      </div>
      <p className="mb-4 text-xs text-[var(--admin-text-muted)]">
        Enter these from your Leafly business account (Menu Integration API v2.0). A value
        saved here overrides the server environment variable of the same name.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Environment">
          <Select value={env} onChange={(e) => setEnv(e.target.value as "sandbox" | "production")}>
            <option value="sandbox">Sandbox (testing)</option>
            <option value="production">Production (live)</option>
          </Select>
        </Field>
        <div className="flex items-end pb-2">
          <span className="text-xs text-[var(--admin-text-faint)]">
            Source: <SourceBadge source={view.sources.clientSecret} />
          </span>
        </div>

        <Field label="Menu integration key">
          <Input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="LEAFLY_MENU_INTEGRATION_KEY"
            autoComplete="off"
          />
          <Note />
        </Field>

        <Field label="OAuth client ID">
          <Input
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="LEAFLY_CLIENT_ID"
            autoComplete="off"
          />
        </Field>

        <Field label="OAuth client secret">
          <Input
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="LEAFLY_CLIENT_SECRET"
            autoComplete="off"
          />
          <Note />
        </Field>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save Leafly credentials"}
        </Button>
        {msg ? (
          <span
            className={
              msg.ok
                ? "text-xs font-medium text-[var(--admin-green)]"
                : "text-xs font-medium text-[var(--admin-orange)]"
            }
          >
            {msg.text}
          </span>
        ) : null}
      </div>
    </Card>
  );
}

export function WeedmapsCredentialsForm({ view }: { view: CredentialsView["weedmaps"] }) {
  const [pending, startTransition] = useTransition();
  const [env, setEnv] = useState(view.environment);
  const [menuId, setMenuId] = useState(view.menuId);
  const [clientId, setClientId] = useState(view.clientId);
  const [secret, setSecret] = useState(view.clientSecret);
  const [token, setToken] = useState(view.accessToken);
  const [tokenUrl, setTokenUrl] = useState(view.tokenUrl);
  const [scope, setScope] = useState(view.scope);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function save() {
    setMsg(null);
    const fd = new FormData();
    fd.set("weedmapsEnvironment", env);
    fd.set("weedmapsMenuId", menuId);
    fd.set("weedmapsClientId", clientId);
    fd.set("weedmapsClientSecret", secret);
    fd.set("weedmapsAccessToken", token);
    fd.set("weedmapsTokenUrl", tokenUrl);
    fd.set("weedmapsScope", scope);
    startTransition(async () => {
      const res = await saveWeedmapsCredentialsAction(fd);
      setMsg(
        res.ok
          ? { ok: true, text: "WeedMaps credentials saved." }
          : { ok: false, text: res.error },
      );
    });
  }

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold text-[var(--admin-text)]">🗺️ WeedMaps credentials</h2>
      </div>
      <p className="mb-4 text-xs text-[var(--admin-text-muted)]">
        Enter these from your WeedMaps back office / developer settings (Menu API 2025-07).
        Provide OAuth client ID + secret, or a pre-provisioned access token. The token URL
        and scope have verified defaults — leave them blank unless WeedMaps tells you
        otherwise.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Environment">
          <Select value={env} onChange={(e) => setEnv(e.target.value as "sandbox" | "production")}>
            <option value="sandbox">Sandbox (testing)</option>
            <option value="production">Production (live)</option>
          </Select>
        </Field>
        <div className="flex items-end pb-2">
          <span className="text-xs text-[var(--admin-text-faint)]">
            Source: <SourceBadge source={view.sources.clientSecret} />
          </span>
        </div>

        <Field label="Menu ID">
          <Input
            value={menuId}
            onChange={(e) => setMenuId(e.target.value)}
            placeholder="WEEDMAPS_MENU_ID"
            autoComplete="off"
          />
        </Field>

        <Field label="OAuth client ID">
          <Input
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="WEEDMAPS_CLIENT_ID"
            autoComplete="off"
          />
        </Field>

        <Field label="OAuth client secret">
          <Input
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="WEEDMAPS_CLIENT_SECRET"
            autoComplete="off"
          />
          <Note />
        </Field>

        <Field label="Access token (optional)">
          <Input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="WEEDMAPS_ACCESS_TOKEN"
            autoComplete="off"
          />
          <Note />
        </Field>

        <Field label="Token URL (optional override)">
          <Input
            value={tokenUrl}
            onChange={(e) => setTokenUrl(e.target.value)}
            placeholder="Leave blank for the verified default"
            autoComplete="off"
          />
        </Field>

        <Field label="Scope (optional override)">
          <Input
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            placeholder="Leave blank for the verified default"
            autoComplete="off"
          />
        </Field>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save WeedMaps credentials"}
        </Button>
        {msg ? (
          <span
            className={
              msg.ok
                ? "text-xs font-medium text-[var(--admin-green)]"
                : "text-xs font-medium text-[var(--admin-orange)]"
            }
          >
            {msg.text}
          </span>
        ) : null}
      </div>
    </Card>
  );
}
