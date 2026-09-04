# Architecture Documentation

This directory contains internal architecture specifications and design documents for Brud Code modules.

## What These Documents Are

These files capture design decisions, implementation plans, and architectural rationale for significant Brud Code features. They serve as the single source of truth for implementation — when a module is developed, these documents guide the work.

## Why These Are Internal

These documents are written for Brud Code maintainers and core contributors. They contain implementation details, edge case discussions, and design trade-offs that are not relevant to end users or plugin developers.

## Not For Critique

These are internal working documents. They are not:
- API documentation for plugin developers
- User guides
- Feature announcements
- Proposals seeking external feedback

They exist to preserve architectural knowledge across development sessions and ensure consistent implementation.

## Current Documents

- HISTORY_MODULE.md — Session lifecycle, snapshot system, soft-delete protection, revert functionality, audit logging, and retention policy

## Document Lifecycle

Documents in this directory evolve with the module they describe. As features are added or design decisions change, the corresponding document is updated.

## Tracking

Each document tracks:
- What was decided
- Why it was decided
- How it should be implemented
- Edge cases to handle
- Test coverage requirements

These documents are the memory of Brud Code's architecture. They exist so future maintainers understand not just WHAT was built, but WHY it was built that way.