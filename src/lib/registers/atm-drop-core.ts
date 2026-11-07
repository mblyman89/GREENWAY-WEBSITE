/**
 * src/lib/registers/atm-drop-core.ts   (D198 S1 - ATM cash drops from the tills)
 *
 * The owner asked (verbatim, D198):
 *
 *   "the employees put the money directly into the atm after removing it from their till. anyone
 *    can do a refill. the ipad should only accept whole 20 dollar amounts. i want the number of 20s
 *    taken from the till to be entered on the register. ... the atm drops count toward the 2k drop.
 *    any register can do an atm drop."
 *
 * PURE and framework-free: it is bundled into the iPad register app (Capacitor), so it imports
 * nothing (tests/compliance/pos-register-app-guard.test.ts walks the import graph).
 *
 * What lives here:
 *   - the $20-only rule (an ATM drop is a COUNT of $20 bills; the amount is derived, never typed),
 *   - the destination of a drop (safe | atm) and how a row that predates migration 0346 is read,
 *   - the note tag used when 0346 is not applied yet (so nothing is ever lost),
 *   - the safe / ATM split of a set of drops (drawer expected subtracts ALL drops; the deposit and
 *     the end-of-day sheet subtract SAFE drops only, because ATM cash never reaches the safe),
 *   - the owner's ATM-drop settings (site_settings key pos_atm_drop) with safe defaults.
 */

export type DropDestination = "safe" | "atm";

/** The ATM holds $20 bills only. */
export const ATM_BILL_MINOR = 2000;
/** Hard ceiling per drop: 2,500 x $20 = $50,000 (the same ceiling as any drop, MAX_DROP_MINOR). */
export const MAX_ATM_TWENTIES = 2500;
/** The settings key in site_settings. */
export const POS_ATM_DROP_KEY = "pos_atm_drop";
/** The one ATM the store runs today (PAI terminal). Used only as the default setting. */
export const DEFAULT_ATM_TERMINAL_ID = "HG26499";

export type AtmWitnessPolicy = "required" | "recommended" | "off";

export type AtmDropSettings = {
  /** Show the ATM choice on the register drop screen. */
  enabled: boolean;
  /** The ATM terminal the cash goes into (matches atm_cash_loads.terminal_id). */
  terminalId: string;
  /** Second-person witness for an ATM drop. Default "recommended": allowed without, flagged loud. */
  witness: AtmWitnessPolicy;
  /** Largest ATM drop the register will accept, in $20 bills (owner can lower it). */
  maxTwentiesPerDrop: number;
  /** Minutes allowed between the till drop and the PAI cash load before the match is late. */
  matchWindowMinutes: number;
};

export const DEFAULT_ATM_DROP_SETTINGS: AtmDropSettings = {
  enabled: true,
  terminalId: DEFAULT_ATM_TERMINAL_ID,
  witness: "recommended",
  maxTwentiesPerDrop: 250, // $5,000: the machine's cassette is far smaller than the $50k ceiling
  matchWindowMinutes: 120,
};

/** Read a stored settings value, never trusting its shape. Unknown / bad fields fall back to defaults. */
export function normalizeAtmDropSettings(raw: unknown): AtmDropSettings {
  const d = DEFAULT_ATM_DROP_SETTINGS;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...d };
  const r = raw as Record<string, unknown>;
  const enabled = typeof r.enabled === "boolean" ? r.enabled : d.enabled;
  const terminalRaw = typeof r.terminalId === "string" ? r.terminalId.trim().toUpperCase() : "";
  const terminalId = /^[A-Z0-9_-]{1,64}$/.test(terminalRaw) ? terminalRaw : d.terminalId;
  const witness: AtmWitnessPolicy =
    r.witness === "required" || r.witness === "recommended" || r.witness === "off" ? r.witness : d.witness;
  const maxRaw = Number(r.maxTwentiesPerDrop);
  const maxTwentiesPerDrop =
    Number.isInteger(maxRaw) && maxRaw >= 1 && maxRaw <= MAX_ATM_TWENTIES ? maxRaw : d.maxTwentiesPerDrop;
  const winRaw = Number(r.matchWindowMinutes);
  const matchWindowMinutes = Number.isInteger(winRaw) && winRaw >= 15 && winRaw <= 24 * 60 ? winRaw : d.matchWindowMinutes;
  return { enabled, terminalId, witness, maxTwentiesPerDrop, matchWindowMinutes };
}

/** Cents for a number of $20 bills. */
export function atmDropMinor(twenties: number): number {
  return twenties * ATM_BILL_MINOR;
}

export type TwentiesParse = { ok: true; twenties: number; amountMinor: number } | { ok: false; error: string };

/**
 * What the employee typed into "How many $20 bills?". Whole bills only: no dollars, no cents, no
 * decimals, no signs. "80" is 80 bills = $1,600. Leading zeros are fine; spaces are trimmed.
 */
export function parseTwentiesInput(text: string, maxTwenties: number = MAX_ATM_TWENTIES): TwentiesParse {
  const t = String(text ?? "").trim();
  if (!t) return { ok: false, error: "Enter how many $20 bills you took from the till." };
  if (/[$.,]/.test(t)) return { ok: false, error: "Enter the NUMBER of $20 bills (e.g. 80), not a dollar amount." };
  if (!/^\d+$/.test(t)) return { ok: false, error: "Whole $20 bills only: type a number like 80." };
  const n = Number(t);
  if (!Number.isSafeInteger(n) || n < 1) return { ok: false, error: "At least one $20 bill." };
  const cap = Math.min(Math.max(1, Math.trunc(maxTwenties)), MAX_ATM_TWENTIES);
  if (n > cap) {
    return { ok: false, error: `That is more than ${cap} bills ($${(atmDropMinor(cap) / 100).toLocaleString("en-US")}). Check the count, or split it.` };
  }
  return { ok: true, twenties: n, amountMinor: atmDropMinor(n) };
}

export type AtmDropFields =
  | { ok: true; destination: "safe" }
  | { ok: true; destination: "atm"; twentiesCount: number; amountMinor: number }
  | { ok: false; error: string };

/**
 * Validate the destination part of a drop request (server side and offline replay). Old builds send
 * no destination: that is a safe drop, exactly as before. An ATM drop MUST send twentiesCount, and
 * amountMinor (when sent) must equal twentiesCount x $20 - the server never trusts a typed amount.
 */
export function validateAtmDropFields(b: { destination?: unknown; twentiesCount?: unknown; amountMinor?: unknown }): AtmDropFields {
  const dest = b.destination === undefined || b.destination === null || b.destination === "" ? "safe" : b.destination;
  if (dest === "safe") {
    if (b.twentiesCount !== undefined && b.twentiesCount !== null) {
      return { ok: false, error: "A safe drop does not take a $20 count." };
    }
    return { ok: true, destination: "safe" };
  }
  if (dest !== "atm") return { ok: false, error: "Drop destination must be safe or atm." };
  const n = Number(b.twentiesCount);
  if (!Number.isInteger(n) || n < 1) return { ok: false, error: "An ATM drop needs the number of $20 bills (1 or more)." };
  if (n > MAX_ATM_TWENTIES) return { ok: false, error: "That many $20 bills is implausible - check the count." };
  const amountMinor = atmDropMinor(n);
  if (b.amountMinor !== undefined && b.amountMinor !== null && Number(b.amountMinor) !== amountMinor) {
    return { ok: false, error: `ATM drop amount must be exactly ${n} x $20 = $${(amountMinor / 100).toFixed(2)}.` };
  }
  return { ok: true, destination: "atm", twentiesCount: n, amountMinor };
}

// ---------------------------------------------------------------------------
// The note tag: how an ATM drop is kept when migration 0346 is not applied yet.
// ---------------------------------------------------------------------------

const NOTE_TAG_RE = /\[ATM drop: (\d+|\?) x \$20(?: into ([A-Za-z0-9_-]{1,64}))?\]/;

/** "[ATM drop: 80 x $20 into HG26499]" */
export function atmDropNoteTag(twenties: number, terminalId: string | null): string {
  return `[ATM drop: ${twenties} x $20${terminalId ? ` into ${terminalId}` : ""}]`;
}

/** Append the tag to free-text notes (no duplicate tag). */
export function withAtmDropNoteTag(notes: string | null | undefined, twenties: number, terminalId: string | null): string {
  const base = String(notes ?? "").trim();
  if (NOTE_TAG_RE.test(base)) return base;
  const tag = atmDropNoteTag(twenties, terminalId);
  return base ? `${base} ${tag}` : tag;
}

export function parseAtmDropNoteTag(notes: string | null | undefined): { twenties: number | null; terminalId: string | null } | null {
  const m = NOTE_TAG_RE.exec(String(notes ?? ""));
  if (!m) return null;
  return { twenties: m[1] === "?" ? null : Number(m[1]), terminalId: m[2] ?? null };
}

/** A drawer_drops row as any reader sees it (the 0346 columns may be absent on an old database). */
export type DropRowLike = {
  amount_minor: number;
  destination?: string | null;
  twenties_count?: number | null;
  atm_terminal_id?: string | null;
  notes?: string | null;
};

export type ReadDrop = { destination: DropDestination; twenties: number | null; terminalId: string | null; fromNote: boolean };

/** Where did this drop go? The column wins; the note tag covers drops saved before 0346 was applied. */
export function readDropDestination(row: DropRowLike): ReadDrop {
  if (row.destination === "atm") {
    return { destination: "atm", twenties: row.twenties_count ?? null, terminalId: row.atm_terminal_id ?? null, fromNote: false };
  }
  const tag = parseAtmDropNoteTag(row.notes);
  if (tag && (row.destination === undefined || row.destination === null || row.destination === "safe")) {
    // Only trust the tag when the amount agrees with the bill count (a hand-typed lookalike in notes
    // on a real safe drop must not move money out of the deposit).
    if (tag.twenties !== null && atmDropMinor(tag.twenties) === row.amount_minor) {
      return { destination: "atm", twenties: tag.twenties, terminalId: tag.terminalId, fromNote: true };
    }
  }
  return { destination: "safe", twenties: null, terminalId: null, fromNote: false };
}

export type DropSplit = { totalMinor: number; safeMinor: number; atmMinor: number; safeCount: number; atmCount: number; atmTwenties: number };

/**
 * Split drops by destination.
 *   totalMinor -> the drawer's expected cash and the $2,000 drop-due figure (ALL drops left the till)
 *   safeMinor  -> the deposit bag and the end-of-day sheet (only safe drops reach the safe)
 *   atmMinor   -> the ATM match (/admin/atm/drops)
 */
export function splitDrops(rows: readonly DropRowLike[]): DropSplit {
  const out: DropSplit = { totalMinor: 0, safeMinor: 0, atmMinor: 0, safeCount: 0, atmCount: 0, atmTwenties: 0 };
  for (const r of rows) {
    const amt = Number(r.amount_minor) || 0;
    out.totalMinor += amt;
    const d = readDropDestination(r);
    if (d.destination === "atm") {
      out.atmMinor += amt;
      out.atmCount += 1;
      out.atmTwenties += d.twenties ?? Math.round(amt / ATM_BILL_MINOR);
    } else {
      out.safeMinor += amt;
      out.safeCount += 1;
    }
  }
  return out;
}

/** Short label for history / slips: "ATM HG26499 - 80 x $20" or "Safe". */
export function dropDestinationLabel(row: DropRowLike): string {
  const d = readDropDestination(row);
  if (d.destination === "safe") return "Safe";
  const bills = d.twenties !== null ? ` - ${d.twenties} x $20` : "";
  return `ATM${d.terminalId ? ` ${d.terminalId}` : ""}${bills}`;
}

/** Plain-English success line for the register. */
export function atmDropSuccessMessage(twenties: number, terminalId: string | null, queuedOffline = false): string {
  const amt = `$${(atmDropMinor(twenties) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  const where = terminalId ? `ATM ${terminalId}` : "the ATM";
  const head = `${twenties} x $20 = ${amt} recorded for ${where}.`;
  const tail = queuedOffline
    ? " Saved on this iPad; it will be sent when the connection is back. Load the bills into the ATM now."
    : " Load the bills into the ATM now - the owner matches every drop to the ATM's own cash-load report.";
  return head + tail;
}

export type DropInsertBase = {
  session_id: string;
  amount_minor: number;
  drop_window: string;
  dropped_by: string | null;
  witnessed_by: string | null;
  notes: string | null;
  dropped_at?: string;
};

export type DropInsertExtras = {
  destination: DropDestination;
  twentiesCount?: number | null;
  terminalId?: string | null;
  deviceId?: string | null;
  recordedVia: "register" | "offline" | "back_office";
};

/**
 * The two rows a writer tries, in order:
 *   full     - with the 0346 columns (destination, twenties_count, atm_terminal_id, device_id, recorded_via)
 *   fallback - the pre-0346 shape; an ATM drop keeps its truth in the note tag so nothing is lost and
 *              readDropDestination / splitDrops still read it as an ATM drop.
 */
export function buildDropInsertRows(base: DropInsertBase, x: DropInsertExtras): { full: Record<string, unknown>; fallback: Record<string, unknown> } {
  const isAtm = x.destination === "atm" && typeof x.twentiesCount === "number" && x.twentiesCount > 0;
  const terminal = isAtm ? (x.terminalId ?? null) : null;
  const device = x.deviceId && x.deviceId.length <= 128 ? x.deviceId : null;
  const full: Record<string, unknown> = {
    ...base,
    destination: isAtm ? "atm" : "safe",
    twenties_count: isAtm ? x.twentiesCount : null,
    atm_terminal_id: terminal,
    device_id: device,
    recorded_via: x.recordedVia,
  };
  const fallback: Record<string, unknown> = {
    ...base,
    notes: isAtm ? withAtmDropNoteTag(base.notes, x.twentiesCount as number, terminal) : base.notes,
  };
  return { full, fallback };
}

/** Is a witness required / missing under the policy? */
export function atmWitnessCheck(policy: AtmWitnessPolicy, hasWitness: boolean): { allowed: boolean; flag: boolean; message: string | null } {
  if (hasWitness) return { allowed: true, flag: false, message: null };
  if (policy === "required") return { allowed: false, flag: true, message: "An ATM drop needs a second person's PIN as witness." };
  if (policy === "recommended") return { allowed: true, flag: true, message: "No witness: this ATM drop will be flagged for the owner." };
  return { allowed: true, flag: false, message: null };
}

// ---------------------------------------------------------------------------
// Self-tests (scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runAtmDropCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, msg: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error(`atm-drop-core FAIL: ${msg}`);
    }
  };

  // $20 rule
  ok(atmDropMinor(80) === 160000, "80 x $20 = $1,600");
  const p80 = parseTwentiesInput("80");
  ok(p80.ok && p80.twenties === 80 && p80.amountMinor === 160000, "parse 80");
  ok(parseTwentiesInput(" 007 ").ok, "leading zeros and spaces ok");
  ok(!parseTwentiesInput("").ok, "blank refused");
  ok(!parseTwentiesInput("0").ok, "zero refused");
  ok(!parseTwentiesInput("-5").ok, "negative refused");
  ok(!parseTwentiesInput("1600.00").ok, "dollar amount refused");
  ok(!parseTwentiesInput("$1600").ok, "dollar sign refused");
  ok(!parseTwentiesInput("1,600").ok, "comma refused");
  ok(!parseTwentiesInput("8.5").ok, "half bill refused");
  ok(!parseTwentiesInput("abc").ok, "letters refused");
  ok(!parseTwentiesInput("1e3").ok, "exponent refused");
  ok(!parseTwentiesInput("251", 250).ok, "over owner cap refused");
  ok(parseTwentiesInput("250", 250).ok, "at owner cap ok");
  ok(!parseTwentiesInput("2501", 99999).ok, "hard cap applies even when setting is larger");
  const pe = parseTwentiesInput("1600.00");
  ok(!pe.ok && /NUMBER of \$20/.test(pe.error), "dollar-amount message says count bills");

  // validateAtmDropFields
  const v0 = validateAtmDropFields({});
  ok(v0.ok && v0.destination === "safe", "no destination = safe (old builds)");
  ok(validateAtmDropFields({ destination: "safe" }).ok, "explicit safe");
  ok(!validateAtmDropFields({ destination: "safe", twentiesCount: 5 }).ok, "safe with count refused");
  ok(!validateAtmDropFields({ destination: "pocket" }).ok, "unknown destination refused");
  const v1 = validateAtmDropFields({ destination: "atm", twentiesCount: 80 });
  ok(v1.ok && v1.destination === "atm" && v1.amountMinor === 160000, "atm derives amount");
  ok(validateAtmDropFields({ destination: "atm", twentiesCount: 80, amountMinor: 160000 }).ok, "atm agreeing amount ok");
  ok(!validateAtmDropFields({ destination: "atm", twentiesCount: 80, amountMinor: 150000 }).ok, "atm disagreeing amount refused");
  ok(!validateAtmDropFields({ destination: "atm" }).ok, "atm without count refused");
  ok(!validateAtmDropFields({ destination: "atm", twentiesCount: 2.5 }).ok, "fractional count refused");
  ok(!validateAtmDropFields({ destination: "atm", twentiesCount: 0 }).ok, "zero count refused");
  ok(!validateAtmDropFields({ destination: "atm", twentiesCount: 2501 }).ok, "over hard cap refused");

  // settings
  const s0 = normalizeAtmDropSettings(null);
  ok(s0.enabled && s0.terminalId === "HG26499" && s0.witness === "recommended" && s0.maxTwentiesPerDrop === 250, "defaults");
  const s1 = normalizeAtmDropSettings({ enabled: false, terminalId: " hg1 ", witness: "required", maxTwentiesPerDrop: 100, matchWindowMinutes: 60 });
  ok(!s1.enabled && s1.terminalId === "HG1" && s1.witness === "required" && s1.maxTwentiesPerDrop === 100 && s1.matchWindowMinutes === 60, "stored values read");
  const s2 = normalizeAtmDropSettings({ terminalId: "bad id!", witness: "maybe", maxTwentiesPerDrop: 0, matchWindowMinutes: 5 });
  ok(s2.terminalId === "HG26499" && s2.witness === "recommended" && s2.maxTwentiesPerDrop === 250 && s2.matchWindowMinutes === 120, "bad values fall back");
  ok(normalizeAtmDropSettings([1, 2]).enabled === true, "array is not settings");

  // note tag
  ok(atmDropNoteTag(80, "HG26499") === "[ATM drop: 80 x $20 into HG26499]", "tag shape");
  ok(withAtmDropNoteTag("busy night", 5, null) === "busy night [ATM drop: 5 x $20]", "tag appended");
  ok(withAtmDropNoteTag("[ATM drop: 5 x $20]", 5, null) === "[ATM drop: 5 x $20]", "no duplicate tag");
  const t = parseAtmDropNoteTag("x [ATM drop: 12 x $20 into HG26499] y");
  ok(t !== null && t.twenties === 12 && t.terminalId === "HG26499", "tag parsed");
  ok(parseAtmDropNoteTag("nothing here") === null, "no tag");

  // readDropDestination
  ok(readDropDestination({ amount_minor: 5000 }).destination === "safe", "old row is safe");
  const rAtm = readDropDestination({ amount_minor: 160000, destination: "atm", twenties_count: 80, atm_terminal_id: "HG26499" });
  ok(rAtm.destination === "atm" && rAtm.twenties === 80 && !rAtm.fromNote, "column atm");
  const rNote = readDropDestination({ amount_minor: 24000, notes: "[ATM drop: 12 x $20 into HG26499]" });
  ok(rNote.destination === "atm" && rNote.fromNote && rNote.twenties === 12, "pre-0346 note atm");
  ok(readDropDestination({ amount_minor: 99900, notes: "[ATM drop: 12 x $20]" }).destination === "safe", "lookalike tag with wrong amount stays safe");
  ok(readDropDestination({ amount_minor: 24000, destination: "safe", notes: "[ATM drop: 12 x $20]" }).destination === "atm", "rollback-tagged row reads atm");

  // split
  const sp = splitDrops([
    { amount_minor: 100000 },
    { amount_minor: 160000, destination: "atm", twenties_count: 80 },
    { amount_minor: 24000, notes: "[ATM drop: 12 x $20]" },
    { amount_minor: 50000, destination: "safe" },
  ]);
  ok(sp.totalMinor === 334000, "total includes every drop (drawer + 2k banner)");
  ok(sp.safeMinor === 150000 && sp.safeCount === 2, "safe only for deposit / EOD");
  ok(sp.atmMinor === 184000 && sp.atmCount === 2 && sp.atmTwenties === 92, "atm split");
  ok(splitDrops([]).totalMinor === 0, "empty split");

  // labels and messages
  ok(dropDestinationLabel({ amount_minor: 160000, destination: "atm", twenties_count: 80, atm_terminal_id: "HG26499" }) === "ATM HG26499 - 80 x $20", "label atm");
  ok(dropDestinationLabel({ amount_minor: 1 }) === "Safe", "label safe");
  ok(/80 x \$20 = \$1,600\.00 recorded for ATM HG26499/.test(atmDropSuccessMessage(80, "HG26499")), "success message");
  ok(/Saved on this iPad/.test(atmDropSuccessMessage(1, null, true)), "offline message");

  // witness
  ok(!atmWitnessCheck("required", false).allowed, "required blocks without witness");
  const wr = atmWitnessCheck("recommended", false);
  ok(wr.allowed && wr.flag, "recommended allows and flags");
  ok(!atmWitnessCheck("off", false).flag, "off does not flag");
  ok(!atmWitnessCheck("required", true).flag, "witness present never flags");

  // buildDropInsertRows (S2)
  const base = { session_id: "s", amount_minor: 160000, drop_window: "night", dropped_by: "e", witnessed_by: null, notes: "hi" };
  const rA = buildDropInsertRows(base, { destination: "atm", twentiesCount: 80, terminalId: "HG26499", deviceId: "dev1", recordedVia: "register" });
  ok(rA.full.destination === "atm" && rA.full.twenties_count === 80 && rA.full.atm_terminal_id === "HG26499" && rA.full.recorded_via === "register", "insert row: ATM columns set");
  ok(rA.fallback.destination === undefined && readDropDestination(rA.fallback as DropRowLike).destination === "atm", "insert fallback: no 0346 columns, note tag keeps it an ATM drop");
  const rS = buildDropInsertRows({ ...base, amount_minor: 50000 }, { destination: "safe", terminalId: "HG26499", recordedVia: "offline" });
  ok(rS.full.destination === "safe" && rS.full.twenties_count === null && rS.full.atm_terminal_id === null && rS.fallback.notes === "hi", "insert row: safe drop carries no ATM fields, notes untouched");
  ok(buildDropInsertRows(base, { destination: "atm", twentiesCount: 80, deviceId: "x".repeat(200), recordedVia: "register" }).full.device_id === null, "insert row: oversize device id dropped, not refused");
  return { passed, failed };
}
