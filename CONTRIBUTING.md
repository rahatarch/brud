# Contributing to Brud

Thank you for your interest in the Brud surgical code patching platform. We welcome
contributions that maintain the architectural integrity and surgical precision
of this tool.

## Technical Standards

- **Surgical Precision**: Every patch must be minimal and context-aware.
- **Atomic Operations**: Changes must be designed to be applied as a single
  transaction.
- **Decoupled Logic**: Core patching logic must remain in `src/core` and be free
  of VS Code API dependencies.

## Workflow

1. Fork the repository and create your branch from `main`.
2. Ensure your code follows the established directory structure.
3. Update or add tests for any new core logic.
4. Submit a Pull Request with a clear description of the surgical intent.