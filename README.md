<p align="center">
  <img src="assets/images/brud_super_high.png" width="200" alt="Brud Code Logo" />
</p>

<h3 align="center">AI-Assisted Coding Platform — Manual Paste, Surgical Apply, Full Control</h3>

<p align="center">
  <img src="https://img.shields.io/github/actions/workflow/status/rahatarch/brud/ci.yml?style=for-the-badge&logo=github&logoColor=white" alt="CI" />
  <img src="https://img.shields.io/badge/VS%20Code-1.136%2B-blue?style=for-the-badge&logo=visualstudiocode&logoColor=white" alt="VS Code 1.136+" />
  <img src="https://img.shields.io/badge/License-MIT-4CAF50?style=for-the-badge" alt="License MIT" />
  <img src="https://img.shields.io/github/stars/rahatarch/brud?style=for-the-badge&logo=github&logoColor=white" alt="GitHub Stars" />
</p>

<p align="center">
  <strong>Fork of <a href="https://github.com/akkhar-labs/akkhar-code-patcher">Akkhar Code Patcher</a></strong> — the original repository is no longer maintained. This is the official continuation under a new identity.
</p>

<p align="center">
  <img src="assets/images/brud_editor_view.png" alt="Brud Code Editor View" width="100%" />
</p>

## About

Brud Code is a **free, AI-assisted coding platform** that works with any AI chatbot — ChatGPT, Claude, Gemini, or others. You paste AI-generated code changes into the Brud Code sidebar, preview the diff, and execute with surgical precision. No API keys, no subscriptions, just copy, paste, and apply.

Built as a fork of Akkhar Code Patcher, Brud Code gives you full control over every AI-driven change. Unlike copilot-style tools that modify files invisibly, Brud Code keeps you in the driver's seat: review every edit before it touches your project, revert anytime, and audit your full history. It's the safety-first approach to AI-assisted development.

## One-Click Round-Trip

Brud turns AI-assisted file operations into a **one-paste, one-copy workflow**.

Your AI gives you a Brud block. You paste it. Brud executes everything — every file operation, every terminal command, every structure extraction — in milliseconds. Then you click **Copy All**. Every result the AI needs is in your clipboard: status, file paths, messages, and file-level details. Paste it back to your AI. The loop is closed.

**No manual switching. No reformatting. No lost context.**

### Real Numbers: Verified Benchmarks

*All metrics below are from live, verified testing on real hardware. Every number was measured, not assumed.*

| Benchmark | Scale | Manual Actions | Brud Actions | Time Saved |
|---|---|---|---|---|
| Create Files | 100 files | ~400 | 2 | ~99.5% reduction |
| Create Files | 1,000 files | ~4,000 | 2 | *pending* |
| Search & Replace | 1,000+ files, 300K+ LOC | *pending* | 2 | *pending* |
| Append Multi | 1,000+ files | *pending* | 2 | *pending* |

*Pending benchmarks will be filled in as testing completes. The 100-file row is verified.*

**That's the Brud workflow. The AI decides. Brud executes. You bridge the gap with a single click.**

## Installation

Download the [latest VSIX](https://github.com/rahatarch/brud/releases) and install manually:

```bash
# Install from VSIX
code --install-extension brud-code-*.vsix

# Or install via CLI from the marketplace (once published)
code --install-extension rahatarch.brud-code
```

You can also install from the VS Code Extensions view: press `Ctrl+Shift+X`, search "Brud Code", and click Install. Or use the `...` menu → **Install from VSIX** and select the downloaded file. Reload VS Code when prompted.

## Features

### File Operations
Create, delete, rename, move, copy, and append files and directories — all through AI-generated Brud blocks. Every operation is previewed, logged, and reversible.

### Bulk Operations
Process thousands of files in a single block. Apply the same transformation across an entire directory tree with one atomic operation. Brud handles the orchestration so your AI doesn't need to iterate file by file.

### Code Discovery
Extract your project structure as a token-efficient JSON tree, query codebase metadata, search files by name or content pattern, and read files with import-chain following. Give your AI full context without bloating the prompt.

### Terminal
Run single commands, sequential chains, parallel groups, or conditional pipelines — all driven by AI-generated blocks. Interactive CLI programs work too: Brud feeds answers back to the AI for dynamic workflows.

### History
Every operation is snapshotted. Revert individual edits or entire sessions. A 7-day trash bin protects against accidental loss. Full audit trail so you always know what changed and when.

### AI Integration
Works with **any** AI chatbot — free or paid, API or web UI. Use `GET_TOOL_INFO` to let the AI discover every available tool dynamically. The built-in Prompt Library provides ready-made prompts for common workflows.

## How It Works

```text
1. Install Brud Code → 2. Open Prompt Library → 3. Copy Master Prompt
      ↓                                                          
4. Paste into ChatGPT, Claude, or Gemini
      ↓
5. Tell AI: "Add a discount parameter to calculateTotal"
      ↓
6. AI outputs a Brud block:
```

```txt
File Path: src/utils.js
<<<<<<< SEARCH [1]
function calculateTotal(price, tax) {
  return price + tax;
}
=======
function calculateTotal(price, tax, discount = 0) {
  return price + tax - discount;
}
>>>>>>> REPLACE [1]
```

```text
7. Paste block into Brud Code sidebar → Preview → Execute → Done
```

## Agents & Prompt Library

The **Prompt Library** ships with ready-made prompts for every Brud tool: file operations, search, terminal commands, and more. Copy the **Master System Prompt** into any chatbot to teach it the Brud block format. Use `GET_TOOL_INFO` mid-conversation to let the AI discover new tools on the fly.

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — deep dive into the codebase
- [Prompt Library](https://github.com/rahatarch/brud) — built into the extension

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

Licensed under the [MIT License](LICENSE).

## FAQ

<details>
<summary><strong>Where did Brud Code come from?</strong></summary>

Brud Code is a fork of <a href="https://github.com/akkhar-labs/akkhar-code-patcher">Akkhar Code Patcher</a>. The original project is no longer maintained, and this fork is the official continuation under a new identity.
</details>

<details>
<summary><strong>Does Brud Code need API keys?</strong></summary>

No. Brud Code works with any AI chatbot — including free web versions. You paste the AI output; no API keys, tokens, or subscriptions required.
</details>

<details>
<summary><strong>Is Brud Code free?</strong></summary>

Yes. Brud Code is completely free and open source under the MIT license.
</details>

<details>
<summary><strong>What AI chatbots work with Brud Code?</strong></summary>

All of them. ChatGPT, Claude, Gemini, DeepSeek, Grok, Llama — any chatbot that can output text. The Master System Prompt teaches any AI the Brud block format.
</details>

## Community

<p align="center">
  <a href="https://github.com/rahatarch/brud">Star on GitHub</a> ·
  <a href="https://github.com/rahatarch/brud/issues">Report a Bug</a> ·
  <a href="https://github.com/rahatarch">Follow @rahatarch</a>
</p>