# Brud OS

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Status: Developer Preview](https://img.shields.io/badge/Status-Developer%20Preview-orange.svg)]()
[![Build Status](https://img.shields.io/badge/Build-Passing-brightgreen.svg)]()

**The embedded microkernel runtime for autonomous agent software.**

---

## The Problem & Value Proposition

An autonomous agent is only useful if it can take action, but granting an AI model access to tools, files, and system execution introduces severe stability and security risks. Most existing frameworks either grant models unrestricted ambient authority on the host machine or require heavy, multi-gigabyte virtual machines that cannot be embedded into real software products.

Brud OS provides an embeddable, zero-trust microkernel substrate. The core engine holds zero built-in capabilities: it does not open files, run terminal commands, or maintain state on its own. Instead, it serves as a lightweight control plane that verifies component identities, restricts execution within virtual instruction sandboxes, and enforces strict capability boundaries—allowing you to embed safe, autonomous agent capabilities directly inside your own applications.

---

## Key Features

- **Amnesiac Microkernel Substrate:** The core engine holds execution mechanism only; all functional capabilities (file I/O, terminal execution, storage) exist as modular, removable services.
- **Virtual Instruction Sandboxing:** Untrusted third-party tools and plugins run in an isolated WebAssembly environment with zero ambient operating system access.
- **Cryptographic Identity Verification:** Every participant in the system is bound to a kernel-issued token derived from verified bytecode hashes rather than human-readable names.
- **Fractal Capability Attenuation:** Permissions delegated to sub-agents or child tools are strictly constrained to subsets of the parent's capabilities, preventing privilege escalation.
- **Lightweight & Embeddable:** Ships as an embedded library with minimal memory footprint—no heavy container runtimes or virtual machines required.

---

## Installation / Getting Started

### Prerequisites

- **Runtime:** Node.js `>= 20.0.0`
- **Operating Systems:** Linux, macOS, or Windows

### Installation

Install the runtime package using your preferred package manager:

```bash
npm install @brud/os
```

---

## Quickstart

Initialize and boot the runtime using a declarative configuration manifest:

```javascript
import { bootKernel } from "@brud/os";

// 1. Declare your distribution composition
const config = {
  root: true,
  services: [
    // Include only the services your application requires
    { module: "@brud/service-filesystem", official: true }
  ],
  plugins: []
};

// 2. Boot the engine
async function main() {
  const kernel = await bootKernel(config);
  console.log("Brud OS runtime running safely.");
}

main().catch(console.error);
```

---

## Documentation Directory

For in-depth guides and architectural specifications, consult the following:

- [ARCHITECTURE.md](ARCHITECTURE.md) — System layers, microkernel invariants, capability routing, and execution lifecycles.
- [SECURITY.md](SECURITY.md) — Formal threat models, cryptographic protocols, and vulnerability reporting procedures.
- [PRIVACY.md](PRIVACY.md) — Local-first guarantees, telemetry boundaries, and data-handling commitments.
- [CONTRIBUTING.md](CONTRIBUTING.md) — Repository structure, test suites, and pull request guidelines.

---

## Project Status

Brud OS is currently in **Developer Preview**. 

Public interfaces, capability contracts, and configuration schemas are stabilizing toward `v1.0.0`. Breaking changes may occur between minor versions prior to the stable release.

---

## License

Brud OS is open-source software licensed under the [Apache License 2.0](LICENSE).

## Running as a daemon

A daemon can host kernels out of process. Copy `examples/daemon/` (operator `daemon.json` plus the Foundation composition) into the daemon home. See `docs/daemon/README.md` for the protocol and `DaemonClient` usage.
