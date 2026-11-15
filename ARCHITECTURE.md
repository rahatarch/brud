# Brud OS Architecture

**Project:** Brud OS  
**Document:** System Architecture  
**Status:** Architecture Reference

---

## 1. Overview

Brud OS is an embedded, capability-based microkernel runtime designed for autonomous agent systems.

It provides a modular execution environment between a host application, intelligent agent models, and the system capabilities made available to them, including storage, computation, network access, and external application interfaces.

The architecture separates the mechanisms responsible for execution, coordination, identity, and access control from the services that provide application-specific functionality.

This allows host applications to compose their own runtime environments while maintaining consistent execution boundaries and security policies.

### 1.1 Architectural Goals

The architecture is designed around the following goals:

| Goal | Description |
|---|---|
| Modularity | Keep core runtime mechanisms separate from domain-specific functionality. |
| Isolation | Restrict component access to explicitly authorized resources. |
| Extensibility | Allow additional services and extensions without modifying the core runtime. |
| Security | Enforce component identity, capability authorization, and execution boundaries. |
| Flexibility | Support different runtime compositions for different host applications. |
| Reliability | Validate components and dependencies before entering the running state. |
| Portability | Provide an embeddable runtime that can operate in different host environments. |

### 1.2 Architectural Principles

The system follows five foundational principles:

1. **Minimal Core:** The core runtime provides essential execution mechanisms rather than application-specific functionality.
2. **Separation of Mechanism and Policy:** The runtime enforces execution and access boundaries, while services and host applications define their applicable policies.
3. **Explicit Authority:** Components receive permissions through explicit authorization rather than implicit trust.
4. **Cryptographic Identity:** Component identity is associated with verified content rather than relying exclusively on human-readable names.
5. **Declarative Composition:** Host applications define their runtime composition through configuration rather than requiring a fixed collection of services.

---

## 2. System Architecture

Brud OS uses a layered architecture in which the host application, daemon, core runtime, system services, and extensions have distinct responsibilities.

### 2.1 High-Level Architecture

```text
┌───────────────────────────────────────────────────────────────────┐
│                         HOST APPLICATION                          │
│                                                                   │
│             Desktop App  |  IDE  |  Web Interface  |  CLI          │
└──────────────────────────────┬────────────────────────────────────┘
                               │
                     Authenticated Communication
                               │
                               ▼
┌───────────────────────────────────────────────────────────────────┐
│                         RUNTIME DAEMON                            │
│                                                                   │
│              Process Supervision and Communication               │
└──────────────────────────────┬────────────────────────────────────┘
                               │
                       Runtime Boundary
                               │
                               ▼
┌───────────────────────────────────────────────────────────────────┐
│                          CORE RUNTIME                             │
│                                                                   │
│   Identity Management  |  Capability Authorization               │
│   Lifecycle Management |  Interface Registration                 │
│   Operation Routing    |  Execution Coordination                 │
└──────────────────────────────┬────────────────────────────────────┘
                               │
                  ┌────────────┴────────────┐
                  │                         │
                  ▼                         ▼
┌─────────────────────────────┐ ┌───────────────────────────────────┐
│    MANDATORY SYSTEM         │ │       PLUGGABLE DOMAIN            │
│         SERVICES            │ │          SERVICES                 │
│                             │ │                                   │
│ Identity Verification      │ │ Storage and File Operations       │
│ Execution Isolation        │ │ Terminal and Command Services     │
│ Component Provenance       │ │ External Application Integrations │
│                             │ │ Other Domain Capabilities         │
└──────────────┬──────────────┘ └─────────────────┬─────────────────┘
               │                                  │
               └────────────────┬─────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│                    PARTICIPANT EXTENSIONS                         │
│                                                                   │
│                 Agent Tools  |  Plugins  |  Extensions            │
│                                                                   │
│             Isolated Execution with Granted Capabilities          │
└───────────────────────────────────────────────────────────────────┘
```

### 2.2 Architectural Layers

| Layer | Component | Primary Responsibility |
|---|---|---|
| Host Layer | Host Application | Provides the user-facing application environment and communicates with the runtime. |
| Daemon Layer | Runtime Daemon | Supervises the runtime process and handles host communication. |
| Core Layer | Core Runtime | Coordinates identity, authorization, lifecycle, and operation routing. |
| Service Layer | System and Domain Services | Provides essential and application-specific capabilities. |
| Participant Layer | Extensions and Tools | Provides additional functionality through authorized interfaces. |

### 2.3 Component Relationships

The architecture follows a separation-of-responsibility model:

- The host application initiates and manages interactions with the runtime.
- The daemon provides process supervision and the communication boundary when deployed out of process.
- The core runtime enforces essential execution and authorization rules.
- System services provide functionality required by the runtime's baseline operation.
- Domain services provide optional or application-specific capabilities.
- Extensions consume authorized capabilities through the interfaces made available to them.

---

## 3. Core Runtime Architecture

The core runtime is the central coordination component of Brud OS.

Its responsibilities are intentionally limited to essential execution mechanisms and system-wide integrity rules.

### 3.1 Core Responsibilities

| Responsibility | Description |
|---|---|
| Lifecycle Management | Controls initialization and runtime state transitions. |
| Component Identity | Issues and validates component identity tokens. |
| Interface Registration | Maintains the registry of interfaces exposed during initialization. |
| Capability Authorization | Enforces authorization checks for requested capabilities. |
| Communication Coordination | Coordinates authorized communication between components. |
| Operation Routing | Dispatches normalized operations to registered service providers. |
| Integrity Verification | Ensures required components satisfy initialization requirements. |

### 3.2 Core Design Constraints

The core runtime follows these constraints:

- It does not directly implement application-specific functionality.
- It does not grant permissions based only on component names.
- It does not allow unregistered services to receive routed operations.
- It does not treat a declared capability request as an automatic authorization.
- It maintains clear boundaries between internal runtime mechanisms and external application interfaces.

These constraints help keep the core runtime small, predictable, and independently maintainable.

---

## 4. Service Architecture

Brud OS separates services into mandatory system services and pluggable domain services.

### 4.1 Mandatory System Services

Mandatory system services provide functionality required for the runtime's baseline operation and security model.

Examples include:

| Service Category | Responsibility |
|---|---|
| Identity Verification | Establishes and verifies component identities. |
| Execution Isolation | Provides isolated execution environments for unverified components. |
| Component Provenance | Maintains information about component origin and verified contents. |

The runtime validates the availability and integrity of required system services during initialization.

### 4.2 Pluggable Domain Services

Domain services provide functionality that varies according to the needs of a host application.

Examples include:

| Service Category | Example Responsibilities |
|---|---|
| Storage | Persistent data and state management. |
| File Operations | Authorized file access and manipulation. |
| Terminal | Command execution and terminal interaction. |
| Application Integration | Communication with external applications. |
| Network | Authorized external communication. |
| Agent Tools | Additional capabilities exposed to autonomous agents. |

### 4.3 Service Registration and Ownership

Services declare the operation categories they support during initialization.

The runtime uses these declarations to associate operations with their responsible service providers.

This avoids embedding application-specific routing rules directly into the core runtime.

---

## 5. Operation Processing and Routing

Operations enter the runtime through authorized communication interfaces.

They are parsed, normalized, validated, and dispatched to the service responsible for their operation category.

### 5.1 Processing Flow

```text
       ┌──────────────────────────┐
       │      Incoming Input      │
       │                          │
       │ Host / Agent / User      │
       └────────────┬─────────────┘
                    │
                    ▼
       ┌──────────────────────────┐
       │     Input Validation     │
       │                          │
       │ Structure and Syntax     │
       └────────────┬─────────────┘
                    │
                    ▼
       ┌──────────────────────────┐
       │    Operation Parsing     │
       │                          │
       │ Normalize Operation      │
       └────────────┬─────────────┘
                    │
                    ▼
       ┌──────────────────────────┐
       │     Operation Routing    │
       │                          │
       │ Identify Service Owner   │
       └────────────┬─────────────┘
                    │
                    ▼
       ┌──────────────────────────┐
       │   Authorization Check   │
       │                          │
       │ Validate Capabilities    │
       └────────────┬─────────────┘
                    │
                    ▼
       ┌──────────────────────────┐
       │     Service Execution    │
       │                          │
       │ Process Authorized Input │
       └────────────┬─────────────┘
                    │
                    ▼
       ┌──────────────────────────┐
       │     Structured Result    │
       └──────────────────────────┘
```

### 5.2 Processing Stages

| Stage | Responsibility |
|---|---|
| Input Validation | Reject malformed or invalid incoming payloads. |
| Parsing | Convert accepted input into normalized operation records. |
| Routing | Identify the registered service responsible for the operation. |
| Authorization | Verify that the caller has the required capabilities. |
| Execution | Dispatch the operation to the authorized service. |
| Response | Return a structured result or execution error. |

### 5.3 Routing Rules

The routing mechanism follows these rules:

1. Services must register the operation categories they support.
2. Each operation must identify a valid category.
3. The runtime must resolve that category to an authorized service.
4. The caller's authorization must be checked before execution.
5. Operations without a valid service owner must be rejected.

---

## 6. Identity and Security Architecture

Security is enforced throughout component initialization, communication, authorization, and execution.

The architecture combines cryptographic identity, explicit capability grants, and isolated execution environments.

### 6.1 Component Identity

Each participating component receives an identity token during runtime initialization.

The token is associated with the cryptographic digest of the component's verified contents.

The architecture specifies SHA-256 for content-digest generation.

| Property | Description |
|---|---|
| Identity Source | Verified component contents. |
| Digest Algorithm | SHA-256. |
| Identity Assignment | Issued by the core runtime. |
| Identity Usage | Component authorization and resource ownership. |
| Name Independence | Human-readable names do not independently establish component identity. |

A component with modified contents must not inherit the identity of another component merely by reusing its name or manifest identifier.

### 6.2 Trust Classification

Brud OS distinguishes explicitly trusted platform components from unverified and third-party components.

| Trust Classification | Definition | Execution Environment | Access |
|---|---|---|---|
| Official Platform | Explicitly declared and pinned by cryptographic hash in the root configuration manifest. | Native host process. | Platform privileges subject to applicable authorization rules. |
| Unverified / Third-Party | Not explicitly pinned as an official platform component. | Isolated virtual-machine environment. | Limited to granted capabilities. |

Official status establishes a trust classification; it does not remove the need for authorization checks.

### 6.3 Execution Isolation

Unverified and third-party components are designed to execute inside WebAssembly-based sandboxes.

```text
┌──────────────────────────────────────────────────────┐
│                    HOST ENVIRONMENT                   │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │                  CORE RUNTIME                  │  │
│  │                                                │  │
│  │       Authorized Host Interfaces               │  │
│  └───────────────────────┬────────────────────────┘  │
│                          │                           │
│              Explicit Capability Interfaces         │
│                          │                           │
│       ┌──────────────────┴──────────────────┐        │
│       │                                     │        │
│       ▼                                     ▼        │
│  ┌──────────────────┐              ┌────────────────┐│
│  │  Sandbox A       │              │  Sandbox B     ││
│  │                  │              │                ││
│  │  Extension A     │              │  Extension B   ││
│  │                  │              │                ││
│  │  Isolated Memory │              │ Isolated Memory││
│  └──────────────────┘              └────────────────┘│
│                                                      │
└──────────────────────────────────────────────────────┘
```

The isolation model is designed around:

- Restricted direct access to host resources.
- Explicitly provided interfaces for system interaction.
- Separate linear memory for individual sandboxed components.
- Capability-based authorization for access to external resources.

### 6.4 Capability Delegation

A component may delegate a restricted subset of its capabilities to another component.

The intended security invariant is:

\[
Capabilities(Child) \subseteq Capabilities(Parent)
\]

This means a child component cannot receive greater authority than its parent.

For example:

| Parent Capability | Delegated Capability |
|---|---|
| Read and write storage | Read-only storage |
| Access multiple resources | Access one designated resource |
| Full service interface | Restricted service interface |
| Multiple operation categories | A selected subset of operations |

### 6.5 Interface Visibility

Registered interfaces may be assigned different visibility scopes.

| Scope | Access Boundary |
|---|---|
| `kernel` | Restricted to the core runtime and authorized mandatory system services. |
| `runtime` | Available to authorized internal services and extensions. |
| `host` | Available to authenticated external host clients. |
| `any` | Available to authorized internal components and authenticated external clients. |

Visibility defines where an interface can be accessed. It does not independently authorize the requested operation.

Changes to interface visibility must follow the project's compatibility and versioning rules.

---

## 7. Capability Access Control

Brud OS follows a request-and-authorization model.

A component declaring a capability in its manifest is requesting access, not automatically receiving permission.

### 7.1 Authorization Lifecycle

```text
┌─────────────────────────────┐
│     Component Request      │
│                             │
│ Declare Required Capability │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│     Policy Evaluation      │
│                             │
│ Verify Identity and Request │
└──────────────┬──────────────┘
               │
               ▼
       ┌───────────────┐
       │ Authorization │
       │    Decision   │
       └───────┬───────┘
               │
       ┌───────┼────────┐
       │       │        │
       ▼       ▼        ▼
    Grant   Restrict   Reject
       │       │        │
       ▼       ▼        ▼
    Full    Limited   No Access
    Access   Access
```

### 7.2 Authorization Stages

| Stage | Description |
|---|---|
| Request | The component declares the capability it requires. |
| Evaluation | The capability provider evaluates the request against its security policy. |
| Decision | The provider grants, restricts, or rejects the requested access. |
| Delivery | Approved capabilities are exposed through the component's authorized interfaces. |

### 7.3 Capability Restriction

A provider may restrict a capability rather than granting the full requested access.

For example:

- Full storage access may become read-only access.
- General filesystem access may become access to a specific directory.
- A complete service interface may become a limited interface containing only approved operations.

Unauthorized operations must not be exposed to the requesting component.

---

## 8. Storage and State Architecture

Brud OS separates persistent state management from the core execution mechanisms.

The architecture specifies a transactional storage engine with component-isolated data partitions.

### 8.1 Storage Model

```text
┌─────────────────────────────────────────────────────────┐
│                 PERSISTENT STORAGE ENGINE               │
│                                                         │
│                  Transactional B-Tree                  │
└───────────────────────────┬─────────────────────────────┘
                            │
                Component Identity Mapping
                            │
          ┌─────────────────┼─────────────────┐
          │                 │                 │
          ▼                 ▼                 ▼
┌────────────────┐ ┌────────────────┐ ┌────────────────┐
│  Partition A   │ │  Partition B   │ │  Partition C   │
│                │ │                │ │                │
│ Component A    │ │ Component B    │ │ Component C    │
│                │ │                │ │                │
│ Custom Data    │ │ Encrypted Data │ │ Change Records │
│                │ │                │ │                │
└────────────────┘ └────────────────┘ └────────────────┘
```

### 8.2 Storage Principles

| Principle | Description |
|---|---|
| Component Isolation | Persistent partitions are associated with component identities. |
| Flexible Schemas | Components may define their own data contracts. |
| Data Validation | Stored data is validated against the applicable registered contract. |
| Transactional Operations | Persistent changes follow the storage engine's transaction guarantees. |
| Restricted Cross-Access | Access to other component partitions requires explicit supervisory authorization. |

### 8.3 Transactional Guarantees

The architecture specifies an ACID-compliant storage model.

| Property | Meaning |
|---|---|
| Atomicity | A transaction succeeds completely or is not committed. |
| Consistency | Transactions preserve defined data integrity rules. |
| Isolation | Concurrent transactions are protected from inappropriate interference. |
| Durability | Committed data persists according to the storage engine's guarantees. |

### 8.4 Cross-Partition Access

Ordinary components are restricted to their authorized storage partitions.

Cross-partition access is reserved for platform components holding explicitly authorized supervisory capabilities.

Such access may support system-level history inspection, auditing, and recovery operations.

---

## 9. Inter-Process Communication

When deployed out of process, Brud OS uses inter-process communication (IPC) between the host application and runtime daemon.

The communication boundary is designed to provide authentication, confidentiality, and message integrity.

### 9.1 Communication Architecture

```text
┌────────────────────────┐
│     HOST APPLICATION  │
│                        │
│   Authenticated Client │
└────────────┬───────────┘
             │
             │ IPC Connection
             │
             ▼
┌────────────────────────┐
│     RUNTIME DAEMON    │
│                        │
│   Peer Verification   │
│   Session Handshake   │
│   Message Validation  │
│   Encrypted Transport │
└────────────┬───────────┘
             │
             │ Authorized Runtime Requests
             │
             ▼
┌────────────────────────┐
│      CORE RUNTIME      │
│                        │
│   Operation Processing│
│   Capability Checks   │
└────────────────────────┘
```

### 9.2 Communication Security

| Mechanism | Purpose |
|---|---|
| Mutual Authentication | Establishes the identity of communicating endpoints. |
| Ephemeral Key Exchange | Establishes session keys and supports forward secrecy. |
| Authenticated Encryption | Protects message confidentiality and integrity. |
| Sequence Counters | Detect replayed or incorrectly ordered messages. |
| Peer Verification | Validates operating-system process credentials. |
| Memory Protection | Reduces exposure of sensitive cryptographic material in swap storage. |

### 9.3 Peer Verification

The architecture specifies verification of operating-system process credentials, including:

- Process identifier.
- Effective user identifier.
- Process start time.

These checks are intended to strengthen the local communication boundary and reduce risks associated with unauthorized processes and process identifier reuse.

### 9.4 Sensitive Memory

The architecture specifies operating-system memory locking for sensitive cryptographic keys and ephemeral session material.

This is intended to reduce the possibility of sensitive key material being written to unencrypted swap storage.

---

## 10. Runtime Initialization and Lifecycle

Brud OS follows a defined initialization lifecycle.

The runtime validates its configuration, resolves dependencies, verifies required components, and finalizes its registries before entering the running state.

### 10.1 Initialization Flow

```text
              ┌─────────────────────┐
              │    UNINITIALIZED    │
              └──────────┬──────────┘
                         │
                         ▼
              ┌─────────────────────┐
              │  1. CONFIGURATION   │
              │                     │
              │ Load Root Manifest  │
              └──────────┬──────────┘
                         │
                         ▼
              ┌─────────────────────┐
              │ 2. DEPENDENCY       │
              │    RESOLUTION       │
              │                     │
              │ Resolve Components  │
              └──────────┬──────────┘
                         │
                         ▼
              ┌─────────────────────┐
              │  3. VERIFICATION    │
              │                     │
              │ Verify Components  │
              └──────────┬──────────┘
                         │
                         ▼
              ┌─────────────────────┐
              │ 4. REGISTRY         │
              │    FINALIZATION     │
              │                     │
              │ Finalize Interfaces │
              └──────────┬──────────┘
                         │
                         ▼
              ┌─────────────────────┐
              │      RUNNING        │
              │                     │
              │ Accept Operations   │
              └─────────────────────┘
```

### 10.2 Initialization Phases

| Phase | Name | Responsibility |
|---|---|---|
| 1 | Configuration | Load the root configuration manifest and runtime composition. |
| 2 | Dependency Resolution | Resolve component dependencies and establish initialization order. |
| 3 | Verification | Validate component integrity, configuration contracts, and mandatory services. |
| 4 | Registry Finalization | Finalize exposed interfaces and close dynamic registration for the initialization lifecycle. |
| 5 | Running | Begin accepting authorized runtime operations. |

### 10.3 Service Classification During Initialization

Services are classified according to their importance to the runtime.

**Mandatory System Services**

These services provide essential runtime capabilities. If a required service is missing or fails verification, initialization must be aborted.

**Pluggable Domain Services**

These services provide optional functionality selected by the runtime composition.

Their availability depends on the requirements and dependencies of the selected distribution.

### 10.4 Failure Handling

The runtime uses dependency-aware failure handling.

| Failure Condition | Expected Behavior |
|---|---|
| Official platform component fails verification | Abort initialization. |
| Required infrastructure service fails | Abort initialization if active components depend on it. |
| Independent optional service fails | Exclude the failed service and continue when safe. |
| Isolated third-party extension fails | Remove the extension from the available execution environment when safe. |

This approach prevents optional component failures from unnecessarily disrupting the entire runtime while preserving essential system integrity.

---

## 11. Extensibility and Runtime Composition

Brud OS allows host applications to select the services and extensions required by their runtime environments.

This is achieved through declarative runtime composition.

### 11.1 Composition Model

```text
┌───────────────────────────────────────┐
│          HOST APPLICATION             │
└───────────────────┬───────────────────┘
                    │
                    ▼
┌───────────────────────────────────────┐
│       RUNTIME CONFIGURATION            │
│                                       │
│  Declare Required Components          │
│  Declare Dependencies                 │
│  Declare Configuration                │
└───────────────────┬───────────────────┘
                    │
                    ▼
┌───────────────────────────────────────┐
│          CORE RUNTIME                 │
│                                       │
│  Resolve and Verify Composition       │
└───────────────────┬───────────────────┘
                    │
          ┌─────────┴─────────┐
          │                   │
          ▼                   ▼
┌──────────────────┐ ┌──────────────────┐
│ SYSTEM SERVICES  │ │ DOMAIN SERVICES  │
│                  │ │                  │
│ Required Runtime │ │ Selected Features│
│ Capabilities     │ │ and Integrations │
└──────────────────┘ └──────────────────┘
```

### 11.2 Extensibility Principles

- The core runtime remains independent of domain-specific service implementations.
- Services declare their supported operation categories.
- Extensions receive only authorized capabilities.
- Unverified components operate within their assigned isolation boundaries.
- Runtime composition is validated before normal execution begins.

### 11.3 Third-Party Components

Independent developers may provide additional services, extensions, and tools for Brud OS.

Third-party components remain subject to the runtime's applicable registration, authorization, and isolation mechanisms.

The behavior, dependencies, privacy practices, and external integrations of independently developed software are determined by their respective developers and must not be assumed to be identical to those of Brud OS's official components.

---

## 12. Architectural Decisions and Trade-offs

The following table summarizes the major architectural choices and their intended benefits.

| Architectural Decision | Intended Benefit | Trade-off |
|---|---|---|
| Minimal core runtime | Reduces the responsibilities of the trusted core. | More functionality must be implemented through services. |
| Capability-based authorization | Makes component permissions explicit and restricted. | Requires capability management and authorization policies. |
| Cryptographic component identity | Prevents identity from relying exclusively on human-readable names. | Requires integrity verification and identity lifecycle management. |
| WebAssembly-based isolation | Restricts direct access to host resources. | Extensions must use supported host interfaces. |
| Declarative composition | Allows different host applications to select different runtime capabilities. | Requires dependency resolution and configuration validation. |
| Transactional storage | Provides structured persistence and data integrity. | Introduces storage management and transaction complexity. |
| Out-of-process daemon | Separates host application interaction from runtime supervision. | Introduces IPC and process lifecycle complexity. |
| Modular domain services | Allows functionality to evolve independently of the core. | Requires stable service interfaces and compatibility management. |

These decisions establish the intended balance between security, modularity, extensibility, and operational complexity.

---

## 13. Architectural Scope and Limitations

This document describes the intended architecture of Brud OS and the responsibilities of its major components.

It focuses on system-level design rather than individual implementation details.

The architecture does not attempt to document:

- Every source file, class, function, or internal identifier.
- Complete API specifications.
- Installation and development procedures.
- Individual service implementation details.
- Third-party software behavior beyond the runtime's defined boundaries.

Implementation details belong in their respective developer and API documentation.

The security properties described here represent architectural requirements and design intentions. Their actual guarantees depend on the corresponding implementation, configuration, operating-system support, and verification.

---

## 14. Conclusion

Brud OS is designed around a minimal coordination core, explicit capability authorization, cryptographic component identity, and isolated execution environments.

By separating essential runtime mechanisms from domain-specific services, it enables host applications to compose flexible execution environments without requiring application functionality to become part of the core.

Its architecture emphasizes:

- Clear component responsibilities.
- Explicit and restricted authority.
- Verifiable component identity.
- Controlled communication.
- Isolated execution.
- Modular service composition.
- Dependency-aware initialization.

Together, these principles provide the architectural foundation for an extensible and embeddable runtime for autonomous agent systems.