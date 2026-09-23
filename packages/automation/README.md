# @brud/automation

The automation layer for Brud Code. Connects AI models to the Brud engine through a structured, role-governed workflow — turning Brud from a manual, clipboard-driven tool into a fully autonomous IDE without changing the engine, the history, or the safety model.

## Purpose

The automation layer is the bridge between AI and the Brud engine. It orchestrates AI instances as distinct roles — Discusser, Architect, Executor — that produce structured Brud blocks and feed them through the same validation, diff, and execution pipeline that manual mode uses. It maintains the codebase context map, the session archive, and the harness enforcement that guarantees invariants are never left to prompt alone.

The full vision for this package is described in `docs/vision/AUTO_MODE.md`.

## Relationship to Core

`@brud/automation` sits on top of `@brud/core` and never modifies it. Core is the engine — file operations, history, validation, search, terminal execution, parsing. Automation is the layer that drives that engine autonomously. Every operation that an AI requests passes through the same `parseOperations()` and `executeFileOperations()` pipeline that manual operations use. Core does not know who produced the block, and does not need to.

## What This Package Will Contain

At a high level, this package will eventually provide:

- **AI provider integration** — adapters that connect to AI models through their APIs and return structured Brud blocks
- **Role-based workflow orchestration** — the Discusser, Debater, and Executor roles as distinct, bounded agents that communicate through a fixed document protocol
- **Session archive** — permanent, uneditable records of every session's full paper trail, preserving not just the decision but the reasoning that led to it
- **Codebase context map** — a maintained directory of the project's architecture, conventions, known issues, and current state, read by every session at startup and written back before completion
- **Harness enforcement layer** — structural guarantees that invariants (map updates, role boundaries, engine-only edits) are enforced by the system, not requested in the prompt

None of these components exist yet. This README is the vision for what they will become.

## Manual and Auto: One Product, One Engine

Manual mode and auto mode share the same engine, the same history, and the same safety model. The only difference is who produces the Brud blocks — a human through a clipboard interface, or an AI through an API call. Switching between modes is a configuration change, not a product change. Removing the automation layer leaves the entire system working exactly as it did before.

## Reading

- `docs/vision/AUTO_MODE.md` — the full design intent, theses, open questions, and structural invariants for Brud Code Auto