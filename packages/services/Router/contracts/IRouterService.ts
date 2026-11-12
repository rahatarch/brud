import type { BrudOperationKind } from '@brud/kernel';
import type { BrudOperation } from '../../Parser/contracts/index.js';
import type {
  BrudRouteOptions,
  BrudRouteRegistration,
  BrudRouteResult,
} from './types.js';

/**
 * Level-1 Brud kind Router.
 *
 * Accepts boot-time kind registrations from kernel services, resolves the
 * owning service through the kernel access broker with its `ServiceToken`, and
 * dispatches parsed operations. It never routes to a plugin directly.
 */
export interface IRouterService {
  /**
   * Claims a kind on behalf of a Level-1 service.
   *
   * @throws RouterRegistrationClosedError when the boot window has closed.
   * @throws RouterInvalidKindError when the kind token is malformed.
   * @throws RouterKindCollisionError when another service already owns it.
   * @throws RouterUnknownServiceError when the token is not registered.
   */
  register<TService>(registration: BrudRouteRegistration<TService>): void;

  /** Seals the registration window. Idempotent. */
  closeRegistration(): void;

  /** Whether new kinds may still be claimed. */
  isRegistrationOpen(): boolean;

  /** Kinds currently claimed, in registration order. */
  registeredKinds(): readonly BrudOperationKind[];

  /**
   * Parses a raw document with `brud.core.parser` and routes every operation.
   *
   * @param rawInput - Raw `[BRUD]` document.
   * @param options - Caller context and routing bounds.
   */
  route(rawInput: string, options?: BrudRouteOptions): Promise<BrudRouteResult>;

  /**
   * Routes an already-parsed operation list.
   *
   * @param operations - Operations emitted by the Parser.
   * @param options - Caller context and routing bounds.
   */
  dispatch(
    operations: readonly BrudOperation[],
    options?: BrudRouteOptions,
  ): Promise<BrudRouteResult>;
}