// Reads loyalty signups from the local JSONL store. Slice 8 will migrate this
// to a Supabase table; until then the admin reads the existing file safely.
import { readFile } from "node:fs/promises";
import path from "node:path";

export type LoyaltySignupRecord = {
  id: string;
  submittedAt: string;
  firstName: string;
  lastName: string;
  birthday: string;
  mobilePhone: string;
  email: string;
  notificationStatus: string;
};

export async function readLoyaltySignups(): Promise<LoyaltySignupRecord[]> {
  try {
    const filePath = path.join(process.cwd(), "storage", "loyalty-signups.jsonl");
    const file = await readFile(filePath, "utf8");
    return file
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as LoyaltySignupRecord)
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  } catch {
    return [];
  }
}

export async function countLoyaltySignups(): Promise<number> {
  const all = await readLoyaltySignups();
  return all.length;
}
