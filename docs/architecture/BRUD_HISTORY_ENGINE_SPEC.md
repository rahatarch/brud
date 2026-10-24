# BrudHistory: Universal History Engine Specification

BrudHistory is Brud Code's native, multi-tenant operational ledger. It provides a durable, execution-scoped record of operations, target state transitions, diagnostics, and context across the platform.

The system is designed as a foundational, domain-agnostic engine capable of capturing ground truth, recording forward delta sets, and executing deterministic rollbacks across any managed state domain.

---

## 1. Core Architecture & Philosophy

### 1.1 Universal Operational Scope
BrudHistory records discrete operational sessions. A session represents an isolated unit of execution, bounded by an initial intent and a final resolution.

The engine serves as a universal flight recorder for any state-bearing domain in Brud Code, governing:
- Pre-execution ground-truth baselines for declared targets.
- Forward deltas and state mutations resulting from execution.
- Dynamic reconstruction of historical states without full-snapshot duplication.
- Crash-safe persistence and write serialization.
- Scoped entity isolation.

### 1.2 Scoped Ground Truth & Forward Deltas
State management operates on a dual-record model to minimize storage overhead while surviving concurrent external mutations:

- **Baseline Snapshot:** Captured immediately before an operation begins. It records the complete, unaltered state of **only** the targets designated for modification. Any prior external or concurrent changes within those targets become part of the recorded baseline.
- **Forward Delta Set:** Recorded upon execution completion. It captures only the unified differences between the baseline and the resulting state. Unmodified targets yield zero storage overhead.

### 1.3 Dynamic State Reconstruction
The engine avoids saving redundant static snapshots for intermediate historical states. State restoration and time travel are performed dynamically:

- **Direct Target Derivation:** Historical checkpoints are computed on demand by applying forward deltas against the corresponding baseline snapshot.
- **Out-of-Order Navigation:** State transitions are evaluated against the specific session owning the target domain. Rollbacks restore baseline truth for designated entities without requiring sequential replay across unrelated historical records.
- **Strict Scope Isolation:** Restorations apply solely to the targets recorded within that session. All unrecorded domains and entities remain entirely untouched.

### 1.4 Zero-Waste Storage Invariant
- **Target-Restricted Allocation:** Full-system or whole-tree captures are prohibited. Snapshots are strictly scoped to the declared targets of the active session.
- **Single Baseline per Session:** All operations executed within a single session share a single pre-execution baseline.
- **Proportional Scaling:** Storage scales primarily with the volume of modified targets and delta changes, plus nominal manifest overhead.

---

## 2. Universal Ledger & Record Model

### 2.1 Multi-Tenant Session Architecture
Historical records are partitioned into self-contained session ledgers. Each session comprises authoritative system records alongside isolated domain payloads:

| Record Tier | Classification | Description |
|---|---|---|
| **Session Manifest** | Authoritative Core | Monotonic session identifier, timestamp, operational status, and target inventory. |
| **Baseline Snapshot** | Authoritative Core | Exact ground-truth state of touched targets immediately prior to execution. |
| **Forward Delta Set** | Authoritative Core | Compact diff representation of state transitions applied during execution. |
| **Context Payloads** | Domain Artifacts | Invocational context, input arguments, and operational intent descriptors. |
| **Diagnostic Artifacts**| Domain Artifacts | Execution summaries, telemetry, and structured status reports. |
| **State Reversal Log** | Authoritative Core | Immutable audit trail recording state restorations and rollbacks. |

Domain artifacts provide inspection context but are not strictly required for state reconstruction. Authoritative core records are fully sufficient to execute deterministic rollbacks even if domain payloads are absent.

### 2.2 Namespace Partitioning
To support concurrent subsystems and modular extensions without state collisions:
- Every recorded operation is assigned a designated namespace.
- State targets, context payloads, and custom events operate within their own isolated boundaries.
- Cross-namespace modifications are prohibited by partition boundaries, ensuring that distinct subsystems cannot overwrite, corrupt, or invalidate each other's historical checkpoints.

---

## 3. Persistence & Durability Guarantees

### 3.1 Atomic Commit Protocol
The history engine enforces all-or-nothing write safety against unexpected process crashes or host interruptions:

1. **Staged Writes:** Data is initially written to an isolated staging area on persistent storage.
2. **Integrity Flush:** Staged buffers are flushed to persistent media to ensure byte completeness.
3. **Atomic Swap:** Staged records are committed to their canonical location via atomic storage commit operations.
4. **Manifest Finalization:** The Session Manifest is finalized as the last step of the transaction. Incomplete sessions lacking a finalized manifest are treated as aborted and safely ignored by readers.

### 3.2 Single-Writer Serialization
To eliminate race conditions, journal corruption, and interleaved write hazards:
- All ledger mutations, cleanup passes, and session writes pass through a single serialized write pipeline.
- Committed sessions are immutable, ensuring consistent reads once a manifest is finalized.
- Aborted session fragments and orphaned staging files are reconciled and purged during scheduled maintenance sweeps.

### 3.3 Quarantine & Structural Verification
If an authoritative record fails integrity or format checks:
- The corrupted record is quarantined to preserve evidence while preventing consumer failures.
- The engine prevents blind application of damaged delta sets.
- Undamaged sessions remain independently navigable and fully reversible.

---

## 4. Execution Lifecycle & State Machine

Every operational unit within the engine advances through a strict lifecycle:

1. **INITIALIZED:** Operational context establishes session boundaries, allocates a monotonic identifier, and declares target state domains.
2. **SNAPSHOTTED:** Ground-truth state across all designated targets is captured prior to any mutating action.
3. **EXECUTED:** The operation runs to completion (success, partial outcome, or failure). The engine observes resulting target states and computes forward diffs.
4. **FINALIZED:** Baseline snapshots, delta sets, and domain artifacts are committed via atomic swap. The session becomes immutable and available for inspection, audit, or rollback.

---

## 5. Host-Agnostic Core Invariant

BrudHistory is an autonomous, platform-independent engine:
- Core snapshot mechanics, delta calculators, rollback state machines, and persistence coordinators are fully decoupled from any single editor, user interface, or runtime container.
- External systems, presentation layers, and headless runners interact with the history engine strictly through unified service contracts.
