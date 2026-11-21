# @brud/cli

The Brud command line: scaffold a project, check it, run it, call it, and package a participant for the WASM cage.

```bash
npm install --save-dev @brud/cli
npx brud doctor
```

| Command | Purpose |
|---|---|
| `brud init [name]` | Scaffold a project that passes `doctor` and `npm test` |
| `brud doctor` | Read-only check of the machine, the composition and the daemon |
| `brud check` | Boot the composition in a scratch state and report problems |
| `brud run` / `brud call` | Boot and route Brud text, in-process or through the daemon |
| `brud kinds` / `brud inspect` | Show kinds, exposures, requirements and who can resolve each |
| `brud pack` | Build a caged participant package (experimental) |

The CLI loads `@brud/kernel`, `@brud/sdk` and `@brud/daemon` from your project, never from a private copy. Nothing in Brud depends on it, and it never changes who is official. Full documentation: [`docs-next/02-getting-started/the-brud-cli.md`](../../docs-next/02-getting-started/the-brud-cli.md).
