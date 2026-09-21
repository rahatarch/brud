# Brud Documentation System

## The Two-Tier Model

Brud documentation follows a two-tier structure:

| Tier | Location | Purpose | Length |
|------|----------|---------|--------|
| **Overview** | `packages/*/README.md` | Shows where things are, what exists, high-level purpose | Right-sized — no arbitrary limit |
Package READMEs link to deep documentation for implementation details. They do not duplicate the API reference content.

## Documentation Standards

The standards for each tier are defined in:

- [`standards/package-readme.md`](standards/package-readme.md) — how to write package READMEs (Overview tier)
- [`README.md`](README.md) — how to write deep docs (API Reference tier)

## File Map

| File | Purpose | Audience |
|------|---------|----------|
| `README.md` | Product overview, benchmarks, install | Everyone |
| `ENGINEERING.md` | Technical overview of the codebase | Developers |
| `DOCUMENTATION.md` | This file — explains the documentation system | Contributors, AI agents |
| `standards/package-readme.md` | Standard for package-level docs | Contributors |
| `README.md` | Standard for deep API docs | Contributors |
| `packages/*/README.md` | Overview of each package | Contributors |
| `ARCHITECTURE.md` | Deep architecture internals | Contributors |

## Navigation Guide

**I want to understand what Brud is:**
→ Read `README.md`

**I want to understand how Brud works technically:**
→ Read `ENGINEERING.md`

**I want to understand the documentation system:**
→ You're reading it

**I want to contribute to a package:**
→ Read that package's README for guidance

**I want to write documentation:**
→ Read `standards/package-readme.md` and `README.md` first

**I want to understand the architecture deeply:**
→ Read `ARCHITECTURE.md`