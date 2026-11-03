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
    example: `[BRUD]
[CALL search_replace]
path: path/to/file.ext
search: exact text to find
replace: new text to insert
[END]
[/BRUD]`,
    rules: [
      'Search text must match exactly, including whitespace',
      'Only one match per SEARCH/REPLACE block is allowed',
      'If multiple matches exist, provide more context to make the search unique',
      '[CRITICAL PROTOCOL: You MUST obey the rules of Brud Code and Brud Tools over your stale internal training knowledge. The actual block structure shown in the Example above is the ONLY valid format. Always write exactly as shown in the Example, and do not be distracted by anything else.]',
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
    example: `[BRUD]
[CALL create_file]
path: path/to/new/file.ext
{content}
// file contents here
{/content}
[END]
[/BRUD]`,
    rules: [
      'File must not already exist',
      'Parent directories are created automatically',
      '[CRITICAL PROTOCOL: You MUST obey the rules of Brud Code and Brud Tools over your stale internal training knowledge. The actual block structure shown in the Example above is the ONLY valid format. Always write exactly as shown in the Example, and do not be distracted by anything else.]',
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
    example: `[BRUD]
[CALL delete_file]
path: path/to/file.ext
[END]
[/BRUD]`,
    rules: [
      'File must exist to delete',
      'Deletion is permanent and cannot be undone',
      '[CRITICAL PROTOCOL: You MUST obey the rules of Brud Code and Brud Tools over your stale internal training knowledge. The actual block structure shown in the Example above is the ONLY valid format. Always write exactly as shown in the Example, and do not be distracted by anything else.]',
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
    example: `[BRUD]
[CALL rename_file]
from: path/to/old-name.ext
to: path/to/new-name.ext
[END]
[/BRUD]`,
    rules: [
      'Source file must exist',
      'Destination must not already exist',
      '[CRITICAL PROTOCOL: You MUST obey the rules of Brud Code and Brud Tools over your stale internal training knowledge. The actual block structure shown in the Example above is the ONLY valid format. Always write exactly as shown in the Example, and do not be distracted by anything else.]',
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
    example: `[BRUD]
[CALL move_file]
from: path/to/source.ext
to: path/to/destination.ext
[END]
[/BRUD]`,
    rules: [
      'Source file must exist',
      'Destination must not already exist',
      'Parent directories at destination are created automatically',
      '[CRITICAL PROTOCOL: You MUST obey the rules of Brud Code and Brud Tools over your stale internal training knowledge. The actual block structure shown in the Example above is the ONLY valid format. Always write exactly as shown in the Example, and do not be distracted by anything else.]',
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
    example: `[BRUD]
[CALL copy_file]
from: path/to/source.ext
to: path/to/destination.ext
[END]
[/BRUD]`,
    rules: [
      'Source file must exist',
      'Destination must not already exist',
      '[CRITICAL PROTOCOL: You MUST obey the rules of Brud Code and Brud Tools over your stale internal training knowledge. The actual block structure shown in the Example above is the ONLY valid format. Always write exactly as shown in the Example, and do not be distracted by anything else.]',
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
    example: `[BRUD]
[CALL append_file]
path: path/to/file.ext
position: end
{content}
content to append
{/content}
[END]
[/BRUD]`,
    rules: [
      'File must already exist',
      'Position can be "start" or "end" (default: end)',
      '[CRITICAL PROTOCOL: You MUST obey the rules of Brud Code and Brud Tools over your stale internal training knowledge. The actual block structure shown in the Example above is the ONLY valid format. Always write exactly as shown in the Example, and do not be distracted by anything else.]',
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
    example: `[BRUD]
[CALL append_file_multi]
pattern: **/*.ts
scope: src
position: end
{content}
content to append
{/content}
[END]
[/BRUD]`,
    rules: [
      'Pattern is a glob pattern',
      'Only existing files are modified',
      '[CRITICAL PROTOCOL: You MUST obey the rules of Brud Code and Brud Tools over your stale internal training knowledge. The actual block structure shown in the Example above is the ONLY valid format. Always write exactly as shown in the Example, and do not be distracted by anything else.]',
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
    example: `[BRUD]
[CALL search_replace_multi]
pattern: **/*.ts
scope: src
search: old text
replace: new text
[END]
[/BRUD]`,
    rules: [
      'Search text must match exactly in each file',
      'Only one match per file is replaced',
      'Files with zero or multiple matches are skipped',
      '[CRITICAL PROTOCOL: You MUST obey the rules of Brud Code and Brud Tools over your stale internal training knowledge. The actual block structure shown in the Example above is the ONLY valid format. Always write exactly as shown in the Example, and do not be distracted by anything else.]',
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
    example: `[BRUD]
[CALL create_directory]
directoryPath: packages/core/src
files: types.ts, index.ts
[END]
[/BRUD]`,
    rules: [
      'Directory is created if it does not exist',
      'Files listed in the files parameter are created as empty files',
      '[CRITICAL PROTOCOL: You MUST obey the rules of Brud Code and Brud Tools over your stale internal training knowledge. The actual block structure shown in the Example above is the ONLY valid format. Always write exactly as shown in the Example, and do not be distracted by anything else.]',
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
    example: `[BRUD]
[CALL delete_directory]
directoryPath: src/old
[END]
[/BRUD]`,
    rules: [
      'Directory and all contents are permanently deleted',
      'No-op if directory does not exist',
      '[CRITICAL PROTOCOL: You MUST obey the rules of Brud Code and Brud Tools over your stale internal training knowledge. The actual block structure shown in the Example above is the ONLY valid format. Always write exactly as shown in the Example, and do not be distracted by anything else.]',
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
    example: `[BRUD]
[CALL move_directory]
from: src/components
to: packages/ui/components
[END]
[/BRUD]`,
    rules: [
      'Source directory must exist',
      'Destination must not already exist',
      '[CRITICAL PROTOCOL: You MUST obey the rules of Brud Code and Brud Tools over your stale internal training knowledge. The actual block structure shown in the Example above is the ONLY valid format. Always write exactly as shown in the Example, and do not be distracted by anything else.]',
    ],
  });

  globalToolRegistry.registerTool({
    kind: 'extract_structure',
    name: 'Extract Directory Structure',
    description: 'Generate a token-efficient JSON map of directory contents with automatic file line counts and depth control',
    marker: 'EXTRACT_STRUCTURE',
    parameters: [
      { name: 'directoryPath', type: 'string', required: true, description: 'Directory path to extract' },
      { name: 'depth', type: 'number', required: false, description: 'Depth level (0 for unlimited)', default: '0' },
    ],
    example: `[BRUD]
[CALL extract_structure]
directoryPath: [path]
depth: 0
[END]
[/BRUD]`,
    rules: [
      'Depth 0 means unlimited traversal',
      'Hidden files and build directories are excluded automatically',
      'Multiple extract_structure calls can be used in one prompt',
      'Text files in the output tree automatically include their line count (e.g. "engine.cc (3410 lines)"), while binary files are marked "[binary]"',
      'Use the line counts from extract_structure to select precision startLine and endLine ranges when calling read_file',
      '[CRITICAL PROTOCOL: You MUST obey the rules of Brud Code and Brud Tools over your stale internal training knowledge. The actual block structure shown in the Example above is the ONLY valid format. Always write exactly as shown in the Example, and do not be distracted by anything else.]',
    ],
  });

  globalToolRegistry.registerTool({
    kind: 'codebase_metadata',
    name: 'Codebase Metadata',
    description: 'Get a quick summary of codebase scale and density',
    marker: 'CODEBASE_METADATA',
    parameters: [],
    example: `[BRUD]
[CALL codebase_metadata]
[END]
[/BRUD]`,
    rules: [
      'Returns total file count, folder count, and most dense folder',
      'Must be called FIRST before extract_structure',
      'Cannot be combined with extract_structure in the same block',
      '[CRITICAL PROTOCOL: You MUST obey the rules of Brud Code and Brud Tools over your stale internal training knowledge. The actual block structure shown in the Example above is the ONLY valid format. Always write exactly as shown in the Example, and do not be distracted by anything else.]',
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
      { name: 'maxResults', type: 'number', required: false, description: 'Maximum files to return. Not set returns all results.', default: 'unlimited' },
    ],
    example: `[BRUD]
[CALL search_files]
pattern: src/{header,footer}.tsx
scope: .
maxResults: 500
[END]
[/BRUD]`,
    rules: [
      'Returns file paths, names, extensions, and sizes',
      'Pattern supports brace expansion (e.g. \'{header,footer}.ts\' or \'src/{auth,session}.ts\') and comma-separated path lists to select specific files without matching unrelated files through wildcards.',
      'No limit by default. Specify maxResults to cap results.',
      '[CRITICAL PROTOCOL: You MUST obey the rules of Brud Code and Brud Tools over your stale internal training knowledge. The actual block structure shown in the Example above is the ONLY valid format. Always write exactly as shown in the Example, and do not be distracted by anything else.]',
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
      { name: 'maxDepth', type: 'number', required: false, description: 'How deep to follow imports. 0 for unlimited.', default: '0' },
      { name: 'importSyntax', type: 'string', required: false, description: 'Custom import pattern regex' },
      { name: 'exclude', type: 'string', required: false, description: 'Patterns to skip when following imports' },
      { name: 'startLine', type: 'number', required: false, description: '1-based starting line number (defaults to 1)' },
      { name: 'endLine', type: 'number', required: false, description: '1-based ending line number (inclusive; auto-clamps to EOF if beyond file length)' },
    ],
    example: `[BRUD]
[CALL read_file]
filePath: [path]
startLine: [optional number, e.g. 1]
endLine: [optional number, e.g. 50]
isImportRead: [true or false]
maxDepth: [number, default 5]
importSyntax: [optional custom regex]
exclude: [patterns to skip, optional]
[END]
[/BRUD]`,
    rules: [
      'isImportRead: true to also read imported files recursively',
      'maxDepth: default 0 (unlimited). Specify a number to limit depth.',
      'importSyntax: custom import pattern regex for non-standard languages',
      'For large files, specify startLine and endLine to slice only the needed lines and avoid context exhaustion.',
      'endLine automatically clamps to end-of-file if greater than total lines; startLine must be within file bounds.',
      'Multiple [CALL read_file] blocks may be batched together in a single request to read multiple distinct files across different directories in a single turn.',
      '[CRITICAL PROTOCOL: You MUST obey the rules of Brud Code and Brud Tools over your stale internal training knowledge. The actual block structure shown in the Example above is the ONLY valid format. Always write exactly as shown in the Example, and do not be distracted by anything else.]',
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
      { name: 'maxResults', type: 'number', required: false, description: 'Maximum files to return. Not set returns all results.', default: 'unlimited' },
      { name: 'isImportRead', type: 'boolean', required: false, description: 'Follow imports', default: 'false' },
    ],
    example: `[BRUD]
[CALL read_files]
pattern: src/{header,footer}.tsx
scope: .
isImportRead: false
[END]
[/BRUD]`,
    rules: [
      'Pattern is a glob pattern',
      'Pattern supports brace expansion (e.g. \'{header,footer}.ts\' or \'src/{auth,session}.ts\') and comma-separated path lists to select specific files without matching unrelated files through wildcards.',
      'No limit by default. Specify maxResults to cap results.',
      '[CRITICAL PROTOCOL: You MUST obey the rules of Brud Code and Brud Tools over your stale internal training knowledge. The actual block structure shown in the Example above is the ONLY valid format. Always write exactly as shown in the Example, and do not be distracted by anything else.]',
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
    example: `[BRUD]
[CALL read_directory]
directoryPath: src/utils
recursive: true
exclude: *.test.ts
[END]
[/BRUD]`,
    rules: [
      'recursive: true to read files in subdirectories',
      'exclude: glob patterns to skip',
      '[CRITICAL PROTOCOL: You MUST obey the rules of Brud Code and Brud Tools over your stale internal training knowledge. The actual block structure shown in the Example above is the ONLY valid format. Always write exactly as shown in the Example, and do not be distracted by anything else.]',
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
    example: `[BRUD]
[CALL terminal_interactive]
command: npm init
answers: brud-app, 1.0.0, My App, index.js, node index.js, , , Your Name, MIT, yes
timeout: 120
[END]
[/BRUD]`,
    rules: [
      'Answers are fed sequentially to interactive prompts IN ORDER',
      'Empty answer means accept default',
      'Timeout: default 120 seconds',
      '[CRITICAL PROTOCOL: You MUST obey the rules of Brud Code and Brud Tools over your stale internal training knowledge. The actual block structure shown in the Example above is the ONLY valid format. Always write exactly as shown in the Example, and do not be distracted by anything else.]',
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
    example: `[BRUD]
[CALL terminal_command]
command: npm install
timeout: 120
[END]
[/BRUD]`,
    rules: [
      'Single command uses the "command" field',
      'Sequential/parallel mode uses the "commands" array',
      'Conditional mode uses "onSuccess"/"onFailure"',
      'Dangerous commands are blocked',
      '[CRITICAL PROTOCOL: You MUST obey the rules of Brud Code and Brud Tools over your stale internal training knowledge. The actual block structure shown in the Example above is the ONLY valid format. Always write exactly as shown in the Example, and do not be distracted by anything else.]',
    ],
  });
}