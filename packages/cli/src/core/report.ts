import type { Io } from './io.js';

export type Status = 'pass' | 'fail' | 'warn' | 'info';

/** One line of a checklist: what was checked, what is wrong, and how to fix it. */
export interface Finding {
  readonly id: string;
  readonly title: string;
  readonly status: Status;
  /** One line: why it failed. */
  readonly cause?: string;
  /** One line: what to do about it. */
  readonly fix?: string;
}

/** Output switches shared by every command. */
export interface Style {
  readonly json: boolean;
  readonly color: boolean;
}

const MARK: Readonly<Record<Status, string>> = { pass: '[ok]', fail: '[x]', warn: '[!]', info: '[i]' };
const COLOR: Readonly<Record<Status, string>> = { pass: '32', fail: '31', warn: '33', info: '36' };

/** Colour is on only for a terminal that was not asked to go plain. */
export function styleFrom(io: Io, flags: ReadonlyMap<string, string | true>): Style {
  return {
    json: flags.get('json') === true,
    color: flags.get('no-color') !== true && io.isTty && io.env.NO_COLOR === undefined,
  };
}

/** Whether any finding failed (the command's non-zero exit). */
export function hasFailure(findings: readonly Finding[]): boolean {
  return findings.some((finding) => finding.status === 'fail');
}

/** Prints findings as a checklist, or as one JSON document under `--json`. */
export function printFindings(io: Io, style: Style, findings: readonly Finding[], extra: Readonly<Record<string, unknown>> = {}): void {
  if (style.json) {
    io.out(`${JSON.stringify({ ok: !hasFailure(findings), ...extra, findings }, null, 2)}\n`);
    return;
  }

  for (const finding of findings) {
    const mark = style.color ? `\u001B[${COLOR[finding.status]}m${MARK[finding.status]}\u001B[0m` : MARK[finding.status];

    io.out(`${mark} ${finding.title}\n`);

    if (finding.cause !== undefined) {
      io.out(`      cause: ${finding.cause}\n`);
    }

    if (finding.fix !== undefined) {
      io.out(`      fix:   ${finding.fix}\n`);
    }
  }

  const failed = findings.filter((finding) => finding.status === 'fail').length;
  const warned = findings.filter((finding) => finding.status === 'warn').length;

  io.out(failed === 0
    ? `\nNo problems found${warned === 0 ? '' : ` (${String(warned)} warning${warned === 1 ? '' : 's'})`}.\n`
    : `\n${String(failed)} problem${failed === 1 ? '' : 's'} found.\n`);
}

/** Prints a JSON document or the human text, whichever the style asks for. */
export function printData(io: Io, style: Style, data: unknown, human: () => string): void {
  io.out(style.json ? `${JSON.stringify(data, null, 2)}\n` : human());
}
