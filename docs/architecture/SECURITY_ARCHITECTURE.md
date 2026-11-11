# Brud OS Security Architecture: Host–Daemon Local Channel

Nov 11, 2026 · @Rahat Hasan

**Status.** Decided. This document is the security architecture decision record for the local channel between the host application and the kernel-hosting daemon on the same machine. It covers the threats to that channel and the decisions taken in response; it is not an implementation guide. It is the formal companion to the exploratory trust-tier proposal: the proposal considers how software inside either process is trusted, while this document considers the channel between the two. Decided 2026-11-11.

## 1. Scope and Threat Model

The system boundary is one machine, two processes, and one local channel. The host application presents the user and agent surfaces and initiates requests. The kernel-hosting daemon owns the workspace, the execution services, and the authority to mutate files and run commands. The channel carries requests, responses, streamed output, and lifecycle signals between them.

In scope are the authenticity of both endpoints, the confidentiality and integrity of channel traffic, the identity and authorization of the caller, the structural validity and ordering of messages, and the availability and lifetime of requests. The assets are the workspace, the daemon's execution authority, the operation history, the host's caller identity, and the daemon's availability.

The threat actors are another local user, an unprivileged local process, a process able to read or alter the local channel, a caller that supplies hostile content, and a caller that attempts to exceed its authority. The model assumes the operating system enforces its own local access controls correctly. Outside the defended boundary are other machines, network transports, a compromised operating system, physical access, and any process that already runs with the same operating-system identity as the host or daemon. The last case is Threat 9 and is recorded as an accepted risk in section 4.

## 2. Threats

Fourteen threats apply to this boundary. The identifiers are stable and are used by the decisions and the coverage table. Each threat states the exposure, then the chosen solution; the decision that defines the solution is cited.

### T-01 — Foreign-User Connection

Another operating-system user on the same machine discovers the local channel and opens a connection to the daemon. The daemon treats that connection as the legitimate host and exposes the authority behind the channel.

**Chosen solution.** Operating-system verification of the connecting process (D-01).

### T-02 — Rogue Endpoint

A different process binds or replaces the channel endpoint before the legitimate daemon does. The host connects to the impostor, discloses requests to it, and accepts forged responses from it.

**Chosen solution.** Operating-system verification of the endpoint process and ownership rules (D-01).

### T-03 — Passive Eavesdropping

A local principal with read access to the channel records the message stream. Workspace content, paths, prompts, and command output are exposed without any message being modified.

**Chosen solution.** An authenticated key exchange that gives the channel fresh session keys (D-02).

### T-04 — Active Interception

A local principal positions itself between the host and the daemon and forwards traffic while reading or altering it. Each endpoint believes it is talking to the other, and neither can tell that the channel has a middle party.

**Chosen solution.** Mutual authentication and channel binding in the authenticated key exchange (D-02).

### T-05 — Message Tampering and Injection

A local principal modifies, reorders, drops, or injects messages after the channel is established. A changed argument or result can redirect an operation or hide its effect without breaking the connection.

**Chosen solution.** AEAD protection for every record, bound to its session and context (D-03).

### T-06 — Replay and Reflection

A local principal captures a valid request or response and sends it again, or reflects it back as a different message type. The daemon performs the same authorized operation twice or attributes a reply to the wrong request.

**Chosen solution.** AEAD protection with anti-replay binding and direction and type separation (D-03).

### T-07 — Caller-Tier Spoofing

A caller claims the identity of a more privileged caller category, such as an agent claiming to be the user interface. The daemon allows an operation that only the other category is permitted to request.

**Chosen solution.** A caller principal fixed by the authenticated session, not by the request (D-04).

### T-08 — Cross-Workspace or Cross-Session Access

A request addresses a workspace, session, or resource outside the caller's authorized scope. The daemon operates on another project's files or history because the request is trusted to name its own scope.

**Chosen solution.** Scope binding to the authenticated connection, enforced before dispatch (D-04).

### T-09 — Same-User Attacker with Full Access

A process running as the same operating-system user has the same authority as the host and the daemon. It can read or alter their memory, replace either application, obtain the channel keys, or act through the host's own credentials.

**Chosen solution.** None. This threat is an accepted risk; the system does not defend against it. See section 4.

### T-10 — Unauthorized Operation

An authenticated caller invokes an operation, tool, or action beyond the capability set granted to its principal. A lower-privilege surface obtains the daemon's higher authority through a request the channel accepts.

**Chosen solution.** Deny-by-default capability authorization for the authenticated principal (D-04).

### T-11 — Malformed or Hostile Message

A malformed, oversized, or structurally hostile message reaches the daemon's message handling. Ambiguous framing or an unexpected shape causes a crash, a resource leak, or an unintended operation.

**Chosen solution.** A closed message contract with bounded framing and strict rejection (D-05).

### T-12 — Sequence and State Confusion

Messages arrive in an order the protocol does not allow, or a reply is accepted for a request that was never issued. State confusion lets a caller skip a prerequisite or attach a response to the wrong request.

**Chosen solution.** An explicit connection state machine with request and response correlation (D-05).

### T-13 — Resource Exhaustion

A local principal opens many connections or sends many large or slow messages. The daemon exhausts memory, connection slots, or processing time and stops serving the legitimate host.

**Chosen solution.** Bounds on frames, connections, in-flight work, and time (D-06).

### T-14 — Abandoned Request Execution

A caller disconnects or abandons a request while the daemon is still working. The operation continues with the daemon's authority after the requester is gone, producing effects that no one can observe or stop.

**Chosen solution.** Request lifetime tied to the connection, with an explicit cancellation path (D-06).

## 3. Decisions

Six architectural decisions define the controls. Each decision states the threats it addresses, the chosen mechanism, and the reason. The mechanism is described at the architectural level only.

### Decision D-01 — OS-Verified Peer Identity

**Addresses:** T-01, T-02.

**Mechanism.** The operating system establishes the identity of the process at each end of the local channel, using the mechanism the transport exposes on each platform. On Linux and macOS the transport is a Unix-domain socket and the mechanism is kernel peer credentials: the peer's process identifier and user/group, together with its process start time. On Windows the transport is a named pipe and the mechanism is client process identity: the connecting process's identifier, token user SID, and creation time, read by the pipe server at accept. The daemon admits only the process that spawned it, which is the installed host, and the host accepts only an endpoint whose ownership and identity match the expected daemon.

**Rationale.** The operating system already knows which process is on each end of a local connection, so identity does not rest on a secret that can be copied. Checking that identity at connection acceptance and endpoint opening is the earliest point at which a foreign user, or a different process of the same user, is separated from the legitimate host. The per-platform mechanisms differ because the transports differ; the decision and the guarantee do not.

### Decision D-02 — Authenticated Key Exchange

**Addresses:** T-03, T-04.

**Mechanism.** A Noise Protocol Framework handshake with mutual authentication and fresh ephemeral key material for each session.

**Rationale.** The handshake proves that each endpoint holds the expected static identity and derives session keys that a passive observer cannot obtain. Forward secrecy limits the value of recorded traffic if a long-term key is later exposed.

### Decision D-03 — Authenticated Record Protection

**Addresses:** T-05, T-06.

**Mechanism.** AEAD protection for every record, with per-session keys and anti-replay binding to the session, direction, and message type.

**Rationale.** AEAD makes modification and injection detectable, and the binding prevents a valid record from being replayed or reflected into another context. The handshake authenticates the endpoints; this decision protects what they say.

### Decision D-04 — Authenticated Principal and Capability Authorization

**Addresses:** T-07, T-08, T-10.

**Mechanism.** A principal fixed by the authenticated session, a deny-by-default capability set for each principal, and a workspace and session scope that the caller cannot override in the request.

**Rationale.** A trusted channel does not make every caller equally authorized. Fixing the principal outside the request payload prevents spoofing, and binding scope prevents a valid caller from reaching another workspace.

### Decision D-05 — Strict Protocol Validation

**Addresses:** T-11, T-12.

**Mechanism.** A closed message contract, bounded framing, rejection of unknown or duplicate fields, and an explicit connection state machine with request and response correlation.

**Rationale.** Hostile structure must be rejected before it can influence dispatch. A closed contract and an explicit state machine remove the ambiguity that lets malformed or out-of-order messages be read as valid operations.

### Decision D-06 — Bounded Resources and Request Lifetime

**Addresses:** T-13, T-14.

**Mechanism.** Bounds on frame size, connection count, and in-flight work, with per-request deadlines and cancellation tied to the connection lifetime.

**Rationale.** Availability and lifetime are part of the authority boundary. A request must not consume unbounded resources or continue after the requester has gone, and the limits are applied before expensive work is admitted.

## 4. Accepted Residual Risk

### Threat 9 — Same-User Attacker with Full Access

A process running as the same operating-system user has the same authority as the host and the daemon. It can read or alter their memory, attach to either process, replace either application, obtain the channel keys, or act through the host's own credentials.

This risk is accepted. The system does not defend against it. D-01 identifies the expected process rather than only its user, so a different process of the same user is refused at accept on every shipped platform. That does not help against this threat, because a same-user attacker is already inside the trust boundary and can act outside the channel: no control on the local channel can deny authority that the attacker already holds.

The guarantee against this threat therefore begins at the user-account boundary. The channel protects the daemon and the workspace from other local users, unauthenticated peers, and hostile messages. It does not protect the user from a process that already runs with the user's full authority. Defending against that would require a separate privilege boundary, such as a distinct account or an operating-system sandbox, which is outside this document's scope.

## 5. Mechanism-to-Threat Mapping

The mechanism columns correspond to the decisions: M1 is D-01, M2 is D-02, M3 is D-03, M4 is D-04, M5 is D-05, and M6 is D-06.

| Threat | M1 Peer identity | M2 Key exchange | M3 AEAD records | M4 Principal and capability | M5 Protocol validation | M6 Resources and lifetime | Status |
|---|---|---|---|---|---|---|---|
| T-01 Foreign-user connection | X | | | | | | Covered |
| T-02 Rogue endpoint | X | | | | | | Covered |
| T-03 Passive eavesdropping | | X | | | | | Covered |
| T-04 Active interception | | X | | | | | Covered |
| T-05 Message tampering and injection | | | X | | | | Covered |
| T-06 Replay and reflection | | | X | | | | Covered |
| T-07 Caller-tier spoofing | | | | X | | | Covered |
| T-08 Cross-workspace or cross-session access | | | | X | | | Covered |
| T-09 Same-user attacker with full access | | | | | | | Accepted |
| T-10 Unauthorized operation | | | | X | | | Covered |
| T-11 Malformed or hostile message | | | | | X | | Covered |
| T-12 Sequence and state confusion | | | | | X | | Covered |
| T-13 Resource exhaustion | | | | | | X | Covered |
| T-14 Abandoned request execution | | | | | | X | Covered |
| **Threats per mechanism** | **2** | **2** | **2** | **3** | **2** | **2** | **13 covered and 1 accepted** |

Every covered threat appears under exactly one mechanism. Threat 9 is the sole accepted risk and is intentionally uncovered, so the fourteen threats resolve to thirteen defended and one accepted. No threat is counted twice, and no mechanism is redundant: each covers a distinct category of exposure.

M1 is implemented per platform: Linux and macOS use kernel peer credentials, while Windows uses named-pipe client process identity. Both mechanisms bind the connection to the expected process, not merely to the expected user.

Where two mechanisms could be described as contributing, the threat is assigned to the mechanism that actually provides the control. Tampering and replay are record-level controls under M3, not handshake controls under M2. Caller authorization is a principal control under M4, not message validation under M5. Malformed structure and state confusion are message-contract controls under M5, not resource controls under M6.

## 6. Out of Scope

This document does not cover:

- The confinement of third-party components inside either process beyond the trust-tier decision. The daemon's official components and the host application are treated as trusted once the user-account boundary is crossed.
- The terminal service's operating-system-level isolation. A command that passes policy can still act outside the workspace.
- The release pipeline for signing released components and verifying publishers.
- The implementation details of peer identity on each platform, including the native transport used to read client process identity.
- Anything about configuration content or composition, including which components are declared official.

Remote machines and network transports are outside the threat boundary and are not covered here.

## 7. Open Questions and Future Work

These are architectural decisions not yet made. They are not implementation questions.

- Whether the host application's internal surfaces are one principal or several, and how the user-interface and agent distinction is represented.
- Whether one daemon session serves multiple host windows, or each host instance receives its own authenticated session.
- Whether peer credentials must include the host application's identity in addition to the user identity on platforms that expose it.
- Whether session keys rotate on a fixed schedule, on a traffic volume, or only on reconnection.
- Whether a break-glass administrative path exists outside the normal principal and capability model.
- Whether the accepted same-user risk remains acceptable on shared build machines and multi-user hosts, or requires a separate deployment posture.
- Whether the accepted same-user risk is reopened by a future deployment that introduces a separate service account or an operating-system sandbox.