import { globalToolRegistry } from './registry';

export function initializeToolRegistry(): void {
  globalToolRegistry.registerTool({
    kind: 'search_replace',
    name: 'Search and Replace',
    description: 'Search for existing content and replace it with new content',
    marker: 'SEARCH/REPLACE',
    parameters: [
      { name: 'path', type: 'string', required: true, description: 'File path' },
      { name: 'search', type: 'string', required: true, description: 'Exact text to find' },
      { name: 'replace', type: 'string', required: true, description: 'New text to insert' },
    ],
    example: `<<<<<<< SEARCH [1]
File Path: path/to/file.ext
exact text to find
=======
new text to insert
>>>>>>> REPLACE [1]`,
    rules: [
      'Search text must match exactly, including whitespace',
      'Only one match per SEARCH/REPLACE block is allowed',
      'If multiple matches exist, provide more context to make the search unique',
    ],
  });

  globalToolRegistry.registerTool({
    kind: 'create_file',
    name: 'Create File',
    description: 'Create a new file with specified content',
    marker: 'CREATE_FILE',
    parameters: [
      { name: 'path', type: 'string', required: true, description: 'File path' },
      { name: 'content', type: 'string', required: true, description: 'File contents' },
    ],
    example: `<<<<<<< CREATE_FILE [1]
File Path: path/to/new/file.ext
=======
// file contents here
>>>>>>> END CREATE_FILE [1]`,
    rules: [
      'File must not already exist',
      'Parent directories are created automatically',
    ],
  });

  globalToolRegistry.registerTool({
    kind: 'delete_file',
    name: 'Delete File',
    description: 'Remove a file from the filesystem',
    marker: 'DELETE_FILE',
    parameters: [
      { name: 'path', type: 'string', required: true, description: 'File path to delete' },
    ],
    example: `<<<<<<< DELETE_FILE [1]
File Path: path/to/file.ext
>>>>>>> END DELETE_FILE [1]`,
    rules: [
      'File must exist to delete',
      'Deletion is permanent and cannot be undone',
    ],
  });

  globalToolRegistry.registerTool({
    kind: 'rename_file',
    name: 'Rename File',
    description: 'Rename a file from one name to another',
    marker: 'RENAME_FILE',
    parameters: [
      { name: 'from', type: 'string', required: true, description: 'Current file path' },
      { name: 'to', type: 'string', required: true, description: 'New file path' },
    ],
    example: `<<<<<<< RENAME_FILE [1]
From: path/to/old-name.ext
To: path/to/new-name.ext
>>>>>>> END RENAME_FILE [1]`,
    rules: [
      'Source file must exist',
      'Destination must not already exist',
    ],
  });

  globalToolRegistry.registerTool({
    kind: 'move_file',
    name: 'Move File',
    description: 'Move a file from one location to another',
    marker: 'MOVE_FILE',
    parameters: [
      { name: 'from', type: 'string', required: true, description: 'Source file path' },
      { name: 'to', type: 'string', required: true, description: 'Destination file path' },
    ],
    example: `<<<<<<< MOVE_FILE [1]
From: path/to/source.ext
To: path/to/destination.ext
>>>>>>> END MOVE_FILE [1]`,
    rules: [
      'Source file must exist',
      'Destination must not already exist',
      'Parent directories at destination are created automatically',
    ],
  });

  globalToolRegistry.registerTool({
    kind: 'copy_file',
    name: 'Copy File',
    description: 'Copy a file from one location to another',
    marker: 'COPY_FILE',
    parameters: [
      { name: 'from', type: 'string', required: true, description: 'Source file path' },
      { name: 'to', type: 'string', required: true, description: 'Destination file path' },
    ],
    example: `<<<<<<< COPY_FILE [1]
From: path/to/source.ext
To: path/to/destination.ext
>>>>>>> END COPY_FILE [1]`,
    rules: [
      'Source file must exist',
      'Destination must not already exist',
    ],
  });

  globalToolRegistry.registerTool({
    kind: 'append_file',
    name: 'Append to File',
    description: 'Append content to the end of an existing file',
    marker: 'APPEND_FILE',
    parameters: [
      { name: 'path', type: 'string', required: true, description: 'File path' },
      { name: 'position', type: 'string', required: false, description: 'Where to append: start or end', default: 'end' },
      { name: 'content', type: 'string', required: true, description: 'Content to append' },
    ],
    example: `<<<<<<< APPEND_FILE [1]
File Path: path/to/file.ext
Position: end
=======
content to append
>>>>>>> END APPEND_FILE [1]`,
    rules: [
      'File must already exist',
      'Position can be "start" or "end" (default: end)',
    ],
  });

  globalToolRegistry.registerTool({
    kind: 'append_file_multi',
    name: 'Append to Multiple Files',
    description: 'Append content to multiple files matching a pattern',
    marker: 'APPEND_FILE_MULTI',
    parameters: [
      { name: 'pattern', type: 'string', required: true, description: 'Glob pattern to match files' },
      { name: 'scope', type: 'string', required: false, description: 'Directory to search' },
      { name: 'position', type: 'string', required: false, description: 'Start or end', default: 'end' },
      { name: 'content', type: 'string', required: true, description: 'Content to append' },
    ],
    example: `<<<<<<< APPEND_FILE_MULTI [1]
Pattern: **/*.ts
Scope: src
Position: end
=======
content to append
>>>>>>> END APPEND_FILE_MULTI [1]`,
    rules: [
      'Pattern is a glob pattern',
      'Only existing files are modified',
    ],
  });

  globalToolRegistry.registerTool({
    kind: 'search_replace_multi',
    name: 'Replace in Multiple Files',
    description: 'Search and replace text across multiple files',
    marker: 'SEARCH_REPLACE_MULTI',
    parameters: [
      { name: 'pattern', type: 'string', required: true, description: 'Glob pattern to match files' },
      { name: 'scope', type: 'string', required: false, description: 'Directory to search' },
      { name: 'search', type: 'string', required: true, description: 'Text to find' },
      { name: 'replace', type: 'string', required: true, description: 'Replacement text' },
    ],
    example: `<<<<<<< SEARCH_REPLACE_MULTI [1]
Pattern: **/*.ts
Scope: src
Search: old text
Replace: new text
>>>>>>> END SEARCH_REPLACE_MULTI [1]`,
    rules: [
      'Search text must match exactly in each file',
      'Only one match per file is replaced',
      'Files with zero or multiple matches are skipped',
    ],
  });

  globalToolRegistry.registerTool({
    kind: 'create_directory',
    name: 'Create Directory',
    description: 'Create a new directory with optional empty files',
    marker: 'CREATE_DIRECTORY',
    parameters: [
      { name: 'directoryPath', type: 'string', required: true, description: 'Directory path to create' },
      { name: 'files', type: 'string[]', required: false, description: 'Optional empty files to create inside' },
    ],
    example: `<<<<<<< CREATE_DIRECTORY [1]
Directory Path: packages/core/src
Files:
  - types.ts
  - index.ts
>>>>>>> END CREATE_DIRECTORY [1]`,
    rules: [
      'Directory is created if it does not exist',
      'Files listed under Files: are created as empty files',
    ],
  });

  globalToolRegistry.registerTool({
    kind: 'delete_directory',
    name: 'Delete Directory',
    description: 'Remove a directory and all its contents',
    marker: 'DELETE_DIRECTORY',
    parameters: [
      { name: 'directoryPath', type: 'string', required: true, description: 'Directory path to delete' },
    ],
    example: `<<<<<<< DELETE_DIRECTORY [1]
Directory Path: src/old
>>>>>>> END DELETE_DIRECTORY [1]`,
    rules: [
      'Directory and all contents are permanently deleted',
      'No-op if directory does not exist',
    ],
  });

  globalToolRegistry.registerTool({
    kind: 'move_directory',
    name: 'Move Directory',
    description: 'Move a directory from one location to another',
    marker: 'MOVE_DIRECTORY',
    parameters: [
      { name: 'from', type: 'string', required: true, description: 'Source directory path' },
      { name: 'to', type: 'string', required: true, description: 'Destination directory path' },
    ],
    example: `<<<<<<< MOVE_DIRECTORY [1]
From: src/components
To: packages/ui/components
>>>>>>> END MOVE_DIRECTORY [1]`,
    rules: [
      'Source directory must exist',
      'Destination must not already exist',
    ],
  });

  globalToolRegistry.registerTool({
    kind: 'extract_structure',
    name: 'Extract Directory Structure',
    description: 'Generate a token-efficient JSON map of directory contents with depth control',
    marker: 'EXTRACT_STRUCTURE',
    parameters: [
      { name: 'directoryPath', type: 'string', required: true, description: 'Directory path to extract' },
      { name: 'depth', type: 'number', required: false, description: 'Depth level (0 for unlimited)', default: '0' },
    ],
    example: `<<<<<<< EXTRACT_STRUCTURE [1]
Directory Path: [path]
Depth: [number or 0 for unlimited]
>>>>>>> END EXTRACT_STRUCTURE [1]`,
    rules: [
      'Depth 0 means unlimited traversal',
      'Hidden files and build directories are excluded automatically',
      'Multiple EXTRACT_STRUCTURE blocks can be used in one prompt',
    ],
  });

  globalToolRegistry.registerTool({
    kind: 'codebase_metadata',
    name: 'Codebase Metadata',
    description: 'Get a quick summary of codebase scale and density',
    marker: 'CODEBASE_METADATA',
    parameters: [],
    example: `<<<<<<< CODEBASE_METADATA [1]
>>>>>>> END CODEBASE_METADATA [1]`,
    rules: [
      'Returns total file count, folder count, and most dense folder',
      'Must be called FIRST before EXTRACT_STRUCTURE',
      'Cannot be combined with EXTRACT_STRUCTURE in the same block',
    ],
  });

  globalToolRegistry.registerTool({
    kind: 'search_files',
    name: 'Search Files',
    description: 'Find files by name, pattern, or extension',
    marker: 'SEARCH_FILES',
    parameters: [
      { name: 'pattern', type: 'string', required: true, description: 'Glob pattern or simple words (comma-separated)' },
      { name: 'exclude', type: 'string', required: false, description: 'Patterns to skip' },
      { name: 'scope', type: 'string', required: false, description: 'Directory to search' },
      { name: 'maxResults', type: 'number', required: false, description: 'Maximum files to return', default: '500' },
    ],
    example: `<<<<<<< SEARCH_FILES [1]
Pattern: **/*.ts
Exclude: *.test.ts
Scope: src
MaxResults: 500
>>>>>>> END SEARCH_FILES [1]`,
    rules: [
      'Returns file paths, names, extensions, and sizes',
      'Default maxResults is 500',
    ],
  });

  globalToolRegistry.registerTool({
    kind: 'read_file',
    name: 'Read File',
    description: 'Read a file with optional import following',
    marker: 'READ_FILE',
    parameters: [
      { name: 'filePath', type: 'string', required: true, description: 'File path to read' },
      { name: 'isImportRead', type: 'boolean', required: false, description: 'Follow imports recursively', default: 'false' },
      { name: 'maxDepth', type: 'number', required: false, description: 'How deep to follow imports', default: '5' },
      { name: 'importSyntax', type: 'string', required: false, description: 'Custom import pattern regex' },
      { name: 'exclude', type: 'string', required: false, description: 'Patterns to skip when following imports' },
    ],
    example: `<<<<<<< READ_FILE [1]
File Path: [path]
isImportRead: [true or false]
MaxDepth: [number, default 5]
importSyntax: [optional custom regex]
Exclude: [patterns to skip, optional]
>>>>>>> END READ_FILE [1]`,
    rules: [
      'isImportRead: true to also read imported files recursively',
      'MaxDepth: default 5, 0 for unlimited',
      'importSyntax: custom import pattern regex for non-standard languages',
    ],
  });

  globalToolRegistry.registerTool({
    kind: 'read_files',
    name: 'Read Multiple Files',
    description: 'Read files matching a pattern',
    marker: 'READ_FILES',
    parameters: [
      { name: 'pattern', type: 'string', required: true, description: 'Glob pattern to match files' },
      { name: 'scope', type: 'string', required: false, description: 'Directory to search' },
      { name: 'maxResults', type: 'number', required: false, description: 'Maximum files to return', default: '10' },
      { name: 'isImportRead', type: 'boolean', required: false, description: 'Follow imports', default: 'false' },
    ],
    example: `<<<<<<< READ_FILES [1]
Pattern: **/*.ts
Scope: src
MaxResults: 10
isImportRead: false
>>>>>>> END READ_FILES [1]`,
    rules: [
      'Pattern is a glob pattern',
      'Default maxResults is 10',
    ],
  });

  globalToolRegistry.registerTool({
    kind: 'read_directory',
    name: 'Read Directory',
    description: 'Read all files in a directory',
    marker: 'READ_DIRECTORY',
    parameters: [
      { name: 'directoryPath', type: 'string', required: true, description: 'Directory to read' },
      { name: 'recursive', type: 'boolean', required: false, description: 'Read subdirectories', default: 'false' },
      { name: 'exclude', type: 'string', required: false, description: 'Glob patterns to skip' },
    ],
    example: `<<<<<<< READ_DIRECTORY [1]
Directory Path: src/utils
Recursive: true
Exclude: *.test.ts
>>>>>>> END READ_DIRECTORY [1]`,
    rules: [
      'Recursive: true to read files in subdirectories',
      'Exclude: glob patterns to skip',
    ],
  });

  globalToolRegistry.registerTool({
    kind: 'terminal_interactive',
    name: 'Terminal Interactive',
    description: 'Run terminal commands with interactive prompt support',
    marker: 'TERMINAL_INTERACTIVE',
    parameters: [
      { name: 'command', type: 'string', required: true, description: 'Terminal command to run' },
      { name: 'answers', type: 'string[]', required: true, description: 'Responses to interactive prompts in order' },
      { name: 'timeout', type: 'number', required: false, description: 'Maximum seconds to wait', default: '120' },
    ],
    example: `<<<<<<< TERMINAL_INTERACTIVE [1]
Command: npm init
Answers:
  - brud-app
  - 1.0.0
  - My App
  - index.js
  - node index.js
  - 
  - 
  - Your Name
  - MIT
  - yes
Timeout: 120
>>>>>>> END TERMINAL_INTERACTIVE [1]`,
    rules: [
      'Answers are fed sequentially to interactive prompts IN ORDER',
      'Empty answer means accept default',
      'Timeout: default 120 seconds',
    ],
  });

  globalToolRegistry.registerTool({
    kind: 'terminal_command',
    name: 'Terminal Command',
    description: 'Run terminal commands — single, sequential, parallel, or conditional',
    marker: 'TERMINAL_COMMAND',
    parameters: [
      { name: 'command', type: 'string', required: false, description: 'Single command to run' },
      { name: 'commands', type: 'string[]', required: false, description: 'Multiple commands' },
      { name: 'mode', type: 'string', required: false, description: 'Execution mode: sequential or parallel' },
      { name: 'stopOnFailure', type: 'boolean', required: false, description: 'Stop on error for sequential mode', default: 'true' },
      { name: 'onSuccess', type: 'string', required: false, description: 'Command to run on success' },
      { name: 'onFailure', type: 'string', required: false, description: 'Command to run on failure' },
      { name: 'timeout', type: 'number', required: false, description: 'Maximum seconds to wait', default: '120' },
    ],
    example: `<<<<<<< TERMINAL_COMMAND [1]
Command: npm install
Timeout: 120
>>>>>>> END TERMINAL_COMMAND [1]`,
    rules: [
      'Single command uses "Command" field',
      'Sequential/parallel mode uses "Commands" array',
      'Conditional mode uses OnSuccess/OnFailure',
      'Dangerous commands are blocked',
    ],
  });
}