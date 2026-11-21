import { fileURLToPath } from 'node:url';

/** The folder of this CLI package, found from `src/core/` (tests) or `dist/core/` (installed) alike. */
export const PACKAGE_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Where `brud init` copies its templates from. */
export const TEMPLATES_DIR = fileURLToPath(new URL('../../templates/', import.meta.url));

/** Where the prebuilt guest runtimes live. */
export const RUNTIME_DIR = fileURLToPath(new URL('../../runtime/', import.meta.url));
