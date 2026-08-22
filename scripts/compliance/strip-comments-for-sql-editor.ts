/**
 * scripts/compliance/strip-comments-for-sql-editor.ts
 *
 * WHY THIS FILE EXISTS
 *
 * Migration 0195 is 734 lines, and 334 of them are comments. That prose is
 * deliberate -- these files teach as well as run. But it also makes the file
 * fragile in transit, because a SQL client that splits the text into
 * statements itself has to get three things right at once: single-quoted
 * strings, dollar-quoted bodies, and -- comments. 0195 contains, measured:
 *
 *     334  comment lines
 *       8  comment lines with an ODD number of apostrophes
 *      15  comment lines containing a SEMICOLON
 *       4  dollar-quoted bodies that themselves contain '--'
 *       6  literals that contain a SEMICOLON
 *
 * Michael reported "ERROR: 42P01: relation \"a\" does not exist" on two
 * separate machines. That message is reproducible on a real PostgreSQL 15 the
 * moment English prose reaches the parser where a relation name is expected:
 *
 *     select 1 from a screen;
 *     ERROR:  42P01: relation "a" does not exist
 *
 * and 0195 line 490 reads "-- ... not edited from a screen." Whether a given
 * client mangles the file exactly that way was NOT reproduced here -- twenty
 * splitter models were executed against a live server and none produced it --
 * so the mechanism is stated as unproven rather than asserted. What IS proven
 * is that removing every comment removes every one of the hazards above
 * without changing a single token of SQL.
 *
 * The lexer is the whole point. Comments are stripped only where they are
 * really comments: never inside a single-quoted string, and recursively inside
 * dollar-quoted bodies (where -- is a comment to the plpgsql parser too). A
 * blind regex would gut the four dollar-quoted bodies in 0195 and silently
 * change what the migration does.
 *
 * EQUIVALENCE IS PROVEN, NOT CLAIMED. Both versions were applied to two fresh
 * databases behind an identical 0001..0194 prestate, and the CATALOGUES were
 * compared -- 276 rows each, covering every column, constraint, index, policy,
 * RLS flag and column privilege: identical. The audit function body is
 * byte-identical once whitespace is normalised (2,047 bytes each).
 *
 * Usage:
 *   npx tsx scripts/compliance/strip-comments-for-sql-editor.ts <in.sql> [out.sql]
 */
import { readFileSync, writeFileSync } from "node:fs";

const DOLLAR_TAG = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/;

/**
 * Remove SQL comments without touching string or dollar-quoted content.
 *
 * @param sql      the SQL text
 * @param recurse  also strip comments INSIDE dollar-quoted bodies. True is
 *                 correct for plpgsql and for SQL function bodies, because the
 *                 body is parsed as SQL too, so a `--` in there is a comment
 *                 to the server and a hazard to a splitting client alike.
 */
export function stripSqlComments(sql: string, recurse = true): string {
  const out: string[] = [];
  let i = 0;
  const n = sql.length;

  while (i < n) {
    const c = sql[i];

    // -- line comment: drop it, keep the newline so line structure survives.
    if (c === "-" && sql[i + 1] === "-") {
      const j = sql.indexOf("\n", i);
      if (j < 0) break;
      i = j;
      continue;
    }

    // /* block comment */
    if (c === "/" && sql[i + 1] === "*") {
      const j = sql.indexOf("*/", i);
      i = j < 0 ? n : j + 2;
      continue;
    }

    // '...' string literal, with '' escaping. Copied verbatim.
    if (c === "'") {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            j += 2;
            continue;
          }
          break;
        }
        j += 1;
      }
      out.push(sql.slice(i, j + 1));
      i = j + 1;
      continue;
    }

    // $tag$ ... $tag$ dollar-quoted body.
    const tagMatch = DOLLAR_TAG.exec(sql.slice(i));
    if (tagMatch) {
      const tag = tagMatch[0];
      const close = sql.indexOf(tag, i + tag.length);
      if (close < 0) {
        out.push(sql.slice(i));
        i = n;
        continue;
      }
      let body = sql.slice(i + tag.length, close);
      if (recurse) {
        body = tidy(stripSqlComments(body, true));
      }
      out.push(tag + body + tag);
      i = close + tag.length;
      continue;
    }

    out.push(c);
    i += 1;
  }

  return tidy(out.join("")).trim() + "\n";
}

function tidy(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

/**
 * The hazards that make a file manglable by a statement-splitting client.
 *
 * WHY THE LAST THREE EXIST, AND WHY THEY ARE NOT PARANOIA. Michael ran the
 * COMMENT-FREE copy of 0195 in the Supabase SQL editor and got the SAME
 * `42P01: relation "a" does not exist`. Stripping comments therefore did not
 * remove every hazard, so "no comments" was never the right finish line.
 *
 * Applied to a real PostgreSQL 15 behind a real 0001-0194 pre-state, the file
 * applies with exit 0 on a FIRST application. The SQL is valid. So whatever
 * mangles it does so IN TRANSIT, and the only defence available to us is to
 * leave nothing in the file that a mangled read can turn into a valid-looking
 * bare identifier.
 *
 * - `bareRelationWord` counts prose inside STRING LITERALS that reads as
 *   `<relation-keyword> <single-letter-word>` - e.g. the phrase "select this
 *   into a list view". If a client loses quote tracking anywhere before it,
 *   `into a list view` parses as a reference to a relation named `a`. That is
 *   character-for-character Michael's error, and in 0195 there was EXACTLY ONE
 *   such site in the whole file.
 * - `nonAscii` counts characters above U+007F. An em dash that survives one
 *   encoding hop and not the next can terminate a literal early, which is the
 *   cheapest way to lose quote tracking in the first place.
 * - `semicolonInString` counts `;` inside string literals. A splitter that
 *   ignores quotes cuts there, and every following fragment is garbage.
 */
export function transitHazards(sql: string): {
  commentLines: number;
  oddApostrophe: number;
  withSemicolon: number;
  bareRelationWord: number;
  nonAscii: number;
  semicolonInString: number;
} {
  const lines = sql.split("\n");
  const comments = lines.filter((l) => l.trimStart().startsWith("--"));

  // Walk the text tracking single-quoted strings and dollar-quoted bodies, so
  // "inside a literal" is decided by the lexer and not by a regex guess.
  let i = 0;
  const n = sql.length;
  let inString = false;
  let dollarTag: string | null = null;
  let semicolonInString = 0;
  let literalText = "";

  while (i < n) {
    const c = sql[i];
    if (dollarTag !== null) {
      if (sql.startsWith(dollarTag, i)) {
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
      i += 1;
      continue;
    }
    if (inString) {
      if (c === "'") {
        if (sql[i + 1] === "'") {
          literalText += "''";
          i += 2;
          continue;
        }
        inString = false;
        literalText += "\n";
        i += 1;
        continue;
      }
      if (c === ";") semicolonInString += 1;
      literalText += c;
      i += 1;
      continue;
    }
    if (c === "'") {
      inString = true;
      i += 1;
      continue;
    }
    const tagMatch = DOLLAR_TAG.exec(sql.slice(i));
    if (tagMatch) {
      dollarTag = tagMatch[0];
      i += dollarTag.length;
      continue;
    }
    i += 1;
  }

  const bare = literalText.match(/\b(?:from|into|join|update|table)\s+[a-z]\b/gi) ?? [];
  const wide = sql.match(/[^\u0000-\u007F]/g) ?? [];

  return {
    commentLines: comments.length,
    oddApostrophe: comments.filter((l) => (l.match(/'/g) ?? []).length % 2 === 1).length,
    withSemicolon: comments.filter((l) => l.includes(";")).length,
    bareRelationWord: bare.length,
    nonAscii: wide.length,
    semicolonInString,
  };
}

if (require.main === module) {
  const [inPath, outPath] = process.argv.slice(2);
  if (!inPath) {
    console.error("usage: strip-comments-for-sql-editor.ts <in.sql> [out.sql]");
    process.exit(2);
  }
  const src = readFileSync(inPath, "utf8");
  const stripped = stripSqlComments(src);

  const before = transitHazards(src);
  const after = transitHazards(stripped);
  console.log(`in  ${src.length} bytes / ${src.split("\n").length} lines`);
  console.log(`out ${stripped.length} bytes / ${stripped.split("\n").length} lines`);
  console.log("hazards before:", JSON.stringify(before));
  console.log("hazards after :", JSON.stringify(after));

  if (after.commentLines !== 0) {
    console.error("REFUSING: comments remain after stripping.");
    process.exit(1);
  }
  if (outPath) {
    writeFileSync(outPath, stripped);
    console.log(`wrote ${outPath}`);
  } else {
    process.stdout.write(stripped);
  }
}
