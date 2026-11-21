# Cage language benchmarks

Compares the same workloads as native JS (V8), AssemblyScript in the real WASM cage, and JavaScript in the real WASM cage (the QuickJS runtime that `brud pack` ships, with `handler.js` in its slot). It runs the real cage binary through the kernel's own loader and is not part of the workspace or the build.

```
npm run build:cli                      # from the repo root: builds the CLI and its runtime reader
cd benchmarks/cage-languages
npm install && npm run build:as && npm run bench
```

Workloads: `empty` (call overhead), `tiny` (fib 20), `h1m` and `h10m` (1M and 10M integer loop steps). Each guest must return the same values as native JS; the runner checks this. `handler.js` is the JS handler and `assembly/index.ts` its AssemblyScript twin. The JavaScript runtime itself is built from `packages/cli/runtime/quickjs/`.

`results.json` is the last run (Linux x64, Node 22).
