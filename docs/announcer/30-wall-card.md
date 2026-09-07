# WALL CARD — Print This

Print one. Tape it next to each Raspberry Pi, and one by the back office
computer. It is deliberately one page and deliberately short.

---

```
╔══════════════════════════════════════════════════════════════╗
║             ORDER ANNOUNCER — IT'S GONE QUIET                ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  DO THESE IN ORDER. STOP WHEN YOU HEAR A SOUND.              ║
║                                                              ║
║  1. Back office -> Orders -> Announcer                       ║
║     Press  [ TEST ALL SPEAKERS ]                             ║
║                                                              ║
║  2. Is the SPEAKER switched on?                              ║
║     Is its VOLUME KNOB turned up?                            ║
║     Is the CABLE pushed in at BOTH ends?                     ║
║        -> 9 times out of 10, it is this.                     ║
║                                                              ║
║  3. Unplug the Pi's power. Count to 10. Plug it back in.     ║
║     WAIT 2 FULL MINUTES. It is slow to start. That's normal. ║
║                                                              ║
║  4. Still quiet? Check the DOT in the back office:           ║
║                                                              ║
║     GREEN  = Pi is fine -> it's a SPEAKER or VOLUME problem  ║
║     GREY   = switched OFF on purpose -> turn it back on      ║
║     RED    = Pi can't reach the website -> check internet    ║
║     MISSING= not paired -> see the manual, PART 5            ║
║                                                              ║
╠══════════════════════════════════════════════════════════════╣
║  ALL speakers quiet at once? It's almost never the Pis.      ║
║    - Is the master switch ON?                                ║
║    - Is it QUIET HOURS?                                      ║
║    - Is the shop's INTERNET down?                            ║
╠══════════════════════════════════════════════════════════════╣
║  ON THE PI ITSELF (keyboard + screen, or SSH):               ║
║                                                              ║
║    greenway-announcer status                                 ║
║        "Is it working?" - checks the website too             ║
║                                                              ║
║    greenway-announcer test                                   ║
║        Plays all 6 sounds. NO internet needed.               ║
║        Hear them? -> the Pi is FINE, it's a setting.         ║
║                                                              ║
║    sudo systemctl restart greenway-announcer                 ║
║        Turn it off and on again. Always safe.                ║
║                                                              ║
║    journalctl -u greenway-announcer -f                       ║
║        Watch it live. Ctrl+C to quit.                        ║
╠══════════════════════════════════════════════════════════════╣
║  DON'T PANIC. A silent speaker does NOT affect any order,    ║
║  sale, or compliance record. Orders still arrive and are     ║
║  still correct. Watch the Orders screen and fix it later.    ║
╠══════════════════════════════════════════════════════════════╣
║  Full manual:  docs/announcer/10-field-manual.md             ║
║                                                              ║
║  This Pi is the ......................... speaker            ║
║  Last checked: ....../....../......                          ║
╚══════════════════════════════════════════════════════════════╝
```

---

## Also worth taping up: the monthly check

```
╔══════════════════════════════════════════════════════════════╗
║          MONTHLY 5-MINUTE CHECK   (do it, it's cheap)        ║
╠══════════════════════════════════════════════════════════════╣
║  [ ] All speakers showing GREEN in the back office?          ║
║  [ ] Pressed "Test all speakers" and HEARD each one?         ║
║  [ ] Volume knobs still where they should be?               ║
║  [ ] Pis clean, cool, and not shut in a cupboard?            ║
║  [ ] Power supplies firmly plugged in?                       ║
║  [ ] Spare SD card + spare power supply still in the drawer? ║
║                                                              ║
║  Then write today's date on the Pi's label.                  ║
╚══════════════════════════════════════════════════════════════╝
```
