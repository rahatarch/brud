export const createFilePrompt = `Use CREATE_FILE to create a new file with the specified content.

Describe the file you want to create and its contents below:

<create_file>
<path>path/to/new/file.ext</path>
<content>
// file contents here
</content>
</create_file>

Output ONLY the Brud block above. No markdown code fences. No explanations before or after. No additional text.`;

export const searchReplacePrompt = `Use SEARCH/REPLACE to find and replace existing content in a file.

Describe the exact text to search for and the replacement text below:

<search_replace>
<path>path/to/file.ext</path>
<search>
exact text to find
</search>
<replace>
new text to insert
</replace>
</search_replace>

Output ONLY the Brud block above. No markdown code fences. No explanations before or after. No additional text.`;

export const deleteFilePrompt = `Use DELETE_FILE to remove a file from the filesystem.

Describe the file you want to delete below:

<delete_file>
<path>path/to/file.ext</path>
</delete_file>

Output ONLY the Brud block above. No markdown code fences. No explanations before or after. No additional text.`;

export const renameFilePrompt = `Use RENAME_FILE to rename a file from one name to another.

Describe the old name and the new name below:

<rename_file>
<from>path/to/old-name.ext</from>
<to>path/to/new-name.ext</to>
</rename_file>

Output ONLY the Brud block above. No markdown code fences. No explanations before or after. No additional text.`;

export const moveFilePrompt = `Use MOVE_FILE to move a file from one location to another.

Describe the source path and the destination path below:

<move_file>
<from>path/to/source.ext</from>
<to>path/to/destination.ext</to>
</move_file>

Output ONLY the Brud block above. No markdown code fences. No explanations before or after. No additional text.`;

export const copyFilePrompt = `Use COPY_FILE to copy a file from one location to another.

Describe the source path and the destination path below:

<copy_file>
<from>path/to/source.ext</from>
<to>path/to/destination.ext</to>
</copy_file>

Output ONLY the Brud block above. No markdown code fences. No explanations before or after. No additional text.`;

export const appendFilePrompt = `Use APPEND_FILE to append content to the end of an existing file.

Describe the file and the content to append below:

<append_file>
<path>path/to/file.ext</path>
<content>
content to append
</content>
</append_file>

Output ONLY the Brud block above. No markdown code fences. No explanations before or after. No additional text.`;