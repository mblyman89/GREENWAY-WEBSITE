// One-off analysis: find `try { ... redirect(...) ... } catch` blocks where the
// catch could swallow NEXT_REDIRECT. Char-level brace scan (handles `} catch (e) {`
// on one line). Excludes try blocks whose catch already rethrows via unstable_rethrow.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (name === "actions.ts" || name.endsWith("route.ts")) out.push(p);
  }
  return out;
}

for (const f of walk("src/app")) {
  const src = readFileSync(f, "utf8");
  const re = /\btry\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    const bodyStart = m.index + m[0].length;
    let depth = 1;
    let i = bodyStart;
    for (; i < src.length && depth > 0; i++) {
      const ch = src[i];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
    }
    const body = src.slice(bodyStart, i - 1);
    const afterTry = src.slice(i, i + 60);
    const catchMatch = /^\s*catch\s*\(/.test(afterTry);
    if (!catchMatch) continue;
    if (!/\bredirect\(/.test(body)) continue;
    // Find catch body to see whether it already rethrows.
    const catchOpen = src.indexOf("{", i);
    let cd = 1, k = catchOpen + 1;
    for (; k < src.length && cd > 0; k++) {
      if (src[k] === "{") cd++;
      else if (src[k] === "}") cd--;
    }
    const catchBody = src.slice(catchOpen + 1, k - 1);
    const safe = /unstable_rethrow|isRedirectError|NEXT_REDIRECT/.test(catchBody);
    const line = src.slice(0, m.index).split("\n").length;
    console.log(`${safe ? "OK  " : "BUG "} ${f}:${line}`);
  }
}
