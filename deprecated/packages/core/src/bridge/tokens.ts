import type { Token } from '@brud/kernel' with { 'resolution-mode': 'import' };
import type { FileSystem } from '../types/filesystem.js';
import type { TerminalExecutor } from '../terminal/types.js';
import type { HistoryStore } from '../history/store.js';
import type { BrudSettings } from '../settings/types.js';
import type { IStructureService } from '../services/structureService.js';
import type { ITerminalService } from '@brud/kernel' with { 'resolution-mode': 'import' };

function createToken<T>(description: string): Token<T> {
  return Symbol(description) as unknown as Token<T>;
}

/**
 * Symbol the kernel terminal authority is registered under.
 *
 * The authority is a separate token from the legacy `TerminalExecutor`
 * facade: hosts that need the failure taxonomy resolve this one, while every
 * legacy caller keeps the frozen executor interface.
 */
export const CoreTerminalToken = createToken<ITerminalService>('Core.TerminalService');

export const CoreTokens = {
  FileSystem: createToken<FileSystem>('Core.FileSystem'),
  TerminalExecutor: createToken<TerminalExecutor>('Core.TerminalExecutor'),
  TerminalService: createToken<ITerminalService>('Core.TerminalService'),
  HistoryStore: createToken<HistoryStore>('Core.HistoryStore'),
  Settings: createToken<BrudSettings>('Core.Settings'),
  StructureService: createToken<IStructureService>('Core.StructureService'),
};