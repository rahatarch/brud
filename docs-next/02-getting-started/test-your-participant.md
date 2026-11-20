# Test your participant

Mocks hide the bugs that matter here: scope, policy and caller identity. So test against a **real kernel**. The SDK gives you one in a line.

**You will learn:** how to boot a real kernel inside a `node:test` test, and how to assert on what a caller can and cannot do.

## The harness

`bootTestKernel(t, entries)` from `@brud/sdk/testing` boots the seven hardcores plus the participants you list, in order, exactly as a product would. It shuts down and cleans up automatically through `t.after`.

Each entry is `{ path }`, an absolute path to your participant module.

## A test with two callers

First a participant whose API changes with the caller's capabilities:

```js
// vault.mjs
import { defineParticipant, byCapability } from '@brud/sdk/participant';
export const createService = defineParticipant({
  id: 'acme.vault',
  create: () => ({ secret: 's3cret' }),
  exposes: {
    'acme.vault': {
      scope: 'any',
      handle: byCapability({
        'vault:read': (ctx) => ({ read: () => ctx.instance.secret }),
        'vault:write': (ctx) => ({ write: (v) => { ctx.instance.secret = v; } }),
      }),
    },
  },
});
```

`byCapability` builds a handle from the capabilities the caller holds. A caller with `vault:read` gets `read`. With `vault:write` it also gets `write`. With neither it gets `null`.

Now the test:

```js
// vault.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { bootTestKernel } from '@brud/sdk/testing';
import { ExposedApiRegistryToken } from '@brud/kernel';

const here = import.meta.dirname;

/** Runs `use` as a host session holding `capabilities`, with the vault handle (or null). */
function asHost(kernel, capabilities, use) {
  return kernel.runHostCall({ capabilities }, () => {
    const registry = kernel.requestAccess({ callerId: 'test.host', tier: 'core', options: {} }, ExposedApiRegistryToken);
    return use(registry.resolve('acme.vault'));
  });
}

test('a caller gets only the surface its capabilities earn', async (t) => {
  const kernel = await bootTestKernel(t, [{ path: join(here, 'vault.mjs') }]);

  assert.equal(asHost(kernel, [], (vault) => vault), null);
  assert.deepEqual(asHost(kernel, ['vault:read'], (vault) => Object.keys(vault)), ['read']);
  assert.equal(asHost(kernel, ['vault:read', 'vault:write'], (vault) => {
    vault.write('new');
    return vault.read();
  }), 'new');
});
```

Run it:

```bash
node --test vault.test.mjs
```

What this checks:

- A host with no capabilities gets `null`.
- A host with `vault:read` sees exactly one method.
- A host with both can write then read.

The host's capabilities are the ones you pass to `runHostCall`. In a test you choose them freely, which makes it easy to try every case.

## Habits that pay off

- **Use the handle inside the host call.** Using it afterwards is refused.
- **Test the refusal as hard as the success.** A `null` handle and a thrown `EXPOSED_API_UNAVAILABLE` are features.
- **Match errors on `code`**, never on the message text. See [error codes](../07-reference/error-codes.md).
- **Do not mock the kernel.** The point is to see what the real kernel does with your manifest.

You have finished the tutorials. Continue with [Concepts](../03-concepts/README.md) to understand each part properly, or jump to a [guide](../04-guides/README.md).
