# Brud OS Universal Exposed API Model: Participants, Scopes, and Call-Chain Origin

Nov 12, 2026 · @Rahat Hasan

**Status.** Decided. This document is the architecture decision record for the universal exposed API model and the scope rules that govern reachability in the kernel. It sits alongside the security architecture record, the WASM host interface record, the kernel identity record, and the plugin identity record. It decides what every participant exposes, what every exposed API declares, the versioned identity of an API, the four scopes and their order, the kernel default, per-identity scope persistence, the versioned narrowing rule, version coexistence and retirement, and how the kernel decides which origin may reach an API. It is a decision record, not an implementation guide. Decided 2026-11-12. Revised 2026-11-12 to add the kernel scope and tighten the default. Finalized 2026-11-12 with the scope names kernel, runtime, host, and any, and with the persistent scope record and the narrowing rule. Revised 2026-11-12 to add API versioning: an API's identity is its name and version, the scope record keys on that identity, and narrowing is possible only through a major version bump.

## Purpose and scope

The kernel admits participants. A participant is any unit the kernel loads or hosts: a service, a plugin, an extension, a caged entry, or any concept that appears later. Every participant has capabilities it can offer to callers. The kernel needs one uniform answer to a single question: given a caller, an exposed API identity, and a call chain, may this call proceed?

This document decides that every participant exposes its capabilities through the same mechanism, the exposed API, and that every exposed API declares its identity and the origins that may reach it. It decides the four scopes and their order, the kernel default, the versioned identity of an API, the persistence of each identity's scope across boots, the versioned narrowing rule, version coexistence and retirement, the authorization required to widen a scope, the tracking of a call chain's root origin, the two resolution surfaces, and the rule that ties them together. It does not decide identity, authentication, capability grants, policy content, transport protection, or the cage contract. Those belong to the companion records.

The document is written for contributors who will add participants, register exposed APIs, route calls, or build future concepts. It is deliberately general. A new concept is a new vocabulary over the same mechanism, not a new mechanism.

## Decision register

| ID | Decision |
|---|---|
| U-01 | Every participant exposes its capabilities through the same exposed API mechanism. The concept names service, plugin, and extension are metadata, not the kernel's categorization. |
| U-02 | The Exposed API Registry is universal. Every participant registers there, and no concept receives a parallel registry or a parallel resolution path. |
| U-03 | Every exposed API declaration carries the API name, its version, the capability required to reach it, its scope, and the policy that decides which capable callers are granted. |
| U-04 | An exposed API's scope is exactly one of kernel, runtime, host, or any, in that order from narrowest to widest. |
| U-05 | The default scope is kernel. An API reaches participants or clients only when its registrant explicitly declares runtime, host, or any. |
| U-06 | Registration is immutable after boot. The scope is fixed at registration and is not editable while the kernel runs. |
| U-07 | Within a version, every widening away from kernel, and every step from runtime to host, runtime to any, or host to any, is a security-sensitive change. The registration refuses a widening without explicit authorization, and the ledger records every widening as a decision artifact. Narrowing within the same version is refused under U-17. |
| U-08 | The kernel tracks the root origin of every call chain and checks scope against that origin, not against the immediate caller. |
| U-09 | The any scope is not a bridge. It does not relay a call to an API whose scope refuses the chain's root origin. |
| U-10 | When the host embeds the kernel in-process, the host's calls are client-origin calls. The scope rules apply identically with or without the daemon. |
| U-11 | Resolution checks the root origin against the scope at every surface. Kernel origin reaches kernel, runtime, and any; participant origin reaches runtime and any; client origin reaches host and any. Capability and policy still apply. |
| U-12 | Every implementation task derived from this decision produces production-mirror tests with real participants, real tokens, real exposed API identities, real scopes, real call chains, and the real kernel. |
| U-13 | The identity registry's issue, resolve, retire, and revoke operations are declared kernel. No participant or client can issue a token, resolve another participant's token, retire an identity, or revoke anything. |
| U-14 | Call-chain origins are classified as kernel, participant, or client. The classification is set at the entry point and preserved across nested calls. |
| U-15 | The call-chain origin guard protects all three non-any origin classes. A kernel-origin, participant-origin, or client-origin chain cannot reach a scope that refuses that origin through an any-scope intermediary. |
| U-16 | Scope is persistent across boots. The kernel records the last successful scope for each (name, version) identity in a protected, kernel-owned scope record. |
| U-17 | Within a version, narrowing is refused. A registration of the same (name, version) with a scope equal to or wider than the persisted scope succeeds; a registration narrower than the persisted scope is refused, the API does not load, and the error names the persisted scope and the requested scope. |
| U-18 | Within a version, widening is allowed with explicit authorization and is recorded as a decision artifact. An unauthorized widening refuses to register. |
| U-19 | First registration of an identity is always allowed. With no persisted scope for the (name, version), the declared scope is accepted and persisted without comparison. |
| U-20 | The scope record is kernel-owned, operator-controlled, write-protected while the kernel runs, integrity-checked at boot, and editable by an operator only while the kernel is stopped for repair or migration. It is not a narrowing path. |
| U-21 | Exposed APIs are versioned. The identity of an exposed API is the pair of its name and its version. The name alone is not the identity. |
| U-22 | The version follows semantic versioning. A major version bump is a breaking change, including a scope narrowing; a minor version bump is an additive, backward-compatible change; a patch version bump changes no API surface. |
| U-23 | Across versions, a new major version can declare any scope. Both versions coexist and remain registered. The old version is deprecated but not removed; dependents choose the version they call. |
| U-24 | Retirement is a separate, explicit, recorded action. A retired version is no longer callable, and dependents that still call it break at their next call. |

## 1. The thesis: everything is a service with exposed APIs

Every participant in the kernel exposes its capabilities through the same mechanism, the exposed API. A service exposes an API. A plugin exposes an API. An extension exposes an API. A caged entry exposes an API. A concept that does not exist yet will expose an API. The mechanism does not change with the concept.

The kernel does not distinguish between these concepts. It sees participants, identity tokens, exposed APIs, capabilities, and policies. It does not see a plugin registry beside a service registry, an extension path beside a plugin path, or a privileged route beside an ordinary route. It sees one kind of registration and one kind of resolution, applied to participants whose internal vocabulary differs.

The concept names are metadata. Calling a participant a plugin, an extension, or a service is useful for display, diagnostics, documentation, and the user's understanding. It is not the kernel's categorization and it does not change an enforcement rule. The kernel does not grant a service a different reach because it is a service, and it does not deny a plugin a reach because it is a plugin. Reach follows from the exposed API's declaration, the caller's capability, the governing policy, and the call chain's origin.

This thesis has a consequence. A contributor who adds a concept must add a vocabulary for that concept, not a mechanism for that concept. The participant registers exposed APIs, declares their identities and scopes, and serves them through the same resolution surfaces as every other participant. If a concept needs a new registration path, a new resolution path, or a new reach rule, the design has departed from this decision.

## 2. The universal exposed API registry

The Exposed API Registry is not "the way services expose APIs." It is the way every participant exposes APIs. BrudTools, ActionManager, and every service register their capabilities there. A plugin that registers a tool is exposing an API of kind tool. An extension that registers a capability is exposing an API of kind extension-capability. The mechanism is identical. The vocabulary differs.

A kind is metadata. It may be recorded so that diagnostics and user surfaces can describe what a participant offers. It does not select a different registry, a different storage location, a different resolution surface, or a different scope rule. Two APIs of different kinds with the same scope and the same capability are enforced identically.

The registry is therefore the kernel's single authority for what is exposed. It holds the declaration, not the implementation. It returns a projection to an authorized caller, and the declaring participant serves the call. The registry does not interpret the concept behind the API, and it does not decide the participant's domain semantics. It decides whether an API identity exists, what capability reaches it, which origin may reach it, and whether the current call chain is permitted by that scope.

This universality is the reason the model can be enforced. A parallel registry would create a path the scope rules do not see. A parallel resolution path would create a caller the origin rules do not classify. A concept-specific reach rule would create an exception the default cannot close. The decision is one registry, one declaration shape, one resolution discipline, and one scope vocabulary for every participant.

## 3. What every exposed API declaration carries

When a participant registers an exposed API, it declares five things.

**The API name.** The name is the stable label by which callers identify the API. It is not participant identity and it is not a capability. It is the first half of the API's identity.

**The version.** The version is the second half of the API's identity. The identity is the pair of the name and the version. A new version is a new identity, not a label on a mutable API.

**The capability required to reach it.** The capability is the key that makes the API reachable to a caller. Holding the capability is necessary. It is not sufficient, because the scope and the policy still apply.

**The scope.** The scope states which origin may reach the API: kernel, runtime, host, or any. The scope is a property of the API identity, not of the caller, the participant, the transport, or the deployment. It is declared once and does not vary per call.

**The policy that decides which callers with the right capability are granted.** The policy is the participant's decision about which capable callers are actually served. It may consider the caller's tier, its official status, its workspace, its subject identity, or the participant's own domain rules. The scope decides which origin may reach the API. The capability decides which caller may attempt it. The policy decides which capable caller is granted.

The registration is immutable after boot. The boot window admits declarations; when the window closes, no participant adds, removes, or alters one. The scope is part of the declaration and is not editable while the kernel runs. A scope change is either a new declaration for the same identity at the next boot, which is subject to the within-version rule, or a new major version, which is a new identity. It is never an operation on a live registration. The same-identity declaration is also compared with the persisted scope for that identity under section 8.

This immutability is deliberate. A scope that could change while the kernel runs would let a participant widen its own exposure after review, or let a caller cause a widening by reaching a mutable path. The declaration is a reviewed fact for the lifetime of the boot. Changing it requires the next boot; the persisted-scope comparison and the authorization in section 7 apply to a same-identity change, and a new major version follows section 9.

## 4. API identity and versioning

Every exposed API has a version. The identity of the API is the pair of its name and its version. The name alone is not the identity, and a version alone is not the identity. Two APIs with the same name but different versions are different identities: different tokens, different scope records, and different dependents. Two APIs with the same version but different names are also different identities.

The version follows semantic versioning. A major version bump is a breaking change and includes a scope narrowing. A minor version bump is an additive change and is backward compatible. A patch version bump changes no API surface. The version records which kind of change the new identity carries, and it tells a dependent whether the change is safe to adopt without a code change.

The version is declared, not inferred. It is not derived from the API's name, the participant's package version, the caller's request, or the contents of the implementation. The declaration records the version as part of the API identity, and the registry keys the declaration by that identity.

The registry, the scope record, resolution, deprecation, and retirement all operate on the identity, not on the name alone. A name without a version does not identify an API. The model has no floating latest identity that silently moves from one version to another; a dependent declares the identity it calls.

The version is not a compatibility promise by itself. It is the label the semantic-versioning rules attach to a change. The rules in section 9 govern how versions coexist and how an old version is deprecated or retired.

## 5. The four scopes

The four scopes are ordered from narrowest to widest: kernel, runtime, host, any. Each states which origins may call the API identity.

| Scope | Who can call it |
|---|---|
| kernel | The kernel's own machinery and the hardcore services only. No plugins, no extensions, no caged entries, no non-hardcore services, and no clients. |
| runtime | Kernel machinery, hardcore services, and all other participants. No clients. |
| host | Clients only, through the daemon's RPC surface or the embedded host. No kernel and no participants. |
| any | Any origin: kernel, participant, or client. |

**kernel.** A kernel-scope API is reachable only by the kernel's own machinery and the hardcore services. It is not reachable by plugins, extensions, caged entries, or non-hardcore services. It is not reachable by clients. The kernel's own operations — issue, resolve, retire, revoke, the hardcore gate, and the loader — are kernel-scope.

**runtime.** A runtime-scope API is reachable by kernel-origin and participant-origin calls. The kernel's machinery and the hardcore services may call it. Non-hardcore services, plugins, extensions, and caged entries may call it. It is never reachable by a client. The daemon cannot expose it to a client, and a client cannot call it.

**host.** A host-scope API is reachable only by client-origin calls. A client reaches it through the daemon's RPC surface, or through the host when the kernel is embedded. It is never reachable by the kernel or a participant. No service, plugin, extension, or caged entry can call it.

**any.** An API with the any scope is reachable by any origin: kernel, participant, or client. The scope describes the API itself, not a bridge between origins. An any-scope API cannot relay a narrower-origin call to an API whose scope refuses that origin.

The scopes are origins, not locations. An API does not belong to the runtime scope because its code runs in the kernel process, and it does not belong to the host scope because a client happens to use it. It belongs to a scope because its declaration says so. The same is true of a caller: a caller belongs to the origin class that initiated its call chain, not to the location in which its instructions happen to execute.

This distinction is what makes the model enforceable across deployment shapes. A caged entry executing within the kernel process is a participant origin when it initiates a call; when it is invoked on behalf of a client, the chain keeps the client origin. A service projection may execute on behalf of a client call and remains a client-origin chain. The location of the code does not decide reachability. The declared scope and the chain's root origin do.

## 6. The default scope is kernel

An exposed API identity reaches participants or clients only if its registrant explicitly declares runtime, host, or any. The default is kernel. Secure by default means the narrowest scope.

The default is not a convenience. It is the direction in which an omission must fail. A registrant that declares an API and forgets to state its scope has not exposed it to participants or clients; it has kept it to the kernel and the hardcore services. A new participant, a new API identity, and a new concept inherit the same default. An API that exists to serve kernel machinery does not become reachable by participants just because its author omitted the scope. Every wider scope is reached only by an explicit act, never by an absent field, an unknown value, or an inherited convention.

A declaration that cannot be read is not a declaration of wider reach. The safe interpretation of an unreadable or missing scope is the kernel default. The registration does not infer runtime, host, or any from the participant's role, the API's name, the transport that happens to call it, or the fact that a similar API identity had a wider scope in a previous version.

The default also sets the review burden. Because every wider scope is explicit, every API reachable by a participant or a client is a decision someone made. Because kernel is the default, the set of APIs participants and clients can reach is the set that was deliberately widened, not the set that happened to be registered.

## 7. Widening scope within a version is a security-sensitive change

Every step away from kernel within one API identity is a security-sensitive change. Each step exposes a new attack surface and requires the same kind of authorization as an official-flag change: recorded, reviewed, deliberate.

The widening ladder has six steps, applied to one identity:

- **Kernel to runtime** — a new surface reachable by participants.
- **Kernel to host** — a new surface reachable by clients.
- **Kernel to any** — a new surface reachable by participants and clients.
- **Runtime to host** — a new surface reachable by clients.
- **Runtime to any** — a new surface reachable by clients.
- **Host to any** — a new surface reachable by participants.

Every widening requires explicit authorization and is recorded in the ledger as a decision artifact. The registration refuses a widening without an explicit authorization. The refusal is not advisory. A declaration that widens a scope without the authorization is not admitted, and the absence of a declaration is not a substitute for the authorization.

The ledger record names the API identity, the previous scope, the new scope, the authorization, and the reason. A widening that is not in the ledger is not a widening the system recognizes. The record is what distinguishes a deliberate exposure from an accidental one.

Widening is authorized before admission, not while the kernel runs. The running kernel has no path that changes a scope. The authorization applies to the next declaration or the next boot; it does not mutate a live registration. Within a version, scope can only widen; a registration that narrows the same identity is refused under section 8. Across versions, a new major version can declare any scope under section 9. The versioning escape hatch is the only way to narrow an API; it is not a runtime scope change and it is not an edit of the existing scope record.

The authorization model is the same class as the official-flag change because the consequence is the same class. The official flag says a component is trusted. A scope widening says an API is reachable by an origin that was previously unable to reach it. Each extends trust beyond the default. Neither is a configuration detail that an ordinary change may slip through.

## 8. Scope persistence and the versioned narrowing rule

**The scope record keys on the identity.** The kernel records the last successful scope for each (name, version) identity. The record is stored in the same protected, kernel-owned, operator-controlled infrastructure as the identity registry. It is write-protected while the kernel runs, integrity-checked at boot, and editable by an operator only while the kernel is stopped for repair or migration. It is not a narrowing path.

**Within a version, narrowing is refused.** An API registering the same (name, version) with a scope that is equal to or wider than the persisted scope succeeds. An API registering the same (name, version) with a scope that is narrower than the persisted scope is refused. The API does not load. The owner receives a clear error naming the persisted scope and the requested scope.

**Within a version, widening is allowed with authorization.** Widening is a security-sensitive change. It requires explicit authorization and is recorded in the ledger as a decision artifact. An unauthorized widening refuses to register.

**Across versions, narrowing is allowed through a major version bump.** A new major version is a new identity. It can declare any scope, including a narrower one. The old identity keeps its persisted scope. This is the versioning escape hatch. It is not a runtime scope change, and it is not an edit of the existing scope record.

**First registration of an identity is always allowed.** An API registering an identity for the first time has no persisted scope for its (name, version). It registers with its declared scope, and the scope is persisted. No comparison is made because there is nothing to compare against.

For the comparison, wider and narrower are measured in the scope order: kernel, runtime, host, any. A different version is a different identity and is not compared in this table.

| Persisted scope for the identity | Requested scope for the same identity | Outcome |
|---|---|---|
| none | any of the four | Allowed; the requested scope is persisted |
| same | same | Allowed |
| narrower | wider | Allowed only with explicit authorization; recorded |
| wider | narrower | Refused; the API does not load; the error names the persisted scope and the requested scope |

## 9. Version coexistence and retirement

When a new major version is registered, the previous version continues to function. Both versions remain registered. Dependents that call the old version continue to work, and dependents that choose to migrate to the new version declare the new identity and receive the new scope. The transition is explicit: a dependent updates its declared version, and nothing moves a dependent to a new version on its behalf.

The old version is deprecated but not removed. Deprecation is a declaration, not a runtime action. It tells dependents that a newer identity exists and that the old identity is on a retirement path; it does not change the old identity's scope, its capability, or its callability.

The old version can be retired through a separate, explicit process. Retirement means the API identity is no longer callable. The retirement is recorded and visible. Dependents that were still calling the retired identity break at their next call; they do not silently move to the new version, and they do not inherit the new version's scope.

Narrowing across versions is achieved by registering the new major version with the narrower scope. The old version remains registered with its old scope until it is retired. The two identities do not conflict because they are different identities: the scope record has one entry for each, and a dependent that declares the old identity reaches the old scope.

## 10. Call-chain origin tracking

The kernel tracks the root origin of every call chain. Every call carries the origin that initiated the chain. The origin is classified as kernel, participant, or client. When an API identity is called, the kernel checks the scope against the root origin, not just the immediate caller.

The root origin is set at the entry point of the call and is preserved across nested calls. A service that calls another service does not become the origin. An any-scope API that is invoked does not become the origin for the calls it makes. An intermediary cannot replace the origin, launder it, reset it, or choose a different one. The origin is a property of the chain, not a claim in the request.

With four scopes, the check has four cases.

- **kernel** accepts only kernel-origin calls. It rejects participant-origin and client-origin calls.
- **runtime** accepts kernel-origin and participant-origin calls. It rejects client-origin calls.
- **host** accepts client-origin calls. It rejects kernel-origin and participant-origin calls.
- **any** accepts any origin.

The consequences are direct. A participant-origin chain cannot reach a host API, even through an any-scope intermediary. The any-scope intermediary is reachable by a participant, but the call it makes to the host API carries the original participant origin, and the host scope refuses it.

A client-origin chain cannot reach a runtime API, even through an any-scope intermediary. The any-scope intermediary is reachable by a client, but the call it makes to the runtime API carries the original client origin, and the runtime scope refuses it.

A kernel-origin chain cannot reach a host API, even through an any-scope intermediary. The kernel is not a client, and the host scope accepts only client origin. The narrowest scope is protected in the same way: a participant-origin or client-origin chain cannot reach a kernel API through an any-scope intermediary, because the kernel scope accepts only kernel origin.

The any scope is not a bridge. Without origin tracking, an any-scope API could relay a call to an API whose scope refuses the original origin. The any-scope API is reachable by the narrower origin, so that origin could call it, and the any-scope API could then call the wider or narrower target with its own immediate identity. The target would see a caller admitted by the any scope and could admit the call. Origin tracking closes that path: the target checks the root origin, sees the initiator, and refuses.

The same argument applies across all three origin classes. An any-scope API reachable by a participant could relay a participant call to a host API; an any-scope API reachable by a client could relay a client call to a runtime API; and an any-scope API reachable by any origin could relay that origin's call to a kernel API. Origin tracking refuses each relay because the target checks the root origin rather than the immediate caller. The scope model holds only because the check uses the root origin.

## 11. Embedded mode

When there is no daemon and the host application calls the kernel in-process, the host's calls count as client-origin calls. The host is not a kernel-internal participant. It is the application embedding the kernel, with the same authority a client would have.

In-process does not mean internal. The location of the call does not decide its origin; the entry point does. A host that links the kernel and invokes it directly is still the external application. It has not become kernel machinery, a hardcore service, or a participant by sharing an address space with the kernel.

The scope rules apply identically whether the daemon is present or the host is embedded. A kernel-scope API is not reachable by the embedded host. A runtime-scope API is not reachable by the embedded host. A host-scope API is reachable by the embedded host subject to the same capability, policy, and origin checks. An API with the any scope is reachable by the embedded host as a client origin. The absence of a daemon changes the transport, not the origin.

This rule prevents the most common embedding mistake: treating in-process access as an implicit privilege. An embedder that can call the kernel directly must not thereby reach the kernel or runtime APIs. If the embedder needs an API, the API is declared host or any, with the authorization that widening requires. The host is a client origin, always.

## 12. The enforcement points

Two resolution surfaces enforce the model, and every resolution checks the caller's root origin against the scope of the API identity.

**The four cases.** The check has one outcome for each origin and scope pair.

| Origin | kernel | runtime | host | any |
|---|---|---|---|---|
| Kernel | Allowed | Allowed | Refused | Allowed |
| Participant | Refused | Allowed | Refused | Allowed |
| Client | Refused | Refused | Allowed | Allowed |

**Internal resolution.** Internal resolution serves broker requests, plugin context, service-to-service calls, and caged entry imports. The origin is set at the internal entry point: a call initiated by kernel machinery or a hardcore service is kernel origin, a call initiated by any other participant is participant origin, and a chain that entered on behalf of a client keeps client origin. Every internal resolution applies the four-case check to that root origin.

**External resolution.** External resolution serves daemon RPC dispatch and host in-process calls. Its entry point sets client origin. Every external resolution applies the same four-case check. A client-origin call reaches host and any APIs; kernel and runtime APIs refuse it.

Every resolution names an API identity and checks the scope against the root origin of the call chain. The registry keys the declaration by the identity. The origin is set at the entry point of the call. The check is not performed only at the first hop and it is not skipped at later hops; every resolution on the chain applies the same rule to the same origin.

Filtering is not advisory. A filtered API is absent from resolution. It is not returned and then refused. A caller that cannot resolve an API identity does not learn its projection, its operations, or its error behavior, because the API is not reachable by the caller's origin.

The two surfaces are two entry classes over one registry, not two registries. The same declaration is visible to an origin only when the scope admits that origin. The views filter by scope; the origin check decides the individual call.

Scope, capability, and policy are three distinct checks and all three apply. Scope decides which origin may reach the API identity. Capability decides which caller may attempt it. Policy decides which capable caller is granted. An API that passes one check and fails another is refused. The scope model does not replace the capability model, and it does not replace the participant's policy.

## 13. Relationship to the existing architecture records

The universal model is the layer that ties the companion records together. It does not restate their decisions and does not weaken them.

| Record | Boundary it defends | What it decides | What it does not decide |
|---|---|---|---|
| Security architecture | The daemon's client boundary | Which local process may talk to the daemon, the authenticated principal, and the caller's capabilities. | It does not decide which exposed APIs a kernel, participant, or client origin may reach. |
| Kernel identity | The kernel's participant boundary | The Identity Token, its binding to publisher and contents, and its attachment to the execution context. | It does not decide the scope of an API or the reachability of a call chain. |
| Plugin identity | The plugin boundary | Which package a loaded plugin is and what data it owns. | It does not decide which exposed APIs a plugin or a client may reach. |
| WASM host interface | The cage boundary | The import and export contract, inspection, routing, and the facades a caged entry receives. | It assumes a caged entry can call exposed APIs; it does not decide which APIs those are. |
| This document | The universal API surface | Which participants expose APIs, what every API declares, and how versioned identity, scope, and origin govern reachability. | It does not decide identity, authentication, capability grants, policy content, or cage enforcement. |

The security architecture defends the daemon's client boundary. It authenticates callers and fixes the principal. It does not decide scope. A caller can be correctly authenticated and still be unable to reach a runtime or kernel API; a caller can be correctly authenticated and still be unable to relay through an any-scope API to a scope its origin does not satisfy.

The kernel identity document decides participant identity. It binds the token to verified publisher and contents. It does not decide scope. Two participants with valid tokens can expose APIs of different scopes, and the token does not change which origin may reach either one. The token answers who is calling; the scope and origin answer whether the call may proceed.

The plugin identity document applies the identity model to plugins. It does not decide scope. A plugin's exposed APIs are subject to the same declaration, default, widening authorization, versioned narrowing rule, and origin checks as a service's exposed APIs. The plugin concept changes the vocabulary, not the reach rule.

The WASM host interface decides the cage contract. It assumes caged entries can call exposed APIs. The scope rules determine which APIs they can call. A caged entry that initiates a call is a participant origin, so it reaches runtime and any APIs and is refused by kernel and host APIs. Its calls carry their root origin, so a caged entry invoked on behalf of a client keeps the client origin and does not launder it by executing within the kernel.

The universal exposed API model is the layer that ties them together. It says: every participant exposes APIs; every API declares its identity and its scope; every call checks the scope against the call chain's origin.

## 14. What this does not solve

The scope model controls reachability. It does not control the other properties a secure system needs.

- **Confidentiality of data in transit between origins.** The scope controls reachability, not encryption. A reachable API can still carry plaintext, and an unreachable API is not protected by being unreachable.
- **Integrity of the exposed API declarations themselves.** The identity token and the config authority decide that. The scope model trusts the declaration it receives; it does not prove that the declaration was not altered.
- **The terminal service's OS-level isolation.** A caged entry granted terminal access still runs real commands on the real OS, regardless of scope. An API reachable by a participant that reaches the terminal is not an operating-system sandbox.
- **The accepted same-user attacker risk from the security architecture document.** A process with the user's full authority can read or alter the storage the declarations and ledger live in. The scope model does not deny authority an attacker already holds.

Two further matters are separate decisions. The capability grant model decides who holds a capability in the first place; the scope model assumes a caller that already holds one. The policy content decides which capable callers a participant serves; the scope model does not choose a participant's policy. The scope model composes with these separate decisions and replaces neither.

## 15. The rule

Every participant exposes APIs. Every API has a version, and its identity is its name and version. Every API declares its scope. Every call checks the scope against the chain's origin. The four scopes are kernel, runtime, host, and any, in that order. The scope record keys on the API identity. Within a version, scope can only widen. Widening is authorized and recorded. Across versions, a new major version can declare any scope. Both versions coexist. The old version is deprecated but not removed. Retirement is a separate, recorded action. The default is kernel. The any scope is not a bridge. The host is a client origin.

## 16. Production-mirror obligation

Every implementation task derived from this decision produces production-mirror tests with real participants, real tokens, real exposed API identities, real scopes, real call chains, and the real kernel. It does not mock the registry, the identity issuance, the scope record, the call chain, the daemon surface, or the embedding host. A test that replaces any of those with a fake does not satisfy this obligation, even if it is a useful unit test elsewhere.

The tests must prove at least the following.

1. **Default is kernel.** An API identity without a declared scope is callable only by the kernel and the hardcore services. A plugin cannot call it, even with a capability that would otherwise be sufficient.
2. **Kernel scope is unreachable by non-kernel participants.** No plugin, extension, caged entry, or non-hardcore service can call a kernel-scope API, in either internal or external resolution.
3. **Every widening requires authorization.** A widened API within one version, from kernel to runtime, host, or any, without explicit authorization refuses to register. Every authorized widening is recorded as a decision artifact.
4. **The identity registry's operations are kernel.** Issue, resolve, retire, and revoke are declared kernel. A plugin cannot issue itself a token, resolve another participant's token, retire another participant's identity, or revoke anything.
5. **The four scopes enforce in each resolution.** Kernel-internal resolution and external resolution, through the daemon or the embedded host, apply the four-case origin-and-scope check correctly to kernel, participant, and client origins.
6. **The origin guard holds for all three origin classes.** A participant-origin chain cannot reach a host API through an any-scope intermediary; a client-origin chain cannot reach a runtime API through an any-scope intermediary; a kernel-origin chain cannot reach a host API through an any-scope intermediary; and a participant-origin or client-origin chain cannot reach a kernel API through an any-scope intermediary. The refusal is caused by the root origin rather than the immediate caller.
7. **The scope record persists across boot per identity.** Register an API identity, record its scope, shut down, reboot, and confirm that the persisted scope for that (name, version) is the one the next registration of the same identity is compared against.
8. **A narrower scope on the same identity is refused.** Register an API identity as runtime, shut down, reboot, and attempt to register the same (name, version) as kernel. The registration refuses, the API does not load, and the error names the persisted runtime scope and the requested kernel scope.
9. **A narrower scope on a new major version succeeds.** Register an API name at version 1 with the runtime scope. Register version 2 of the same name with the kernel scope. Version 2 succeeds, and version 1 remains persisted with the runtime scope.
10. **Two versions of the same name with different scopes coexist.** Register version 1 as runtime and version 2 as kernel. Both identities remain registered and callable by their respective origins.
11. **A dependent on the old version is unaffected.** A dependent that declares version 1 continues to call version 1 after version 2 registers with a different scope, and its calls are governed by version 1's scope.
12. **Widening is allowed with authorization and refused without.** Register an API identity as kernel, reboot, and attempt to register the same identity as runtime without authorization. The registration refuses. Repeat with authorization. The registration succeeds and the widening is recorded.
13. **First registration of an identity always succeeds.** On a fresh system with no persisted scope for the identity, register a new API identity with any of the four scopes. The registration succeeds and the scope is persisted.
14. **Retirement is a separate, recorded action.** Retire version 1 of an API through the explicit retirement action. Version 1 is no longer callable, version 2 remains callable, and the retirement is recorded and visible.
15. **The scope record is protected.** Attempt to modify the scope record while the kernel runs. The modification is refused.

The tests must exercise the real resolution surfaces: internal resolution for broker requests, plugin context, service-to-service calls, and caged entry imports; external resolution for daemon RPC dispatch and host in-process calls. A test that proves the rule at only one surface does not prove the model.

Where a test cannot be run because a required participant, surface, or authorization does not yet exist, the test is deferred with the reason recorded. A deferred test is not a passed test. A claim that a scope holds without a production-mirror run is not evidence. The implementation task records the evidence in the ledger and reports a real gap rather than substituting a mock that makes the contract appear satisfied.