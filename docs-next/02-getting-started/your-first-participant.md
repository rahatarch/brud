# Your first participant

You will write a participant that gives one API: `acme.greet`, which says hello.

**You will learn:** what a participant is in code, what an exposure is, and how a handle is shaped for the caller.

## The code

A participant is an ES module that exports `createService`. The SDK's `defineParticipant` builds it for you.

```js
// greeter.mjs
import { defineParticipant } from '@brud/sdk/participant';

class Greeter {
  greet(name) {
    return `hello, ${name}`;
  }
}

export const createService = defineParticipant({
  id: 'acme.greeter',
  description: 'Says hello',
  create: () => new Greeter(),
  exposes: {
    'acme.greet': {
      version: 1,
      scope: 'any',
      handle: (caller, ctx) => ({
        greet: (name) => `${ctx.instance.greet(name)} (asked by ${caller.callerClass})`,
      }),
    },
  },
});
```

## What each part does

- **`id: 'acme.greeter'`** is the participant's declared name. It is dotted and lower-case. The kernel issues its separate *identity* at boot.
- **`create`** builds the participant's instance. Here it is a plain `Greeter` class.
- **`exposes`** lists the APIs this participant gives. The key, `'acme.greet'`, is the exposure name callers will resolve.
- **`version: 1`** is the exposure's major version. Callers resolve `acme.greet` and get version 1 unless they ask otherwise.
- **`scope: 'any'`** says who may even try to reach it. See [Exposures, scope and policy](../03-concepts/exposures-scope-and-policy.md). `any` admits every kind of caller.
- **`handle`** runs every time someone resolves the exposure. It receives the **real caller's view** (`caller`) and returns the object that caller will hold. Return `null` to refuse.

Notice what `handle` returns: not the `Greeter` itself, but a small object with one method. That object is a **projection**. The caller never touches your instance. It only gets what you chose to show it.

The projection here reads `caller.callerClass` to prove the point: the caller cannot choose what this says. The kernel fills it in.

## Rules to remember

- Return plain JSON across the boundary if you want your API usable by caged participants too.
- Read the caller from the `handle` argument, not from inside the method.
- A participant does nothing until the kernel boots it. That is the next tutorial.

**Next:** [Boot a kernel and call it](boot-a-kernel-and-call-it.md)
