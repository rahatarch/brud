# Error codes

Branch on `code`, never on the message. The complete generated list, with defining files, is [`docs/kernel-api/catalogue/error-codes.md`](../../docs/kernel-api/catalogue/error-codes.md). This page explains the ones you will meet first.

## Config and boot

| Code | Meaning | Usual fix |
|---|---|---|
| `CONFIG_READ` | Config unreadable | Check the path |
| `CONFIG_PARSE` | Not valid JSON | Validate the file |
| `CONFIG_SCHEMA` | Wrong shape or unknown key | Keep only `services` and `exposureOwners` where documented |
| `CONFIG_INTEGRITY` | A protected path was touched | Shut the kernel down first |
| `MODULE_RESOLVE` | Module missing, unimportable or not official | Use an absolute path, mark `official: true` |
| `MODULE_CONTRACT` | No valid `createService` | Export what the loader expects |
| `PARTICIPANT_TIER` | Tier not allowed | Remove the tier claim |
| `HARDCORE_VERIFICATION` | Hardcore failed its pin | Reinstall the matching release |
| `PARTICIPANT_MANIFEST_INVALID` | Manifest malformed | Check against [the manifest page](../03-concepts/manifest.md) |

## Exposures

| Code | Meaning |
|---|---|
| `EXPOSED_API_UNAVAILABLE` | A handle was used after its chain ended, or access was withdrawn |
| `EXPOSED_API_NAME_COLLISION` | The name already belongs to another participant |
| `EXPOSED_API_OWNER_PIN` | The composition pins this name to a different owner |
| `EXPOSED_API_SCOPE_NARROWED` | A minor change narrowed scope. Publish a new major version |
| `EXPOSED_API_INVALID_NAME` / `_SCOPE` / `_POLICY` / `_VERSION` | The declaration is malformed |
| `EXPOSED_API_REGISTRATION_CLOSED` | Registration after boot admission |

## Kinds and syntax

| Code | Meaning |
|---|---|
| `ROUTER_KIND_COLLISION` | Kind already owned |
| `ROUTER_REGISTRATION_CLOSED` | Registered too late |
| `ROUTER_INVALID_KIND` | Bad kind name |
| `ROUTER_UNKNOWN_SERVICE` | Kind points to something not exposed |
| `PARSE_ERROR` | Malformed Brud document |
| `OPERATION_LIMIT_EXCEEDED` | Too many operations in one document |

## Events and interception

| Code | Meaning |
|---|---|
| `EVENTS_NAME_COLLISION` | Event name already declared |
| `EVENTS_DUPLICATE_DECLARATION` | Declared twice |
| `INTERCEPTION_DECLARATION_INVALID` | Mismatched interception and point |
| `INTERCEPTION_BLOCKED` | An interceptor blocked the call |

## Lifecycle

| Code | Meaning |
|---|---|
| `INVALID_LIFECYCLE_STATE` | Called in the wrong kernel state |
| `CIRCULAR_DEPENDENCY` / `MISSING_DEPENDENCY` | Participant dependency graph is broken |

Daemon wire codes are in the [protocol reference](../05-daemon/protocol-reference.md).
