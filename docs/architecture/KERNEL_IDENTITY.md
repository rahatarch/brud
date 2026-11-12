# Brud Kernel Identity: The Identity Token and the Mechanism–Policy Boundary

Nov 12, 2026 · @Rahat Hasan

**Status.** Decided. This document is the architecture decision record for participant identity in the kernel. It records the identity concept, the primitives the kernel provides, and the boundary between the kernel's mechanism and the platform's policy. It is the general case. The plugin identity document is a specific application of it. This document does not decide platform policy and does not prescribe implementation. Decided 2026-11-12.

## Purpose and scope

The kernel loads participants. A participant is any unit the kernel admits into its runtime: a service, a plugin, an extension, or any future kind of loaded unit. The kernel must be able to answer one question about every participant: is this the same participant that owns this data, holds this registration, and receives this access decision? Today it cannot answer that question in one place. It answers it differently in each subsystem, using a string the participant or the subsystem supplied.

This document decides that the kernel answers the question with one concept, the Identity Token, and that every subsystem uses the same answer. It records what the token is, what properties it must have, what the kernel does with it, and what the kernel deliberately leaves to the platform. It does not decide which participants are admitted, which publishers are trusted, what a participant may do, or what happens to data after a participant is removed. Those are platform policies or separate architecture decisions.

The document is written for future implementation tasks and for contributors who will add participants, subsystems, and services. It is deliberately general. The plugin identity document applies this model to the plugin concept; it is an instance, not a competing model.

## Decision register

| ID | Decision |
|---|---|
| K-01 | Every participant loaded by the kernel receives an Identity Token issued by the kernel. A participant cannot choose, present, copy, or claim a token. |
| K-02 | The token is bound to the participant's verified publisher and current contents. The publisher association is durable across versions; the content binding is a version check. |
| K-03 | The token is attached to the participant's execution context. It is not a value the participant holds, presents, or can leak. |
| K-04 | The token is stable across reinstalls of the same publisher and the same contents. |
| K-05 | Different publishers, different contents, or different packages that declare the same identifier receive different tokens. |
| K-06 | The token is unforgeable by any participant. |
| K-07 | Every kernel subsystem keys data, ownership, access decisions, and namespaces by the token. A participant-declared string is never a data key, ownership key, or access-decision input. |
| K-08 | Derived identifiers derive from the token. No alternate key or compatibility path accepts a participant-declared string. |
| K-09 | The identity registry is kernel-owned, protected, write-protected at runtime, integrity-checked at boot, and operator-editable only outside the runtime. |
| K-10 | The kernel provides mechanisms, not policies. Key rotation, ownership transfer, retention, reinstall, and revocation consequences are platform decisions. |
| K-11 | Services interpret the token for their own concepts. The kernel defines identity; services define concepts. |
| K-12 | Every implementation task derived from this decision produces production-mirror tests with real participants, the real kernel, real configuration, and real storage. |

## 1. The problem: scattered identity

### T-K1 — Scattered identity substitution

The kernel has no single concept of who a participant is. Each subsystem carries its own. The access broker accepts caller identifier strings. The plugin manager accepts manifest identifiers. The brand registry accepts scope names. The exposed API registry accepts service registration tokens and caller identifiers. The tool and action registries accept owner identifiers. History, settings, file storage, quotas, event subscriptions, and diagnostics each record a participant by a string supplied through one of those paths.

Each mechanism is forgeable in its own way. A caller identifier is a claim in a request. A manifest identifier is self-declared and shape-validated only. A brand scope name is a string chosen at registration. A service registration token identifies an API registration, not a participant. None of these is bound to the participant's publisher or contents. None is issued by the kernel as an answer to who this is. They are names, and names can be declared by anyone.

The consequence is substitution. A participant that declares another participant's string in any subsystem is treated as that participant by that subsystem. It inherits the data, ownership, registrations, quotas, namespaces, and access decisions keyed by the string. The attack requires no exploit, no memory corruption, no stolen secret, and no privileged account. It requires only the normal load path and a string that another participant already uses or once used. Because data outlives the participant, a later participant can inherit a departed participant's identity. Because each subsystem carries its own string, fixing one subsystem leaves the others open.

The plugin identity document describes one instance of this threat: a plugin declares another plugin's manifest identifier and inherits the other plugin's history, settings, files, prompt vault, tools, actions, brand scope, subscriptions, access decisions, and quotas. That instance is real, but it is not the general case. The same structure appears wherever a subsystem treats a participant-declared string as identity. This document addresses the general case.

The general defense must satisfy three conditions at once. The identity must be issued by an authority the participant cannot impersonate. The identity must be bound to something the participant cannot rewrite. The identity must reach every subsystem through a path the participant cannot supply. A defense that satisfies fewer than three conditions leaves a substitution path open.

## 2. The decision

The kernel introduces one concept: the Identity Token. Every participant loaded by the kernel receives one. The kernel issues it, binds it to the participant's verified publisher and current contents, and attaches it to the participant's execution context. Every kernel subsystem keys by the token. Services interpret the token for their own concepts. The manifest identifier, the service name, the brand scope name, and every other participant-declared string become metadata.

The decision changes the question the kernel asks. Before the decision, a subsystem asks what string the participant declared, or what string the caller supplied. After the decision, the subsystem asks what token the kernel issued for the participant that is executing. The participant does not answer that question. The kernel answers it, and the subsystem receives the answer from the execution context rather than from a request, a manifest, or a registration argument.

The token is not a credential. The kernel does not accept a token value as proof of identity. Possession of another participant's token value confers no authority, because no subsystem accepts a token from a participant. The subsystem asks the kernel to resolve the identity of the execution context it is serving. If a participant learns another token, it still cannot cause the kernel to attach that token to its own execution.

The decision has consequences. Every subsystem that currently keys by a participant-declared string must migrate to the token. Every service that currently interprets a manifest identifier or a service name as identity must instead interpret the token the kernel supplies. Every participant-declared string loses authority and keeps only descriptive value. The identity registry becomes a protected resource of the same class as the configuration. A partial migration is not a partial improvement; it is a remaining substitution path.

## 3. The token's properties

The following properties are requirements. They do not prescribe a token format, a derivation, a registry layout, or a storage mechanism.

**Issued by the kernel, not by the participant.** The kernel creates the token when it admits a participant. The participant cannot propose it, choose it, copy it into a manifest, or claim another participant's token. The issuer is the kernel, and the act of issuance is an admission decision, not a participant declaration.

**Bound to the publisher and to the current contents.** The token records two bindings. The publisher binding identifies the verified publisher. It is durable across versions: a later version from the same publisher retains the same publisher association, even when the content binding differs. The content binding identifies the verified contents of the version that was loaded; it is a version check, and the kernel refuses contents that do not match the binding for that token. A token without a publisher binding identifies a package but not an accountable publisher. A token without a content binding identifies a name but not the code that is running. Both are required.

**Attached to the execution context, not to a value the participant holds.** The token is part of the context in which the participant executes. The participant cannot present it, read it, copy it, leak it, or steal it, because it is not placed in the participant's hands. A subsystem receives the token from the execution context, not from a request field, a manifest field, a registration argument, or a caller-supplied header. This property is what separates identity from a credential.

**Stable across reinstalls of the same publisher and the same contents.** The same publisher and the same verified contents receive the same token on every install. A reinstall does not create a new identity and does not orphan the participant's data. Stability is required for ownership to survive the normal lifecycle of install, remove, and reinstall. It is not a promise that every version keeps the same token; a different version has different contents and receives a token with a different content binding.

**Different for different publishers, different contents, or different packages that declare the same identifier.** Two packages that declare the same identifier but have different publishers receive different tokens. Two packages from the same publisher with different contents receive different tokens. A package that declares another package's identifier receives its own token, not the other package's. This property defeats substitution: the claimant's token is different, every namespace derived from it is different, and the claimant reaches none of the victim's data.

**Unforgeable by any participant.** No participant can obtain another participant's token for its own contents, through any mechanism. It cannot declare the token, derive it from public metadata, replay it, ask the kernel to issue it for the wrong contents, or cause the kernel to attach it to the wrong execution context. The requirement is not that the token value is secret. The requirement is that the token is not a claim a participant can make. A participant that learns the victim's token value still cannot cause the kernel to bind that token to the participant's own publisher and contents.

**Persisted in a protected, integrity-checked registry that the kernel owns.** The token is recorded in a registry the kernel owns and participants cannot write. The registry records the binding from token to verified publisher and current contents. It lives outside participant-writable storage, and its integrity is checked at boot. A token that is not in the registry is not an identity. A registry record that fails its integrity check is not trusted. The registry is a security-critical resource, not a cache.

## 4. The identity registry

The registry is a protected resource. It records the mapping from each token to the verified publisher and the current contents that the token was issued for. It is the authority for the claim that a token belongs to a publisher and a version. Without it, a token is an opaque value with no accountable origin.

The registry is write-protected at runtime. No service, plugin, extension, or other participant may create, alter, or delete a record. The kernel writes at issuance, and only the kernel writes while the runtime is alive. A participant that could write the registry could reassign an existing token to itself, attach its own contents to a victim's token, or create a record for a publisher it does not control. That is identity capture, and it defeats every downstream protection. The registry is therefore protected by the same class of mechanisms that protect the configuration: it is not participant-writable, it is checked for integrity at boot, and mutation is refused while the kernel is running.

The registry is integrity-checked at boot. A boot that finds a modified, missing, or inconsistent record does not silently regenerate identities. A silent reset would turn an integrity failure into an identity reset, which is a substitution primitive. The kernel treats a failed registry check as a failure to establish trustworthy identity, and the platform's boot policy decides whether the kernel refuses to start, starts in a restricted mode, or requires operator repair. That consequence is a platform decision; the requirement that the check happens and that its failure is not ignored is a kernel guarantee.

The registry is operator-editable only outside the runtime. An operator may inspect, repair, or migrate the registry while the kernel is stopped, under the platform's operational policy. No participant receives an editing path while the kernel is running. The operator's authority is outside the runtime, not a privilege inside it.

## 5. The subsystem rule

**Rule.** Every kernel subsystem that keys data, ownership, access decisions, or namespaces by participant identity keys by the Identity Token. No subsystem may use a participant-declared string as a data key, an ownership key, or an access-decision input. A declared string may be stored, displayed, logged, and searched as metadata; it may not select, join, authorize, or adopt a record.

The rule applies to every subsystem in scope, including every subsystem that appears after this document.

| Subsystem | What the token keys |
|---|---|
| Exposed API registry | The participant's registration and the identity used to resolve a projected capability. A service registration token identifies an API registration; it is not participant identity. |
| Access broker | The subject of an access decision and the owner of any access record. The broker receives the token from the execution context, not from the request. |
| Brand registry | The owner of a brand scope and the authority behind any certification or reserved-name decision. A scope name is a label, not an authority. |
| Tool registry | The owner of every tool, the owner used for removal, and the owner used for registration quotas and duplicate detection. |
| Action registry | The owner of every action, removal, and quota. |
| Universal history | The namespace of a participant's history and every session, entry, entry type, reversal handler, and undo cursor under it. |
| Settings service | The participant's settings scope and rollout mode. The declared name may be stored beside a setting, but it may not select or authorize it. |
| File storage | Every path, ownership record, and stored endpoint attributed to a participant. A path that embeds a declared name is a path another participant can claim. |
| Quotas | Every per-participant registration, rate, and resource allowance. |
| Event subscriptions | The subscription owner, the active context, terminal session attribution, and every future event subscription. |
| Diagnostics | The owner reported in a diagnostic, log, or operator view. The declared name may appear beside the token as a label. |
| Every future subsystem | Any subsystem that keys data, ownership, behavior, or an access decision by participant identity, without a further decision. |

Derived identifiers follow the same rule. If a subsystem needs a stable name for a participant's area, it derives that name from the token. It may store the declared identifier beside the data for display, but the identifier is not a key and cannot be used to find, join, authorize, or adopt the data.

The declared string may not remain as an alternate key. A compatibility path that accepts the declared string and resolves it to the token's data recreates the threat, because a claimant can supply the string. A dual-key period is a period in which the threat is still live. Migration is complete only when no subsystem accepts the declared string as an identity, a key, or an access-decision input.

## 6. The service interpretation

The kernel defines identity. Services define concepts. This division is the pattern every service must follow.

The kernel knows participants and identities. It does not know what a plugin is, what an extension is, or what concept a future service will introduce. It knows that a participant was loaded, that a publisher and contents were verified, that a token was issued, and that the token is attached to the execution context. It does not know which of those participants are plugins, which are extensions, or which belong to a service's domain concept.

A service receives the token and interprets it for its own concept. The plugin manager interprets the token as a plugin's identity: it treats a participant whose concept is a plugin as a plugin, and it keys its plugin records, lifecycle, dependency graph, and active contexts by the token. A future extension manager would interpret the same kind of token as an extension's identity. A service that introduces another concept would do the same. The token does not change; the concept does.

This pattern has three obligations for a service. First, the service must accept the token from the execution context and resolve it through the kernel, not from a request or a registration argument. Second, the service must key its concept data by the token and must not fall back to a declared string. Third, the service must apply its own policy to its own concept; the kernel does not impose plugin policy on an extension, and it does not impose extension policy on a plugin. The service owns the concept. The kernel owns the identity.

The pattern also has a prohibition. A service may not reinterpret a token as a different participant's identity, and it may not accept a declared string as a substitute for the token. If a service needs to display a name, it displays the declared name as metadata beside the token. If it needs to decide ownership or access, it decides against the token. The moment a service accepts a name as an authority, the general threat returns inside that service.

## 7. The primitives the kernel provides

The kernel provides mechanisms, not policies. The following primitives are the complete set the kernel exposes for identity. Each primitive states what the kernel does. None states when the platform should ask for it.

1. **Issue an identity when a participant is loaded.** The kernel creates a token at admission and attaches it to the participant's execution context. Issuance is not a participant request.
2. **Bind the identity to a verified publisher and contents.** The kernel records the publisher association and the content binding that the token was issued for. The publisher association is durable across versions; the content binding is checked against the loaded version.
3. **Resolve the identity on request from a subsystem.** A subsystem asks the kernel for the identity of the execution context it is serving. The kernel answers from the context and the registry. The subsystem does not accept a token from the participant.
4. **Attach the identity to an execution context.** The kernel places the token in the context in which the participant executes, and every subsystem that serves that participant receives the token from that context.
5. **Rotate the publisher's binding, when the platform approves.** The kernel can replace a publisher association with another verified publisher association. The kernel does not decide when rotation is appropriate, who may request it, or what evidence is required.
6. **Transfer ownership to a new publisher, when the platform approves.** The kernel can move a token's publisher association and the data keyed to it to a different verified publisher. The kernel does not decide when a transfer is legitimate or what happens to the previous publisher's access.
7. **Retire an identity, preserving or destroying its data as the platform directs.** The kernel can mark a token inactive when a participant is removed. The platform decides whether the data is preserved, quarantined, or destroyed.
8. **Reclaim a retired identity's data on reinstall, if the platform's policy permits.** The kernel can reconnect a reinstalled participant to data under a retired token when the same publisher and contents are recognized and the platform's reinstall policy allows it. The kernel does not decide whether reinstall should reclaim.
9. **Revoke an identity permanently, with the platform-defined consequence.** The kernel can retire a token in a way that is never reversed and never reissued. The platform defines what revocation means for the data, the publisher, and any future install.

These primitives are sufficient to build the platform's policies and insufficient to replace them. A primitive without a platform decision has no default behavior. The kernel does not invent an approval criterion, a retention period, a reinstall rule, or a revocation consequence.

## 8. The platform's policy

The kernel decides the mechanism. The platform decides the policy. The boundary is explicit so that no future contributor mistakes a kernel primitive for a kernel policy.

| Policy decision | Kernel role | Platform role |
|---|---|---|
| Key rotation | Provides the rotation primitive and records the new binding. | Decides when rotation is required, who may approve it, and what evidence is sufficient. |
| Ownership transfer | Provides the transfer primitive and moves the binding. | Decides when a transfer is legitimate and what happens to the previous owner's access. |
| Data retention after uninstall | Provides retirement and preserves or destroys data as directed. | Decides whether data is retained, for how long, and under what conditions. |
| Reinstall policy | Provides reclamation for a recognized publisher and contents. | Decides whether a reinstall reclaims, starts fresh, or is refused. |
| Revocation consequence | Provides permanent revocation. | Decides what revocation does to data, to the publisher, and to future installs. |
| Admission and trust | Verifies the publisher and contents through the trust root. | Decides which publishers and participants are trusted. |

Without a platform, the operator decides these policies. A future marketplace decides for itself. The kernel does not encode any of them. It exposes a primitive, requires an approval that the platform supplies, and records the result. If no platform policy exists, the kernel does not choose one; the operation waits for a decision or is not performed.

This boundary is not a limitation of the kernel. It is the division that keeps the kernel neutral across deployment models. A kernel that decided retention would impose one platform's data policy on every platform. A kernel that decided revocation consequences would encode one marketplace's commercial policy into the mechanism. The kernel's guarantee is that the identity is issued, bound, protected, and usable by subsystems. The platform's guarantee is that the lifecycle around that identity matches its own policy.

## 9. What the token does not solve

The token is an identifier. It is not a trust root, an authority grant, an enforcement mechanism, an operating-system sandbox, or an encryption key. The following matters are outside this decision.

| Matter | Status | Why the token does not solve it |
|---|---|---|
| Trust root for publisher and content verification | Separate decision, Q-03 | The token can be bound to a verified publisher and contents, but the strength of that verification depends on a trust root this document does not choose. |
| Capability grant model | Separate decision, Q-02 | The token says who a participant is. It does not say what the participant may do. A valid token with an over-broad grant is still over-privileged. |
| The cage's enforcement of grants | WASM host interface | The cage decides what a confined participant may reach. It consumes the token for attribution but does not define identity. |
| Terminal isolation | Separate concern | A participant that can run a terminal command can leave the workspace regardless of which token identifies it. The token separates owners; it does not sandbox a child process. |
| The same-user attacker | Accepted risk in the security architecture | A process with the user's full authority can read or alter the registry and the storage. No identity model can deny authority the attacker already holds. |
| Confidentiality of data at rest | Not provided | The token is an identifier, not an encryption key. A principal that can read the storage can read the data regardless of which token keys it. |

These are dependencies and limits, not decided properties. The identity decision stands on its own: the kernel can stop treating declared strings as identity before Q-03 and Q-02 are decided. But the binding is only as strong as the verification it uses, and the authority attached to the identity is only as narrow as the grant model allows. The token does not make an untrusted publisher trustworthy, a grant safe, a cage escape-proof, a terminal isolated, a same-user attacker powerless, or stored data confidential.

## 10. Relationship to the other architecture documents

Three companion architecture records defend three boundaries. This document is the general case of participant identity. The companions consume, apply, or border it.

| Record | Boundary it defends | What it decides | Relationship to this document |
|---|---|---|---|
| Security architecture | The daemon's client boundary | Which local process may talk to the daemon, what principal it is, and what its capabilities allow. | It authenticates callers of the daemon. It does not define identity for participants loaded inside the kernel. The two compose: the channel authenticates the caller, and the kernel identifies the participant. |
| WASM host interface | The cage boundary | What a confined entry may reach, how imports are inspected, and how calls are routed. | It consumes an entry identity and states that the loader supplies a stable identity. This document decides where that identity comes from and what it is bound to. The cage enforces reach; it does not define identity. |
| Plugin identity | The plugin boundary | Which package a loaded plugin is and what data it owns. | It is a specific application of this document to one concept. It is not the general case, and it is not a competing primitive. |
| This document | The kernel's participant boundary | The general concept of identity for every loaded participant and the mechanism-policy boundary. | It is the primitive. The plugin identity document is its application. |

The security architecture document defends the daemon boundary. It authenticates the host process, fixes the caller principal, and bounds the caller's capabilities and scope. It does not decide which participant a loaded package is. A caller can be correctly authenticated to the daemon and still be a substituted participant. The security architecture's accepted same-user risk applies here: an attacker with the user's full authority can read or alter the registry and the storage. This model does not defend against that attacker.

The WASM host interface defends the cage boundary. It decides what a caged entry may reach, how its imports and exports are inspected, and how its calls are routed. It assumes the loader supplies a stable entry identity. This document defines that identity. The host interface's current text states that the loader derives identity from the manifest or the service descriptor; that is the interface's assumption about its input, not a decision that the manifest is authoritative identity. This document changes the source of the answer: the loader receives a kernel-issued token, and the manifest is metadata. The implementation that adopts this decision must reconcile the host interface's assumption; this document records the dependency and does not rewrite that record.

The plugin identity document defends the plugin boundary. It states the plugin-specific threat, the plugin token properties, the plugin namespace rule, and the plugin lifecycle properties. It is the application, not the primitive. Its token is this token interpreted for the plugin concept. Its plugin-specific lifecycle decisions, such as preserving data on removal, are platform policy applied to the plugin concept; they do not change the kernel's mechanism. Where the plugin document is silent on the general publisher binding, this document supplies it. The plugin document remains authoritative for the plugin concept and for the policy it explicitly decides.

The four records compose and none is redundant. A caller can be authenticated to the daemon and still be a substituted participant. A participant can hold a valid token and still be over-granted. A cage can enforce a grant correctly for the wrong identity if the identity is forgeable. The channel authenticates the caller, the kernel identifies the participant, the cage confines what the identified participant may reach, and the plugin document applies the identity to the plugin concept.

## 11. Production-mirror obligation

Every implementation task derived from this decision produces production-mirror tests. A production-mirror test uses real participants loaded through the real path, the real kernel, real configuration, and real storage. It does not mock the kernel, the loader, the identity registry, the storage, or the package source. A test that replaces any of those with a fake does not satisfy this obligation, even if it is a useful unit test elsewhere.

The tests must prove at least the following:

1. **Identity issuance.** A participant loaded through the real path receives a token from the kernel, and the token is not a value the participant declared or supplied.
2. **Publisher binding.** A token is associated with a verified publisher, and a participant from a different publisher receives a different token even when it declares the same identifier.
3. **Content binding.** A token is associated with the verified contents of the loaded version, and a participant whose contents differ from the binding is refused or receives a different token as the model requires. A reinstall of the same publisher and the same contents produces the same token.
4. **Execution-context attachment.** A subsystem serving a participant receives the token from the execution context, not from a request, manifest, registration argument, or caller-supplied field.
5. **Token-keyed isolation across every subsystem.** A second participant with the same declared identifier and different publisher or contents cannot read, write, adopt, or delete the first participant's data in every subsystem in scope: exposed API registry, access broker, brand registry, tool registry, action registry, universal history, settings, file storage, quotas, event subscriptions, and diagnostics.
6. **Registry protection.** A participant cannot create, alter, or delete a registry record at runtime. The registry is write-protected while the kernel runs, and a boot integrity failure is not silently converted into a fresh identity or a reset.
7. **The platform-policy boundary.** The kernel does not decide key rotation, ownership transfer, retention, reinstall, or revocation consequences. A test that exercises a primitive must show that the primitive requires a platform approval or direction and does not invent one.

Where a test would require a platform decision that does not exist, the test is deferred with the reason recorded. A deferred test is not a passed test. A claim that a property holds without a production-mirror run is not evidence. The implementation task must record the evidence in the ledger and must report a real gap rather than substitute a mock that makes the contract appear satisfied.

## 12. Open dependencies

The following dependencies are recorded, not resolved.

- **Q-03, the trust root for publisher verification.** The token's publisher binding is only as strong as the verification that establishes the publisher. The content binding is only as strong as the verification that establishes the contents. This document requires the binding and does not choose the trust root.
- **Q-02, the capability grant source.** The token says who a participant is. It does not say what the participant may do. The grant model and its trusted source are separate decisions.
- **The WASM cage design depends on this concept for identity.** The cage consumes the token to attribute reach to a participant. It does not define, issue, or bind the token. The host interface and this document must be reconciled by the implementation that adopts both.
- **The marketplace does not exist.** There is no platform that decides key rotation, ownership transfer, retention, reinstall, or revocation consequences for a marketplace. Until one exists, the operator decides those policies, and the kernel does not encode a substitute.

These dependencies do not prevent the kernel from adopting the identity concept. They limit what the concept proves and what authority it carries. An implementation task must not assume an answer that is not recorded.

## 13. Load failure semantics

This section records one consequence of the identity decision. It is not a new decision. It states the rule the kernel applies when a component's identity cannot be established: when its binding is missing, when its publisher or content verification fails, or when the token cannot be issued.

**No identity, no running.** A component whose identity cannot be established does not run.

The outcome depends on the component's role and its official status. A service with dependents that fails to load stops the boot, because other services or plugins depend on it and a boot that omits it produces a broken composition; the kernel refuses to boot and reports the failure. A service with no dependents that fails to load is omitted; nothing depends on it, so the kernel boots without it and records the omission in the boot trust report. A plugin that fails to load is omitted; plugins are leaf extensions, so the kernel boots without it and records the omission. An official component that fails to load stops the boot regardless of its role; the operator declared it trusted, a broken trust declaration is not silently accepted, and the kernel refuses to boot and reports the specific trust failure.

| Component kind | Dependencies | Official flag | Outcome |
|---|---|---|---|
| Service | Has dependents | No | Refuse boot |
| Service | Has dependents | Yes | Refuse boot |
| Service | No dependents | No | Boot without it |
| Service | No dependents | Yes | Refuse boot |
| Plugin | Has dependents | No | Boot without it |
| Plugin | Has dependents | Yes | Refuse boot |
| Plugin | No dependents | No | Boot without it |
| Plugin | No dependents | Yes | Refuse boot |

Plugins are leaf extensions, so a plugin with dependents is not an expected composition; the row records the rule if such a dependency is ever declared.

**The boot trust report records every outcome.** It records what was admitted, with the token and the binding that were established; what was refused, with the reason; and whether the boot completed, completed with omissions, or failed. A partial composition is visible, and a failed boot is explained.

This rule follows from the identity decision, the composition model, and the official flag. It is the only behavior consistent with fail-closed identity, dependency-aware composition, and the official tier being the highest trust.

## 14. The rule

Identity is issued, not declared. The token is identity. The declared string is metadata. The kernel provides the mechanism; the platform provides the policy. Every subsystem keys by the token, every service interprets the token for its own concept, and no future contributor treats a primitive as a policy or a name as an authority.