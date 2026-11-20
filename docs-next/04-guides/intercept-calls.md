# Intercept calls

**Goal:** log or block calls to `acme.greet`.

1. **Giver:** add `interceptionPoints: [{ exposure: 'acme.greet', version: 1, admit: [AuditorToken] }]`, and call `evaluate.evaluate(...)` in the projection before running the real method.
2. **Interceptor:** add `interceptions: [{ target: 'acme.greet', version: 1 }]` and an `intercept(call)` method returning `allow`, `block` (with `reason`) or `modify` (with `args`).

Remember: a thrown error blocks, the first block wins, and a giver that opens no point cannot be intercepted. Full semantics: [Interception](../03-concepts/interception.md).
