# Protocol reference

JSON-RPC 2.0 over a Noise-secured local channel. Protocol version `1.0.0`. Types live in `@brud/protocol`.

## Methods

| Method | Params | Result |
|---|---|---|
| `daemon.connect` | `protocolVersion`, `clientInfo?`, `capabilities?` | Connection id, tier, capabilities, server identity |
| `daemon.ping` | `nonce?` | Connection id, timestamp, nonce |
| `daemon.info` | none | Name, version, protocol version, pid, uptime |
| `kernel.requirements` | none | `fields[]`: name, type, required, description, declaring service, `clientSettable` |
| `kernel.boot` | `options?` | `instance`, `reused`, `pruned[]` |
| `kernel.attach` | `instanceId` | Status |
| `kernel.list` | none | Instances this connection is attached to |
| `kernel.status` | `instanceId` | Instance or `null` |
| `kernel.dispose` | `instanceId` | `{ disposed }` |
| `kernel.kinds` | `instanceId` | Kinds and their operations |
| `kernel.route` | `instanceId`, `text`, `stopOnFailure?`, `dryRun?`, `maxOperations?` | The Router's route result as JSON |
| `request.cancel` | `id` | `request.cancelled` |

Instance states: `booting`, `running`, `shutting-down`, `disposed`.

## Error codes

Standard JSON-RPC: `-32700` parse error, `-32600` invalid request, `-32601` method not found, `-32602` invalid params, `-32603` internal error.

BrudOS-specific:

| Code | Name | Meaning |
|---|---|---|
| -32001 | AUTH_FAILED | Authentication failed |
| -32002 | HANDSHAKE_REQUIRED | Send `daemon.connect` first |
| -32003 | WORKSPACE_MISMATCH | Wrong workspace or home |
| -32004 | PROTOCOL_VERSION_MISMATCH | Incompatible protocol version |
| -32005 | ALREADY_HANDSHAKEN | Handshake already done |
| -32010 | PATH_VIOLATION | A path left its allowed root |
| -32011 | READ_ONLY_VIOLATION | Write to a read-only target |
| -32012 | NOT_IMPLEMENTED | Not available |
| -32013 | FILE_NOT_FOUND | Missing file |
| -32014 | STORAGE_ERROR | Storage failure |
| -32015 | LIFECYCLE_STATE | Wrong state for this call |
| -32016 | ACCESS_DENIED | Not permitted |
| -32017 | RESOURCE_EXHAUSTED | A limit was hit |
| -32018 | REQUEST_TIMEOUT | Timed out |

Errors may carry `data` with `errorCode`, `reason`, `field` and `instanceId`.

## Cancellation

Send `request.cancel` with the id of the in-flight request. The daemon answers with `request.cancelled` and a status:

| Status | Meaning |
|---|---|
| `cancelled` | Signal delivered and the work stopped (operation status `aborted`) |
| `not-abortable` | Signal delivered, but the operation finished normally |
| `aborting` | Signal delivered, not yet settled within the grace window |
| `not-found` | Nothing in flight with that id |
| `invalid` | The frame did not name a valid id |

Route outcomes use four statuses: `success`, `failed`, `aborted`, `skipped`.
