# Glossary

| Term | Meaning |
|---|---|
| **BrudOS** | The kernel plus the tools to build systems of participants on it |
| **Kernel** | The small core that admits participants and enforces access |
| **Participant** | A unit of code with an identity and a manifest |
| **Giver** | A participant offering an exposure. The giver decides who may use it |
| **Exposure** | A named, versioned API offered by a giver |
| **Handle** | What a caller receives from `resolve`. Tailored to that caller |
| **Manifest** | A participant's declaration of what it requests and offers |
| **Scope** | Which root origins may reach an exposure |
| **Policy** | Extra data-only rules on top of scope |
| **Capability** | A named permission a caller declares and a giver interprets |
| **Call chain** | The record of who called whom, starting at an origin |
| **Origin** | Where a chain began: `kernel`, `runtime` or `host` |
| **Host** | The program that boots and drives the kernel |
| **Host call** | The door a host uses to enter the kernel |
| **Composition** | One kernel, one config, one owner |
| **Hardcore** | One of the seven core services, pinned by content hash |
| **Official** | The owner's declaration of trust in a participant |
| **Kind** | An operation category in Brud syntax, owned by one participant |
| **Pruning** | Leaving out a participant whose required startup fields are missing |
| **Cage** | The WASM isolation primitive |
| **Daemon** | A process hosting kernels over a local, authenticated protocol |
| **Operator** | The person who runs the daemon and writes `daemon.json` |
