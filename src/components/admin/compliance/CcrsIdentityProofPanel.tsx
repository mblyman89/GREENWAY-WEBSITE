/**
 * R74 S25: "which CCRS ids does this week's file use?" proof panel on the CCRS
 * hub. Server component (no hooks); every number comes from the PURE
 * buildIdentityProof (ccrs-identity-guard-core) via batch.identity.
 *
 * Cultivera (migrated) lots keep the Inventory id Cultivera filed (the
 * barcode, byte-for-byte) and name Cultivera's filed Product; lots we intake
 * get our own Inventory id and a GWP- Product id.
 */
import type { IdentityProof } from "@/lib/compliance/ccrs-identity-guard-core";

function Stat({ label, value, tone, testId }: { label: string; value: number; tone: "ok" | "warn" | "bad" | "muted"; testId: string }) {
  const cls =
    tone === "bad" && value > 0
      ? "border-red-400/30 bg-red-400/10 text-red-100"
      : tone === "warn" && value > 0
        ? "border-amber-400/30 bg-amber-400/10 text-amber-100"
        : tone === "ok" && value > 0
          ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"
          : "border-white/10 bg-white/5 text-white/70";
  return (
    <div className={`rounded-lg border px-3 py-2 ${cls}`}>
      <p className="text-[10px] uppercase tracking-wide opacity-70">{label}</p>
      <p className="text-lg font-bold" data-testid={testId}>
        {value}
      </p>
    </div>
  );
}

export function CcrsIdentityProofPanel({ proof }: { proof: IdentityProof }) {
  const c = proof.cultivera;
  const i = proof.intake;
  const p = proof.products;
  const allGood =
    proof.mode === "ledger" && c.held === 0 && c.idNotBarcode === 0 && i.onRecordCultivera === 0 && (proof.env === "preprod" || c.sentAsNew === 0);
  return (
    <div className="space-y-3 text-xs text-white/70" data-testid="ccrs-identity-proof">
      {proof.mode === "legacy" && proof.env === "prod" ? (
        <p className="rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-red-100" data-testid="ccrs-identity-legacy">
          The CCRS ledger is not loaded, so this file would send every row as a NEW record, including Cultivera&apos;s
          lots. Export to production is blocked (E53) until the ledger is loaded.
        </p>
      ) : allGood ? (
        <p className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 p-3 text-emerald-100" data-testid="ccrs-identity-ok">
          Every Cultivera lot in this week&apos;s file keeps the CCRS id Cultivera filed, and every lot we received
          ourselves goes out under our own id with a GWP- product id.
        </p>
      ) : null}
      {proof.env === "preprod" ? (
        <p className="text-white/50">
          PREprod is a separate system from production, so lots there are sent as new records. This is expected.
        </p>
      ) : null}

      <div>
        <p className="mb-1 font-semibold text-white/80">Cultivera lots (migrated)</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Lots" value={c.lots} tone="muted" testId="idp-cv-lots" />
          <Stat label="Sent under Cultivera's id" value={c.onRecord} tone="ok" testId="idp-cv-onrecord" />
          <Stat label="Cultivera products named" value={c.filedProducts} tone="muted" testId="idp-cv-products" />
          <Stat label="Held: not on the CCRS record (E52)" value={c.held} tone="bad" testId="idp-cv-held" />
          <Stat label="Left out for another reason" value={c.withheldByRouting} tone="warn" testId="idp-cv-withheld" />
          <Stat label="Sent as new" value={c.sentAsNew} tone={proof.env === "prod" ? "bad" : "muted"} testId="idp-cv-new" />
          <Stat label="No CCRS id" value={c.noId} tone="warn" testId="idp-cv-noid" />
          <Stat label="Id is not the barcode (E54)" value={c.idNotBarcode} tone="warn" testId="idp-cv-drift" />
        </div>
      </div>

      <div>
        <p className="mb-1 font-semibold text-white/80">Lots we received (our intake)</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Lots" value={i.lots} tone="muted" testId="idp-in-lots" />
          <Stat label="New records (our id)" value={i.newRecords} tone="ok" testId="idp-in-new" />
          <Stat label="Already filed by us" value={i.onRecordOurs} tone="ok" testId="idp-in-ours" />
          <Stat label="On a Cultivera record (E55)" value={i.onRecordCultivera} tone="warn" testId="idp-in-cv" />
          <Stat label="Left out" value={i.withheld} tone="warn" testId="idp-in-withheld" />
          <Stat label="No CCRS id" value={i.noId} tone="warn" testId="idp-in-noid" />
        </div>
      </div>

      <div>
        <p className="mb-1 font-semibold text-white/80">Products</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="GWP- new (Insert)" value={p.gwpInsert} tone="ok" testId="idp-p-ins" />
          <Stat label="GWP- update" value={p.gwpUpdate} tone="ok" testId="idp-p-upd" />
          <Stat label="Cultivera's filed product used" value={p.filedProductUsed} tone="ok" testId="idp-p-filed" />
          <Stat label="Cultivera-only, held" value={p.cultiveraOnlyHeld} tone="bad" testId="idp-p-held" />
          <Stat label="Left out (no GWP- id yet)" value={p.withheld} tone="warn" testId="idp-p-withheld" />
          <Stat label="Non-GWP id (old way)" value={p.legacyIds} tone={proof.env === "prod" ? "bad" : "muted"} testId="idp-p-legacy" />
        </div>
      </div>
    </div>
  );
}
