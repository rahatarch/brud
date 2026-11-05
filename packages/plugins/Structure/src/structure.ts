import { baseNameRelativePath, extensionOf, joinRelativePath } from './pathUtils.js';
import type { StructureFileSystem } from './fsPort.js';

export const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf',
  '.zip', '.tar', '.gz', '.7z', '.wasm', '.glb', '.gltf',
  '.bin', '.exe', '.dll', '.so', '.dylib', '.node',
  '.woff', '.woff2', '.ttf', '.eot',
  '.mp4', '.webm', '.mp3', '.wav', '.ogg',
]);

const IGNORED_DIRECTORIES = new Set([
  'node_modules', 'dist', 'target', 'build', 'out', 'coverage',
  '.next', '.nuxt', '.cache', 'vendor', 'bower_components',
  '__pycache__', '.venv', 'venv',
]);

export interface StructureNode {
  [key: string]: (string | StructureNode)[];
}

export interface StructureExtractionOptions {
  /** Label used for the workspace root when `targetPath` is empty. */
  readonly rootLabel?: string;
}

async function formatFileEntry(
  fs: StructureFileSystem,
  fullPath: string,
  fileName: string,
): Promise<string> {
  const ext = extensionOf(fileName);
  if (BINARY_EXTENSIONS.has(ext)) {
    return `${fileName} [binary]`;
  }

  try {
    const content = await fs.readText(fullPath);
    if (!content || content.length === 0) {
      return `${fileName} (0 lines)`;
    }

    const trimmed = content.endsWith('\n') ? content.slice(0, -1) : content;
    const lines = trimmed.length === 0 ? 0 : (trimmed.match(/\n/g) || []).length + 1;
    return lines === 1 ? `${fileName} (1 line)` : `${fileName} (${lines} lines)`;
  } catch {
    return fileName;
  }
}

async function buildStructure(
  fs: StructureFileSystem,
  dirPath: string,
  currentDepth: number,
  maxDepth: number,
  rootLabel: string,
): Promise<StructureNode> {
  const entries = await fs.readDirectory(dirPath);
  const children: (string | StructureNode)[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue;
    }

    if (entry.isDirectory && IGNORED_DIRECTORIES.has(entry.name)) {
      continue;
    }

    if (entry.isDirectory) {
      const childPath = joinRelativePath(dirPath, entry.name);

      if (maxDepth === 0) {
        const subNode = await buildStructure(fs, childPath, currentDepth + 1, maxDepth, rootLabel);
        children.push({ [entry.name]: subNode[entry.name] ?? [] });
      } else if (currentDepth === 0) {
        const subNode = await buildStructure(fs, childPath, currentDepth + 1, maxDepth, rootLabel);
        children.push({ [entry.name]: subNode[entry.name] ?? [] });
      } else if (currentDepth + 1 < maxDepth) {
        const subNode = await buildStructure(fs, childPath, currentDepth + 1, maxDepth, rootLabel);
        children.push({ [entry.name]: subNode[entry.name] ?? [] });
      } else if (currentDepth + 1 === maxDepth) {
        children.push({ [entry.name]: [] });
      }
    } else {
      const formatted = await formatFileEntry(fs, joinRelativePath(dirPath, entry.name), entry.name);
      children.push(formatted);
    }
  }

  const dirName = baseNameRelativePath(dirPath) || rootLabel;
  return { [dirName]: children };
}

/**
 * Produces the token-efficient JSON directory map.
 *
 * @param fs - Read-only workspace filesystem port.
 * @param targetPath - Workspace-relative directory (`''` is the root).
 * @param depth - Maximum depth; `0` means unlimited.
 * @param options - Root label override.
 */
export async function extractDirectoryStructure(
  fs: StructureFileSystem,
  targetPath: string,
  depth: number,
  options?: StructureExtractionOptions,
): Promise<string> {
  const structure = await buildStructure(fs, targetPath, 0, depth, options?.rootLabel ?? 'workspace');
  return JSON.stringify(structure, null, 2);
}