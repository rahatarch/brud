# Architecture Documentation

This directory contains internal architecture specifications and design documents for Brud Code modules.

## What These Documents Are

These files capture design decisions, implementation plans, and architectural rationale for significant Brud Code features. They serve as the single source of truth for implementation — when a module is developed, these documents guide the work.

## Current Documents

- [history-module.md](history-module.md) — Session lifecycle, snapshot system, soft-delete protection, revert functionality, audit logging, and retention policy
- [terminal-module.md](terminal-module.md) — Terminal command execution (single, sequential, parallel, conditional, mixed groups, interactive), output capture, and revert command design (deferred)

## Document Lifecycle

Documents in this directory evolve with the module they describe. As features are added or design decisions change, the corresponding document is updated.

## Tracking

Each document tracks:
- What was decided
- Why it was decided
- How it should be implemented
- Edge cases to handle
- Test coverage requirements