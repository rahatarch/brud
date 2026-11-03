/**
 * Open tool identity for Brud Protocol v2 operations.
 *
 * The 21 frozen operation kinds are no longer the only dispatchable names: a
 * `[CALL tool_name]` block may name any registered tool, so identity is an
 * open string and the frozen names are only a well-known subset.
 */

/** Dispatch name of a tool, open by design. */
export type BrudToolName = string;

/** @deprecated Use BrudToolName. Open alias retained for compatibility. */
export type BrudOperationKind = BrudToolName;

/** One scanned operation, before the kernel synthesizes its document index. */
export interface BrudScannedOperation {
  readonly toolName: BrudToolName;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly title?: string;
  readonly description?: string;
}

/** One parsed operation carrying its synthesized document index. */
export interface BrudOperation extends BrudScannedOperation {
  readonly index: string;
}
