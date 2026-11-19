---
artifact: plan
topic: composed_services_refactor_phase1
date: 2026-11-19
stage_status: proposed
supersedes: null
evidence: []
---

# Plan — Composed Services Refactor, Phase 1 (BrandRegistry, UtilityService)

Parent plan: `plans/2026-11-19_composed_services_refactor.md` (Step 1). Reference template: `packages/services/BrudTools/`.

## Goal

Migrate `BrandRegistry` and `UtilityService` to the v1 Kernel model (declared exposures via `@brud/sdk/participant` `defineParticipant`), following the BrudTools template.

## Reference pattern (BrudTools)

- `serviceModule.createService(ctx)` → `createXDescriptor(ctx.options[key])`.
- Descriptor: `defineParticipant({ id: Token.id, description, tier, exposes: { [EXPOSURE]: { version: 1, scope: 'runtime', handle } }, create })`, cast to `ServiceDescriptor<IApi, Impl>`.
- `contracts/exposure.ts`: literal exposure name, capability constants, `I<Name>Api` (capability-gated methods optional).
- Projection: `byCapability({...}, { shared })` (or a plain handle when no capability split exists).
- Cross-service calls: `ctx.resolve<LocalView>(name)` against a local interface, with a safe fallback when unresolved.
- `index.ts` re-exports contracts, descriptor, tokens, orchestrator.

## Audit baseline (2026-11-19)

| Service | tsc errors | `withExposedApis` | `CORE_API_NAME` | `requestAccess` (src) | `PluginManager` imports (src) |
|---|---|---|---|---|---|
| BrandRegistry | 0 | 0 | 0 | 0 | 0 |
| UtilityService | 3 | 1 (`descriptor/UtilityServiceDescriptor.ts`) | 2 (same file) | 0 | 0 |

Note: the Phase 0 audit counted 1 `requestAccess` and 1 `PluginManager` reference for UtilityService; a source-only re-scan finds none outside tests. Step 2 re-verifies (tests included) before closing those items.

## Step 1 — BrandRegistry

1. Add `contracts/exposure.ts`: `BRAND_REGISTRY_EXPOSURE` literal (name per D3, e.g. `brud.brands`), capability constants if any, `IBrandRegistryApi`.
2. Wrap `descriptor/descriptor.ts` in `defineParticipant` with one exposure `@1`, `scope: 'runtime'`.
3. Remove `CORE_API_NAME` (already absent — confirm with grep; no-op if still zero).
4. Standardize exports: `index.ts` re-exports `contracts`, `descriptor`, `tokens`, `orchestrator` as in BrudTools; `serviceModule.ts` follows `createService(context)`.
5. Keep `__tests__/brandRegistry.test.ts` green.

## Step 2 — UtilityService

1. Remove the circular dependency on `PluginManager`: delete any import of `../../PluginManager/...` (src and tests); replace with a local interface if a type is needed.
2. Add `contracts/exposure.ts` (`UTILITY_EXPOSURE` literal, `IUtilityApi`).
3. Replace `withExposedApis` + `registry.registerApi(CORE_API_NAME.utilities, …)` in `descriptor/UtilityServiceDescriptor.ts` with `defineParticipant` (`exposes: { [UTILITY_EXPOSURE]: { version: 1, scope: 'runtime', handle } }`).
4. Convert any `requestAccess` call to `ctx.resolve<LocalView>(name)` inside `create`, with an unresolved fallback.
5. Also drop the runtime import of `BrudFileSystem` if present (type-only `contracts/` import or local interface, per D1).
6. Keep `__tests__/utility-purity.test.ts` and `utility-service.test.ts` green.

## Connectivity requirements

- Both services expose strictly typed APIs: explicit `I<Name>Api` interfaces, no `any`/implicit-`any` in handles or projections.
- Zero legacy patterns in both trees: `grep -rnE "withExposedApis|CORE_API_NAME|lastProjectionWins|requestAccess" packages/services/{BrandRegistry,UtilityService}` returns nothing.
- No runtime imports of other composed services from either tree.

## Verification

- `npm run typecheck`: zero errors reported under `packages/services/BrandRegistry` and `packages/services/UtilityService` (filter tsc output by path; overall services error count must drop from 38 to ≤ 35 and not rise elsewhere).
- Refactored files compile with zero errors.
- Own tests green: BrandRegistry (1 file), UtilityService (2 files).
- Kernel untouched (`repin --check` passes); `npm run test:kernel` shows no new failing names vs the saved baseline.

## Dependencies / open rulings

- D1 (type-only `contracts/` imports) and D3 (exposure naming) are needed before Step 1 is finalized; Phase 1 can proceed with names provisionally set to `brud.brands` / `brud.utilities`.
