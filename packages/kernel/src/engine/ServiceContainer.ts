import type { IServiceContainer, Token } from '../contracts/container.js';

export class ServiceContainer implements IServiceContainer {
  private readonly registry = new Map<symbol, { value: unknown } | { factory: () => unknown }>();
  private readonly parent: IServiceContainer | null;
  private _isFrozen = false;

  constructor(parent?: IServiceContainer) {
    this.parent = parent ?? null;
  }

  get isFrozen(): boolean {
    return this._isFrozen;
  }

  freeze(): void {
    this._isFrozen = true;
  }

  register<T>(token: Token<T>, provider: T | (() => T)): void {
    if (this._isFrozen) {
      throw new Error("SecurityFault: Cannot register services into a frozen ServiceContainer at runtime.");
    }
    if (typeof provider === 'function' && !('__brand' in (provider as object))) {
      this.registry.set(token, { factory: provider as () => unknown });
    } else {
      this.registry.set(token, { value: provider as unknown });
    }
  }

  resolve<T>(token: Token<T>): T {
    const entry = this.registry.get(token);
    if (entry) {
      if ('factory' in entry) {
        const instance = entry.factory() as T;
        this.registry.set(token, { value: instance });
        return instance;
      }
      return entry.value as T;
    }
    if (this.parent) {
      return this.parent.resolve(token);
    }
    throw new Error(`Unresolved token: ${token.description ?? String(token)}`);
  }

  has<T>(token: Token<T>): boolean {
    if (this.registry.has(token)) return true;
    return this.parent ? this.parent.has(token) : false;
  }

  createChildScope(): IServiceContainer {
    const child = new ServiceContainer(this);
    if (this._isFrozen) {
      child._isFrozen = true;
    }
    return child;
  }
}