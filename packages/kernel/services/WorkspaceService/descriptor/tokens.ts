import { createServiceToken } from '../../../src/contracts/serviceToken.js';
import type { IWorkspaceService } from '../contracts/IWorkspaceService.js';

/**
 * Kernel service token for `brud.core.workspace`.
 *
 * Every caller may resolve this token: containment is a capability that only
 * narrows what a caller may touch, so exposing it never widens authority.
 */
export const WorkspaceToken = createServiceToken<IWorkspaceService>(
  'brud.core.workspace',
  'Canonical workspace identity and absolute/relative path translation service',
);
