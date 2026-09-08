import * as yaml from 'js-yaml';
import { FileOperation } from '../types/patch';
import { CommandGroup } from '../terminal/types';
import { BrudAPI, BrudError, missingFieldError, invalidFieldError, missingIndexError, unknownOperationError } from '../api/index';

function parseCommandGroup(value: unknown): CommandGroup | undefined {
  if (typeof value === 'string') {
    return { type: 'sequential', commands: [value] };
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const commands = obj.commands as (string | CommandGroup)[] | undefined;
    if (commands && Array.isArray(commands) && commands.length > 0) {
      return {
        type: (obj.type as 'sequential' | 'parallel') || 'sequential',
        commands,
        stopOnFailure: obj.stopOnFailure as boolean | undefined,
      };
    }
  }
  return undefined;
}

export function parseYamlFormat(input: string, workspaceFolders: string[] = []): FileOperation[] {
  const operations: FileOperation[] = [];
  const docs = input.split(/(?:^|\n)---\s*\n/);

  for (const doc of docs) {
    const trimmed = doc.trim();
    if (!trimmed) {
      continue;
    }

    const parsed = yaml.load(trimmed) as Record<string, unknown> | undefined;

    if (!parsed || typeof parsed !== 'object') {
      continue;
    }

    const operation = parsed.operation as string | undefined;
    if (!operation) {
      throw new BrudError(missingFieldError('operation', 'YAML document'));
    }

    const index = parsed.index as string | undefined;
    if (index === undefined || index === null) {
      throw new BrudError(missingIndexError());
    }

    switch (operation) {
      case 'replace': {
        const path = parsed.path as string | undefined;
        const search = parsed.search as string | undefined;
        const replace = parsed.replace as string | undefined;
        if (!path) {
          throw new BrudError(missingFieldError('path', 'replace operation'));
        }
        if (search === undefined || search === null) {
          throw new BrudError(missingFieldError('search', 'replace operation'));
        }
        if (replace === undefined || replace === null) {
          throw new BrudError(missingFieldError('replace', 'replace operation'));
        }
        operations.push({
          kind: 'search_replace',
          path,
          index: String(index),
          search,
          replace,
        });
        break;
      }
      case 'create_file': {
        const path = parsed.path as string | undefined;
        const content = parsed.content as string | undefined;
        if (!path) {
          throw new BrudError(missingFieldError('path', 'create_file operation'));
        }
        if (content === undefined || content === null) {
          throw new BrudError(missingFieldError('content', 'create_file operation'));
        }
        operations.push({
          kind: 'create_file',
          path,
          index: String(index),
          content,
        });
        break;
      }
      case 'delete_file': {
        const path = parsed.path as string | undefined;
        if (!path) {
          throw new BrudError(missingFieldError('path', 'delete_file operation'));
        }
        operations.push({
          kind: 'delete_file',
          path,
          index: String(index),
        });
        break;
      }
      case 'rename_file': {
        const from = parsed.from as string | undefined;
        const to = parsed.to as string | undefined;
        if (!from) {
          throw new BrudError(missingFieldError('from', 'rename_file operation'));
        }
        if (!to) {
          throw new BrudError(missingFieldError('to', 'rename_file operation'));
        }
        operations.push({
          kind: 'rename_file',
          from,
          to,
          index: String(index),
        });
        break;
      }
      case 'move_file': {
        const from = parsed.from as string | undefined;
        const to = parsed.to as string | undefined;
        if (!from) {
          throw new BrudError(missingFieldError('from', 'move_file operation'));
        }
        if (!to) {
          throw new BrudError(missingFieldError('to', 'move_file operation'));
        }
        operations.push({
          kind: 'move_file',
          from,
          to,
          index: String(index),
        });
        break;
      }
      case 'copy_file': {
        const from = parsed.from as string | undefined;
        const to = parsed.to as string | undefined;
        if (!from) {
          throw new BrudError(missingFieldError('from', 'copy_file operation'));
        }
        if (!to) {
          throw new BrudError(missingFieldError('to', 'copy_file operation'));
        }
        operations.push({
          kind: 'copy_file',
          from,
          to,
          index: String(index),
        });
        break;
      }
      case 'append_file': {
        const path = parsed.path as string | undefined;
        const content = parsed.content as string | undefined;
        if (!path) {
          throw new BrudError(missingFieldError('path', 'append_file operation'));
        }
        if (content === undefined || content === null) {
          throw new BrudError(missingFieldError('content', 'append_file operation'));
        }
        const position = parsed.position as string | undefined;
        if (position !== undefined && position !== 'start' && position !== 'end') {
          throw new BrudError(invalidFieldError('position', 'Position field must be "start" or "end" in append_file operation'));
        }
        operations.push({
          kind: 'append_file',
          path,
          position: (position as 'start' | 'end') || 'end',
          index: String(index),
          content,
        });
        break;
      }
      case 'create_directory': {
        const directoryPath = parsed.directoryPath as string | undefined;
        const files = parsed.files as string[] | undefined;
        if (!directoryPath) {
          throw new BrudError(missingFieldError('directoryPath', 'create_directory operation'));
        }
        operations.push({
          kind: 'create_directory',
          directoryPath,
          files: files || [],
          index: String(index),
        });
        break;
      }
      case 'delete_directory': {
        const directoryPath = parsed.directoryPath as string | undefined;
        if (!directoryPath) {
          throw new BrudError(missingFieldError('directoryPath', 'delete_directory operation'));
        }
        operations.push({
          kind: 'delete_directory',
          directoryPath,
          index: String(index),
        });
        break;
      }
      case 'move_directory': {
        const from = parsed.from as string | undefined;
        const to = parsed.to as string | undefined;
        if (!from) {
          throw new BrudError(missingFieldError('from', 'move_directory operation'));
        }
        if (!to) {
          throw new BrudError(missingFieldError('to', 'move_directory operation'));
        }
        operations.push({
          kind: 'move_directory',
          from,
          to,
          index: String(index),
        });
        break;
      }
      case 'codebase_metadata': {
        operations.push({
          kind: 'codebase_metadata',
          index: String(index),
        });
        break;
      }
      case 'extract_structure': {
        const directoryPath = parsed.directoryPath as string | undefined;
        const depth = parsed.depth as number | undefined;
        if (!directoryPath) {
          throw new BrudError(missingFieldError('directoryPath', 'extract_structure operation'));
        }
        operations.push({
          kind: 'extract_structure',
          directoryPath,
          depth: depth ?? 0,
          index: String(index),
        });
        break;
      }
      case 'search_files': {
        const patterns = parsed.patterns as string[] | undefined;
        if (!patterns || !Array.isArray(patterns) || patterns.length === 0) {
          throw new BrudError(missingFieldError('patterns', 'search_files operation'));
        }
        const extensions = parsed.extensions as string[] | undefined;
        const excludePatterns = parsed.excludePatterns as string[] | undefined;
        const directory = parsed.directory as string | undefined;
        const maxResults = parsed.maxResults as number | undefined;
        operations.push({
          kind: 'search_files',
          patterns,
          extensions: extensions && Array.isArray(extensions) ? extensions : undefined,
          excludePatterns: excludePatterns && Array.isArray(excludePatterns) ? excludePatterns : undefined,
          directory: directory || undefined,
          recursive: true,
          maxResults: maxResults ?? 500,
          index: String(index),
        });
        break;
      }
      case 'append_file_multi': {
        const patterns = parsed.patterns as string[] | undefined;
        if (!patterns || !Array.isArray(patterns) || patterns.length === 0) {
          throw new BrudError(missingFieldError('patterns', 'append_file_multi operation'));
        }
        const excludePatterns = parsed.excludePatterns as string[] | undefined;
        const directory = parsed.directory as string | undefined;
        const position = parsed.position as string | undefined;
        if (position !== undefined && position !== 'start' && position !== 'end') {
          throw new BrudError(invalidFieldError('position', 'Position field must be "start" or "end" in append_file_multi operation'));
        }
        const content = parsed.content as string | undefined;
        if (content === undefined || content === null) {
          throw new BrudError(missingFieldError('content', 'append_file_multi operation'));
        }
        const maxResults = parsed.maxResults as number | undefined;
        operations.push({
          kind: 'append_file_multi',
          patterns,
          excludePatterns: excludePatterns && Array.isArray(excludePatterns) ? excludePatterns : undefined,
          directory: directory || undefined,
          recursive: true,
          maxResults: maxResults ?? 500,
          position: (position as 'start' | 'end') || 'end',
          content,
          index: String(index),
        });
        break;
      }
      case 'search_replace_multi': {
        const patterns = parsed.patterns as string[] | undefined;
        if (!patterns || !Array.isArray(patterns) || patterns.length === 0) {
          throw new BrudError(missingFieldError('patterns', 'search_replace_multi operation'));
        }
        const excludePatterns = parsed.excludePatterns as string[] | undefined;
        const directory = parsed.directory as string | undefined;
        const search = parsed.search as string | undefined;
        if (search === undefined || search === null) {
          throw new BrudError(missingFieldError('search', 'search_replace_multi operation'));
        }
        const replace = parsed.replace as string | undefined;
        if (replace === undefined || replace === null) {
          throw new BrudError(missingFieldError('replace', 'search_replace_multi operation'));
        }
        const maxResults = parsed.maxResults as number | undefined;
        operations.push({
          kind: 'search_replace_multi',
          patterns,
          excludePatterns: excludePatterns && Array.isArray(excludePatterns) ? excludePatterns : undefined,
          directory: directory || undefined,
          recursive: true,
          maxResults: maxResults ?? 500,
          search,
          replace,
          index: String(index),
        });
        break;
      }
      case 'read_file': {
        const path = parsed.path as string | undefined;
        if (!path) {
          throw new BrudError(missingFieldError('path', 'read_file operation'));
        }
        const isImportRead = parsed.isImportRead as boolean | undefined;
        const maxDepth = parsed.maxDepth as number | undefined;
        const excludePatterns = parsed.excludePatterns as string[] | undefined;
        const importSyntax = parsed.importSyntax as string[] | undefined;
        operations.push({
          kind: 'read_file',
          path,
          isImportRead: isImportRead ?? false,
          maxDepth: maxDepth ?? 5,
          excludePatterns: excludePatterns && Array.isArray(excludePatterns) ? excludePatterns : undefined,
          importSyntax: importSyntax && Array.isArray(importSyntax) ? importSyntax : undefined,
          index: String(index),
        });
        break;
      }
      case 'read_files': {
        const patterns = parsed.patterns as string[] | undefined;
        if (!patterns || !Array.isArray(patterns) || patterns.length === 0) {
          throw new BrudError(missingFieldError('patterns', 'read_files operation'));
        }
        const excludePatterns = parsed.excludePatterns as string[] | undefined;
        const directory = parsed.directory as string | undefined;
        const recursive = parsed.recursive as boolean | undefined;
        const maxResults = parsed.maxResults as number | undefined;
        const isImportRead = parsed.isImportRead as boolean | undefined;
        const maxDepth = parsed.maxDepth as number | undefined;
        const importSyntax = parsed.importSyntax as string[] | undefined;
        operations.push({
          kind: 'read_files',
          patterns,
          excludePatterns: excludePatterns && Array.isArray(excludePatterns) ? excludePatterns : undefined,
          directory: directory || undefined,
          recursive: recursive ?? true,
          maxResults: maxResults ?? 500,
          isImportRead: isImportRead ?? false,
          maxDepth: maxDepth ?? 5,
          importSyntax: importSyntax && Array.isArray(importSyntax) ? importSyntax : undefined,
          index: String(index),
        });
        break;
      }
      case 'read_directory': {
        const directoryPath = parsed.directoryPath as string | undefined;
        if (!directoryPath) {
          throw new BrudError(missingFieldError('directoryPath', 'read_directory operation'));
        }
        const recursive = parsed.recursive as boolean | undefined;
        const excludePatterns = parsed.excludePatterns as string[] | undefined;
        const isImportRead = parsed.isImportRead as boolean | undefined;
        const maxDepth = parsed.maxDepth as number | undefined;
        const importSyntax = parsed.importSyntax as string[] | undefined;
        operations.push({
          kind: 'read_directory',
          directoryPath,
          recursive: recursive ?? true,
          excludePatterns: excludePatterns && Array.isArray(excludePatterns) ? excludePatterns : undefined,
          isImportRead: isImportRead ?? false,
          maxDepth: maxDepth ?? 5,
          importSyntax: importSyntax && Array.isArray(importSyntax) ? importSyntax : undefined,
          index: String(index),
        });
        break;
      }
      case 'terminal_interactive': {
        const command = parsed.command as string | undefined;
        if (!command) {
          throw new BrudError(missingFieldError('command', 'terminal_interactive operation'));
        }
        const raw = parsed.raw as boolean | undefined;
        const cmdResult = BrudAPI.validate.command(command);
        if (!cmdResult.success) {
          throw new BrudError({ code: 'DANGEROUS_COMMAND', friendly: cmdResult.friendly!, details: cmdResult.details! });
        }
        const answers = parsed.answers as string[] | undefined;
        if (!answers || !Array.isArray(answers)) {
          throw new BrudError(missingFieldError('answers', 'terminal_interactive operation'));
        }
        const timeout = parsed.timeout as number | undefined;
        const cwd = parsed.cwd as string | undefined;
        const cwdResult = BrudAPI.validate.cwd(cwd, workspaceFolders);
        if (!cwdResult.success) {
          throw new BrudError({ code: 'INVALID_CWD', friendly: cwdResult.friendly!, details: cwdResult.details! });
        }
        const cwdData = cwdResult.data as { resolvedCwd?: string } | undefined;
        const interactiveOp: any = {
          kind: 'terminal_interactive',
          command,
          answers,
          timeout: timeout ?? 120,
          cwd: cwdData?.resolvedCwd,
          index: String(index),
        };
        if (raw) {
          interactiveOp.raw = true;
        }
        operations.push(interactiveOp as FileOperation);
        break;
      }
      case 'terminal_command': {
        const command = parsed.command as string | undefined;
        const commands = parsed.commands as string[] | undefined;
        if (!command && (!commands || !Array.isArray(commands) || commands.length === 0)) {
          throw new BrudError(missingFieldError('command or commands', 'terminal_command operation'));
        }
        const raw = parsed.raw as boolean | undefined;
        if (command) {
          const cmdResult = BrudAPI.validate.command(command);
          if (!cmdResult.success) {
throw new BrudError({ code: 'DANGEROUS_COMMAND', friendly: cmdResult.friendly!, details: cmdResult.details! });
          }
        }
        if (commands && Array.isArray(commands)) {
          for (const cmd of commands) {
            const cmdResult = BrudAPI.validate.command(cmd);
            if (!cmdResult.success) {
              throw new BrudError({ code: 'DANGEROUS_COMMAND', friendly: cmdResult.friendly!, details: cmdResult.details! });
            }
          }
        }
        const timeout = parsed.timeout as number | undefined;
        const cwd = parsed.cwd as string | undefined;
        const env = parsed.env as Record<string, string> | undefined;
        const mode = parsed.mode as string | undefined;
        const stopOnFailure = parsed.stop_on_failure as boolean | undefined;
        const onSuccess = parseCommandGroup(parsed.on_success);
        const onFailure = parseCommandGroup(parsed.on_failure);
        if (mode !== undefined && mode !== 'sequential' && mode !== 'parallel') {
          throw new BrudError(invalidFieldError('mode', 'Mode field must be "sequential" or "parallel" in terminal_command operation'));
        }
        const cwdResult = BrudAPI.validate.cwd(cwd, workspaceFolders);
        if (!cwdResult.success) {
          throw new BrudError({ code: 'INVALID_CWD', friendly: cwdResult.friendly!, details: cwdResult.details! });
        }
        const cwdData = cwdResult.data as { resolvedCwd?: string } | undefined;
        const op: any = {
          kind: 'terminal_command',
          index: String(index),
        };
        if (commands && Array.isArray(commands)) {
          op.commands = commands;
          if (mode) {
            op.mode = mode;
          }
          if (stopOnFailure !== undefined) {
            op.stopOnFailure = stopOnFailure;
          }
        } else {
          op.command = command;
        }
        op.timeout = timeout ?? undefined;
        op.cwd = cwdData?.resolvedCwd;
        op.env = env && typeof env === 'object' ? env : undefined;
        if (raw) {
          op.raw = true;
        }
        if (onSuccess) {
          op.onSuccess = onSuccess;
        }
        if (onFailure) {
          op.onFailure = onFailure;
        }
        operations.push(op as FileOperation);
        break;
      }
      case 'get_tool_info': {
        const toolKind = parsed.tool as string | undefined;
        operations.push({
          kind: 'get_tool_info',
          toolKind: toolKind || undefined,
          index: String(index),
        });
        break;
      }
      default:
        throw new BrudError(unknownOperationError(operation));
    }
  }

  return operations;
}