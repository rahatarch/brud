/**
 * Public-folder URL that also works when the site is served from a subpath
 * (GitHub Pages serves it at /Brud-code/). NEXT_PUBLIC_BASE_PATH is set only
 * for that build; everywhere else this returns the path unchanged.
 */
const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";

export const asset = (path) => `${BASE}${path}`;
