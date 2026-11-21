# Releasing BrudOS

How a release happens, how to set it up once, and what to do when something goes wrong. The rules about what a release contains are in [`github-releases.md`](github-releases.md).

## How it works

You do three things: write the notes, run two commands, click Approve. The workflow (`.github/workflows/release.yml`) does the rest.

1. **Verify.** Tag is annotated, on `main`, and matches every package version, internal range, `SDK_VERSION`, `SDK_TARGET_KERNEL` and the lockfile. Notes pass their checks.
2. **Build and test once.** Build, unit tests, boundaries, lint, then `npm pack`. Those exact tarballs are tested and published; nothing is rebuilt in between.
3. **Smoke test** on Linux, macOS and Windows (Node 22 and 24): install the tarballs into an empty project, check every cage binary against its pinned digest, scaffold a project, run its tests, `brud doctor`, `brud check`, `brud call`, and a call through the daemon.
4. **Approval.** The run stops at the `release` environment until a reviewer approves.
5. **Publish** to npm in dependency order with provenance, no stored token. It skips versions already published with identical bytes, stops if bytes differ, and compares the registry copy with the local tarball after each publish. A prerelease version is published under `next`, never `latest`.
6. **Registry check.** Install `@brud/*@<version>` from npm and boot it.
7. **GitHub Release**, created as a draft, assets verified, then published. Last, so it only ever describes what is live.

If every package is already on npm (for example `0.0.1`, published by hand), the workflow adopts the registry tarballs instead of publishing and still runs the smoke test and creates the release.

## Releasing a version

```bash
# 1. Write docs/release-notes/v<version>.md and merge it (see github-releases.md).
# 2. Bump and commit (checks everything first; publishes nothing):
npm run release:prepare -- 0.0.2          # add --dry-run to only check
# 3. Push, wait for CI, merge to main. Then tag and push the tag:
npm run release:tag -- 0.0.2 --push
# 4. Open the run in GitHub > Actions > Release, check the results, click Approve.
```

`npm run release:verify` runs the same checks as the first CI job at any time. To rehearse without publishing, run the workflow by hand (Actions > Release > Run workflow) with an existing tag: it stops before the approval step.

## One-time setup (needs a human)

1. **GitHub environment.** Repo Settings > Environments > New environment `release`. Add yourself (and any co-maintainer) under *Required reviewers*. Without a reviewer the gate does nothing.
2. **npm trusted publishing**, for each of `@brud/protocol`, `@brud/kernel`, `@brud/sdk`, `@brud/daemon`: npmjs.com > the package > Settings > *Trusted publisher* > GitHub Actions, organization/user `rahatarch`, repository `brud`, workflow filename `release.yml`, environment `release`. Then set each package's publishing access to *Require two-factor authentication and disallow tokens*.
3. **Tag protection.** Settings > Rules > Rulesets: restrict creating and deleting tags matching `v*` to maintainers, and block tag updates.
4. **Branch protection** on `main`: require the Cross-Platform Tests check.
5. Optional: sign tags (`release:tag -- <version> --sign`); enable Dependabot (already configured) so action versions stay current.

## When something goes wrong

- **A check fails before approval.** Nothing was published. Fix on `main`. If the tag is wrong, delete it before anything is published, fix, and tag again. Once any package is on npm, never move the tag: ship the next version.
- **Publish stops halfway.** Use *Re-run failed jobs*, not *Re-run all jobs*. The same tested tarballs are reused and finished packages are skipped. Re-running everything rebuilds, which would conflict with what is already published.
- **"already exists with different contents".** Never overwrite. Choose a new version and release again.
- **A bad version is live.** Do not delete or retag. Publish the next version, add a warning line at the top of the bad release's notes, and `npm deprecate` the broken versions.

## What it does not do

- It cannot undo an npm publish. That is why the approval comes first and the smoke test before it.
- macOS Intel (`darwin-x64`) is verified by digest only, since the runners are Apple silicon.
- The GitHub Actions are pinned to major versions, not commit hashes; Dependabot keeps them current.
