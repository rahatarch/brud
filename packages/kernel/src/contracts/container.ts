export type Token<T> = symbol & { __brand: T };

/**
 * Planned: the token-keyed container is a universal kernel primitive. It is
 * constructed and consulted by the dispatch pipeline; no production module
 * registers into it yet.
 */
export function createToken<T>(description: string): Token<T> {
  return Symbol(description) as Token<T>;
}

export interface IServiceContainer {
  register<T>(token: Token<T>, provider: T | (() => T)): void;
  resolve<T>(token: Token<T>): T;
  has<T>(token: Token<T>): boolean;
  createChildScope(): IServiceContainer;
  freeze(): void;
  readonly isFrozen: boolean;
}