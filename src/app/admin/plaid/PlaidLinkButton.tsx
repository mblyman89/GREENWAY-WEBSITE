"use client";

/**
 * PlaidLinkButton — client component that opens Plaid Link and, on success,
 * hands the public_token back to the server to finish the connection.
 *
 * Flow (Plaid's documented Link handshake):
 *   1) Click → call the server action createPlaidLinkTokenAction(setKey) to mint
 *      a short-lived link_token under a specific CREDENTIAL SET (whose person's
 *      Plaid account). The Plaid secret stays on the server.
 *   2) usePlaidLink({ token, onSuccess }) opens the Plaid modal. The user picks
 *      their bank and signs in inside Plaid's secure UI — we never see their
 *      bank password.
 *   3) On success Plaid gives us a public_token → we send ONLY that + the same
 *      setKey to exchangePlaidPublicTokenAction(), which exchanges it for an
 *      access_token (encrypted at rest) and records the accounts, tagged to that
 *      set + owner.
 *   4) Refresh so the newly linked item/accounts appear.
 *
 * The set MUST match across mint + exchange (Plaid requires the same
 * credentials), so we thread `credentialSetKey` through both calls.
 *
 * We deliberately create the link_token lazily on click (not on mount) so a
 * page view doesn't spend a token, and so an unconfigured deploy shows a
 * friendly message instead of failing silently.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePlaidLink, type PlaidLinkOnSuccess } from "react-plaid-link";
import { Button } from "@/components/admin/ui";
import { createPlaidLinkTokenAction, exchangePlaidPublicTokenAction } from "./actions";

export function PlaidLinkButton({
  credentialSetKey = "primary",
  label,
}: {
  /** Which credential set to link under ("primary" | "secondary"). */
  credentialSetKey?: string;
  /** Button label; defaults to a generic connect prompt. */
  label?: string;
}) {
  const router = useRouter();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Finish the connection once the user completes Plaid Link.
  const onSuccess = useCallback<PlaidLinkOnSuccess>(
    (publicToken) => {
      if (!publicToken) {
        setError("Plaid didn't return a connection token. Please try again.");
        return;
      }
      setBusy(true);
      setError(null);
      setNotice("Finishing the connection…");
      void exchangePlaidPublicTokenAction(publicToken, credentialSetKey).then((res) => {
        setBusy(false);
        setLinkToken(null); // one token per connection
        if (res.ok) {
          setNotice(
            res.accounts > 0
              ? `Connected! Recorded ${res.accounts} account${res.accounts === 1 ? "" : "s"}.`
              : "Connected! Accounts will appear on the next sync.",
          );
          router.refresh();
        } else {
          setNotice(null);
          setError(res.error);
        }
      });
    },
    [router, credentialSetKey],
  );

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
    onExit: (err) => {
      // User closed Link (or an error inside Plaid). Don't nag on a plain cancel.
      if (err) setError("The bank connection didn't complete. You can try again.");
      setLinkToken(null);
    },
  });

  // As soon as we have a fresh link_token and Plaid is ready, open the modal.
  useEffect(() => {
    if (linkToken && ready) open();
  }, [linkToken, ready, open]);

  const handleClick = useCallback(async () => {
    setError(null);
    setNotice(null);
    setBusy(true);
    const res = await createPlaidLinkTokenAction(credentialSetKey);
    setBusy(false);
    if (res.ok) {
      setLinkToken(res.linkToken); // triggers the effect above → open()
    } else {
      setError(res.error);
    }
  }, [credentialSetKey]);

  return (
    <div className="space-y-2">
      <Button type="button" onClick={handleClick} disabled={busy}>
        {busy ? "Working…" : label ?? "Connect a bank account"}
      </Button>
      {notice ? <p className="text-sm text-emerald-300">{notice}</p> : null}
      {error ? <p className="text-sm text-amber-300">{error}</p> : null}
    </div>
  );
}
