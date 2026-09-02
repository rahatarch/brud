import { FileOperation } from '../../types/patch';

type State = 'IDLE' | 'SEARCH' | 'REPLACE' | 'CREATE_CONTENT' | 'DELETE_PATH' | 'RENAME_FROM' | 'RENAME_TO' | 'MOVE_FROM' | 'MOVE_TO' | 'COPY_FROM' | 'COPY_TO';

export function parseLegacyFormat(input: string): FileOperation[] {
  const operations: FileOperation[] = [];
  const lines = input.split(/\r?\n/);

  let currentState: State = 'IDLE';
  let currentIndex = '';
  let currentFilePath = '';
  let searchBuffer: string[] = [];
  let replaceBuffer: string[] = [];
  let contentBuffer: string[] = [];
  let renameFrom = '';
  let renameTo = '';

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

  function reset() {
    currentState = 'IDLE';
    currentIndex = '';
    currentFilePath = '';
    searchBuffer = [];
    replaceBuffer = [];
    contentBuffer = [];
    renameFrom = '';
    renameTo = '';
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
    const filePathMatch = line.match(/^File Path:\s*(.+)/);
    const fromMatch = line.match(/^From:\s*(.+)/);
    const toMatch = line.match(/^To:\s*(.+)/);

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
  }

  return operations;
}