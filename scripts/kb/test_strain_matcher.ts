/**
 * Ad-hoc verification for the intelligent strain matcher. Run with:
 *   npx tsx scripts/kb/test_strain_matcher.ts
 *
 * Not a CI test — a quick, readable proof that exact + near-exact matching
 * behaves the way the owner asked (vendor name variations, added brand words,
 * pack sizes, small typos), and that ambiguous cases fall to review.
 */
import {
  matchStrainToKb,
  normalizeStrainQuery,
  type MatchableStrain,
} from "../../src/lib/ai/kb/strain-matcher";

const KB: MatchableStrain[] = [
  { slug: "blue dream", name: "Blue Dream", aliases: ["azure haze"] },
  { slug: "gg4", name: "GG4", aliases: ["gorilla glue #4", "gorilla glue 4", "original glue"] },
  { slug: "wedding cake", name: "Wedding Cake", aliases: ["triangle mints #23", "pink cookies"] },
  { slug: "og kush", name: "OG Kush", aliases: [] },
  { slug: "og kush breath", name: "OG Kush Breath", aliases: ["okb"] },
  { slug: "durban poison", name: "Durban Poison", aliases: [] },
  { slug: "girl scout cookies", name: "Girl Scout Cookies", aliases: ["gsc"] },
  { slug: "pineapple express", name: "Pineapple Express", aliases: [] },
  { slug: "ak-47", name: "AK-47", aliases: ["ak47"] },
];

type Case = {
  in: { strainName?: string | null; productName?: string | null };
  expectBestSlug: string | null; // confident auto-accept slug, or null if none
  expectTopCandidate?: string | null; // #1 ranked candidate even if not auto-accepted
  note: string;
};

const CASES: Case[] = [
  { in: { strainName: "Blue Dream" }, expectBestSlug: "blue dream", note: "exact" },
  { in: { productName: "Blue Dream 3.5g Flower" }, expectBestSlug: "blue dream", note: "weight+form stripped" },
  { in: { productName: "Fweedom - Blue Dream - Preroll 2x .5g" }, expectBestSlug: "blue dream", note: "brand + form + pack" },
  // A one-letter typo scores ~0.83: strong enough to SUGGEST for review, but
  // (correctly, drafts-only) not confident enough to auto-accept without a human.
  { in: { strainName: "Blue Dreem" }, expectBestSlug: null, expectTopCandidate: "blue dream", note: "typo → suggest, needs review" },
  { in: { strainName: "GG #4" }, expectBestSlug: "gg4", note: "punctuation/spacing → alnum" },
  { in: { strainName: "Gorilla Glue #4" }, expectBestSlug: "gg4", note: "alias" },
  { in: { productName: "Wedding Cake (Triangle Mints #23) 1g" }, expectBestSlug: "wedding cake", note: "paren alt-name dropped" },
  { in: { strainName: "GSC" }, expectBestSlug: "girl scout cookies", note: "alias acronym" },
  { in: { strainName: "AK47 Cartridge" }, expectBestSlug: "ak-47", note: "alnum alias + form" },
  { in: { strainName: "Pineapple Xpress" }, expectBestSlug: "pineapple express", note: "typo" },
  // Ambiguous: OG Kush vs OG Kush Breath — a bare "OG Kush" IS exact for the former.
  { in: { strainName: "OG Kush" }, expectBestSlug: "og kush", note: "exact wins over superset" },
  // Genuinely unknown → review.
  { in: { strainName: "Galactic Runtz Supernova" }, expectBestSlug: null, note: "unknown → review" },
];

let pass = 0;
let fail = 0;
for (const c of CASES) {
  const r = matchStrainToKb(c.in, KB);
  const gotSlug = r.best?.strain.slug ?? null;
  const topCand = r.candidates[0]?.strain.slug ?? null;
  const bestOk = gotSlug === c.expectBestSlug;
  const candOk =
    c.expectTopCandidate === undefined || topCand === c.expectTopCandidate;
  const ok = bestOk && candOk;
  if (ok) pass++;
  else fail++;
  const q = normalizeStrainQuery(c.in.strainName ?? c.in.productName ?? "");
  console.log(
    `${ok ? "PASS" : "FAIL"} | in=${JSON.stringify(c.in.strainName ?? c.in.productName)} ` +
      `norm="${q}" best=${gotSlug ?? "(review)"} ` +
      `score=${r.best ? r.best.score.toFixed(2) : "-"} ` +
      `top3=[${r.candidates.slice(0, 3).map((x) => `${x.strain.slug}:${x.score.toFixed(2)}`).join(", ")}] ` +
      `— ${c.note}`,
  );
}
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
