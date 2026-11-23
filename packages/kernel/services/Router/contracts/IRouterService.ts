import type { BrudOperationKind } from '../../../src/contracts/brudOperation.js';
import type { BrudOperation } from '../../Parser/contracts/index.js';
import type {
  BrudKindInfo,
  BrudDispatchCaller,
  BrudRouteOptions,
  BrudRouteRegistration,
  BrudRouteResult,
} from './types.js';

/**
 * Level-1 Brud kind Router.
 *
 * Accepts boot-time kind registrations from kernel services, resolves the
 * owning service through the kernel access broker with its `ServiceToken`, and
 * dispatches parsed operations. It routes only to the service that owns a kind.
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
  register(registration: BrudRouteRegistration): void;

  /** Seals the registration window. Idempotent. */
  closeRegistration(): void;

  /** Whether new kinds may still be claimed. */
  isRegistrationOpen(): boolean;

  /** Kinds currently claimed, in registration order. */
  registeredKinds(): readonly BrudOperationKind[];

  /** Public vocabulary: registered kinds with declared descriptions. */
  kinds(): readonly BrudKindInfo[];

  /**
   * Parses a raw document with `brud.core.parser` and routes every operation.
   *
   * @param rawInput - Raw `[BRUD]` document.
   * @param options - Caller context and routing bounds.
   */
  route(rawInput: string, options?: BrudRouteOptions, caller?: BrudDispatchCaller): Promise<BrudRouteResult>;

  /**
   * Routes an already-parsed operation list.
   *
   * @param operations - Operations emitted by the Parser.
   * @param options - Caller context and routing bounds.
   */
  dispatch(
    operations: readonly BrudOperation[],
    options?: BrudRouteOptions,
    caller?: BrudDispatchCaller,
  ): Promise<BrudRouteResult>;
}