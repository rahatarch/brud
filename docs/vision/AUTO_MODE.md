# Brud Code Auto — Vision & Design Intent

## The One-Line Thesis

Brud Code Auto is an automation layer for Brud Code that lets AI models drive the same engine that manual users drive, without changing the engine, the history, or the safety model.

## The Two Sources

This vision synthesizes two independent bodies of work — neither of which is a software spec, and both of which predate the product.

The first is the author's book "Orchestrator of Reality". It defines the workflow: roles with distinct responsibilities, structured debate before decision, design before build, diagnose before fix. It is the source of the process itself — the idea that coding is not a single act but a sequence of role-governed acts that must happen in order.

The second is the "AI Orchestration Protocol (Master Standard)". It defines the invariants: stateless sessions, surgical precision in every change, cross-verification across layers of abstraction, and traceable signal paths from intent to effect. It is the source of the constraints — the idea that reliability comes from structure, not intelligence.

Neither document is reproduced here. They are the foundation, not the content. Together they form the basis of the automation layer: the workflow from the Book, the invariants from the Protocol, and the engine that enforces both.

## The Identity: Brud as a Permanent Senior Engineer

Brud is not a tool you invoke. Brud is a character — a permanent senior engineer assigned to this codebase. One who never forgets what they learned last session. One who always knows how the project actually works, not how the README says it works. One who maintains the operational record continuously, session after session, model after model.

This identity is not a marketing metaphor. It is the design constraint that every decision flows from. If a feature would break the fiction of a permanent engineer — if it would forget, contradict, or bypass — it does not belong in Brud.

Everything below is built to make that fiction true.

## Manual and Auto: One Product, One Engine

Brud Code has two modes. Manual mode — the human copies a block from the workflow interface, pastes it into the terminal, and the engine executes it. Auto mode — an AI produces the same blocks and sends them to the same engine through an API.

Both modes drive the same engine. Both write to the same history. Both pass through the same validation, the same diff preview, the same safety checks before anything touches disk. The difference is only who produces the Brud blocks — a human through a clipboard, or an AI through a network call.

Switching between modes is one click. There is no separate auto product. There is no separate manual product. There is one product, one engine, one set of rules. The automation layer is a lid that can be removed at any time — and when it is removed, the entire system works exactly as it did before.

## The Three Shared Substrates

Three things are shared between manual and auto mode, and everything else depends on them.

The Engine executes Brud blocks. It validates structure, applies diffs, checks safety rules, and commits changes. It does not know who produced the block and does not care. The engine is the same in both modes.

The Map is a maintained knowledge directory — a living record of the codebase's operational truth. It holds the project's architecture, its conventions, its known issues, its decisions, its current state. The map is what a tenured engineer carries in their head, written down so a session that has never seen the codebase can act like one that has.

The Workflow is the role-based process: Discusser debates, Architect decides, Executor implements. Manual mode is a human playing all three roles, moving through the stages with the help of the interface. Auto mode is a workflow engine orchestrating AI instances that play the roles. Same roles. Same workflow. Same rules. Different driver.

## The Central Document: The Map

The map is a directory — a structured collection of files, not a single document — that lives alongside the codebase and holds the project's self-knowledge. It contains the verification chain for this specific project, the architecture map, a running log of decisions and their rationale, the conventions the project follows, the current state of what is being worked on, and a record of known issues and anomalies.

Every AI session reads the map at startup, before any work begins. Every AI session writes back to the map before it completes — updating state, logging decisions, noting anomalies. The map evolves in real time. When something unexpected happens — a test that should have passed but failed, a dependency that broke silently, a convention that was violated — the map records it. Over time, the map accumulates the project's operational scars: the things that went wrong, the things that almost went wrong, the things that should be checked every time.

This is what makes a stateless session behave like a long-tenured engineer. A fresh model, with no context and no memory, reads the map and knows what a year of work on this codebase would teach. The map is also what makes the automation model-agnostic and session-agnostic. Swap the model, start a new session, lose the conversation — the map survives. It is the durable memory of the project.

## The Session Archive: Preserving the Why

The central document — the map — holds the codebase's current operational truth. But current truth alone is not enough. A permanent senior engineer remembers not only what the system does today, but how it came to be that way — which alternatives were considered, which were rejected, and why. That reasoning lives in the session archive.

Every working session produces a record. Not just the final decision, but every artifact exchanged along the way: the initial brief, every critique, every counter-proposal, every amendment, every ratification. These are stored permanently in a per-session archive directory. The archive is not a summary. It is the complete paper trail.

The AIs in the framework do not talk to each other in free-form chat. They exchange structured, numbered, formally headed documents according to a fixed protocol. Each document carries a header identifying the project, the date, the document ID, the author role, the recipient role, the status, and a reference to what it amends or supersedes. The body is organized into numbered blocks, each stating a problem, a decision, and the justification. Where relevant, the document includes a comparative analysis and a summary table. Each document ends with a call for consensus. Consensus is the terminal state — the debate ends when the roles agree, and the agreeing chain is what gets ratified. Documents are numbered sequentially and form an explicit, traceable chain.

The choice to save these permanently is not archival habit. The reasoning is structural.

The code is the what. The archive is the why. Without the why, the code becomes opaque over time — nobody remembers what was rejected, what constraints applied, what trade-offs were accepted. The archive is the record that keeps the code legible years later.

Models change. Sessions end. Context windows are finite. The humans who participated move on. The only thing that survives across all of this is what is written down. The archive is the guarantee that the reasoning outlives every participant — human or AI — that produced it.

The archive preserves rejected alternatives, not just the chosen path. A future engineer — or a future AI session — facing a similar decision can read what was tried before and why it was set aside. This prevents re-litigating settled questions and prevents re-discovering already-known dead ends.

Years from now, when a session is long gone and the models that produced it may no longer exist, someone opening the archive can still read the full record and understand why the code is the way it is. The why is not trapped in a deprecated context window. It is preserved in a form that survives model deprecation, tooling changes, and time itself.

The map and the archive are two halves of one concept — the codebase's memory. The map is the ledger of current truth. The archive is the journal of how that truth was arrived at. One evolves and gets replaced. The other accumulates and is never edited. Both matter. Neither is complete without the other.

## The Verification Chain as Data

The abstract rule "cross-verify across layers" becomes concrete only when you know the layers of a specific project. In one codebase the chain might be: schema to repository to service to controller to route to response to frontend. In another it might be: migration to model to serializer to endpoint to client. In a third it might be: type definition to parser to validator to handler to error boundary.

The map documents this chain for the project it lives in. It does not ask each session to infer the verification path. It writes the path down, keeps it current, and every session reads it. When a signal needs to be traced — a change in the database schema that ripples to the API response — the chain tells each session exactly where to look.

This turns a general principle into a project-specific procedure, without each session needing to rediscover it.

## The Enforcement Principle: Prompts Are Suggestions, the Harness Is the Guarantee

This is the most important structural decision in Brud Code Auto.

AI models cannot be deterministically controlled by prompting. A prompt is a suggestion. Models drift across versions, forget instructions in long contexts, and cut corners under pressure. A prompt that works today may not work tomorrow. A prompt that works with one model may fail with another.

Therefore, every invariant that Brud relies on must be enforced by the harness — the system that wraps the model — not by the prompt.

The map update discipline is the clearest example. Before any session can be marked complete, the harness must verify that the map was updated. If the map was not updated, the harness blocks completion and forces the update. It does not ask the model nicely. It refuses to proceed.

The read-at-startup requirement works the same way. The harness must verify that the map was read before the model begins any work. It does not ask the model to read the map. It checks that the read happened, and if it did not, it blocks.

This is the difference between asking an AI to behave and structurally preventing an AI from misbehaving. The general principle is: anything Brud relies on must be enforced by the harness, not requested in the prompt.

## What Absolutely Cannot Change

These are the load-bearing walls of Brud Code Auto. Remove any one of them and the system stops being Brud Code Auto.

The Architect — the human who owns the project — is never an AI. The human never has final decision-making automated away. The architect approves designs, resolves deadlocks, and owns the outcome. The automation can propose. It cannot decide.

The Discusser never writes code. The Executor never makes architectural decisions. Role boundaries are structural, not advisory. A role cannot cross into another role's domain, regardless of what the model thinks is efficient.

Every file change goes through the Brud engine. No shortcuts. No direct edits. No bypassing the block pipeline. If a change does not pass through the engine's validation, it does not happen.

The design document is the source of truth. When the workflow's recorded state and the design disagree, the design wins. The workflow state is a convenience. The design is the contract.

Manual reasoning is required at specific gates: data, constraints, failure, and the future. The automation must stop and demand human input at these gates. It cannot proceed on its own.

Manual mode and auto mode share one engine, one history, one map. They can never diverge in behavior. If a feature exists in one mode but not the other, it is not a mode — it is a different product.

## Why This Is an Anomaly

Brud Code Auto is built on a fundamentally different bet than existing tools, and this difference is worth stating plainly.

Cursor, Windsurf, and Copilot bet that models will get smart enough to trust. Their products improve as models improve. Their architectures assume that the model will eventually be reliable enough to hand over control. Brud bets that models will never be trustworthy enough to not need a harness — that intelligence without structural constraint is not a foundation for reliable automation.

Those tools' product is the model. The user pays for access to a particular model, and the tool's value is proportional to that model's capability. Brud's product is the process — the harness, the workflow, the enforcement, the map. The model is a component. An interchangeable one.

Those tools degrade or collapse when the model is unavailable, rate-limited, or wrong. Without the model, they are shells. Brud degrades gracefully: manual mode is the same system with one layer removed. No model? No auto mode. Manual mode still works. The engine, the map, the workflow — they all remain.

Those tools compete on model quality. Brud competes on process reliability — which stays constant regardless of model quality. A mediocre model inside a tight harness outperforms a brilliant model with no structural constraints, for the same reason a well-run team of average engineers outperforms a chaotic team of geniuses.

The product thesis is this: the process is the product. The model is interchangeable.

## Open Questions

These are honest unknowns. They have not been resolved. They are listed here so that future readers know what has been considered and what has not been decided.

Where exactly the human gates live in the automated workflow. At every state transition? Only at irreversible actions? At convergence points where multiple paths meet? Only where the Book defines the Architect's domain? Each choice has different implications for speed, safety, and the human's cognitive burden.

How to handle concurrent sessions writing to the shared map without conflict. Two sessions working in parallel both need to read and write the map. If they write conflicting updates, the map loses coherence. The solution might be a lock, a merge strategy, append-only sections, or something else entirely. It has not been chosen.

What makes a map write trustworthy. A model that infers a fact about the codebase and writes it to the map may be wrong. A model that verifies a fact and then writes it is more reliable. But the map itself cannot distinguish between inferred updates and verified ones. Over time, unverified entries can accumulate, and the map begins to describe a fantasy version of the codebase. How to prevent this drift is open.

Where the map lives physically. Inside the workspace means it is versioned alongside the code, visible to every tool, and backed up with the repo. Inside Brud's own storage means it is protected from accidental modification, but invisible to the rest of the ecosystem. The tradeoffs between transparency and safety have not been fully resolved.

The boundary between the map and the code. The code contains architecture. The map describes it. When the code changes, the map must be updated. But how much description is enough? When does the map become a second codebase? Where is the line between useful documentation and redundant duplication? This boundary needs a clear rule, and it does not have one yet.

How the automation avoids starving the brain. The Book warns that automation that removes all friction from a practice also removes the human's growth within that practice. If Brud Code Auto becomes too seamless — if it designs, debates, implements, and verifies without the human needing to engage — the human stops learning. The codebase improves. The human does not. The automation must leave enough friction for growth, and where exactly that friction should live has not been settled.

## The Bet

Models will never be trustworthy enough that a harness is unnecessary. The gap between what a model can do and what a model can be relied upon to do is structural. It will not close with better prompts, better models, or better context windows.

Therefore, the harness — not the model — is the durable product. A harness that enforces role boundaries, verifies every change, maintains a living map of the codebase, and blocks completion when invariants are violated will outlast any single model and any single session.

Brud Code Auto is built on that bet.