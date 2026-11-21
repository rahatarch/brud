// Replaces every import except brud.* with a local function that returns
// ENOSYS (52) or does nothing (the clock reads 0), so a module built against WASI can run in the
// cage, which provides no WASI. Build-time tool; needs the `binaryen` package.
// usage: node stub-imports.mjs in.wasm out.wasm
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Loaded from the current folder, so run this from a folder where `npm i binaryen` was done.
const { default: binaryen } = await import(pathToFileURL(join(process.cwd(), 'node_modules', 'binaryen', 'index.js')).href);

const ENOSYS = 52;
const [input, output] = process.argv.slice(2);
const module = binaryen.readBinary(readFileSync(input));
const stubbed = [];

for (let index = module.getNumFunctions() - 1; index >= 0; index -= 1) {
  const info = binaryen.getFunctionInfo(module.getFunctionByIndex(index));

  if (info.module === '' || info.module === 'brud') {
    continue;
  }

  const results = binaryen.expandType(info.results);
  const body = info.base === 'clock_time_get'
    // A clock that always reads 0: the guest gets no wall-clock authority, and the engine's startup still succeeds.
    ? module.block(null, [module.i64.store(0, 8, module.local.get(2, binaryen.i32), module.i64.const(0n)), module.i32.const(0)], binaryen.i32)
    : results.length === 0 ? module.nop() : module.i32.const(ENOSYS);

  module.removeFunction(info.name);
  module.addFunction(info.name, info.params, info.results, [], body);
  stubbed.push(`${info.module}.${info.base}`);
}

if (!module.validate()) {
  throw new Error('module is invalid after stubbing');
}

writeFileSync(output, module.emitBinary());
console.log(`stubbed ${stubbed.length} imports: ${stubbed.join(', ')}`);
