<p align="center">
  <img src="assets/images/brud_super_high.png" width="200" alt="Brud Code Logo" />
</p>

<h1 align="center">Stop hand-copying AI code changes into your files.</h1>

<p align="center">
  Paste AI output → preview the diff → apply it. One click. Full undo, always.
</p>

<p align="center">
  <img src="https://img.shields.io/github/actions/workflow/status/rahatarch/brud/ci.yml?style=for-the-badge&logo=github&logoColor=white" alt="CI Status" />
  <img src="https://img.shields.io/badge/VS%20Code-1.80%2B-blue?style=for-the-badge&logo=visualstudiocode&logoColor=white" alt="VS Code 1.136+" />
  <img src="https://img.shields.io/badge/License-MIT-4CAF50?style=for-the-badge" alt="License MIT" />
  <img src="https://img.shields.io/github/stars/rahatarch/brud?style=for-the-badge&logo=github&logoColor=white" alt="GitHub Stars" />
</p>

<p align="center">
  <img src="assets/images/brud_editor_view.png" alt="Brud Code Editor View" width="100%" />
</p>

<p align="center">
  <b>No API keys. No subscription. Works with ChatGPT, Claude, Gemini — any chatbot.</b>
</p>

---

If you use AI chatbots to write code, you already know the friction: copy a function, find the file, paste it, hope you didn't miss a line, repeat for the next file. **Brud Code removes that step.** Your AI outputs a change; Brud applies it — reviewed, logged, and reversible — in one click.

## The whole workflow is one paste, one copy

Most AI coding tools stop at "apply the change." Brud closes the loop back to your AI too — so it always knows what actually happened, without you typing a status update by hand.

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

1. **Paste** — your AI hands you a Brud block like the one above. Drop it into the sidebar.
2. **Execute** — Brud shows you the diff and applies it. Works identically whether it's 1 file or 1,000.
3. **Copy All** — one click copies everything your AI needs back: status, file paths, messages, per-file results.
4. **Paste it back** — drop that into the chat. Your AI now knows exactly what happened, and picks up right where it left off.

**One paste in. One copy out.** No retyping results, no re-explaining what changed, no switching back and forth to check if something failed.

## Why people switch to Brud Code

- 🆓 **Free, forever, no keys.** Works with any chatbot's web UI — nothing to configure, nothing to pay for.
- 🔁 **One paste in, one copy out.** The AI's result — status, files, errors — comes back to it automatically, no manual re-explaining.
- 👀 **You approve every change.** Nothing touches your files until you preview the diff and hit apply.
- ⏪ **One-click undo, at any scale.** Revert a single edit or an entire thousand-file session in one action.
- ⚡ **Built for bulk.** Create, patch, or restructure hundreds of files from a single AI-generated block.
- 🔓 **No lock-in.** No Git required, no account, no server — your history lives in your own workspace.

## Install it now

**Fastest way:** [Download the latest release](https://github.com/rahatarch/brud/releases) and install the VSIX:

```bash
code --install-extension brud-code-*.vsix
```

Or from inside VS Code: `Ctrl+Shift+X` → search **Brud Code** → **Install**.

Once installed, open the **Prompt Library** in the sidebar, copy the Master Prompt into your favorite AI chatbot, and start pasting Brud blocks. You'll be applying your first AI-generated change in under two minutes.

## What it does

| | |
|---|---|
| **File Operations** | Create, delete, rename, move, copy, and append files — reviewed and reversible every time. |
| **Bulk Operations** | Apply one transformation across hundreds or thousands of files in a single pass. |
| **Code Discovery** | Give your AI a token-efficient map of your project so it writes changes that actually fit. |
| **Terminal** | Run commands, chains, and interactive CLI tools, with output routed straight back to the AI. |
| **Any AI, Any Time** | Works with ChatGPT, Claude, Gemini, DeepSeek, Grok, Llama — anything that can output text. |

## It's fast — and we proved it

Tested on a real 384K LOC codebase, manually verified end to end:

| Benchmark | Scale | Result | Time |
|---|---|---|---|
| Create Files | 1,000 files | 1,000/1,000 created, unique content | Under 1 second |
| Search & Replace | 467 files / 384K LOC | 467 patched, 0 failed | Milliseconds |
| Append Multi | 467 files | 467 modified, 0 failed | Milliseconds |
| Revert Session | 1,000 files | 1,000/1,000 reverted | Milliseconds |
| Restore Session | 1,000 files | 1,000/1,000 restored | Milliseconds |

**100% success rate across every benchmark.** No manual per-file work — the AI generates one block, Brud handles the rest.

## Your history, your machine

Every session is automatically snapshotted before and after, stored locally in `.brud/history/` in your own workspace — no account, no cloud, no external service. Revert or restore any session instantly, even months later (deleted sessions get a 7-day recovery window before cleanup). Full technical details are in [ARCHITECTURE.md](ARCHITECTURE.md).

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — how the snapshot engine, diffing, and history system work internally
- [CONTRIBUTING.md](CONTRIBUTING.md) — contribution guidelines
- Prompt Library — bundled in the extension sidebar

## FAQ

<details>
<summary><strong>Do I need an API key?</strong></summary>
<br>
No. Brud Code works with any chatbot's free web UI. Paste the AI's output directly — no keys, tokens, or subscriptions.
</details>

<details>
<summary><strong>Is it really free?</strong></summary>
<br>
Yes — free and open source under the MIT license.
</details>

<details>
<summary><strong>Which AI chatbots work with it?</strong></summary>
<br>
Any chatbot that outputs text: ChatGPT, Claude, Gemini, DeepSeek, Grok, Llama, and more.
</details>

<details>
<summary><strong>Where did Brud Code come from?</strong></summary>
<br>
Brud Code is a fork of <a href="https://github.com/akkhar-labs/akkhar-code-patcher">Akkhar Code Patcher</a>, which is no longer maintained. Brud Code is its official continuation under a new identity.
</details>

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) to get started.

## Community

- ⭐ Star the repo to support development
- 🐛 Report bugs via [GitHub Issues](https://github.com/rahatarch/brud/issues)
- 💡 Suggest features via [GitHub Discussions](https://github.com/rahatarch/brud/discussions)
- 🔧 Contribute via [Pull Requests](https://github.com/rahatarch/brud/pulls)

## License

[MIT](LICENSE)

---

**The AI decides. Brud executes. You bridge the gap with a single click.**

<p align="center">
  <a href="https://github.com/rahatarch/brud/releases"><b>⬇ Install Brud Code</b></a> ·
  <a href="https://github.com/rahatarch/brud">⭐ Star on GitHub</a> ·
  <a href="https://github.com/rahatarch/brud/issues">🐛 Report a Bug</a>
</p>