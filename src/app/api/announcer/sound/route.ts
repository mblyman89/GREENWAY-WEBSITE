/**
 * GET /api/announcer/sound?path=custom/<id>.wav   (SLICE 31)
 *
 * How a Raspberry Pi fetches a custom sound it has been told to play.
 *
 * This is the one announcer route that is a GET and returns bytes rather than
 * JSON, because the client is `requests.get()` inside the agent writing
 * straight to a file on the Pi's SD card.
 *
 * WHY THE PI CACHES: the agent stores the file after the first download and
 * never asks again, so this route is hit once per sound per speaker, not once
 * per order. That matters because the announcement must be instant — waiting
 * on a download before playing would put the chime seconds behind the order.
 *
 * WHAT HAPPENS IF THIS FAILS: nothing bad. The agent falls back to the
 * built-in chime and still announces the order. A missing custom sound is a
 * cosmetic problem; a silent speaker is not, so the agent is built to never
 * let this route's failure become silence.
 */
import { NextResponse, type NextRequest } from "next/server";
import { authenticateAnnouncerDevice } from "@/lib/announcer/announcer-store";
import { parseCredentials, unauthorized, unavailable } from "@/lib/announcer/announcer-protocol-core";
import { isValidStoragePath, contentTypeFor } from "@/lib/announcer/announcer-sounds-core";
import { downloadSound } from "@/lib/announcer/announcer-sounds-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const creds = parseCredentials((n) => req.headers.get(n));
  if (!creds.ok) {
    const e = unauthorized(creds.error);
    return NextResponse.json(e, { status: e.status });
  }

  const auth = await authenticateAnnouncerDevice(
    creds.credentials.deviceId,
    creds.credentials.deviceKey,
  );
  if (!auth.ok) {
    const e = auth.status === 401 ? unauthorized(auth.error) : unavailable(auth.error);
    return NextResponse.json(e, { status: e.status });
  }

  const path = req.nextUrl.searchParams.get("path") ?? "";
  if (!isValidStoragePath(path)) {
    // Deliberately specific: the agent logs this text, and "not a sound this
    // system created" is far more useful at 9am than "bad request".
    return NextResponse.json(
      { error: "That is not a sound this system created.", status: 400 },
      { status: 400 },
    );
  }

  const file = await downloadSound(path);
  if (file === null) {
    return NextResponse.json(
      {
        error: "That sound is no longer stored. The speaker will use the built-in chime instead.",
        status: 404,
      },
      { status: 404 },
    );
  }

  return new NextResponse(file.bytes, {
    status: 200,
    headers: {
      "content-type": contentTypeFor(path),
      "content-length": String(file.bytes.byteLength),
      // The Pi caches on disk anyway; this stops any proxy in between from
      // holding a stale copy after a sound is replaced.
      "cache-control": "no-store",
    },
  });
}
