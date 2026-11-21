# Releasing BrudOS

How a BrudOS release works end to end: what to run, what each step does, and how to fix the things that go wrong. What a release must contain (notes, assets, versioning) is defined in [`github-releases.md`](github-releases.md).

**Scope.** Only the kernel, SDK, daemon and protocol are released this way (`@brud/kernel`, `@brud/sdk`, `@brud/daemon`, `@brud/protocol`), in lockstep at one version. The CLI, plugins and composed services are not part of it.

## 1. The short version

```bash
# 1. Write docs/release-notes/v<version>.md, commit it, merge it to main.
# 2. Bump versions and commit (publishes nothing):
npm run release:prepare -- 0.0.2
# 3. Push, wait for CI, merge to main. Then tag and push the tag:
npm run release:tag -- 0.0.2 --push
# 4. GitHub > Actions > Release: when the run waits at "Publish to npm", review and approve.
```

That is all a human does: write the notes, run two commands, click Approve. Everything else is the workflow.

## 2. What each command does

| Command | What it does | Changes anything? |
|:--|:--|:--|
| `npm run release:verify` | The same pre-flight checks as the first CI job: versions, internal ranges, `SDK_VERSION`, `SDK_TARGET_KERNEL`, lockfile, README and LICENSE present, no install scripts, release notes valid, and whether the packages are already on npm. | No |
| `npm run release:prepare -- <version>` | Checks the tree is clean and the notes exist, then bumps the four core packages, every internal `^` range, the SDK contract constants and `package-lock.json`, re-checks everything, and commits `release: v<version>`. If the bump leaves the tree inconsistent it reverts itself. Add `--dry-run` to only check. | Commits locally |
| `npm run release:tag -- <version> [--push] [--sign]` | Checks HEAD equals `origin/main`, the tree is clean, versions and notes are valid and the tag does not exist yet, then creates the annotated tag `v<version>`. With `--push` it pushes the tag, which starts the workflow. | Creates (and pushes) the tag |
| `npm run test:release` | Tests for the release scripts, including a full prepare-then-tag run in a throwaway git repo. | No |
| `npm run release:pack` | Packs the four tarballs into `dist-release/` with `SHA256SUMS` and `release-manifest.json`, and checks their contents. Useful locally; CI runs it itself. | Writes `dist-release/` |

`scripts/release/smoke.mjs`, `publish.mjs` and `body.mjs` are run by the workflow. You normally never call them, but `node scripts/release/smoke.mjs --dir dist-release` is a good local check of a packed release.

## 3. What the workflow does

`.github/workflows/release.yml` runs when a `v*` tag is pushed. Jobs run in this order; each one stops the release if it fails.

| Job | What it does | Publishes anything? |
|:--|:--|:--|
| **Verify the release** | Tag name is a version; tag is annotated, points at the checked-out commit and is on `main`; all versions, ranges and the lockfile agree; notes are valid; no published GitHub Release already exists for the tag; works out whether the packages are already on npm. | No |
| **Build, test and pack** | `npm ci`, build, kernel/SDK/daemon/CLI tests, boundary and lint checks, then `npm pack` once. Attests build provenance. Uploads the tarballs as an artifact. | No |
| **Smoke test** (Linux, macOS, Windows; Node 22 and 24) | Installs the packed tarballs into an empty project and boots them: versions, every cage binary against its pinned digest, scaffold a project, run its tests, `brud doctor`, `brud check`, `brud call`, and a call through a real daemon. | No |
| **Publish to npm** | Waits for a human to approve (the `release` environment). Then publishes the same tarballs in dependency order with provenance, no stored token. | **Yes** |
| **Install from the registry** | Installs `@brud/*@<version>` from npm into an empty project and boots it again (retries for up to 4 minutes while the registry catches up). | No |
| **Create the GitHub Release** | Builds the body (your notes plus generated Packages and Verification), creates a draft release, attaches the tarballs, `SHA256SUMS` and `release-manifest.json`, checks the asset count, then publishes it. | Release page |

Key guarantees:

- **The tarballs tested are the tarballs published.** They are packed once and never rebuilt.
- **Never overwritten.** A version already on npm with identical bytes is skipped; with different bytes the run stops.
- **A prerelease never becomes `latest`.** Versions such as `1.0.0-beta.1` publish under the `next` dist-tag and are flagged Pre-release.
- **The GitHub Release comes last**, so it only describes what is live.
- **Adopt mode.** If all four packages are already on npm (for example `0.0.1`, which was published by hand), the workflow fetches the registry tarballs instead of publishing. It still smoke-tests them, waits for approval, and creates the release.

## 4. Release notes

You write `docs/release-notes/v<version>.md`:

```markdown
# BrudOS 0.0.2

## Summary
Two to four sentences: what this release is and who should care.

## Changes
### Fixed
- **kernel:** Rejected a malformed manifest instead of crashing. (#12)
```

The pipeline rejects notes that: have the wrong first line, have no Summary or a very short one, have no Changes (except on the very first release), contain `## Packages` or `## Verification` (generated for you), contain placeholders such as `<component>`, TODO or TBD, mention `.internal_docs`, contain a machine path, or look like they contain a token. Breaking changes, upgrade notes and known issues go in their own sections only when they apply.

## 5. One-time setup

1. **GitHub environment.** Settings > Environments > New environment `release`. Add *Required reviewers*. Untick *Allow administrators to bypass configured protection rules*. Under *Deployment branches and tags*, choose *Selected branches and tags* and add the tag rule `v*`. The name must be exactly `release`.
2. **npm trusted publishing**, for each of the four packages. Requires npm 11.15.0 or newer and a normal 2FA login:
   ```bash
   npm login
   for p in protocol kernel sdk daemon; do
     npm trust github @brud/$p --file release.yml --repo rahatarch/brud --env release --allow-publish --allow-stage-publish
   done
   for p in protocol kernel sdk daemon; do npm trust list @brud/$p; done
   ```
   The values are case-sensitive and npm does not check them when you save, so a typo only shows up at publish time. The web UI (package > Settings > Trusted Publisher) does the same.
3. **No tokens.** Per package: Settings > Publishing access > *Require two-factor authentication and disallow bypass 2fa tokens*. Trusted publishers keep working.
4. **Tag and branch protection** (recommended): restrict who may create, update and delete `v*` tags; protect `main` and require the Cross-Platform Tests check.
5. Optional: sign tags (`release:tag -- <version> --sign`). Dependabot is already configured to keep the GitHub Actions current.

## 6. Edge cases and fixes

### Before the tag

| Problem | Cause | Fix |
|:--|:--|:--|
| `release:prepare`: "tree has uncommitted changes" | Stray files | Commit or stash them. |
| `release:prepare`: "must be greater than the current version" | Wrong version | Use a higher version. |
| `release:prepare`: "write and commit the release notes first" | No notes file | Create `docs/release-notes/v<version>.md`, commit it, run again. |
| `release:prepare`: bump "left the tree inconsistent, so it was reverted" | A core package uses a range that is not `^<version>` (for example `>=0.0.1`) | Change that range to a caret range and run again. The error lists the exact lines. |
| `release:tag`: "HEAD is not the same commit as origin/main" | Not pushed or not on main | Push and merge, then `git checkout main && git pull`. |
| `release:tag`: "already exists" | The tag exists locally or on GitHub | Never move a tag that has published anything. If nothing was published and no GitHub Release exists, delete it (`git tag -d vX` and `git push origin :refs/tags/vX`), fix the problem on main, tag again. Otherwise release the next version. |
| `release:verify`: notes problems | See section 4 | Edit the notes; the message names each problem. |

### During the run (nothing published yet)

A failure in **Verify**, **Build, test and pack** or **Smoke test** publishes nothing. Fix the cause on `main`, then recreate the tag so the run uses the fixed code (a rerun uses the old commit):

```bash
git tag -d v<version> && git push origin :refs/tags/v<version>
git pull
npm run release:tag -- <version> --push
```

| Failing job | Usual causes |
|:--|:--|
| Verify: "not on main" / "points at a different commit" | The tag was created on a branch, or main moved. Retag from current main. |
| Verify: "A published GitHub Release already exists" | The version was already released. Use a new version. |
| Build, test and pack | A real test or lint failure. Fix it like any CI failure. |
| Smoke (a single OS) | An OS-specific problem. Example fixed in `0.0.1`: macOS limits Unix socket paths to about 100 bytes and the runner's temp folder is long, so the daemon would not start. The smoke test now uses a short folder under `/tmp`. |
| Smoke: "every cage binary matches its pinned digest" | The binaries and `nativeDigests.ts` disagree. Run the `cage-native` workflow to regenerate them; never edit a hash by hand. |

### At the approval step

- The run shows **Waiting** at *Publish to npm*. Open it, click **Review deployments**, tick `release`, **Approve and deploy**.
- If nobody approves for a long time, GitHub eventually cancels the run (the limit is 30 days). Recreate the tag and run again.
- You cannot approve your own run if *Prevent self-review* is on and you triggered it. With a single maintainer leave it off.

### Publishing

| Problem | Cause | Fix |
|:--|:--|:--|
| Publish fails with an authentication or "trusted publisher" error | The trusted-publisher entry expired (it must complete a publish within 2 days of creation), was mistyped, or the environment name differs from `release` | Recreate it: `npm trust list @brud/<name>`, `npm trust revoke @brud/<name> --id <id>`, then `npm trust github ...` as in section 5. Then **Re-run failed jobs**. |
| "npm is too old for trusted publishing" | Runner npm below 11.5.1 | The workflow upgrades npm itself; if this appears, check the step before it. |
| Publish stopped halfway (some packages live) | Network or registry error | Use **Re-run failed jobs**, never **Re-run all jobs**. The same tested tarballs are reused and finished packages are skipped. Re-running everything would rebuild, and rebuilt bytes can differ from what is already published. |
| "already exists on npm with different contents" | The version is on npm with other bytes | Never overwrite. Choose a new version and release again. |
| "Refusing to publish: ... does not match its checksum" | A tarball changed after it was packed | Treat it as an incident. Do not publish; rerun the whole release from a new tag after finding out why. |
| A package does not appear within 15 minutes | Registry delay or a rejected publish | Check the package page on npmjs.com. Re-run failed jobs once; if it persists, send the log to npm support. |
| Artifacts are missing on a re-run | Artifacts expire after 30 days | Recreate the tag and run again. |

### After publishing

| Problem | Fix |
|:--|:--|
| **Install from the registry** fails once and succeeds on retry | Normal registry delay; it already retries four times. |
| **Install from the registry** fails every time | The packages are live but broken. Do not touch the tag. Investigate, then release the next version and deprecate the bad one (below). |
| **Create the GitHub Release** fails | npm is fine. **Re-run failed jobs**; a leftover draft is replaced automatically. A published release is never replaced. |
| The release notes have a mistake | Fix `docs/release-notes/v<version>.md` in a pull request and edit the body on the GitHub Release page by hand. Do not retag. |
| A bad version is live | Never delete or retag. Publish the next version, add a warning line at the top of the bad release, and `npm deprecate @brud/<name>@<bad> "use <good>"` for each package. |

### Other situations

- **Prerelease.** Version `1.0.0-beta.1`: published with `--tag next`, marked Pre-release, never `latest`. Install with `npm i @brud/kernel@next`.
- **Rehearsal.** Run the workflow by hand (Actions > Release > Run workflow) with an existing tag. It runs verify, build and smoke but never the publish or release jobs. It uses the code as it was at that tag.
- **Two tags close together.** Runs are queued one at a time; they never run in parallel.
- **First release of a line, or packages already on npm.** Adopt mode (section 3) handles it; no publish happens, and a trusted-publisher entry that has not yet published will still expire.

## 7. Verifying a release (for users)

```bash
sha256sum -c SHA256SUMS                          # attached tarballs match the checksums
gh attestation verify brud-kernel-<v>.tgz --repo rahatarch/brud   # built by the release workflow
npm audit signatures                             # after install: npm provenance and signatures
```

Build attestations exist for versions built by the workflow; a release that adopted already-published packages has none for those tarballs.

## 8. Known limits

- The workflow cannot undo an npm publish. That is why the smoke test and the human approval come first.
- `darwin-x64` cage binaries are checked by digest only, since the macOS runners are Apple silicon.
- GitHub Actions are pinned to major versions, not commit hashes; Dependabot keeps them current.
