import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { CommandError } from '../../core/errors.js';
import { findPackageRoot } from '../../core/project.js';

/** Compiles an AssemblyScript source into a cage guest with the project's own `assemblyscript`. */
export function compileAssemblyScript(dir: string, source: string, outFile: string): Promise<void> {
  const root = findPackageRoot('assemblyscript', dir);

  if (root === undefined) {
    throw new CommandError('PACK_TOOLCHAIN_MISSING', 'assemblyscript is not installed in this guest project. Run `npm install --save-dev assemblyscript`, or name a prebuilt "module" instead of a "source"');
  }

  return new Promise((done, fail) => {
    execFile(process.execPath, [join(root, 'bin', 'asc.js'), source, '--outFile', outFile, '--optimize', '--runtime', 'stub', '--use', 'abort='], { cwd: dir }, (error, _stdout, stderr) => {
      if (error === null) {
        done();
      } else {
        fail(new CommandError('PACK_COMPILE_FAILED', `asc failed: ${stderr.trim().split('\n').slice(0, 6).join(' | ')}`));
      }
    });
  });
}
