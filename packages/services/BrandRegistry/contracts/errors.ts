/** Raised when a brand scope name is not a non-empty string. */
export class BrandScopeNameError extends Error {
  public readonly code = 'BRAND_SCOPE_NAME_INVALID' as const;

  constructor(name: unknown) {
    super(`Brand scope name must be a non-empty string; received ${String(name)}`);
    this.name = 'BrandScopeNameError';
  }
}

/** Raised when a scope name is already registered in this kernel. */
export class DuplicateBrandScopeError extends Error {
  public readonly code = 'BRAND_SCOPE_DUPLICATE' as const;

  public readonly scopeName: string;

  constructor(name: string) {
    super(`Brand scope "${name}" is already registered`);
    this.name = 'DuplicateBrandScopeError';
    this.scopeName = name;
  }
}

/** Raised when a new scope is requested after the boot window closed. */
export class BrandRegistryClosedError extends Error {
  public readonly code = 'BRAND_REGISTRY_CLOSED' as const;

  public readonly scopeName: string;

  constructor(name: string) {
    super(
      `Cannot create brand scope "${name}": the boot registration window is closed`,
    );
    this.name = 'BrandRegistryClosedError';
    this.scopeName = name;
  }
}

/** Raised when a target cannot carry an unforgeable marker. */
export class BrandTargetError extends Error {
  public readonly code = 'BRAND_TARGET_INVALID' as const;

  constructor(reason: string) {
    super(`Cannot brand target: ${reason}`);
    this.name = 'BrandTargetError';
  }
}