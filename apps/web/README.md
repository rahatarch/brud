<div align="center">

<img src="src/app/icon.svg" width="88" alt="Brud Code logo" />

# Brud Code — Website

**Unlimited AI coding. One paste in, one copy out.**

The marketing site for [Brud Code](https://github.com/rahatarch/brud), the free, open-source VS Code extension that turns any AI chatbot into an agentic coding tool.

[**Live site**](https://miftahul-islam-efaz.github.io/Brud-code/) · [Extension repo](https://github.com/rahatarch/brud) · [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=akkhar-labs.brud)

</div>

---

## About

Brud Code lets you use the AI chatbot you already have — ChatGPT, Claude, Gemini, or any other — as a coding agent inside VS Code. You paste one master prompt into the chat, copy the chatbot's `brud` block back into the editor, and Brud runs it across your project. This repository is the landing page that explains and promotes it.

## Tech stack

| | |
|---|---|
| Framework | [Next.js 15](https://nextjs.org/) (App Router) + React 19 |
| Smooth scroll | [Lenis](https://github.com/darkroomengineering/lenis) |
| Styling | Plain CSS in `src/styles`, split per device (desktop / tablet / mobile) |
| Hosting | GitHub Pages (static export via GitHub Actions) |

## Project structure

```
src/
  app/            layout, page, favicon (icon.svg)
  components/     hero, journey, install, features, guide, faq, footer, brand, motion
  content/        copy and media for each section
  hooks/          animation hooks (rim light, etc.)
  lib/            helpers (asset paths for the Pages base path)
  styles/         CSS layers + tablet/mobile overrides
  assets/fonts/   self-hosted typefaces
public/           images, videos, logo glow masks
tools/            buildMarkMasks.mjs (regenerates public/mark)
media-source/     source media and the archived 3D hero prototype
```

## Getting started

Requires Node.js 20+.

```bash
npm install
npm run dev      # http://localhost:3000
```

Production build:

```bash
npm run build
npm start
```

## Deployment

Every push to `main` builds a static export and publishes it to GitHub Pages via [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).

The Pages build sets `GITHUB_PAGES=true` and `NEXT_PUBLIC_BASE_PATH=/Brud-code`, which switches `next.config.mjs` to `output: "export"` under the repo sub-path. Use the `asset()` helper from `src/lib/asset.js` for any file referenced from `public/` so it resolves on both localhost and Pages.

To deploy on a custom domain or Vercel instead, just run a normal `npm run build` — no base path is needed.

## Performance notes

- Lenis-driven smooth scrolling; pointer events pause while scrolling.
- The hero entrance waits for fonts and a few calm frames before playing, so it never stutters.
- The hero logo's glow is painted on canvas instead of CSS masks (far cheaper while it scales).
- Images and videos are pre-compressed (WebP / WebM + MP4 fallback).

## License

Code is released under the [MIT License](LICENSE).
The fonts in `src/assets/fonts` (Satoshi, Array, Bubbledot from Fontshare / ITF, and Commit Mono under the OFL) keep their own licenses and are not covered by MIT.
