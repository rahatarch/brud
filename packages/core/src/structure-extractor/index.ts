import path from 'path';
import { FileSystem } from '../types/filesystem';

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

async function formatFileEntry(fs: FileSystem, fullPath: string, fileName: string): Promise<string> {
  const ext = fileName.includes('.') ? ('.' + fileName.split('.').pop()!).toLowerCase() : '';
  if (BINARY_EXTENSIONS.has(ext)) {
    return `${fileName} [binary]`;
  }
  try {
    const content = await fs.readFile(fullPath);
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

interface StructureNode {
  [key: string]: (string | StructureNode)[];
}

async function buildStructure(
  fs: FileSystem,
  dirPath: string,
  currentDepth: number,
  maxDepth: number,
): Promise<StructureNode> {
  const entries = await fs.listDirectoryContents(dirPath);
  const children: (string | StructureNode)[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue;
    }
    if (entry.isDirectory && IGNORED_DIRECTORIES.has(entry.name)) {
      continue;
    }

    if (entry.isDirectory) {
      if (maxDepth === 0) {
        const subNode = await buildStructure(fs, path.join(dirPath, entry.name), currentDepth + 1, maxDepth);
        children.push({ [entry.name]: subNode[entry.name] });
      } else if (currentDepth === 0) {
        const subNode = await buildStructure(fs, path.join(dirPath, entry.name), currentDepth + 1, maxDepth);
        children.push({ [entry.name]: subNode[entry.name] });
      } else if (currentDepth + 1 < maxDepth) {
        const subNode = await buildStructure(fs, path.join(dirPath, entry.name), currentDepth + 1, maxDepth);
        children.push({ [entry.name]: subNode[entry.name] });
      } else if (currentDepth + 1 === maxDepth) {
        children.push({ [entry.name]: [] });
      }
    } else {
      const formatted = await formatFileEntry(fs, path.join(dirPath, entry.name), entry.name);
      children.push(formatted);
    }
  }

  const dirName = path.basename(dirPath) || dirPath;
  return { [dirName]: children };
}

export async function extractDirectoryStructure(
  fs: FileSystem,
  targetPath: string,
  depth: number,
): Promise<string> {
  const structure = await buildStructure(fs, targetPath, 0, depth);
  return JSON.stringify(structure, null, 2);
}