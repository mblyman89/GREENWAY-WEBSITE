/**
 * src/lib/announcer/announcer-setup-core.ts
 *
 * The setup walkthrough that lives IN THE BACK OFFICE.
 *
 * WHY THIS EXISTS
 * ---------------
 * The owner asked, verbatim:
 *
 *   "will you make sure the instructions for doing everything is included in
 *    the back office so I dont need to search everywhere to find the steps. I
 *    want them laid out for me in the back office."
 *
 * He was right to ask. A complete walkthrough already existed -- as Markdown
 * files inside the source repository. That is a perfect place for it if you are
 * a developer with a checkout, and useless if you are the person standing in
 * the shop with a Raspberry Pi in one hand. Documentation nobody can reach at
 * the moment they need it is not documentation, it is an artefact.
 *
 * So the steps live here, as DATA, and the panel renders them. Pure: no React,
 * no database, no I/O. That means the wording can be asserted in tests, the
 * commands can be pinned against the real installer, and the guide cannot
 * quietly drift away from the software it describes.
 *
 * THE RULE THIS FILE FOLLOWS
 * --------------------------
 * Every command shown here must be one a person can copy and run WITHOUT
 * editing it first. A command with a placeholder in it is a trap: it fails
 * several minutes later with an error that looks like broken hardware. That is
 * why the site address and the pairing code are injected, never invented.
 */

/** One copyable command, with the reason it is being run. */
export type SetupCommand = {
  /** Exactly what to type. Never contains a placeholder. */
  command: string;
  /** What it does, in plain English. Shown under the command. */
  purpose: string;
};

export type SetupStep = {
  /** 1-based, for display. */
  number: number;
  title: string;
  /** Why this step exists. One or two sentences, no jargon. */
  body: string;
  commands: SetupCommand[];
  /** What you should see if it worked. Empty when there is nothing to see. */
  expect: string | null;
  /** The single most common way this step goes wrong, and the fix. */
  ifItGoesWrong: string | null;
};

export type SetupSection = {
  id: string;
  title: string;
  /** One sentence on what this whole section achieves. */
  summary: string;
  steps: SetupStep[];
};

/**
 * The shopping list. Kept here rather than in prose because the two entries
 * marked critical are, between them, the cause of most "my Pi died" reports --
 * and the owner is currently asking why his Pi keeps turning itself off.
 */
export type HardwareItem = {
  item: string;
  spec: string;
  why: string;
  /** True for the things that cause the failure he is describing. */
  critical: boolean;
};

export const SETUP_HARDWARE: HardwareItem[] = [
  {
    item: "Official USB-C power supply",
    spec: "5V / 3A (15W) — the official one",
    why: "The number one cause of a Pi that restarts on its own. A phone charger looks identical and is not the same thing: it sags under load, the Pi browns out, and it looks exactly like the Pi 'turning itself off'.",
    critical: true,
  },
  {
    item: "High-endurance microSD card",
    spec: "32GB, Class 10 / A1, marked 'high endurance'",
    why: "The dashcam-rated kind. Card wear is the other top failure. Do not go bigger than 32GB — bigger is not better here.",
    critical: true,
  },
  {
    item: "Raspberry Pi 4 Model B",
    spec: "2GB RAM is plenty",
    why: "This program idles. Paying for 4GB or 8GB buys nothing.",
    critical: false,
  },
  {
    item: "Powered speaker with 3.5mm input",
    spec: "Mains powered, with its own volume knob",
    why: "USB-bus-powered speakers are too quiet for a sales floor and add a second thing that can be switched off by accident.",
    critical: false,
  },
  {
    item: "Case with passive cooling",
    spec: "Aluminium or vented — no fan",
    why: "A fan is the only moving part and the only thing that whines in a quiet room.",
    critical: false,
  },
  {
    item: "3.5mm audio cable",
    spec: "Male-to-male, 6ft",
    why: "Buy one longer than you think you need.",
    critical: false,
  },
];

/** Strip a trailing slash so a command never contains a double slash. */
function cleanSite(siteUrl: string): string {
  return siteUrl.replace(/\/+$/, "");
}

/**
 * Build the walkthrough.
 *
 * @param siteUrl        The address the Pi must talk to. Injected, never
 *                       hardcoded, so this cannot drift from the deployment.
 * @param pairingCode    A live, unused pairing code if one exists. When null,
 *                       the guide tells the reader to make one rather than
 *                       printing a fake code they would paste and be rejected.
 * @param hasPairedSpeaker Whether at least one speaker is already paired. This
 *                       changes the advice materially -- see step 6.
 */
export function buildSetupGuide(input: {
  siteUrl: string;
  pairingCode: string | null;
  hasPairedSpeaker: boolean;
}): SetupSection[] {
  const site = cleanSite(input.siteUrl);
  const code = input.pairingCode;

  // The install command is the single most important string on the page. When
  // there is a real code, it is complete and copyable. When there is not, the
  // guide says so in words instead of printing something that cannot work.
  const installCommand = code
    ? `sudo ./install.sh --site ${site} --code ${code}`
    : `sudo ./install.sh --site ${site}`;

  return [
    {
      id: "hardware",
      title: "Part 1 — Before you touch anything",
      summary: "What to buy and how to plug it together.",
      steps: [
        {
          number: 1,
          title: "Get the parts",
          body:
            "The full list is below this guide. Two of them matter far more than the rest: the official power supply and a high-endurance SD card. Between them they cause almost every 'the Pi died' story. A phone charger is not a substitute — it looks the same, it fits, and it will make the Pi restart itself at random.",
          commands: [],
          expect: null,
          ifItGoesWrong: null,
        },
        {
          number: 2,
          title: "Put it together",
          body:
            "Card into the slot underneath. Speaker into the round 3.5mm socket (not the HDMI port). Speaker plugged into the mains and switched on, with its volume knob at about half. Network cable in, or Wi-Fi set up when you image the card. Power last — the Pi starts the moment it gets power, so everything else should already be connected.",
          commands: [],
          expect: "A red light on the Pi that stays on, and a green light that flickers.",
          ifItGoesWrong:
            "No red light at all means no power: check both ends of the cable, and use the official supply. A red light that blinks or comes and goes is an underpowered supply — that is the fault, not the Pi.",
        },
      ],
    },
    {
      id: "connect",
      title: "Part 2 — Get the software onto the Pi",
      summary: "Three commands, run on the Pi over SSH.",
      steps: [
        {
          number: 3,
          title: "Check you are actually talking to the Pi",
          body:
            "Worth ten seconds. Every later step assumes the commands are landing on the Pi and not on your own laptop, and that mistake is invisible until something fails for no reason.",
          commands: [
            {
              command: "hostname && whoami",
              purpose: "Prints the Pi's name and who you are logged in as.",
            },
          ],
          expect:
            "The Pi's name — not your laptop's. If it prints your laptop, you are not connected yet.",
          ifItGoesWrong:
            "Connect with: ssh greenway-office@greenway-office.local — then run this again.",
        },
        {
          number: 4,
          title: "Get the current software",
          body:
            "This downloads the latest installer and speaker program. Run it every time you are told there is a fix — 'git pull' on its own updates the files but does NOT update the program that is already installed, which is why step 6 matters even when nothing looks broken.",
          commands: [
            {
              command: "cd ~/GREENWAY-WEBSITE && git pull",
              purpose: "Fetches the newest installer and speaker program.",
            },
            {
              command: "cd ~/GREENWAY-WEBSITE/pi-agent",
              purpose: "Moves into the folder the installer lives in.",
            },
          ],
          expect: "Either a list of updated files, or 'Already up to date.'",
          ifItGoesWrong:
            "If the folder does not exist, clone it first: git clone https://github.com/mblyman89/GREENWAY-WEBSITE.git ~/GREENWAY-WEBSITE",
        },
      ],
    },
    {
      id: "pair",
      title: "Part 3 — Connect the speaker to this website",
      summary: "One command. It sets everything up and starts the speaker.",
      steps: [
        {
          number: 5,
          title: code ? "Use the code above" : "Get a pairing code first",
          body: code
            ? "You already have a live code — it is shown in the 'Add a speaker' box above, and it is already filled into the command below. Codes last one hour. If it runs out, make another; they are free."
            : "Open 'Add a speaker' above, type the room name (for example: Sales Floor), and press 'Get pairing code'. An eight-character code appears, along with the exact command to run. Codes last one hour.",
          commands: [],
          expect: code ? `A code like ${code}.` : "An eight-character code on screen.",
          ifItGoesWrong:
            "If the code has expired, nothing is lost — press the button again for a fresh one.",
        },
        {
          number: 6,
          title: input.hasPairedSpeaker
            ? "Run the installer — do NOT delete your existing speaker"
            : "Run the installer",
          body: input.hasPairedSpeaker
            ? "You already have a speaker paired, and it should stay that way. Running the installer WITHOUT a code upgrades the program and keeps the existing pairing — it prints 'Already paired - keeping the existing setup'. Deleting the speaker here and starting again would only force you to generate a new code for no benefit. Only use a code when you are adding a NEW speaker or you deliberately removed the old one."
            : "This does everything: installs what it needs, connects the speaker to this website, sets it to start automatically on boot, and keeps the Pi awake. It takes about two minutes and prints eight steps. It is safe to run twice.",
          commands: [
            {
              command: input.hasPairedSpeaker
                ? `sudo ./install.sh --site ${site}`
                : installCommand,
              purpose: input.hasPairedSpeaker
                ? "Upgrades the speaker program and keeps your current pairing."
                : "Installs and pairs this Pi in one go.",
            },
          ],
          expect:
            "Eight steps, each starting '==>', ending with 'Your speaker is installed and running.'",
          ifItGoesWrong:
            "If it stops on the website address, check there is a colon after https. If a code is rejected, it has expired — make a new one and run it again.",
        },
      ],
    },
    {
      id: "sound",
      title: "Part 4 — Prove it makes a noise",
      summary: "Test the hardware first, then the website.",
      steps: [
        {
          number: 7,
          title: "Make the Pi play all six sounds",
          body:
            "This tests the speaker on its own, without involving the website at all. If this makes noise, the hardware is fine and anything still wrong is a settings problem — which is a much smaller search.",
          commands: [
            {
              command: "sudo greenway-announcer test",
              purpose: "Plays all six built-in sounds through the speaker.",
            },
          ],
          expect: "Six different tones.",
          ifItGoesWrong:
            "If you see 'Unknown error 524', the Pi was trying to use the HDMI socket, which cannot start without a monitor. It now finds the working output and SAVES it for you — you do not have to do anything. If it stays silent, check the speaker is switched on and its knob is up.",
        },
        {
          number: 8,
          title: "Check what the Pi thinks",
          body:
            "This is the one command worth remembering. It shows what the speaker is set to, whether the website can hear it, and — importantly for a Pi that seems to switch itself off — how long it has been running.",
          commands: [
            {
              command: "sudo greenway-announcer status",
              purpose: "Reports the settings, the connection, and how long the Pi has been up.",
            },
          ],
          expect:
            "'Paired as:' with your room name, an 'audio out:' line, and under 'Staying awake:' an 'Up for:' time that keeps growing.",
          ifItGoesWrong:
            "If 'audio out:' says (system default) on a Pi that needed to hunt for an output, run: sudo greenway-announcer use-output plughw:1,0",
        },
        {
          number: 9,
          title: "Press the button on this page",
          body:
            "Scroll up and press '▶ Test all speakers'. The button will say 'Sending…' and then tell you how many speakers it reached. Speakers check in on a 25-second cycle, so give it up to half a minute before deciding nothing happened.",
          commands: [],
          expect: "A chime in the room, within about 25 seconds.",
          ifItGoesWrong:
            "If the panel says it was sent but you hear nothing, the speaker is muted or pointed at the wrong output — go back to step 7.",
        },
      ],
    },
    {
      id: "always-on",
      title: "Part 5 — Keep it on, always",
      summary: "Why a Pi seems to switch itself off, and how to tell which fault you have.",
      steps: [
        {
          number: 10,
          title: "Know which of the two faults you have",
          body:
            "'It turns itself off' covers two completely different problems with opposite fixes. Either the Pi is genuinely restarting — which is almost always the power supply — or the Pi is fine and only its Wi-Fi radio is dozing, so this website marks it offline while it sits there working perfectly. The installer now switches off Wi-Fi power saving, sleep and suspend, and screen blanking, permanently and on every boot. The 'Up for:' line tells you which fault you are looking at.",
          commands: [
            {
              command: "sudo greenway-announcer status",
              purpose: "The 'Up for:' line is the answer.",
            },
          ],
          expect:
            "'Up for:' keeps climbing (hours, then days), and 'Wi-Fi ... power saving OFF - good'.",
          ifItGoesWrong:
            "If 'Up for:' keeps resetting to a few minutes, the Pi is LOSING POWER. That is the power supply or the cable — replace the supply with the official one before changing anything else. If instead power saving says ON, run: sudo /usr/local/bin/greenway-keep-awake",
        },
        {
          number: 11,
          title: "Set the volume and walk away",
          body:
            "Set each room's volume on its card above, pick a sound, and save. From here it looks after itself: it starts on boot, restarts if it crashes, and reconnects on its own after an internet outage or a power cut. There is nothing to switch on in the morning.",
          commands: [],
          expect: "A green dot on the speaker card, and 'Last heard from' a few seconds ago.",
          ifItGoesWrong:
            "If a room goes quiet later, unplug the Pi's power for ten seconds and plug it back in. Give it two minutes.",
        },
      ],
    },
  ];
}

/** The handful of commands worth keeping somewhere findable. */
export const SETUP_CHEAT_SHEET: SetupCommand[] = [
  {
    command: "sudo greenway-announcer status",
    purpose: "Is it paired, can it reach the website, and how long has it been up?",
  },
  {
    command: "sudo greenway-announcer test",
    purpose: "Play all six sounds to prove the speaker works.",
  },
  {
    command: "sudo greenway-announcer use-output plughw:1,0",
    purpose: "Send sound to a specific output and keep it that way.",
  },
  {
    command: "sudo systemctl restart greenway-announcer",
    purpose: "Restart the speaker without rebooting the Pi.",
  },
  {
    command: "journalctl -u greenway-announcer -f",
    purpose: "Watch what the speaker is doing right now. Ctrl+C to stop.",
  },
  {
    command: "sudo /usr/local/bin/greenway-keep-awake",
    purpose: "Force Wi-Fi power saving off now, if status says it is on.",
  },
];

// ============================================================================
// SELF-TESTS
// ============================================================================

export function __runAnnouncerSetupTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const check = (label: string, cond: boolean): void => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`announcer-setup FAIL: ${label}`);
    }
  };

  const SITE = "https://greenwaywebsite1.vercel.app";
  const withCode = buildSetupGuide({
    siteUrl: SITE,
    pairingCode: "28C6P3UU",
    hasPairedSpeaker: false,
  });
  const noCode = buildSetupGuide({ siteUrl: SITE, pairingCode: null, hasPairedSpeaker: false });
  const paired = buildSetupGuide({ siteUrl: SITE, pairingCode: null, hasPairedSpeaker: true });

  const allSteps = (g: SetupSection[]) => g.flatMap((s) => s.steps);
  const allCommands = (g: SetupSection[]) =>
    allSteps(g).flatMap((s) => s.commands.map((c) => c.command));

  // ---- the guide is complete and ordered -------------------------------
  check("setup: there are sections", withCode.length >= 5);
  check("setup: every section has steps", withCode.every((s) => s.steps.length > 0));
  check(
    "setup: step numbers run 1..N with no gaps and no repeats",
    allSteps(withCode).every((s, i) => s.number === i + 1),
  );
  check("setup: every step has a title", allSteps(withCode).every((s) => s.title.trim() !== ""));
  check("setup: every step explains itself", allSteps(withCode).every((s) => s.body.trim().length > 20));
  check(
    "setup: section ids are unique (they become anchors)",
    new Set(withCode.map((s) => s.id)).size === withCode.length,
  );

  // ---- THE RULE: no command may contain a placeholder -------------------
  // A command you must edit before running is how somebody ends up debugging
  // a DNS error minutes later and concluding the Pi is broken.
  const PLACEHOLDERS = ["YOUR-SITE", "YOUR-CODE", "XXXX", "<", "example.com", "your-site"];
  for (const cmd of [...allCommands(withCode), ...allCommands(noCode), ...allCommands(paired)]) {
    check(
      `setup: command is copyable as-is -> ${cmd}`,
      !PLACEHOLDERS.some((p) => cmd.includes(p)),
    );
  }
  check(
    "setup: every command says what it is for",
    allSteps(withCode).every((s) => s.commands.every((c) => c.purpose.trim().length > 10)),
  );

  // ---- the site address is injected, never invented ---------------------
  const installLine = allCommands(withCode).find((c) => c.includes("install.sh"));
  check("setup: there is an install command", typeof installLine === "string");
  check("setup: the install command carries the real site", (installLine ?? "").includes(SITE));
  check("setup: a live code is filled in for you", (installLine ?? "").includes("28C6P3UU"));
  check(
    "setup: a trailing slash never becomes a double slash",
    !buildSetupGuide({ siteUrl: `${SITE}/`, pairingCode: "ABCD2345", hasPairedSpeaker: false })
      .flatMap((s) => s.steps)
      .flatMap((s) => s.commands)
      .some((c) => c.command.includes(".app//")),
  );

  // ---- no code means no fake code --------------------------------------
  const noCodeInstall = allCommands(noCode).find((c) => c.includes("install.sh")) ?? "";
  check("setup: without a code, --code is not printed at all", !noCodeInstall.includes("--code"));
  check("setup: without a code, the site is still correct", noCodeInstall.includes(SITE));

  // ---- HIS ACTUAL QUESTION: should he delete the speaker? ---------------
  // install.sh with no --code prints "Already paired - keeping the existing
  // setup". So the answer is no, and the guide must say so where he will see
  // it rather than leaving him to guess.
  const pairedStep = allSteps(paired).find((s) => s.title.includes("installer"));
  check("setup: an already-paired shop gets its own instruction", pairedStep !== undefined);
  check(
    "setup: it explicitly says NOT to delete the existing speaker",
    (pairedStep?.title ?? "").includes("NOT delete") || (pairedStep?.body ?? "").includes("Deleting"),
  );
  check(
    "setup: the already-paired command does NOT pass a code",
    !(pairedStep?.commands[0]?.command ?? "").includes("--code"),
  );
  check(
    "setup: it quotes what the installer really prints",
    (pairedStep?.body ?? "").includes("Already paired - keeping the existing setup"),
  );

  // ---- the always-on section answers the question he asked -------------
  const always = withCode.find((s) => s.id === "always-on");
  check("setup: there is a section about staying on", always !== undefined);
  const alwaysText = JSON.stringify(always ?? {});
  check("setup: it names the power supply as a cause", alwaysText.includes("power supply"));
  check("setup: it names Wi-Fi power saving as the other cause", alwaysText.toLowerCase().includes("power saving"));
  check("setup: it tells him how to tell them apart", alwaysText.includes("Up for:"));
  check(
    "setup: it does not claim the Pi was switched off when it was not",
    alwaysText.includes("marks it offline") || alwaysText.includes("dozing"),
  );

  // ---- hardware --------------------------------------------------------
  check("setup: the shopping list is not empty", SETUP_HARDWARE.length > 0);
  check(
    "setup: the power supply is flagged critical",
    SETUP_HARDWARE.some((h) => h.item.toLowerCase().includes("power supply") && h.critical),
  );
  check(
    "setup: the SD card is flagged critical",
    SETUP_HARDWARE.some((h) => h.item.toLowerCase().includes("microsd") && h.critical),
  );
  check(
    "setup: every item says why it matters",
    SETUP_HARDWARE.every((h) => h.why.trim().length > 20),
  );
  check(
    "setup: the phone-charger trap is called out",
    SETUP_HARDWARE.some((h) => h.why.toLowerCase().includes("phone charger")),
  );

  // ---- cheat sheet -----------------------------------------------------
  check("setup: the cheat sheet has the status command", SETUP_CHEAT_SHEET.some((c) => c.command.includes("status")));
  check("setup: the cheat sheet has the test command", SETUP_CHEAT_SHEET.some((c) => c.command.includes("test")));
  check(
    "setup: no cheat-sheet command contains a placeholder",
    SETUP_CHEAT_SHEET.every((c) => !PLACEHOLDERS.some((p) => c.command.includes(p))),
  );
  check(
    "setup: every cheat-sheet entry explains itself",
    SETUP_CHEAT_SHEET.every((c) => c.purpose.trim().length > 10),
  );

  // ---- never throws ----------------------------------------------------
  let threw = false;
  try {
    buildSetupGuide({ siteUrl: "", pairingCode: "", hasPairedSpeaker: false });
    buildSetupGuide({ siteUrl: "///", pairingCode: null, hasPairedSpeaker: true });
  } catch {
    threw = true;
  }
  check("setup: hostile input never throws — this renders on the Orders page", !threw);

  return { passed, failed };
}
