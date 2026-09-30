// The FAQ, verbatim from the README (PROJECT.md section 8). Six questions,
// in the order they occur to someone deciding whether to install.

export const FAQ = {
  eyebrow: "FAQ",
  title: "Questions before you install",
  lede: "The six things people ask most. Everything else lives in the README.",
  items: [
    {
      q: "Do I need an API key?",
      a: "No. Brud Code works with any chatbot\u2019s free web UI. Paste the AI\u2019s output directly \u2014 no keys, tokens, or subscriptions.",
    },
    {
      q: "Is it really free?",
      a: "Yes \u2014 free and open source under the MIT license.",
    },
    {
      q: "Which AI chatbots work with it?",
      a: "Any chatbot that outputs text: ChatGPT, Claude, Gemini, DeepSeek, Grok, Llama, and more.",
    },
    {
      q: "Can it handle a large codebase?",
      a: "Yes. Tested on a real 384K LOC project \u2014 467 files patched in milliseconds with zero failures. Code Discovery gives the AI a token-efficient map so it never has to read everything.",
    },
    {
      q: "What if the AI breaks something?",
      a: "Every session is snapshotted before and after. Revert an entire 1,000-file session in one click, even months later.",
    },
    {
      q: "Where did Brud Code come from?",
      a: "Brud Code is a fork of Akkhar Code Patcher, which is no longer maintained. Brud Code is its official continuation under a new identity.",
    },
  ],
};
