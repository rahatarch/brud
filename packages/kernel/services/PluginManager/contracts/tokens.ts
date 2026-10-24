import { createServiceToken } from '../../../src/contracts/serviceToken.js';
import type { IPluginManagerService } from './IPluginManager.js';

/** Kernel service token for the plugin manager. */
export const PluginManagerToken = createServiceToken<IPluginManagerService>('PluginManager');
