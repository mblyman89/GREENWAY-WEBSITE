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
  saveFluxCredentialsAction,
} from "./credential-actions";
import { FLUX_ENDPOINTS } from "@/lib/marketing/flux-core";

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
  const [hmacKey, setHmacKey] = useState(view.hmacKey);
  const [orderKey, setOrderKey] = useState(view.orderIntegrationKey);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function save() {
    setMsg(null);
    const fd = new FormData();
    fd.set("leaflyEnvironment", env);
    fd.set("leaflyMenuIntegrationKey", key);
    fd.set("leaflyClientId", clientId);
    fd.set("leaflyClientSecret", secret);
    fd.set("leaflyHmacKey", hmacKey);
    fd.set("leaflyOrderIntegrationKey", orderKey);
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

      {/*
        Slice L-5 -- Order API credentials.

        Kept in their own labelled block rather than mixed in above, because
        Leafly issues them at a DIFFERENT time (menu integration first, then
        order sandbox access on request) and they are easy to confuse with the
        menu key. The heading says which is which so the owner is not choosing
        between four boxes that all say "key".
      */}
      <div className="mt-6 border-t border-[var(--admin-border)] pt-4">
        <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--admin-text)]">
          Order API (receiving orders from Leafly)
        </h3>
        <p className="mt-1 mb-4 text-xs text-[var(--admin-text-muted)]">
          These two are issued separately from the menu credentials above, when Leafly grants
          Order API access. Leave them blank until Leafly sends them — an incorrect value here
          causes Leafly&rsquo;s order notifications to be rejected.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Webhook HMAC key">
            <Input
              value={hmacKey}
              onChange={(e) => setHmacKey(e.target.value)}
              placeholder="LEAFLY_HMAC_KEY"
              autoComplete="off"
            />
            <p className="mt-1 text-[11px] text-[var(--admin-text-faint)]">
              Proves an incoming order really came from Leafly. Treat it like a password.
            </p>
            <Note />
            <span className="mt-1 inline-block text-[11px] text-[var(--admin-text-faint)]">
              Source: <SourceBadge source={view.sources.hmacKey} />
            </span>
          </Field>

          <Field label="Order integration key">
            <Input
              value={orderKey}
              onChange={(e) => setOrderKey(e.target.value)}
              placeholder="LEAFLY_ORDER_INTEGRATION_KEY"
              autoComplete="off"
            />
            <p className="mt-1 text-[11px] text-[var(--admin-text-faint)]">
              Identifies this store to Leafly. Not a secret, so it is shown in full — check it
              character-for-character against Leafly&rsquo;s email.
            </p>
            <span className="mt-1 inline-block text-[11px] text-[var(--admin-text-faint)]">
              Source: <SourceBadge source={view.sources.orderIntegrationKey} />
            </span>
          </Field>
        </div>
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

export function FluxCredentialsForm({ view }: { view: CredentialsView["flux"] }) {
  const [pending, startTransition] = useTransition();
  const [apiKey, setApiKey] = useState(view.apiKey);
  const [endpoint, setEndpoint] = useState(view.endpoint || "flux-2-max");
  const [baseUrl, setBaseUrl] = useState(view.baseUrl);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function save() {
    setMsg(null);
    const fd = new FormData();
    fd.set("fluxApiKey", apiKey);
    fd.set("fluxEndpoint", endpoint);
    fd.set("fluxBaseUrl", baseUrl);
    startTransition(async () => {
      const res = await saveFluxCredentialsAction(fd);
      setMsg(
        res.ok
          ? { ok: true, text: "FLUX credentials saved." }
          : { ok: false, text: res.error },
      );
    });
  }

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold text-[var(--admin-text)]">🎨 FLUX 2 (Black Forest Labs) credentials</h2>
        <SourceBadge source={view.sources.apiKey} />
      </div>
      <p className="mb-4 text-xs text-[var(--admin-text-muted)]">
        Powers one-click image generation in the marketing image builder. Create an API key at
        Black Forest Labs and paste it here. The key is stored securely (admin-only) and never shown again in full.
        Leave the API base URL blank to use the global endpoint (https://api.bfl.ai).
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="API key (x-key)">
          <Input
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="BFL_API_KEY"
            autoComplete="off"
          />
          <Note />
        </Field>

        <Field label="Model endpoint">
          <Select value={endpoint} onChange={(e) => setEndpoint(e.target.value)}>
            {FLUX_ENDPOINTS.map((ep) => (
              <option key={ep.value} value={ep.value}>
                {ep.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="API base URL (optional override)">
          <Input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="Leave blank for https://api.bfl.ai (or pin api.us.bfl.ai / api.eu.bfl.ai)"
            autoComplete="off"
          />
        </Field>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save FLUX credentials"}
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
