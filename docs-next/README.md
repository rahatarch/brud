# BrudOS documentation (V1-Beta draft)

BrudOS is a small, domain-neutral kernel for building software out of independent pieces called **participants**. The kernel gives every piece an identity, lets each piece decide who may use its APIs, and refuses everything else. It does not know what your software does. You decide that.

This folder is the human-written documentation. It is written to be read from the top by a person who has never seen BrudOS, and to be read by an AI agent that needs to build on it without guessing.

> **Status.** These docs describe the V1-Beta of the core packages: `@brud/kernel`, `@brud/protocol`, `@brud/sdk` and `@brud/daemon`. The composed services (filesystem, workspace, terminal and so on) are separate packages with their own docs. They are not covered here.

## Where do I start?

Pick the row that sounds like you.

| You are... | Read this first | Then |
|---|---|---|
| New here and want to know what this is | [What is BrudOS?](01-introduction/what-is-brudos.md) | [Core ideas](01-introduction/core-ideas.md) |
| A developer who wants something running in ten minutes | [Install](02-getting-started/install.md) | [Your first participant](02-getting-started/your-first-participant.md) |
| Building a participant (a service, a tool, an app piece) | [Concepts](03-concepts/README.md) | [Guides](04-guides/README.md) |
| Running BrudOS as a background service for other programs | [The daemon](05-daemon/README.md) | [Security model](06-security/security-model.md) |
| An AI agent | [AI agent guide](AI-AGENT-GUIDE.md) | [Cheat sheet](07-reference/cheat-sheet.md) |
| Looking something up | [Glossary](07-reference/glossary.md) | [Error codes](07-reference/error-codes.md) |

## How these docs are organised

| Folder | What is in it | Style |
|---|---|---|
| [`01-introduction/`](01-introduction/) | What BrudOS is, the ideas behind it, the packages | Explanation |
| [`02-getting-started/`](02-getting-started/) | Install, build, boot and test your first participant | Tutorial, follow along |
| [`03-concepts/`](03-concepts/) | How each part works and why | Explanation |
| [`04-guides/`](04-guides/) | Do one specific job | How-to |
| [`05-daemon/`](05-daemon/) | Run the daemon, connect a client, the wire protocol | Operator and client docs |
| [`06-security/`](06-security/) | What BrudOS protects and what it does not | Explanation |
| [`07-reference/`](07-reference/) | Cheat sheet, error codes, glossary, troubleshooting | Lookup |
| [`examples/`](examples/) | Every code sample used in these docs, runnable | Code |

Two other sources sit beside these docs and are generated from the source code. Use them for exact type signatures:

- `docs/kernel-api/reference/` is the full type reference (TypeDoc).
- `docs/kernel-api/catalogue/` lists the hardcore services, mechanism exposures, manifest keys, error codes and observation events, straight from the kernel's own data.

## Conventions

- **Code samples are real.** Every sample in the tutorials lives in [`examples/`](examples/) and was run before it was published. If a sample here and the code disagree, the code wins and the docs have a bug.
- **Names.** `@brud/kernel` is the package. "The kernel" is the running thing. A *participant* is anything the kernel hosts.
- **Plain JSON.** Values that cross between participants are plain JSON: strings, numbers, booleans, null, arrays and plain objects. No functions, classes or dates.
- **"Request" versus "grant".** A participant asks for things in its manifest. That is only a request. The participant that owns an API decides. You will see this idea everywhere.
