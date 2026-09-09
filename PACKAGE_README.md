# Package README Standards

## Purpose

This document defines how to write and maintain READMEs for individual packages in the Brud Code monorepo.

## When to Write a Package README

**Required for:**
- Every top-level package (`packages/core`, `packages/protocol`, `packages/ui`, `packages/adapters/*`)
- Every app (`apps/vscode`)

**Optional for:**
- Complex child modules within a package (e.g., `packages/core/src/history/`)
- Only when the module has enough complexity that a README genuinely helps navigation

**Skip for:**
- Simple modules where the module name is self-explanatory
- Test files and test utilities

## Exact Structure

```markdown
# Package Name

[One-sentence description of what this package does]

## Purpose

[Why this package exists, what problem it solves]

## Installation

[How to install, if applicable]

## Key Public API

[Table or list of main exports, grouped by area]

## Child Modules

[Table of child modules with one-line purposes]

## How It's Used

[Brief example or reference to consumers]

## Testing

[How to run tests for this package]

## Deeper Documentation

[Links to docs/public/ for complex modules]

## Dependencies

[External dependencies with one-line rationale]
```

## Writing Rules

1. **Map, not manual** — Package READMEs give an overview and link to `docs/public/` for API-level details.
2. **Right-sized** — Cover the package's public API, child modules, usage, and testing comprehensively. No arbitrary length limit. Small packages get short READMEs; large packages get thorough ones.
3. **Accurate** — every export and module name must be verified against actual code.
4. **Linked** — point to `docs/public/` for deep dives. Do NOT reference `docs/arch/` (internal).
5. **Current** — update when exports change, modules are added/removed, or dependencies shift.
6. **Actionable** — a contributor should know what the package does and where to go for implementation details.

## Maintenance

- Update when the package's public API changes
- Update when child modules are added or removed
- Update when dependencies change
- Review quarterly to ensure accuracy