import { failingServiceOf } from '../engine/BrudKernel.js';

/** A loaded participant the kernel left out, and why. */
export interface AbandonedParticipant {
  /** The path the config declared for it. */
  readonly path: string;
  /** Its service token, when it got far enough to have one. */
  readonly participant?: string;
  /** The error code that left it out, when the failure had one. */
  readonly code?: string;
  /** What was wrong, in plain words. */
  readonly reason: string;
}

/**
 * One or more loaded participants cannot be part of this boot.
 *
 * The boot driver catches it, leaves them out, and tries again. It is thrown
 * only for loaded participants: a failure in a hardcore or composed
 * participant is never wrapped in it.
 */
export class LoadedParticipantFailure extends Error {
  public readonly participants: readonly AbandonedParticipant[];

  constructor(participants: readonly AbandonedParticipant[]) {
    super(`Loaded participant(s) cannot start: ${participants.map((entry) => `${entry.path} (${entry.reason})`).join('; ')}`);
    this.name = 'LoadedParticipantFailure';
    this.participants = participants;
  }
}

/** Describes a failure as an abandoned loaded participant. */
export function abandonment(path: string, error: unknown, participant?: string): AbandonedParticipant {
  const code = error !== null && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;

  return {
    path,
    ...(participant === undefined ? {} : { participant }),
    ...(typeof code === 'string' ? { code } : {}),
    reason: error instanceof Error ? error.message : String(error),
  };
}

/**
 * The service token an error blames: the participant the error itself names
 * (a check one participant's declaration failed), else the service whose
 * lifecycle code threw it. Looks through `cause`.
 */
export function culpritOf(error: unknown): string | undefined {
  for (let current: unknown = error, depth = 0; current !== null && typeof current === 'object' && depth < 5; depth += 1) {
    const named = (current as { participant?: unknown }).participant;

    if (typeof named === 'string') {
      return named;
    }

    const failing = failingServiceOf(current);

    if (failing !== undefined) {
      return failing;
    }

    current = (current as { cause?: unknown }).cause;
  }

  return undefined;
}
