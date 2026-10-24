import { createServiceToken } from '../../../src/contracts/serviceToken.js';
import type { IBrudFileSystem } from '../contracts/IBrudFileSystem/IBrudFileSystem.js';

export const FileSystemToken = createServiceToken<IBrudFileSystem>(
  'brud.core.filesystem',
  'Centralized atomic filesystem service',
);
