import { asset } from "@/lib/asset";

// The install section. Marketplace is the main path; the VSIX is the fallback.

export const INSTALL = {
  title: "Install in under a minute",
  lede: "The easiest way is straight from VS Code. Search for Brud Code and hit Install.",
  shot: {
    src: asset("/images/Install.jpg"),
    width: 1600,
    height: 861,
    alt: "The Brud Code page in the VS Code Extensions marketplace, published by Akkhar-Labs.",
  },
  steps: [
    {
      title: "Open Extensions in VS Code",
      keys: ["Ctrl", "Shift", "X"],
    },
    {
      title: "Search for \u201CBrud Code\u201D",
      note: "Akkhar-Labs",
    },
    {
      title: "Click Install, then open the Prompt Library",
    },
  ],
  actions: [
    {
      label: "Open in VS Code",
      href: "vscode:extension/akkhar-labs.brud",
      variant: "solid",
    },
    {
      label: "View on Marketplace",
      href: "https://marketplace.visualstudio.com/items?itemName=akkhar-labs.brud",
      variant: "muted",
      external: true,
    },
  ],
  manual: {
    title: "Prefer to install it by hand?",
    body: "Download the latest .vsix from GitHub releases, then run:",
    command: "code --install-extension brud-code-*.vsix",
    link: {
      label: "GitHub releases",
      href: "https://github.com/rahatarch/brud/releases",
    },
  },
  facts: ["Free", "MIT", "VS Code 1.80+"],
};
