import type { OperationHandler } from '../contracts/handler.js';
import type { IOperationRegistry } from '../contracts/registry.js';

export class OperationRegistry implements IOperationRegistry {
  private readonly handlers = new Map<string, OperationHandler>();

  register(handler: OperationHandler): void {
    if (this.handlers.has(handler.kind)) {
      throw new Error(`Operation "${handler.kind}" is already registered`);
    }
    this.handlers.set(handler.kind, handler);
  }

  get<TInput = unknown, TOutput = unknown>(kind: string): OperationHandler<TInput, TOutput> | undefined {
    return this.handlers.get(kind) as OperationHandler<TInput, TOutput> | undefined;
  }

  has(kind: string): boolean {
    return this.handlers.has(kind);
  }

  list(): readonly OperationHandler[] {
    return Array.from(this.handlers.values());
  }
}