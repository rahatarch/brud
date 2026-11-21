// Benchmarks the same workloads three ways: native JS (V8), AssemblyScript in the
// real WASM cage, and JavaScript in the real WASM cage (the QuickJS runtime that
// `brud pack` ships, with handler.js in its slot). usage:
//   node run.mjs [--out results.json]
// Needs `npm run build:cli` first (it reads the CLI's built runtime) and `npm run build:as` here.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const kernelNative = resolve(here, '../../packages/kernel/dist/services/WasmCage/src/native.js');
const { loadVerifiedNative } = await import(kernelNative);
const cage = loadVerifiedNative();
const engine = new cage.CageEngine();
const FUEL = 4e12;
const WORKLOADS = [
  { method: 'empty', calls: 2000, note: 'empty handler (call overhead)' },
  { method: 'tiny', calls: 500, note: 'fib(20), about 22k calls' },
  { method: 'h1m', calls: 10, note: '1 million loop steps' },
  { method: 'h10m', calls: 3, note: '10 million loop steps' },
];
const request = (method) => JSON.stringify({ kind: 'invoke', exposure: 'bench.x@1', method, args: [], caller: { identity: 'b', callerClass: 'participant', official: false, capabilities: [], origin: 'bench' } });
const now = () => Number(process.hrtime.bigint()) / 1e6;
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const parse = (response) => (JSON.parse(response).value);

function native() {
  const handler = (() => { const g = {}; new Function('globalThis', readFileSync(join(here, 'handler.js'), 'utf8'))(g); return g.handler; })();
  const rows = [];

  for (const work of WORKLOADS) {
    const times = [];
    let value;

    for (let i = 0; i < work.calls; i += 1) {
      const text = request(work.method);
      const start = now();

      value = handler(JSON.parse(text));
      JSON.stringify({ ok: true, value });
      times.push(now() - start);
    }

    rows.push({ ...work, medianMs: median(times), value, fuel: null });
  }

  return { name: 'native JS (V8)', compileMs: null, instantiateMs: null, firstCallMs: null, rows };
}

function cagedFile(file) {
  return caged(file.split('/').pop(), readFileSync(file));
}

async function javascriptGuest() {
  const cli = resolve(here, '../../packages/cli/dist/commands/pack/javascript');
  const { loadRuntime } = await import(join(cli, 'runtime.js'));
  const { fillSlot } = await import(join(cli, 'slot.js'));

  return caged('quickjs (handler.js in the shipped runtime)', fillSlot(loadRuntime(), readFileSync(join(here, 'handler.js'), 'utf8')));
}

function caged(label, bytes) {
  const compileStart = now();
  const module = cage.CageModule.compile(engine, Buffer.from(bytes));
  const compileMs = now() - compileStart;
  const instStart = now();
  const instance = cage.CageInstance.instantiate(module, [{ module: 'brud', name: 'call', kind: 'RoutedCall' }], { fuel: FUEL, maxMemoryBytes: 128 * 1024 * 1024, timeoutMs: 0 });
  const instantiateMs = now() - instStart;
  const firstStart = now();

  instance.callJson('brud_invoke', request('empty'));
  const firstCallMs = now() - firstStart;
  const rows = [];

  for (const work of WORKLOADS) {
    const times = [];
    let value;
    let fuel;

    for (let i = 0; i < work.calls; i += 1) {
      const start = now();
      const step = instance.callJson('brud_invoke', request(work.method));

      times.push(now() - start);
      value = parse(step.response);
      fuel = FUEL - instance.fuelRemaining();
    }

    rows.push({ ...work, medianMs: median(times), value, fuel });
  }

  return { name: `${label} (in the WASM cage)`, sizeBytes: bytes.length, compileMs, instantiateMs, firstCallMs, rows };
}

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const out = outIndex >= 0 ? args.splice(outIndex, 2)[1] : undefined;
const buildDir = join(here, 'build');
const guests = existsSync(buildDir) ? readdirSync(buildDir).filter((f) => f.endsWith('.wasm') && f !== 'quickjs.wasm').sort().map((f) => join(buildDir, f)) : [];
const results = [native(), ...guests.map(cagedFile), await javascriptGuest()];

for (const result of results) {
  console.log(`\n${result.name}${result.sizeBytes === undefined ? '' : `, ${result.sizeBytes} bytes`}`);

  if (result.compileMs !== null) {
    console.log(`  compile ${result.compileMs.toFixed(1)} ms, instantiate ${result.instantiateMs.toFixed(1)} ms, first call ${result.firstCallMs.toFixed(2)} ms`);
  }

  for (const row of result.rows) {
    console.log(`  ${row.method.padEnd(6)} median ${row.medianMs.toFixed(3).padStart(10)} ms  value ${row.value}${row.fuel === null ? '' : `  fuel ${row.fuel}`}  (${row.note})`);
  }
}

const reference = results[0].rows.map((row) => row.value).join(',');

for (const result of results.slice(1)) {
  console.log(`\nresults match native JS (${result.name}): ${result.rows.map((row) => row.value).join(',') === reference}`);
}

if (out !== undefined) {
  writeFileSync(out, `${JSON.stringify({ node: process.version, platform: `${process.platform}-${process.arch}`, results }, null, 2)}\n`);
}
