/**
 * A named certification scope owned by exactly one service.
 *
 * The scope holds an unforgeable marker private to this instance. Branding is
 * an association between the scope and the target; copying a marker property
 * to another object cannot forge it because verification also checks the
 * scope's private membership set.
 */
export interface IBrandScope {
  /** Stable name this scope was registered under. */
  readonly name: string;

  /**
   * Applies this scope's unforgeable marker to `target`.
   *
   * Branding is idempotent for this scope and returns the same target so
   * callers can chain construction.
   *
   * @param target - Object to certify.
   * @returns The same target, now certified by this scope.
   */
  brand<TTarget extends object>(target: TTarget): TTarget;

  /**
   * Reports whether `target` was branded by this specific scope.
   *
   * A target branded by another scope returns `false`; a lookalike property
   * copied from a branded object also returns `false`.
   */
  verify(target: unknown): boolean;
}