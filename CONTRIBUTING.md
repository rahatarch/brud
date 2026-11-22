# Contributing to Brud OS

Thank you for your interest in contributing to Brud!

We welcome contributions from developers, documentation writers, and community members who want to help improve the project.

This guide explains how to report issues, propose changes, prepare contributions, and submit pull requests.

## Code of Conduct

Participation in this project is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).

By participating, you agree to follow its guidelines and maintain a respectful and constructive environment.

## How to Contribute

We welcome contributions in the following areas:

- Bug fixes and improvements.
- New features and functionality.
- Documentation and examples.
- Tests and quality improvements.
- Feature suggestions and feedback.

For substantial changes, consider discussing your proposal with the maintainers before beginning implementation.

## Reporting Bugs

Before reporting a bug, check the [issue tracker](https://github.com/rahatarch/brud/issues) to see whether it has already been reported.

A bug report should include:

- A clear and descriptive title.
- A description of the problem.
- Steps to reproduce the issue.
- Expected and actual behavior.
- Relevant logs or screenshots, if applicable.
- Relevant environment information.

Do not include passwords, credentials, or other sensitive information in public reports.

## Suggesting Features

Feature suggestions are welcome.

When proposing a feature, provide:

- A clear description of the proposed functionality.
- The problem it addresses.
- Its expected benefits.
- Relevant examples or use cases.

Discuss significant changes with the maintainers before starting implementation.

## Development Setup

To prepare for development:

1. Fork the repository.
2. Clone your fork.
3. Install the required dependencies.
4. Review the project's development documentation.
5. Create a separate branch for your changes.

Follow the setup instructions and development requirements documented in the repository.

## Contribution Guidelines

All contributions should follow these general guidelines:

- Write clear, readable, and maintainable code.
- Follow the existing coding and formatting conventions.
- Keep changes focused and avoid unrelated modifications.
- Maintain compatibility with existing functionality unless intentionally changing it.
- Handle errors and unexpected inputs appropriately.
- Avoid unnecessary dependencies.
- Update relevant documentation when functionality changes.

### Testing

- Run relevant tests before submitting changes.
- Add tests for new functionality where appropriate.
- Include regression tests for bug fixes where applicable.
- Ensure existing tests continue to pass.
- Verify that your changes do not introduce unintended regressions.

### Security and Privacy

Contributions must respect the project's established security and privacy principles.

Do not introduce undisclosed data collection, unauthorized external communications, or insecure handling of sensitive information.

## Pull Request Process

Before submitting a pull request:

1. Ensure your changes are complete.
2. Review your modifications.
3. Run the relevant tests and quality checks.
4. Commit your changes using the project's commit message conventions.
5. Push your branch to your fork.
6. Open a pull request against the official repository.

A pull request should include:

- A clear and descriptive title.
- A summary of the changes.
- The reason for the changes.
- Relevant issue references, if applicable.
- Testing information.

Maintainers will review your contribution and may request modifications before accepting it.

Please respond constructively to review feedback.

## Commit Message Guidelines

Every commit message follows the Conventional Commits format, with a structured body for anything beyond a trivial change.

### Subject line (required, enforced)

`<type>(<scope>): <summary>`

- **type** is one of `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `build`, `ci`, `chore`, `revert`.
- **scope** is the package or area, lower case, for example `kernel`, `sdk`, `cli`, `daemon`, `release`. It is optional.
- **summary** is imperative ("add", not "added"), lower case, no trailing period.
- The whole subject is 72 characters or fewer.
- A breaking change adds `!` after the scope (`feat(kernel)!: ...`) and a `BREAKING CHANGE: <what breaks>` line in the body.
- Leave one blank line between the subject and the body.

### Body (a convention, not a gate)

A commit that changes behaviour or touches more than one file explains itself. Use only the sections that apply, in this order, each with a plain heading line:

1. **Why**: the problem in a few lines, and the issue or defect it addresses.
2. **What is new**
3. **What is fixed**
4. **Security or compatibility**: what is kept, changed, or at risk.
5. **Tests added**: what each test proves. **Tests updated**: and why.
6. **Docs**: what changed, and what was regenerated.
7. **Verification**: the commands run, the results, and what was not covered.

A trivial commit (a typo, a version bump) needs only the subject line.

### Rules

- One logical change per commit.
- No AI attribution lines (`Co-Authored-By` naming an AI tool, "Generated with ...", session links). Human co-authors are welcome.
- No secrets, credentials, or private keys.

### Enforcement

- **Locally:** run `npm run hooks:install` once per clone. A `commit-msg` hook then rejects a message whose subject or attribution breaks the rules.
- **In CI:** the "Commit Standard" workflow checks every commit in a pull request with the same code. It enforces the subject and attribution rules only.
- **By hand:** `npm run check:commits` checks your commits against `origin/main`.

Examples:

- `feat(kernel): explain a refused resolve with lastRefusal()`
- `fix(cli): run npx directly on Windows in the smoke test`
- `docs: update the installation guide`
- `test(kernel): pin kind handler identity`

## Security Issues

Do not report security vulnerabilities through public issue trackers.

Use the project's designated private security reporting channel to disclose vulnerabilities responsibly.

## Getting Help

For questions, discussions, and contribution-related assistance, use the project's official repository.

- **Repository:** https://github.com/rahatarch/brud
- **Issue Tracker:** https://github.com/rahatarch/brud/issues

Thank you for contributing to Brud OS!