import { builtinModules } from 'node:module';
import { CommandError } from '../../../core/errors.js';
import { loadPackage } from '../../../core/project.js';

interface EsbuildMessage {
  readonly text: string;
  readonly location?: { readonly file: string; readonly line: number } | null;
}

interface Esbuild {
  build(options: Record<string, unknown>): Promise<{ readonly outputFiles: readonly { readonly text: string }[] }>;
}

const EXPORT_NAME = '__brud_module';

/** What the guest exposes as its handler: the default export, or a named `handler` export. */
const EPILOGUE = `\n;globalThis.handler = typeof ${EXPORT_NAME}.default === "function" ? ${EXPORT_NAME}.default : ${EXPORT_NAME}.handler;\n`;

const BUILTINS = new Set(builtinModules);
const UNRESOLVED = /^Could not resolve "([^"]+)"/u;

/** Says why a Node built-in import fails, or `undefined` when the message is about anything else. */
function explainBuiltin(text: string): string | undefined {
  const name = UNRESOLVED.exec(text)?.[1];
  const base = name?.replace(/^node:/u, '').split('/')[0];

  return name === undefined || base === undefined || !BUILTINS.has(base)
    ? undefined
    : `"${name}" is a Node module, and the cage has no Node modules. Remove the import and use what the guest runtime offers instead`;
}

function describeFailure(error: unknown): string {
  const messages = (error as { errors?: readonly EsbuildMessage[] }).errors;

  if (messages === undefined || messages.length === 0) {
    return (error as Error).message;
  }

  return messages.slice(0, 4).map((message) => `${message.location === null || message.location === undefined ? '' : `${message.location.file}:${message.location.line}: `}${explainBuiltin(message.text) ?? message.text}`).join(' | ');
}

/**
 * Bundles a JavaScript or TypeScript entry (and everything it imports) into
 * one script for the guest runtime, using the project's own `esbuild`. Types are
 * removed, not checked. Node built-ins cannot be resolved on purpose: the cage
 * has no Node.
 *
 * @throws {CommandError} `PACK_TOOLCHAIN_MISSING` without esbuild; `PACK_COMPILE_FAILED` on a bundling error.
 */
export async function bundleScript(dir: string, entry: string): Promise<string> {
  const esbuild = await loadPackage<Esbuild & { default?: Esbuild }>('esbuild', dir).catch(() => {
    throw new CommandError('PACK_TOOLCHAIN_MISSING', 'esbuild is not installed in this guest project. Run `npm install --save-dev esbuild` (it bundles and strips types from your JavaScript or TypeScript)');
  });
  const api = typeof esbuild.module.build === 'function' ? esbuild.module : (esbuild.module.default as Esbuild);

  try {
    const result = await api.build({
      entryPoints: [entry],
      absWorkingDir: dir,
      bundle: true,
      write: false,
      format: 'iife',
      globalName: EXPORT_NAME,
      platform: 'neutral',
      mainFields: ['module', 'main'],
      target: 'es2022',
      legalComments: 'none',
      logLevel: 'silent',
    });

    return `${result.outputFiles[0]?.text ?? ''}${EPILOGUE}`;
  } catch (error: unknown) {
    throw new CommandError('PACK_COMPILE_FAILED', `esbuild failed: ${describeFailure(error)}`);
  }
}
