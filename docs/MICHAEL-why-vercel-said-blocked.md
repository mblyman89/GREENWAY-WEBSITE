# Why Vercel said BLOCKED, and what I changed

Michael — this is the plain-English version. The short answer is that the last
slice was committed under the wrong email address, and Vercel refuses to build
commits it cannot tie to a person on your team. Nothing was wrong with the code.

## What you were seeing

The Vercel dashboard said **BLOCKED**, not "failed". That distinction turns out
to be the whole story. A failed build is one that started, ran, and hit an
error — it has build logs you can open and read. A blocked deployment never
started at all, so there is nothing to log, which is why the Building section
was empty and there was no error message to chase.

## The actual cause

Every commit in git carries an author email address. Vercel takes that address,
looks up which GitHub account it belongs to, and checks whether that account is
a member of your Vercel team. If it cannot find a person, it refuses to build.

Here is the exact comparison between the slice that deployed and the slice that
did not:

| Commit | Author email | GitHub account | Vercel |
|---|---|---|---|
| `3d25026` Slice 12 | `dev@greenwaymarijuana.com` | `mblyman89` (you) | deployed |
| `10eb1a6` Slice 13 | `superninja@ninjatech.ai` | none | **BLOCKED** |

`dev@greenwaymarijuana.com` is a verified email on your GitHub account, so
Vercel resolves it to you, sees you own the project, and builds. The other
address belongs to no GitHub account whatsoever, so there is nobody to resolve
it to. This is confirmed directly by GitHub's own API: for the commit that
deployed, the linked account comes back as `mblyman89`; for the blocked commit,
the linked account comes back empty.

You spotted this yourself, and you were right.

## Why it happened

The git identity in my working environment was simply unset. Git does not treat
that as an error — when no identity is configured it quietly invents one from
the machine's hostname, which is how commits ended up authored as things like
`root@172.16.236.161`. Nothing warned anybody, and every automated check stayed
green, because none of them were looking at the author email.

## I ruled out the other two possibilities rather than assuming

Vercel documents exactly three reasons a deployment fails with no build logs. I
checked all three against your repository instead of stopping at the first one
that looked plausible.

The first is an invalid `vercel.json`. Yours has not been touched since
September 1, it is identical between the deployed and blocked commits, and it
parses as valid JSON. It also deployed successfully 47 times in that state, so
it cannot be what changed.

The second is an Ignored Build Step, which is a setting that tells Vercel to
skip building under certain conditions. There is no such setting in your
repository, and nothing about it changed between the two commits.

The third is a commit from someone who is not a team member. That is the only
variable that differed between the deployment that worked and the one that did
not.

## What I changed

I set the git identity back to `Greenway Dev <dev@greenwaymarijuana.com>` and
rewrote the three commits on this branch to carry it. I want to be precise
about what "rewrote" means here, because it sounds alarming: only the name and
email attached to each commit changed. Git identifies file content by a hash,
and the hash of the content is byte-for-byte identical before and after
(`2c0e1b60a70fd00ff018dbee90ecc859c72b50f9` in both cases). Not one line of
code moved. The original timestamps were preserved too.

## What stops this happening again

A rule that depends on somebody remembering is not a fix, so I made it
mechanical. There is now a check that runs on every pull request and fails it if
any commit carries an author email other than the required one. The failure
message explains what happened and gives the exact command to fix it, rather
than just reporting a mismatch.

I tested the check by deliberately breaking things, because a check that never
fails is worthless. I created commits using the exact address that caused the
real problem, using the hostname address git invents when the identity is unset,
using the correct email with the wrong display name, and using a near-miss typo
of your domain. All four were caught. I also confirmed it does **not** fire on
GitHub's own squash-merge commits, since a check that blocked every legitimate
merge would be turned off within a week.

## On squash merging: you asked, and the answer turned out to be no

You asked whether squash merging is the professional way to add slices to your
repository, and told me I could write it into the standing rules. I did write it
in. Then I tested it before relying on it, and the test said I was wrong. I am
telling you this plainly because you have asked me not to guess, and because a
rule I had already written down was about to break your deployment again.

Squash merging is a perfectly respectable practice in general, and in most
repositories I would have left the rule exactly as you suggested. It is wrong
for *this* repository, for one specific reason that has nothing to do with taste
and everything to do with the blocking problem above.

Here is what I had believed. Your recent slices were merged, kept the correct
author email, and deployed. Each of those pull requests contained a single
commit, and each one finished with the merge commit having the same identifier
as the branch. From that I concluded that a squash merge of a single-commit pull
request "fast-forwards" and preserves the author. That is a reasonable-sounding
story, and it was wrong. I had inferred a mechanism from an outcome, which is
the exact reasoning your standing rules forbid.

So I stopped inferring and ran the experiment three times, on throwaway
branches that pointed at a throwaway target, so your `main` and the real pull
request were never exposed. Every branch was deleted afterward and `main` was
re-checked each time to confirm it had not moved.

The first test squash-merged a two-commit pull request. The author came out as
`superninja-app[bot]`, an account that is not a member of your team, which is
the precise condition that produces a blocked deployment.

The second test is the one that mattered. I squash-merged a pull request
containing exactly one commit, the case I had assumed was safe. The author came
out as `superninja-app[bot]` again. There is no fast-forward. A squash merge
always creates a brand-new commit and always re-stamps it with the identity of
whoever performed the merge, which in this setup is the automation, not you. Had
I merged your work on my original rule, the deployment would have been blocked a
second time, for the same reason, after I had just told you it was fixed.

That result also explains your earlier slices honestly: they were never
squash-merged at all. A squash cannot produce a merge commit with the same
identifier as the branch, because it always makes a new one. They went in by a
different route.

The third test used a rebase merge on a three-commit pull request. All three
commits landed with the author `Greenway Dev <dev@greenwaymarijuana.com>`, and
all three resolved to your GitHub account. A rebase does re-stamp the
*committer* field as the automation, but it leaves the *author* field untouched,
and the author field is the one Vercel reads. That is the entire difference
between a deployment that runs and one that is refused before it starts.

Rule 6 now requires rebase merges and forbids squash merges outright, with that
table of results written into the rule itself so no future session has to
rediscover this or is tempted to re-derive it from a plausible-sounding story.
If you would still prefer squashed history for tidiness, it is achievable, but
it requires a change on the Vercel or GitHub side so the automation account is
recognized as a team member. I would not make that change without asking you
first.

## What happened when it merged

The work is merged. Your `main` now carries six new commits, and every one of
them is authored `dev@greenwaymarijuana.com` and resolves to your GitHub account
`mblyman89`. Directly beneath them sits the Slice 13 commit that started all of
this, still showing no associated account, which makes the contrast easy to see
in the history.

The rebase changed the commit identifiers, which is normal and expected. I
verified that the file content on `main` is byte-for-byte identical to the
content that passed the checks, so nothing was altered in transit. The full
suite then ran again on `main` itself and passed on all three jobs.

One limitation I want to be straight about: this environment has no Vercel
credentials, and the GitHub token here is not permitted to read deployment
status, so I could not watch the build from inside the sandbox. What I could
verify, I did verify, and it is the specific thing that was broken: the author
of every new commit on `main` now resolves to a real team member. When you open
Vercel, the meaningful signal is whether there are build logs at all. Logs
present means the deployment started and authorship is no longer the obstacle.
A blocked status with no logs would mean something else is involved, and that
would be new information rather than a repeat of this problem.
