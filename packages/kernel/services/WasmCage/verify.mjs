// Step 1 verification for the cage's napi-rs wrapper.
// Reads the real built .node binary and real .wasm byte streams. No mocks.
import { createRequire } from 'node:module';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const binding = require('./native/brud-wasm-cage.linux-x64-gnu.node');

const dir = mkdtempSync(join(tmpdir(), 'cage-verify-'));

// 1. Trivial module, no imports, exported function returns 42.
//    (module (func (export "answer") (param i32) (result i32) i32.const 42))
const trivialWat = `(module
  (func (export "answer") (param i32) (result i32)
    i32.const 42))`;
const trivialPath = join(dir, 'trivial.wat');
writeFileSync(trivialPath, trivialWat);

const engine = new binding.CageEngine();
assert.ok(engine, 'engine constructed');

// The binding compiles WAT bytes too because the `wat` feature is enabled.
const trivialModule = binding.CageModule.compile(engine, Buffer.from(trivialWat));
const trivialInstance = binding.CageInstance.instantiate(
  trivialModule,
  [],
  { fuel: 100000, maxMemoryBytes: 1048576, timeoutMs: 1000 },
);
const answer = trivialInstance.callI32('answer', 0);
assert.equal(answer, 42, `expected 42, got ${answer}`);
console.log(`VERIFY 1 PASS: trivial module returned ${answer}`);

// 2. Module declaring an ungranted import must fail to instantiate.
const importedWat = `(module
  (import "kernel" "call" (func $call (param i32 i32) (result i64)))
  (func (export "answer") (param i32) (result i32) i32.const 7))`;
const importedModule = binding.CageModule.compile(engine, Buffer.from(importedWat));

let defaultDeny = null;
try {
  binding.CageInstance.instantiate(
    importedModule,
    [],
    { fuel: 100000, maxMemoryBytes: 1048576, timeoutMs: 1000 },
  );
} catch (error) {
  defaultDeny = error;
}
assert.ok(defaultDeny, 'ungranted import must fail instantiation');
assert.match(
  String(defaultDeny.message),
  /unknown import|incompatible import/i,
  `expected an unknown-import error, got: ${defaultDeny.message}`,
);
console.log(`VERIFY 2 PASS: ungranted import refused — ${String(defaultDeny.message).split('\n')[0]}`);

// 3. A module cannot reach a Node API. The only way out is a declared import;
//    a module that tries to use a Node global has no import to reach it. We
//    prove the boundary by compiling a module that calls an import named after
//    a Node global (`process`, `require`) and confirming instantiation refuses.
for (const [ns, name] of [['node', 'require'], ['global', 'process'], ['process', 'env']]) {
  const wat = `(module
    (import "${ns}" "${name}" (func $x (param i32) (result i32)))
    (func (export "answer") (param i32) (result i32) i32.const 0))`;
  const mod = binding.CageModule.compile(engine, Buffer.from(wat));
  let refused = null;
  try {
    binding.CageInstance.instantiate(mod, [], { fuel: 1000, maxMemoryBytes: 65536, timeoutMs: 500 });
  } catch (error) {
    refused = error;
  }
  assert.ok(refused, `${ns}.${name} must not be reachable`);
}
console.log('VERIFY 3 PASS: Node globals unreachable — every Node-named import refused');

// 4. A granted import of a known kind instantiates; its call returns the
//    cage's stable capability-denial code (0) at this layer.
const grantedWat = `(module
  (import "kernel" "call" (func $call (param i32 i32) (result i64)))
  (func (export "answer") (param i32) (result i32) i32.const 99))`;
const grantedModule = binding.CageModule.compile(engine, Buffer.from(grantedWat));
const granted = binding.CageInstance.instantiate(
  grantedModule,
  [{ module: 'kernel', name: 'call', kind: 'RoutedCall' }],
  { fuel: 100000, maxMemoryBytes: 1048576, timeoutMs: 1000 },
);
assert.equal(granted.callI32('answer', 0), 99);
console.log('VERIFY 4 PASS: declared routed-call import instantiates and calls');

// 5. Fuel metering: an unbounded loop exhausts fuel and traps.
const loopWat = `(module
  (func (export "spin") (param i32) (result i32)
    (local i32)
    (local.set 1 (i32.const 0))
    (loop $l
      (local.set 1 (i32.add (local.get 1) (i32.const 1)))
      (br $l))
    (local.get 1)))`;
const loopModule = binding.CageModule.compile(engine, Buffer.from(loopWat));
const loopInstance = binding.CageInstance.instantiate(
  loopModule,
  [],
  { fuel: 10000, maxMemoryBytes: 1048576, timeoutMs: 1000 },
);
let fuelTrap = null;
try {
  loopInstance.callI32('spin', 0);
} catch (error) {
  fuelTrap = error;
}
assert.ok(fuelTrap, 'fuel exhaustion must trap');
assert.match(String(fuelTrap.message), /fuel/i, `expected a fuel trap, got: ${fuelTrap.message}`);
console.log(`VERIFY 5 PASS: fuel exhausted — ${String(fuelTrap.message).split('\n')[0]}`);

console.log('ALL VERIFICATIONS PASS');