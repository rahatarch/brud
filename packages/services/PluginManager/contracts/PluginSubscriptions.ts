import type { IPluginDisposable, IPluginSubscriptions } from './IPluginContext.js';

/**
 * Default {@link IPluginSubscriptions} implementation.
 *
 * Disposables are released in strict reverse registration order. Every
 * disposable is attempted exactly once: a failing release does not prevent
 * later releases, and the first failure is rethrown after the remaining
 * resources have been released.
 */
export class PluginSubscriptions implements IPluginSubscriptions {
  private readonly disposables: IPluginDisposable[] = [];

  private disposed = false;

  /**
   * Registers a disposable for reverse-order release.
   *
   * @param disposable - Resource to release when the plugin unloads.
   * @throws Error when the subscription list has already been disposed; new
   * resources must be registered during activation.
   */
  add(disposable: IPluginDisposable): void {
    if (this.disposed) {
      throw new Error(
        'PluginSubscriptions is already disposed; register disposables before disposeAll()',
      );
    }

    this.disposables.push(disposable);
  }

  /**
   * Releases every registered disposable in reverse registration order.
   *
   * The call is idempotent: a second call after completion is a no-op. The
   * first release failure is rethrown after all disposables have been attempted.
   */
  async disposeAll(): Promise<void> {
    if (this.disposed) {
      return;
    }

    this.disposed = true;

    let firstError: unknown;

    for (let index = this.disposables.length - 1; index >= 0; index -= 1) {
      const disposable = this.disposables[index];
      if (disposable === undefined) {
        continue;
      }

      try {
        await disposable.dispose();
      } catch (error) {
        if (firstError === undefined) {
          firstError = error;
        }
      }
    }

    this.disposables.length = 0;

    if (firstError !== undefined) {
      throw firstError;
    }
  }
}
