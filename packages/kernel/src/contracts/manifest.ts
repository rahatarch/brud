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

/**
 * One interception a participant declares: it asks to intercept calls to an
 * exposure another participant gives. Held only by the interception hardcore;
 * it is not an exposure and is not reachable through `resolve`.
 */
export interface InterceptionDeclaration {
  /** Exposure name to intercept. */
  readonly target: string;

  /** Major version of the target; defaults to 1. */
  readonly version?: number | string;

  /**
   * The stages this interceptor takes part in: `'input'` (it sees a call's
   * arguments before the giver runs, and may modify or block them) and
   * `'output'` (it may append content to the giver's result). Defaults to
   * `['output']`: seeing or changing arguments must be asked for explicitly.
   * A declared stage must be implemented. An output interceptor that is not is
   * skipped; an input interceptor that is not blocks the call.
   */
  readonly stages?: readonly ('input' | 'output')[];
}

/**
 * One interception point a giver declares on one of its own exposures, naming
 * (by service token) the interceptors it admits, in the order they run.
 */
export interface InterceptionPointDeclaration {
  /** The giver's own exposure name. */
  readonly exposure: string;

  /** Major version of the exposure; defaults to 1. */
  readonly version?: number | string;

  /** Optional public description of the kind (shown to remote clients). */
  readonly description?: string;

  /**
   * Optional public operations of the kind: name → description and a JSON
   * Schema for its input. Plain JSON data; the owner may serve more.
   */
  readonly operations?: Readonly<Record<string, KindOperationDescription>>;

  /** Service tokens of the admitted interceptors, in run order. */
  readonly admit: readonly string[];

  /**
   * Lowers the kernel's output-stage limits for this point, in bytes of
   * canonical JSON. The Interception primitive validates the values; a value
   * can lower a kernel ceiling and never raise it.
   */
  readonly outputLimits?: Readonly<Record<string, number>>;
}

/**
 * One Brud Syntax kind a participant claims, served by one of its own
 * exposures (which must provide `dispatch(operation, context)`).
 */
/** Public description of one operation of a kind. */
export interface KindOperationDescription {
  readonly description?: string;
  /** JSON Schema of the operation's input (plain JSON). */
  readonly input?: Readonly<Record<string, unknown>>;
  /**
   * Who may call this operation: a Layer 1 policy object, in the same
   * language as an exposure's `policy`. Falls back to the kind's `permission`.
   * The Router validates and evaluates it; admission checks only its shape.
   */
  readonly permission?: Readonly<Record<string, unknown>>;
}

export interface KindDeclaration {
  /** The kind word written after `[CALL`, e.g. `tool`. */
  readonly kind: string;

  /** The participant's own exposure name that dispatches the kind. */
  readonly exposure: string;

  /** Major version of the exposure; defaults to 1. */
  readonly version?: number | string;

  /** Public description of the kind. */
  readonly description?: string;

  /**
   * Every operation the kind serves, by name. Required: the kernel refuses an
   * operation that is not listed, before the owner is reached.
   *
   * `'open'` declares that the owner defines the operation names itself (for
   * example from a registry filled at runtime), so the kernel cannot list them.
   * It must be written out, and the kind's `permission` is then required and is
   * enforced on every call; the owner decides which names exist.
   */
  readonly operations: Readonly<Record<string, KindOperationDescription>> | 'open';

  /** Default permission for operations that declare none; required when `operations` is `'open'`. */
  readonly permission?: Readonly<Record<string, unknown>>;
}

/** A participant's manifest. */
export interface ParticipantManifest {
  /** What the participant requests. */
  readonly requests?: ParticipantRequests;

  /** Exposures the participant gives. */
  readonly exposures?: readonly ExposureDeclaration[];

  /** Events the participant declares. */
  readonly events?: readonly EventDeclaration[];

  /** Interceptions the participant asks for. */
  readonly interceptions?: readonly InterceptionDeclaration[];

  /** Interception points the participant opens on its own exposures. */
  readonly interceptionPoints?: readonly InterceptionPointDeclaration[];
  readonly kinds?: readonly KindDeclaration[];
}

/** A manifest after the kernel has validated and frozen it. */
export interface AdmittedManifest {
  /** Requested capability tokens, deduplicated, in declaration order. */
  readonly capabilities: readonly string[];

  /** Declared exposures, deep-copied and frozen. */
  readonly exposures: readonly ExposureDeclaration[];

  /** Declared events, deep-copied and frozen. */
  readonly events: readonly EventDeclaration[];

  /** Declared interceptions, deep-copied and frozen. */
  readonly interceptions: readonly InterceptionDeclaration[];

  /** Declared interception points, deep-copied and frozen. */
  readonly interceptionPoints: readonly InterceptionPointDeclaration[];
  readonly kinds: readonly KindDeclaration[];
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

const MANIFEST_KEYS = new Set(['requests', 'exposures', 'events', 'interceptions', 'interceptionPoints', 'kinds']);
const KIND_KEYS = new Set(['kind', 'exposure', 'version', 'description', 'operations', 'permission']);
const KIND_OPERATION_KEYS = new Set(['description', 'input', 'permission']);
const KIND_OPERATION_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]*$/u;
const KIND_PATTERN = /^[a-z][a-z0-9_-]*$/u;
const REQUEST_KEYS = new Set(['capabilities']);
const EXPOSURE_KEYS = new Set(['name', 'version', 'scope', 'policy']);
const EVENT_KEYS = new Set(['name', 'version', 'scope', 'policy', 'payloadSchema']);
const INTERCEPTION_KEYS = new Set(['target', 'version', 'stages']);
const INTERCEPTION_POINT_KEYS = new Set(['exposure', 'version', 'admit', 'outputLimits']);

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
      interceptions: Object.freeze([]),
      interceptionPoints: Object.freeze([]),
      kinds: Object.freeze([]),
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

  const interceptions = admitInterceptions(data.interceptions, participant);
  const interceptionPoints = admitInterceptionPoints(data.interceptionPoints, participant);
  const kinds = admitKinds(data.kinds, exposures, participant);

  return Object.freeze({
    capabilities: Object.freeze(capabilities),
    exposures: Object.freeze(exposures),
    events: Object.freeze(events),
    interceptions,
    interceptionPoints,
    kinds,
  });
}

function assertVersion(value: unknown, path: string, participant: string): void {
  if (value !== undefined && typeof value !== 'number' && typeof value !== 'string') {
    throw new ParticipantManifestError(participant, `${path}.version must be a number or string`);
  }
}

function admitInterceptions(value: unknown, participant: string): readonly InterceptionDeclaration[] {
  if (value === undefined) {
    return Object.freeze([]);
  }

  if (!Array.isArray(value)) {
    throw new ParticipantManifestError(participant, 'manifest.interceptions must be an array');
  }

  return Object.freeze(value.map((entry: unknown, index): InterceptionDeclaration => {
    const path = `manifest.interceptions[${String(index)}]`;

    if (!isPlainObject(entry)) {
      throw new ParticipantManifestError(participant, `${path} must be an object`);
    }

    assertKnownKeys(entry, INTERCEPTION_KEYS, path, participant);

    if (typeof entry.target !== 'string' || entry.target.length === 0) {
      throw new ParticipantManifestError(participant, `${path}.target must be a non-empty string`);
    }

    assertVersion(entry.version, path, participant);

    const stages: unknown = entry.stages;

    if (
      stages !== undefined
      && (!Array.isArray(stages)
        || stages.length === 0
        || new Set(stages).size !== stages.length
        || stages.some((stage) => stage !== 'input' && stage !== 'output'))
    ) {
      throw new ParticipantManifestError(participant, `${path}.stages must be a non-empty list of unique "input" or "output"`);
    }

    return Object.freeze({
      ...(entry as unknown as InterceptionDeclaration),
      ...(stages === undefined ? {} : { stages: Object.freeze([...stages as ('input' | 'output')[]]) }),
    });
  }));
}

/**
 * Admits `manifest.kinds`. Each kind names one of the participant's own
 * declared exposures, lists every operation it serves, and gives each
 * operation a permission (its own, or the kind's); a kind may be claimed once
 * per manifest. The Router validates and evaluates the permissions.
 */
function admitKinds(
  value: unknown,
  exposures: readonly ExposureDeclaration[],
  participant: string,
): readonly KindDeclaration[] {
  if (value === undefined) {
    return Object.freeze([]);
  }

  if (!Array.isArray(value)) {
    throw new ParticipantManifestError(participant, 'manifest.kinds must be an array');
  }

  const seen = new Set<string>();

  return Object.freeze(value.map((entry: unknown, index): KindDeclaration => {
    const path = `manifest.kinds[${String(index)}]`;

    if (!isPlainObject(entry)) {
      throw new ParticipantManifestError(participant, `${path} must be an object`);
    }

    assertKnownKeys(entry, KIND_KEYS, path, participant);

    if (typeof entry.kind !== 'string' || !KIND_PATTERN.test(entry.kind)) {
      throw new ParticipantManifestError(participant, `${path}.kind must be a lower-case kind word`);
    }

    if (seen.has(entry.kind)) {
      throw new ParticipantManifestError(participant, `${path}.kind "${entry.kind}" is claimed twice`);
    }

    seen.add(entry.kind);

    if (typeof entry.exposure !== 'string' || entry.exposure.length === 0) {
      throw new ParticipantManifestError(participant, `${path}.exposure must be a non-empty string`);
    }

    assertVersion(entry.version, path, participant);
    const major = String(entry.version ?? 1);

    if (!exposures.some((exposure) => exposure.name === entry.exposure && String(exposure.version ?? 1) === major)) {
      throw new ParticipantManifestError(participant, `${path}.exposure must name one of the participant's own declared exposures`);
    }

    if (entry.description !== undefined && typeof entry.description !== 'string') {
      throw new ParticipantManifestError(participant, `${path}.description must be a string`);
    }

    if (entry.permission !== undefined && !isPlainObject(entry.permission)) {
      throw new ParticipantManifestError(participant, `${path}.permission must be a policy object`);
    }

    if (entry.operations === 'open') {
      if (entry.permission === undefined) {
        throw new ParticipantManifestError(
          participant,
          `${path}.permission is required when operations is "open"; write { "policyVersion": 2 } to allow every routing caller`,
        );
      }

      return Object.freeze(JSON.parse(JSON.stringify(entry)) as KindDeclaration);
    }

    if (!isPlainObject(entry.operations) || Object.keys(entry.operations).length === 0) {
      throw new ParticipantManifestError(
        participant,
        `${path}.operations is required: declare every operation the kind serves, or write "open" if its owner defines the names at runtime`,
      );
    }

    for (const [name, operation] of Object.entries(entry.operations)) {
      const at = `${path}.operations.${name}`;

      if (!KIND_OPERATION_PATTERN.test(name)) {
        throw new ParticipantManifestError(participant, `${at}: operation names start with a letter and use letters, digits, "_", "-" and "."`);
      }

      if (!isPlainObject(operation)) {
        throw new ParticipantManifestError(participant, `${at} must be an object`);
      }

      assertKnownKeys(operation, KIND_OPERATION_KEYS, at, participant);

      if (operation.description !== undefined && typeof operation.description !== 'string') {
        throw new ParticipantManifestError(participant, `${at}.description must be a string`);
      }

      if (operation.input !== undefined && !isPlainObject(operation.input)) {
        throw new ParticipantManifestError(participant, `${at}.input must be a JSON Schema object`);
      }

      if (operation.permission !== undefined && !isPlainObject(operation.permission)) {
        throw new ParticipantManifestError(participant, `${at}.permission must be a policy object`);
      }

      if (operation.permission === undefined && entry.permission === undefined) {
        throw new ParticipantManifestError(
          participant,
          `${at}.permission is required, or declare a kind-level permission; write { "policyVersion": 2 } to allow every routing caller`,
        );
      }
    }

    // Deep copy so the admitted declaration is plain, frozen data.
    return Object.freeze(JSON.parse(JSON.stringify(entry)) as KindDeclaration);
  }));
}

function admitInterceptionPoints(value: unknown, participant: string): readonly InterceptionPointDeclaration[] {
  if (value === undefined) {
    return Object.freeze([]);
  }

  if (!Array.isArray(value)) {
    throw new ParticipantManifestError(participant, 'manifest.interceptionPoints must be an array');
  }

  return Object.freeze(value.map((entry: unknown, index): InterceptionPointDeclaration => {
    const path = `manifest.interceptionPoints[${String(index)}]`;

    if (!isPlainObject(entry)) {
      throw new ParticipantManifestError(participant, `${path} must be an object`);
    }

    assertKnownKeys(entry, INTERCEPTION_POINT_KEYS, path, participant);

    if (typeof entry.exposure !== 'string' || entry.exposure.length === 0) {
      throw new ParticipantManifestError(participant, `${path}.exposure must be a non-empty string`);
    }

    assertVersion(entry.version, path, participant);

    const admit: unknown = entry.admit;

    if (
      !Array.isArray(admit)
      || admit.some((token) => typeof token !== 'string' || token.length === 0)
      || new Set(admit).size !== admit.length
    ) {
      const object = Array.isArray(admit) ? (admit as unknown[]).find((token) => isPlainObject(token) && typeof (token as { id?: unknown }).id === 'string') : undefined;
      const hint = object === undefined ? '' : ` A token object was given; pass its id string ("${(object as { id: string }).id}") instead`;

      throw new ParticipantManifestError(participant, `${path}.admit must be an array of unique non-empty service token id strings.${hint}`);
    }

    if (entry.outputLimits !== undefined && !isPlainObject(entry.outputLimits)) {
      throw new ParticipantManifestError(participant, `${path}.outputLimits must be an object`);
    }

    return Object.freeze({
      ...(entry as unknown as InterceptionPointDeclaration),
      admit: Object.freeze([...admit as string[]]),
      ...(entry.outputLimits === undefined ? {} : { outputLimits: Object.freeze({ ...(entry.outputLimits as Record<string, number>) }) }),
    });
  }));
}
