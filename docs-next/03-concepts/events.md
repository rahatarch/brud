# Events

Events are the pull-based way for one participant to tell others that something happened. Nothing is pushed. Subscribers ask for what they have not seen.

## Declare

The emitter is the event's giver and declares it in its manifest:

```js
events: [{ name: 'acme.note.added', version: 1, scope: 'runtime',
  payloadSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } }]
```

`payloadSchema` is a JSON Schema subset. Unsupported keywords fail closed. A name belongs to its first declarer (`EVENTS_NAME_COLLISION` otherwise).

## Use

Everything goes through exposures you get from `registry.resolve` (scope `runtime`). The calls are:

| Call | Result |
|---|---|
| `subscribe(name, { policy?, lastSequence?, subscriber? })` | A subscription id, or `null` if the event is unknown or scope/policy refuse you |
| `emit(name, payload)` | `{ ok: true, sequence, refusedSubscriptions }` or `{ ok: false, reason }`. Only the owner may emit |
| `pull(id, { lastSequence?, maxBatch? })` | A batch of events, or `{ refused: true, reason }` |
| `close(id)` | Ends the subscription. Only the subscriber may close |
| `list()` | Declared events as `name@major` |

Access is decided once, at **subscribe**.

## Delivery

- Each event has a per-event sequence number, the same for every subscriber.
- A bounded retention log (default 100) lets a subscriber reconnect with `lastSequence`.
- Each subscription has a queue bound (default 50) and a batch bound (default 10).
- On overflow the subscriber's choice applies: `drop-oldest` (default), `drop-newest`, or `refuse-emit`.

## Subscribing for someone else

The event's owner may pass `{ subscriber: callerView }` so the subscription belongs to the end subscriber. This is delegation by the owner.

Exact exposure names and shapes: [`docs/kernel-api/catalogue`](../../docs/kernel-api/catalogue/exposures.md).

**Next:** [Interception](interception.md)
