<p align="center">
  <img src="../../assets/icons/brud_icon_rounded.png" width="96" alt="Brud Code Logo" />
</p>

# Brud Code — Website

The official marketing and documentation site for Brud Code.

<p align="center">
  <a href="https://github.com/rahatarch/brud"><img src="https://img.shields.io/github/stars/rahatarch/brud?style=social" alt="GitHub stars" /></a>
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License" /></a>
  <a href="https://brud.akkharlabs.com"><img src="https://img.shields.io/badge/live%20site-brud.akkharlabs.com-000" alt="Live site" /></a>
</p>

## Purpose

`apps/web` is the marketing and documentation frontend for Brud Code. It showcases live benchmarks, 3D interactive graphics, interactive onboarding guides, and documentation — all in a single-page, statically exported Next.js site designed to convert visitors into users and contributors.

## Tech Stack

| | |
|---|---|
| Framework | [Next.js 15](https://nextjs.org/) (App Router) + React 19 |
| Styling | [Tailwind CSS v4](https://tailwindcss.com/) |
| Smooth scroll | [Lenis](https://github.com/darkroomengineering/lenis) |

## Getting Started

Requires Node.js 20+.

```bash
# From the monorepo root
npm run dev:web

# Or from inside apps/web/
npm run dev
```

Production build:

```bash
# From the monorepo root
npm run build:web
```

## Build & Export

The project uses Next.js `output: "export"` to generate a fully static website. All artifacts are written to `out/` as plain HTML, CSS, and JavaScript files that can be deployed to any standard web server or edge CDN without a Node.js runtime.

## Deeper Documentation

- [Root README](../../README.md) — Monorepo overview
- [ARCHITECTURE.md](../../ARCHITECTURE.md) — System architecture
- [docs/](../../docs/) — Engineering documentation

## License

Code is released under the [MIT License](../../LICENSE).