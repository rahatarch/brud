# The daemon

The daemon is a long-running process that hosts BrudOS kernels so other programs (an editor, an AI agent, a script) can use them over a local, authenticated connection.

It is a **pure host**. It knows no participant and no domain idea. The operator decides which composition it boots and which startup fields a client may set.

| Page | Read it to... |
|---|---|
| [Run the daemon](run-the-daemon.md) | Start it, write `daemon.json`, understand the home folder |
| [Connect a client](connect-a-client.md) | Boot a kernel and route text from code |
| [Protocol reference](protocol-reference.md) | See every method, error code and cancellation outcome |

Security properties of the channel are in the [Security model](../06-security/security-model.md).
