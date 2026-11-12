# Brud OS Q-02: Request, Not Grant

Nov 12, 2026 · @Rahat Hasan

**Status.** Decided. This document is the architecture decision record for the capability grant model. It answers Q-02, the trusted grant source question recorded by the WASM host interface document. It decides that a participant's declaration of what it wants is a request, not a grant, and that the giver — the service that exposes the API — decides what the participant receives. It is not an implementation guide. The decision is settled and is recorded here without alternatives. Decided 2026-11-12.

## Purpose and scope

Every participant declares what it wants. The kernel needs a rule for whether a call is authorized. This document decides the rule: the declaration is a request, not a grant; the giver decides; the kernel routes the request and enforces the giver's answer.

The document records the decision, what it means, what it does not do, why it was chosen, how it relates to the companion records, and what remains an implementation task. It governs the authority a participant receives from a service. It does not decide the scope rules, the identity model, or the daemon's client boundary; those belong to the companion records.

## Decision register

| ID | Decision |
|---|---|
| Q02-01 | Every participant's declaration of what it wants is a request, not a grant. |
| Q02-02 | The giver is the service that exposes the API. The giver decides what the participant actually receives. |
| Q02-03 | The participant's identity token carries no capabilities by itself. The token is identity, not authority. |
| Q02-04 | When a participant calls an exposed API, the kernel determines the giver and asks whether the caller's token, with its declared request, satisfies the giver's policy. |
| Q02-05 | The giver's decision is final. The kernel routes the request and enforces the answer. The participant receives only what the giver granted. |
| Q02-06 | The operator declares the giver's policy in the configuration. The service enforces it. The kernel routes and enforces. |
| Q02-07 | A manifest declaration never self-grants. The configuration alone does not grant. The kernel does not substitute its judgment for the giver's. |
| Q02-08 | The giver's policy may differ per capability, per scope, per origin class, per official status, and any other dimension the giver chooses. |

## 1. The decision

The declaration is a request. The giver decides. The giver is the service that exposes the API. The participant's identity token is identity, not authority. When a participant calls an exposed API, the kernel determines the giver, supplies the caller's verified identity and declared request, and the giver's policy decides whether the call is granted. The kernel enforces the answer.

The operator declares the giver's policy in the configuration. The service enforces that policy. The kernel routes the request and enforces the service's answer. The participant receives only what the giver granted.

## 2. What it means

**The manifest declares a request.** A participant's manifest declares the capabilities it wants, such as a filesystem write capability or a tool execution capability. That declaration is a request. It states what the participant asks for; it does not state what the participant has.

**The token carries no capabilities.** The participant's identity token identifies the participant and binds it to verified contents. It does not carry a capability set, and it does not authorize a call by itself. The token is the identity the giver evaluates; it is not the grant.

**The kernel determines the giver.** The giver is the service that exposes the API. The kernel identifies that service and routes the request to it. The kernel does not decide the capability policy on the service's behalf.

**The giver answers the question.** The kernel asks the giver whether the caller's token, with its declared request, satisfies the giver's policy. The giver's policy states what capabilities are required for what API and what the giver will grant given the caller's identity and declared request.

**The giver's decision is final.** The kernel enforces the giver's answer. It does not upgrade a denial, override a grant, or substitute its own judgment. The participant receives only what the giver granted.

**The policy may vary.** The giver's policy may differ per capability, per scope, per origin class — kernel, runtime, or host — per official status, and any other dimension the giver chooses. Equal capabilities do not imply equal treatment across givers or across callers.

**The configuration declares the policy; the service enforces it.** The operator writes the giver's policy in the configuration. The service applies that policy to each call. The kernel routes the request and enforces the service's answer. The configuration is the policy declaration, not a blanket grant.

## 3. What it does not do

**It does not allow the participant to self-grant.** The manifest's declaration is a request. A participant cannot declare its way to more authority. It can only ask.

**It does not allow the configuration alone to grant capabilities.** The configuration declares the giver's policy. The giver enforces that policy against each call, using the caller's identity and declared request. A configuration entry that names a capability is not, by itself, a grant to every caller.

**It does not allow the kernel to substitute its own judgment for the giver's.** The kernel routes the request to the giver. The giver decides. The kernel enforces the decision; it does not make a different one.

**It does not treat all participants equally.** The giver's policy can differ per capability, per scope, per origin class, per official status, and any other dimension the giver chooses. A policy that treats two callers differently is a policy decision the giver is entitled to make.

**It does not decide scope reachability.** Scope decides which origin may reach an API identity. Q-02 decides whether a caller that can reach the API is granted. The scope check, the capability requirement, and the giver's policy are three separate checks, and all three apply.

**It does not decide the policy language, the capability vocabulary, or the configuration schema.** Those are implementation tasks. The decision is who decides, not how the policy is written.

## 4. Why request-not-grant

**It matches the model of everything as a service with exposed APIs.** The service exposes the API. The service owns the policy. The service decides. The grant belongs with the party that owns the surface.

**It prevents self-escalation.** A participant can declare what it wants, but the declaration is not authority. The giver decides whether to grant it. A participant cannot turn a request into a grant by writing it in a manifest.

**It scales.** Every service owns its own policy. The kernel does not need to know every API, every capability, and every policy. It routes the request to the giver and enforces the answer. A new service can define its own policy without changing the kernel's decision logic.

**It matches what the universal exposed API model already assumes.** The universal model's declaration carries the capability requirement and the policy, and its policy decides which capable callers are granted. Q-02 formalizes the policy side: the giver owns the policy, the manifest is a request, and the token is not authority.

**It makes the decision accountable.** The service that exposes the API makes the grant decision. A grant or a denial is attributable to the giver whose policy produced it, not to a manifest that asked for it and not to a kernel that routed it.

## 5. Relationship to the companion records

**Security architecture.** The security architecture authenticates the daemon's callers and fixes the principal at the daemon's client boundary. That is the channel's authority. Q-02 is inside the kernel: it governs what a participant receives from a service. A caller can be correctly authenticated and still be denied by the giver. The two decisions compose; neither replaces the other.

**Kernel identity.** The kernel identity record decides who a participant is and binds the token to verified contents. It states that the token is identity, not authority, and that the kernel provides mechanisms while services interpret concepts. Q-02 supplies the missing grant model: the token is the identity the giver evaluates, and the giver's policy decides the authority.

**Plugin identity.** The plugin identity record applies the identity model to plugins. A plugin's token identifies the plugin. Its manifest's declared permissions are a request. Q-02 governs what the plugin actually receives: each giver applies its own policy to the plugin's token and declared request. A plugin's identity does not carry a capability grant.

**Universal exposed API model.** The universal model decides that every API identity declares its name and version, the capability required to reach it, its scope, and its policy. Q-02 formalizes the policy and grant side of that declaration: the giver owns the policy, the manifest's declaration is a request, and the token is not authority. The universal model's scope remains the reachability rule; Q-02's giver decision is the grant rule. Both checks apply to a call.

**WASM host interface.** The WASM host interface records Q-02 as the trusted grant source question. This document answers it: the manifest's declared capabilities are a request; the giver's policy is the grant; the operator declares the policy in the configuration; the service enforces it; the host routes the request to the service and the service decides. The host does not grant. Its routed call supplies a request and a non-official identity, and the target service applies its own policy.

## 6. Open dependencies

The grant model is decided. The following are implementation tasks, not open questions.

- **The policy declaration format.** How a giver's policy is written, how capabilities and APIs are named in it, and how a caller's declared request is represented are implementation tasks.
- **The giver's enforcement mechanism.** How the service applies its policy to a call, what it returns on a denial, and how it distinguishes a missing capability from a policy refusal are implementation tasks.
- **The configuration's per-service policy declaration.** The exact way the operator's configuration attaches a policy to a service, and how that policy is validated and protected, is an implementation task.
- **The kernel's giver resolution and request forwarding.** How the kernel identifies the giver for an API identity and forwards the caller's identity and declared request is part of the route-and-enforce implementation.

## 7. The rule

The declaration is a request. The giver decides. The token is identity, not authority. The operator declares the policy; the service enforces it; the kernel routes and enforces the answer. A participant receives only what the giver granted.