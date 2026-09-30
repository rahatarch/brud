/** @type {import('next').NextConfig} */

// GitHub Pages build (see .github/workflows/deploy.yml): a fully static export
// served from /Brud-code/. Pages has no image optimiser, so images ship as-is
// (they are pre-compressed in public/). Local dev and `npm run build` are
// unaffected.
const pages = process.env.GITHUB_PAGES === "true";
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const nextConfig = {
  reactStrictMode: true,
  ...(pages && {
    output: "export",
    basePath,
    trailingSlash: true,
    images: { unoptimized: true },
  }),
};

export default nextConfig;
