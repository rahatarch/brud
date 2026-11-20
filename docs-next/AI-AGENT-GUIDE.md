# Guide for AI agents

You are about to write code on BrudOS. Read this first, it is short.

## Read in this order

1. [What is BrudOS](01-introduction/what-is-brudos.md) and [Core ideas](01-introduction/core-ideas.md)
2. [Your first participant](02-getting-started/your-first-participant.md)
3. [Concepts](03-concepts/README.md), at least pages 1 to 6
4. [Cheat sheet](07-reference/cheat-sheet.md)

## Facts that prevent mistakes

- Every API belongs to a **giver**, who decides who gets it. Never assume access.
- `resolve` returns `null` for both "missing" and "refused". Handle both.
- Use handles inside the call that produced them.
- Never mark something `official` on your own initiative. Only the owner decides.
- Do not invent exposure names or manifest keys. The valid keys are `requests`, `exposures`, `events`, `interceptions`, `interceptionPoints`, `kinds`.
- Startup options belong in your own dotted namespace.
- The composed services are separate packages and out of scope. This guide covers `@brud/kernel`, `@brud/protocol`, `@brud/sdk` and `@brud/daemon`.

## Verified examples

Everything in [`examples/`](examples/README.md) runs as written. Copy from there rather than from memory. Test with `bootTestKernel` ([guide](02-getting-started/test-your-participant.md)).

## Exact API listings

Generated reference: [`docs/kernel-api`](../docs/kernel-api/README.md). Prefer it over guessing signatures.
