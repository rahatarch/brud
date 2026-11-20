# Handle errors

Tell refusals, failures and expired handles apart, and respond to each correctly.

## The three outcomes

| Outcome | What you see | What to do |
|---|---|---|
| Refused to resolve | `resolve(...)` returns `null` | Treat the API as unavailable to you. Do not retry in a loop |
| Expired or withdrawn handle | A call throws `EXPOSED_API_UNAVAILABLE` | Resolve again inside the current call |
| Failure | A call throws an error with a `code` | Read `error.code`, then handle or report it |

## Rules

- Branch on `error.code`. Never branch on message text.
- A refused caller never learns the reason. The host can read denial reasons with `kernel.readObservations()`.
- Boot failures are explained in [Error codes](../07-reference/error-codes.md).
- Over the daemon, errors arrive as protocol errors, and you can cancel long calls. See the [Protocol reference](../05-daemon/protocol-reference.md).

## Next steps

- [Troubleshooting](../07-reference/troubleshooting.md)
