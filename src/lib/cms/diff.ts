/**
 * src/lib/cms/diff.ts
 *
 * A tiny, dependency-free word-level diff used to show staff exactly what
 * changed between the live value and their draft (and between revisions). This
 * is a presentation aid only — it is NOT a merge tool. Classic LCS over word
 * tokens; good enough for short marketing copy and entirely client-safe.
 */

export type DiffOp = { type: "equal" | "insert" | "delete"; text: string };

function tokenize(s: string): string[] {
  // Keep whitespace as part of the following token so re-joining is lossless.
  return s.match(/\s*\S+|\s+/g) ?? [];
}

export function diffWords(before: string, after: string): DiffOp[] {
  const a = tokenize(before);
  const b = tokenize(after);
  const n = a.length;
  const m = b.length;

  // LCS table.
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  const push = (type: DiffOp["type"], text: string) => {
    const last = ops[ops.length - 1];
    if (last && last.type === type) last.text += text;
    else ops.push({ type, text });
  };

  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push("equal", a[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push("delete", a[i]);
      i++;
    } else {
      push("insert", b[j]);
      j++;
    }
  }
  while (i < n) push("delete", a[i++]);
  while (j < m) push("insert", b[j++]);

  return ops;
}

/** True when the two strings differ at all. */
export function hasChanges(before: string, after: string): boolean {
  return (before ?? "") !== (after ?? "");
}
