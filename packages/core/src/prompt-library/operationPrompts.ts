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