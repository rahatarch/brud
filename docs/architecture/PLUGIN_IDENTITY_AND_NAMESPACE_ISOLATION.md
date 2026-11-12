# Brud OS Plugin Identity and Namespace Isolation

Nov 12, 2026 · @Rahat Hasan

**Status.** Decided. This document is the architecture decision record for plugin identity. It states the threat, the decision, and the contract that must hold. It is not an implementation guide, not a design with open questions, and not a proposal. It records what must be true. It is the companion to the security architecture document and the WASM host interface document: the security architecture decides the daemon's client boundary, the host interface decides the cage's contract, and this document decides who a plugin is and what data it owns. Decided 2026-11-12.

## Purpose and scope

A plugin declares an identifier in its manifest. The kernel validates the identifier's shape and uses it as the plugin's identity. The identifier is not bound to the plugin's code, its publisher, or its package contents. Any package can declare any shape-valid identifier, including one another plugin already uses.

This document decides that the kernel issues a per-plugin token bound to the plugin's verified package contents, that the token is the plugin's identity in every subsystem, and that the manifest identifier becomes non-authoritative metadata. It records the properties the token must have, the subsystems that must key by it, the migration and revocation behavior, and the tests that must prove the property with real packages. It is deliberately short, so that the threat cannot be forgotten and the decision cannot be ignored.

## Decision register

| ID | Decision |
|---|---|
| P-01 | The kernel issues a per-plugin token. A plugin cannot choose, copy, or claim another plugin's token. |
| P-02 | The token is bound to the plugin's verified package contents. |
| P-03 | The token is the plugin's identity in every subsystem. The manifest identifier is metadata. |
| P-04 | The token is stable for the plugin's lifetime and across reinstalls of the same package. |
| P-05 | Different packages receive different tokens, even when they declare the same manifest identifier. |
| P-06 | The token is unforgeable: no plugin can obtain another package's token for its own contents. |
| P-07 | The token registry is kernel-owned and persisted in operator-controlled storage, not plugin-writable storage. |
| P-08 | No subsystem may use the manifest identifier as a data key, an ownership key, or an access-decision input. |
| P-09 | Reinstalling preserves the token and data; removal retires but preserves; a different package gets a new token; a retired token's data stays isolated. |
| P-10 | The operator can revoke a token and the data keyed to it, with a stated consequence. |
| P-11 | Every manifest-identifier-keyed subsystem migrates to the token. No dual-key window remains. |
| P-12 | Every implementation task derived from this decision produces production-mirror tests with real packages, the real kernel, real configuration, and real storage. |

## 1. The threat

### T-P1 — Manifest identity substitution

A plugin declares a manifest identifier. The identifier is self-declared and shape-validated only. It is not derived from the plugin's code, its publisher, or its package contents. It is not signed. It is not bound to anything the kernel can verify. The kernel treats the declared string as the plugin's identity.

Any plugin that declares the same identifier inherits everything keyed by it: the universal history namespace, the settings scope, plugin-scoped file paths, the personal prompt vault, tool and action ownership, brand and namespace decisions, event and lifecycle subscriptions, access decisions, quotas, and every diagnostic that reports an owner. With the identifier, the claimant can read, alter, delete, or replace the victim's history, settings, files, and prompts, and can register tools and actions under the victim's ownership. The user sees the victim's name.

The attack does not require a kernel exploit, a memory corruption, a stolen secret, or a privileged account. It requires installing a plugin whose manifest declares the victim's identifier. Shape validation rejects malformed strings; it does not reject a well-formed string that belongs to another plugin. Duplicate detection refuses two plugins with the same identifier within one boot; it does not bind the identifier to contents across installs, and it does nothing for a claimant installed after the victim is removed. The reserved first-party prefix protects only identifiers that begin with that prefix, and it protects them by rejecting the string, not by proving the package. Every other identifier is available to any package that declares it.

This threat is not hypothetical. It follows directly from the current model, in which the manifest identifier is the only identity and the identifier is forgeable. The data outlives the plugin: a removed plugin leaves its history, settings, files, and prompt vault behind. A claimant installed later declares the same identifier and is treated as the same plugin. Persistence turns a temporary install into a durable identity takeover. Because the identifier is the join key across the kernel, fixing one subsystem while another still accepts it leaves the takeover path open.

## 2. What the manifest identifier keys today

| Subsystem | What the identifier keys | Consequence of substitution |
|---|---|---|
| Universal history namespace | The namespace of a plugin's history handle, and every persisted session, entry, entry type, reversal handler, and undo cursor under it. | The claimant reads, writes, reverts, and deletes the victim's history; sessions and attribution appear as the victim's. |
| Settings scope | The plugin's rollout mode and any plugin-scoped setting recorded under its identifier. | The claimant inherits the victim's rollout posture and configured behavior. |
| Plugin-scoped file storage | Workspace files and records the kernel attributes to the plugin by identifier, including transport endpoint records. | The claimant reads, replaces, or deletes the victim's files; persisted ownership is misattributed. |
| Prompt vault | The personal prompt vault as plugin-owned data, whose ownership is attributed to the plugin by identifier. | The claimant is treated as the plugin that owns the vault and can present itself as the vault's plugin, exposing or replacing the user's prompts. |
| Tool registry ownership | The owner recorded on every tool, the owner used for removal, and the owner used for the registration quota. | The claimant's tools carry the victim's owner key. Duplicate detection blocks a concurrent second instance, but dispatch, removal, quota, and diagnostics attribute the claimant's entries to the victim. |
| Action registry ownership | The owner recorded on every action, removal, and quota. | The claimant's actions carry the victim's owner key. Duplicate detection blocks a concurrent second instance, but registration, removal, quota, and the user interface attribute the claimant's entries to the victim. |
| Brand scope and namespace authority | Reserved first-party prefix decisions, the official certification recorded for the plugin, and any scope named after the identifier. | A claimant of a non-reserved identifier inherits the derived authority; a claimant of a reserved identifier is refused only because the string is reserved, not because the package is proven. |
| Event and lifecycle subscriptions | The active context, its disposable subscriptions, terminal session attribution, and any future event subscription. | The claimant is handed the victim's context entry, can dispose or replace the victim's subscriptions, and is attributed the victim's sessions. |
| Access decisions | The subject identity used by projections, capability resolution, broker requests, and namespace scope. | The claimant receives the victim's projections and access decisions; a denial or an allowance is made for the wrong plugin. |
| Plugin manager registry and lifecycle | Registration, duplicate detection, the dependency graph, activation order, logging tags, and the active context map. | Within one boot the duplicate is refused; across installs the manager holds no binding between the identifier and a package, so the identity behind every lifecycle decision is the claimant's. |
| Transport and daemon attribution | Transport endpoint records, dispatch results, owner fields shown to the user, and diagnostics. | The claimant's transport is recorded as the victim's, and activity is attributed to the victim. |
| Quotas | Per-plugin registration quotas keyed by owner. | The claimant consumes the victim's quota or escapes its own; the victim's quota is exhausted by the claimant's registrations. |

The list is long because the identifier is the only identity the kernel has. It is also incomplete by design: any subsystem that keys data, behavior, ownership, or an access decision by plugin identity is in scope, whether or not it is named here. A subsystem that appears after this document is bound by the same rule. Duplicate detection within one boot is not a defense: it does not bind the identifier to contents, it does not survive a reinstall, and it does not touch data that outlives the plugin.

## 3. The decision

The kernel issues a per-plugin token. The token is bound to the plugin's verified package contents. The token is the plugin's identity everywhere: in history, settings, files, the prompt vault, tool and action ownership, brand and namespace decisions, event and lifecycle subscriptions, access decisions, quotas, and every future subsystem. The manifest identifier becomes metadata: recognizable to users, useful in diagnostics and display, not authoritative to the kernel.

The decision changes the question the kernel asks. Today it asks what identifier the plugin declared. After the decision it asks what package this is and what token the kernel issued for it. A plugin cannot answer that question on another package's behalf. It can present its own contents; the kernel binds the token to those contents. If the contents differ, the token differs. If the contents are the same, the package is the same package, and sharing the identity is correct.

The manifest identifier may still be displayed, logged, searched, and shown to users. It must not decide what data a plugin can reach, what it owns, who it is, or what it is allowed to do. The moment the identifier is accepted as an authority, the threat returns. Identity substitution becomes a failure rather than a takeover: a malicious package that declares the victim's identifier receives a different token, every namespace derived from it is different, and it reaches none of the victim's data or registrations. It is a different plugin that happens to display the same name.

## 4. The token model

The following properties are the contract. They do not prescribe a token format, a hashing algorithm, a signature scheme, a registry layout, or a storage location.

**Issued by the kernel, not the plugin.** The kernel creates the token for the package it loaded. The plugin cannot choose it, propose it, copy it into its manifest, or claim another package's token. Possession of a token value confers no authority, because the kernel does not accept a token as a credential; it looks up or derives the token for the package it loaded.

**Bound to the package.** The binding is through the package's verified contents: a content hash, a publisher signature, or both. A token is not bound to a name, a version string, a manifest declaration, an install path, or a display label, because each of those can be copied or rewritten without changing the package's code. The exact trust root for the verification is a dependency on Q-03, the official-flag trust root decision recorded by the WASM host interface document. It is not decided here.

**Stable for the plugin's lifetime and across reinstalls.** The same package receives the same token on every install. Reinstalling the same contents does not create a new identity or orphan the data. A token that changed on every install would turn every update into a data loss and make the migration model unusable.

**Different for different packages.** Two packages with the same manifest identifier but different contents receive different tokens. This is the property that defeats substitution. It holds even when the identifiers, versions, names, descriptions, and declared permissions are identical, because the contents differ.

**Unforgeable.** No plugin can obtain another package's token for its own contents, through any mechanism. It cannot declare it, copy it, derive it from the victim's public metadata, replay it, or ask the kernel to issue it. The property is not that the token value is secret. It is that the token is not a claim the plugin can make: a plugin that learns the victim's token value still cannot cause the kernel to bind that token to its own package.

**Persisted in operator-controlled storage.** The token registry is kernel-owned. It lives in storage the plugin cannot write, and the binding between a token and a package's verified contents is not editable by any plugin. A plugin cannot create, alter, or delete a record, or cause the kernel to reuse a retired record.

## 5. The namespace derivation

**Rule.** Every datum, record, registration, subscription, quota, path, scope, and access decision that is keyed by plugin identity is keyed by the token. The manifest identifier is never a data key, an ownership key, a lookup key that grants access, or an input to an access decision.

The rule applies to every subsystem in scope:

- **Universal history.** The namespace bound to a plugin's history handle is derived from the token. Every session, entry, entry type, reversal handler, and cursor belongs to it. No history record is addressable by the manifest identifier.
- **Settings.** Plugin-scoped settings and rollout modes are keyed by the token. The identifier may be stored beside a setting for display; it may not select, join, or authorize it.
- **Plugin-scoped files.** Every path, ownership record, and endpoint record attributed to a plugin is derived from or keyed by the token. A path that embeds the identifier is a path another package can claim.
- **Prompt vault.** The personal prompt vault is keyed by the token. Ownership and access are decided against the token, not the name the plugin displays.
- **Tool and action ownership.** The owner recorded on every tool and action is the token. Removal, dispatch attribution, and quotas operate on the token. No registry accepts the identifier as an owner.
- **Brand and namespace scope.** Any scope, reserved-prefix decision, or certification derived from plugin identity is derived from the token or the verified package, not the identifier string. An authority that still reads the string is still forgeable.
- **Event and lifecycle subscriptions.** The active context, subscriptions, and terminal session attribution are keyed by the token. A future event bus and every future subscription mechanism are bound by the same rule.
- **Access decisions.** The subject identity used by projections, capability resolution, broker requests, and scope checks is the token. No access decision accepts the identifier as the subject.
- **Quotas, diagnostics, and attribution.** Per-plugin quotas are keyed by the token, and the owner reported to the user interface, the daemon, and the logs is the token's plugin. The identifier may appear as a label beside it.
- **Every future subsystem.** A subsystem that appears after this document and keys by plugin identity is in scope without a further decision.

Derived identifiers follow the same rule. If a subsystem needs a stable name for a plugin's area, it derives that name from the token. It may store the manifest identifier beside the data for display, but the identifier is not a key and cannot be used to find, join, authorize, or adopt the data.

The manifest identifier may not remain as an alternate key. A compatibility path that accepts the identifier and resolves to the token's data recreates the threat, because the claimant can supply the identifier. Migration is complete only when no such path exists.

## 6. Migration and revocation model

**Reinstalling the same package preserves the token and the data.** The kernel recognizes the same verified package and reuses the token. The plugin's history, settings, files, prompt vault, and ownership records remain its own. An update that changes the package's contents is a different package and follows the different-package rule, unless the trust root decided by Q-03 verifies it as the same package.

**Removing the plugin retires the token but does not delete the data immediately.** Retirement means the token is no longer active for a loaded package. The data is preserved under the retired token. Removal is a lifecycle event, not a deletion event.

**Installing a different package under the same manifest identifier gets a new token.** The previous token's data remains isolated under the previous token. The new package cannot read, write, adopt, or overwrite it, even though the two packages display the same identifier.

**Uninstalling and reinstalling under a different package does not grant access to the previous token's data.** The new package's token is different, and every namespace derived from it is different. A prior uninstall does not reset the identity or open the data.

**The operator can revoke a token and the data keyed to it.** Revocation states its consequence before it happens: the token is retired permanently, the data becomes inaccessible to every plugin, and the data is destroyed or marked for destruction according to the operator's choice. A revoked token is never reissued. Revocation is the only operation that ends the isolation guarantee, and it ends it by destroying the data, not by transferring it.

**No adoption path exists.** Data under a retired or revoked token is never adopted by a new token because a manifest identifier matches. Only an explicit operator action can move or destroy it. The token's lifetime is separate from the package's lifetime: a plugin may be removed while its token and data are retained, and a token may be retired while its data is preserved.

## 7. Consequences for the codebase

Every place where the manifest identifier currently serves as an identifier must migrate to the token. The migration is not optional for any subsystem, and a partial migration is a bypass. A subsystem left on the identifier remains a place where a claimant can inherit identity, even if every other subsystem is correct.

The scope includes, at minimum: the plugin manager's registration, duplicate detection, dependency graph, activation order, logging, and active-context keying; history namespace derivation and every persisted history record, entry type, reversal handler, session, and cursor; settings keys and rollout modes; plugin-scoped file records and paths, the prompt vault, and transport endpoint records; tool and action ownership, removal, dispatch attribution, and quotas; brand and namespace derivation, including the reserved first-party prefix check and official certification; event and lifecycle subscriptions, terminal session attribution, and every future subscription; access decisions, projections, capability resolution, broker requests, and subject identity; daemon dispatch, diagnostics, and user-interface attribution; and quotas and rate limits keyed by owner.

Any authority currently derived from the identifier string must be re-expressed against the token or the verified package, or it remains forgeable. This includes the reserved-prefix and official-claim checks. A check that reads the string protects the string, not the identity.

The implementation task that follows this decision record owns the migration. This section exists so no subsystem is forgotten. The task must inventory every identifier use, not only the ones listed here, and must record the inventory in the ledger. It must remove the manifest identifier as an authority rather than run both keys in parallel. A dual-key period is a period in which the threat is still live.

Existing data must be re-keyed, quarantined, or explicitly retired. A migration that starts fresh namespaces and leaves old data under the identifier leaves that data reachable to a claimant. The migration cannot silently assign an identifier-keyed record to a new token, because the token is bound to contents and the identifier does not prove them. Where the original package is available, the record can be re-keyed after verification. Where it is not, the operator decides whether the data is retained in a quarantined, non-plugin-reachable state or destroyed, and the decision and its consequence are recorded.

## 8. What this does not solve

| Matter | Status | Why this document does not decide it |
|---|---|---|
| The trust root for the package's verified contents | Dependency on Q-03, the official-flag trust root decision | The token can be bound to contents, but the strength of that binding, and whether it establishes a publisher, depends on a trust root this document does not choose. |
| The capability grant model | Dependency on Q-02, the trusted grant source decision | The token says who a plugin is. It does not say what the plugin may do. A valid token with an over-broad grant is still over-privileged. |
| The cage's enforcement of grants | Covered by the WASM host interface once tokens exist | The cage decides what a confined entry may reach. This document supplies the identity the cage attributes the reach to; it does not decide the enforcement. |
| The terminal service's isolation | A separate concern | Terminal execution can leave the workspace regardless of which plugin holds the token. The token separates owners; it does not sandbox a child process. |
| The same-user attacker | Accepted risk, inherited from the security architecture document | A process with the user's full authority can read or alter the kernel-owned registry and the storage. No plugin identity model can deny authority the attacker already holds. |
| Confidentiality of data at rest | Not provided | The token is an identifier, not an encryption key. A principal that can read the storage can read the data regardless of which token keys it. |
| Display-identity confusion | An interface obligation | Two packages may display the same manifest identifier. The kernel will not confuse them; a user can. The interface must make the distinction visible. |
| A plugin's own resource consumption | Not bounded by identity | The token isolates a plugin from another plugin's data and quota. It does not cap what a plugin does with its own allowance. |

These are dependencies and limits, not decided properties. The identity decision stands on its own: the kernel can stop treating the manifest identifier as identity before Q-03 and Q-02 are decided. But the binding is only as strong as the verification it uses, and the authority attached to the identity is only as narrow as the grant model allows.

## 9. Relationship to the other architecture records

The three records defend three different boundaries.

The security architecture document defends the daemon's client boundary. It decides who is allowed to talk to the daemon and what they may do. It authenticates the host process, fixes the caller principal, and bounds the caller's capabilities and scope. It does not decide which plugin a loaded package is.

The WASM host interface document defends the in-process confinement boundary. It decides what a caged entry may reach, how its imports and exports are inspected, and how its calls are routed. It consumes an entry identity. It does not decide how that identity is bound to package contents; it assumes the loader supplies a stable identity.

This document defends the plugin boundary. It decides who a plugin is and what data it owns.

These are separate threats and separate defenses, and they are not redundant. A caller can be correctly authenticated to the daemon and still be a substituted plugin. A plugin can hold a valid token and still be over-granted. A cage can enforce a grant correctly for the wrong identity if the identity is forgeable. The records compose: the channel authenticates the caller, the token identifies the plugin, and the cage confines what the identified plugin may reach.

The security architecture document's accepted same-user risk applies here. An attacker with the user's full authority can read or alter the kernel-owned registry and the storage. This model does not defend against that attacker. It defends against a plugin installed through the normal path that declares another plugin's identifier.

## 10. Production-mirror obligation

Every implementation task derived from this decision must produce production-mirror tests. A production-mirror test uses real packages installed on disk, the real kernel, real configuration, and real storage. It does not mock the kernel, the loader, the token registry, the storage, or the package source. A test that replaces any of those with a fake does not satisfy this obligation, even if it is a useful unit test elsewhere.

The tests must prove at least the following, with a real second package on disk that carries the legitimate package's manifest identifier and different contents:

1. A legitimate plugin's data is keyed by its token.
2. A malicious plugin with the same manifest identifier and different contents receives a different token.
3. The malicious plugin cannot read or write the legitimate plugin's data.
4. The malicious plugin cannot access the legitimate plugin's namespaces in any subsystem: history, settings, files, prompt vault, tools, actions, brand scope, event subscriptions, access decisions, quotas, and transport records.
5. Reinstalling the legitimate package preserves the token and the data.
6. A retired token's data remains inaccessible to a new token under the same manifest identifier.

The suite must also prove the operator revocation consequence and the no-adoption rule, because those are properties of the same model. The malicious package must be installed through the real installation path. The test must not simulate it by editing the legitimate package's manifest or by injecting a manifest into the kernel. Evidence must be recorded in the ledger; a claim that the property holds without a production-mirror run is not evidence.

## 11. The rule

A manifest identifier is not identity. A token is identity. Every subsystem keyed by the manifest identifier must change. The kernel issues the token, binds it to the verified package, and uses it everywhere. The manifest identifier remains a name that users and operators can read. It is never the authority.