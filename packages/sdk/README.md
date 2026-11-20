# @brud/sdk

The BrudOS SDK: define, compose and test participants on the [Brud kernel](https://www.npmjs.com/package/@brud/kernel).

## Install

```bash
npm install @brud/sdk @brud/kernel
```

Requires Node.js 22 or newer. `@brud/kernel` is a peer dependency.

## Entry points

| Import | Use it for |
|---|---|
| `@brud/sdk` | Core helpers |
| `@brud/sdk/participant` | `defineParticipant`, `byCapability` |
| `@brud/sdk/testing` | `bootTestKernel`, to test a participant against a real kernel |

## Example

```js
import { defineParticipant } from '@brud/sdk/participant';

export const createService = defineParticipant({
  id: 'acme.greeter',
  description: 'Says hello',
  create: () => ({ greet: (name) => `hello, ${name}` }),
  exposes: {
    'acme.greet': {
      version: 1,
      scope: 'any',
      handle: (caller, ctx) => ({ greet: (name) => ctx.instance.greet(name) }),
    },
  },
});
```

The giver (this participant) decides who may use `acme.greet`. Use `byCapability` to give different callers different handles.

## Documentation

[Getting started](https://github.com/rahatarch/brud/tree/main/docs-next/02-getting-started) · [Concepts](https://github.com/rahatarch/brud/tree/main/docs-next/03-concepts) · [Report an issue](https://github.com/rahatarch/brud/issues)

## License

[Apache-2.0](LICENSE)
