# Emit and subscribe to events

Announce that something happened, such as `acme.note.added`, and let other participants follow it without being coupled to you.

## Before you begin

Read [Events](../03-concepts/events.md) for the delivery model.

## Emit an event

1. **Declare it** in `manifest.events` with a `payloadSchema`.
2. **Emit it.** Resolve the events exposure and call `emit(name, payload)`. Only the owner of the event may emit.

   An invalid payload returns `{ ok: false, reason: 'malformed' }` and uses no sequence number.

## Subscribe to an event

1. **Subscribe.** `subscribe(name, { lastSequence? })` returns a subscription id, or `null` if the event is unknown or you are refused.
2. **Pull.** Call `pull(id, { maxBatch? })` whenever you want new events.
3. **Remember the last `sequence`.** Pass it back as `lastSequence` to resume after a reconnect.
4. **Close.** Call `close(id)` when you are done.

> **Note**
> Access is decided once, when you subscribe. Choose a backpressure mode at that point if the default `drop-oldest` does not suit you.

## Next steps

- [Intercept calls](intercept-calls.md)
- [Events](../03-concepts/events.md) for retention and queue limits
