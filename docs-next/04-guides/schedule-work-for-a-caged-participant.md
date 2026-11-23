# Schedule work for a caged participant

A caged participant has no timers and cannot start work of its own. It runs when something calls it. This guide shows how to give it recurring work, such as emitting an event every minute, without opening the cage.

## Before you begin

Read [The WASM cage](../03-concepts/the-wasm-cage.md) and [Emit and subscribe to events](events.md).

## How it works

A call into a caged participant runs under the origin of the chain that started it. When a participant's own timer starts that chain, the origin is `runtime`, and every call the guest makes from there is `runtime` too. That is the origin an event emit needs. A call started by the host has origin `host`, and the runtime-scope events exposures refuse it.

So the schedule belongs to a participant that can keep time, and the guest does the work when it is called.

## Steps

1. **Give the guest a `tick` exposure.** Declare it in the guest's manifest, with a scope and policy that admit the participant that owns the timer.

   ```json
   { "exposures": [{ "name": "acme.report.tick", "version": 1, "scope": "runtime" }] }
   ```

2. **Handle the tick in the guest.** In the handler for that exposure, do the work: emit the event the guest declared, or call another giver. These calls run as the guest, with the guest's own grants.

3. **Own the timer in a native participant.** After `onRunning`, resolve the guest's exposure once and call it from a timer.

   ```js
   const tick = registry.resolve('acme.report.tick');
   // 'run' is whatever method name the guest's handler switches on.
   setInterval(() => { tick?.run(); }, 60_000);
   ```

   The timer participant is composed or loaded like any other. Only a participant that is declared official runs native code, so the timer's owner is the builder of the composition.

## What to expect

- The guest still runs one call at a time, under its own fuel, memory and deadline. A tick that overruns fails that call and the kernel stays up.
- If a tick arrives while the guest is still busy, the call waits in the guest's line, and a call from inside the guest's own call is refused. Skip a tick when the last one has not finished.
- The guest cannot choose its own schedule. Whoever owns the timer decides when it runs, which keeps the cage closed.

## Next steps

- [Emit and subscribe to events](events.md)
- [The WASM cage](../03-concepts/the-wasm-cage.md)
