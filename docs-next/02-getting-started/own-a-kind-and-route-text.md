# Own a kind and route text

So far you called an API from code. Clients that cannot import your code, such as a UI or an AI agent, talk to the kernel with **text**. In this tutorial your participant owns an **operation kind** and answers text commands.

**You will learn:** what a kind is, the Brud syntax, how the Router finds your participant, and how to read results.

## A kind is a public word

An operation kind is a word clients use to address you: `note`, `photo`, `deploy`. Each kind has exactly one owner in a composition. If two participants claim the same kind, the boot fails.

A command looks like this:

```text
[BRUD]
[CALL note add]
text: buy milk
[END]
[/BRUD]
```

- `[BRUD]` ... `[/BRUD]` is the wrapper. Text outside it is ignored, so you can paste model output with chatter around it.
- `[CALL <kind> <operation>]` ... `[END]` is one operation. You can put several in one wrapper.
- Lines inside are `key: value` parameters. Values arrive as strings.
- For multi-line or literal text, use a brace region. The content is kept exactly as written:

```text
[CALL note add]
{text}
line one
line two: with a colon
{/text}
[END]
```

## The participant that owns `note`

`defineParticipant` accepts a `kinds` list too. This example is written as a plain descriptor so every part is visible:

```js
// notes.mjs
import { createServiceToken, withExposureBindings } from '@brud/kernel';

const token = createServiceToken('acme.notes', 'A tiny notebook');
const notes = [];

export function createService() {
  return {
    token,
    tier: 'userland',
    dependencies: [],
    manifest: {
      requests: { capabilities: [] },
      exposures: [{ name: 'acme.notes.dispatch', version: 1, scope: 'any', policy: { policyVersion: 2, official: true } }],
      kinds: [{
        kind: 'note',
        exposure: 'acme.notes.dispatch',
        description: 'Keep short notes',
        operations: {
          add: { description: 'Add a note', input: { type: 'object', properties: { text: { type: 'string' } } } },
          list: { description: 'List every note' },
        },
      }],
    },
    factory: () => withExposureBindings({}, {
      'acme.notes.dispatch@1': {
        projection: () => ({
          dispatch: async (operation, context) => {
            if (operation.name === 'add') {
              notes.push(String(operation.parameters.text ?? ''));
              return { status: 'success', data: { count: notes.length } };
            }
            if (operation.name === 'list') {
              return { status: 'success', data: { notes: [...notes], asked_by: context.caller.origin } };
            }
            return { status: 'failed', error: `note cannot ${operation.name}` };
          },
        }),
      },
    }),
  };
}
```

The key parts:

- **`kinds`** in the manifest says: the kind `note`, dispatched through the exposure `acme.notes.dispatch`. The description and operations are public, so clients can discover what the kind offers.
- **`dispatch(operation, context)`** is called once per operation. `operation.name` is `add` or `list`. `operation.parameters` holds the parsed parameters. `context.caller` is the kernel's view of who sent it.
- **The return value** is an operation result: `{ status: 'success', data }`, `{ status: 'failed', error }`, `{ status: 'skipped' }` or `{ status: 'aborted' }`.
- **`policy: { policyVersion: 2, official: true }`** on the dispatch exposure means only official callers may call it. That keeps strangers from calling `dispatch` directly with a made-up context. The Router is official, so it can.

## Send text to it

```js
// route-notes.mjs
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootKernel, provisionIdentityRegistryStorage, ExposedApiRegistryToken } from '@brud/kernel';

const here = import.meta.dirname;

const state = await mkdtemp(join(tmpdir(), 'brud-note-'));
const hardcores = ['identityRegistry', 'exposedApiRegistry', 'parser', 'router', 'wasmCage', 'events', 'interception']
  .map((name) => ({ path: `kernel:serviceModules/${name}.js`, official: true }));
const configPath = join(state, 'brud.config.json');
await writeFile(configPath, JSON.stringify({ services: [...hardcores, { path: join(here, 'notes.mjs'), official: true }] }));
const registryFile = join(state, 'identity.json');
provisionIdentityRegistryStorage(registryFile);
const kernel = await bootKernel(configPath, { options: { 'identity.registry.path': registryFile } });

const text = `[BRUD]
[CALL note add]
text: buy milk
[END]
[CALL note add]
text: call Sam
[END]
[CALL note list]
[END]
[/BRUD]`;

const result = await kernel.runHostCall({ capabilities: [] }, async () => {
  const registry = kernel.requestAccess({ callerId: 'my.host', tier: 'core', options: {} }, ExposedApiRegistryToken);
  const syntax = registry.resolve('syntax.route');
  return { routed: await syntax.route(text), kinds: syntax.kinds() };
});
console.log(JSON.stringify(result.routed, null, 1).slice(0, 900));
console.log(JSON.stringify(result.kinds));
await kernel.shutdown();
```

Run it:

```bash
node route-notes.mjs
```

The first part of the output is the route result (shortened here):

```text
{ "status": "success",
  "operations": [
    { "operationIndex": "1", "kind": "note", "name": "add", "status": "success", "result": { "status": "success", "data": { "count": 1 } } },
    { "operationIndex": "2", "kind": "note", "name": "add", "status": "success", "result": { "status": "success", "data": { "count": 2 } } },
    { "operationIndex": "3", "kind": "note", "name": "list", "status": "success",
      "result": { "status": "success", "data": { "notes": ["buy milk", "call Sam"], "asked_by": "host" } } } ],
  "dispatched": 3, "failed": 0 }
```

The second line printed is the public vocabulary the Router reports through `syntax.kinds()`: the kind `note`, its description and its operations.

## Reading a route result

| Field | Meaning |
|---|---|
| `status` | `success` (all ran), `partial` (some failed), `failed`, or `empty` |
| `operations[]` | One outcome per operation, in order |
| `operations[].status` | `success`, `failed`, `skipped`, `aborted`, or `kind_not_registered` |
| `operations[].result` | What your `dispatch` returned |
| `operations[].error` | A routing-level message, such as `KIND_NOT_REGISTERED: ...` |
| `dispatched`, `failed` | Counts |
| `parseError` | Present when the text could not be parsed; nothing is dispatched |

If a client asks for a kind nobody owns, that operation comes back as `kind_not_registered` and the rest still run.

**Next:** [Test your participant](test-your-participant.md)
