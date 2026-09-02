import { PatchBlock, MatchResult } from '../types/patch';

/**
 * Brud Core Engine
 * Contains pure logic for surgical matching and content reconstruction.
 * Zero dependencies on VS Code APIs to ensure portability and testability.
 */

/**
 * Identifies the line-based coordinates for a set of surgical blocks.
 * V5.1 Engine: Implements 'Gravity-Shift Mapping' with exhaustive candidate
 * collection and range-shrinking deduplication to resolve whitespace ambiguity.
 */
export function findMatches(
  docLines: string[],
  blocks: PatchBlock[],
  onError: (message: string, block?: PatchBlock) => void,
): MatchResult[] | null {
  const matches: MatchResult[] = [];
  const getMeat = (s: string) => s.replace(/\s+/g, '');

  for (const block of blocks) {
    const targetMeat = block.searchMeat;
    const candidates: { start: number; end: number }[] = [];

    // Step A: Exhaustive Candidate Collection
    for (let i = 0; i < docLines.length; i++) {
      let currentBuffer = '';
      for (let j = i; j < docLines.length; j++) {
        currentBuffer += getMeat(docLines[j]);

        if (currentBuffer === targetMeat) {
          candidates.push({ start: i, end: j });
          break;
        }

        if (currentBuffer.length > targetMeat.length) {
          break;
        }
      }
    }

    if (candidates.length === 0) {
      onError(`Block [${block.index}] not found in the source content.`, block);
      return null;
    }

    // Step B & C: Range Shrinking (Gravity Filter) and Deduplication
    const uniqueMatches = new Map<string, { start: number; end: number }>();

    for (const candidate of candidates) {
      let s = candidate.start;
      let e = candidate.end;

      // Shrink range from top and bottom to discard surrounding whitespace-only lines
      while (s < e && docLines[s].trim().length === 0) s++;
      while (e > s && docLines[e].trim().length === 0) e--;

      uniqueMatches.set(`${s}-${e}`, { start: s, end: e });
    }

    if (uniqueMatches.size > 1) {
      onError(
        `Block [${block.index}] is ambiguous (multiple matches found).`,
        block,
      );
      return null;
    }

    const finalCoords = Array.from(uniqueMatches.values())[0];

    matches.push({
      startLine: finalCoords.start,
      endLine: finalCoords.end,
      replace: block.replace,
      index: block.index,
    });
  }

  return matches;
}

/**
 * Reconstructs a document buffer by applying matches in reverse-topological order.
 */
export function reconstructContent(
  docLines: string[],
  matches: MatchResult[],
): string {
  const resultLines = [...docLines];

  // Sort descending by startLine to prevent index shifting during reconstruction
  const sortedMatches = [...matches].sort((a, b) => b.startLine - a.startLine);

  for (const match of sortedMatches) {
    const docBaseIndent = docLines[match.startLine].match(/^\s*/)?.[0] || '';
    const aiReplaceLines = match.replace.split('\n');
    const aiBaseIndent = aiReplaceLines[0].match(/^\s*/)?.[0] || '';

    const replaceLines = aiReplaceLines.map(line => {
      if (line.trim().length === 0) {
        return '';
      }
      // Strip AI's base indentation and apply the document's original indentation to maintain relative nesting
      const content = line.startsWith(aiBaseIndent)
        ? line.substring(aiBaseIndent.length)
        : line.trimStart();
      return docBaseIndent + content;
    });

    resultLines.splice(
      match.startLine,
      match.endLine - match.startLine + 1,
      ...replaceLines,
    );
  }

  return resultLines.join('\n');
}
