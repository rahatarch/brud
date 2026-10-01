> **Note**: This document is an initial design specification and project brief for the Brud Code marketing site. For the implemented architecture, refer to apps/web/README.md and ARCHITECTURE.md.

# Brud Code — Website Project Brief

> Single-page marketing site for **Brud Code**.
> Repo: https://github.com/rahatarch/brud
> Goal: explain the product in one scroll, convert visitors into installs + GitHub stars.

---

## 1. What Brud Code is

Brud Code is a **free, open-source VS Code extension** that turns any AI chatbot into an agentic coding tool.

You paste the Master Prompt into ChatGPT / Claude / Gemini / DeepSeek / Grok once. After that, the AI outputs structured **Brud blocks**. You paste a block into the Brud sidebar, hit **Execute**, and Brud performs the real file operations on your codebase — previewed, logged, and fully reversible. Then one click copies the result back to the AI, and the loop continues.

**One paste in. One copy out.**

- No API keys
- No subscription
- No account, no cloud, no server
- MIT licensed
- Works in the VS Code you already have

**Tagline options:**
- *Unlimited vibe coding. Free. With any AI.*
- *You already pay nothing for ChatGPT. Why pay $20/month to let it edit your files?*
- *Every AI IDE sells you the model. You already have the model. Brud gives you the hands.*
- *The AI decides. Brud executes. You approve.*

---

## 2. The workflow (for the "How it works" section)

1. **Install** the extension, open the Brud sidebar in VS Code.
2. **Copy the Master System Prompt** from the bundled Prompt Library.
3. **Paste it into any AI chatbot.** The AI confirms it understands the protocol. (Once per session.)
4. **Ask for anything** — "explore my codebase", "add auth", "rename this across the project".
5. **AI returns a Brud block.** Copy it.
6. **Paste into Brud → Preview the diff → Execute.**
7. **Copy Brud's response** (Copy Full / Copy Summary) and paste it back into the chat.
8. **Repeat.** The AI now knows exactly what happened and continues.

Even if the AI generates 100+ operations in a single block, they execute in milliseconds with one copy-paste.

**Example Brud block:**

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

---

## 3. Problems it solves (core website content)

This is the heart of the site. Ordered by impact.

### Tier 1 — the six that close the sale

**1. "I ran out of credits again."**
Every AI IDE meters you. Cursor Pro gives $20 of usage then asks for more. Claude Code Max is $100+/mo and still has weekly caps. People hit rate limits at 11pm and their night ends.
→ **Brud:** you use the free web chat. There is no meter. Vibe code all night.

**2. "I'm stuck copy-pasting my files into chat like a robot."**
The most-posted complaint in r/vibecoding: copy files → paste into Claude/ChatGPT/DeepSeek → ask → copy output back → find the file → paste → repeat.
→ **Brud:** you stop feeding it files. The AI requests what it needs and Brud delivers. One paste each way.

**3. "I keep re-explaining my project."**
Chatbots don't know your codebase. New chat = start over. Devs report 3–4 hours a week lost re-explaining architecture.
→ **Brud:** `codebase_metadata` and `extract_structure` hand the AI a token-efficient map of the whole project in one block. New session? Paste the Master Prompt, ask it to explore. Caught up in 30 seconds.

**4. "My project is too big for the AI."**
Beginners dump every file into chat, blow the context window, and the AI gets confused. Past ~20 files, free-tier vibe coding stops working.
→ **Brud gives the AI a map, not a dump:**
  - `codebase_metadata` — instant read on codebase scale and density
  - `extract_structure` — token-efficient JSON directory map with depth control
  - `read_file` with **import following** — opens one file, recursively pulls what it imports, at a depth you control
  - `search_files` — find by name, pattern, or extension instead of reading everything
→ Proven on a real **384,000-line codebase**.

**5. "The AI deleted my files and I couldn't get them back."**
Replit's agent wiped a production database with no rollback. Google Antigravity deleted a user's entire drive. IDE checkpoints cannot recover files deleted via terminal commands. Beginners are openly scared of this.
→ **Brud:** every session is snapshotted before *and* after, stored locally in `.brud/history/`. Revert or restore 1,000 files in one click, even months later. Deleted sessions get a 7-day recovery window. No Git required.

**6. "I want the best model, not the one my tool sells me."**
Cursor pushes its own models. Claude Code is Claude. Antigravity is Gemini.
→ **Brud:** Gemini 3 Pro in AI Studio, free Claude, DeepSeek, Grok — whatever is best this week. Switch tabs, not subscriptions.

### Tier 2 — supporting pain points

| Pain | Brud's answer |
|---|---|
| "It rewrote my whole file and deleted half my code" (`// rest of code unchanged`) | SEARCH/REPLACE changes exact lines only. Can't break what it didn't touch |
| "I accepted 30 changes without reading them and now it's broken" | Preview the diff, then apply. Nothing touches disk unprompted |
| "I have to install a whole new editor" — Cursor/Antigravity are VS Code forks | One extension in the VS Code you already have. Your setup stays yours |
| "I'm paying for the AI to *read* my files" — most agent tokens go to searching and opening files, not writing code | The free chat does the reading. You pay nothing either way |
| "Editing 200 files one at a time is impossible" | 1,000 files created in under 1 second. 467 files patched in milliseconds |
| "Copy-pasting terminal errors back and forth forever" | Terminal output routes straight back in the copy-out block |
| "My private code gets uploaded and indexed on their cloud" | Runs locally. No account, no server, no upload |
| "Free tiers are deliberately crippled" | Free forever, MIT, no tier above you |
| "I don't know Git and everything assumes I do" | No Git required. History is just a folder in your project |

---

## 4. What it does (feature table — from README)

| Feature | Description |
|---|---|
| **File Operations** | Create, delete, rename, move, copy, and append files — reviewed and reversible every time |
| **Bulk Operations** | Apply one transformation across hundreds or thousands of files in a single pass |
| **Code Discovery** | Give your AI a token-efficient map of your project so it writes changes that actually fit |
| **Terminal** | Run commands, chains, and interactive CLI tools, with output routed straight back to the AI |
| **Any AI, Any Time** | Works with ChatGPT, Claude, Gemini, DeepSeek, Grok, Llama — anything that can output text |

**Why people switch:**
- 🆓 Free, forever, no keys
- 🔁 One paste in, one copy out
- 👀 You approve every change
- ⏪ One-click undo, at any scale
- ⚡ Built for bulk
- 🔓 No lock-in

---

## 5. Benchmarks (proof section — use verbatim)

Tested on a real **384K LOC codebase**, manually verified end to end:

| Benchmark | Scale | Result | Time |
|---|---|---|---|
| Create Files | 1,000 files | 1,000/1,000 created, unique content | Under 1 second |
| Search & Replace | 467 files / 384K LOC | 467 patched, 0 failed | Milliseconds |
| Append Multi | 467 files | 467 modified, 0 failed | Milliseconds |
| Revert Session | 1,000 files | 1,000/1,000 reverted | Milliseconds |
| Restore Session | 1,000 files | 1,000/1,000 restored | Milliseconds |

**100% success rate across every benchmark.** No manual per-file work — the AI generates one block, Brud handles the rest.

---

## 6. Credibility signals (worth surfacing)

From ARCHITECTURE.md — these separate Brud from weekend-project tools:

- **21 operation types** across file, directory, bulk, discovery, read, and terminal categories
- **Safety layer** — dangerous command detection, workspace boundary enforcement on every path, path sanitization
- **Snapshot system** — hybrid full pre-snapshot + diff post-snapshot, trash-based soft-delete with 7-day protection
- **Import resolver** — recursive import dependency resolution
- **Platform-agnostic core** — zero Node.js / zero VS Code API in the core engine; adapters injected
- **12+ test suites**, real filesystem operations (no I/O mocking), full E2E integration tests, GitHub Actions CI

---

## 7. Installation (site section)

**Option A — VSIX**
```bash
code --install-extension brud-code-*.vsix
```
Download from https://github.com/rahatarch/brud/releases

**Option B — inside VS Code**
`Ctrl+Shift+X` → search **Brud Code** → **Install**

Then: open the **Prompt Library** in the sidebar, copy the Master Prompt into your chatbot, start pasting Brud blocks. First AI-generated change applied in under two minutes.

---

## 8. FAQ (from README)

**Do I need an API key?**
No. Brud Code works with any chatbot's free web UI. Paste the AI's output directly — no keys, tokens, or subscriptions.

**Is it really free?**
Yes — free and open source under the MIT license.

**Which AI chatbots work with it?**
Any chatbot that outputs text: ChatGPT, Claude, Gemini, DeepSeek, Grok, Llama, and more.

**Can it handle a large codebase?**
Yes. Tested on a real 384K LOC project — 467 files patched in milliseconds with zero failures. Code Discovery gives the AI a token-efficient map so it never has to read everything.

**What if the AI breaks something?**
Every session is snapshotted before and after. Revert an entire 1,000-file session in one click, even months later.

**Where did Brud Code come from?**
Brud Code is a fork of Akkhar Code Patcher, which is no longer maintained. Brud Code is its official continuation under a new identity.

---

## 9. Website structure (single page)

| # | Section | Purpose |
|---|---|---|
| 1 | **Hero** | Visual product shot + headline + dual CTA (Install / Star on GitHub) |
| 2 | **The problem** | Copy-paste hell — visual of the manual loop |
| 3 | **The loop** | Paste in → Execute → Copy out → Paste back. Animated, 4 steps |
| 4 | **Your AI finally knows your codebase** | Code Discovery, map not dump |
| 5 | **Scales to 384K lines** | Big codebase + benchmark table |
| 6 | **Undo actually works** | Snapshot system, safety layer, the horror stories |
| 7 | **Any model, any editor, your machine** | Model freedom, no fork, local, no cloud |
| 8 | **Install in 2 minutes** | Both install paths + Master Prompt step |
| 9 | **FAQ** | Accordion |
| 10 | **Final CTA** | Big star-the-repo block |
| 11 | **Footer** | Links, MIT, built by Rahat Hasan / Akkhar-Labs |

---

## 10. GitHub star CTA (priority requirement)

The star CTA must be **impossible to miss** and appear in **three places**:

1. **Hero** — secondary button next to Install, showing the live star count
   `⭐ Star on GitHub` + badge
2. **Sticky navbar** — persistent star button, always visible on scroll
3. **Final CTA section** — full-width, the loudest element on the page

**Suggested final CTA copy:**

> ### Brud is free. Forever. MIT licensed.
> No subscription to cancel, no card to enter, no limits to hit.
> **A star is the only thing we ask for.**
>
> [⭐ Star on GitHub] [⬇ Install Brud Code]

Why this works: the site spends the whole scroll proving Brud costs nothing. The star becomes the natural way to reciprocate. Lead with the gift, then ask.

**Implementation notes:**
- Pull live star count from the GitHub API and display it — social proof
- Animate the star icon on hover
- Consider a subtle one-time toast after ~60s on page: "Enjoying this? Star the repo →"

---

## 11. Design direction

**Reference tier:** Linear, Stripe, Raycast, Cursor, Vercel, Resend.

### 11.1 Color palette — LOCKED

```css
:root {
  /* ground + ink */
  --color-background:   #0D0E10;  /* page ground */
  --color-surface:      #1A1B1F;  /* cards, code blocks, accordion panels */
  --color-surface-2:    #212226;  /* nested surfaces: pre inside a card */
  --color-primary:      #FFFFFF;  /* display type, primary button fill */
  --color-text:         #E5E5EA;  /* body copy */
  --color-text-muted:   #8E8E93;  /* captions, labels, footer */

  /* accent */
  --color-accent:       #FF3B30;  /* mark, links, hover, focus */
  --color-accent-hov:   #FF5247;
  --color-accent-dim:   rgba(255, 59, 48, 0.12);  /* wash / glow / focus halo */

  /* structure */
  --color-border:       #2C2C2E;  /* hairline dividers only */
  --color-border-strong:#3A3A3C;  /* card edges, table rules */

  /* state */
  --color-success:      #30D158;  /* "467 patched, 0 failed" */
  --color-warning:      #FFB020;  /* dangerous-command detection callout */

  /* logo mark gradient — SAMPLE FROM icon.png, values below are placeholders */
  --grad-mark-from:     #FF7A1A;
  --grad-mark-to:       #FF3B81;
}
```

**Focus ring:** 2px `--color-accent`, 3px offset, 6px `--color-accent-dim` halo. A 1px red outline on this background is invisible.

**Measured contrast against `#0D0E10`** (verified in `design-preview/index.html`, not estimated):

| Token | Ratio | Verdict |
|---|---|---|
| `--color-primary` #FFFFFF | 19.0:1 | AAA |
| `--color-text` #E5E5EA | 15.2:1 | AAA |
| `--color-text-muted` #8E8E93 | 5.8:1 | AA |
| `--color-accent` #FF3B30 as text | 5.4:1 | AA |
| White text **on** #FF3B30 | 3.5:1 | **fails AA — do not ship** |
| Near-black #0D0E10 on #FF3B30 | 5.4:1 | AA |
| old surface #16171A | 1.05:1 | invisible — replaced by #1A1B1F |
| `--color-border` #2C2C2E | 1.37:1 | hairlines only |
| `--color-border-strong` #3A3A3C | 1.67:1 | card edges, table rules |

**Standing rules:**

1. **Accent vs. logo.** The extension mark is an orange→pink gradient; `#FF3B30` is a flat red. Rule: the **gradient lives only inside the logo mark and the 3D hero render**. Every other accent use is flat `#FF3B30`. Do not gradient buttons — it will read as two different brands.
2. **Red means "destroy".** Brud's core promise is safety and undo. Never use `--color-accent` for errors, warnings, or destructive UI. Errors use `--color-warning`; benchmark/success states use `--color-success`. Accent is reserved for *desirable* actions only (Install, Star, Execute).
3. **Never put white text on the red fill** — 3.5:1, fails AA. The primary CTA is a **white fill with `#0D0E10` text** (19:1); the star CTA sits beside it as a ghost button with a `--color-border-strong` edge. If a red fill is unavoidable, its label must be `#0D0E10`. This keeps accent red confined to the mark, links, hover and focus, which is what keeps 2% feeling loud.

**Usage ratio:** ~90% background/surface, ~8% text, ~2% accent. If accent exceeds 2% of pixels the page stops feeling premium.

### 11.2 Typography — LOCKED (5 faces)

| Face | Role | Where it appears | Sizes | Weight |
|---|---|---|---|---|
| **Newsreader** | Display only | Hero headline, the 10 section H2s, the final CTA headline, one or two pull-quote stats | 24px+ only | 400 / 500 / 600 |
| **Satoshi** | Prose workhorse | Body copy, lead paragraphs, buttons, nav, FAQ answers, captions, form labels | 14–20px | 400 / 500 / 700 |
| **Commit Mono** | Engineering texture | Brud blocks, code, install commands, file paths, benchmark table data, terminal output | 13–16px | 400 / 700 |
| **Bubbledot Fine** | Instrumentation | Eyebrow labels, section numbers, live star count, the single hero stat | 10–14px uppercase; one 48px+ exception | Regular |
| **Array** | Instrumentation (alt) | Same role as Bubbledot; Array Wide preferred for the large `384K` stat | 10–14px uppercase; one 48px+ exception | Regular |

**Why Satoshi was added.** The earlier 3-face system had no neutral sans, which forced a "no paragraph over 3 lines" rule — a workaround for a missing font, not a design decision. Satoshi is already in the local library (`F:\Fonts\page-2\Satoshi_Complete`), ships a 42 KB variable WOFF2, and is Fontshare-licensed for commercial use. Side-by-side at 16px/1.7, Commit Mono runs roughly 35% wider and reads as terminal output — right for a diff block, wrong for an FAQ answer.

**That 3-line constraint is now lifted.** Prose can breathe. Commit Mono keeps everything that should *look* like a machine wrote it.

**Satoshi rules:**
- Body 16px / line-height 1.7 / `--color-text`; lead paragraphs 20px / 1.55 / weight 500.
- Max line length 62ch.
- Buttons: weight 500, never bold.
- Never used above 20px — that range belongs to Newsreader.

**Newsreader rules:**
- Display only, 24px and up. It is a text serif at heart, so below 24px it stops reading as display and starts competing with Satoshi.
- Tracking -0.02em at 48px, -0.03em at 80px+. Set the optical size axis to `opsz 72` at display sizes so the serifs stay crisp and high-contrast.
- Sentence case, never title case, never all-caps.
- Variable axes: `opsz` 6-72 and `wght` 200-800, plus a true italic. Keep display weights between 400 and 600; hierarchy still comes mainly from **size and color**, not weight.

**Bubbledot Fine rules:**
- It is a dot-matrix face: a texture, not a text face. Labels and numbers only.
- Always uppercase, tracking +0.12em to +0.18em.
- Use `--color-text-muted` for labels, `--color-accent` for the one hero stat.
- Maximum **one** large-size use on the whole page (recommended: the `384K LOC` or `1,000 FILES` benchmark readout). Beyond that it turns retro-arcade and fights the obsidian hero.
- Never place it near the logo mark — two dotted/geometric forms competing.
- **Licensing caveat — unresolved.** The local copy came from OnlineWebFonts, whose bundled licence simultaneously claims CC BY 4.0 and warns that fonts "may be trial versions… and may not allow embedding unless a commercial license is purchased." The `W01` filename is Monotype web-package naming, which suggests a commercial original. **Before launch: either obtain clearance for Bubbledot Fine or substitute Array**, which fills the identical niche, ships a proper Fontshare licence file, and is already local.

**Array rules:**
- Interchangeable with Bubbledot in the instrumentation role; do not use both on the same page.
- **Array Wide** is the recommended cut for the one large stat (`384K` / `1,000 FILES`).
- Uppercase, tracking +0.10em to +0.14em.

**Type scale:**

```css
:root {
  --text-hero:      clamp(48px, 7vw, 92px);  /* Newsreader, lh 1.05, tracking -0.03em */
  --text-h2:        clamp(32px, 4vw, 52px);  /* Newsreader, lh 1.15, tracking -0.02em */
  --text-stat:      clamp(56px, 11vw, 132px);  /* Bubbledot or Array Wide, one use only */
  --text-body-lg:   20px;  /* Satoshi 500, lh 1.55 — hero subhead, lead paragraphs */
  --text-body:      16px;  /* Satoshi 400, lh 1.7 */
  --text-body-sm:   14px;  /* Satoshi 400, lh 1.6 — captions */
  --text-code:      13.5px;  /* Commit Mono, lh 1.55 — Brud blocks, install commands */
  --text-table:     13px;  /* Commit Mono, lh 1.55 — benchmark table data */
  --text-eyebrow:   12px;  /* Bubbledot or Array, uppercase, +0.14em to +0.16em */
}
```

**Licensing / hosting:**

| Face | Licence | Status | Source |
|---|---|---|---|
| Newsreader | OFL | safe | Google Fonts, loaded directly from `fonts.googleapis.com` (variable, opsz 6-72 / wght 200-800) |
| Satoshi | Fontshare FFL | safe | local — `Satoshi-Variable.woff2`, 42 KB |
| Commit Mono | OFL | safe | local — OTF only, **must convert to WOFF2** |
| Array | Fontshare FFL | safe | local — `Array-Regular` / `Array-Wide`, ~18 KB each |
| Bubbledot Fine | unclear | **resolve before launch** | OnlineWebFonts repackage — see caveat above |

**Self-host everything as WOFF2 with `font-display: swap`**, with one deliberate exception: Newsreader is hotlinked from Google Fonts (`@import`/`<link>` with `display=swap`). Self-host it too if a zero-third-party-request policy is adopted later. Commit Mono currently exists locally as 275 KB OTFs — subset and convert before production.

**Live specimen:** `design-preview/index.html` renders all five faces and the full palette on the real background, with measured contrast ratios and the button-contrast comparison.

### 11.3 Layout, depth, motion

- **Layout:** centered max-width ~1200px, heavy vertical whitespace, bento grid for features
- **Depth:** subtle accent-tinted glow behind the hero (`--color-accent-dim`), fine noise texture overlay, 1px `--color-border` hairlines
- **Motion:** scroll-triggered fades, the 4-step loop animates on scroll, micro-interactions on buttons
- **Code:** real syntax-highlighted Brud blocks as hero visuals in Commit Mono. The SEARCH/REPLACE format is visually distinctive — use it. Highlight added lines with `--color-success` at low opacity, removed lines with `--color-warning` at low opacity
- **Screenshots:** the VS Code sidebar UI shots are strong assets. Frame them in editor chrome with a soft glow

**Avoid:** stock illustrations, generic 3D blobs, emoji-heavy sections, light mode as default, gradient buttons, Newsreader below 24px, Bubbledot or Array in sentences, white text on the red fill, Satoshi above 20px.

---

## 12. Tech stack (suggested)

- Next.js + Tailwind CSS
- Framer Motion for scroll animation
- Shiki for syntax highlighting
- Deploy on Vercel
- Static, no backend needed (GitHub star count via client-side API call with caching)

---

## 13. Assets needed

- [ ] Brud logo / icon (SVG, from extension)
- [ ] Hero product screenshot — VS Code with Brud sidebar open
- [ ] Screenshots: Prompt Library, Master System Prompt, Brud Session Results
- [ ] Diff preview screenshot (the approval moment — key trust visual)
- [ ] Short screen recording of the full loop (hero background or demo section)
- [ ] OG image for social sharing
- [ ] Favicon
- [ ] WOFF2 subsets: Satoshi, Commit Mono, Array, Bubbledot Fine (Newsreader is served by Google Fonts)
- [ ] Sample `--grad-mark-from` / `--grad-mark-to` from the real `icon.png` (values in §11.1 are placeholders)
- [ ] Licence clearance decision for Bubbledot Fine, or swap to Array

---

## 14. Facts to never get wrong

- License: **MIT**
- Author: **Rahat Hasan**, Akkhar-Labs
- History location: **`.brud/history/`**
- Recovery window for deleted sessions: **7 days**
- Benchmark codebase: **384K LOC**
- Operation types: **21**
- Predecessor: fork of **Akkhar Code Patcher** (unmaintained)
- Repo: **https://github.com/rahatarch/brud**
