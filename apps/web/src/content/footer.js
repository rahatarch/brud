import { asset } from "@/lib/asset";

// The closing section: one last call to action over the ember plate, then the
// wordmark. Every word lives here so copy edits never touch layout.

export const FOOTER = {
  title: "Chatbot in. Agent out.",

  action: { label: "Install extension", href: "#install" },

  // The dark pill beside it. Quick Open in VS Code (Ctrl+P) takes this line
  // verbatim, so copying it is the whole install.
  copy: {
    label: "Copy install command",
    done: "Copied",
    command: "ext install akkhar-labs.brud",
  },

  links: [
    { label: "GitHub", href: "https://github.com/rahatarch/brud", external: true },
    {
      label: "Marketplace",
      href: "https://marketplace.visualstudio.com/items?itemName=akkhar-labs.brud",
      external: true,
    },
    { label: "Guide", href: "#guide" },
    { label: "FAQ", href: "#faq" },
  ],

  legal: "MIT licensed. Free forever. No account, no cloud.",

  // The dot-matrix wordmark across the foot of the page. The flower sits
  // between the two words, dotted to match.
  wordmark: { lead: "Brud", trail: "Code", label: "Brud Code" },

  background: {
    // The loop, and its first frame shown until the loop can play (and
    // instead of it for anyone who has asked for reduced motion).
    // WebM first: smaller, and every browser that can't play it takes the MP4.
    video: [
      { src: "/videos/footer-bg-vid.webm", type: "video/webm" },
      { src: asset("/videos/footer-bg-vid.mp4"), type: "video/mp4" },
    ],
    src: asset("/images/footer_bg_image.webp"),
    alt: "",
  },
};
