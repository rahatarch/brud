# GitHub Release Standard

The single standard for every GitHub Release of BrudOS. If a release needs to break a rule, change this document first, in its own commit.

It follows what established projects do: [Semantic Versioning](https://semver.org) and `v`-prefixed tags (Linux, Node.js, Electron), [Keep a Changelog](https://keepachangelog.com) change types, Node.js-style `**subsystem:**` entries and checksum files, and Electron-style short, link-heavy notes.

## 1. Principles

1. **One release, one version, one tag.** All `@brud/*` packages ship in lockstep. The tag is that version.
2. **Only BrudOS.** The kernel, hardcore services, daemon and SDK (plus `@brud/protocol`, which they depend on). The CLI, plugins and composed services are not released here.
3. **Notes are for users.** What changed, whether it is safe to upgrade, how to verify the download. Nothing else.
4. **Short beats complete.** A section with nothing to say is left out, not filled with `None.`.
5. **Publish to npm first.** The release describes what is already on the registry.

## 2. Versioning and tags

- Tag: `v<version>`, annotated; signed when a signing key is set up. Examples: `v0.0.1`, `v0.1.0`, `v1.0.0-beta.1`.
- The tag points at the exact commit that was published. Never move or reuse a tag; fix forward with a new version.
- A release is marked **Pre-release** when its version has a prerelease identifier (`-beta.N`, `-rc.N`). The first public release may also be marked Pre-release by hand if it is meant as a beta. Everything else is marked **Latest**.
- Title: `BrudOS <version>`. A codename is optional and only for minor or major releases.

## 3. What a release contains

**Required**
- **Notes** (section 4) in the release body.
- **Tarballs:** the exact `.tgz` files that were published to npm, one per package.
- **`SHA256SUMS`:** SHA-256 of every attached file (Node.js ships the same).
- **Tag** on the release commit.

**Optional, add when available**
- A signature for `SHA256SUMS`, an SBOM, npm provenance.

GitHub's automatic source archives stay but are not the supported artifact.

## 4. Release notes

Notes live in `docs/release-notes/v<version>.md`. The GitHub Release body is a copy.

Always present:

| Section | Contents |
|:--|:--|
| **Summary** | Two to four sentences: what this release is and who should care. For a security release, say so in the first line. |
| **Changes** | Grouped under Keep a Changelog headings: **Added, Changed, Deprecated, Removed, Fixed, Security**. Leave out empty groups. |
| **Packages** | Table of published packages and versions. Add one line with the supported Node.js range. |
| **Verification** | The release commit, and a pointer to the attached `SHA256SUMS`. |

Present only when it applies:

| Section | When |
|:--|:--|
| **Breaking changes** | Any change that needs user action. Put it first, right after the Summary, with the exact migration step. |
| **Notable changes** | Large releases only: three to five items worth a paragraph. |
| **Upgrade notes** | Steps are needed beyond `npm update`. |
| **Known issues** | An open problem affects users. Give the workaround. |

Writing rules:

- One line per change, past tense, starting with the component in bold: `**kernel:** Rejected ...`. End with the PR or commit link.
- Security items name the advisory or CVE ID once it is public, and a severity if known.
- End with GitHub's generated "Full Changelog" compare link (`vPREV...vNEW`). Do not hand-write a contributor list.
- No internal ledger paths, private links, secrets or machine paths.
- Summarise; do not paste commit messages.
- The first release needs only Summary, Packages and Verification.

## 5. Process

1. **Freeze.** CI is green on the release commit, including the full Test Matrix.
2. **Version check.** All `@brud/*` versions, internal ranges, `SDK_VERSION`, `SDK_TARGET_KERNEL` and the lockfile agree.
3. **Install check.** Pack the tarballs, install them into an empty folder, boot a kernel, an SDK participant, a caged participant and the daemon.
4. **Notes.** Write the notes file and review it in a pull request.
5. **npm publish,** in dependency order: protocol, kernel, sdk, daemon, then services. Confirm each on the registry.
6. **Tag** the release commit and push it.
7. **GitHub Release.** Create it as a draft from the tag with notes, tarballs and `SHA256SUMS`, check it, then publish.
8. **Post-publish check.** Install from the registry into an empty folder and rerun the install check.

## 6. Corrections

- A bad release is never deleted or retagged. Publish the next version, add a warning line at the top of the bad release pointing to it, and `npm deprecate` the broken versions.
- A security fix goes through a private advisory first; the notes link it once public.

## 7. Template

````markdown
# BrudOS <version>

## Summary
<Two to four sentences.>

## Breaking changes        <!-- only if any -->
- **<component>:** <what changed and the migration step>. (#<pr>)

## Changes
### Added
- **<component>:** <change>. (#<pr>)
### Changed
### Fixed
### Security

## Upgrade notes           <!-- only if needed -->
## Known issues            <!-- only if any -->

## Packages
| Package | Version |
|:--|:--|
| `@brud/kernel` | <version> |
| `@brud/sdk` | <version> |
| `@brud/protocol` | <version> |
| `@brud/daemon` | <version> |

Requires Node.js >=22.

## Verification
Release commit `<sha>`. Checksums are in the attached `SHA256SUMS`.

**Full Changelog:** <compare link>
````

## 8. Checklist

- [ ] CI and Test Matrix green on the release commit
- [ ] Versions, ranges, `SDK_VERSION`, `SDK_TARGET_KERNEL` and lockfile agree
- [ ] Install check passed from packed tarballs
- [ ] Notes reviewed and merged, with no secrets or private links
- [ ] Published to npm in dependency order and confirmed
- [ ] Tag pushed; draft release has tarballs and `SHA256SUMS`; Pre-release flag is right
- [ ] Post-publish install from the registry passed
