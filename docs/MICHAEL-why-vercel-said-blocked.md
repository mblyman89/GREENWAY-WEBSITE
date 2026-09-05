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

## On squash merging

You asked whether squash merging is the proper professional approach, and
whether to make it a standing rule. It is, and I have written it into the rules
as rule 6.

There is one detail worth knowing, because it interacts directly with the
problem above. When a pull request contains a single commit, GitHub's squash
merge fast-forwards, meaning the commit lands on `main` exactly as it was — same
hash, same author. That is what happened with your recent slices. The practical
consequence is that **the author email has to be correct on the branch, before
the merge**; the merge will not correct it for you. That is precisely why the
new check runs on pull requests rather than after merging.

## What to expect

Once this merges, the resulting commit on `main` will be authored
`dev@greenwaymarijuana.com`, which Vercel resolves to your account, and the
build should start normally instead of being blocked. If it still does not
build, the cause will be something other than authorship, and the empty-versus-
populated build log will tell us immediately which of the two situations we are
in.
