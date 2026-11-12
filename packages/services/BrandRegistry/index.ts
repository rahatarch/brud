export { BrandRegistryToken } from './contracts/tokens.js';
export type { IBrandRegistry, IBrandScope } from './contracts/index.js';
export {
  BrandRegistryClosedError,
  BrandScopeNameError,
  BrandTargetError,
  DuplicateBrandScopeError,
} from './contracts/errors.js';
export {
  BRAND_REGISTRY_SERVICE_TIER,
  createBrandRegistryDescriptor,
} from './descriptor/descriptor.js';
export type { BrandRegistryDescriptorOptions } from './descriptor/descriptor.js';
export {
  BrandRegistryService,
  createBrandRegistry,
} from './orchestrator/BrandRegistryService.js';