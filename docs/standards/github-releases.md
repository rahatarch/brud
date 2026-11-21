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
- **`release-manifest.json`:** package names, versions, sizes and integrity hashes.
- **Tag** on the release commit.

**Optional, add when available**
- A signature for `SHA256SUMS`, an SBOM, npm provenance.

GitHub's automatic source archives stay but are not the supported artifact.

## 4. Release notes

You write the notes in `docs/release-notes/v<version>.md`. The pipeline checks them, appends the **Packages** and **Verification** sections itself, and uses the result as the GitHub Release body. Do not write those two sections by hand; the check rejects them.

You write:

| Section | Contents |
|:--|:--|
| **Summary** | Two to four sentences: what this release is and who should care. For a security release, say so in the first line. |
| **Changes** | Grouped under Keep a Changelog headings: **Added, Changed, Deprecated, Removed, Fixed, Security**. Leave out empty groups. Optional on the very first release. |

Only when it applies: **Breaking changes** (any change that needs user action, with the exact migration step), **Notable changes** (large releases, three to five items), **Upgrade notes**, **Known issues** (with a workaround).

The pipeline adds: a **Packages** table (versions and integrity hashes), the Node.js requirement, **Verification** (release commit, workflow run, how to check the checksums and provenance), and the Full Changelog compare link.

Writing rules:

- One line per change, past tense, starting with the component in bold: `**kernel:** Rejected ...`. End with the PR or commit link.
- Security items name the advisory or CVE ID once it is public, and a severity if known.
- No internal ledger paths, private links, secrets, machine paths, placeholders or TODOs. The check fails on them.
- Summarise; do not paste commit messages.

## 5. Process

The release is automated. See [`releasing.md`](releasing.md) for the exact steps, the one-time setup and recovery. In short: write the notes, run `release:prepare`, push, run `release:tag --push`, then approve the run in GitHub.

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
````
