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

/**
 * WHO AND WHERE THIS PI ACTUALLY IS.
 *
 * These are not guesses and they are not the Raspberry Pi OS defaults. They
 * are read off the shop Pi's own prompt and working directory:
 *
 *     greenway-office@greenway-office:~/GREENWAY-WEBSITE $ git pull
 *     greenway-office@greenway-office:~/GREENWAY-WEBSITE $ ls -l /dev/usb/lp0
 *     crw-rw---- 1 root lp 180, 0 Sep 12 20:10 /dev/usb/lp0
 *
 * The first version of this guide said `ssh pi@raspberrypi.local`, which is
 * the factory default for a fresh Raspberry Pi OS image and is NOT this
 * machine. Following it produces "Permission denied" or "Could not resolve
 * hostname" at the very first step, which reads like a broken Pi rather than
 * a wrong instruction. An instruction that cannot work is worse than no
 * instruction, because it sends you looking for a fault that does not exist.
 */
export const DEFAULT_PI_USER = "greenway-office";
export const DEFAULT_PI_HOST = "greenway-office.local";
/**
 * The website checkout on the Pi. `~` is deliberately NOT used in commands:
 * `sudo` changes whose home `~` means, so a tilde inside a sudo command can
 * resolve to /root instead of the Pi user's home. Absolute paths cannot.
 */
export const DEFAULT_REPO_DIR = "/home/greenway-office/GREENWAY-WEBSITE";

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
  /** Login name on the Pi. Defaults to the shop's real one. */
  piUser?: string | null;
  /** Hostname of the Pi on the local network. */
  piHost?: string | null;
  /** Absolute path to the website checkout on the Pi. */
  repoDir?: string | null;
}): PrinterSetupSection[] {
  const site = normalizeSiteUrl(opts.siteUrl);
  const token = String(opts.pollToken ?? "").trim();
  const hasToken = token.length > 0;

  // With no configured site we must not invent one. Show the relative path,
  // which is still true, and let the step text explain.
  const siteForCommands = site || "https://your-site.com";
  const tokenForCommands = hasToken ? token : "YOUR-TOKEN";

  // The shop's Pi signs in as `greenway-office` and keeps the website checkout
  // at ~/GREENWAY-WEBSITE. The guide used to say `ssh pi@raspberrypi.local`,
  // which is the Raspberry Pi OS FACTORY default and simply is not this Pi:
  // running it gets "Permission denied" or "host not found", on step one, to
  // someone who has no way to know the instruction itself was wrong.
  // These are overridable so a second Pi never forces a code change.
  const piUser = String(opts.piUser ?? "").trim() || DEFAULT_PI_USER;
  const piHost = String(opts.piHost ?? "").trim() || DEFAULT_PI_HOST;
  const repoDir = String(opts.repoDir ?? "").trim() || DEFAULT_REPO_DIR;
  const agentDir = `${repoDir}/pi-agent`;

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
          "Before installing anything, confirm the Pi has actually detected the printer. Get to a terminal on the Pi (Step 5 explains both ways if you are not already there) and run this. It works from any folder.\n\nThis is the most valuable thirty seconds in the whole setup: if the Pi cannot see the printer now, no amount of software will fix it, because the problem is the cable, the power or the switch. Finding that out here saves you from blaming the install.",
        commands: [
          {
            command: "ls -l /dev/usb/lp0",
            purpose: "Asks the Pi whether a USB printer is attached.",
          },
        ],
        expect:
          "One line that looks almost exactly like this:\n\n  crw-rw---- 1 root lp 180, 0 Sep 12 20:10 /dev/usb/lp0\n\nOnly the date and time will differ. 'crw' means a character device, and 'root lp' means it belongs to the printer group — both are correct and nothing needs changing. The printer service runs with full privileges, so you do NOT need to adjust these permissions.",
        ifItGoesWrong:
          "'No such file or directory' means the Pi cannot see the printer. In order: check the printer's power light is on, check the switch, then unplug the USB cable and plug it back in, wait five seconds and run the command again. If it is still missing, run  lsusb  — if the printer is not in that list either, it is the cable or the power, not the Pi.",
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
        title: "Get to a terminal on the Pi",
        body:
          `Everything from here happens ON THE RASPBERRY PI, not on your laptop. There are two ways in and they are equally good.\n\nA) SITTING AT THE PI: if the Pi has its own screen and keyboard, open the Terminal app (the black screen icon in the top bar). You are already signed in as ${piUser} — there is no command to run for this, and you can skip straight to Step 6.\n\nB) FROM YOUR LAPTOP: open Terminal (Mac) or PowerShell (Windows) and run the command below. It will ask for the ${piUser} password — the one you use on the Pi itself. Nothing appears on screen while you type a password, not even dots. That is normal. Type it and press Enter.`,
        commands: [
          {
            command: `ssh ${piUser}@${piHost}`,
            purpose: `Opens a terminal on the Pi from another computer. ${piUser} is this Pi's login name.`,
          },
        ],
        expect: `A prompt that reads exactly: ${piUser}@${piUser.split(".")[0]}:~ $`,
        ifItGoesWrong:
          `"Could not resolve hostname" means the .local name is not being found on your network. Use the Pi's IP address instead — for example ssh ${piUser}@192.168.1.50. Find the address by running  hostname -I  on the Pi itself, or look in your router's device list. "Permission denied" means the password was wrong, not that anything is broken.`,
      },
      {
        number: 6,
        title: "Go to the folder that holds the installer",
        body:
          `This Pi already has a copy of the website's files at ${repoDir}. That copy includes the printer installer, so you do not have to download anything.\n\nWHY THIS MATTERS: running the installer from this folder makes it use the copy sitting right next to it. That is faster, works even if the Pi's internet is flaky, and avoids the one failure that is genuinely hard to diagnose — some web hosts answer an automated download with a security-check web page instead of the file, and the installer would otherwise be handed a web page where it expected a program.\n\nThe first command moves you into the folder. The second pulls down the newest version of everything. The third makes sure the two installer scripts are marked as runnable.`,
        commands: [
          {
            command: `cd ${agentDir}`,
            purpose: `Moves you into the folder holding install-printer.sh. The prompt will change to end in "pi-agent $".`,
          },
          {
            command: "git pull",
            purpose: "Fetches the newest printer software before installing it.",
          },
          {
            command: "chmod +x install-printer.sh install.sh",
            purpose: "Marks both installers as runnable. Harmless if they already are.",
          },
        ],
        expect:
          `The prompt ends in "pi-agent $", and git pull says either "Already up to date." or lists files it updated. chmod prints nothing at all — that means it worked.`,
        ifItGoesWrong:
          `"No such file or directory" means the website files are somewhere else on this Pi. Find them with:  ls ~  — then use that folder name instead. If the folder is missing entirely, create it with:  git clone https://github.com/mblyman89/GREENWAY-WEBSITE.git ~/GREENWAY-WEBSITE`,
      },
      {
        number: 7,
        title: "Run the printer installer",
        body: hasToken
          ? `Now install it. This command is already filled in with your real website address and your real token — copy it exactly as it appears and do not retype it by hand.\n\nYou must be in the ${agentDir} folder from Step 6 for this command, because the "./" at the front means "the installer in the folder I am standing in".\n\nWHERE DOES IT INSTALL? Not into this folder, and not wherever you happen to be standing. It always installs to the same fixed places on the Pi: the program goes to /usr/local/bin/greenway-printer, its settings to /etc/greenway-printer/, and it registers a background service called greenway-printer that starts on every boot. You never need to visit those folders.\n\nIt is safe to run twice. Re-running upgrades the software in place and keeps your settings.`
          : `IMPORTANT: you have not generated a token yet, so the command below still says YOUR-TOKEN and will not work. Go back and do Step 4 first — once the token exists this guide fills the real value in for you automatically.`,
        commands: [
          {
            command: `sudo ./install-printer.sh --site ${siteForCommands} --token ${tokenForCommands}`,
            purpose:
              "Installs the printer service, connects it to your website, and starts it. Uses the copy in this folder, so it downloads nothing.",
          },
        ],
        expect:
          `A list of checks, each on its own line, ending with a success message — and a test receipt printing by itself.`,
        ifItGoesWrong:
          `"sudo: ./install-printer.sh: command not found" means you are not in the right folder — run the Step 6 commands again. "Permission denied" means chmod was skipped — run  chmod +x install-printer.sh  and try again. If it stops and says the address is missing a ':', it is telling you the website address was mistyped, and it shows you the corrected version to use.`,
      },
      {
        number: 8,
        title: "Confirm it is all talking",
        body:
          "This is the single most useful command for this printer, and the one to run first any time something seems wrong. It reports three separate things: whether the Pi can see the printer, whether it can reach this website, and whether the token was accepted. The second command confirms the background service is running and will come back on its own after a power cut.\n\nThese two work from ANY folder — the installer put the program somewhere the Pi can always find it, so you do not need to be in pi-agent any more.",
        commands: [
          {
            command: "sudo greenway-printer status",
            purpose: "Full health check of the printer, the website link and the token.",
          },
          {
            command: "systemctl is-enabled greenway-printer",
            purpose: "Confirms it will restart by itself after a reboot or power cut.",
          },
        ],
        expect:
          "The printer shown as found, the website reachable, and the token accepted. The second command prints exactly one word: enabled. Back on this page, the 'Printer status' card at the top turns to Online.",
        ifItGoesWrong:
          "If the printer is found but the website is not reachable, it is the Pi's internet connection. If the website is reachable but the token is rejected, re-run Step 7 with the current token. If the second command says 'disabled', switch it on with:  sudo systemctl enable --now greenway-printer",
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
        number: 9,
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
        number: 10,
        title: "Test the whole path from this website",
        body:
          "Now prove the other half. Scroll up on this page and press 'Send test print'. That queues a receipt here, which the Pi collects on its next check. This proves website → Pi → printer end to end, and it prints a full sample receipt in exactly the same style a real order will.",
        commands: [],
        expect:
          "A sample receipt prints within a few seconds, showing items, the tax breakdown and the totals — the same layout as a register sale.",
        ifItGoesWrong:
          "If Step 9 printed but this does not, the printer is fine and the link is not: run 'sudo greenway-printer status' and check the queue at the bottom of this page for a failed job.",
      },
      {
        number: 11,
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

  // ── Part 5: updating a Pi that is already working ────────────────────────
  //
  // WHY THIS SECTION EXISTS. The always-on / keep-awake work is implemented
  // INSIDE pi-agent/install.sh (the Wi-Fi power-save drop-in, the
  // greenway-keep-awake service, masking sleep/suspend/hibernate, and screen
  // blanking). `git pull` copies that script onto the Pi but does not execute
  // a single line of it, so nothing under /usr/local/bin, /etc/systemd or
  // /etc/NetworkManager changes until the installer is RE-RUN.
  //
  // That gap is invisible from the outside: the files are visibly newer, so
  // it looks done. It is not done, and the Pi keeps dozing exactly as before.
  sections.push({
    id: "update",
    title: "Part 5 — Updating a Pi that is already set up",
    summary:
      "Do this after a 'git pull' to actually switch on new features like keep-awake. Pulling the files is not the same as installing them.",
    steps: [
      {
        number: 12,
        title: "Understand why a git pull is not enough",
        body:
          "This is the step people skip, so it is spelled out rather than assumed.\n\n'git pull' downloads the newest files into the website folder on the Pi. That is all it does. The always-on features — stopping the Wi-Fi radio from dozing, blocking sleep and suspend, and stopping the screen going black — are not files sitting in that folder waiting to work. They are settings that have to be WRITTEN into the Pi's system: a service in /usr/local/bin, a unit in /etc/systemd/system, and a network setting in /etc/NetworkManager.\n\nOnly the installer writes those. Until you run it, the Pi behaves exactly as it did before the pull, while looking fully updated. There is nothing to run for this step — it is the reason for the next two.",
        commands: [],
        expect: null,
        ifItGoesWrong: null,
      },
      {
        number: 13,
        title: "Re-run the announcer installer to apply always-on",
        body:
          `The keep-awake work lives in the ANNOUNCER installer (install.sh), not the printer one, because it was built to stop the order-announcing speaker from going quiet. It keeps the whole Pi awake, so it benefits the printer just as much.\n\nRun these in order. The first makes sure you have the newest files. The second installs a small tool the keep-awake service needs — if it is missing, the installer skips keep-awake with a warning that is easy to miss. The third applies everything.\n\nNOTICE THERE IS NO --code ON THE LAST COMMAND, AND THAT IS DELIBERATE. Re-running without a pairing code keeps your existing pairing exactly as it is; it says "Already paired - keeping the existing setup" and moves on. You do not need a new code and you will not lose anything.`,
        commands: [
          {
            command: `cd ${agentDir} && git pull`,
            purpose: "Moves to the installer folder and fetches the newest version.",
          },
          {
            command: "sudo apt install -y iw",
            purpose:
              "Installs the wireless tool the keep-awake service uses. Quick, and harmless if already present.",
          },
          {
            command: `sudo ./install.sh --site ${siteForCommands}`,
            purpose:
              "Re-runs the announcer installer, which applies all the always-on settings. Keeps your existing pairing.",
          },
        ],
        expect:
          `Lines confirming each piece as it is applied, including "Wi-Fi power saving disabled", "Wi-Fi radio set to stay awake, now and on every boot", "Sleep, suspend and hibernate are switched off for good", "Screen blanking turned off" and "Already paired - keeping the existing setup".`,
        ifItGoesWrong:
          `If you see "The 'iw' tool is missing", the second command did not work — run it on its own, watch for errors, then run the installer again. If it stops saying the address is missing a ':', it is telling you the website address was mistyped and showing you the corrected version.`,
      },
      {
        number: 14,
        title: "Prove the always-on settings actually took",
        body:
          "Do not take the installer's word for it — check the Pi itself. These four commands read the real system settings, so they tell you what is true right now rather than what was intended. They work from any folder.\n\nIf all four answer correctly, this Pi will not doze, will not sleep, will not blank its screen, and will bring it all back automatically after a power cut.",
        commands: [
          {
            command: "systemctl is-enabled greenway-keep-awake",
            purpose: "Confirms the keep-awake service runs on every boot.",
          },
          {
            command: "systemctl is-enabled sleep.target",
            purpose: "Confirms sleep has been blocked outright.",
          },
          {
            command: "iw dev wlan0 get power_save",
            purpose: "Asks the Wi-Fi radio directly whether it is allowed to doze.",
          },
          {
            command: "systemctl status greenway-printer --no-pager",
            purpose: "Confirms the printer service survived the update and is running.",
          },
        ],
        expect:
          "In order: the word 'enabled'; the word 'masked'; 'Power save: off'; and a block of text containing 'active (running)' in green.",
        ifItGoesWrong:
          "If the first says 'disabled' or 'No such file', the keep-awake service was skipped — almost always because 'iw' was missing. Install it and re-run Step 13. If the third says 'Power save: on', run  sudo /usr/local/bin/greenway-keep-awake  then check again. If wlan0 does not exist, this Pi is on a network cable and the Wi-Fi check does not apply — that is fine.",
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
  ok(guide.length === 5, "guide: five parts");
  const allSteps = guide.flatMap((s) => s.steps);
  ok(allSteps.length === 14, "guide: fourteen steps");
  ok(
    allSteps.every((s, i) => s.number === i + 1),
    "guide: step numbers run 1..14 with no gaps",
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
  //
  // The guide runs the installer from the git clone that is already on the Pi
  // (`sudo ./install-printer.sh`) rather than piping curl into bash. That is
  // not cosmetic. install-printer.sh looks for greenway_printer.py next to
  // itself first, so running it from pi-agent/ downloads nothing at all --
  // which removes the failure both installers explicitly guard against, where
  // a security gateway answers an automated download with an HTML CAPTCHA
  // page and the installer is handed a web page instead of a program.
  // Anchored: "chmod +x install-printer.sh" also contains that filename, and
  // matching it instead would test the wrong line entirely.
  const installCmd = commands.find((c) => c.startsWith("sudo ./install-printer.sh"));
  ok(installCmd != null, "guide: the installer command is present");
  if (installCmd) {
    ok(installCmd.includes("--site "), "installer: passes --site");
    ok(installCmd.includes("--token "), "installer: passes --token");
    ok(!installCmd.includes("--code"), "installer: does NOT pass --code (that is the announcer)");
    ok(installCmd.startsWith("sudo ./install-printer.sh"), "installer: run from the local clone");
    ok(!installCmd.includes("curl"), "installer: does not pipe a download into a shell");
  }
  // Running "./install-printer.sh" only works from the folder that holds it,
  // so the guide MUST have told you to go there first, and with an absolute
  // path -- `~` expands to /root under sudo, not to the Pi user's home.
  const cdCmd = commands.find((c) => c.startsWith("cd /"));
  ok(cdCmd != null, "guide: says which folder to be in before ./install-printer.sh");
  ok(
    cdCmd != null && cdCmd.includes("/pi-agent"),
    "guide: that folder is the one holding the installer",
  );
  ok(
    commands.every((c) => !c.includes("cd ~") && !c.includes(" ~/")),
    "guide: no tilde paths (sudo would resolve ~ to /root)",
  );

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
  // Found by the command it carries, not by a hardcoded number: renumbering
  // the guide must not be able to silently point this check at another step.
  const installStepNoToken = noTokenSteps.find((s) =>
    s.commands.some((c) => c.command.startsWith("sudo ./install-printer.sh")),
  );
  ok(
    installStepNoToken != null && /have not generated a token/i.test(installStepNoToken.body),
    "no token: the install step warns the command is not yet runnable",
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
    // Scoped to commands that are ABOUT the printer service. The guide also
    // drives greenway-keep-awake and reads sleep.target, and demanding the
    // printer's name in those would be demanding a wrong command.
    const isServiceCmd =
      /\bsystemctl\b/.test(entry.command) || /\bjournalctl\b/.test(entry.command);
    const namesAnotherUnit =
      /greenway-keep-awake|sleep\.target|suspend\.target|hibernate\.target/.test(entry.command);
    if (isServiceCmd && !namesAnotherUnit) {
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

  // -- The Pi is THIS Pi, not a factory-default one -------------------------
  //
  // The first version of this guide said `ssh pi@raspberrypi.local`. That is
  // the Raspberry Pi OS default and is not the shop's machine, whose own
  // prompt reads `greenway-office@greenway-office:~/GREENWAY-WEBSITE $`.
  // Following it fails at the first step in a way that looks like broken
  // hardware rather than a wrong instruction.
  const sshCmd = commands.find((c) => c.startsWith("ssh "));
  ok(sshCmd != null, "guide: tells you how to reach the Pi");
  ok(
    sshCmd != null && sshCmd.includes(DEFAULT_PI_USER),
    "guide: SSH uses the real login name on this Pi",
  );
  ok(
    commands.every((c) => !/\bpi@raspberrypi\b/.test(c)),
    "guide: never uses the factory-default pi@raspberrypi",
  );

  // -- Directory guidance is explicit and absolute --------------------------
  ok(
    commands.some((c) => c === `cd ${DEFAULT_REPO_DIR}/pi-agent`),
    "guide: names the exact folder to stand in",
  );
  const guideBlob = JSON.stringify(guide);
  ok(
    guideBlob.includes("/usr/local/bin/greenway-printer"),
    "guide: says where the software actually installs to",
  );
  ok(
    guideBlob.includes("/etc/greenway-printer"),
    "guide: says where the settings actually live",
  );

  // -- Updating an existing Pi ----------------------------------------------
  //
  // The keep-awake work lives INSIDE install.sh, so `git pull` copies it
  // without applying any of it. A guide that does not say so leaves a Pi that
  // looks updated and behaves exactly as it did before.
  const updateSection = guide.find((s) => s.id === "update");
  ok(updateSection != null, "guide: has a section for updating an existing Pi");
  ok(
    updateSection != null && /git pull/i.test(JSON.stringify(updateSection)),
    "guide: the update section explains the git pull gap",
  );
  const updateCmds = (updateSection?.steps ?? []).flatMap((s) =>
    s.commands.map((c) => c.command),
  );
  ok(
    updateCmds.some((c) => c.startsWith("sudo ./install.sh")),
    "update: re-runs the announcer installer, which is what applies keep-awake",
  );
  ok(
    updateCmds.every((c) => !c.includes("--code")),
    "update: never asks for a pairing code (re-running keeps the existing pairing)",
  );
  ok(
    updateCmds.some((c) => c.includes("apt install -y iw")),
    "update: installs the tool keep-awake needs, or it is silently skipped",
  );
  ok(
    updateCmds.some((c) => c.includes("systemctl is-enabled greenway-keep-awake")),
    "update: proves keep-awake took, rather than trusting the installer",
  );

  // -- Every step that DOES something tells you what to expect --------------
  // Scoped to steps with commands on purpose. One step is pure explanation
  // (why a git pull does not apply the always-on settings); demanding an
  // "expect" from a step that asks you to do nothing would only invite a
  // fabricated one, and a made-up expectation is worse than none.
  const doingSteps = allSteps.filter((s) => s.commands.length > 0);
  ok(doingSteps.length >= 8, "guide: most steps are things you actually run");
  ok(
    doingSteps.filter((s) => s.expect != null).length === doingSteps.length,
    "guide: every step with a command says what you should see",
  );
  ok(
    doingSteps.filter((s) => s.ifItGoesWrong != null).length === doingSteps.length,
    "guide: every step with a command says what to do when it fails",
  );
  // A step can have no command and still be a step you can get WRONG -- "load
  // the paper" is the clearest example, and "paper in upside down" is the most
  // common fault on a thermal printer there is. Exactly ONE step in this guide
  // is pure explanation with nothing to do and nothing to get wrong; every
  // other step, command or not, must carry its own troubleshooting.
  const explainOnly = allSteps.filter((s) => s.ifItGoesWrong == null);
  ok(
    explainOnly.length === 1,
    `guide: exactly one step is pure explanation (found ${explainOnly.length})`,
  );
  ok(
    explainOnly.every((s) => s.commands.length === 0 && s.expect == null),
    "guide: the explanation-only step genuinely asks you to do nothing",
  );

  console.log(`vretti-setup-core: ${pass} passed, ${fail} failed`);
  if (fail > 0) throw new Error(`vretti-setup-core tests failed: ${fail}`);
}
