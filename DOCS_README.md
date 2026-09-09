# Documentation Standards for docs/public/

## Purpose

This document defines how to write deep documentation for complex modules. These docs live in `docs/public/` and are linked from package READMEs.



## When to Write a Deep Doc

**Write for:**
- Complex modules with multiple public methods (e.g., validation API, history system)
- Modules that contributors will need to extend or debug
- Safety-critical modules where misuse could cause damage

**Skip for:**
- Simple utilities with one obvious purpose
- Internal implementation details that don't affect users

## Exact Structure

```markdown
# Module Name

## What It Is

[1-2 sentences explaining the module's purpose]

## Why It Exists

[The problem it solves, why it's needed]

## Core Concepts

[Key terms and abstractions, brief explanations]

## How To Use It

[Step-by-step with code examples]

## API Reference

[Exact signatures, parameters, return types]

## How To Test It

[Commands to run, what tests exist, how to add new tests]

## How To Extend It

[What to do to add new functionality, patterns to follow]

## Edge Cases & Gotchas

[Common pitfalls, unexpected behaviors]

## Related Docs

[Links to other docs]
```

## Writing Rules

1. **Teaching-oriented** — explain before showing, show before expecting.
2. **API reference quality** — every public method must have: signature, parameters, return type, example.
3. **"How To Extend It" required** — every doc teaches contribution, not just usage.
4. **Cross-link** — docs form a web, not isolated pages. Link to related docs.
5. **Accurate** — every signature, parameter, and return type must match actual code.
6. **Current** — update when the module's API changes.

## Maintenance

- Update when the module's API changes
- Add new docs when new complex modules are introduced
- Review links quarterly to ensure they're not broken