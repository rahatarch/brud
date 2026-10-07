import type { Token } from '@brud/kernel' with { 'resolution-mode': 'import' };
import type { FileSystem } from '../types/filesystem.js';
import type { TerminalExecutor } from '../terminal/types.js';
import type { HistoryStore } from '../history/store.js';
import type { BrudSettings } from '../settings/types.js';
import type { IStructureService } from '../services/structureService.js';

function createToken<T>(description: string): Token<T> {
  return Symbol(description) as unknown as Token<T>;
}

export const CoreTokens = {
  FileSystem: createToken<FileSystem>('Core.FileSystem'),
  TerminalExecutor: createToken<TerminalExecutor>('Core.TerminalExecutor'),
  HistoryStore: createToken<HistoryStore>('Core.HistoryStore'),
  Settings: createToken<BrudSettings>('Core.Settings'),
  StructureService: createToken<IStructureService>('Core.StructureService'),
};