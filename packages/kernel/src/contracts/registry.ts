import type { OperationHandler } from './handler.js';

export interface IOperationRegistry {
  register(handler: OperationHandler): void;
  get(kind: string): OperationHandler | undefined;
  has(kind: string): boolean;
  list(): readonly OperationHandler[];
}