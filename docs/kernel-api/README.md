# BrudOS Kernel API — documentation for external builders

Everything a third-party participant needs to build on the BrudOS kernel and its seven hardcore primitives.

| Section | What it is | How it is produced |
|---|---|---|
| [`guides/`](guides/) | Concepts, how to write a participant, and how each primitive behaves | Written by hand (the parts types cannot express) |
| [`reference/`](reference/README.md) | The full type reference of every contract package: interfaces, types, errors, tokens | **Generated** by TypeDoc from the source and its doc comments |
| [`catalogue/`](catalogue/) | Tables of runtime facts: [hardcores](catalogue/hardcores.md), [mechanism exposures](catalogue/exposures.md), [manifest keys](catalogue/manifest.md), [error codes](catalogue/error-codes.md), [observation events](catalogue/observations.md) | **Generated** by [`tools/generate-catalogue.ts`](tools/generate-catalogue.ts) from the kernel's own runtime data |

Start with [Concepts](guides/concepts.md), then [Writing a participant](guides/writing-a-participant.md), then [The seven primitives](guides/primitives.md).

## Regenerating

```bash
npm run docs:api
```

This runs TypeDoc ([`typedoc.json`](typedoc.json), with `typedoc-plugin-markdown`) over the builder-facing contract entry points only, then the catalogue generator. Never edit `reference/` or `catalogue/` by hand; change the source (doc comments, descriptors, error classes) and regenerate. Run it after any change to a contract, a descriptor's exposures, an error class, or an observation name.

## Import paths

- `@brud/kernel` — kernel contracts (`ParticipantManifest`, `ServiceDescriptor`, `createServiceToken`, `bootKernel`, …), the Identity Registry, and the Exposed API Registry (`ExposedApiRegistryToken`, `withExposureBindings`, …).
- `@brud/kernel/services/<Primitive>/index.js` — the other primitives' contracts (`Events`, `Interception`, `Parser`, `Router`, `WasmCage`).

Builders import contract and type packages only; every call goes through an exposed API, decided by the giver and enforced by the kernel (`ARCHITECTURE_RULES.md`).
