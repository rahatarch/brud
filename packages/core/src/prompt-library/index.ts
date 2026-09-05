import type { BrudPrompt, PromptLibrary } from './types';
import { masterPrompt } from './masterPrompt';
import {
  createFilePrompt,
  searchReplacePrompt,
  deleteFilePrompt,
  renameFilePrompt,
  moveFilePrompt,
  copyFilePrompt,
  appendFilePrompt,
  appendFileMultiPrompt,
  searchReplaceMultiPrompt,
  createDirectoryPrompt,
  deleteDirectoryPrompt,
  moveDirectoryPrompt,
  extractStructurePrompt,
  searchFilesPrompt,
  codebaseMetadataPrompt,
  readFilePrompt,
  readFilesPrompt,
  readDirectoryPrompt,
} from './operationPrompts';

export const brudPromptLibrary: PromptLibrary = {
  name: 'Brud Prompt Library',
  version: '1.0.0',
  prompts: [
    {
      id: 'master-system',
      title: 'Master System Prompt',
      description: 'Full system prompt for Brud AI assistant covering all operations and output rules',
      content: masterPrompt,
    },
    {
      id: 'create-file',
      title: 'Create File',
      description: 'Create a new file with specified content',
      content: createFilePrompt,
    },
    {
      id: 'search-replace',
      title: 'Search and Replace',
      description: 'Search for existing content and replace it with new content',
      content: searchReplacePrompt,
    },
    {
      id: 'delete-file',
      title: 'Delete File',
      description: 'Remove a file from the filesystem',
      content: deleteFilePrompt,
    },
    {
      id: 'rename-file',
      title: 'Rename File',
      description: 'Rename a file from one name to another',
      content: renameFilePrompt,
    },
    {
      id: 'move-file',
      title: 'Move File',
      description: 'Move a file from one location to another',
      content: moveFilePrompt,
    },
    {
      id: 'copy-file',
      title: 'Copy File',
      description: 'Copy a file from one location to another',
      content: copyFilePrompt,
    },
    {
      id: 'append-file',
      title: 'Append File',
      description: 'Append content to the end of an existing file',
      content: appendFilePrompt,
    },
    {
      id: 'append-file-multi',
      title: 'Append to Multiple Files',
      description: 'Append content to multiple files matching a pattern',
      content: appendFileMultiPrompt,
    },
    {
      id: 'search-replace-multi',
      title: 'Replace in Multiple Files',
      description: 'Search and replace text across multiple files',
      content: searchReplaceMultiPrompt,
    },
    {
      id: 'create-directory',
      title: 'Create Directory',
      description: 'Create a new directory with optional empty files',
      content: createDirectoryPrompt,
    },
    {
      id: 'delete-directory',
      title: 'Delete Directory',
      description: 'Remove a directory and all its contents',
      content: deleteDirectoryPrompt,
    },
    {
      id: 'move-directory',
      title: 'Move Directory',
      description: 'Move a directory from one location to another',
      content: moveDirectoryPrompt,
    },
    {
      id: 'extract-structure',
      title: 'Extract Directory Structure',
      description: 'Generate a token-efficient JSON map of directory contents with depth control',
      content: extractStructurePrompt,
    },
    {
      id: 'search-files',
      title: 'Search Files',
      description: 'Find files by name, pattern, or extension',
      content: searchFilesPrompt,
    },
    {
      id: 'codebase-metadata',
      title: 'Codebase Metadata',
      description: 'Get a quick summary of codebase scale and density',
      content: codebaseMetadataPrompt,
    },
    {
      id: 'read-file',
      title: 'Read File',
      description: 'Read a file with optional import following',
      content: readFilePrompt,
    },
    {
      id: 'read-files',
      title: 'Read Multiple Files',
      description: 'Read files matching a pattern',
      content: readFilesPrompt,
    },
    {
      id: 'read-directory',
      title: 'Read Directory',
      description: 'Read all files in a directory',
      content: readDirectoryPrompt,
    },
  ],
};

export function getPromptById(id: string): BrudPrompt | undefined {
  return brudPromptLibrary.prompts.find((prompt) => prompt.id === id);
}

export function getAllPrompts(): BrudPrompt[] {
  return brudPromptLibrary.prompts;
}