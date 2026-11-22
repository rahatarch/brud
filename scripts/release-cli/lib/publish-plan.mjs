/**
 * Decides what to do with one package version. `published` is the registry's
 * integrity string, or null when the version does not exist yet.
 *  - publish:  not on the registry, publish the tested tarball.
 *  - skip:     already there with identical bytes (safe to re-run).
 *  - conflict: already there with different bytes. A hard stop; never overwrite.
 */
export function decide(localIntegrity, published) {
  if (published === null || published === undefined) return 'publish';
  return published === localIntegrity ? 'skip' : 'conflict';
}
