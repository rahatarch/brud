# Release Notes — v0.1.4

**Release Date:** 2026-10-09

## Overview

v0.1.4 introduces a hardened microkernel execution architecture, structural intelligence for large-scale codebase navigation, zero-inference protocol governance, platform clipboard invariants, and real-time terminal streaming controls. This release establishes Brud as a high-performance, fault-tolerant execution engine that enforces strict workspace containment and delivers sub-second project navigation for demanding development workflows.

---

## Features

### Core Engine Hardening & Accelerated Execution Pipeline

All 21 userspace operations now dispatch through a decoupled microkernel execution pipeline (`@brud/kernel`), providing major performance, reliability, and security advancements:

- **Inescapable Workspace Sandboxing:** File operations enforce deterministic root containment, mathematically isolating operations to the active project workspace and preventing accidental file mutations outside project boundaries.
- **Sub-Second Project Traversal:** Read-only inspection tools (`codebase_metadata`, `extract_structure`, `read_file`) bypass redundant session scaffolding and leverage optimized directory pruning (`.turbo`, `.vscode`, `.git`, `temp`), accelerating codebase navigation from multi-second scans down to sub-300ms responsiveness.
- **Fault-Tolerant Panic Boundaries:** Execution lifecycles are wrapped in an isolated error boundary, capturing unhandled process exceptions and converting them into structured diagnostics without risking extension host crashes or UI freezes.
- **Dynamic Extensibility:** Tool dispatching operates through an open capability registry, laying the operational foundation for forthcoming Model Context Protocol (MCP) and third-party plugin integrations.

### Real-Time Terminal Output Streaming & Process Interruptor

Added a dedicated live terminal streaming panel (`Brud Terminal Stream`) that activates automatically upon command execution, rendering stdout and stderr streams in real time. Includes an active "Kill Process" interrupt switch to abort hanging or runaway shell tasks, dynamic action locking during execution, and automatic cleanup upon process completion.

### Live Workspace Metadata Injection on Master Prompt Copy (`a57f56e`)

When the "Master System Prompt" (`master-system`) is copied from the Prompt Library with an open workspace, Brud automatically extracts live project topology and appends a structured Markdown block directly to the clipboard:

- **Project Root:** Canonical identifier of the active project directory
- **Total Files:** Aggregate non-binary file count
- **Total Folders:** Total directory tally (excluding ignored build artifacts)
- **Most Dense Directory:** Subdirectory containing the highest file count and density metric

This bridges the gap between static prompt templates and live repository topology, providing AI models with accurate structural context up front.

### Structure Extraction LOC & Binary Tagging (`37d4276`)

Project-structure outputs now annotate every file entry with an exact **lines-of-code tally** and a **binary/text classification flag**. AI callers receive token-efficient structural maps enriched with:

- `loc` — Total non-empty lines for instant file scale estimation
- `binary` — Boolean indicator enabling tools to skip non-text assets automatically

This establishes structural extraction as an efficient, single-source-of-truth representation of repository topology.

### Line-Range Reading & Automatic Boundary Clamping (`47db8b4`)

Both the YAML-based and legacy plain-text parsers now support surgical **line-range extraction** via `start_line` and `end_line` parameters. Range requests exceeding physical file bounds are automatically clamped to valid line boundaries without rejecting execution, enabling AI tools to request broad reading windows safely.

### Zero-Inference Protocol Governance (`masterPrompt.ts`, `GET_TOOL_INFO` Mandate) (`bffdb24`)

The Master Prompt has been redesigned around an explicit tool discovery protocol, mandating the use of the **`GET_TOOL_INFO`** capability prior to execution:

- **Elimination of Implicit Assumptions:** AI callers must dynamically query tool capabilities and syntax contracts rather than relying on brittle in-prompt heuristics.
- **Strict Relative Path Resolution:** The Master Prompt enforces strictly relative file paths (e.g. `src/App.tsx`), prohibiting absolute filesystem paths and leading `./` prefixes.
- **Autonomous Execution Loop:** Directs AI assistants to output exclusively executable instructions once a task is assigned, eliminating conversational filler.
- **Clipboard Protocol Anchoring:** Standardized discovery examples are appended to clipboard copies to ensure consistent parameter syntax across multi-turn interactions.

### Platform-Scale Clipboard Invariants (`1ab2e98`)

Appends core execution invariants (**Zero Inference**, **Minimal Blast Radius / Surgical Proportionality**, and **Empirical Grounding**) to the footer of every copied clipboard output, mitigating multi-turn context degradation and preventing unprompted full-file rewrites during long coding sessions.

### Configurable Terminal Safety Toggle (`brud.commandValidationEnabled`)

Added a configuration setting in the Management Panel and settings schema allowing developers to toggle off dangerous command validation filters (`sudo`, `rm -rf`, etc.) when executing trusted system provisioning scripts.

### Read Output Line-Number Gutters & Auto-Sanitizer Defense (`bca0545`)

File read outputs now render aligned line-number gutters (` 35 | code`) for precise code referencing. Paired with an **Auto-Sanitizer Defense** in search/replace handlers that automatically strips accidental line-number prefixes (`/^\s*\d+\s*\|\s?/gm`) from pasted replacement blocks while preserving exact indentation.

### Parallel Action Batching & Cumulative 500-Line Read Budget

Establishes strict batching ergonomics to minimize copy-paste roundtrips while enforcing context efficiency:

- **Parallel Action Batching:** Directs assistants to consolidate independent file modifications or read operations into a single structured instruction block (`[1]`, `[2]`, `[3]`, etc.).
- **Cumulative 500-Line Read Budget:** Enforces a 500-line cumulative ceiling per instruction block to prevent token exhaustion.
- **Whole-File Ingestion for Small Files:** Files containing 500 lines or fewer are ingested completely on initial read rather than through fragmented partial slices.

---

**Full Changelog:** [CHANGELOG.md](./CHANGELOG.md)