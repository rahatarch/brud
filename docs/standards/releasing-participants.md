# Releasing participants

One generic pipeline releases every participant (`@brud/<name>`), one participant per run. It is separate from the BrudOS release (`releasing.md`, tags `v*`) and the CLI release (`releasing-cli.md`, tags `cli-v*`).

## How it works

- **Tag:** `<name>@<version>`, for example `settings@0.1.0`. The tag names the package (`@brud/settings`); the three tag patterns cannot match each other.
- **Workflow:** `.github/workflows/release-participant.yml`, environment `release-participant` (required reviewer, no admin bypass, deployments limited to the `*@*` tag pattern).
- **Stages:** verify, build and pack once, install and load on 3 OS x Node 22/24, human approval, publish (provenance), registry check, GitHub Release (never "Latest"). If the version is already on npm with identical bytes, the run adopts it: nothing is published, the Release is still created.
- **Scripts:** `scripts/release-participant/`. Tests: `npm run test:release-participant`.

## What makes a package a participant

`package.json` carries `"brud": { "role": "participant" }`, and the name is not reserved (`kernel`, `protocol`, `sdk`, `daemon`, `cli`, `ui`). The pipeline never decides by folder or name prefix.

## Gates (`verify`)

role set; name not reserved; version matches the tag and is greater than the previous release; not private; `publishConfig.access` public; license, repository, `engines.node`; `files` is exactly `["dist"]`; README.md and LICENSE in the package; no install scripts; no `*`, `workspace:`, `file:` or `link:` ranges; `@brud/kernel` is a peer dependency; lockfile entry matches; release notes at `docs/release-notes/<name>@<version>.md` (first line `# <name> <version>`, `## Summary`, `## Changes`); every `@brud` dependency is already on npm at a satisfying version.

## Releasing one participant

1. Write the notes and make sure the package has README.md and LICENSE; merge them.
2. `npm run release:participant:prepare -- <name> <version>` bumps the version, turns `*` into `^<version>` of that workspace package, moves the kernel to `peerDependencies`, and commits. Push it and wait for CI.
3. `npm run release:participant:tag -- <name> <version> --push` (HEAD must equal origin/main, tree clean).
4. Approve the run in GitHub.

## First publish of a participant

npm trusted publishing needs the package to exist, so the first publish is by hand with 2FA. `npm run release:participant:bootstrap -- <name...>` (or `--all`) prints the exact commands: build and pack, `npm publish ... --access public`, then `npm trust github ... --env release-participant`. An unused trust entry expires after 2 days. Do this for each participant once.

## One-time GitHub setup

Environment `release-participant` (required reviewer, admin bypass off, deployment tag rule `*@*`). Tag ruleset for `*@*` blocking deletion and force-push. Run the workflow's own setup the same way as `releasing-cli.md`.

## Known limits

- Smoke installs the tarball and loads it; booting it in a composition and per-kind conformance suites come later.
- Dependency cycles between participants are not detected yet.
- Participants release independently. A dependent is not released automatically when a dependency changes.
