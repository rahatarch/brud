# Handle errors

BrudOS separates three outcomes. Treat them differently.

| Outcome | Looks like | What to do |
|---|---|---|
| **Refused to resolve** | `resolve(...)` returns `null` | Treat as "not available to me". Do not retry in a loop |
| **Refused or expired handle** | Throws `EXPOSED_API_UNAVAILABLE` | You held a handle past its chain, or access was withdrawn. Resolve again inside the call |
| **Failure** | Throws a coded error | Read `error.code`, handle or report it |

Other points:

- Errors carry stable, machine-readable `code` values. Branch on `code`, never on message text.
- Denial *reasons* are never given to the refused caller. They go to the kernel observation stream (`kernel.readObservations()`), readable only by the host.
- Boot failures are listed in [Error codes](../07-reference/error-codes.md).
- Over the daemon, errors arrive as protocol errors, and long calls can be cancelled. See [Protocol reference](../05-daemon/protocol-reference.md).
