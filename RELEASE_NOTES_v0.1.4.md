# Release Notes — v0.1.4

**Release Date:** 2026-10-03

## Overview

v0.1.4 introduces structural intelligence for large-scale codebase navigation, a zero-inference protocol governance layer, platform clipboard invariants, and ergonomic terminal safety controls. This release shifts Brud from a capable editor assistant toward a production-grade AI tool interface that respects workspace boundaries without sacrificing power.

---

## Features

### Structure Extraction LOC & Binary Tagging (`37d4276`)

The project-structure JSON output now annotates every file entry with its **line-of-code count** and a **binary/text classification flag**. AI callers receive token-efficient structural maps enriched with:

- `loc` — total non-empty lines for quick size estimation
- `binary` — boolean indicator so tools can skip non-text files automatically

This eliminates the need for secondary stat calls during prompt construction and makes structure extraction a single-source-of-truth for codebase topology.

### Line-Range Reading (`start_line`/`end_line`, YAML + Legacy Parsers, Validator Auto-Clamping) (`47db8b4`)

Both the YAML‑based and legacy plain‑text parsers now support precise **line-range extraction** via `start_line`/`end_line` parameters. Range requests that exceed available content are silently clamped to the file bounds rather than rejected, enabling AI tools to request generous windows without error handling overhead.

- YAML parser: range-aware read delegation with bound clamping
- Legacy parser: equivalent range support for non-YAML configurations
- Universal validator: auto-clamps out-of-bounds ranges before any parser is invoked

### Zero-Inference Protocol Governance (`masterPrompt.ts`, `GET_TOOL_INFO` Mandate) (`bffdb24`)

The Master Prompt has been purged of all implicit agent instructions and replaced with the **`GET_TOOL_INFO`** mandate. Every AI caller must explicitly discover tool capabilities through the tool-info endpoint rather than relying on baked-in prompt heuristics. This eliminates:

- Prompt drift between distributed agent configurations
- Hidden assumptions about tool behaviour embedded in natural-language instructions
- Version skew when the tool surface evolves independently of prompt snapshots
- **Master Prompt Path Resolution Rule**: Added explicit instructions to the Master System Prompt enforcing that all file paths must be strictly relative to the workspace root (e.g. `src/App.tsx`), prohibiting absolute paths and leading `./` prefixes
- **Strict "Only Brud Blocks" Execution Mode**: Added explicit enforcement to the Master Prompt prohibiting conversational chatter or intermediate pleasantries once a task is assigned. The AI must produce exclusively executable Brud blocks in an autonomous loop until completion.
- **Anti-Stale-Training Override Warning**: Injected a mandatory warning into every tool usage prompt and tool registry documentation entry instructing AI models to prioritize Brud's rules over stale internal training knowledge and to follow the exact Example block format without deviation.
- **Clipboard Protocol Anchor Enhancement**: Added an explicit `GET_TOOL_INFO` empty-block example (`<<<<<<< GET_TOOL_INFO [1]`) to the clipboard copy protocol anchor, ensuring AI models never make syntax mistakes when discovering tools after long conversation turns.

### Platform-Scale Clipboard Invariants (`UnifiedResultsPanel.tsx` Protocol Anchor) (`1ab2e98`)

Automatically appends the three core protocol invariants (**Zero Inference**, **Minimal Blast Radius / Surgical Proportionality**, and **Empirical Grounding**) to the end of every copied clipboard result. This leverages LLM recency bias to prevent multi-turn attention decay, tool fixation, and full-file rewrite drift during long coding sessions.

### Configurable Terminal Safety Toggle (`brud.commandValidationEnabled`)

Added a user setting in the Management Panel and configuration schema allowing advanced power users to toggle off dangerous command security checks (`sudo`, `rm -rf`, etc.) when running trusted system provisioning scripts. Terminal validation is now properly deferred to the execution engine.

### Read Output Line-Number Gutters (` 35 | code`) & Auto-Sanitizer Defense (`bca0545`)

File read outputs now display dynamic-width line-number gutters in the format ` 35 | code`, aligning each line with its absolute file offset for precise AI referencing. Paired with an **Auto-Sanitizer Defense** in `search_replace` and `search_replace_multi`, which automatically strips accidental line-number prefixes (`/^\s*\d+\s*\|\s?/gm`) from AI-pasted `SEARCH` blocks while preserving exact indentation, preventing false `SEARCH_NOT_FOUND` errors.

### Real-Time Terminal Output Streaming & Process Interruptor

Added a dedicated live terminal streaming panel (`Brud Terminal Stream`) that opens automatically before execution, rendering stdout/stderr chunks in real time. Includes an active "Kill Process" switch to abort runaway or hanging shell processes, dynamic clipboard button locking during flight, and automatic panel cleanup upon completion.

---

**Full Changelog:** [CHANGELOG.md](./CHANGELOG.md)