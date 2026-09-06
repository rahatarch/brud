# Contributing to Brud Code

Thank you for your interest in Brud Code — a full AI-assisted coding platform for manual paste-and-apply workflows from any AI chatbot.

## How to Contribute

We welcome contributions that improve the platform, fix bugs, add features, or enhance documentation. Before contributing, please review the project's architecture and design principles in [ARCHITECTURE.md](./ARCHITECTURE.md).

## Code of Conduct

This project follows a [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior to the project maintainers.

## Reporting Bugs

Before submitting a bug report, please check the [issue tracker](https://github.com/rahatarch/brud/issues) to see if the issue has already been reported. When filing a bug report, include:

- A clear and descriptive title
- Steps to reproduce the issue
- Expected behavior vs actual behavior
- Screenshots or logs if applicable
- Your environment (OS, VS Code version, extension version)

## Development Setup

1. **Fork and clone** the repository.
2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Run the full CI pipeline** to verify everything is working:

   ```bash
   npm run ci
   ```

   This builds all packages, runs core and integration tests, and lints the codebase.

4. **For a quicker feedback loop** during development:

   ```bash
   npm run ci:quick
   ```

## Project Structure

Brud Code is organized as a monorepo with npm workspaces. Key directories:

- `packages/core/` — Core patching logic, history, and file operations (no VS Code API dependencies)
- `packages/protocol/` — Protocol definitions and data structures
- `packages/adapters/` — Platform-specific adapters (e.g., VS Code)
- `packages/ui/` — Webview-based user interface
- `apps/` — Application entry points

Refer to [ARCHITECTURE.md](./ARCHITECTURE.md) for a detailed breakdown of the architecture and design decisions.

## Code Style

- **TypeScript** — All code must be written in TypeScript with strict type checking enabled.
- **Formatting** — Use the project's ESLint configuration. Run `npm run lint` before committing.
- **Atomic Changes** — Each change must be minimal and context-aware. Changes should be designed to apply as a single transaction.
- **Decoupled Core** — Core patching logic in `packages/core/` must remain free of VS Code API dependencies. Platform-specific concerns belong in the adapter layer.

## Testing Requirements

- **Core logic** must have corresponding unit tests in `packages/core/src/**/*.test.ts`.
- **Run core tests** with `npm run test:core`.
- **Run integration tests** with `npm run test:integration`.
- All tests must pass before submitting a pull request. The CI pipeline (`npm run ci`) enforces this.

## Pull Request Process

1. Create a feature branch from `main`.
2. Implement your changes, following the code style and testing guidelines above.
3. Ensure the CI pipeline passes locally (`npm run ci`).
4. Submit a pull request with a clear description of the changes and their intent.
5. Maintainers will review the PR and may request changes. Please respond promptly to feedback.

## Commit Message Guidelines

Brud Code follows the **Conventional Commits** standard:

```
<type>(<scope>): <description>
```

Types include:
- `feat` — A new feature
- `fix` — A bug fix
- `docs` — Documentation changes
- `refactor` — Code refactoring
- `test` — Adding or updating tests
- `chore` — Build process or tooling changes

Examples:

```
feat(engine): add file rename operation to the patch engine
fix(history): correct session ID sequence generation
docs: update architecture documentation
```

This ensures the changelog can be derived directly from the commit history.