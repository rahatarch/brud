import { createRequire } from 'node:module';
import type { KernelServiceModuleContext } from '../../src/bootstrap/bootTypes.js';
import { createWasmCageDescriptor } from './src/descriptor.js';

/**
 * The cage's built native artifact, named through `createRequire`.
 *
 * The relative specifier is written as a literal `require(...)` call so the
 * hardcore pin's package-graph walk reaches the `.node` and records it as a
 * binary leaf (`hardcore.ts`, `BINARY_LEAF_EXTENSIONS`). The module is not
 * loaded through this require at construction; the resolved path is handed to
 * the cage's loader in a later step.
 */
const requireNativeArtifact = createRequire(import.meta.url);

/** Resolved absolute path of the cage's built native artifact. */
export const WASM_CAGE_NATIVE_ARTIFACT_PATH: string =
  requireNativeArtifact.resolve('./native/brud-wasm-cage.linux-x64-gnu.node');

/**
 * Records the artifact specifier for the hardcore pin's package-graph walk.
 *
 * The walk reads this module's source as text and follows the literal
 * `require('./native/brud-wasm-cage.linux-x64-gnu.node')` specifier it finds
 * here to the binary file. This function is never called; its body exists so
 * the specifier is present in the source the walk reads.
 */
export function recordNativeArtifactSpecifier(): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('./native/brud-wasm-cage.linux-x64-gnu.node');
}

/**
 * Composes the WASM cage through the standard service-module contract.
 *
 * The module has no context fields of its own at this step: the cage's
 * configuration (resource profile, the loader capability) lands in a later
 * plan step. The module returns the descriptor the compiled hardcore list
 * verifies and the kernel registers.
 *
 * The module also references the built `.node` artifact so that the artifact
 * is inside the cage's package graph and the compiled pin covers it.
 */
export function createService(_context: KernelServiceModuleContext) {
  return createWasmCageDescriptor();
}

/**
 * The cage's built native artifact, relative to this module.
 *
 * The specifier is written as a static relative import path so the hardcore
 * pin's package-graph walk reaches the binary and records it as a binary leaf
 * (`hardcore.ts`, `BINARY_LEAF_EXTENSIONS`). The module is not loaded through
 * this specifier; the string is resolved against `import.meta.url` at runtime
 * by the cage's loader in a later step.
 */
const WASM_CAGE_NATIVE_ARTIFACT_SPECIFIER = './native/brud-wasm-cage.linux-x64-gnu.node';

/** Absolute URL of the cage's built native artifact. */
export const WASM_CAGE_NATIVE_ARTIFACT = new URL(
  WASM_CAGE_NATIVE_ARTIFACT_SPECIFIER,
  import.meta.url,
).href;