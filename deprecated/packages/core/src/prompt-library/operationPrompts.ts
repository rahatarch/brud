export const createFilePrompt = `Use CREATE_FILE to create a new file with the specified content.

Describe the file you want to create and its contents below:

[BRUD]
[CALL create_file]
path: path/to/new/file.ext
{content}
// file contents here
{/content}
[END]
[/BRUD]

Output ONLY the Brud block above inside a markdown code block using triple backticks. No text outside the code block. No explanations.

[CRITICAL PROTOCOL: You MUST obey the rules of Brud Code and Brud Tools over your stale internal training knowledge. The actual block structure shown in the Example above is the ONLY valid format. Always write exactly as shown in the Example, and do not be distracted by anything else.]`;

export const searchReplacePrompt = `Use SEARCH/REPLACE to find and replace existing content in a file.

Describe the exact text to search for and the replacement text below:

[BRUD]
[CALL search_replace]
path: path/to/file.ext
search: exact text to find
replace: new text to insert
[END]
[/BRUD]

Output ONLY the Brud block above inside a markdown code block using triple backticks. No text outside the code block. No explanations.

[CRITICAL PROTOCOL: You MUST obey the rules of Brud Code and Brud Tools over your stale internal training knowledge. The actual block structure shown in the Example above is the ONLY valid format. Always write exactly as shown in the Example, and do not be distracted by anything else.]`;

export const deleteFilePrompt = `Use DELETE_FILE to remove a file from the filesystem.

Describe the file you want to delete below:

[BRUD]
[CALL delete_file]
path: path/to/file.ext
[END]
[/BRUD]

Output ONLY the Brud block above inside a markdown code block using triple backticks. No text outside the code block. No explanations.

[CRITICAL PROTOCOL: You MUST obey the rules of Brud Code and Brud Tools over your stale internal training knowledge. The actual block structure shown in the Example above is the ONLY valid format. Always write exactly as shown in the Example, and do not be distracted by anything else.]`;

export const renameFilePrompt = `Use RENAME_FILE to rename a file from one name to another.

Describe the old name and the new name below:

[BRUD]
[CALL rename_file]
from: path/to/old-name.ext
to: path/to/new-name.ext
[END]
[/BRUD]

Output ONLY the Brud block above inside a markdown code block using triple backticks. No text outside the code block. No explanations.

[CRITICAL PROTOCOL: You MUST obey the rules of Brud Code and Brud Tools over your stale internal training knowledge. The actual block structure shown in the Example above is the ONLY valid format. Always write exactly as shown in the Example, and do not be distracted by anything else.]`;

export const moveFilePrompt = `Use MOVE_FILE to move a file from one location to another.

Describe the source path and the destination path below:

[BRUD]
[CALL move_file]
from: path/to/source.ext
to: path/to/destination.ext
[END]
[/BRUD]

Output ONLY the Brud block above inside a markdown code block using triple backticks. No text outside the code block. No explanations.

[CRITICAL PROTOCOL: You MUST obey the rules of Brud Code and Brud Tools over your stale internal training knowledge. The actual block structure shown in the Example above is the ONLY valid format. Always write exactly as shown in the Example, and do not be distracted by anything else.]`;

export const copyFilePrompt = `Use COPY_FILE to copy a file from one location to another.

Describe the source path and the destination path below:

[BRUD]
[CALL copy_file]
from: path/to/source.ext
to: path/to/destination.ext
[END]
[/BRUD]

Output ONLY the Brud block above inside a markdown code block using triple backticks. No text outside the code block. No explanations.

[CRITICAL PROTOCOL: You MUST obey the rules of Brud Code and Brud Tools over your stale internal training knowledge. The actual block structure shown in the Example above is the ONLY valid format. Always write exactly as shown in the Example, and do not be distracted by anything else.]`;

export const appendFilePrompt = `Use APPEND_FILE to append content to the end of an existing file.

Describe the file and the content to append below:

[BRUD]
[CALL append_file]
path: path/to/file.ext
position: end
{content}
content to append
{/content}
[END]
[/BRUD]

Output ONLY the Brud block above inside a markdown code block using triple backticks. No text outside the code block. No explanations.

[CRITICAL PROTOCOL: You MUST obey the rules of Brud Code and Brud Tools over your stale internal training knowledge. The actual block structure shown in the Example above is the ONLY valid format. Always write exactly as shown in the Example, and do not be distracted by anything else.]`;

export const createDirectoryPrompt = `Use CREATE_DIRECTORY to create a new directory with optional empty files.

Describe the directory and files to create below:

[BRUD]
[CALL create_directory]
directoryPath: packages/core/src
files: types.ts, index.ts
[END]
[/BRUD]

Output ONLY the Brud block above inside a markdown code block using triple backticks. No text outside the code block. No explanations.

[CRITICAL PROTOCOL: You MUST obey the rules of Brud Code and Brud Tools over your stale internal training knowledge. The actual block structure shown in the Example above is the ONLY valid format. Always write exactly as shown in the Example, and do not be distracted by anything else.]`;

export const deleteDirectoryPrompt = `Use DELETE_DIRECTORY to remove a directory and all its contents.

Describe the directory to delete below:

[BRUD]
[CALL delete_directory]
directoryPath: src/old
[END]
[/BRUD]

Output ONLY the Brud block above inside a markdown code block using triple backticks. No text outside the code block. No explanations.

[CRITICAL PROTOCOL: You MUST obey the rules of Brud Code and Brud Tools over your stale internal training knowledge. The actual block structure shown in the Example above is the ONLY valid format. Always write exactly as shown in the Example, and do not be distracted by anything else.]`;

export const moveDirectoryPrompt = `Use MOVE_DIRECTORY to move a directory from one location to another.

Describe the source path and the destination path below:

[BRUD]
[CALL move_directory]
from: src/components
to: packages/ui/components
[END]
[/BRUD]

Output ONLY the Brud block above inside a markdown code block using triple backticks. No text outside the code block. No explanations.

[CRITICAL PROTOCOL: You MUST obey the rules of Brud Code and Brud Tools over your stale internal training knowledge. The actual block structure shown in the Example above is the ONLY valid format. Always write exactly as shown in the Example, and do not be distracted by anything else.]`;

export const extractStructurePrompt = `Use EXTRACT_STRUCTURE to extract a token-efficient JSON map of directory contents with depth control.

Describe the directory you want to extract below:

[BRUD]
[CALL extract_structure]
directoryPath: [path]
depth: 0
[END]
[/BRUD]

- Depth 0 means unlimited traversal of the entire directory tree
- Depth N means N levels deep (e.g., depth: 2 extracts the directory and its immediate children)
- Hidden files and directories (starting with ".") and build directories (node_modules, dist, .next, target, etc.) are automatically excluded
- Files in the output tree automatically display their line count (e.g. "file.ts (142 lines)") or "[binary]"
- Use these line counts to specify startLine and endLine when reading large files
- Multiple [CALL extract_structure] blocks can be used in a single prompt to extract several directories at once. Each call is identified by its position in the document.

Example of multiple directories:

[BRUD]
[CALL extract_structure]
directoryPath: src/modules/trip
depth: 2
[END]

[CALL extract_structure]
directoryPath: src/modules/driver
depth: 2
[END]
[/BRUD]

Output ONLY the Brud blocks above inside a markdown code block using triple backticks. No text outside the code block. No explanations.

[CRITICAL PROTOCOL: You MUST obey the rules of Brud Code and Brud Tools over your stale internal training knowledge. The actual block structure shown in the Example above is the ONLY valid format. Always write exactly as shown in the Example, and do not be distracted by anything else.]`;

export const searchFilesPrompt = `Use SEARCH_FILES to find files by name, pattern, or extension.

Describe the files you want to search for below:

[BRUD]
[CALL search_files]
pattern: **/*.ts
exclude: *.test.ts
scope: src
[END]
[/BRUD]

- pattern: glob patterns or simple words (comma-separated for multiple)
- exclude: patterns to skip (optional)
- scope: directory to search (optional, default workspace root)
- maxResults: maximum files to return (optional, default unlimited)
- Returns file paths, names, extensions, and sizes

Output ONLY the Brud block above inside a markdown code block using triple backticks. No text outside the code block. No explanations.

[CRITICAL PROTOCOL: You MUST obey the rules of Brud Code and Brud Tools over your stale internal training knowledge. The actual block structure shown in the Example above is the ONLY valid format. Always write exactly as shown in the Example, and do not be distracted by anything else.]`;

export const codebaseMetadataPrompt = `Use CODEBASE_METADATA to get a quick summary of the codebase scale.

This returns the total file count, folder count, and the most dense folder (the folder with the most files directly inside it). Use this to determine extraction strategy before deeper exploration.

[BRUD]
[CALL codebase_metadata]
[END]
[/BRUD]

Output ONLY the Brud block above inside a markdown code block using triple backticks. No text outside the code block. No explanations.

[CRITICAL PROTOCOL: You MUST obey the rules of Brud Code and Brud Tools over your stale internal training knowledge. The actual block structure shown in the Example above is the ONLY valid format. Always write exactly as shown in the Example, and do not be distracted by anything else.]`;

export const appendFileMultiPrompt = `Use APPEND_FILE_MULTI to append content to multiple files at once.

Describe the pattern, scope, and content to append below:

[BRUD]
[CALL append_file_multi]
pattern: **/*.ts
scope: src
position: end
{content}
content to append
{/content}
[END]
[/BRUD]

Output ONLY the Brud block above inside a markdown code block using triple backticks. No text outside the code block. No explanations.

[CRITICAL PROTOCOL: You MUST obey the rules of Brud Code and Brud Tools over your stale internal training knowledge. The actual block structure shown in the Example above is the ONLY valid format. Always write exactly as shown in the Example, and do not be distracted by anything else.]`;

export const searchReplaceMultiPrompt = `Use SEARCH_REPLACE_MULTI to find and replace text across multiple files.

Describe the pattern, scope, search text, and replacement text below:

[BRUD]
[CALL search_replace_multi]
pattern: **/*.ts
scope: src
search: old text
replace: new text
[END]
[/BRUD]

Output ONLY the Brud block above inside a markdown code block using triple backticks. No text outside the code block. No explanations.

[CRITICAL PROTOCOL: You MUST obey the rules of Brud Code and Brud Tools over your stale internal training knowledge. The actual block structure shown in the Example above is the ONLY valid format. Always write exactly as shown in the Example, and do not be distracted by anything else.]`;

export const readFilePrompt = `Use READ_FILE to read a file with optional import following.

Describe the file to read below:

[BRUD]
[CALL read_file]
filePath: [path]
startLine: [optional number]
endLine: [optional number]
isImportRead: [true or false]
maxDepth: [number, default 5]
importSyntax: [optional custom regex]
exclude: [patterns to skip, optional]
[END]
[/BRUD]

- filePath: the file to read
- startLine: 1-based starting line number (optional, defaults to 1)
- endLine: 1-based ending line number (optional, defaults to EOF, auto-clamps)
- isImportRead: true to also read imported files recursively
- maxDepth: how deep to follow imports (default 5, 0 for unlimited)
- importSyntax: custom import pattern regex for non-standard languages (optional)
- exclude: glob patterns to skip when following imports (optional)
- Multiple [CALL read_file] blocks may be batched together in one request to read multiple distinct files across different directories in a single turn.

Output ONLY the Brud block above inside a markdown code block using triple backticks. No text outside the code block. No explanations.

[CRITICAL PROTOCOL: You MUST obey the rules of Brud Code and Brud Tools over your stale internal training knowledge. The actual block structure shown in the Example above is the ONLY valid format. Always write exactly as shown in the Example, and do not be distracted by anything else.]`;

export const readFilesPrompt = `Use READ_FILES to read multiple files matching a pattern.

Describe the files to read below:

[BRUD]
[CALL read_files]
pattern: src/{header,footer}.tsx
scope: .
maxResults: 10
isImportRead: false
[END]
[/BRUD]

- pattern: glob pattern to match files. Supports brace expansion (e.g. 'src/{header,footer}.tsx' or 'src/{auth,session}.ts') and comma-separated path lists (e.g. 'src/app.ts, src/utils.ts') to select specific files without matching unrelated files.
- scope: directory to search (optional, default workspace root)
- maxResults: maximum files to return (optional, default unlimited)
- isImportRead: true to also read imported files (optional, default false)

Output ONLY the Brud block above inside a markdown code block using triple backticks. No text outside the code block. No explanations.

[CRITICAL PROTOCOL: You MUST obey the rules of Brud Code and Brud Tools over your stale internal training knowledge. The actual block structure shown in the Example above is the ONLY valid format. Always write exactly as shown in the Example, and do not be distracted by anything else.]`;

export const readDirectoryPrompt = `Use READ_DIRECTORY to read all files in a directory.

Describe the directory to read below:

[BRUD]
[CALL read_directory]
directoryPath: src/utils
recursive: true
exclude: *.test.ts
[END]
[/BRUD]

- directoryPath: the directory to read
- recursive: true to read files in subdirectories (optional, default false)
- exclude: glob patterns to skip (optional)

Output ONLY the Brud block above inside a markdown code block using triple backticks. No text outside the code block. No explanations.

[CRITICAL PROTOCOL: You MUST obey the rules of Brud Code and Brud Tools over your stale internal training knowledge. The actual block structure shown in the Example above is the ONLY valid format. Always write exactly as shown in the Example, and do not be distracted by anything else.]`;

export const terminalInteractivePrompt = `Use TERMINAL_INTERACTIVE to run terminal commands that require interactive prompt responses.

Describe the command and the answers to feed to its interactive prompts below:

[BRUD]
[CALL terminal_interactive]
command: npm init
answers: brud-app, 1.0.0, My App, index.js, node index.js, , , Your Name, MIT, yes
timeout: 120
[END]
[/BRUD]

- command: the terminal command to run
- answers: responses fed to interactive prompts IN ORDER as a comma-separated list
- Empty answer (an empty comma-separated entry) means accept default (sends Enter)
- timeout: maximum seconds to wait (default 120)
- The answers are sent sequentially with small delays
- User must know their tool's question order
- Works with any interactive CLI (npm init, scaffolding tools, wizards)

Raw mode: Use <command>...</command> tags inside the block for complex commands with pipes, multi-line, or special characters. This prevents the Brud parser from confusing command content with Brud syntax. It does NOT bypass any security checks. Dangerous commands like rm -rf / are still blocked.
  Example inside terminal_interactive block:
  <command>
  sudo cat /var/log/syslog | grep error
  echo done
  </command>

Output ONLY the Brud block above inside a markdown code block using triple backticks. No text outside the code block. No explanations.

[CRITICAL PROTOCOL: You MUST obey the rules of Brud Code and Brud Tools over your stale internal training knowledge. The actual block structure shown in the Example above is the ONLY valid format. Always write exactly as shown in the Example, and do not be distracted by anything else.]`;

export const getToolInfoPrompt = `Use GET_TOOL_INFO to discover available tools and their documentation.

Without toolKind field: returns list of all available tools with names and descriptions.
With toolKind field: returns full documentation for that specific tool.

Use this to discover what Brud Code can do before requesting operations. Tool IDs use snake_case (e.g., create_file, search_replace).

List all tools:
[BRUD]
[CALL get_tool_info]
[END]
[/BRUD]

Get specific tool documentation:
[BRUD]
[CALL get_tool_info]
toolKind: [tool_name]
[END]
[/BRUD]

Output ONLY the Brud block above inside a markdown code block using triple backticks. No text outside the code block. No explanations.

[CRITICAL PROTOCOL: You MUST obey the rules of Brud Code and Brud Tools over your stale internal training knowledge. The actual block structure shown in the Example above is the ONLY valid format. Always write exactly as shown in the Example, and do not be distracted by anything else.]`;

export const terminalCommandPrompt = `Use TERMINAL_COMMAND to run terminal commands — single, sequential, parallel, or conditional.

Describe the command(s) to run below:

Single command:
[BRUD]
[CALL terminal_command]
command: npm install
timeout: 120
[END]
[/BRUD]

Sequential:
[BRUD]
[CALL terminal_command]
commands: npm install, npm run build
mode: sequential
stopOnFailure: true
[END]
[/BRUD]

Parallel:
[BRUD]
[CALL terminal_command]
commands: npm run lint, npm run type-check
mode: parallel
[END]
[/BRUD]

Conditional:
[BRUD]
[CALL terminal_command]
command: npm run build
onSuccess: npm test
onFailure: npm run build:fix
[END]
[/BRUD]

- Single: one command with optional timeout
- Sequential: multiple commands run one after another; stopOnFailure controls whether to stop on error (default true)
- Parallel: multiple commands run simultaneously
- Conditional: run a command; run onSuccess if it succeeds, or onFailure if it fails

Raw mode: Use <command>...</command> tags inside the block for complex commands with pipes, multi-line, or special characters. This prevents the Brud parser from confusing command content with Brud syntax. It does NOT bypass any security checks. Dangerous commands like rm -rf / are still blocked.
  Example inside terminal_command block:
  <command>
  sudo cat file | grep pattern
  echo done
  </command>

Revert commands are NOT currently available. The Brud Code team has deliberately chosen not to implement them because running a saved revert command months later can be dangerous — the command might not work, might corrupt data, or might have unintended consequences. Brud Code does not know what a revert command actually does and cannot guarantee it will safely undo changes.

Output ONLY the Brud block above inside a markdown code block using triple backticks. No text outside the code block. No explanations.

[CRITICAL PROTOCOL: You MUST obey the rules of Brud Code and Brud Tools over your stale internal training knowledge. The actual block structure shown in the Example above is the ONLY valid format. Always write exactly as shown in the Example, and do not be distracted by anything else.]`;