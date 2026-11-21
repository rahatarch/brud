import { writeFile } from 'node:fs/promises';
import { bundleScript } from './bundle.js';
import { loadRuntime } from './runtime.js';
import { fillSlot } from './slot.js';

/**
 * Builds a JavaScript or TypeScript guest: bundles the source, then writes the
 * verified runtime with the script in its slot to `outFile`. The cage runs the
 * result like any other `.wasm`; there is no compiler or bundler inside it.
 */
export async function buildJavaScriptGuest(dir: string, source: string, outFile: string): Promise<{ readonly scriptBytes: number }> {
  const script = await bundleScript(dir, source);
  const module = fillSlot(loadRuntime(), script);

  await writeFile(outFile, module);

  return { scriptBytes: Buffer.byteLength(script, 'utf8') };
}
