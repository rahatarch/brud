# Brud Documentation System

## The Two-Tier Model

Brud documentation follows a two-tier structure:

| Tier | Location | Purpose | Length |
|------|----------|---------|--------|
| **Overview** | `packages/*/README.md` | Shows where things are, what exists, high-level purpose | Right-sized — no arbitrary limit |
| **API Reference** | `docs/public/*.md` | Shows how to use each module with exact signatures, examples, testing, extension | Thorough — every public method documented |

Package READMEs link to `docs/public/` for implementation details. They do not duplicate the API reference content.

## Documentation Standards

The standards for each tier are defined in:

- [`PACKAGE_README.md`](PACKAGE_README.md) — how to write package READMEs (Overview tier)
- [`DOCS_README.md`](DOCS_README.md) — how to write deep docs (API Reference tier)

## File Map

| File | Purpose | Audience |
|------|---------|----------|
| `README.md` | Product overview, benchmarks, install | Everyone |
| `ENGINEERING_README.md` | Technical overview of the codebase | Developers |
| `DOCUMENTATION.md` | This file — explains the documentation system | Contributors, AI agents |
| `PACKAGE_README.md` | Standard for package-level docs | Contributors |
| `DOCS_README.md` | Standard for deep API docs | Contributors |
| `packages/*/README.md` | Overview of each package | Contributors |
| `docs/public/*.md` | API reference for complex modules | Contributors |
| `ARCHITECTURE.md` | Deep architecture internals | Contributors |

## Navigation Guide

**I want to understand what Brud is:**
→ Read `README.md`

**I want to understand how Brud works technically:**
→ Read `ENGINEERING_README.md`

**I want to understand the documentation system:**
→ You're reading it

**I want to contribute to a package:**
→ Read that package's README, then follow its links to `docs/public/`

**I want to write documentation:**
→ Read `PACKAGE_README.md` and `DOCS_README.md` first

**I want to understand the architecture deeply:**
→ Read `ARCHITECTURE.md`