# Brud OS Q-03: The Content-Hash Trust Root

Nov 12, 2026 · @Rahat Hasan

**Status.** Decided. This document is the architecture decision record for the trust root used to verify official package contents. It answers Q-03, the official-flag trust root question recorded by the WASM host interface document. It decides the trust root; it is not an implementation guide. The decision is settled and is recorded here without alternatives. Decided 2026-11-12.

## Purpose and scope

The kernel loads participants and issues an identity token bound to verified contents. That binding needs a trust root: a rule that says what the kernel compares a loaded package against. This document decides the rule. The rule is a SHA-256 content hash, pinned per package and per version in the operator's configuration. There is no publisher signature, no marketplace, and no external trust chain.

The document records the decision, what it means, what it does not do, why it was chosen, how it relates to the companion records, and what remains an implementation task. It governs the official-flag trust root. It does not decide the admission policy for unofficial packages; the cage contract governs those.

## Decision register

| ID | Decision |
|---|---|
| Q03-01 | The trust root is a content hash pinned in the operator's configuration. There is no publisher signature, no marketplace, and no external trust chain. |
| Q03-02 | Every official package is pinned by its SHA-256 content hash in the configuration. |
| Q03-03 | The kernel hashes the loaded package's contents and compares the result against the pinned hash. |
| Q03-04 | A match means the package is the one the operator declared. The kernel issues the identity token and binds it to the verified contents. |
| Q03-05 | A mismatch refuses to load. The package is not the one the operator intended. |
| Q03-06 | The pin is per package, per version. A new version of the same package is a new pin. |
| Q03-07 | The pin is operator-editable, protected like the configuration, and checked at boot. |
| Q03-08 | The trust root establishes that the package's contents match the pin. It does not establish who published the package. |
| Q03-09 | Automatic updates are outside this decision. A new version requires a new pin, which requires the operator to update the configuration and rebuild or redeploy. |
| Q03-10 | The operator is responsible for reviewing what they pin. The model does not prevent a malicious build from producing a package the operator later pins. |

## 1. The decision

The trust root for an official package is its content hash. The operator's configuration records a pin for each official package and version. The kernel computes the package's content hash from the contents it loads and compares that hash against the pin.

A match means the loaded contents are the contents the operator declared. The kernel issues the identity token and binds it to those verified contents. A mismatch means the loaded contents are not the contents the operator declared, and the kernel refuses to load the package.

The pin is the whole trust decision. The kernel does not verify a publisher signature, contact a marketplace, follow a certificate chain, or consult an external service. It reads the pin, hashes the contents, compares, and either admits the package or refuses it.

## 2. What it means

**The pin is per package and per version.** It identifies one package version, not a package name in general. A new version of the same package is a new pin. Two versions can carry different pins, and a pin for one version does not authorize the other.

**The pin covers the loaded contents.** The kernel hashes what it actually loads. If any byte differs from the contents the operator pinned, the comparison fails. A changed file, an inserted file, a removed file, or a replaced dependency changes the contents and therefore the hash.

**The pin is operator-controlled.** The operator adds, replaces, and removes pins. The pin is protected like the configuration, and the check runs at boot. No participant and no client edits the pin while the kernel runs.

**The operator's act of pinning is the trust decision.** The kernel's act of comparing is the enforcement. The kernel does not re-evaluate whether the operator should have trusted the package. It verifies that the loaded contents are the contents the operator declared.

**On a match, the identity token binds to the verified contents.** The token does not bind to a name, a version string, a manifest declaration, an install path, or a display label. It binds to the contents the kernel hashed and matched. On a mismatch, the kernel does not issue a token for contents it did not verify.

## 3. What it does not do

**It does not establish who published the package.** It establishes that the package's contents match the pin. Publisher identity, in the sense of who signed a release, is outside this decision. The operator trusts the contents, not a publisher identity. Where the identity records carry a publisher association, that association is the operator's declaration or package metadata; it is not a signature-verified release identity under this trust root.

**It does not support automatic updates.** A new version requires a new pin, which requires the operator to update the configuration and rebuild or redeploy. The kernel does not fetch a new version, compare it to a registry, or decide that an update is safe.

**It does not prevent a malicious build from being pinned.** The model verifies that the contents match the pin. It does not judge the contents. If a malicious build produces a package and the operator pins it, the kernel will admit it. The operator is responsible for reviewing what they pin.

**It does not provide revocation, freshness, or a transparency log.** Once a pin is set, the kernel verifies that exact content. It does not tell the operator that a newer or safer version exists, that a pin has been withdrawn, or that another operator has pinned something different.

**It does not decide the admission policy for unofficial packages.** This decision governs the official-flag trust root. The cage contract governs the admission of unofficial packages.

**It does not remove the accepted same-user risk.** A process with the user's full authority can alter the configuration and the pin. The security architecture accepts that risk, and this trust root inherits it.

## 4. Why the content hash

**It works without infrastructure.** There is no marketplace to operate, no signing key to distribute, no certificate chain to maintain, and no network dependency. The operator's configuration is the entire root.

**It is simple.** A hash, a comparison, and a refusal. The kernel has one rule to implement and one failure to report. The operator has one field to set per package and version.

**It is sufficient for the threat.** The threat is a package substituted after the operator has declared it. The pin closes that threat: a substituted package does not match the pinned contents and does not load. A package substituted before the operator pins it is not a failure of this mechanism; it is a review failure by the operator, and the operator is the party responsible for the review.

**It does not overclaim.** The decision is a content-integrity root, not a publisher-authenticity root. The narrow claim is the honest one: the contents are the contents the operator pinned. The decision does not pretend to establish a release-signing identity it does not verify.

## 5. Relationship to the companion records

**Security architecture.** The security architecture defends the daemon's client boundary, authenticates callers, and fixes the principal. It does not choose the trust root for package contents. This decision is inside the kernel and does not restate or weaken the daemon boundary. The accepted same-user risk applies to the configuration and the pin.

**Kernel identity.** The kernel identity record binds the identity token to publisher and contents and defers the trust root to Q-03. This document answers the content-binding portion: the kernel hashes the contents and compares them to the pin. The publisher association is not a signature-verified release identity under this root; it is the operator's declaration or package metadata. The identity record's wording must be read with that distinction.

**Plugin identity.** The plugin identity record binds a plugin's token to the package's verified contents and defers the trust root to Q-03. This document supplies the verification for official packages: the content hash and the pin. The plugin's identity is bound to the verified contents, not to its name or its manifest.

**Universal exposed API model.** The universal model makes an API's identity the pair of its name and version, and the scope record keys on that identity. The Q-03 pin is a different axis: it is per package and per package version, and it verifies the package's contents before the package can register any API. A package version pin is not an API version. An API version bump does not change the package pin by itself, and a package version change requires a new pin.

**WASM host interface.** The WASM host interface records Q-03 as the official-flag trust root question. This document answers it: the loader's integrity pin is the SHA-256 content hash in the operator's configuration. The trust-tier decision is separate; this root verifies the contents of the packages the operator declares official, and it does not decide the tier. The earlier question also left publisher signatures and update approval open; this decision records that there is no publisher signature and no automatic update flow, so those parts are outside the trust root rather than undecided.

## 6. Open dependencies

The trust root is decided. The following are implementation tasks, not open questions.

- **The pinning mechanism.** How the kernel reads the pin, how it enumerates and canonicalizes the package's contents, when it computes the hash, and how it reports a mismatch are implementation tasks.
- **The configuration schema's pin field.** The field's shape, whether it sits on each package entry or in a separate map, and how it is validated are implementation tasks.
- **The boot-time check and refusal path.** The ordering of the hash check relative to loading, the error the operator receives on a mismatch, and the rollback of any partial load are part of the pinning mechanism.
- **The publisher-association wording in the identity records.** The identity records describe a publisher binding; this decision establishes a content binding and treats the publisher association as operator-declared metadata. The implementation and documentation that adopt both must reflect that distinction.

## 7. The rule

The pin is the trust root. The contents match the pin or the package does not load. The kernel verifies the contents; the operator makes the trust decision. The identity token binds to what was verified. There is no publisher signature, no marketplace, and no external trust chain.