// Minimal SemVer 2.0 helpers for the release scripts. No dependencies.
const RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

/** Parses `x.y.z[-pre]`. Build metadata (`+...`) is rejected on purpose. */
export function parse(version) {
  const m = RE.exec(String(version));
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ? m[4].split('.') : [] };
}

export const isValid = (version) => parse(version) !== null;

function comparePre(a, b) {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1; // a release outranks its prereleases
  if (b.length === 0) return -1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === undefined) return -1;
    if (b[i] === undefined) return 1;
    const an = /^\d+$/.test(a[i]);
    const bn = /^\d+$/.test(b[i]);
    if (an && bn) {
      if (+a[i] !== +b[i]) return +a[i] < +b[i] ? -1 : 1;
    } else if (an !== bn) {
      return an ? -1 : 1;
    } else if (a[i] !== b[i]) {
      return a[i] < b[i] ? -1 : 1;
    }
  }
  return 0;
}

/** Returns -1, 0 or 1. Throws on an invalid version. */
export function compare(a, b) {
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) throw new Error(`invalid version: ${!pa ? a : b}`);
  for (const k of ['major', 'minor', 'patch']) {
    if (pa[k] !== pb[k]) return pa[k] < pb[k] ? -1 : 1;
  }
  return comparePre(pa.pre, pb.pre);
}

export const isPrerelease = (version) => parse(version).pre.length > 0;

/** A prerelease never takes the `latest` dist-tag. */
export const distTag = (version) => (isPrerelease(version) ? 'next' : 'latest');

export function majorMinor(version) {
  const p = parse(version);
  return `${p.major}.${p.minor}`;
}
