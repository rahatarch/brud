import path from 'path';
import { FileSystem } from '../types/filesystem';

const IGNORED_DIRECTORIES = new Set([
  'node_modules', 'dist', 'target', 'build', 'out', 'coverage',
  '.next', '.nuxt', '.cache', 'vendor', 'bower_components',
  '__pycache__', '.venv', 'venv',
]);

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
      children.push(entry.name);
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