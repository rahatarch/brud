export { CoreTokens } from './tokens.js';
export { createLegacyOperationHandler, registerCoreOperations, bootCoreKernel } from './legacyBridge.js';
export type { IStructureService } from '../services/structureService.js';
export type { BrudKernel } from '@brud/kernel' with { 'resolution-mode': 'import' };
export { StructureService } from '../services/structureService.js';