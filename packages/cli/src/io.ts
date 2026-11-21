/** Everything a command touches in the outside world, so tests can substitute it. */
export interface Io {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly stdin: NodeJS.ReadableStream;
  readonly isTty: boolean;
}

/** The process-backed {@link Io} the `brud` binary uses. */
export function createProcessIo(): Io {
  return {
    out: (text) => {
      process.stdout.write(text);
    },
    err: (text) => {
      process.stderr.write(text);
    },
    cwd: process.cwd(),
    env: process.env,
    stdin: process.stdin,
    isTty: process.stdout.isTTY,
  };
}
