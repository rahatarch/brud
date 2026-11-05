import type { IServiceLifecycle } from '../../../src/contracts/lifecycle.js';
import type {
  FileExistsProbe,
  IUtilityService,
  ResolveImportsOptions,
} from '../contracts/IUtilityService.js';
import { resolveImports as resolveImportsUtility } from '../utilities/import-resolver/index.js';

/**
 * Level-1 utility orchestrator.
 *
 * The instance is stateless: every call delegates to a pure utility function
 * with caller-supplied inputs. It holds no broker, no context, and no service
 * token, which is the D-20 Zero Dependency invariant.
 */
export class UtilityService implements IUtilityService, IServiceLifecycle {
  /**
   * Resolves local imports in a source string.
   *
   * Accepts either the named-option form or the legacy positional form. The
   * positional form is preserved so existing callers migrate without a
   * behavioural change.
   */
  public resolveImports(
    content: string,
    options: ResolveImportsOptions,
  ): Promise<string[]>;
  public resolveImports(
    content: string,
    filePath: string,
    fileExists: FileExistsProbe,
    customPatterns?: readonly string[],
  ): Promise<string[]>;
  public resolveImports(
    content: string,
    optionsOrPath: ResolveImportsOptions | string,
    fileExists?: FileExistsProbe,
    customPatterns?: readonly string[],
  ): Promise<string[]> {
    const options: ResolveImportsOptions = typeof optionsOrPath === 'string'
      ? {
          filePath: optionsOrPath,
          fileExists: fileExists ?? (() => false),
          ...(customPatterns === undefined ? {} : { customPatterns }),
        }
      : optionsOrPath;

    return resolveImportsUtility(
      content,
      options.filePath,
      async (path: string): Promise<boolean> => options.fileExists(path),
      options.customPatterns,
      options.language,
    );
  }

  /** Lifecycle no-op: the service holds no resources. */
  public initialize(): void {
    return undefined;
  }

  /** Lifecycle no-op: the service holds no resources. */
  public dispose(): void {
    return undefined;
  }
}