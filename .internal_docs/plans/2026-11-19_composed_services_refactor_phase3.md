---
artifact: plan
topic: composed_services_refactor_phase3
date: 2026-11-19
stage_status: proposed
supersedes: null
evidence: []
---

# Plan — Composed Services Refactor, Phase 3 (Validation, Workspace, BrudFileSystem cluster)

Parent: `plans/2026-11-19_composed_services_refactor.md`, Steps 2, 4, 5 (merged: the three services form import cycles). Template: BrudTools; Phase 2 (SettingsService) for the boot-context wrapper.

## Goal

Atomic migration of {ValidationService, WorkspaceService, BrudFileSystem} to `defineParticipant` with one exposure each, and removal of the runtime edges that close the cycles.

## Cycles found (source, non-test)

| Edge | Kind | Closes cycle with |
|---|---|---|
| Validation descriptor → `WorkspaceService/descriptor/tokens` | runtime (token for `requestAccess`) | Workspace → Validation (`PathViolationError`) |
| Workspace descriptor → `BrudFileSystem/drivers` (`NodeStorageDriver`) | runtime | BFS → Workspace (orchestrator, pathRules, port, errors) |
| BFS → Validation orchestrator/engines/errors; Validation → BFS `contracts` | BFS runtime; Validation type-only | — (type-only edge does not form a runtime cycle) |

## Strategy

1. **Validation:** `defineParticipant`, exposure `brud.validation@1` gated by `validation:read`; Settings and Workspace via `ctx.resolve('brud.settings')` / `ctx.resolve('brud.workspace')` (requests `settings:read`, `workspace:read`); boot pin moves from the pre-RUNNING `pinBootPolicies` hook (where `resolve` is unavailable) to the participant's `onRunning`. Drops the `WorkspaceToken` import.
2. **Workspace:** `defineParticipant`, exposure `brud.workspace@1` gated by `workspace:read`; default path port becomes a local `node:fs` port (`ports/NodePathPort.ts`), removing the `NodeStorageDriver` import.
3. **BFS:** `defineParticipant`, exposure `brud.fileSystem@1`: `fs:write` → full instance (or the caller's authorized-scope projection, keyed by kernel identity), `fs:read` → `ReadOnlyFacade`; replaces the two `lastProjectionWins` registrations. Token-level `project` kept for hosts taking the token directly.
4. Remaining edges are one-directional (BFS → Workspace → Validation contracts) and are library reuse; they stay until D1 is ruled (type-only `contracts/` imports) and are recorded.
5. **D4:** not ruled → journal push mechanism untouched (parent Step 10). **D7:** packaging is parent Step 11; not in scope here — recorded as deferred.
6. Exports: each `index.ts` exports its `contracts/exposure.ts`.

## Verification

- Services typecheck ≤ 25 errors (from 31); 0 in the three services.
- Each service's own test suite green.
- Grep: no `withExposedApis|CORE_API_NAME|lastProjectionWins` and no `requestAccess` in their source.
