import { asset } from "@/lib/asset";

// The walkthrough. One screenshot per step, taken from a real session.
// Images live in public/images/guide and are all 1600x843.

export const GUIDE = {
  title: "One loop, start to finish",
  lede: "Hover a step to see it. Click to open it full screen.",
  shot: { width: 1600, height: 843 },
  steps: [
    {
      title: "Open Brud Code and click Prompt Library",
      image: asset("/images/guide/01-open-prompt-library.jpg"),
      alt: "The Brud Code panel in VS Code with the Prompt Library button highlighted.",
    },
    {
      title: "Choose the Master System Prompt",
      image: asset("/images/guide/02-open-master-system-prompt.jpg"),
      alt: "The Prompt Library grid with the Master System Prompt card highlighted.",
    },
    {
      title: "Copy it to your clipboard",
      image: asset("/images/guide/03-copy-master-system-prompt.jpg"),
      alt: "The Master System Prompt open, with the Copy button highlighted.",
    },
    {
      title: "Open any AI chatbot you already use",
      image: asset("/images/guide/04-open-your-ai-chatbot.jpg"),
      alt: "Google AI Studio open as an example chatbot.",
    },
    {
      title: "Paste the Master System Prompt into the chat",
      image: asset("/images/guide/05-paste-the-master-prompt.jpg"),
      alt: "The Master System Prompt pasted into the chatbot's input box.",
    },
    {
      title: "Check that the AI understood the protocol",
      image: asset("/images/guide/06-confirm-the-protocol.jpg"),
      alt: "The chatbot confirming it is ready to act as Brud AI.",
    },
    {
      title: "Ask it for anything, in plain language",
      image: asset("/images/guide/07-ask-for-anything.jpg"),
      alt: "Asking the chatbot to explore the codebase.",
    },
    {
      title: "Copy the Brud block it replies with",
      image: asset("/images/guide/08-copy-the-brud-block.jpg"),
      alt: "The chatbot's reply containing a Brud block, with the copy icon highlighted.",
    },
    {
      title: "Paste it into Brud Code and hit Execute",
      image: asset("/images/guide/09-execute-in-brud-code.jpg"),
      alt: "The Brud block pasted into the Brud Code input box next to the Execute button.",
    },
    {
      title: "Copy the full session result",
      image: asset("/images/guide/10-copy-the-session-result.jpg"),
      alt: "The Brud Session Results panel with the Copy Full button highlighted.",
    },
    {
      title: "Paste the result back to the AI",
      image: asset("/images/guide/11-paste-the-result-back.jpg"),
      alt: "Brud's output pasted back into the chatbot.",
    },
    {
      title: "Repeat the loop until the work is done",
      image: asset("/images/guide/12-repeat-the-loop.jpg"),
      alt: "The chatbot producing the next Brud block, continuing the loop.",
    },
  ],
};
