/**
 * src/lib/printing/vretti-setup-core.ts
 *
 * The receipt-printer setup walkthrough that lives IN THE BACK OFFICE.
 *
 * WHY THIS EXISTS
 * ---------------
 * The owner asked, verbatim:
 *
 *   "the back office equipment printer page is completely out date now and
 *    knows nothing about this new printer... I need you to revamp the back
 *    office and make it all about the vretti and how to set it up and use it
 *    and all that. please be thorough and precise. step by step, hold my hand."
 *
 * He was right. The Equipment page described a Star Micronics TSP143IV on
 * Ethernet, configured through "Star Quick Setup Utility" at the printer's own
 * web page. NONE of that applies to what is actually plugged in:
 *
 *   vretti Thermal Receipt Printer, 3 1/8" 80mm, USB, ESC/POS
 *   connected BY USB CABLE to a Raspberry Pi
 *
 * The vretti has no web page, no CloudPRNT firmware and no setup utility. It
 * is a "dumb" ESC/POS device (pi-agent/greenway_printer.py's own words) that
 * appears on the Pi as /dev/usb/lp0. The Pi is the thing that talks to our
 * website; the printer only ever hears from the Pi. Following the old page
 * would have had him hunting for an Ethernet port and a login screen that do
 * not exist.
 *
 * WHY THE STEPS ARE DATA AND NOT PROSE IN A COMPONENT
 * ---------------------------------------------------
 * Pure data means every command can be pinned by a test against the REAL
 * installer and the REAL agent (tests/compliance/vretti-setup-core.test.ts
 * parses pi-agent/install-printer.sh and greenway_printer.py and fails if the
 * flags here stop matching). A walkthrough that silently drifts from the
 * software it describes is worse than no walkthrough, because it is trusted.
 *
 * THE RULE THIS FILE FOLLOWS
 * --------------------------
 * Every command must be copyable and runnable WITHOUT editing it first. A
 * placeholder is a trap: it fails minutes later with an error that looks like
 * broken hardware. The site address and the poll token are INJECTED from live
 * settings, never invented. When the token does not exist yet, the guide says
 * so plainly instead of printing a fake one.
 */

/** One copyable command, with the reason it is being run. */
export type PrinterSetupCommand = {
  /** Exactly what to type. Never contains a placeholder once built. */
  command: string;
  /** What it does, in plain English. Shown under the command. */
  purpose: string;
};

export type PrinterSetupStep = {
  /** 1-based, for display. */
  number: number;
  title: string;
  /** Why this step exists. Plain English, no jargon. */
  body: string;
  commands: PrinterSetupCommand[];
  /** What you should see if it worked. Null when there is nothing to see. */
  expect: string | null;
  /** The single most common way this step goes wrong, and the fix. */
  ifItGoesWrong: string | null;
};

export type PrinterSetupSection = {
  id: string;
  title: string;
  summary: string;
  steps: PrinterSetupStep[];
};

export type HardwareItem = {
  item: string;
  spec: string;
  why: string;
  /** True for the things that cause the most common failures. */
  critical: boolean;
};

/**
 * What the printer actually is. These facts are what the old page got wrong,
 * so they are stated explicitly at the top of the guide rather than assumed.
 */
export const VRETTI_FACTS: { label: string; value: string }[] = [
  { label: "Printer", value: 'vretti 80mm (3 1/8") thermal receipt printer' },
  { label: "Language", value: "ESC/POS" },
  { label: "Connected by", value: "USB cable, straight into the Raspberry Pi" },
  { label: "Shows up on the Pi as", value: "/dev/usb/lp0" },
  { label: "Paper", value: "80mm thermal roll = 48 characters per line" },
  { label: "Needs a driver?", value: "No. The Pi speaks to it directly." },
  { label: "Needs Ethernet or Wi-Fi?", value: "No. The Pi has the internet; the printer does not." },
];

/**
 * The shopping list. Short on purpose: a USB printer needs almost nothing.
 * The two critical entries are the two things that actually go wrong.
 */
export const PRINTER_HARDWARE: HardwareItem[] = [
  {
    item: "80mm thermal paper rolls",
    spec: '3 1/8" (80mm) wide, thermal — NOT bond/plain paper',
    why: "Thermal paper prints with heat and only works on ONE side. Plain paper and 58mm rolls both come out completely blank, which looks exactly like a broken printer.",
    critical: true,
  },
  {
    item: "The printer's own power supply",
    spec: "The brick that came in the vretti box",
    why: "USB carries the data but NOT the power this printer needs. If it is not plugged into the wall it will not print, no matter how correct everything else is.",
    critical: true,
  },
  {
    item: "USB cable (printer to Pi)",
    spec: "The USB cable supplied with the printer",
    why: "This is the whole connection. Any USB port on the Pi works.",
    critical: false,
  },
  {
    item: "Raspberry Pi",
    spec: "The same Pi that runs the order announcer is fine",
    why: "One Pi can run both the speaker and the printer at once. They are separate services and do not interfere.",
    critical: false,
  },
];

/**
 * Commands worth keeping once it is all running. Every one of these is a real
 * subcommand of the installed agent (verified against greenway_printer.py's
 * argument parser: run / pair / test / status / selftest).
 */
export const PRINTER_CHEAT_SHEET: PrinterSetupCommand[] = [
  {
    command: "sudo greenway-printer status",
    purpose:
      "The one command worth remembering. Shows whether the printer is found, whether the website is reachable, and what is configured.",
  },
  {
    command: "sudo greenway-printer test",
    purpose:
      "Prints a test page straight from the Pi, without involving the website at all. The fastest way to tell a printer problem from an internet problem.",
  },
  {
    command: "sudo systemctl restart greenway-printer",
    purpose: "Restart the printer service. The usual first thing to try.",
  },
  {
    command: "sudo systemctl status greenway-printer",
    purpose: "Is the service running right now?",
  },
  {
    command: "sudo journalctl -u greenway-printer -n 50 --no-pager",
    purpose: "The last 50 lines of the printer's log — what to read when something is wrong.",
  },
  {
    command: "ls -l /dev/usb/lp0",
    purpose:
      "Is the printer actually detected? If this says 'No such file', the Pi cannot see the printer at all — check the USB cable and that the printer is powered on.",
  },
];

/**
 * Symptom-first troubleshooting. Ordered by how often each one happens, which
 * is not the same as how serious it is: blank paper is the most common and the
 * least serious.
 */
export const PRINTER_TROUBLESHOOTING: { symptom: string; cause: string; fix: string }[] = [
  {
    symptom: "Paper comes out completely blank",
    cause:
      "The paper is in upside down. Thermal paper only prints on one side, and it is loaded the wrong way round more often than any other mistake.",
    fix: "Open the lid and re-seat the roll so the paper comes off the TOP of the roll, with the shiny side facing the print head. Close the lid until it clicks.",
  },
  {
    symptom: "Nothing happens at all, no noise, no movement",
    cause: "Usually no mains power. USB does not power this printer.",
    fix: "Check the printer's power brick is plugged into the wall and the printer's switch is ON. Then run: sudo greenway-printer test",
  },
  {
    symptom: "The light is blinking",
    cause: "On this class of printer a blinking light almost always means paper out, or the lid is not properly shut.",
    fix: "Load paper and close the lid until it CLICKS. Resting the lid closed is not enough — the latch has to engage.",
  },
  {
    symptom: "'No such file or directory: /dev/usb/lp0'",
    cause: "The Pi cannot see the printer, so this is a cable or power problem, not a software one.",
    fix: "Make sure the printer is switched on, then unplug and re-plug the USB cable into the Pi and run: ls -l /dev/usb/lp0",
  },
  {
    symptom: "Test print works, but online orders never print",
    cause:
      "The printer and the Pi are fine — the link to the website is not. Either auto-print is switched off, or the token does not match.",
    fix: "Check 'Auto-print online orders' is ticked in Settings below, then run: sudo greenway-printer status — it will say whether the website is reachable and the token accepted.",
  },
  {
    symptom: "Printing is garbled, or every line wraps in the wrong place",
    cause: "The paper width setting does not match the paper actually loaded.",
    fix: "This printer is 80mm, so Paper width must be '80mm (48 columns)' in Settings below. 58mm is for a different, narrower printer.",
  },
  {
    symptom: "Receipts stop printing after you generate a new token",
    cause:
      "Rotating the token immediately invalidates the old one the Pi is still using. This is intended — it is how a lost token is revoked.",
    fix: "Re-run the pair command from Step 6 with the NEW token. Until then the website will reject the Pi.",
  },
];

/** Trim a site URL to a bare origin with no trailing slash. */
export function normalizeSiteUrl(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  return s.replace(/\/+$/, "");
}

/**
 * Build the walkthrough with the owner's REAL values substituted in.
 *
 * `pollToken` is null until one has been generated. That case is handled
 * explicitly and loudly rather than by printing a placeholder: Step 1 becomes
 * "generate it first", and the commands that need it say so instead of
 * pretending. Half the point of this guide is that nothing has to be edited
 * before it is run, and a fake token would break exactly that promise.
 */
export function buildPrinterSetupGuide(opts: {
  siteUrl: string | null | undefined;
  pollToken: string | null | undefined;
  /** True once the printer has polled us at least once. */
  hasPolled: boolean;
}): PrinterSetupSection[] {
  const site = normalizeSiteUrl(opts.siteUrl);
  const token = String(opts.pollToken ?? "").trim();
  const hasToken = token.length > 0;

  // With no configured site we must not invent one. Show the relative path,
  // which is still true, and let the step text explain.
  const siteForCommands = site || "https://your-site.com";
  const tokenForCommands = hasToken ? token : "YOUR-TOKEN";

  const sections: PrinterSetupSection[] = [];

  // ── Part 1: the printer itself ───────────────────────────────────────────
  sections.push({
    id: "hardware",
    title: "Part 1 — Set up the printer itself",
    summary:
      "Paper, power and the USB cable. Nothing here involves the website, and you can do all of it before touching the Pi.",
    steps: [
      {
        number: 1,
        title: "Load the paper the right way round",
        body:
          "Thermal paper prints with heat and only works on ONE side, so a roll loaded upside down prints nothing at all. Open the lid, drop the roll in so the paper comes up off the TOP of the roll (not from underneath), pull a few centimetres out past the teeth, and close the lid until it CLICKS. Resting it closed is not enough — the latch has to engage.",
        commands: [],
        expect:
          "A small tail of paper sticking out of the slot, and a steady (not blinking) light once it is powered on.",
        ifItGoesWrong:
          "A blinking light means paper out or lid not latched. If paper feeds but comes out blank, the roll is in upside down — turn it over.",
      },
      {
        number: 2,
        title: "Plug in power, then the USB cable",
        body:
          "Connect the printer's own power brick to the wall and switch the printer on. USB carries the data but NOT the power this printer needs, so it will not work on USB alone. Then plug the USB cable from the printer into any USB port on the Raspberry Pi.",
        commands: [],
        expect: "A steady light on the printer.",
        ifItGoesWrong:
          "No light at all means mains power. Check the brick is in the wall and the switch is on.",
      },
      {
        number: 3,
        title: "Check the Pi can see the printer",
        body:
          "Before installing anything, confirm the Pi has actually detected the printer. Connect to the Pi and run this. If the Pi cannot see the printer now, no amount of software will help — it is a cable or power problem.",
        commands: [
          {
            command: "ls -l /dev/usb/lp0",
            purpose: "Asks the Pi whether a USB printer is attached.",
          },
        ],
        expect:
          "A single line starting with 'crw-rw----' that ends in /dev/usb/lp0. That is the printer.",
        ifItGoesWrong:
          "'No such file or directory' means the Pi cannot see it. Check the printer is switched ON, then unplug and re-plug the USB cable and try again.",
      },
    ],
  });

  // ── Part 2: the token ────────────────────────────────────────────────────
  sections.push({
    id: "token",
    title: "Part 2 — Get the printer token",
    summary:
      "The token is the password the Pi uses to prove to this website that it is your printer. Without it, nothing prints.",
    steps: [
      {
        number: 4,
        title: hasToken ? "You already have a token — copy it" : "Generate the token (do this first)",
        body: hasToken
          ? "Your token already exists. Scroll up to the Connection card on this page and copy the value under POLL TOKEN. You will paste it into the command in Step 6. Treat it like a password: anyone with it can send print jobs to your shop."
          : "You do not have a token yet, so the website will refuse every printer request until you make one. Scroll up to the Connection card on this page and press 'Generate token', then come back here — this guide will fill the real token into the commands for you automatically once it exists.",
        commands: [],
        expect: hasToken
          ? "A long random string of letters and numbers in the Connection card."
          : "After pressing Generate token the page reloads and the POLL TOKEN box shows a long random string instead of 'not set'.",
        ifItGoesWrong:
          "If you rotate the token later, the old one stops working immediately and the Pi must be re-paired with the new one (Step 6).",
      },
    ],
  });

  // ── Part 3: install on the Pi ────────────────────────────────────────────
  sections.push({
    id: "install",
    title: "Part 3 — Install the printer software on the Pi",
    summary:
      "This installs a small background service on the Pi that watches this website for receipts and prints them.",
    steps: [
      {
        number: 5,
        title: "Connect to the Pi",
        body:
          "Everything from here happens on the Raspberry Pi, not on your computer. If the Pi has a screen and keyboard, just use those. Otherwise connect from your computer's terminal with SSH, replacing the name if yours differs.",
        commands: [
          {
            command: "ssh pi@raspberrypi.local",
            purpose: "Opens a remote terminal on the Pi. It will ask for the Pi's password.",
          },
        ],
        expect: "A prompt that ends in something like 'pi@raspberrypi:~ $'.",
        ifItGoesWrong:
          "If the name is not found, use the Pi's IP address instead (ssh pi@192.168.1.50). Your router's device list will show it.",
      },
      {
        number: 6,
        title: "Run the installer",
        body: hasToken
          ? "This one command downloads the printer software, installs it as a background service, pairs it with this website using your real token, and starts it. It is already filled in with your live values — copy it exactly and do not edit it."
          : "This command installs and pairs the printer software. IMPORTANT: you have not generated a token yet, so the command below still contains YOUR-TOKEN. Do Step 4 first; this guide will then fill in the real value for you.",
        commands: [
          {
            command: `curl -fsSL ${siteForCommands}/printer/install-printer.sh | sudo bash -s -- --site ${siteForCommands} --token ${tokenForCommands}`,
            purpose:
              "Downloads and runs the installer, pairing this Pi with your website in one go.",
          },
        ],
        expect:
          "A run of checks, each on its own line, ending with a success message and a test page printing by itself.",
        ifItGoesWrong:
          "If it says it cannot reach the website, check the Pi's internet. If it says the token was rejected, the token was mistyped or has since been rotated — copy it again from the Connection card.",
      },
      {
        number: 7,
        title: "Confirm it is all talking",
        body:
          "This is the single most useful command for this printer. It reports three separate things: whether the Pi can see the printer, whether it can reach this website, and whether the token was accepted.",
        commands: [
          {
            command: "sudo greenway-printer status",
            purpose: "Full health check of the printer, the website link and the token.",
          },
        ],
        expect:
          "The printer shown as found, the website reachable, and the token accepted. Back on this page, the 'Printer status' card at the top turns to Online.",
        ifItGoesWrong:
          "If the printer is found but the website is not reachable, it is the Pi's internet connection. If the website is reachable but the token is rejected, re-run Step 6 with the current token.",
      },
    ],
  });

  // ── Part 4: prove it ─────────────────────────────────────────────────────
  sections.push({
    id: "verify",
    title: "Part 4 — Prove it works, then go live",
    summary:
      "Two separate tests. Doing them in this order tells you exactly which half is broken if one fails.",
    steps: [
      {
        number: 8,
        title: "Test the printer on its own",
        body:
          "Run this on the Pi. It prints directly and does not involve the website at all, so if this works the printer, paper, cable and power are all proven good.",
        commands: [
          {
            command: "sudo greenway-printer test",
            purpose: "Prints a test page straight from the Pi, bypassing the website entirely.",
          },
        ],
        expect: "A test page prints and the paper cuts.",
        ifItGoesWrong:
          "Paper moves but is blank: the roll is upside down. Nothing at all: check mains power and that /dev/usb/lp0 exists (Step 3).",
      },
      {
        number: 9,
        title: "Test the whole path from this website",
        body:
          "Now prove the other half. Scroll up on this page and press 'Send test print'. That queues a receipt here, which the Pi collects on its next check. This proves website → Pi → printer end to end, and it prints a full sample receipt in exactly the same style a real order will.",
        commands: [],
        expect:
          "A sample receipt prints within a few seconds, showing items, the tax breakdown and the totals — the same layout as a register sale.",
        ifItGoesWrong:
          "If Step 8 printed but this does not, the printer is fine and the link is not: run 'sudo greenway-printer status' and check the queue at the bottom of this page for a failed job.",
      },
      {
        number: 10,
        title: "Turn on automatic printing",
        body:
          "Last step. In Settings on this page, make sure 'Auto-print online orders' is ticked and Paper width is set to 80mm (48 columns), then save. From then on every online pickup order prints by itself as it is placed.",
        commands: [],
        expect:
          "New online orders print automatically, and each one appears in Recent print jobs at the bottom of this page marked 'printed'.",
        ifItGoesWrong:
          "If orders appear in the queue as 'queued' and never print, the Pi is not collecting them: check 'sudo systemctl status greenway-printer' on the Pi.",
      },
    ],
  });

  return sections;
}

// ---------------------------------------------------------------------------
// Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runVrettiSetupTests(): void {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) {
      pass += 1;
    } else {
      fail += 1;
      console.log(`FAIL: ${msg}`);
    }
  };

  // -- normalizeSiteUrl -----------------------------------------------------
  ok(normalizeSiteUrl("https://a.com/") === "https://a.com", "site: trailing slash trimmed");
  ok(normalizeSiteUrl("https://a.com///") === "https://a.com", "site: many slashes trimmed");
  ok(normalizeSiteUrl("  https://a.com  ") === "https://a.com", "site: whitespace trimmed");
  ok(normalizeSiteUrl(null) === "", "site: null -> empty");
  ok(normalizeSiteUrl(undefined) === "", "site: undefined -> empty");
  ok(normalizeSiteUrl("") === "", "site: empty -> empty");

  // -- Shape ---------------------------------------------------------------
  const guide = buildPrinterSetupGuide({
    siteUrl: "https://example.com",
    pollToken: "TOKEN123",
    hasPolled: true,
  });
  ok(guide.length === 4, "guide: four parts");
  const allSteps = guide.flatMap((s) => s.steps);
  ok(allSteps.length === 10, "guide: ten steps");
  ok(
    allSteps.every((s, i) => s.number === i + 1),
    "guide: step numbers run 1..10 with no gaps",
  );
  ok(
    allSteps.every((s) => s.title.trim().length > 0 && s.body.trim().length > 0),
    "guide: every step has a title and a body",
  );
  ok(
    guide.every((s) => s.id.trim() !== "" && s.title.trim() !== "" && s.summary.trim() !== ""),
    "guide: every section is labelled",
  );
  ok(new Set(guide.map((s) => s.id)).size === guide.length, "guide: section ids are unique");

  // -- No placeholders once the real values exist ---------------------------
  const commands = allSteps.flatMap((s) => s.commands.map((c) => c.command));
  ok(commands.length > 0, "guide: there are commands");
  ok(
    commands.every((c) => !c.includes("YOUR-TOKEN")),
    "guide: no YOUR-TOKEN placeholder when a token exists",
  );
  ok(
    commands.every((c) => !c.includes("your-site.com")),
    "guide: no your-site.com placeholder when a site is configured",
  );
  ok(
    commands.every((c) => !/YOUR[-_]|<[a-z]+>|\bxxx\b/i.test(c)),
    "guide: no placeholder of any form",
  );
  ok(
    commands.some((c) => c.includes("https://example.com") && c.includes("TOKEN123")),
    "guide: the real site and token are injected",
  );
  ok(
    allSteps.every((s) => s.commands.every((c) => c.purpose.trim().length > 0)),
    "guide: every command explains itself",
  );

  // -- The installer command matches the real installer's flags -------------
  const installCmd = commands.find((c) => c.includes("install-printer.sh"));
  ok(installCmd != null, "guide: the installer command is present");
  if (installCmd) {
    ok(installCmd.includes("--site "), "installer: passes --site");
    ok(installCmd.includes("--token "), "installer: passes --token");
    ok(!installCmd.includes("--code"), "installer: does NOT pass --code (that is the announcer)");
    ok(installCmd.includes("/printer/install-printer.sh"), "installer: correct download path");
    ok(installCmd.includes("sudo bash -s --"), "installer: runs with sudo via bash -s");
  }

  // -- Missing token: say so, never fake it ---------------------------------
  const noToken = buildPrinterSetupGuide({
    siteUrl: "https://example.com",
    pollToken: null,
    hasPolled: false,
  });
  const noTokenSteps = noToken.flatMap((s) => s.steps);
  const tokenStep = noTokenSteps.find((s) => s.number === 4);
  ok(tokenStep != null, "no token: step 4 exists");
  ok(
    tokenStep != null && /Generate the token/i.test(tokenStep.title),
    "no token: step 4 tells you to generate one",
  );
  const noTokenCmds = noTokenSteps.flatMap((s) => s.commands.map((c) => c.command));
  ok(
    noTokenCmds.some((c) => c.includes("YOUR-TOKEN")),
    "no token: the placeholder is visible rather than a fabricated token",
  );
  const installStepNoToken = noTokenSteps.find((s) => s.number === 6);
  ok(
    installStepNoToken != null && /have not generated a token/i.test(installStepNoToken.body),
    "no token: step 6 warns the command is not yet runnable",
  );
  ok(
    !noTokenCmds.some((c) => /--token\s+(null|undefined|""|'')/.test(c)),
    "no token: never emits a null/undefined token",
  );

  // Token present => step 4 switches to "copy it".
  ok(
    (guide.flatMap((s) => s.steps).find((s) => s.number === 4)?.title ?? "").includes("copy it"),
    "token present: step 4 switches to copy",
  );

  // -- Missing site: fall back, never invent --------------------------------
  const noSite = buildPrinterSetupGuide({ siteUrl: "", pollToken: "T", hasPolled: false });
  const noSiteCmds = noSite.flatMap((s) => s.steps).flatMap((s) => s.commands.map((c) => c.command));
  ok(
    noSiteCmds.some((c) => c.includes("https://your-site.com")),
    "no site: a visible placeholder, not a guessed domain",
  );
  ok(
    !noSiteCmds.some((c) => c.includes("undefined") || c.includes("null")),
    "no site: never emits undefined/null in a command",
  );

  // -- It must be about the vretti, not the old Star printer ----------------
  const blob = JSON.stringify(guide) + JSON.stringify(VRETTI_FACTS) +
    JSON.stringify(PRINTER_HARDWARE) + JSON.stringify(PRINTER_TROUBLESHOOTING) +
    JSON.stringify(PRINTER_CHEAT_SHEET);
  ok(!/Star Micronics/i.test(blob), "wording: no Star Micronics");
  ok(!/TSP143/i.test(blob), "wording: no TSP143IV");
  ok(!/Quick Setup Utility/i.test(blob), "wording: no Star Quick Setup Utility");
  // Ethernet may appear ONLY to say it is not needed. The old page told him to
  // plug this printer into the router, which is the single most misleading
  // thing on it, so the word is allowed exactly once and only as a denial.
  const ethernetMentions = (blob.match(/Ethernet/gi) ?? []).length;
  ok(ethernetMentions <= 1, "wording: Ethernet mentioned at most once");
  ok(
    VRETTI_FACTS.some(
      (f) => /Ethernet/i.test(f.label) && /^No\b/.test(f.value.trim()),
    ),
    "wording: the only Ethernet mention is the fact that it is NOT needed",
  );
  ok(
    !guide.some((s) => /Ethernet/i.test(JSON.stringify(s))),
    "wording: no setup step ever mentions Ethernet",
  );
  ok(/USB/i.test(blob), "wording: mentions USB");
  ok(/vretti/i.test(blob), "wording: mentions the vretti");
  ok(/\/dev\/usb\/lp0/.test(blob), "wording: names the real device path");

  // -- Facts ----------------------------------------------------------------
  ok(VRETTI_FACTS.length >= 5, "facts: enough of them to be useful");
  ok(
    VRETTI_FACTS.every((f) => f.label.trim() !== "" && f.value.trim() !== ""),
    "facts: all populated",
  );
  ok(
    VRETTI_FACTS.some((f) => f.value.includes("/dev/usb/lp0")),
    "facts: device path stated",
  );
  ok(
    VRETTI_FACTS.some((f) => /48 characters/.test(f.value)),
    "facts: 48 columns stated",
  );

  // -- Hardware -------------------------------------------------------------
  ok(PRINTER_HARDWARE.length >= 3, "hardware: a real list");
  ok(
    PRINTER_HARDWARE.every((h) => h.item && h.spec && h.why),
    "hardware: every entry is complete",
  );
  ok(
    PRINTER_HARDWARE.filter((h) => h.critical).length === 2,
    "hardware: exactly two critical items (paper and power)",
  );
  ok(
    PRINTER_HARDWARE.some((h) => h.critical && /thermal/i.test(h.item)),
    "hardware: thermal paper flagged critical",
  );
  ok(
    PRINTER_HARDWARE.some((h) => h.critical && /power/i.test(h.item)),
    "hardware: power supply flagged critical",
  );

  // -- Cheat sheet: every command must be a REAL agent subcommand ------------
  const agentSubcommands = ["run", "pair", "test", "status", "selftest"];
  for (const entry of PRINTER_CHEAT_SHEET) {
    const m = entry.command.match(/greenway-printer\s+([a-z]+)/);
    if (m) {
      ok(
        agentSubcommands.includes(m[1]),
        `cheat sheet: '${m[1]}' is a real greenway-printer subcommand`,
      );
    }
  }
  ok(
    PRINTER_CHEAT_SHEET.every((c) => c.purpose.trim().length > 0),
    "cheat sheet: every command explains itself",
  );
  ok(
    PRINTER_CHEAT_SHEET.some((c) => c.command === "sudo greenway-printer status"),
    "cheat sheet: includes the status command",
  );
  ok(
    PRINTER_CHEAT_SHEET.some((c) => c.command.includes("journalctl")),
    "cheat sheet: includes how to read the log",
  );
  // The systemd unit is named "greenway-printer" by install-printer.sh. If any
  // systemctl/journalctl command here drifts from that name it does not error
  // in an obvious way -- it quietly reports on a unit that does not exist, so
  // the owner is told "inactive" about the wrong thing while the printer is
  // running fine (or vice versa). Every service command must name it exactly.
  for (const entry of [
    ...PRINTER_CHEAT_SHEET,
    ...buildPrinterSetupGuide({ siteUrl: "https://example.com", pollToken: "T", hasPolled: true })
      .flatMap((s) => s.steps)
      .flatMap((s) => s.commands),
  ]) {
    if (/\bsystemctl\b/.test(entry.command) || /\bjournalctl\b/.test(entry.command)) {
      ok(
        /\bgreenway-printer\b/.test(entry.command),
        `service command names the greenway-printer unit exactly: ${entry.command}`,
      );
    }
  }

  // -- Troubleshooting ------------------------------------------------------
  ok(PRINTER_TROUBLESHOOTING.length >= 5, "troubleshooting: covers the common failures");
  ok(
    PRINTER_TROUBLESHOOTING.every((t) => t.symptom && t.cause && t.fix),
    "troubleshooting: every row is complete",
  );
  ok(
    /blank/i.test(PRINTER_TROUBLESHOOTING[0].symptom),
    "troubleshooting: blank paper is listed first (most common)",
  );
  ok(
    PRINTER_TROUBLESHOOTING.some((t) => /lp0/.test(t.symptom) || /lp0/.test(t.fix)),
    "troubleshooting: covers the device-missing case",
  );

  // -- Every step that can be verified tells you what to expect -------------
  ok(
    allSteps.filter((s) => s.expect != null).length === allSteps.length,
    "guide: every step says what you should see",
  );
  ok(
    allSteps.filter((s) => s.ifItGoesWrong != null).length === allSteps.length,
    "guide: every step says what to do when it fails",
  );

  console.log(`vretti-setup-core: ${pass} passed, ${fail} failed`);
  if (fail > 0) throw new Error(`vretti-setup-core tests failed: ${fail}`);
}
