import { FileOperation } from '../types/patch';

type State = 'IDLE' | 'SEARCH' | 'REPLACE' | 'CREATE_CONTENT' | 'DELETE_PATH' | 'RENAME_FROM' | 'RENAME_TO' | 'MOVE_FROM' | 'MOVE_TO' | 'COPY_FROM' | 'COPY_TO' | 'APPEND_CONTENT' | 'CREATE_DIRECTORY' | 'DELETE_DIRECTORY' | 'MOVE_DIRECTORY_FROM' | 'MOVE_DIRECTORY_TO' | 'EXTRACT_STRUCTURE' | 'CODEBASE_METADATA' | 'SEARCH_FILES';

export function parseLegacyFormat(input: string): FileOperation[] {
  const operations: FileOperation[] = [];
  const lines = input.split(/\r?\n/);

  let currentState: State = 'IDLE';
  let currentIndex = '';
  let currentFilePath = '';
  let currentPosition: 'start' | 'end' = 'end';
  let searchBuffer: string[] = [];
  let replaceBuffer: string[] = [];
  let contentBuffer: string[] = [];
  let renameFrom = '';
  let renameTo = '';
  let directoryFiles: string[] = [];
  let currentDirectoryPath = '';
  let currentDepth = 0;
  let currentSearchPatterns: string[] = [];
  let currentSearchExclude: string[] = [];
  let currentSearchScope = '';
  let currentSearchMaxResults = 500;

  function flushSearchReplace() {
    if (currentIndex && searchBuffer.length > 0) {
      if (!currentFilePath) {
        throw new Error('Missing File Path for search/replace block');
      }
      operations.push({
        kind: 'search_replace',
        path: currentFilePath,
        index: currentIndex,
        search: searchBuffer.join('\n'),
        replace: replaceBuffer.join('\n'),
      });
    }
    currentFilePath = '';
  }

  function flushCreateFile() {
    if (currentIndex && currentFilePath) {
      operations.push({
        kind: 'create_file',
        path: currentFilePath,
        index: currentIndex,
        content: contentBuffer.join('\n'),
      });
    }
    currentFilePath = '';
  }

  function flushDeleteFile() {
    if (currentIndex && currentFilePath) {
      operations.push({
        kind: 'delete_file',
        path: currentFilePath,
        index: currentIndex,
      });
    }
    currentFilePath = '';
  }

  function flushRenameFile() {
    if (currentIndex && renameFrom && renameTo) {
      operations.push({
        kind: 'rename_file',
        from: renameFrom,
        to: renameTo,
        index: currentIndex,
      });
    }
    currentFilePath = '';
  }

  function flushMoveFile() {
    if (currentIndex && renameFrom && renameTo) {
      operations.push({
        kind: 'move_file',
        from: renameFrom,
        to: renameTo,
        index: currentIndex,
      });
    }
    currentFilePath = '';
  }

  function flushCopyFile() {
    if (currentIndex && renameFrom && renameTo) {
      operations.push({
        kind: 'copy_file',
        from: renameFrom,
        to: renameTo,
        index: currentIndex,
      });
    }
    currentFilePath = '';
  }

  function flushAppendFile() {
    if (currentIndex && currentFilePath) {
      operations.push({
        kind: 'append_file',
        path: currentFilePath,
        position: currentPosition,
        index: currentIndex,
        content: contentBuffer.join('\n'),
      });
    }
    currentFilePath = '';
    currentPosition = 'end';
  }

  function flushCreateDirectory() {
    if (currentIndex && currentDirectoryPath) {
      operations.push({
        kind: 'create_directory',
        directoryPath: currentDirectoryPath,
        files: directoryFiles,
        index: currentIndex,
      });
    }
    currentDirectoryPath = '';
    directoryFiles = [];
  }

  function flushDeleteDirectory() {
    if (currentIndex && currentDirectoryPath) {
      operations.push({
        kind: 'delete_directory',
        directoryPath: currentDirectoryPath,
        index: currentIndex,
      });
    }
    currentDirectoryPath = '';
  }

  function flushMoveDirectory() {
    if (currentIndex && renameFrom && renameTo) {
      operations.push({
        kind: 'move_directory',
        from: renameFrom,
        to: renameTo,
        index: currentIndex,
      });
    }
    renameFrom = '';
    renameTo = '';
  }

  function flushSearchFiles() {
    if (currentIndex && currentSearchPatterns.length > 0) {
      operations.push({
        kind: 'search_files',
        patterns: currentSearchPatterns,
        excludePatterns: currentSearchExclude.length > 0 ? currentSearchExclude : undefined,
        directory: currentSearchScope || undefined,
        recursive: true,
        maxResults: currentSearchMaxResults,
        index: currentIndex,
      });
    }
    currentSearchPatterns = [];
    currentSearchExclude = [];
    currentSearchScope = '';
    currentSearchMaxResults = 500;
  }

  function reset() {
    currentState = 'IDLE';
    currentIndex = '';
    currentFilePath = '';
    currentPosition = 'end';
    searchBuffer = [];
    replaceBuffer = [];
    contentBuffer = [];
    renameFrom = '';
    renameTo = '';
    directoryFiles = [];
    currentDirectoryPath = '';
    currentDepth = 0;
    currentSearchPatterns = [];
    currentSearchExclude = [];
    currentSearchScope = '';
    currentSearchMaxResults = 500;
  }

  for (const line of lines) {
    const searchMatch = line.match(/^<<<<<<< SEARCH \[([\w\d.-]+)\]/);
    const replaceMatch = line.match(/^>>>>>>> REPLACE \[([\w\d.-]+)\]/);
    const createFileMatch = line.match(/^<<<<<<< CREATE_FILE \[([\w\d.-]+)\]/);
    const endCreateFileMatch = line.match(/^>>>>>>> END CREATE_FILE \[([\w\d.-]+)\]/);
    const deleteFileMatch = line.match(/^<<<<<<< DELETE_FILE \[([\w\d.-]+)\]/);
    const endDeleteFileMatch = line.match(/^>>>>>>> END DELETE_FILE \[([\w\d.-]+)\]/);
    const renameFileMatch = line.match(/^<<<<<<< RENAME_FILE \[([\w\d.-]+)\]/);
    const endRenameFileMatch = line.match(/^>>>>>>> END RENAME_FILE \[([\w\d.-]+)\]/);
    const moveFileMatch = line.match(/^<<<<<<< MOVE_FILE \[([\w\d.-]+)\]/);
    const endMoveFileMatch = line.match(/^>>>>>>> END MOVE_FILE \[([\w\d.-]+)\]/);
    const copyFileMatch = line.match(/^<<<<<<< COPY_FILE \[([\w\d.-]+)\]/);
    const endCopyFileMatch = line.match(/^>>>>>>> END COPY_FILE \[([\w\d.-]+)\]/);
    const appendFileMatch = line.match(/^<<<<<<< APPEND_FILE \[([\w\d.-]+)\]/);
    const endAppendFileMatch = line.match(/^>>>>>>> END APPEND_FILE \[([\w\d.-]+)\]/);
    const createDirectoryMatch = line.match(/^<<<<<<< CREATE_DIRECTORY \[([\w\d.-]+)\]/);
    const endCreateDirectoryMatch = line.match(/^>>>>>>> END CREATE_DIRECTORY \[([\w\d.-]+)\]/);
    const deleteDirectoryMatch = line.match(/^<<<<<<< DELETE_DIRECTORY \[([\w\d.-]+)\]/);
    const endDeleteDirectoryMatch = line.match(/^>>>>>>> END DELETE_DIRECTORY \[([\w\d.-]+)\]/);
    const moveDirectoryMatch = line.match(/^<<<<<<< MOVE_DIRECTORY \[([\w\d.-]+)\]/);
    const endMoveDirectoryMatch = line.match(/^>>>>>>> END MOVE_DIRECTORY \[([\w\d.-]+)\]/);
    const extractStructureMatch = line.match(/^<<<<<<< EXTRACT_STRUCTURE \[([\w\d.-]+)\]/);
    const endExtractStructureMatch = line.match(/^>>>>>>> END EXTRACT_STRUCTURE \[([\w\d.-]+)\]/);
    const codebaseMetadataMatch = line.match(/^<<<<<<< CODEBASE_METADATA \[([\w\d.-]+)\]/);
    const endCodebaseMetadataMatch = line.match(/^>>>>>>> END CODEBASE_METADATA \[([\w\d.-]+)\]/);
    const searchFilesMatch = line.match(/^<<<<<<< SEARCH_FILES \[([\w\d.-]+)\]/);
    const endSearchFilesMatch = line.match(/^>>>>>>> END SEARCH_FILES \[([\w\d.-]+)\]/);
    const filePathMatch = line.match(/^File Path:\s*(.+)/);
    const positionMatch = line.match(/^Position:\s*(start|end)/);
    const fromMatch = line.match(/^From:\s*(.+)/);
    const toMatch = line.match(/^To:\s*(.+)/);
    const directoryPathMatch = line.match(/^Directory Path:\s*(.+)/);
    const depthMatch = line.match(/^Depth:\s*(.+)/);
    const filesListMatch = line.match(/^\s*-\s*(.+)/);
    const patternMatch = line.match(/^Pattern:\s*(.+)/);
    const excludeMatch = line.match(/^Exclude:\s*(.+)/);
    const scopeMatch = line.match(/^Scope:\s*(.+)/);
    const maxResultsMatch = line.match(/^MaxResults:\s*(.+)/);

    if (currentState === 'IDLE') {
      if (searchMatch) {
        currentState = 'SEARCH';
        currentIndex = searchMatch[1];
        searchBuffer = [];
        continue;
      }
      if (createFileMatch) {
        currentState = 'CREATE_CONTENT';
        currentIndex = createFileMatch[1];
        contentBuffer = [];
        continue;
      }
      if (deleteFileMatch) {
        currentState = 'DELETE_PATH';
        currentIndex = deleteFileMatch[1];
        continue;
      }
      if (renameFileMatch) {
        currentState = 'RENAME_FROM';
        currentIndex = renameFileMatch[1];
        renameFrom = '';
        renameTo = '';
        continue;
      }
      if (moveFileMatch) {
        currentState = 'MOVE_FROM';
        currentIndex = moveFileMatch[1];
        renameFrom = '';
        renameTo = '';
        continue;
      }
      if (copyFileMatch) {
        currentState = 'COPY_FROM';
        currentIndex = copyFileMatch[1];
        renameFrom = '';
        renameTo = '';
        continue;
      }
      if (appendFileMatch) {
        currentState = 'APPEND_CONTENT';
        currentIndex = appendFileMatch[1];
        contentBuffer = [];
        currentPosition = 'end';
        continue;
      }
      if (createDirectoryMatch) {
        currentState = 'CREATE_DIRECTORY';
        currentIndex = createDirectoryMatch[1];
        currentDirectoryPath = '';
        directoryFiles = [];
        continue;
      }
      if (deleteDirectoryMatch) {
        currentState = 'DELETE_DIRECTORY';
        currentIndex = deleteDirectoryMatch[1];
        currentDirectoryPath = '';
        continue;
      }
      if (moveDirectoryMatch) {
        currentState = 'MOVE_DIRECTORY_FROM';
        currentIndex = moveDirectoryMatch[1];
        renameFrom = '';
        renameTo = '';
        continue;
      }
      if (extractStructureMatch) {
        currentState = 'EXTRACT_STRUCTURE';
        currentIndex = extractStructureMatch[1];
        currentDirectoryPath = '';
        continue;
      }
      if (codebaseMetadataMatch) {
        currentState = 'CODEBASE_METADATA';
        currentIndex = codebaseMetadataMatch[1];
        continue;
      }
      if (searchFilesMatch) {
        currentState = 'SEARCH_FILES';
        currentIndex = searchFilesMatch[1];
        currentSearchPatterns = [];
        currentSearchExclude = [];
        currentSearchScope = '';
        currentSearchMaxResults = 500;
        continue;
      }
      if (filePathMatch) {
        currentFilePath = filePathMatch[1].trim();
        continue;
      }
      continue;
    }

    if (currentState === 'SEARCH') {
      if (line.trim() === '=======') {
        currentState = 'REPLACE';
        replaceBuffer = [];
        continue;
      }
      if (replaceMatch) {
        if (replaceMatch[1] === currentIndex) {
          flushSearchReplace();
        }
        reset();
        continue;
      }
      if (filePathMatch) {
        currentFilePath = filePathMatch[1].trim();
        continue;
      }
      searchBuffer.push(line);
      continue;
    }

    if (currentState === 'REPLACE') {
      if (replaceMatch) {
        if (replaceMatch[1] === currentIndex) {
          flushSearchReplace();
        }
        reset();
        continue;
      }
      if (line.trim() === '=======') {
        continue;
      }
      replaceBuffer.push(line);
      continue;
    }

    if (currentState === 'CREATE_CONTENT') {
      if (endCreateFileMatch) {
        if (endCreateFileMatch[1] === currentIndex) {
          flushCreateFile();
        }
        reset();
        continue;
      }
      if (line.trim() === '=======') {
        currentState = 'CREATE_CONTENT';
        continue;
      }
      if (filePathMatch) {
        currentFilePath = filePathMatch[1].trim();
        continue;
      }
      contentBuffer.push(line);
      continue;
    }

    if (currentState === 'DELETE_PATH') {
      if (endDeleteFileMatch) {
        if (endDeleteFileMatch[1] === currentIndex) {
          flushDeleteFile();
        }
        reset();
        continue;
      }
      if (filePathMatch) {
        currentFilePath = filePathMatch[1].trim();
        continue;
      }
      continue;
    }

    if (currentState === 'RENAME_FROM') {
      if (endRenameFileMatch) {
        if (endRenameFileMatch[1] === currentIndex) {
          flushRenameFile();
        }
        reset();
        continue;
      }
      if (fromMatch) {
        renameFrom = fromMatch[1].trim();
        currentState = 'RENAME_TO';
        continue;
      }
      continue;
    }

    if (currentState === 'RENAME_TO') {
      if (endRenameFileMatch) {
        if (endRenameFileMatch[1] === currentIndex) {
          flushRenameFile();
        }
        reset();
        continue;
      }
      if (toMatch) {
        renameTo = toMatch[1].trim();
        continue;
      }
      continue;
    }

    if (currentState === 'MOVE_FROM') {
      if (endMoveFileMatch) {
        if (endMoveFileMatch[1] === currentIndex) {
          flushMoveFile();
        }
        reset();
        continue;
      }
      if (fromMatch) {
        renameFrom = fromMatch[1].trim();
        currentState = 'MOVE_TO';
        continue;
      }
      continue;
    }

    if (currentState === 'MOVE_TO') {
      if (endMoveFileMatch) {
        if (endMoveFileMatch[1] === currentIndex) {
          flushMoveFile();
        }
        reset();
        continue;
      }
      if (toMatch) {
        renameTo = toMatch[1].trim();
        continue;
      }
      continue;
    }

    if (currentState === 'COPY_FROM') {
      if (endCopyFileMatch) {
        if (endCopyFileMatch[1] === currentIndex) {
          flushCopyFile();
        }
        reset();
        continue;
      }
      if (fromMatch) {
        renameFrom = fromMatch[1].trim();
        currentState = 'COPY_TO';
        continue;
      }
      continue;
    }

    if (currentState === 'COPY_TO') {
      if (endCopyFileMatch) {
        if (endCopyFileMatch[1] === currentIndex) {
          flushCopyFile();
        }
        reset();
        continue;
      }
      if (toMatch) {
        renameTo = toMatch[1].trim();
        continue;
      }
      continue;
    }

    if (currentState === 'APPEND_CONTENT') {
      if (endAppendFileMatch) {
        if (endAppendFileMatch[1] === currentIndex) {
          flushAppendFile();
        }
        reset();
        continue;
      }
      if (line.trim() === '=======') {
        continue;
      }
      if (filePathMatch) {
        currentFilePath = filePathMatch[1].trim();
        continue;
      }
      if (positionMatch) {
        currentPosition = positionMatch[1] as 'start' | 'end';
        continue;
      }
      contentBuffer.push(line);
      continue;
    }

    if (currentState === 'CREATE_DIRECTORY') {
      if (endCreateDirectoryMatch) {
        if (endCreateDirectoryMatch[1] === currentIndex) {
          flushCreateDirectory();
        }
        reset();
        continue;
      }
      if (directoryPathMatch) {
        currentDirectoryPath = directoryPathMatch[1].trim();
        continue;
      }
      if (line.trim() === 'Files:') {
        continue;
      }
      if (filesListMatch) {
        directoryFiles.push(filesListMatch[1].trim());
        continue;
      }
      continue;
    }

    if (currentState === 'DELETE_DIRECTORY') {
      if (endDeleteDirectoryMatch) {
        if (endDeleteDirectoryMatch[1] === currentIndex) {
          flushDeleteDirectory();
        }
        reset();
        continue;
      }
      if (directoryPathMatch) {
        currentDirectoryPath = directoryPathMatch[1].trim();
        continue;
      }
      continue;
    }

    if (currentState === 'MOVE_DIRECTORY_FROM') {
      if (endMoveDirectoryMatch) {
        if (endMoveDirectoryMatch[1] === currentIndex) {
          flushMoveDirectory();
        }
        reset();
        continue;
      }
      if (fromMatch) {
        renameFrom = fromMatch[1].trim();
        currentState = 'MOVE_DIRECTORY_TO';
        continue;
      }
      continue;
    }

    if (currentState === 'MOVE_DIRECTORY_TO') {
      if (endMoveDirectoryMatch) {
        if (endMoveDirectoryMatch[1] === currentIndex) {
          flushMoveDirectory();
        }
        reset();
        continue;
      }
      if (toMatch) {
        renameTo = toMatch[1].trim();
        continue;
      }
      continue;
    }

    if (currentState === 'EXTRACT_STRUCTURE') {
      if (endExtractStructureMatch) {
        if (endExtractStructureMatch[1] === currentIndex) {
          const depth = currentDirectoryPath ? 0 : 0;
          operations.push({
            kind: 'extract_structure',
            directoryPath: currentDirectoryPath || '.',
            depth: currentDepth !== undefined ? currentDepth : 0,
            index: currentIndex,
          });
        }
        reset();
        continue;
      }
      if (directoryPathMatch) {
        currentDirectoryPath = directoryPathMatch[1].trim();
        continue;
      }
      if (depthMatch) {
        currentDepth = parseInt(depthMatch[1].trim(), 10);
        continue;
      }
      continue;
    }

    if (currentState === 'CODEBASE_METADATA') {
      if (endCodebaseMetadataMatch) {
        if (endCodebaseMetadataMatch[1] === currentIndex) {
          operations.push({
            kind: 'codebase_metadata',
            index: currentIndex,
          });
        }
        reset();
        continue;
      }
      continue;
    }

    if (currentState === 'SEARCH_FILES') {
      if (endSearchFilesMatch) {
        if (endSearchFilesMatch[1] === currentIndex) {
          flushSearchFiles();
        }
        reset();
        continue;
      }
      if (patternMatch) {
        currentSearchPatterns = patternMatch[1].split(',').map(s => s.trim()).filter(s => s.length > 0);
        continue;
      }
      if (excludeMatch) {
        currentSearchExclude = excludeMatch[1].split(',').map(s => s.trim()).filter(s => s.length > 0);
        continue;
      }
      if (scopeMatch) {
        currentSearchScope = scopeMatch[1].trim();
        continue;
      }
      if (maxResultsMatch) {
        currentSearchMaxResults = parseInt(maxResultsMatch[1].trim(), 10) || 500;
        continue;
      }
      continue;
    }
  }

  return operations;
}