/**
 * src/data/wcia-transfers/index.ts  (D214)
 *
 * Vendor WCIA transfer files the owner found by hand and asked to be kept in
 * the repo, keyed by manifest number. Each is the transfer JSON exactly as the
 * vendor's system served it, except `document_origin`: the Growflow link carries
 * an access token and this repository is public, so the link is not kept.
 *
 * The manifest page offers "Attach all COAs from the vendor's transfer" for a
 * delivery whose number is here and that still has lots without a lab result.
 */
import GF42904700003637 from "./GF42904700003637.json";

const TRANSFERS: Readonly<Record<string, unknown>> = {
  GF42904700003637,
};

/** The kept transfer JSON text for a manifest number, or null. */
export function keptTransferText(manifestNumber: string | null | undefined): string | null {
  const key = (manifestNumber ?? "").trim();
  if (!key || !Object.prototype.hasOwnProperty.call(TRANSFERS, key)) return null;
  return JSON.stringify(TRANSFERS[key]);
}

export function keptTransferNumbers(): string[] {
  return Object.keys(TRANSFERS).sort();
}
