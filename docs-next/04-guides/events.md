# Emit and subscribe to events

**Goal:** announce `acme.note.added` and let others follow it.

**Emitter**

1. Declare the event in `manifest.events` with a `payloadSchema`.
2. Resolve the events exposure and call `emit(name, payload)`. Only the owner may emit. A bad payload returns `{ ok: false, reason: 'malformed' }` and uses no sequence number.

**Subscriber**

1. `subscribe(name, { lastSequence? })` returns an id, or `null` if refused.
2. Call `pull(id, { maxBatch? })` whenever you want new events.
3. Remember the last `sequence` you saw. Pass it back to resume after a reconnect.
4. `close(id)` when done.

Pick a backpressure mode at subscribe if the default `drop-oldest` is wrong for you. Concepts and limits: [Events](../03-concepts/events.md).
