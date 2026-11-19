export {
  WASM_CAGE_CONTRACT_METHODS,
  WASM_CAGE_CONTRACT_VERSION,
  WASM_CAGE_SERVICE_TIER,
  WasmCageToken,
  createWasmCageDescriptor,
} from './src/descriptor.js';
export type { IWasmCage } from './src/descriptor.js';
export {
  CagedGuestError,
  DEFAULT_CAGED_LIMITS,
  createCagedParticipant,
} from './src/caged.js';
export type { CagedParticipantLimits, CagedParticipantOptions } from './src/caged.js';
export { CageNativeError, nativePlatformKey } from './src/native.js';
export type { CageNativeErrorCode } from './src/native.js';
