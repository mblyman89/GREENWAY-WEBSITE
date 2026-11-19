# Greenway CCRS Uploader (Chrome extension, D253)

The owner's option A: **you log in to CCRS yourself; this extension uploads the week's files for you, one group at a time, and waits for CCRS's emails between groups.** It never sees, stores or types your WA.gov / CCRS password.

## How it works

The back office decides everything (`src/lib/compliance/ccrs-auto-upload-core.ts`). This extension only carries files and answers:

1. Every 30 seconds it looks at the open CCRS tabs (logged in? as whom?) and checks in with the back office (`POST /api/ccrs-uploader/next`).
2. When the back office says "upload THIS file", it downloads that one file (`GET /api/ccrs-uploader/file`). On the CCRS tab it then makes the same POST the CCRS page makes when you press Upload, to `/Home/Upload`. The POST sends three fields: `files`, `username` and `__RequestVerificationToken`, all read from the page itself.
3. It sends CCRS's answer page back (`POST /api/ccrs-uploader/report`):
   - **"Upload Confirmation … received at …":** the back office records the upload.
   - **"Your Files Could Not Be Uploaded":** the run stops and you are told.
   - **Anything else:** the run stops and you are told. Nothing is ever retried blind, because CCRS refuses the same file name twice.
4. The back office applies CCRS's emails itself, using the same Apply as the hub's button, acting as you. Each group goes only after every file of the earlier groups has its CCRS answer.

## Install (once)

1. In Chrome open `chrome://extensions`, turn on **Developer mode** (top right), click **Load unpacked**, and choose this folder (`tools/ccrs-uploader-extension`).
2. In the back office go to **Compliance → CCRS → Automatic upload** and press **Pair a browser**. Copy the code; it is shown once.
3. Open the extension's **Options**, paste the code, and press **Save pairing code**.

## Each week

1. Build and download the week in the hub as usual. Every file must read "emitted".
2. Apply (or set aside) every CCRS email still waiting in "CCRS email". A run will not start while one waits, because it might answer a file the run would otherwise send again.
3. Log in to CCRS in this Chrome and leave the tab open. The computer must stay awake.
4. In the hub press **Start** (production needs you to type `UPLOAD`).
5. Watch the run log in the hub, or the extension's badge: `UP` means uploading, `…` means waiting, and `!` means it needs you.

**Pause** stops new hand-outs. **Stop** ends the run; files not yet sent stay ready. **Revoke** cuts a browser off at once. The server kill switch is `CCRS_AUTO_UPLOAD=off`.

## Safety rules (enforced by the back office and migration 0369)

- Only one run at a time, and only one file in the browser at a time.
- Group 1 (Strain, Area, Product) goes first. Group 2 (Inventory) goes only after Group 1's CCRS answers are in. Group 3 (Adjustment, Transfer, Sale) goes only after Group 2's.
- If CCRS refused rows in an earlier group, the run pauses until you press **Continue anyway**.
- If it is unknown whether a file arrived, the run stops. No new run starts until that file is settled, either by its CCRS email or by you pressing "Record not received" after checking.
- CCRS must be logged in as the account whose emails the back office reads (`michael@greenwaymarijuana.com`).
- The key is random and the back office keeps only its sha256 hash. A revoked browser gets nothing.
