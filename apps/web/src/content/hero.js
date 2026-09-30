// Every word the hero says, in one place, so copy edits never touch layout.

import { asset } from "@/lib/asset";

export const NAV = {
  brand: { href: asset("/"), lead: "Brud", trail: "Code" },
  links: [
    { label: "Install", href: "#install" },
    { label: "Features", href: "#features" },
    { label: "Guide", href: "#guide" },
    { label: "FAQ", href: "#faq" },
  ],
  github: "https://github.com/rahatarch/brud",
};

export const HERO = {
  // The headline morphs between these two phrases. Keep both at two lines so
  // the block never changes height mid-animation.
  title: ["Unlimited", "AI Coding"],
  titleAlt: ["A VS Code", "extension"],
  lede: "Unlimited vibe coding. Free. With any AI.",
  actions: [
    { label: "Install extension", href: "#install", variant: "solid" },
    { label: "Read the guide", href: "#guide", variant: "muted" },
  ],
  // Each beat shows only its `lead` until you hover it, then `tail` completes
  // the sentence. Keep every lead to one line at the widest breakpoint.
  points: [
    {
      lead: "For any AI chatbot",
      tail: "you already use \u2014 ChatGPT, Claude, Gemini, DeepSeek, Grok or Llama. No API key, no account.",
    },
    {
      lead: "To code like an agent",
      tail: "Brud reads the repo, gathers the files that matter, and writes the plan your chatbot needs.",
    },
    {
      lead: "One paste in, one copy out",
      tail: "Paste the prompt into the chat, copy the answer back, and Brud applies every edit to disk.",
    },
  ],
  facts: [
    "Free",
    "MIT",
    "No account",
    "No cloud",
    "Works with ChatGPT, Claude, Gemini, DeepSeek, Grok, Llama",
  ],
};
