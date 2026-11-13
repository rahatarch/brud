# Brud Architectural Rules

This file is binding. It applies to every contribution, human or agent. It records the architectural business decisions that the system must never stop satisfying, and how those decisions resolve, so that a new contributor can understand the system's invariants before changing it. ARCHITECTURE.md describes what the system is. This file records what it must never stop being.

This file records business decisions and how they resolve. It contains no implementation status, no code, no file paths, no line numbers, no function or class names, no language-specific content, no ledger citations, and no statements about the current state of the code, the current work, or the current task. A change that would add any of these to this file does not belong here and must be rejected. This rule is part of the file and protects it against that mistake.

## A primitive is universal only if any participant can use it with zero barrier and an identical result

A primitive is universal if a third-party participant the Foundation has never seen can use it with zero barrier and receive an identical result to what a Foundation service receives. Universal primitives are published by the Foundation and are the only primitives that belong in the kernel. A primitive that hardcodes anything about today's participants, today's services, or today's composition is not universal.

The test for universality has four questions, asked of each primitive in turn. First, can a third-party participant we have never seen use this primitive with zero barrier? Second, does the result that participant receives match the result a Foundation service receives? Third, is anything about the primitive shaped by a specific participant that exists today? Fourth, if the primitive were used by a participant that does not exist today, would it still work without change?

If the barrier is zero, the result is identical, nothing is shaped by a specific participant, and a future participant would still work without change, the primitive is universal. If any of those fails, it is not universal, and it does not belong in the kernel.

The rule applies to every primitive in the codebase, not only to what is in the kernel today. A primitive that is not universal may still exist, but it belongs to the participant that owns it, not to the Foundation.

## Composition is the unit

Every rule in this file applies relative to a composition: one kernel, one config, one product owner, one boot. BrudOS is one composition. Every system built on BrudOS is another.

The terms official, hardcore, trust, and root are all relative to a composition. There is no global authority over any of them except the Brud Foundation's compile-time decision about what counts as hardcore.

## The kernel is designed independently of every other component

The kernel, the daemon, and the hardcore services are designed independently of every other component. No component outside the kernel may shape the design of a kernel primitive.

When designing anything that lives in the kernel, the daemon, or the hardcore services, design it on its own terms: what must be true, what must never happen, what boundaries exist, what properties must hold for any participant. Do not look at the current official components to decide what the primitive should be. Do not narrow the primitive to fit the components that exist today.

If the current official components already conform, the platform is flexible and the design is right. If they do not conform, the components are wrong, not the kernel.

## The kernel's boundary is its own folder, not the platform it runs on

The kernel's universe is defined by repository code, not by the platform it runs on. The Node.js platform is inside the kernel's universe. Node builtin imports are not reaches outside the kernel folder.

Everything the kernel's own package declares as its content, and everything that lives inside the kernel folder, is inside the kernel's universe. Everything else in this repository is outside.

The rule that the kernel knows nothing outside its own directory refers to repository code and outside packages. It does not refer to the platform the kernel runs on, and it does not refer to host-supplied values a composition passes to the kernel at boot.

The kernel does not know which packages exist outside its folder. It does not name them, import them, reach into them, or look them up. The kernel knows only what lives inside its own folder and what is handed to it by the host as a value.

## The kernel has zero capabilities on its own

Everything is a service. There is no functionality inside the kernel that is not a service. The kernel's job is to route, enforce, and hold the invariants; the capabilities are the services.

## Hardcore services are Level-1 services, not part of the kernel

Hardcore services are Level-1 services. They are called hardcore because they are hardcoded so that no one can simply remove them, and the kernel refuses to boot without them. That is the entire meaning of hardcore.

Their location alongside the kernel is a directory convention — they ship with the kernel as non-removable defaults — not an absorption into the kernel package.

## Hardcore is not the operator's choice; official is

Hardcore is decided by the Brud Foundation and compiled into the kernel release. Every composition gets the same hardcore set. A product owner cannot remove, replace, or re-pin a hardcore service, and the kernel refuses to boot without each one.

Official is decided by the product owner of each composition in that composition's own frozen config. The two are independent: hardcore is the floor the Brud Foundation guarantees for every composition; official is what each composition's owner declares on top of that floor.

## No participant calls another participant through direct imports

Only contract and type packages may be imported. Every call goes through an exposed API, decided by the giver, enforced by the kernel.

## Every participant declares what it wants; the giver decides

Every participant declares what it wants. That declaration is a request, not a grant. The giver — the service that exposes the API — decides. The identity token is identity, not authority.

## The kernel routes every call to the giver and enforces the giver's answer

The kernel routes every call to the giver and enforces the giver's answer. It does not decide policy on the giver's behalf.

## The trust root for package contents is a content hash

The trust root for package contents is a SHA-256 content hash. There are two kinds of pins, and they belong to different authorities.

Hardcore pins are compiled into the kernel release by the Brud Foundation, so every composition gets the same root primitives; a product owner cannot remove, replace, or re-pin them. Official composed package pins are set by the product owner of each composition in that composition's frozen configuration.

In both cases, there is no publisher signature, no marketplace, and no external trust chain. The act of pinning — compiled into the kernel for hardcore, configured by the composition's owner for official composed — is the trust decision.

## Official status is a per-composition declaration

Official status is a per-composition declaration, made by the product owner of that composition in that composition's frozen configuration. The BrudOS repository declares its own officials for its own composition; it does not declare officials for anyone else. No package carries official as an intrinsic property.

The @brud scope is reputation, not authority: it indicates the package was made by the Brud Foundation team, and it does not confer official status. A product owner decides, in their own configuration, which packages are official in their system, @brud-scoped or not.

Official status is conferred by the composition's owner at boot, verified by content hash, and enforced through the brand mechanism. It is never conferred by a naming convention, a tier, a scope, or a manifest field that any package can set on its own.

## Code the composition has not declared official runs only inside the WASM cage

Code the composition has not declared official runs only inside the WASM cage. The cage is the isolation root primitive: no such participant executes outside it, and the cage cannot be disabled by configuration.

The composition's declaration of official is what determines whether a participant runs caged or uncaged, not who authored the code. A package authored by the Brud Foundation may be official in one composition and not in another. A package authored by a third party may be official in one composition and not in another.

What matters is what the composition's owner has declared, in that composition's frozen configuration, verified by content hash, and enforced through the brand mechanism.

## A root primitive is one that nothing else can exist without

A root primitive cannot depend on what it is meant to resolve. Identity is the identity primitive. ExposedApiRegistry is the resolution primitive. The WASM cage is the isolation primitive. Hardcore is where root primitives live.

## The kernel boot is one sequence

Hardcore services construct and initialize before composed services. If a hardcore service is missing or broken, composed services never start. If a composed service fails, everything rolls back and the boot fails.

Admission and initialization fail differently, by design. During admission, a service or plugin that nothing depends on, and an unofficial plugin, are pruned and boot continues. During construction and initialization, any failure rolls back every service that had already initialized, hardcore included. Admission decides what participates; initialization decides whether the participating set can complete.

## Every exposed API declares a scope

The scope of an exposed API determines which callers may reach it. There are four scopes, and they are defined by the caller set they admit, not by a linear order. Kernel admits callers from inside the kernel. Runtime admits callers from inside the runtime. Host admits callers from outside the runtime. Any admits every caller.

Kernel is contained in runtime and in host. Runtime and host are each contained in any. Runtime and host are not comparable to each other, because they admit different kinds of caller rather than a subset of one another.

Widening means the new scope admits every caller the old scope admitted. A scope may be widened within a major version, and the widening is recorded. A scope may never be narrowed within a major version. A change between runtime and host is a narrowing, because each admits callers the other does not, even though neither is a subset of the other in a simple line.

The default scope is kernel. Scope is enforced against the root origin of the call chain, not the immediate caller.

## Tools are for AI; actions are for humans

Tools are AI-callable operations. Actions are human-only operations. The classification is a property of the operation, enforced at dispatch, not a hint.

## The operator's configuration is frozen at boot

A config change during a running kernel is refused. A config change between boots is a new trust decision.

## Identity is issued by the kernel

Identity is issued by the kernel and bound to verified contents. It is never declared by a participant. Every subsystem keys by the identity token, not by a manifest identifier, a package name, or a display label. A participant whose identity cannot be established does not run.
