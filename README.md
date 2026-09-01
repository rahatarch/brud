<h1 align="center">Brud</h1>

<h3 align="center">Full AI-Assisted Coding Platform — Manual Input, No API Keys</h3>

<p align="center">
  <img src="https://img.shields.io/badge/VS%20Code-1.80%2B-blue?style=for-the-badge&logo=visualstudiocode&logoColor=white" alt="VS Code 1.80+" />
  <img src="https://img.shields.io/badge/Price-Free-00C853?style=for-the-badge" alt="Free Forever" />
  <img src="https://img.shields.io/badge/License-MIT-4CAF50?style=for-the-badge" alt="License MIT" />
  <img src="https://img.shields.io/badge/Fork-Akkhar%20Code%20Patcher-FF6F00?style=for-the-badge" alt="Fork of Akkhar Code Patcher" />
</p>

<p align="center">
  <strong>This project is a fork of the original <a href="https://github.com/akkhar-labs/akkhar-code-patcher">Akkhar Code Patcher</a> repository.</strong>
  The original repository is no longer maintained. This fork is the official continuation of the project under a new identity.
</p>

<br />

# Brud

## AI-Assisted Coding Without the Friction

Brud is a full AI-assisted coding platform built for manual paste-and-apply workflows. It lets you take code changes from any AI chatbot and apply them to your codebase with precision, safety, and full control. No API keys, no subscriptions, no setup required.

---

## Features

- **File Operations**: Specify target file paths directly in your patch blocks for multi-file patching workflows.
- **Prompt Helper**: Built-in prompt formatting assistance to help you craft precise search-and-replace blocks.
- **Fuzzy Matching**: Intelligent whitespace-agnostic matching that finds the correct code location even when indentation differs.
- **AI Mistake Auto-Fix**: Automatic detection and correction of common AI-generated formatting errors and indentation mismatches.
- **Multi-File Patch Support**: Apply patches across multiple files in a single workflow session.
- **Patch History**: Track and review previously applied patches for audit and rollback purposes.
- **AI Output Cleaner**: Strips extraneous AI commentary and formatting artifacts from patch blocks before processing.
- **Confidence Indicators**: Visual feedback on match quality and patch reliability before execution.
- **Multiple Format Support**: Compatible with various search-and-replace formats from different AI tools and platforms.
- **Multi-Occurrence Apply**: Apply the same patch block to multiple matching locations in a file.
- **Git Integration**: Awareness of Git state to prevent patching uncommitted or dirty files unintentionally.
- **Syntax Validation**: Pre-apply validation that checks for syntax errors in the patched result.
- **Template Library**: Save and reuse common patch patterns for recurring code transformations.

---

## Installation

1. Open VS Code.
2. Go to Extensions (Ctrl+Shift+X).
3. Search "Brud".
4. Click Install.
5. Look for the Brud icon in your sidebar.

---

## Usage

Your AI assistant outputs a structured patch block:

```
File Path: src/utils.js
<<<<<<< SEARCH [0]
function calculateTotal(price, tax) {
  return price + tax;
}
=======
function calculateTotal(price, tax, discount = 0) {
  return price + tax - discount;
}
>>>>>>> REPLACE [0]
```

1. Copy the entire patch block from your AI output.
2. Paste it into the Brud sidebar in VS Code.
3. Click Preview Bulk Diff to see exactly what will change.
4. Verify the diff in the side-by-side preview.
5. Click Execute Patch to apply the changes.
6. Confirm the patch was applied successfully.

---

## Contributing

Contributions are welcome. Please read CONTRIBUTING.md for guidelines on the development workflow, coding standards, and pull request process.

---

## License

Brud is licensed under the MIT License. See the LICENSE file for details.

---

<p align="center">
  <a href="https://github.com/rahatarch/brud">Star this repository</a> |
  <a href="https://github.com/rahatarch/brud/issues">Report a bug</a> |
  <a href="https://github.com/rahatarch">Follow the builder</a>
</p>

<p align="center">
  <sub>(c) 2026 Akkhar-Labs. Principal Architect: Rahat Hasan.</sub>
</p>