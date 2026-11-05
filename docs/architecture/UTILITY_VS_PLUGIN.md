# Utility vs. Plugin Boundary

## 1. Purpose and Scope

This document defines where a new capability belongs in the Brud kernel. It exists because D-19 introduced the Level-1 Utility Service (`brud.core.utils`) and reclassified ImportResolver from a plugin to a utility, but left the general boundary implicit. Without a written rule, contributors will misclassify features and the kernel will accumulate mislabeled code.

The boundary is about behavior, not domain. A capability that knows TypeScript, Python, or YAML is not a plugin merely because it is language-specific. Side effects decide the classification.

This document applies to:

- New kernel capabilities and shared helpers.
- Code proposed for `packages/kernel/services/UtilityService/`.
- Features currently packaged as plugins that may be pure utilities.
- Reviewers deciding whether a manifest, permission, or lifecycle is warranted.

It does not apply to Level-1 services that own host authority (filesystem, history, settings, workspace, terminal). Those are neither utilities nor plugins.

## 2. The Decision Tree

```text
                    ┌──────────────────────────────────┐
                    │ Does it touch disk, process,     │
                    │ network, or SQLite?              │── yes ──► PLUGIN
                    └────────────────┬─────────────────┘
                                     │ no
                    ┌────────────────▼─────────────────┐
                    │ Does it register a tool for      │
                    │ the AI to call?                  │── yes ──► PLUGIN
                    └────────────────┬─────────────────┘
                                     │ no
                    ┌────────────────▼─────────────────┐
                    │ Does it need a settings flag,    │
                    │ shadow mode, or hot-swap?        │── yes ──► PLUGIN
                    └────────────────┬─────────────────┘
                                     │ no
                    ┌────────────────▼─────────────────┐
                    │ Is it a pure function with no    │
                    │ permissions and bounded work?    │── yes ──► UTILITY
                    └────────────────┬─────────────────┘
                                     │ no
                    ┌────────────────▼─────────────────┐
                    │ Is it kernel-wide policy, state, │
                    │ or host authority?               │── yes ──► L1 SERVICE
                    └──────────────────────────────────┘
```

The first three questions are disqualifiers. A single "yes" makes the feature a plugin. If all three are "no", the feature is a utility when it satisfies the mandates in §4; otherwise it belongs in a Level-1 service.

## 3. The 4 Disqualifiers (Plugin Rules)

A capability is a **plugin** if it matches any disqualifier. Plugins are runtime actors with manifests, permissions, lifecycle, and tool registration.

### D1 — Side Effects

The capability touches disk, a process, the network, or SQLite. Reading a file, spawning a child process, making an HTTP request, or writing a history row are plugin concerns. A capability that performs I/O cannot be pure and must not live in the Utility Service.

### D2 — AI Invocation

The capability registers a tool for the AI to call. Tool registration gives the capability a public execution surface, a schema, and an authority boundary. That is a plugin contract, even when the implementation delegates to a pure helper internally.

### D3 — Lifecycle

The capability needs a settings flag, shadow mode, activation ordering, hot-swap, or disposal. Lifecycle control exists so runtime behavior can be enabled, disabled, or replaced without restarting the kernel. Pure functions need none of it.

### D4 — Domain-Specific Is Not a Disqualifier

Knowing a language or format does not make a capability a plugin. `resolveImports` understands TypeScript, JavaScript, and Python module specifiers, yet it is a utility because it is a pure string-to-string-list function. The same rule applies to parsers, cleaners, formatters, and validators for any domain. Classify by purity, not by language specificity.

## 4. The 5 Mandates (Utility Rules)

A capability may enter the Utility Service only if it satisfies all five mandates. The fourth is a soft guideline; the fifth is a hard boundary.

### P1 — Purity

Same input, same output. No side effects, no ambient state, no clocks, no randomness, no mutation of caller-owned data. A utility may allocate and return new values; it may not observe or change the outside world.

### P2 — Zero Ambient Authority

The utility runs with no permissions. It receives all required data as arguments. It cannot request a filesystem handle, a terminal handle, a settings snapshot, or a history handle, because it has no context and no manifest.

### P3 — Bounded Computational Budget

The utility terminates predictably. No catastrophic backtracking (ReDoS), no unbounded recursion, no unbounded memory growth, and no input-proportional work that lacks an explicit ceiling. Adversarial inputs must be bounded by construction or by an explicit limit.

### P4 — Reuse (soft)

More than one plugin may need the capability. This is a soft guideline: a single-consumer pure function can still be a utility when it is clearly general-purpose and stable. Reuse affects placement and review attention, not correctness.

### P5 — Zero Dependency

A utility MUST NOT call any plugin, Level-1 service, or Kernel context API.

- **Allowed dependencies:** its own code, other utilities in `brud.core.utils`, and native language features (string methods, math, regex, `JSON.parse`/`JSON.stringify`).
- **Forbidden dependencies:** any plugin (`brud.*`), any Level-1 service (`getFileSystem`, `getSettings`, `getTerminal`, `getHistory`, `executeTool`, `registerTool`, `emitTelemetry`), and the Kernel context itself.
- **Test:** if you extracted this utility into a standalone npm package with only the language runtime as a dependency, it would compile and run without the Kernel.
- **Why:** a utility that calls the Kernel is no longer pure. It has ambient authority (the Kernel's permissions), or it becomes coupled to the Kernel's lifecycle, or it depends on state the Kernel holds. That makes it a plugin in disguise.

## 5. Classification Matrix

| Capability | Class | Rationale | Kernel dependency |
|---|---|---|---|
| SHA-256 hashing | Utility | Pure bytes-in, bytes-out; no authority or lifecycle. | None — standalone |
| Line splitting | Utility | Pure string-to-array transformation with bounded work. | None — standalone |
| Byte formatting | Utility | Pure numeric formatting; same input, same output. | None — standalone |
| Regex escaping | Utility | Pure string transformation; no I/O or state. | None — standalone |
| BRUD block cleaner | Utility | Pure text cleaning and normalization; the parser capability already lives in Level-1 `BrudTools`, and the pure cleaner belongs with the utilities. | None — standalone |
| `resolveImports` | Utility | Pure string-to-string-list resolution; reads content supplied by the caller and probes existence through a supplied port. | None — the caller supplies the port |
| File glob search | Plugin | Touches the filesystem and registers the `search_files` tool. | Kernel filesystem handle |
| Directory tree | Plugin | Traverses the filesystem, registers tools, and enforces depth/boundary policy. | Kernel filesystem handle |
| Lexical path validation | L1 Service | Kernel-wide containment policy with error taxonomy and caller-facing authority. | Kernel service |
| Workspace containment | L1 Service | Owns root canonicalization, path translation, and cross-host policy. | Kernel service |

**Zero-dependency check:** all six Utility rows confirm no dependency on the Kernel. None calls a plugin, a Level-1 service, or a Kernel context API. No existing row violates P5; there are no errors to fix.

Two related cases clarify the line:

- **Terminal command execution** is a plugin: it spawns processes and registers tools.
- **Settings snapshot loading** is a Level-1 service: it owns configuration policy and a frozen boot snapshot.

## 6. The Decision Rule

> If it thinks about files, processes, or languages' runtime — it's a Plugin. If it only thinks about strings, bytes, and math — it's a Utility.

Apply the decision tree first, then this rule as a sanity check. When the two disagree, the decision tree wins because it names the specific disqualifier.

## 7. References

- **D-19** — introduces the Level-1 Utility Service (`brud.core.utils`) and reclassifies ImportResolver as a utility.
- **D-20** — defines this Utility vs. Plugin boundary.
- **Discovery audit** — `.internal_docs/audits/2026-11-05_kernel_service_access_discovery.md`, which establishes that ImportResolver is pure and that plugin-to-plugin service access was over-engineered for pure logic.
- **Rollout plan** — `docs/architecture/ROLLOUT_PLAN_CORE_TO_MICROKERNEL.md`, §Appendix G.
- **Contributor summary** — `CONTRIBUTING.md`, "Utility vs. Plugin — where does my code go?".