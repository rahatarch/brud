import type {
  EventDeclaration,
  KernelCallAuthority,
} from '../../../src/contracts/index.js';
import { compileJsonSchema } from '../../../src/validation/jsonSchema/index.js';
import type { CompiledJsonSchema } from '../../../src/validation/jsonSchema/index.js';
import { freezeJsonCopy } from '../../../src/validation/jsonSchema/jsonValue.js';
import {
  evaluateExposedApiPolicy,
  parseExposedApiPolicy,
} from '../../ExposedApiRegistry/contracts/policy.js';
import type { ExposedApiPolicyDecision } from '../../ExposedApiRegistry/contracts/policy.js';
import type { ExposedApiCaller, ExposedApiScope } from '../../ExposedApiRegistry/contracts/types.js';
import {
  EventDuplicateDeclarationError,
  EventNameCollisionError,
} from '../contracts/errors.js';
import type {
  EventDeliveryRecord,
  EventsBackpressurePolicy,
  EventsEmitResult,
  EventsPullOptions,
  EventsRefusal,
  EventsSubscribeOptions,
  IEventsService,
} from '../contracts/IEventsService.js';
import { eventsLimits } from './limits.js';

/** Source name the events hardcore records observations under. */
const OBSERVATION_SOURCE = 'brud.core.events';

const BACKPRESSURE_POLICIES: ReadonlySet<string> = new Set(['drop-oldest', 'refuse-emit', 'drop-newest']);

/** One declared event held in the events hardcore's catalogue. */
interface CatalogueEntry {
  readonly name: string;
  readonly major: number;
  readonly scope: string;
  readonly policy?: Readonly<Record<string, unknown>>;
  readonly payloadSchema?: Readonly<Record<string, unknown>>;
  readonly owner: string;
}

/** One event's retention log: a bounded ring plus its per-event sequence. */
interface EventLog {
  readonly entries: EventDeliveryRecord[];
  nextSequence: number;
}

/** One subscription: a cursor into its event's retention log. */
interface Subscription {
  readonly id: string;
  readonly event: string;
  readonly subscriber: ExposedApiCaller;
  readonly policy: EventsBackpressurePolicy;
  /** Last sequence delivered (or skipped past) for this subscription. */
  cursor: number;
  /** Sequences this subscription will never receive (backpressure). */
  readonly excluded: Set<number>;
  /** Tombstone set by `close`. */
  retired: boolean;
}

/** Extracts the integer major version from a numeric or semver version. */
function eventMajorVersion(version: number | string | undefined): number {
  if (version === undefined) {
    return 1;
  }

  if (typeof version === 'number') {
    return version;
  }

  return Number.parseInt(version.split('.')[0] ?? '', 10);
}

/** Formats the deterministic `name@major` key for a catalogue entry. */
function catalogueKey(name: string, major: number): string {
  return `${name}@${String(major)}`;
}

function refusal(reason: EventsRefusal['reason'], detail?: string): EventsRefusal {
  return Object.freeze({ refused: true, reason, ...(detail === undefined ? {} : { detail }) });
}

export class EventsService implements IEventsService {
  private authority: KernelCallAuthority | undefined;

  readonly #catalogue = new Map<string, CatalogueEntry>();

  readonly #owners = new Map<string, string>();

  readonly #logs = new Map<string, EventLog>();

  readonly #subscriptions = new Map<string, Subscription>();

  /** Compiled payload schemas per catalogue key, or the compile failure reason. */
  readonly #schemas = new Map<string, CompiledJsonSchema | string>();

  #nextSubscription = 1;

  public bindAuthority(value: KernelCallAuthority): void {
    this.authority = value;
  }

  /**
   * Registers one declared event in the boot-time catalogue under `owner`.
   *
   * Refuses name collisions across different owners and duplicate
   * `(name, major)` declarations by the same owner.
   */
  public registerDeclaration(owner: string, declaration: EventDeclaration): void {
    const { name } = declaration;
    const major = eventMajorVersion(declaration.version);
    const scope = declaration.scope ?? 'kernel';

    const nameOwner = this.#owners.get(name);

    if (nameOwner !== undefined && nameOwner !== owner) {
      throw new EventNameCollisionError(name, nameOwner);
    }

    const key = catalogueKey(name, major);

    if (this.#catalogue.has(key)) {
      throw new EventDuplicateDeclarationError(name, major);
    }

    this.#owners.set(name, owner);
    this.#catalogue.set(
      key,
      Object.freeze({
        name,
        major,
        scope,
        ...(declaration.policy === undefined ? {} : { policy: declaration.policy }),
        ...(declaration.payloadSchema === undefined ? {} : { payloadSchema: declaration.payloadSchema }),
        owner,
      }),
    );
  }

  public emit(name: string, payload: unknown): EventsEmitResult {
    return this.emitAs(this.#currentCaller(), name, payload);
  }

  public pull(subscriptionId: string, options?: EventsPullOptions): readonly EventDeliveryRecord[] | EventsRefusal {
    return this.pullAs(this.#currentCaller(), subscriptionId, options);
  }

  public close(subscriptionId: string): EventsRefusal | undefined {
    return this.closeAs(this.#currentCaller(), subscriptionId);
  }

  public list(): readonly string[] {
    return Array.from(this.#catalogue.keys());
  }

  public subscribe(eventName: string, options?: EventsSubscribeOptions): string | null {
    return this.subscribeAs(this.#currentCaller(), eventName, options);
  }

  /**
   * Emits `payload` on `name` for `caller` (the resolver of `events.emit`).
   *
   * Order: resolve the event; require the caller to be its catalogue owner;
   * validate the payload; assign the per-event sequence; enforce each
   * subscription's backpressure; append to the retention log.
   */
  public emitAs(caller: ExposedApiCaller | undefined, name: string, payload: unknown): EventsEmitResult {
    const event = this.#highestMajor(name);

    if (event === undefined) {
      return this.#refuseEmit('refused', `event "${name}" is not declared`, name);
    }

    if (caller?.identity === null || caller?.identity === undefined || caller.identity !== event.owner) {
      return this.#refuseEmit('refused', 'the emitter is not the event owner', name);
    }

    const key = catalogueKey(event.name, event.major);
    const schema = this.#schemaFor(key, event);

    if (typeof schema === 'string') {
      return this.#refuseEmit('malformed', schema, name, 'events.emit.malformed');
    }

    const checked = schema.validate(payload);

    if (!checked.valid) {
      const detail = checked.violations
        .map((violation) => `${violation.instancePath || '/'}: ${violation.message}`)
        .join('; ');

      return this.#refuseEmit('malformed', detail, name, 'events.emit.malformed');
    }

    const log = this.#logFor(key);
    const sequence = log.nextSequence;

    log.nextSequence += 1;

    const record: EventDeliveryRecord = Object.freeze({
      eventName: event.name,
      eventVersion: event.major,
      emitterIdentity: caller.identity,
      emitOrigin: this.authority?.current()?.origin ?? caller.origin,
      sequence,
      payload: freezeJsonCopy(payload),
    });
    const limits = eventsLimits();
    const refusedSubscriptions: string[] = [];

    for (const subscription of this.#subscriptions.values()) {
      if (subscription.event !== key || subscription.retired) {
        continue;
      }

      const pending = log.entries.filter((entry) =>
        entry.sequence > subscription.cursor && !subscription.excluded.has(entry.sequence));

      if (pending.length < limits.queueDepth) {
        continue;
      }

      if (subscription.policy === 'drop-oldest') {
        const oldest = pending[0]?.sequence ?? subscription.cursor;

        subscription.cursor = oldest;
        this.#observe('events.delivery.dropped', { subscription: subscription.id, sequence: oldest, reason: 'drop-oldest' });
        continue;
      }

      subscription.excluded.add(sequence);

      if (subscription.policy === 'refuse-emit') {
        refusedSubscriptions.push(subscription.id);
      }

      this.#observe('events.delivery.dropped', { subscription: subscription.id, sequence, reason: subscription.policy });
    }

    log.entries.push(record);

    while (log.entries.length > limits.retentionDepth) {
      log.entries.shift();
    }

    this.#pruneExcluded(key, log);

    return Object.freeze({ ok: true, sequence, refusedSubscriptions: Object.freeze(refusedSubscriptions) });
  }

  /**
   * Pulls the next bounded batch for `caller`, which must be the subscriber.
   *
   * Scope and policy are not re-evaluated here: they were decided at subscribe
   * (the giver's decision) and the registry re-checks the `events.pull`
   * exposure's scope on every handle use. A participant's identity, class,
   * capabilities, official status and origin are fixed at admission, so the
   * outcome can only change through a reload or reboot.
   */
  public pullAs(
    caller: ExposedApiCaller | undefined,
    subscriptionId: string,
    options?: EventsPullOptions,
  ): readonly EventDeliveryRecord[] | EventsRefusal {
    const subscription = this.#subscriptions.get(subscriptionId);

    if (subscription === undefined) {
      return this.#refusePull(subscriptionId, refusal('unknown-subscription'));
    }

    if (caller?.identity === null || caller?.identity === undefined || caller.identity !== subscription.subscriber.identity) {
      return this.#refusePull(subscriptionId, refusal('not-subscriber'));
    }

    if (subscription.retired) {
      return this.#refusePull(subscriptionId, refusal('closed'));
    }

    const limits = eventsLimits();
    const requested = options?.maxBatch ?? limits.batchSize;
    const max = Math.max(0, Math.min(limits.batchSize, Math.floor(requested)));
    const start = options?.lastSequence ?? subscription.cursor;
    const entries = (this.#logs.get(subscription.event)?.entries ?? [])
      .filter((entry) => entry.sequence > start && !subscription.excluded.has(entry.sequence))
      .slice(0, max);
    const last = entries[entries.length - 1];

    subscription.cursor = last === undefined ? start : last.sequence;

    return Object.freeze(entries);
  }

  /** Tombstones the subscription; only its subscriber may close it. */
  public closeAs(caller: ExposedApiCaller | undefined, subscriptionId: string): EventsRefusal | undefined {
    const subscription = this.#subscriptions.get(subscriptionId);

    if (subscription === undefined) {
      return refusal('unknown-subscription');
    }

    if (caller?.identity === null || caller?.identity === undefined || caller.identity !== subscription.subscriber.identity) {
      return refusal('not-subscriber');
    }

    subscription.retired = true;

    return undefined;
  }

  /**
   * Creates a subscription to the highest declared major of `eventName`.
   *
   * The subscriber is `caller` (a direct subscriber's own resolve) or, when
   * `options.subscriber` is given, the forwarded view; forwarding is honoured
   * only when `caller` is the event's catalogue owner (delegation by the
   * owner). The event's scope and the owner's policy are evaluated here,
   * against the subscriber's view (identity, class, capabilities, official,
   * origin). Returns the assigned identity `name@major#n`, or the uniform `null`.
   */
  public subscribeAs(
    caller: ExposedApiCaller | undefined,
    eventName: string,
    options?: EventsSubscribeOptions,
  ): string | null {
    const event = this.#highestMajor(eventName);

    if (event === undefined) {
      return this.#refuseSubscribe(eventName, 'unknown-event');
    }

    if (caller?.identity === null || caller?.identity === undefined) {
      return this.#refuseSubscribe(eventName, 'no-caller-identity');
    }

    let subscriber: ExposedApiCaller = caller;

    if (options?.subscriber !== undefined) {
      if (caller.identity !== event.owner) {
        return this.#refuseSubscribe(eventName, 'forwarded subscriber from a resolver that is not the owner');
      }

      subscriber = options.subscriber;
    }

    if (subscriber.identity === null) {
      return this.#refuseSubscribe(eventName, 'no-subscriber-identity');
    }

    const decision = this.#admits(event, subscriber);

    if (!decision.allowed) {
      return this.#refuseSubscribe(eventName, `policy-refused: ${decision.reason}`, subscriber);
    }

    const policy = options?.policy ?? 'drop-oldest';

    if (!BACKPRESSURE_POLICIES.has(policy)) {
      return this.#refuseSubscribe(eventName, 'unknown-backpressure-policy');
    }

    const lastSequence = options?.lastSequence;

    if (lastSequence !== undefined && (!Number.isInteger(lastSequence) || lastSequence < 0)) {
      return this.#refuseSubscribe(eventName, 'invalid-last-sequence');
    }

    const key = catalogueKey(event.name, event.major);
    const subscriptionId = `${key}#${String(this.#nextSubscription)}`;

    this.#nextSubscription += 1;
    this.#subscriptions.set(subscriptionId, {
      id: subscriptionId,
      event: key,
      subscriber: Object.freeze({
        identity: subscriber.identity,
        callerClass: subscriber.callerClass,
        official: subscriber.official,
        capabilities: new Set(subscriber.capabilities),
        origin: subscriber.origin,
      }),
      policy,
      cursor: lastSequence ?? 0,
      excluded: new Set<number>(),
      retired: false,
    });

    return subscriptionId;
  }

  /** The current chain's caller as a caller view (direct-access path). */
  #currentCaller(): ExposedApiCaller | undefined {
    const context = this.authority?.current();

    return context === undefined ? undefined : { ...context.caller, origin: context.origin };
  }

  #highestMajor(name: string): CatalogueEntry | undefined {
    let event: CatalogueEntry | undefined;

    for (const entry of this.#catalogue.values()) {
      if (entry.name === name && (event === undefined || entry.major > event.major)) {
        event = entry;
      }
    }

    return event;
  }

  #schemaFor(key: string, event: CatalogueEntry): CompiledJsonSchema | string {
    let schema = this.#schemas.get(key);

    if (schema === undefined) {
      const compiled = compileJsonSchema(event.payloadSchema ?? {});

      schema = compiled.ok
        ? compiled.schema
        : `payload schema is invalid: ${compiled.errors.map((error) => error.message).join('; ')}`;
      this.#schemas.set(key, schema);
    }

    return schema;
  }

  #logFor(key: string): EventLog {
    let log = this.#logs.get(key);

    if (log === undefined) {
      log = { entries: [], nextSequence: 1 };
      this.#logs.set(key, log);
    }

    return log;
  }

  #pruneExcluded(key: string, log: EventLog): void {
    const oldest = log.entries[0]?.sequence;

    if (oldest === undefined) {
      return;
    }

    for (const subscription of this.#subscriptions.values()) {
      if (subscription.event === key) {
        for (const sequence of subscription.excluded) {
          if (sequence < oldest) {
            subscription.excluded.delete(sequence);
          }
        }
      }
    }
  }

  /** Evaluates the event's scope and the owner's policy for `subscriber`. */
  #admits(event: CatalogueEntry, subscriber: ExposedApiCaller): ExposedApiPolicyDecision {
    try {
      return evaluateExposedApiPolicy(
        parseExposedApiPolicy(event.policy),
        event.scope as ExposedApiScope,
        {
          origin: subscriber.origin,
          caller: {
            identity: subscriber.identity,
            callerClass: subscriber.callerClass,
            official: subscriber.official,
            capabilities: subscriber.capabilities,
          },
        },
      );
    } catch (error) {
      return { allowed: false, reason: error instanceof Error ? error.message : 'policy evaluation failed' };
    }
  }

  #refuseEmit(
    reason: 'malformed' | 'refused',
    detail: string,
    name: string,
    observation: 'events.emit.malformed' | 'events.emit.refused' = 'events.emit.refused',
  ): EventsEmitResult {
    this.#observe(observation, { event: name, reason: detail });

    return Object.freeze({ ok: false, reason, detail });
  }

  #refusePull(subscriptionId: string, refused: EventsRefusal): EventsRefusal {
    this.#observe('events.pull.refused', {
      subscription: subscriptionId,
      reason: refused.reason,
      ...(refused.detail === undefined ? {} : { detail: refused.detail }),
    });

    return refused;
  }

  #refuseSubscribe(eventName: string, reason: string, subscriber?: ExposedApiCaller): null {
    this.#observe('events.subscribe.refused', {
      event: eventName,
      reason,
      ...(subscriber === undefined ? {} : { subscriber: subscriber.identity, origin: subscriber.origin }),
    });

    return null;
  }

  #observe(event: string, detail: Readonly<Record<string, unknown>>): void {
    this.authority?.observe(OBSERVATION_SOURCE, event, detail);
  }
}
