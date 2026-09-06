# Brud Code Terminal Module Specification

## Overview

The Terminal module enables execution of both simple and interactive terminal commands from Brud blocks. The module supports single commands, multiple commands with flexible execution modes, conditional execution, and interactive CLI handling.

## Core Principles

1. Terminal execution is a core engine capability, platform-agnostic
2. Commands can run sequentially, in parallel, or mixed
3. Conditional execution based on success/failure
4. Interactive CLIs supported via answer feeding
5. Output captured and reported accurately

## Architecture

### Core Package (Platform-Agnostic)

The core package contains:

- TerminalExecutor interface (abstract)
- Command execution logic
- Command grouping (parallel/sequential)
- Conditional execution logic
- Interactive command handling
- Output capture and ANSI stripping
- Timeout management

### VS Code Adapter

The adapter contains:

- Passes through to core executor
- Provides workspace information
- No terminal-specific implementation needed

### UI

The UI contains:

- Terminal results in Unified Results Panel
- Register terminal renderer in result registry
- Command output display with success/failure status

## Data Model

### TerminalCommand

A single terminal command to execute.

Fields:
- command: string (the shell command to run)
- cwd?: string (working directory, defaults to workspace root)
- timeout?: number (timeout in seconds, defaults to system default)
- env?: Record<string, string> (environment variable overrides)

### CommandGroup

A group of commands that execute in a specific mode.

Fields:
- type: 'parallel' | 'sequential' (execution mode)
- commands: (string | CommandGroup)[] (commands or nested groups)

### ConditionalCommand

A command with conditional follow-up execution.

Fields:
- command: string (the primary command)
- onSuccess?: CommandGroup (runs when command exits with code 0)
- onFailure?: CommandGroup (runs when command exits with non-zero code)

### TerminalResult

The result of a terminal command execution.

Fields:
- success: boolean (whether command exited with code 0)
- output: string (captured stdout and stderr)
- exitCode: number | null (exit code, null if timed out)
- duration: number (execution time in milliseconds)

### RevertCommand

- command: string (the revert command to execute)
- part of TerminalCommand when specified

## Brud Block Formats

### TERMINAL_COMMAND (Legacy)

Single command:

```
<<<<<<< TERMINAL_COMMAND [1]
Command: npm install
>>>>>>> END TERMINAL_COMMAND [1]
```

Sequential:

```
<<<<<<< TERMINAL_COMMAND [1]
Commands:
  - npm install
  - npm run build
Mode: sequential
>>>>>>> END TERMINAL_COMMAND [1]
```

Parallel:

```
<<<<<<< TERMINAL_COMMAND [1]
Commands:
  - npm run lint
  - npm run type-check
Mode: parallel
>>>>>>> END TERMINAL_COMMAND [1]
```

Conditional:

```
<<<<<<< TERMINAL_COMMAND [1]
Command: npm run build
OnSuccess: npm test
OnFailure: npm run build:fix
>>>>>>> END TERMINAL_COMMAND [1]
```

### TERMINAL_INTERACTIVE (Legacy)

```
<<<<<<< TERMINAL_INTERACTIVE [1]
Command: npm init
Answers:
  - brud-app
  - 1.0.0
Timeout: 120
>>>>>>> END TERMINAL_INTERACTIVE [1]
```

### YAML Formats

Single:

```yaml
---
operation: terminal_command
command: npm install
index: 1
```

Sequential:

```yaml
---
operation: terminal_command
commands:
  - npm install
  - npm run build
mode: sequential
index: 1
```

Parallel:

```yaml
---
operation: terminal_command
commands:
  - npm run lint
  - npm run type-check
mode: parallel
index: 1
```

Conditional:

```yaml
---
operation: terminal_command
command: npm run build
on_success: npm test
on_failure: npm run build:fix
index: 1
```

## Command Group Execution

### Sequential Group

Commands execute one after another in the order specified. Each command waits for the previous to complete before starting. If any command fails, the group can optionally stop execution based on the stop-on-failure setting.

Execution flow:
1. Execute command at index 0
2. Wait for completion
3. Check exit code (stop on failure if enabled)
4. Execute command at index 1
5. Wait for completion
6. Continue until all commands executed or failure stops execution

### Parallel Group

Commands execute concurrently using separate child processes. The group completes when ALL commands have finished. Results are collected individually per command.

Execution flow:
1. Spawn all commands simultaneously
2. Wait for all to complete
3. Collect results from each command
4. Return aggregate result (success only if all commands succeeded)

### Mixed Groups

Groups can contain other groups, enabling complex workflows:

- 3 commands in parallel, then 2 sequential commands
- A single command, then a parallel group, then a conditional command
- Nested sequential groups within a parallel group

Mixed groups use recursive execution: each CommandGroup is resolved by its type, and nested groups are resolved by their own type regardless of parent context.

## Conditional Execution

### on_success

Runs when the preceding command exits with code 0. The on_success group executes only after a successful primary command.

### on_failure

Runs when the preceding command exits with a non-zero exit code. The on_failure group executes only after a failed primary command.

### Nesting

Conditions can contain their own conditions, enabling complex recovery chains:

```
build → on_success: test → on_failure: test:fix → on_success: test:verify
```

This allows:
- Build succeeds → run tests
- Tests fail → run test fixes
- Test fixes succeed → run test verification

## Revert Commands

Terminal operations can specify a revert command that undoes the changes made by the original command. This is critical for operations that modify state outside the file system, such as database migrations, deployments, or configuration changes.

### Brud Block Format

Legacy:
```
<<<<<<< TERMINAL_COMMAND [1]
Command: npm run migrate
Revert: npm run migrate:rollback
>>>>>>> END TERMINAL_COMMAND [1]
```

YAML:
```yaml
---
operation: terminal_command
command: npm run migrate
revert: npm run migrate:rollback
index: 1
```

### How Revert Works

1. User executes terminal command with revert specified
2. Session history stores BOTH the command and the revert command
3. When user reverts the session:
   - File snapshots are restored first
   - Then the revert command is executed
   - Combined result reported to user

### Use Cases

- Database migrations: Command runs migration, Revert runs rollback
- Deployments: Command deploys, Revert rolls back
- Package installation: Command installs, Revert uninstalls
- Configuration changes: Command applies config, Revert restores

### Integration with History

The revertCommands field in HistorySession stores terminal revert commands. When a session with terminal operations is reverted, the revert commands run in addition to file snapshot restoration.

## Interactive Terminal

### TERMINAL_INTERACTIVE

For CLIs that prompt for user input. Answers are provided in sequence and fed to the command's stdin as each prompt is detected.

### Answer Feeding

The interactive terminal uses a timed answer feeding mechanism:

- 1000ms initial delay before the first answer is sent
- 500ms delay between subsequent answers
- Empty answer string signals accepting the default value (sends just a newline)
- Answers are sent in the exact order provided in the block

### Timeout

An interactive terminal can specify a custom timeout (in seconds) to prevent hanging on long-running prompts. Default timeout is used if not specified.

## Output Capture

### Standard Output and Error

Both stdout and stderr are captured during command execution. Output is merged into a single result string for display.

### ANSI Stripping

ANSI escape sequences are stripped from the captured output before storage and display. The raw output (with ANSI codes) is optionally preserved for terminal-native rendering.

### Large Output Handling

For commands producing large output, the capture buffer is truncated to prevent memory issues. The result includes a flag indicating whether the output was truncated.

## Test Coverage

Tests should cover the following scenarios:

- Single command execution with success
- Single command execution with failure
- Sequential execution of multiple commands
- Sequential execution with stop-on-failure
- Parallel execution of multiple commands
- Conditional execution on success path
- Conditional execution on failure path
- Mixed group execution (nested groups)
- Interactive terminal with answers
- Interactive terminal with empty answers (defaults)
- Timeout handling (command exceeding timeout)
- Custom working directory
- Environment variable overrides
- Output capture with ANSI stripping
- Large output truncation

## Integration with Unified Results

Terminal results are rendered in the Unified Results Panel. A terminal result renderer is registered in the Tool Result Registry. Each result displays:

- Command output text
- Success or failure status indicator
- Exit code
- Execution duration
- Command that was executed

Renderer registration follows the same pattern as other tool result renderers, providing a React component that receives the TerminalResult data.

## Integration Points

The Terminal module integrates with:

- File operation engine (executes terminal operations within Brud sessions)
- History module (records terminal sessions and commands)
- Unified Results Panel (displays terminal command output)
- Prompt Library (documents terminal operation block formats)

## Implementation Phases

- Phase 1: Core TerminalCommand types and executor — PENDING
- Phase 2: Single command execution — PENDING
- Phase 3: Sequential command support — PENDING
- Phase 4: Parallel command support — PENDING
- Phase 5: Conditional execution — PENDING
- Phase 6: Mixed groups — PENDING
- Phase 7: Interactive terminal — COMPLETED
- Phase 8: Unified Results integration — PENDING
- Phase 9: Tests — PENDING

## Success Criteria

1. Single commands execute correctly and output is captured
2. Multiple commands run sequentially with proper ordering
3. Multiple commands run in parallel with concurrent execution
4. Conditional execution fires on_success or on_failure based on exit code
5. Mixed groups with nested commands are supported
6. Interactive CLIs work with provided answers
7. Output is captured accurately with ANSI stripped
8. Terminal results appear in the Unified Results Panel
9. Revert commands stored in session history
10. Revert commands executed on session revert