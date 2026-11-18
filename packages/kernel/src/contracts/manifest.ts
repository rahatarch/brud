/**
 * Participant manifest.
 *
 * A manifest is declarative data. It states what a participant requests and
 * which exposures it gives, with the scope and policy of each. It contains no
 * executable code. The kernel admits it at boot without invoking the
 * participant's factory, and the participant's code cannot add, change, or
 * remove an exposure afterwards.
 */

/** What a participant requests. A request is not a grant; the giver decides. */
export interface ParticipantRequests {
  /** Capability tokens the participant asks for. */
  readonly capabilities?: readonly string[];
}

/**
 * One exposure a participant declares.
 *
 * The resolution primitive interprets and validates every field. The kernel
 * core carries the declaration unchanged.
 */
export interface ExposureDeclaration {
  /** Stable exposure name. */
  readonly name: string;

  /** Version: a positive integer major version or a semantic version. */
  readonly version?: number | string;

  /** Reachability scope. */
  readonly scope?: string;

  /** Declarative Layer 1 policy for this exposure. */
  readonly policy?: Readonly<Record<string, unknown>>;
}

/**
 * One event a participant declares.
 *
 * A separate type from {@link ExposureDeclaration}: events are a push-model
 * observable, not a pull-model callable. For Step 3 the field set matches the
 * exposure declaration; the payload schema is deferred to the delivery step.
 */
export interface EventDeclaration {
  /** Stable event name. */
  readonly name: string;

  /** Version: a positive integer major version or a semantic version. */
  readonly version?: number | string;

  /** Reachability scope. */
  readonly scope?: string;

  /** Declarative Layer 1 policy for this event. */
  readonly policy?: Readonly<Record<string, unknown>>;

  /**
   * JSON Schema subset the emitted payload must satisfy. Admission checks only
   * that it is an object; the schema itself is compiled and enforced at emit.
   */
  readonly payloadSchema?: Readonly<Record<string, unknown>>;
}

/** A participant's manifest. */
export interface ParticipantManifest {
  /** What the participant requests. */
  readonly requests?: ParticipantRequests;

  /** Exposures the participant gives. */
  readonly exposures?: readonly ExposureDeclaration[];

  /** Events the participant declares. */
  readonly events?: readonly EventDeclaration[];
}

/** A manifest after the kernel has validated and frozen it. */
export interface AdmittedManifest {
  /** Requested capability tokens, deduplicated, in declaration order. */
  readonly capabilities: readonly string[];

  /** Declared exposures, deep-copied and frozen. */
  readonly exposures: readonly ExposureDeclaration[];

  /** Declared events, deep-copied and frozen. */
  readonly events: readonly EventDeclaration[];
}

/** Raised when a manifest is not valid declarative data. */
export class ParticipantManifestError extends Error {
  public readonly code = 'PARTICIPANT_MANIFEST_INVALID' as const;

  /** Token id of the participant whose manifest was refused. */
  public readonly participant: string;

  constructor(participant: string, reason: string) {
    super(`Manifest of participant "${participant}" is invalid: ${reason}`);
    this.name = 'ParticipantManifestError';
    this.participant = participant;
  }
}

const MANIFEST_KEYS = new Set(['requests', 'exposures', 'events']);
const REQUEST_KEYS = new Set(['capabilities']);
const EXPOSURE_KEYS = new Set(['name', 'version', 'scope', 'policy']);
const EVENT_KEYS = new Set(['name', 'version', 'scope', 'policy', 'payloadSchema']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value) as unknown;

  return prototype === Object.prototype || prototype === null;
}

/** Deep-copies plain JSON data, refusing anything that is not plain data. */
function cloneData(value: unknown, path: string, participant: string): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ParticipantManifestError(participant, `${path} must be a finite number`);
    }

    return value;
  }

  if (Array.isArray(value)) {
    return Object.freeze(value.map((item, index) =>
      cloneData(item, `${path}[${String(index)}]`, participant)));
  }

  if (isPlainObject(value)) {
    const copy: Record<string, unknown> = {};

    for (const [key, item] of Object.entries(value)) {
      copy[key] = cloneData(item, `${path}.${key}`, participant);
    }

    return Object.freeze(copy);
  }

  throw new ParticipantManifestError(participant, `${path} must be declarative data, not code`);
}

function assertKnownKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
  participant: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new ParticipantManifestError(participant, `${path} has unknown field "${key}"`);
    }
  }
}

/**
 * Validates and freezes a participant's manifest.
 *
 * Fails closed: an unknown field, a non-data value, or a malformed shape refuses
 * the manifest. An absent manifest admits no requests and no exposures.
 *
 * @param participant - Token id of the participant, used in diagnostics.
 * @param manifest - The declared manifest, or `undefined`.
 */
export function admitParticipantManifest(
  participant: string,
  manifest: unknown,
): AdmittedManifest {
  if (manifest === undefined) {
    return Object.freeze({
      capabilities: Object.freeze([]),
      exposures: Object.freeze([]),
      events: Object.freeze([]),
    });
  }

  const data = cloneData(manifest, 'manifest', participant);

  if (!isPlainObject(data)) {
    throw new ParticipantManifestError(participant, 'manifest must be an object');
  }

  assertKnownKeys(data, MANIFEST_KEYS, 'manifest', participant);

  const capabilities: string[] = [];
  const requests = data.requests;

  if (requests !== undefined) {
    if (!isPlainObject(requests)) {
      throw new ParticipantManifestError(participant, 'manifest.requests must be an object');
    }

    assertKnownKeys(requests, REQUEST_KEYS, 'manifest.requests', participant);

    const requested = requests.capabilities;

    if (requested !== undefined) {
      if (!Array.isArray(requested)) {
        throw new ParticipantManifestError(
          participant,
          'manifest.requests.capabilities must be an array',
        );
      }

      for (const capability of requested) {
        if (typeof capability !== 'string' || capability.length === 0) {
          throw new ParticipantManifestError(
            participant,
            'manifest.requests.capabilities must contain non-empty strings',
          );
        }

        if (!capabilities.includes(capability)) {
          capabilities.push(capability);
        }
      }
    }
  }

  const exposures: ExposureDeclaration[] = [];
  const declared = data.exposures;

  if (declared !== undefined) {
    if (!Array.isArray(declared)) {
      throw new ParticipantManifestError(participant, 'manifest.exposures must be an array');
    }

    declared.forEach((exposure: unknown, index) => {
      const path = `manifest.exposures[${String(index)}]`;

      if (!isPlainObject(exposure)) {
        throw new ParticipantManifestError(participant, `${path} must be an object`);
      }

      assertKnownKeys(exposure, EXPOSURE_KEYS, path, participant);

      if (typeof exposure.name !== 'string' || exposure.name.length === 0) {
        throw new ParticipantManifestError(participant, `${path}.name must be a non-empty string`);
      }

      if (
        exposure.version !== undefined
        && typeof exposure.version !== 'number'
        && typeof exposure.version !== 'string'
      ) {
        throw new ParticipantManifestError(participant, `${path}.version must be a number or string`);
      }

      if (exposure.scope !== undefined && typeof exposure.scope !== 'string') {
        throw new ParticipantManifestError(participant, `${path}.scope must be a string`);
      }

      if (exposure.policy !== undefined && !isPlainObject(exposure.policy)) {
        throw new ParticipantManifestError(participant, `${path}.policy must be an object`);
      }

      exposures.push(exposure as unknown as ExposureDeclaration);
    });
  }

  const events: EventDeclaration[] = [];
  const declaredEvents = data.events;

  if (declaredEvents !== undefined) {
    if (!Array.isArray(declaredEvents)) {
      throw new ParticipantManifestError(participant, 'manifest.events must be an array');
    }

    declaredEvents.forEach((event: unknown, index) => {
      const path = `manifest.events[${String(index)}]`;

      if (!isPlainObject(event)) {
        throw new ParticipantManifestError(participant, `${path} must be an object`);
      }

      assertKnownKeys(event, EVENT_KEYS, path, participant);

      if (typeof event.name !== 'string' || event.name.length === 0) {
        throw new ParticipantManifestError(participant, `${path}.name must be a non-empty string`);
      }

      if (
        event.version !== undefined
        && typeof event.version !== 'number'
        && typeof event.version !== 'string'
      ) {
        throw new ParticipantManifestError(participant, `${path}.version must be a number or string`);
      }

      if (event.scope !== undefined && typeof event.scope !== 'string') {
        throw new ParticipantManifestError(participant, `${path}.scope must be a string`);
      }

      if (event.policy !== undefined && !isPlainObject(event.policy)) {
        throw new ParticipantManifestError(participant, `${path}.policy must be an object`);
      }

      if (event.payloadSchema !== undefined && !isPlainObject(event.payloadSchema)) {
        throw new ParticipantManifestError(participant, `${path}.payloadSchema must be an object`);
      }

      events.push(event as unknown as EventDeclaration);
    });
  }

  return Object.freeze({
    capabilities: Object.freeze(capabilities),
    exposures: Object.freeze(exposures),
    events: Object.freeze(events),
  });
}
