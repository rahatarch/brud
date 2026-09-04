<p align="center">
  <img src="assets/images/brud_super_high.png" width="200" alt="Brud Code Logo" />
</p>

<h1 align="center">Brud Code</h1>

<h3 align="center">AI-Assisted Coding Platform — Manual Paste, Surgical Apply, Full Control</h3>

<p align="center">
  <img src="https://img.shields.io/badge/VS%20Code-1.80%2B-blue?style=for-the-badge&logo=visualstudiocode&logoColor=white" alt="VS Code 1.80+" />
  <img src="https://img.shields.io/badge/Price-Free-00C853?style=for-the-badge" alt="Free Forever" />
  <img src="https://img.shields.io/badge/No%20API%20Keys-Required-FF6F00?style=for-the-badge" alt="No API Keys Required" />
  <img src="https://img.shields.io/badge/License-MIT-4CAF50?style=for-the-badge" alt="License MIT" />
</p>

<p align="center">
  <strong>This project is a fork of the original <a href="https://github.com/akkhar-labs/akkhar-code-patcher">Akkhar Code Patcher</a> repository.</strong>
  The original repository is no longer maintained. This fork is the official continuation of the project under a new identity.
</p>

<br />

# Brud Code

## What Brud Code Does

Brud is a manual paste-and-apply AI coding platform. You paste AI-generated code changes into Brud, and it executes them surgically on your codebase — with precision, safety, and full control.

- **Paste AI output, Brud executes it.** No copy-paste-drift, no missed lines, no manual editing.
- **Works with any free AI chatbot.** ChatGPT, Claude, Gemini, DeepSeek — whatever you already use.
- **Zero API keys.** No OpenAI keys, no Anthropic keys, no third-party tokens.
- **No subscriptions for full functionality.** Everything is free, forever.

---

## Features

### File Operations
- Create files and directories
- Delete files and directories
- Rename, move, and copy files
- Append content to files
- Search and replace code with precision
- All operations are workspace-safe — nothing touches files outside your project

### Codebase Discovery
- Extract directory structure as token-efficient JSON — perfect for sending to AI
- Get codebase metadata (total files, total folders, most dense folder)
- Extract multiple directories in a single prompt
- Share your project structure with AI without wasting tokens on file contents

### History and Revert
- Every session is automatically recorded with full detail
- Revert entire sessions or individual operations
- 7-day trash protection for deleted sessions
- Restore deleted sessions anytime within the grace period
- Complete audit trail — know exactly what changed and when

### Prompt Library
- Ready-made prompts for free AI chatbots (ChatGPT, Claude, Gemini, etc.)
- Master system prompt that teaches AI how to output Brud-compatible blocks
- Operation-specific prompts for create, delete, rename, search-and-replace, and more
- One-click copy — paste directly into your AI chat

---

## Why Brud Code

- **Zero API keys required.** No signups, no billing, no rate limits.
- **Works with free AI chatbots.** Use whatever AI you already have open.
- **Token-efficient.** AI only outputs the Brud instruction block, not the entire file — saves tokens and works with smaller context windows.
- **Surgical precision.** Brud only changes what you specify. No hallucinations, no drift, no surprise edits.
- **Full history with revert.** Accidentally broke something? Revert instantly. Never lose work again.
- **Professional UI.** Built for developers who want control, not black-box automation.

---

## Quick Start

1. **Install** the Brud Code VSIX from the [Releases page](https://github.com/rahatarch/brud/releases) or search "Brud Code" in VS Code Extensions.
2. **Open** the Brud Code sidebar (click the Brud icon in the activity bar).
3. **Copy a Brud Prompt** from the Prompt Library or ask your AI to output one.
4. **Paste** the prompt into the Brud Code input panel.
5. **Click Execute** to apply the changes.
6. **Review** the results in the diff view and history panel.

---

## Installation

1. Open VS Code.
2. Go to Extensions (Ctrl+Shift+X).
3. Search "Brud Code".
4. Click Install.
5. Look for the Brud Code icon in your sidebar.

---

## Usage

Brud Code works with **any AI assistant** — ChatGPT, Claude, Gemini, or any free web AI. You don't need API keys or paid subscriptions.

### Recommended: Start with the Prompt Library

The Prompt Library is the fastest way to get started:

1. **Install Brud Code** from the VS Code marketplace.
2. **Open the Prompt Library** from the welcome screen or the Management window.
3. **Browse ready-made prompts** for different operations (create, search/replace, append, delete, etc.).
4. **Copy the Master System Prompt** and share it with your AI assistant — this teaches the AI how to output Brud-compatible blocks.

### Workflow

1. **Give the Master System Prompt** to your AI assistant once. It tells the AI how to format code changes.
2. **Tell the AI what you want to change** in your codebase (e.g., "Add a discount parameter to the calculateTotal function").
3. **The AI outputs a Brud block** inside a code fence. Example:

   ```brud
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

4. **Copy the Brud block** from the AI response.
5. **Paste it into the Brud Code sidebar** in VS Code.
6. **Preview and Execute** — review the diff, then apply the change.
7. **Review the report** — Brud shows you exactly what changed and lets you revert if needed.

> The Prompt Library contains operation-specific prompts for CREATE_FILE, SEARCH/REPLACE, APPEND_FILE, DELETE_FILE, directory operations, and structure extraction. Use these prompts to get exactly the output you need from your AI.

---

## Contributing

Contributions are welcome. Please read CONTRIBUTING.md for guidelines on the development workflow, coding standards, and pull request process.

---

## License

Brud Code is licensed under the MIT License. See the LICENSE file for details.

---

<p align="center">
  <a href="https://github.com/rahatarch/brud">Star this repository</a> |
  <a href="https://github.com/rahatarch/brud/issues">Report a bug</a> |
  <a href="https://github.com/rahatarch">Follow the builder</a>
</p>

<p align="center">
  <sub>(c) 2026 Akkhar-Labs. Principal Architect: Rahat Hasan.</sub>
</p>