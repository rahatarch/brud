export const createFilePrompt = `Use CREATE_FILE to create a new file with the specified content.

Describe the file you want to create and its contents below:

<<<<<<< CREATE_FILE [1]
File Path: path/to/new/file.ext
=======
// file contents here
>>>>>>> END CREATE_FILE [1]

Output ONLY the Brud block above inside a markdown code block using triple backticks. No text outside the code block. No explanations.`;

export const searchReplacePrompt = `Use SEARCH/REPLACE to find and replace existing content in a file.

Describe the exact text to search for and the replacement text below:

<<<<<<< SEARCH [1]
File Path: path/to/file.ext
exact text to find
=======
new text to insert
>>>>>>> REPLACE [1]

Output ONLY the Brud block above inside a markdown code block using triple backticks. No text outside the code block. No explanations.`;

export const deleteFilePrompt = `Use DELETE_FILE to remove a file from the filesystem.

Describe the file you want to delete below:

<<<<<<< DELETE_FILE [1]
File Path: path/to/file.ext
>>>>>>> END DELETE_FILE [1]

Output ONLY the Brud block above inside a markdown code block using triple backticks. No text outside the code block. No explanations.`;

export const renameFilePrompt = `Use RENAME_FILE to rename a file from one name to another.

Describe the old name and the new name below:

<<<<<<< RENAME_FILE [1]
From: path/to/old-name.ext
To: path/to/new-name.ext
>>>>>>> END RENAME_FILE [1]

Output ONLY the Brud block above inside a markdown code block using triple backticks. No text outside the code block. No explanations.`;

export const moveFilePrompt = `Use MOVE_FILE to move a file from one location to another.

Describe the source path and the destination path below:

<<<<<<< MOVE_FILE [1]
From: path/to/source.ext
To: path/to/destination.ext
>>>>>>> END MOVE_FILE [1]

Output ONLY the Brud block above inside a markdown code block using triple backticks. No text outside the code block. No explanations.`;

export const copyFilePrompt = `Use COPY_FILE to copy a file from one location to another.

Describe the source path and the destination path below:

<<<<<<< COPY_FILE [1]
From: path/to/source.ext
To: path/to/destination.ext
>>>>>>> END COPY_FILE [1]

Output ONLY the Brud block above inside a markdown code block using triple backticks. No text outside the code block. No explanations.`;

export const appendFilePrompt = `Use APPEND_FILE to append content to the end of an existing file.

Describe the file and the content to append below:

<<<<<<< APPEND_FILE [1]
File Path: path/to/file.ext
Position: end
=======
content to append
>>>>>>> END APPEND_FILE [1]

Output ONLY the Brud block above inside a markdown code block using triple backticks. No text outside the code block. No explanations.`;

export const createDirectoryPrompt = `Use CREATE_DIRECTORY to create a new directory with optional empty files.

Describe the directory and files to create below:

<<<<<<< CREATE_DIRECTORY [1]
Directory Path: packages/core/src
Files:
  - types.ts
  - index.ts
>>>>>>> END CREATE_DIRECTORY [1]

Output ONLY the Brud block above inside a markdown code block using triple backticks. No text outside the code block. No explanations.`;

export const deleteDirectoryPrompt = `Use DELETE_DIRECTORY to remove a directory and all its contents.

Describe the directory to delete below:

<<<<<<< DELETE_DIRECTORY [1]
Directory Path: src/old
>>>>>>> END DELETE_DIRECTORY [1]

Output ONLY the Brud block above inside a markdown code block using triple backticks. No text outside the code block. No explanations.`;

export const moveDirectoryPrompt = `Use MOVE_DIRECTORY to move a directory from one location to another.

Describe the source path and the destination path below:

<<<<<<< MOVE_DIRECTORY [1]
From: src/components
To: packages/ui/components
>>>>>>> END MOVE_DIRECTORY [1]

Output ONLY the Brud block above inside a markdown code block using triple backticks. No text outside the code block. No explanations.`;

export const extractStructurePrompt = `Use EXTRACT_STRUCTURE to extract a token-efficient JSON map of directory contents with depth control.

Describe the directory you want to extract below:

<<<<<<< EXTRACT_STRUCTURE [1]
Directory Path: [path]
Depth: [number or 0 for unlimited]
>>>>>>> END EXTRACT_STRUCTURE [1]

- Depth 0 means unlimited traversal of the entire directory tree
- Depth N means N levels deep (e.g., Depth: 2 extracts the directory and its immediate children)
- Hidden files and directories (starting with ".") and build directories (node_modules, dist, .next, target, etc.) are automatically excluded
- Multiple EXTRACT_STRUCTURE blocks can be used in a single prompt to extract several directories at once. Each block should have a unique index number.

Example of multiple directories:

<<<<<<< EXTRACT_STRUCTURE [1]
Directory Path: src/modules/trip
Depth: 2
>>>>>>> END EXTRACT_STRUCTURE [1]

<<<<<<< EXTRACT_STRUCTURE [2]
Directory Path: src/modules/driver
Depth: 2
>>>>>>> END EXTRACT_STRUCTURE [2]

Output ONLY the Brud blocks above inside a markdown code block using triple backticks. No text outside the code block. No explanations.`;

export const searchFilesPrompt = `Use SEARCH_FILES to find files by name, pattern, or extension.

Describe the files you want to search for below:

<<<<<<< SEARCH_FILES [1]
Pattern: **/*.ts
Exclude: *.test.ts
Scope: src
MaxResults: 500
>>>>>>> END SEARCH_FILES [1]

- Pattern: glob patterns or simple words (comma-separated for multiple)
- Exclude: patterns to skip (optional)
- Scope: directory to search (optional, default workspace root)
- MaxResults: maximum files to return (optional, default 500)
- Returns file paths, names, extensions, and sizes

Output ONLY the Brud block above inside a markdown code block using triple backticks. No text outside the code block. No explanations.`;

export const codebaseMetadataPrompt = `Use CODEBASE_METADATA to get a quick summary of the codebase scale.

This returns the total file count, folder count, and the most dense folder (the folder with the most files directly inside it). Use this to determine extraction strategy before deeper exploration.

<<<<<<< CODEBASE_METADATA [1]
>>>>>>> END CODEBASE_METADATA [1]

Output ONLY the Brud block above inside a markdown code block using triple backticks. No text outside the code block. No explanations.`;