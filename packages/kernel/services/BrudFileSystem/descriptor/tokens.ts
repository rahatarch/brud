import { createServiceToken } from '../../../src/contracts/serviceToken.js';
import type { IBrudFileSystem } from '../contracts/IBrudFileSystem/IBrudFileSystem.js';

/**
 * Kernel service token for the scoped filesystem.
 *
 * The registered identifier stays `brud.core.filesystem` because it is the
 * stable id used by the rollout specification (§2.3.1), the workspace boot
 * ordering assertions, and the history descriptor dependency list. The
 * Phase 3 "scoped driver" surface is added behind this same token.
 */
export const FileSystemToken = createServiceToken<IBrudFileSystem>(
  'brud.core.filesystem',
  'Centralized atomic filesystem service',
);
