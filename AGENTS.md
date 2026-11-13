# Instructions for AI Agents Working in This Repository

Read this file at the start of every session and follow it.

The full architectural rules are in [ARCHITECTURE_RULES.md](ARCHITECTURE_RULES.md). This file's binding architectural rule, the kernel-independence rule below, is also recorded there.

## Binding Architectural Rule: Design the Kernel Independently of Every Other Component

The kernel, the daemon, and the hardcore services are designed independently of every other component. No component outside the kernel — not an official service, not an official plugin, not the UI, not a daemon client, not anything that runs on top of the kernel — may shape the design of a kernel primitive.

When designing anything that lives in the kernel, the daemon, or the hardcore services, design it on its own terms: what must be true, what must never happen, what boundaries exist, what properties must hold for any participant.

Do not look at the current official components to decide what the primitive should be. Do not narrow the primitive to fit the components that exist today.

If the current official components already conform to the primitive as designed, the platform is flexible and the design is right. If they do not conform, the components are wrong, not the kernel.

The test for any kernel-side design decision is: does this serve any conforming participant, or does it serve these specific participants. If it serves only the specific ones, the design is wrong and the primitive must be corrected, not the reverse.

### Failures This Rule Prevents

Designing kernel behavior around a current plugin or a current service because it is convenient is a failure of this rule. So is adding a kernel surface because one component needs it. So is narrowing a capability grant model to the shape one component uses. So is anchoring a trust root to a component's identity rather than to the participant properties the primitive defines. So is letting a component's limitations dictate what the kernel supports. Each of these is a failure of the rule, even when the component in question is official.

### Consequences for Official Components

When the kernel changes on its own terms, official components adapt to the kernel. When an official component needs something the kernel does not provide, the answer is not to add it to the kernel for that component. The answer is either that the component does not need it, or that the primitive genuinely requires it for any conforming participant. In the second case, the kernel change stands on its own reasoning, not on the component's need.
