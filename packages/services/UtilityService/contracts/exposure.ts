import type { IUtilityService } from './IUtilityService.js';

/** Exposure name for the utility service (`brud.utilities@1`). Public and zero-authority. */
export const UTILITY_EXPOSURE = 'brud.utilities';

/** API served under {@link UTILITY_EXPOSURE}. */
export type IUtilityApi = IUtilityService;
