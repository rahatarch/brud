# Releasing the Brud CLI

How `@brud/cli` (the `brud` command) is released. This is a **separate pipeline** from the BrudOS release described in [`releasing.md`](releasing.md): different tag, different workflow, different scripts, its own version number. A CLI release never touches the kernel, SDK, daemon or protocol, and a BrudOS release never publishes the CLI.

| | BrudOS release | CLI release |
|:--|:--|:--|
| Tag | `v<version>` | `cli-v<version>` |
| Workflow | `.github/workflows/release.yml` | `.github/workflows/release-cli.yml` |
| Scripts | `scripts/release/` | `scripts/release-cli/` (copied, shares no code) |
| GitHub environment | `release` | `release-cli` |
| Notes file | `docs/release-notes/v<version>.md`, first line `# BrudOS <version>` | `docs/release-notes/cli-v<version>.md`, first line `# Brud CLI <version>` |
| GitHub "Latest" badge | Yes | Never |

## 1. The short version

```bash
# 1. Write docs/release-notes/cli-v<version>.md, commit it, merge it to main.
# 2. Bump the CLI version and commit (publishes nothing):
npm run release:cli:prepare -- 0.0.2
# 3. Push, wait for CI, merge to main. Then tag and push the tag:
npm run release:cli:tag -- 0.0.2 --push
# 4. GitHub > Actions > Release CLI: when the run waits at "Publish to npm", review and approve.
```

Other commands: `npm run release:cli:verify` (read-only pre-flight, same as the workflow's first job), `npm run release:cli:pack -- --out <dir>` (build first with `npm run build:cli`), `npm run test:release-cli` (offline tests of the scripts).

## 2. What the workflow does

Runs on `cli-v*` tags. Each job stops the release if it fails; only **Publish to npm** changes anything outside GitHub.

1. **Verify:** tag name, annotated tag, tag on `main`, version matches the tag everywhere, notes valid, no published GitHub Release for the tag, and whether the version is already on npm.
2. **Build, test and pack:** builds protocol, kernel, sdk, services, daemon and the CLI (the CLI's tests run against the real kernel), runs the CLI tests, the boundary check and ESLint on the CLI, packs the tarball once and attests build provenance.
3. **Smoke test** (Linux, macOS, Windows; Node 22 and 24): installs the tarball **globally** and checks that `brud --version`, `brud --help` and `brud init --no-install` work, then installs it into a project next to kernel, sdk and daemon (newest versions its peer ranges allow, from npm) and runs `brud init`, `doctor`, `check`, `call` and a call through a real daemon. The temporary folder has a space in its name on purpose.
4. **Publish to npm:** waits for approval in the `release-cli` environment, then publishes the same tarball with provenance, never overwriting an existing version.
5. **Install from the registry:** installs `@brud/cli@<version>` from npm and repeats the smoke test (retries for up to 4 minutes).
6. **GitHub Release:** draft, attach tarball, `SHA256SUMS` and `release-manifest.json`, check the asset count, publish. Always created with `--latest=false`.

**Adopt mode.** If the version is already on npm with identical bytes (for example the first release, published by hand), nothing is published; the workflow fetches the registry tarball, smoke-tests it, waits for approval and creates the release.

## 3. One-time setup

1. **GitHub environment.** Settings > Environments > New environment `release-cli` (exact name). Add *Required reviewers*; untick *Allow administrators to bypass*; under *Deployment branches and tags* add the tag rule `cli-v*`. (The `release` environment only allows `v*` and cannot be used.)
2. **First publish, by hand** (a package must exist on npm before it can have a trusted publisher):
   ```bash
   npm run build:cli && npm run release:cli:pack -- --out /tmp/cli-first
   npm publish /tmp/cli-first/brud-cli-<version>.tgz --access public   # needs a 2FA login
   ```
3. **npm trusted publishing** (npm 11.15.0 or newer, normal 2FA login):
   ```bash
   npm trust github @brud/cli --file release-cli.yml --repo rahatarch/brud --env release-cli --allow-publish --allow-stage-publish
   npm trust list @brud/cli
   ```
   Values are case-sensitive and not checked when saved; a typo shows up at publish time. A trusted-publisher entry that has not completed a publish within 2 days of creation expires.
4. **No tokens.** Package settings > Publishing access > *Require two-factor authentication and disallow bypass 2fa tokens*.
5. **Tag protection** (recommended): restrict who may create, update and delete `cli-v*` tags.
6. Then release the same version through the workflow (adopt mode) or the next one normally.

## 4. When something goes wrong

The same rules as the BrudOS pipeline apply (see section 6 of `releasing.md`), with these names changed: tag `cli-v<version>`, workflow *Release CLI*, environment `release-cli`, command `release:cli:*`.

- Failure in Verify, Build or Smoke publishes nothing: fix on `main`, then delete and recreate the tag (`git tag -d cli-vX && git push origin :refs/tags/cli-vX`, then `npm run release:cli:tag -- X --push`). A rerun uses the old commit.
- Publish stopped halfway or the GitHub Release failed: **Re-run failed jobs**, never *Re-run all jobs*.
- A bad version is live: never delete or retag. Release the next version and `npm deprecate @brud/cli@<bad> "use <good>"`.
- Rehearsal: Actions > Release CLI > Run workflow with an existing tag. It runs verify, build and smoke but never publishes.

## 5. Known limits

- A global install has no kernel, sdk or daemon (they are optional peers), so `doctor`, `check`, `call` and `run` only work inside a project that has them. `brud init` works from nothing: with `--no-install` it creates the project, exits 0 and leaves `brud.config.json` for `brud init --finish` after `npm install`. The smoke test checks `--version`, `--help` and `init --no-install` globally. A plain global `brud init` (with the install) has not been verified against published packages, because `@brud/cli` is not on npm yet.
- ESLint on `packages/cli` is a release gate here (it is clean today), unlike the repository-wide lint, which is informational because of debt elsewhere.
- The workflow cannot undo an npm publish; the smoke test and the human approval come first.
