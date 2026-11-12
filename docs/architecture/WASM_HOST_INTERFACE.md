# Brud WASM Host Interface: Loader and Cage Contract

Nov 11, 2026 · @Rahat Hasan

**Status. Decided for the interface; dependent on trust-tier ratification.** This document records the interface contract between the kernel's loader and the WASM host. It is a design record, not an implementation guide. It is written for future implementation tasks, not for users, and it lives at docs/architecture/WASM_HOST_INTERFACE.md. It does not restate the trust model recorded in the security architecture document; it consumes that document's decisions and defines the in-process confinement interface that the trust-tier design requires. Its authority depends on the trust-tier direction being formally adopted, which is recorded as Q-01.

## Purpose and scope

The kernel is the loader. It reads the composition, determines each entry's tier from the entry's official flag, and loads official entries in Node and unofficial entries in the WASM cage. The WASM host is kernel infrastructure, not a service. It is constructed by the kernel, owned by the kernel, and never registered in the service container or exposed to an entry.

This document specifies the complete interface between those two pieces before any implementation code exists. It defines what the loader takes from the composition, what it sends to each tier, and what it expects back. It defines the host's small public surface. It defines how a caged entry declares imports and exports, how the host inspects a module before instantiation, how calls route through the exposed API registry, how a caged entry registers new concepts, how a caged parent composes children, what resources the host bounds, and what an unofficial entry cannot do. It also records the known terminal-service gap and the production-mirror testing obligation that every future implementation task inherits.

The design is deliberately expressed as contracts and information flow. It does not name implementation entry points, classes, module paths, or runtime APIs. Those are decisions for the implementation task. Where the interface depends on a decision that the architecture has not made, this document reports the dependency rather than inventing the answer.

## Decision register

| ID | Decision |
|---|---|
| W-01 | Tier is chosen once, from the top-level composition: an explicit official flag of true selects the Node path; an absent or false flag selects the WASM path. The decision is frozen at boot. A manifest cannot claim or change it. |
| W-02 | The WASM host is kernel infrastructure. It is constructed once per kernel, is not a service, is not reachable through the service container or the exposed API registry, and is retired with the kernel. |
| W-03 | A caged module's import section is authoritative. The host inspects it before instantiation and refuses any module that declares an import outside the fixed host import set, outside the entry's manifest declaration, or outside the entry's effective grant. |
| W-04 | All service access crosses one routed call import. The host constructs the caller context, consults the exposed API registry with the entry's declared capabilities and a non-official identity, and dispatches only against a declared operation catalogue. A cage cannot name a service token, caller tier, or official status. |
| W-05 | Only plain serializable values cross the boundary. No live objects, closures, callbacks, shared memory, or runtime handles cross in either direction. Requests and responses are copied and bounded. |
| W-06 | An entry's manifest declares its tools, actions, event handlers, service lifecycle, plugin lifecycle, and exposed APIs. The host cross-checks those declarations against the module's export section. A declared export that is missing is an admission error; an export that is not declared is inaccessible. |
| W-07 | The host supplies kernel-shaped facades. A caged service, plugin, tool, action, event handler, and exposed API are registered through the same kernel mechanisms and are indistinguishable from a Node entry that carries the same public contract and effective privilege. |
| W-08 | A caged entry registers through the same registries as a Node entry. The host supplies the ownership and non-official status; the entry cannot assert either. Registration collisions, freeze windows, access policies, projections, and disposal are the kernel's normal rules, not cage-specific rules. |
| W-09 | A child loaded by a caged parent is always caged, regardless of the child's own official flag. Only a top-level composition declaration can select Node. A child is attenuated to a subset of its parent's capabilities and resources, and a parent's retirement revokes its children. |
| W-10 | Resource limits are configured by the kernel, frozen at boot, and enforced by the host at admission, per call, per cage, and per family. A caged entry cannot raise its own limits or read limit controls from the host. |
| W-11 | The tier boundary is the cage's promise. If a capability is not granted, no import reaches it. If a capability is granted, the target service sees a normal caller and applies its own policy. The cage does not amplify a grant. |
| W-12 | Every implementation task derived from this design must produce production-mirror tests with real WASM modules, the real kernel, the real configuration, and a real workspace. No mocks. |

## 1. Basis and relationship to the security architecture

The security architecture decision record, Brud OS Security Architecture: Host–Daemon Local Channel, decides the local channel between the host application and the kernel-hosting daemon: operating-system peer identity, an authenticated key exchange, authenticated record protection, an authenticated principal with capability authorization, strict protocol validation, and bounded resources and request lifetime. This document is inside that daemon. It does not restate or weaken those decisions.

The relevant security decision is the one that fixes the caller principal outside the request payload. A caged entry is a caller. The host, not the entry, constructs the caller identity, the non-official status, the caller tier, and the workspace scope. A caged entry cannot name a different caller, a different workspace, a different tier, or an official identity. If it attempts to do so through a request, the host rejects the request rather than passing the claim to a service.

The security architecture document deliberately leaves three adjacent matters outside its scope: confinement of third-party components inside either process beyond the trust-tier decision, operating-system isolation of the terminal service, and configuration content or composition, including which components are declared official. This document is the interface for the first of those. It depends on the trust-tier decision and on the composition's authority over the official flag, but it does not claim that the security architecture document decided either. The terminal gap is restated in section 11 so no reader mistakes this design for terminal isolation.

There is a status gap at the architecture level. The only trust-tier record in the repository is the exploratory proposal, Brud OS Security Proposal: Trust-Tiered Runtime Isolation, not a formal decision record. The security architecture document refers to a trust-tier decision but does not make it. This design assumes that the trust-tier direction is ratified: official code runs in Node with full in-process authority, and unofficial code runs in the WASM cage with only granted capabilities. If that direction is not ratified, this interface has no authority to enforce. This is recorded as an open question, not resolved here.

The design also consumes several current-kernel facts. They were verified at the time of writing and are stated as assumptions, not as guarantees about every future revision.

- The composition currently describes each entry with a source locator and an optional official flag. It does not carry an integrity pin, a capability grant, a resource profile, or a manifest locator. The loader contract below requires those as logical inputs; the exact composition representation is an open question.
- The current loader imports every configured service and plugin through Node's module system and records the official flag. It has no WASM path, no cage, and no tier branch. The loader contract in this document is a target contract, not a description of current behavior.
- The exposed API registry currently maps an API name and a capability to a live service projection. It does not carry a serializable operation catalogue. This design requires one; adding it is an implementation change, not a current fact.
- The plugin manifest currently declares identity, version metadata, dependencies, permissions, and transports. It does not declare tools, actions, event handlers, or exposed APIs. Those declarations are added by this design.
- The kernel has a file-mutation journal and internal subscriptions, but no general event bus exposed to entries. Event handlers are therefore specified as a contract whose event catalogue and source remain an open question.
- The kernel has no single frozen loader capability and no host-mediated child loading. Composition is a target contract.
- The kernel has no WASM runtime dependency and no general resource metering for entry execution; it has per-registry registration quotas and service-specific timeouts, but no execution budget, memory ceiling, or per-cage accounting.
- The kernel's existing registration mechanisms, the exposed API registry, the plugin manager, the tool registry, the action registry, and the operation router are the canonical registration paths. The facades in this design must satisfy those contracts. This is an assumption that the implementation must prove, not a fact that this document may assert.

## 2. The kernel loader contract

The loader is the only component that reads the composition and decides tier. It owns ordering, integrity verification, registration, failure rollback, and the boot trust report. It does not own the host's internals and does not inspect a caged module's runtime state.

### 2.1 Information from the composition to the loader

The loader receives the following logical information for each top-level entry. The first two are present in the current composition; the rest are required by this design and their final representation is an open question.

| Information | Purpose |
|---|---|
| Entry section | Distinguishes a service declaration from a plugin declaration and selects which facade contract the entry must satisfy. |
| Source locator | Identifies the exact module or package to load. It is not the entry's identity. |
| Official flag | Selects the tier. Only an explicit true selects Node. Absent and false select the cage. |
| Integrity pin | Lets the loader verify the entry before it reaches either tier. The trust root for this pin is outside this document. |
| Capability grant | The effective set of capabilities the entry may use. A manifest may request capabilities; the grant is the trusted authority's answer. |
| Resource profile | The effective admission, per-call, per-cage, and per-family limits. |
| Manifest locator or embedded manifest | Supplies identity, version, declared imports, declared exports, and the requested capability set. |
| Composition identity and digest | Binds the boot trust report, diagnostics, and integrity checks to the exact composition that was read. |

The loader derives an entry's stable identity from the entry's manifest, or from the service descriptor for a service that has no separate manifest. The source locator is not identity: the same package may be installed in more than one place, and two different packages may try to present the same identity. The loader rejects duplicate identities at the top level.

The official flag is read only from the top-level composition. A package manifest, a nested composition, a dependency, or a runtime request cannot supply official status. This is the composition authority rule that the security architecture document leaves outside its own scope; this design consumes it.

### 2.2 The tier decision

The tier decision is made once per top-level entry, before resolution, integrity verification, or instantiation. The decision is immutable for the kernel lifetime.

An explicit official flag of true selects the Node path. An absent flag, a false flag, or any value that is not the literal true selects the WASM path. There is no default-official state, no runtime promotion, and no emergency path that turns a caged entry into a Node entry. A new boot with a changed composition is the only way an entry changes tier, and the composition is protected for the kernel lifetime.

The manifest may contain an official claim. The loader ignores it for tier selection. A caged entry that claims official status is treated as untrusted input and is still loaded in the cage. A child that claims official status is treated the same way. The host presents a caged entry's manifest to the kernel with any official claim removed or forced to non-official; the claim is recorded as an admission diagnostic. This prevents the claim from becoming an authorization, and it prevents the kernel's existing anti-self-certification rule from turning the claim into a denial that would hide the tier decision. The claim is never an authorization.

### 2.3 The Node path

For an official entry, the loader resolves the exact source, verifies the integrity pin, imports the module in the kernel process, validates the service-module or plugin contract, and registers the resulting descriptor or plugin. The loader supplies the generic context bag, the logger, the composition identity, and the entry identity. It expects back a service descriptor with its token, tier, dependencies, access policy, factory, projection, and lifecycle hooks, or a plugin with its validated manifest and lifecycle hooks. Registration then follows the kernel's normal order and rollback rules.

The Node path is the existing path. This design does not alter what an official entry may do; it only makes the decision explicit and makes the Node and cage paths produce the same registration artifacts.

### 2.4 The WASM path

For an unofficial entry, the loader reads the module bytes and manifest, verifies the integrity pin, derives the entry identity and kind, and builds a cage specification. It hands that specification to the host and never imports the caged module through Node's module system.

The cage specification contains:

- the entry identity and the entry kind, as declared by the composition section;
- the module bytes or an exact, already-verified source reference;
- the manifest, including declared imports, declared exports, requested capabilities, and contract version;
- the effective capability grant, after the loader's policy has reduced the manifest request to what the composition permits;
- the effective resource profile;
- the workspace identity and the composition identity;
- the logger and diagnostic correlation identity;
- a boot correlation identity that lets the host associate every admission, call, and retirement with the loader's boot.

The loader does not pass live services, the service container, the access broker, or any kernel object to the host. The host reaches kernel services only through the exposed API registry using the same routed call contract that a caged entry uses. This preserves the rule that the host is infrastructure, not a privileged back door.

### 2.5 What the loader expects back

From either tier, the loader expects a stable entry identity, the tier that was selected, the official status, a registration batch, and a lifecycle handle. The registration batch is the set of facades and declarations that the kernel's existing registries will accept. The lifecycle handle lets the loader activate, deactivate, and dispose the entry in the kernel's normal order.

From the Node path, the loader expects a service descriptor or a plugin object. From the WASM path, the loader expects a cage handle, the host's accepted import declaration, the accepted export declaration, the facades and registration batch, a readiness signal, a resource summary for the boot trust report, and diagnostics. On refusal, the loader expects a stable rejection reason that distinguishes at least: invalid module, unsupported contract version, ungranted import, undeclared export, manifest violation, integrity failure, admission resource failure, and instantiation failure.

The loader does not accept a partially admitted cage. If admission fails after some facades have been constructed, the host retires the cage and releases every registration before the loader sees the failure. If the failure occurs during boot, the kernel's normal rollback disposes the entries already initialized and the boot rejects. If the failure occurs during a runtime child load, only the child is refused and the parent receives a stable failure result.

### 2.6 Boot trust report

The loader records every entry's identity, source digest, version, tier, official status, effective grants, and effective resource profile before boot completes. The report is diagnostic and is not a capability. It exists so an operator can see which entries hold Node authority and which are caged. The report must not expose a caged entry's internal runtime state, raw memory, or host-internal diagnostics.

## 3. The WASM host public surface

The host is constructed once per kernel and retired with the kernel. It is not a service, has no service token, is not registered in the service container, is not exposed through the exposed API registry, and is not reachable by any import. No entry can resolve it, replace it, or speak to it directly. The kernel's loader is its only caller.

The public surface is deliberately small. It consists of four operations.

| Operation | Caller intent | Inputs | Outcome |
|---|---|---|---|
| Admit | Validate, inspect, instantiate, and declare one cage | Cage specification | A cage handle, accepted declarations, facades, readiness, and a diagnostic summary; or a stable refusal |
| Dispatch | Invoke one declared export | Cage handle, export kind and name, plain request envelope, caller context, deadline, cancellation token | A plain response envelope or a stable failure |
| Retire | Deactivate and dispose one cage and its children | Cage handle, reason, deadline | Confirmation, or a stable failure that still leaves the kernel able to continue |
| Report | Read cage state and resource usage for diagnostics | Cage handle | Ready, busy, quarantined, or retired state; usage summary; last stable failure |

The host does not expose a separate compile operation, an instantiation operation, an arbitrary export invocation, a raw runtime handle, a live service, or a service-token resolver. Admission includes inspection and instantiation so that no caller can instantiate a module that the host has not first inspected. Dispatch accepts only the declared export kinds: tool, action, event handler, service lifecycle, plugin lifecycle, exposed API operation, and child load. Any other export kind is refused.

The host does not read or write the workspace directly. It does not use the operating system on behalf of a cage except through kernel services reached by the routed call. It does not create a second registry. It does not interpret capability semantics beyond the grant check and the registry lookup. The services own their semantics; the host owns the boundary.

The host returns only plain data and kernel-shaped facades. It never returns the runtime instance, a memory view, a table reference, a host object, or a closure authored inside the cage.

## 4. The import contract

### 4.1 How an import is declared

A caged module declares the host imports it needs in its WASM import section. That section is authoritative. The manifest separately declares the requested import capabilities so the loader and the host can compare the module's actual request with the entry's declared intent and with the effective grant.

The host exposes a fixed, small import set. It is fixed so that import inspection is a finite check and so that a new capability does not silently create a new host surface.

| Import | Required import capability | Purpose |
|---|---|---|
| Routed call | Service invocation | Sends one plain request naming an exposed API and a declared operation, with plain arguments. |
| Registration | The specific registration capability requested by the call | Declares a tool, action, event handler, exposed API, or other kernel registration on the entry's behalf. |
| Child load | The loader capability | Requests that the kernel load a child under the caller's cage. |
| Runtime support | None | A minimal, enumerated set of primitives needed by the approved language runtimes for computation, such as deterministic time and randomness. It grants no file, network, process, environment, or kernel authority. |

There are no direct file, network, process, environment, clock, random, or operating-system imports. There are no imports that accept or return a live object, a closure, a callback, a pointer into host memory, or a runtime handle. There are no imports that expose the service container, the access broker, the exposed API registry object, the brand registry, or another entry's context. The runtime support set is part of the cage floor, not a capability; every entry receives the same set, and it is inspected like every other import.

The manifest must declare every host import the module actually uses. A module that imports a host operation not declared in its manifest is refused. A module that declares a capability it does not import is allowed to load but gains nothing from the unused declaration; the host records it for diagnostics. A module that declares a privileged import but whose effective grant does not contain the required import capability is refused before instantiation.

### 4.2 Inspection before instantiation

The host compiles or validates the module without running it, then reads the import section before instantiation. This ordering matters: the refusal must happen before the module's start routine or any imported host operation can run.

The host applies these checks in order:

1. The module is a valid module for the supported runtime and contract version.
2. Every import comes from the fixed host import set. An unknown import from any other namespace is refused.
3. Every privileged import maps to an import capability that is present in the effective grant. A missing grant refuses the whole module, not just the import.
4. The import set is consistent with the manifest declaration. An undeclared privileged import refuses the module.
5. The module does not import shared memory, threads, a host table, a host global, or any other shared-state primitive. Only the explicit runtime support imports are allowed.
6. The module does not use an import alias to obtain a privileged import under a second name, and does not request the same privileged import more than once in a way that would bypass the grant check.
7. The module's declared export set is at least the manifest's declared export set, and every declared export has the boundary signature for its kind.

If any check fails, the host returns a stable refusal to the loader and never instantiates. The refusal identifies the check and the import or export, but it does not disclose host memory, service internals, or another entry's data. The loader then refuses the entry. This is the mechanism that makes "refuses modules that ask for capabilities they were not granted" a pre-instantiation property rather than a runtime hope.

### 4.3 How a routed import reaches a service

A routed call carries a plain request envelope. The host validates the envelope, constructs the caller context, consults the exposed API registry, and invokes the declared operation on the projection that the registry returns.

The request envelope contains the entry's request identity, the API name, the declared operation name, the plain arguments, a correlation identity, the remaining deadline, and an opaque cancellation token. The correlation identity is host-assigned and cannot be chosen by the cage to collide with another request.

The host constructs the caller context. The caller identity is the entry's stable identity, or the child's scoped identity for a child. The caller tier is userland. The official status is false. The subject identity is the entry or child identity. The workspace identity is the one the loader supplied. The partition prefix, if any, is the one the kernel supplied. None of these values are accepted from the request. The host then calls the exposed API registry with the entry's declared capability set and this access context. The registry checks the capability and returns the projection, or returns nothing. If nothing matches, the host returns a stable capability-denial result and does not fall back to a broader projection, a service token, or an undocumented path.

The registry's result is a live projection inside the kernel process. The host invokes the operation named in the request on that projection. The projection calls the actual service. The service sees a normal caller with a normal context and applies its own access policy, schema checks, workspace rules, history recording, and error handling. The host then copies the service's plain result back across the boundary.

This routing has two capability checks, not one. The import-level check decides whether the module may use the routed call at all. The registry check decides whether the entry's declared capabilities unlock the particular API and operation. The second check is the per-call authority check; the first is the structural check that lets the host refuse a module before it runs.

The registry must carry a serializable operation catalogue for each exposed API and capability. The catalogue names the operations the projection permits, the input shape, the output shape, and the capability that unlocks the entry. The host validates the request against the catalogue before invoking the projection and validates the response against the declared result shape after the call. The current registry does not yet carry this catalogue; adding it is a required implementation change, not an optional refinement. Without it, a routed call would be an unvalidated operation-name lookup against a live object, which this design rejects.

The host never passes a service token, service instance, broker, logger object, or live error object into the cage. It passes only the plain request and the plain result.

### 4.4 The shape of data that crosses

The boundary value domain is plain, copied, JSON-compatible data:

- null, booleans, finite numbers, and strings;
- arrays of boundary values;
- objects whose keys are strings and whose values are boundary values;
- no undefined, no callables, no closures, no callbacks, no promises, no symbols, no big integers, no dates, no maps, no sets, no typed-array views, no shared memory, and no cyclic references;
- binary data is represented as an encoded string, not a live buffer;
- object keys and string contents are UTF-8, and the maximum size, depth, and array length are bounded by the effective resource profile.

Every crossing is a copy. A cage cannot retain a reference into kernel memory, and a service cannot retain a reference into cage memory. If either side attempts to send a value outside the domain, the host fails the call closed with a stable serialization failure and does not deliver a partial value.

Errors cross as plain records with a stable code, a human-readable message, and a plain details value. The boundary never carries an exception object, a stack trace, a path, a service object, or a runtime diagnostic. The kernel-facing facade reconstructs the shape the kernel expects from the plain record, so callers see the same error contract they see from a Node entry. The host decides which stable code applies: capability denied, unknown API, unknown operation, schema violation, service failure, timeout, cancellation, serialization failure, resource exhaustion, or cage fault.

Long-running or streaming interactions use correlated plain messages, not callbacks and not live stream objects. A call may return an opaque continuation token as plain data; a later call presents that token to fetch the next bounded chunk. A cage cannot register a host callback, and a service cannot call back into a cage that is already inside a host call.

### 4.5 Concurrency, re-entrancy, deadlines, and cancellation

The host schedules calls asynchronously at the kernel boundary. Inside a WASM instance, an import appears synchronous, but the host owns the waiting, the deadline, and the cancellation. The host never enters the same cage while one of that cage's imports is still in flight. A re-entrant request to the same cage is either queued within the per-cage in-flight bound or refused as busy; it is never delivered as a nested call. This rule prevents the common deadlock where a service waits for a cage that is waiting for the service.

Every call inherits the caller's deadline and cancellation. When the deadline expires or the caller cancels, the host stops the cage execution, returns a stable aborted or timed-out result, and rejects every import attempted after the stop. Cancellation does not undo effects already committed through kernel services. The history service records those effects under its normal rules, and the caller must not assume atomicity beyond what the target service provides.

The host does not expose a callback registration import, a shared queue, a shared memory region, or a live event listener. Event handlers are declared exports, delivered as plain events, not callbacks.

## 5. The export contract

### 5.1 Manifest declarations

A caged entry declares its public surface in its manifest. The declaration is untrusted input and is validated by the host before it is used. The manifest declares:

- the entry identity, version, and boundary contract version;
- the entry's role: service, plugin, or both, consistent with the composition section that selected it;
- tools, each with a stable name, description, input schema, required caller permissions, and the export name that implements it;
- actions, with the same fields as tools;
- event handlers, each with the event kind or kinds it observes, an optional filter shape, and the export name that receives the event;
- service lifecycle exports, when the entry is a service: initialization, running, disposal, and any declared exposed API operations;
- plugin lifecycle exports, when the entry is a plugin: activation and deactivation;
- exposed APIs, each with the API name, the capability that unlocks it, and the operation catalogue that the host will register;
- the requested capability set and the import capabilities that support the declarations.

The manifest is not the source of ownership, official status, caller tier, or effective grants. Those are supplied by the kernel and the host. A manifest that claims them is not trusted.

### 5.2 Cross-checking the export section

The host compares the manifest's declared exports with the module's actual export section. Every declared tool, action, event handler, lifecycle hook, and exposed API operation must have a corresponding export with the boundary signature for its kind. A declared export that is missing refuses admission. An export that exists but is not declared is not registered, not reachable, and not exposed to any kernel registry. The host does not create a generic "call any export" path.

This rule is what makes the manifest the registration contract rather than a suggestion. It also means a module cannot hide a second entry point behind an undeclared export and hope the host will surface it. If an entry later needs a new export, it must be declared and the entry must be admitted again under the composition's rules; a running cage cannot add a hidden public surface.

### 5.3 How exports reach the kernel

On admission, the host returns a registration batch. The batch contains host-authored facades and declarations for the exports that the entry declared and the module actually provides. The loader registers that batch through the kernel's normal mechanisms:

- a caged service becomes a service facade with a token, dependencies, a userland tier, lifecycle hooks, and exposed API registrations;
- a caged plugin becomes a plugin facade with its validated manifest and lifecycle hooks;
- a caged tool becomes a tool registration owned by the entry, with official status false;
- a caged action becomes an action registration owned by the entry;
- a caged event handler becomes an event subscription owned by the entry;
- a caged exposed API becomes a registry entry whose projection is a host-authored closure that routes back to the cage.

The kernel's dispatch does not learn that a facade is caged. It resolves a normal token, a normal plugin, a normal tool, or a normal action. The host, not the kernel, holds the mapping from the facade to the cage handle and the export name.

### 5.4 How the kernel invokes a caged tool or action

The kernel's normal path applies first. The tool or action registry validates the payload against the registered schema, applies the caller's permission requirements, checks any allow-list or disabled state, and resolves the facade. The facade's execution handler then invokes the host's dispatch operation with the plain payload and the caller context. The host validates the payload again against the manifest's schema, selects the declared export, copies the request into the cage, runs it under the effective deadline and resource budget, validates the response envelope, and returns a plain result. The facade converts that plain result into the kernel's normal result shape.

The caller therefore sees the same sequence it sees for a Node tool or action: lookup, schema gate, permission gate, handler, result. The difference is only that the handler is a facade that crosses the boundary. A failed lookup, a schema violation, a permission denial, a handler failure, a timeout, or a cancellation produces the same stable result shape it would for a Node entry. A cage fault is normalized into the same failure shape; it does not crash the kernel or leak a runtime trace.

### 5.5 Event handlers

An event handler is an export, not a callback. The manifest declares the event kinds and filters the entry observes. On admission, the host subscribes to the kernel's event source on the entry's behalf and registers a facade subscription. When an event occurs, the kernel source delivers a plain event record to the host, and the host invokes the declared export with a plain event envelope. The handler may call kernel services through the routed call while it runs, under the same grants and limits as any other call.

Event delivery defaults to ordered per source and at most once per handler invocation. A handler failure is recorded and the event is not retried by default; a retry requires an explicitly declared idempotent handler and is a future contract decision. The handler cannot return a live acknowledgement object, register a follow-up callback, or hold the event source open. The final event catalogue, the ordering guarantees across sources, and the retry policy are open questions because the current kernel has no general event bus.

### 5.6 Boundary signature and result envelope

Every export has the same boundary signature: one length-delimited plain request envelope in, one length-delimited plain response envelope out. The host owns the copy into and out of the cage. The toolchain binding inside the entry maps that envelope to the language's callable surface; the host contract does not depend on the language.

The response envelope carries a status, plain data, an optional message, an optional plain error record, and a duration. The status set matches the kernel's normal result set: success, failed, aborted, skipped. The compiler or language runtime may have its own internal errors, but the host normalizes them into the stable boundary codes before the facade sees them. No runtime stack trace, memory address, or host path crosses the boundary.

## 6. The facade contract

The facade is the only thing the rest of the kernel sees. It is host-authored, kernel-facing, and never exposes the raw cage handle or runtime state. There is one facade shape for each kernel concept.

| Facade | What the kernel sees | What the facade must guarantee |
|---|---|---|
| Service | A normal service descriptor with a token, dependencies, a tier, an access policy, lifecycle hooks, and exposed APIs | Same dependency order, same lifecycle sequence, same access policy, same declared projection contract, same disposal order, same error shape. The caged service is registered at the userland tier; it cannot claim a higher tier. Q-09 records how custom projection logic is expressed. |
| Plugin | A normal plugin with a validated manifest and lifecycle hooks | Same manifest validation, same activation and deactivation order, same capability handles through the plugin context, same subscription disposal, same transport attachment contract. The plugin is never certified official. |
| Tool | A normal registered tool with a name, description, schema, required permissions, owner, and official status | Same schema gate, same permission gate, same lookup and duplicate rules, same result shape, same cancellation, same handler-failure normalization. The reader projection never exposes the raw execution handle. |
| Action | A normal registered action with a name, description, schema, owner, and dispatch behavior | Same schema gate, same lookup and duplicate rules, same result shape, same cancellation, same one-way registration semantics. No execution handle is exposed to plugins. |
| Event handler | A normal event subscription | Same event ordering within a source, same failure recording, same disposal. Delivery is a host call into the cage, never a callback held by the cage. |
| Exposed API | A normal registry entry with an API name, a capability, and a projection | Same capability check, same projection selection, same broker resolution, same caller context. The projection is host-authored and routes to the cage. |

The facade guarantee is precise: indistinguishability is per contract and per effective privilege. A caged entry is indistinguishable from a Node entry that carries the same public interface, the same owner identity, and the same effective privilege. The cage does not pretend to be more privileged than it is. A caged service can only be a userland service; a Node service at the same tier is its indistinguishable counterpart. A caged plugin is never official; a Node plugin at the same non-official status is its counterpart. The caller can tell the difference only where the kernel already exposes a privilege dimension, such as a tier or an official flag, and that dimension is the tier boundary rather than a cage-specific leak.

The facade must also guarantee that the cage cannot use the facade to escape its grant. A tool facade does not accept a service token from the cage. A service facade does not hand a live kernel object to the cage. An exposed API facade does not let the cage name a different caller or capability set. The facade is a narrow adapter, not a general proxy.

## 7. The registration contract

A caged entry that wants to register a new concept uses the same mechanisms as a Node entry. It does not get a cage-specific registry, a parallel plugin manager, or a private service container.

The registration requests it can make are:

- a service registration, when the entry's composition role is a service;
- a plugin registration, when the entry's composition role is a plugin;
- a tool registration, when the entry declared a tool and holds the registration capability;
- an action registration, when the entry declared an action and holds the registration capability;
- an exposed API registration, with its capability and operation catalogue;
- an operation-router kind claim, when the caged service's declared role permits it;
- an event-handler registration, from the manifest declaration;
- a child-load request, when the entry holds the loader capability.

A registration request is a plain record: the registration kind, the stable name, the schema, the export name that implements it, the required caller capabilities, the contract version, and an idempotency identity. The host validates the request against the effective grant, the manifest declaration, the module's export declaration, and the kernel's registration rules. It then calls the kernel's normal registration path. It returns a receipt or a stable failure.

The kernel supplies ownership. The owning identity is the entry's stable identity, or the child's scoped identity. The official status is derived by the kernel from the composition, never from the registration request. A caged entry cannot register itself as official, cannot brand a child, cannot mint a capability, and cannot create a second loader.

A registration batch is atomic from the entry's perspective. If one declaration in a batch fails, the host rolls back the declarations already applied in that batch, or reports the failure before any are applied. If activation later fails, the kernel's normal subscription disposal removes every registration the entry made. A caged entry must not be able to leave a half-registered tool, action, or exposed API behind after a failed activation.

The kernel's registries treat a caged registration exactly like a Node registration: the same duplicate rejection, the same name collision, the same boot registration window, the same freeze after boot, the same access policy, the same projection, the same ownership attribution, and the same disposal. The host may keep a private mapping from a kernel registration receipt to a cage export and a child identity. That mapping is invisible to the registry and does not change how the registry behaves.

The one exception is privilege. A caged registration is always non-official and always at the most restrictive tier the kernel's concept allows. A caged service is a userland service. A caged plugin's tools and actions are owned by a non-official plugin. A caged exposed API is subject to the registry's capability check and the service's own projection. This is not a cage-specific rule in the registry; it is the result of the host supplying a non-official, userland owner.

## 8. The composition contract

A caged entry may need to load its own children. An unofficial extension manager is the example: it is itself caged, and it wants to load extensions. The kernel must allow the concept without allowing the parent to promote its children out of the tier.

Loading code is a kernel capability with exactly one frozen holder, declared in the top-level composition. The holder may be a Node entry or a caged entry. A caged holder does not receive a raw instantiation primitive. It receives the child-load import. The kernel's loader, not the caged host, validates the request and performs the load.

A child-load request contains the child's source, proposed identity, manifest, requested capabilities, and requested resource profile. The kernel applies these rules:

1. The parent must hold the loader capability. Holding a general management capability is not enough.
2. The child is always caged. The child's own official flag, whether in its manifest or in a nested composition, is ignored and recorded. There is no path from a child request to the Node tier.
3. The child's effective grant is a subset of the parent's effective grant. A child may receive fewer capabilities, never more. A child does not automatically inherit the parent's loader capability; if it needs to load grandchildren, that capability must be granted explicitly and remains bounded by the parent's grant.
4. The child's identity is scoped under the parent's identity. The scoped identity is stable, unique, and used for ownership, attribution, history, and diagnostics. A child cannot act as the parent, and the parent cannot use the child to escape its own grant.
5. The child's resource profile is bounded by the parent's remaining family budget. A child cannot receive a larger budget than the parent can supply, and a family cannot exceed its aggregate limits.
6. A child cannot outlive its parent. Retiring the parent retires every child in reverse order, cancels in-flight calls, disposes registrations, and releases the family's resources. Unloading a child does not affect its siblings beyond the family budget.

The top-level composition is authoritative. If an identity is declared at the top level and is also requested as a child, the kernel loads the top-level entry once under its own tier and policy. A caged parent cannot cause a second, more privileged instance to exist. The exact behavior when a parent requests an identity that is also top-level — whether the parent receives a restricted view of the top-level instance or is refused — is a policy decision recorded as an open question. The invariant is that the parent never gains the top-level entry's privilege and never creates a duplicate.

There is no runtime promotion path. A child cannot become official because its parent is official, because it holds a loader capability, because it claims official status, or because it registers a new concept. The only way an entry becomes official is a new boot with a changed, protected top-level composition. This is the composition half of the tier boundary.

## 9. Resource limits

The host applies resource limits at four scopes. The kernel configures the limits; the host enforces them; the cage cannot read, raise, or bypass them.

| Scope | Limits |
|---|---|
| Admission | Module byte size, manifest size, import count, export count, schema size and depth, compile budget, validation budget, initial memory, maximum memory, table size, stack size, instance count. |
| Per call | Execution budget, wall-clock deadline, input byte size, output byte size, allocation growth, call depth, nested import count, serialization cost, event payload size, log volume. |
| Per cage | Concurrent in-flight calls, resident memory, aggregate execution budget over a window, event queue depth, registration count, open continuation tokens, child count. |
| Per family | Aggregate memory, aggregate execution budget, aggregate child count, aggregate registration count, aggregate event queue depth, aggregate continuation tokens. |

Admission limits are checked before the module runs. A module that exceeds a structural limit, or a module whose declared exports cannot fit the registration limits, is refused before instantiation. This includes the compile and validation work the host performs; a module cannot consume the kernel's whole boot budget by being expensive to inspect.

Per-call limits bound one export invocation. A call that exhausts its execution budget, misses its deadline, produces an oversized result, or recurses beyond the call-depth bound fails with a stable resource result. The cage remains alive unless the failure is terminal. The kernel sees a normal failed or aborted result, not a kernel crash.

Per-cage and per-family limits bound sustained behavior. A cage that repeatedly trips per-call limits, holds too much memory, floods events, or accumulates registrations is quarantined or retired according to the composition's policy. Retirement removes its facades, disposes its registrations, cancels its in-flight calls, and cascades to its children. If the cage was part of boot, the boot fails under the kernel's normal rollback. If it was loaded at runtime, the parent receives a stable retirement result and the rest of the kernel continues.

The effective profile is frozen at boot. A default profile applies when the composition does not override it, and a per-entry profile may narrow the default. A child profile narrows the parent's remaining family budget. The host does not accept a limit change from a cage, a service, or a runtime child request. Only a new boot with a changed protected composition can change the profile.

Resource exhaustion does not roll back effects already committed through kernel services. If a caged entry wrote a file through the file service before its execution budget expired, the write is recorded by the history service under the normal rules. The facade reports the resource failure, and the caller must not assume atomicity beyond the guarantee of the service it called. This is consistent with the kernel's existing operation semantics; the cage does not add a transaction boundary that the services do not have.

The host reports usage in the boot trust report and in diagnostics. It does not expose a "remaining budget" query to the cage, because that would be a host-control import; the cage learns about exhaustion only through a failed call. The kernel may use the report for quarantine decisions and for the operator-visible trust report. The exact accounting of compile time, instantiation time, and runtime time depends on the chosen runtime; that dependency is recorded in section 14.

## 10. The tier boundary

The cage's promise is stated as a contrast, not as an aspiration. An official Node entry and an unofficial caged entry differ in the following ways, and the difference is enforced by the loader, the host, and the existing kernel access policies.

| Dimension | Official Node entry | Unofficial caged entry |
|---|---|---|
| Runtime | In the kernel process, through Node's module system | In the WASM host, in an isolated instance |
| Ambient authority | Full Node and operating-system authority; it can bypass kernel services entirely | None beyond the explicit host imports and runtime support |
| Kernel access | Direct service instances and the access broker, subject to access policies | Only the routed call, through the exposed API registry, with a host-constructed userland caller |
| Capabilities | Ambient authority plus declared permissions | Only the effective grant; no implicit capability |
| Official status | Selected only by the top-level composition | Never; the composition can only load it as caged |
| Loader role | May be the single frozen loader if the composition declares it | May load children only through the child-load import, with attenuated grants and family limits |
| Code loading | Node module resolution and dynamic import | Only loader-gated WASM children, always caged |
| Configuration | Trusted with the process; composition authority and integrity are separate controls | Cannot read or write the composition except through a granted service, and cannot change tier |
| History | The full history surface when official and granted | A namespaced history handle when granted; never the universal human history surface |
| Process and memory | Shares kernel memory and process lifetime | Isolated linear memory and a host-managed lifetime |
| Failure | Can terminate or corrupt the kernel process | Traps into a stable facade failure; cannot corrupt kernel memory |
| Dynamic code and native addons | Available to the trusted process | Dynamic code inside the language runtime may exist but gains no host authority; native addons are not available |
| Environment and secrets | Available to the trusted process | Not available |
| Terminal | Can spawn processes directly and can use the terminal service; policy binds only service-mediated calls | Real operating-system commands only through a granted terminal service, subject to policy; the child process is not sandboxed by the cage; see section 11 |
| Observability | Normal logs and diagnostics | Routed through the host and kernel services; no raw runtime internals |

The promise is conditional and exact. If a capability is not granted, there is no import that reaches it. If a capability is granted, the service sees a normal caller and applies its own policy; the cage does not amplify the grant, cannot impersonate another caller, and cannot use the capability to acquire a different one. The cage is an authority boundary, not a content filter. It does not make hostile code harmless; it limits what hostile code can reach.

The tier boundary is also a statement about what the kernel does not have to know. The kernel does not know what a plugin is, what an extension is, or what a caged entry's internal concept model looks like. It knows a service, a plugin, a tool, an action, a caller, a capability, and a tier. The cage inherits the kernel's concept-agnosticism: any new concept an entry invents is registered through the same mechanisms and inherits the same tier.

## 11. What the cage does not cover

The terminal service is the known gap. A caged entry granted terminal execution can still cause real commands to run on the host operating system. WASM confines the entry's own instructions, but it does not sandbox the child process that the terminal service starts. A command that passes the kernel's policy can write outside the workspace, read outside the workspace, or affect the host in ways the cage never sees. Granting terminal execution to a caged entry therefore grants real operating-system execution authority through a mediated service. It is not terminal isolation, and this design does not provide terminal isolation. Terminal isolation requires a separate operating-system-level sandbox, which is outside this document and outside the security architecture document's scope as well.

The cage also does not cover:

- bugs in host imports, including path traversal or argument confusion in a service call, which can turn a narrow grant into a wider effect;
- over-granting, where an entry is given capabilities broader than its purpose and uses them legitimately but harmfully;
- compromise of official Node code or its dependencies, which runs with full authority;
- bugs in the WASM runtime, the compiler, the language runtime, or the toolchain binding;
- side channels such as timing, memory pressure, or shared caches, which this design does not attempt to close;
- the accepted same-user risk recorded in the security architecture document, which a cage inside the same process cannot defend against;
- the trust root for the official flag, integrity pins, and publisher signatures, which is a separate architecture decision;
- availability beyond the configured resource bounds, since a cage can still consume its full budget and can still be used for a bounded denial of service;
- debugging and introspection of caged code, which is intentionally less capable than debugging official code;
- the correctness or safety of the service semantics behind an import, which remain the service's responsibility.

The cage is a confinement mechanism for unofficial authority. It is not a verification system, a malware detector, or a replacement for reviewing what capabilities an entry is granted.

## 12. Production-mirror implementation constraint

Every future implementation task derived from this design must produce production-mirror tests. This is a design constraint, not a testing preference. It applies from the first line of implementation code and is not satisfied by unit tests with stand-ins, hand-written fakes, or mocked boundaries.

A production-mirror test for this design uses real WASM modules, the real kernel, the real configuration, and a real workspace. It does not mock the loader, the host, the import router, the facade, the registries, the services, or the file system. A test that replaces any of those with a fake is not a production-mirror test for this contract, even if it is a useful unit test elsewhere.

The implementation task must cover at least these contracts with production-mirror tests:

- the loader's tier decision for official, non-official, absent, and false configuration flags, including a module that claims official status in its own manifest;
- admission refusal for an ungranted import, an unknown import, an undeclared export, a missing declared export, an unsupported contract version, and a shared-state import, with proof that the module was not instantiated;
- the routed call through the real exposed API registry, including capability denial, unknown API, unknown operation, schema violation, service failure, timeout, and cancellation;
- the facade contracts for service, plugin, tool, action, event handler, and exposed API, including result shape, error shape, lifecycle order, registration collision, freeze window, and disposal;
- the registration contract, including ownership, non-official status, atomic rollback, and the absence of a cage-specific registry path;
- the composition contract, including a caged parent loading a child that claims official status, a top-level conflict, attenuated grants, family resource limits, and revocation cascade;
- the resource limits at admission, per call, per cage, and per family, including memory, execution budget, deadline, output size, and quarantine or retirement behavior;
- the serialization boundary, including rejected live objects, rejected callbacks, rejected cycles, and rejected oversized values;
- the terminal gap, either as an explicit non-claim or as a test that terminal execution remains mediated by the real terminal service and is not sandboxed by the cage.

The implementation task is not complete until those tests run against real components and pass, or until a failure is reported as a real gap. A mock that makes the contract appear satisfied is a failure of this constraint.

## 13. Reported conflicts, assumptions, and dependencies

No direct contradiction with a decided security-architecture decision was found. The security architecture document decides the local channel, and this design stays inside the daemon and consumes its principal and capability decision. The following are reported as gaps, assumptions, or dependencies rather than silently resolved.

| Item | Type | Status |
|---|---|---|
| The trust-tier direction is an exploratory proposal, not a formal decision record; the security architecture document refers to it but does not ratify it. | Architecture decision gap | This design depends on ratification. Reported as an open question. |
| The security architecture document places configuration content and composition outside its scope, including which components are official. | Scope gap | This design consumes the composition's authority and does not claim the security document decided it. |
| The security architecture document accepts the same-user attacker risk. | Accepted risk, inherited | The cage does not defend against a process with the same operating-system authority. |
| The current composition carries only a source locator and an optional official flag. | Current-kernel assumption | The loader contract requires integrity, grant, resource profile, and manifest inputs; their composition representation is open. |
| The current loader has no WASM path and imports every entry through Node. | Current-kernel assumption | The design specifies a target path; implementation must add it. |
| The current exposed API registry has no serializable operation catalogue. | Current-kernel assumption | The routed call requires one; adding it is a required implementation change. |
| The current plugin manifest has no tool, action, event, or exposed API declarations. | Current-kernel assumption | The export contract adds them. |
| The current kernel has no general event bus. | Current-kernel assumption | Event handlers are specified, but the event catalogue and source are open. |
| The current kernel has no single frozen loader capability. | Current-kernel assumption | The composition contract specifies it; implementation must add it. |
| The current kernel has no WASM runtime or resource metering. | Current-kernel assumption | The host and resource profiles are new infrastructure. |
| The official flag's trust root, integrity pin, and publisher signature are not decided here. | Architecture decision gap | The loader consumes a verified entry; the trust root is a separate decision. |
| The chosen WASM runtime's behavior affects import inspection, execution budgets, memory limits, trap recovery, and language-runtime support. | Runtime dependency | Recorded as an open question. |
| The terminal service has no operating-system sandbox for caged commands. | Known gap | The cage does not solve terminal isolation. |
| A caged service cannot occupy a tier above userland without defeating the tier boundary. | Design consequence | The facade registers caged services at userland; a Node service at the same tier is the indistinguishable counterpart. |

## 14. Open questions

The following decisions belong to a future task. This design does not resolve them, and an implementation task must not assume an answer that is not recorded here.

**Q-01 — Trust-tier ratification.** Is the exploratory trust-tier direction formally adopted as architecture: official entries run in Node with full authority, and all unofficial entries run in the WASM cage? Until this is ratified, this interface has no architecture-level authority to enforce tier selection.

**Q-02 — Trusted grant source.** Where does the effective capability grant live: in the top-level composition, in a signed package manifest, in a kernel policy, or in a combination? The design requires a trusted grant independent of the entry's own request, but does not choose its storage or review workflow.

**Q-03 — Official-flag trust root.** How are the official flag, the integrity pin, the package identity, and publisher signatures authenticated? The loader must verify an entry before either tier, but the trust root, the required pinning depth, and the update approval flow are not decided here.

**Q-04 — Operation catalogue ownership.** The routed call needs a serializable operation catalogue for every exposed API and capability. Does that catalogue belong in the exposed API registry's registration record, in a companion advertisement beside the registry, or in the declaring service? How is it versioned, and how does a caged service declare it without exposing live objects?

**Q-05 — Boundary ABI.** Does the host use core WASM modules with the host-defined length-delimited envelope described here, or the Component Model and its interface format? The choice affects the manifest, the export signature, the language bindings, and the runtime support set.

**Q-06 — Async, promises, and re-entrancy.** How do the approved language runtimes represent asynchronous host calls, promises, and event delivery while preserving the no-callback and no-same-cage-reentry rules? Is a caged call allowed to suspend and resume, or is each export invocation a bounded synchronous turn with host-owned continuation tokens?

**Q-07 — Event catalogue and delivery guarantees.** Which kernel events are observable to a caged entry, what is the ordering guarantee across sources, is delivery at most once or at least once, and when is retry permitted? The current kernel has no general event bus, so this is both a contract and an implementation gap.

**Q-08 — WASM runtime behavior.** The design depends on the runtime's answers to at least these questions: can imports be inspected and refused reliably before instantiation; is the execution budget deterministic and cross-platform; are memory limits enforced at instantiation and during growth; is an instance reusable after a trap or must it be retired; what runtime support does the approved language toolchain require; how are compile time and instantiation time bounded; and are instances fully isolated from one another? These are Wasmtime-behavior dependencies, not decisions this document can make.

**Q-09 — Caged service projection and tier.** How is a caged service's custom projection represented when all it can return is plain data? Is a declarative operation set enough, or does the projection need a host-mediated projection call? Can a caged service ever occupy a tier above userland without defeating the access policies that use tier as a privilege signal?

**Q-10 — Composition representation and defaults.** What are the exact composition fields for a caged entry: manifest location, grant set, resource profile, contract version, and module format? Can one entry appear in both the service and plugin sections? What are the default grants and default resource profiles when the composition omits them?

**Q-11 — Top-level versus child identity.** When a caged parent requests an identity that is also declared at the top level, does the parent receive a restricted view of the top-level instance, or is the request refused? The invariant is that the parent cannot create a second, more privileged instance; the policy is open.

**Q-12 — Resource-failure semantics.** Does a trap retire the cage or only fail the call? Are effects already committed through kernel services reversible by the host, or only by the history service? What stable result does the caller see, and what does the parent see when a child is retired for resource exhaustion?

**Q-13 — Observability and redaction.** Which host diagnostics, resource summaries, and runtime failure details are visible to the boot trust report, to the parent entry, and to logs? What must be redacted so a caged entry cannot learn host paths, service internals, or another entry's data through a diagnostic?

**Q-14 — Terminal isolation timing.** Does a caged entry ever receive terminal execution before an operating-system-level terminal sandbox exists, or is terminal execution withheld from the cage until that sandbox is designed? This design records the gap but does not decide the deployment policy.

These questions are decisions for the architecture and the implementation tasks that follow. They are not implementation details that this document may silently choose.