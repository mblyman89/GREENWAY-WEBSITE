# Why Vercel kept failing while every check said green

**For: Michael**
**Short version: our CI was building with more memory than Vercel has. It was
testing a machine that does not exist.**

---

## Part 0 — The 30-second version

The build did not fail because of anything wrong with your code, the filters, or
the scanner. It ran out of **memory** on Vercel.

And the reason nobody caught it is worse than the bug: the check in our pipeline
that is literally named *"next build (the command Vercel runs)"* was **not**
running the command the way Vercel runs it. It gave the build 6 GB of memory.
Vercel gives it about 4 GB. So our check passed comfortably on builds that
Vercel could not finish.

That is why three slices in a row merged green and the site still would not
deploy. I have fixed both the memory problem and the blind spot that hid it.

---

## Part 1 — What actually ran out of memory

A Next.js build has two big phases: it **compiles** your code, then it
**type-checks** it.

Compiling was never the problem — it finished fine every time. The type-check is
what died.

Here is the wasteful part. Our TypeScript settings tell the type-checker to load
**every `.ts` file in the repository**, which now includes **563 test files** —
roughly 9,000 lines of compliance assertions. The build dutifully loads all of
them into memory, type-checks them, and then **throws every one of those results
away**, because Next.js deliberately ignores errors in test files.

So the build was paying full memory price for work whose answer it had already
decided to discard. And that cost grew with every slice we shipped — 537 test
files a few slices ago, 561 by the inventory-filtering slice. It crept up until
it crossed Vercel's ceiling.

I reproduced it exactly: with the memory capped, the build prints *"Compiled
successfully"* and then dies inside *"Running TypeScript"* with
*"Ineffective mark-compacts near heap limit"*. Compile fine, type-check crash.

---

## Part 2 — Why our own checks never caught it

This is the part I want to be straight with you about, because it is the real
failure and it is mine.

Node.js decides how much memory to use based on the machine it is on — roughly
half the available RAM. The GitHub runner our CI uses is a big machine.
Vercel's build container is documented at 8 GB, which works out to about 4 GB of
usable heap.

On top of that, our CI build step **explicitly** raised its own limit to 6 GB,
with a comment claiming this "mirrors the headroom a Vercel build machine has."
That comment was simply wrong. It did not mirror Vercel. It gave CI about **50%
more memory than the machine that actually deploys the site**.

A check that runs the real command under better conditions than production is
not a safety net. It is a check-shaped object. It cannot fail for the reason
production fails, which is precisely what we observed.

---

## Part 3 — The three fixes

**1. Stop doing the useless work.** The build now uses `tsconfig.build.json`,
which excludes test files from the build's type-check. This cut the program from
2,485 files to 1,873 — about 25% less.

To be completely clear about what this does *not* do: it does **not** turn off
type checking, and it does **not** hide errors. All 1,858 of your application
files are still fully type-checked and a real type error still fails the build.
I proved that by deliberately injecting a type error into application code and
confirming the build config still catches it. Your test files are still fully
type-checked too — by `npm run typecheck` in the compliance job. They are now
checked **once**, in the job built for it, instead of twice.

There was a lazy version of this fix available (`ignoreBuildErrors: true`) that
would have turned the build green by making it blind. I did not use it, and
there is now a test that fails if anyone ever does.

**2. Pin the memory explicitly.** The build command now sets its own ceiling of
7168 MB, so CI and Vercel use the same number instead of each guessing from
their own hardware. 7168 rather than 8192 deliberately: the build agent needs
room, and setting it to the full container just trades one crash for another.

**3. Make CI honest.** I removed the memory override from the CI build step. It
now runs `npm run build` exactly as Vercel does. If a build cannot fit on
Vercel, CI will now fail **too** — which is the entire point of that job.

---

## Part 4 — Making sure this cannot come back

I added `tests/compliance/build-matches-vercel.test.ts`, which fails if:

- the build script stops pinning its memory ceiling,
- the ceiling is set to the full container size (trading a heap error for a
  kernel kill),
- someone re-adds a memory override to the CI build step, re-opening the exact
  CI-vs-Vercel gap that hid this,
- someone "fixes" a future build failure with `ignoreBuildErrors`,
- or the root config stops type-checking tests, quietly losing the coverage this
  change was careful to preserve.

I verified each of those five guards by actually breaking the thing it protects
and confirming the test went red, then restoring it. A guard I have not seen
fail is a guard I have not verified.

---

## Part 5 — What I got wrong before this

You were right to push back. On the previous pass I fixed three genuine type
errors and a real gap in our type checking, and I told you plainly in the pull
request that it did **not** explain the Vercel failure. But I should not have
stopped there and handed it back to you — the thing you asked for first was
still broken.

What I had missed was that I was reading the CI build job as evidence that the
build was fine. It was not evidence of that, because it was not running under
Vercel's conditions. Once I stopped trusting that job and measured the memory
myself, the cause was clear within minutes.

The earlier work was not wasted — the `npm run typecheck` gate added then is
exactly what now lets the build safely skip test files without losing coverage.
But the ordering was wrong, and I am sorry for the extra round trip.
