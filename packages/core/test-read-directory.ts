import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { NodeFileSystem } from './src/testing/nodeFileSystem.js';
import { executeFileOperations } from './src/file-operations/index.js';
import type { FileOperation } from './src/types/patch.js';

async function main() {
  // 1. Create a temp directory with files and subdirectories
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'read-dir-test-'));
  console.log('Temp dir:', tmpDir);

  // Create structure:
  // tmpDir/
  //   file1.txt (content: "hello")
  //   file2.js (content: "world")
  //   subdir/
  //     nested.txt (content: "nested")
  //     deep/
  //       deep.txt (content: "deep")

  await fs.mkdir(path.join(tmpDir, 'subdir', 'deep'), { recursive: true });
  await fs.writeFile(path.join(tmpDir, 'file1.txt'), 'hello', 'utf8');
  await fs.writeFile(path.join(tmpDir, 'file2.js'), 'world', 'utf8');
  await fs.writeFile(path.join(tmpDir, 'subdir', 'nested.txt'), 'nested', 'utf8');
  await fs.writeFile(path.join(tmpDir, 'subdir', 'deep', 'deep.txt'), 'deep', 'utf8');

  // 2. Create NodeFileSystem
  const nodeFs = new NodeFileSystem();

  // 3. Create FileOperation array
  const operations: FileOperation[] = [
    {
      kind: 'read_directory',
      directoryPath: tmpDir,
      recursive: true,
      isImportRead: false,
      maxDepth: 0,
      index: '0',
    },
    {
      kind: 'read_file',
      path: path.join(tmpDir, 'file1.txt'),
      isImportRead: false,
      maxDepth: 0,
      index: '1',
    },
    {
      kind: 'read_files',
      patterns: ['*.txt'],
      directory: tmpDir,
      recursive: true,
      maxResults: 100,
      isImportRead: false,
      maxDepth: 0,
      index: '2',
    },
  ];

  // 4. Call executeFileOperations
  const result = await executeFileOperations(operations, nodeFs, [tmpDir]);

  // 5. Print the COMPLETE result
  console.log('\n====== COMPLETE RESULT ======');
  console.log(JSON.stringify(result, null, 2));

  // 6. Check: Does readResults contain ALL read operations including read_directory?
  console.log('\n====== CHECK: readResults in message ======');
  try {
    const parsed = JSON.parse(result.message);
    console.log('combined keys:', Object.keys(parsed));
    if (parsed.readResults) {
      console.log('readResults entries:', parsed.readResults.length);
      parsed.readResults.forEach((r: any, idx: number) => {
        console.log(`  readResults[${idx}]: operationIndex=${r.operationIndex}, totalFiles=${r.totalFiles}, files=${r.files?.map((f: any) => f.path)}`);
      });
    } else {
      console.log('NO readResults in combined object!');
    }
  } catch (e) {
    console.log('message is not JSON:', result.message);
  }

  // 7. Check: Is read_directory in operationResults with success status?
  console.log('\n====== CHECK: operationResults ======');
  result.operationResults.forEach((op, idx) => {
    console.log(`  operationResults[${idx}]: kind=${op.kind}, status=${op.status}, path=${op.path}`);
    if (op.kind === 'read_directory') {
      console.log(`  -> message (truncated): ${op.message.substring(0, 500)}`);
    }
  });

  const readDirOp = result.operationResults.find(o => o.kind === 'read_directory');
  console.log(`\nread_directory operation found: ${!!readDirOp}`);
  console.log(`read_directory status: ${readDirOp?.status}`);

  // 8. Compare
  console.log('\n====== COMPARISON ======');
  console.log('read_directory in operationResults:',
    result.operationResults.some(o => o.kind === 'read_directory'));
  console.log('read_file in operationResults:',
    result.operationResults.some(o => o.kind === 'read_file'));
  console.log('read_files in operationResults:',
    result.operationResults.some(o => o.kind === 'read_files'));

  // Cleanup
  await fs.rm(tmpDir, { recursive: true, force: true });
  console.log('\nTemp dir cleaned up:', tmpDir);
}

main().catch(console.error);