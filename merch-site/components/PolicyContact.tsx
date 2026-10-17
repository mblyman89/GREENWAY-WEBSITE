import { contact, DBA_NAME, LEGAL_NAME } from "@/lib/site";

/** Contact block for policy pages - only real, owner-set lines render. */
export function PolicyContact() {
  const c = contact();
  return (
    <p>
      {LEGAL_NAME} (dba {DBA_NAME})
      {c.address ? <><br />{c.address}</> : null}
      {c.email ? <><br />Email: <a href={`mailto:${c.email}`}>{c.email}</a></> : null}
      {c.phone ? <><br />Phone: {c.phone}</> : null}
    </p>
  );
}
